'use strict';
/**
 * shopAgent/tools.js — детерміновані інструменти. Кожен інструмент читає/пише ТОЙ САМИЙ context,
 * що й старий граф (контракт полів — див. документ «Діагноз goverla_shop», розділ 5 і карту
 * інтерфейсів). Коди js-нод беруться з flowDefinition бота за id (джерело істини — БД).
 * Мутації (CRM-замовлення, постачальник, інвойс, алерти) поважають ctx.testMode.
 */
const { db, logger, runNodeCode, nodeCode, nodeData, crmFetch, crmBase, crmHeaders, loadCatalog, loadCategories, renderTemplate, alertFields, hideLinks } = require('./lib');
const { buildAdminAlert } = require('../testSession');
const { redisClient } = require('../../lib/sessionStore');
const { getMonoStatement, markConsumed: markMonoConsumed, getConsumedSet: getMonoConsumedSet } = require('@platform/mono-statement');
const { resolveShoppingIntent } = require('./resolveShoppingIntent');

async function tool(A, nodeId, label) {
    const code = nodeCode(A.assets, nodeId);
    if (!code) { logger.warn('[shopAgent] no code for node ' + nodeId); return { ok: false, error: 'no code' }; }
    const r = await runNodeCode(code, { ctx: A.ctx, keys: A.keys, user: A.user, session: A.session, input: A.ctx.lastUserMessage || '', label: label || nodeId });
    A.trace.push({ tool: nodeId, ok: r.ok, ms: r.ms, error: r.error || null });
    return r;
}

// ── Товар ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Повний конвеєр визначення товару: n_route → n_shop_profile → n_prev_match_snapshot →
 * класифікація сигналу → матчинг (productMatch.js, ex-n_lookup) → reconciliation (cart.js) →
 * підказка каталогу (catalogHint.js, ex-n_catalog_hint) якщо нічого не знайдено.
 *
 * 2026-09-22 перебудова (архітектурний аудит product-recognition, goverla_shop): n_lookup +
 * n_catalog_hint + n_catalog_hint_prep (DB-string flow-ноди, ~1250 рядків одноразових патчів
 * за 3 тижні) перенесено в git-tracked productMatch.js/catalogHint.js без зміни алгоритму
 * матчингу (усі датовані фікси збережено), плюс новий шар — resolveShoppingIntent.js — який
 * явно вирішує REPLACE_MAIN/ADD_EXTRA/CONFIRM/ASK_REPLACE_OR_ADD замість мовчазного
 * перезапису `ctx.product`. `u` (розібраний намір з understand.js) тепер обовʼязковий
 * параметр — ним керується класифікатор сигналу (signal.js).
 */
async function resolveProduct(A, u) {
    return resolveShoppingIntent(A, u || {}, tool);
}

async function setApply(A) { return tool(A, 'n_set_apply'); }
async function calcSize(A) { return tool(A, 'n_calc'); }
async function checkAvail(A) {
    const r = await tool(A, 'n_avail');
    // Два одержувачі з різними параметрами: n_avail ставить усім одиницям один recommendedSize — підставляємо розмір кожної пари.
    const c = A.ctx, ps = c.agent && c.agent.pairSizes;
    if (Array.isArray(ps) && Array.isArray(c.orderUnits) && c.orderUnits.length === ps.length) {
        c.orderUnits = c.orderUnits.map((x, i) => ({ ...x, size: ps[i] || x.size }));
        c.orderUnitsText = c.orderUnits.length + ' шт: ' + c.orderUnits.map((x) => [x.color, x.size].filter(Boolean).join(' ') || '—').join(', ');
    }
    return r;
}
async function availSearch(A) { return tool(A, 'n_avail_search'); }
async function extraResolve(A) { return tool(A, 'n_extra_resolve'); }
async function orderPrefill(A) { return tool(A, 'n_order_prefill'); }
async function intlRoute(A) { return tool(A, 'n_intl_route'); }
async function payAmount(A) { return tool(A, 'n_pay_amount'); }
async function npCheck(A) { return tool(A, 'n_np_check'); }
async function reconcile(A) { return tool(A, 'n_reconcile'); }
async function crmOrder(A) { return tool(A, 'n_crm_order'); }
async function supplierRoute(A) { return tool(A, 'n_supplier_route'); }
async function confirmPrep(A) { return tool(A, 'n_confirm_prep'); }
async function ttnSync(A) { return tool(A, 'n_ttn_sync_crm'); }
async function returnCrmUpdate(A) { return tool(A, 'n_return_crm_update'); }
async function supplierOrder(A) {
    const m = A.ctx.supplierMechanism;
    if (m === 'brewdrop') return tool(A, 'n_supplier_order');
    if (m === 'easydrop_offline') return tool(A, 'n_supplier_order_ed');
    if (m === 'easydrop_cart') return tool(A, 'n_supplier_order_cart');
    return { ok: true, manual: true };
}

// ── База знань CRM ────────────────────────────────────────────────────────────────────────────
const _kbCache = new Map(); // `${botId}:${scope}` -> {at, items}
// 2026-09-17 (власник, фолбек для питань не по скрипту): /knowledge/search (Postgres
// to_tsvector('simple')) не має української морфології — "кишені" в питанні клієнта і "кишеня"
// в записі KB не збігаються навіть коли відповідь точно є. При розмірі бази в кілька десятків
// записів надійніше не шукати за словом узагалі, а віддати ВСІ активні записи скоупу (магазин +
// категорія + товар) прямо в compose() — нехай LLM сама читає й вирішує релевантність.
async function kbContext(A) {
    const scope = A.ctx.product && A.ctx.product.id ? 'product:' + A.ctx.product.id : 'shop';
    const key = A.botId + ':' + scope;
    const c = _kbCache.get(key);
    if (c && Date.now() - c.at < 60 * 1000) return c.items;
    const r = await crmFetch(A.keys, '/knowledge/context?scope=' + encodeURIComponent(scope), {}, 4000);
    let hits = Array.isArray(r.data) ? r.data : [];
    // Запитання про допродаж/додаткову позицію (напр. «з чого футболка?») — підтягуємо ще й знання про товар допродажу
    // (FunnelTest 38: бот казав «уточню», хоча відповідь у базі є, але вона product-scope іншого товару).
    const upId = A.ctx.product && Array.isArray(A.ctx.product.upsellItems) && A.ctx.product.upsellItems[0] && A.ctx.product.upsellItems[0].id;
    if (upId && scope !== 'product:' + upId) {
        const r2 = await crmFetch(A.keys, '/knowledge/context?scope=' + encodeURIComponent('product:' + upId), {}, 4000);
        if (Array.isArray(r2.data)) { const seen = new Set(hits.map((h) => h.id || h.question)); hits = hits.concat(r2.data.filter((h) => !seen.has(h.id || h.question))); }
    }
    const items = hits.map((h) => ({ q: String(h.question || '').slice(0, 200), a: String(h.answer || '').slice(0, 600) })).filter((h) => h.a);
    if (r.ok) _kbCache.set(key, { at: Date.now(), items });
    return items;
}
/** Питання, на яке бот не знає відповіді → чернетка в KB (from_dialog) + (алерт робить політика). */
async function kbAsk(A, question) {
    const q = String(question || '').trim(); if (!q || A.ctx.testMode) return;
    await crmFetch(A.keys, '/knowledge/from-dialog', { method: 'POST', body: JSON.stringify({ question: q.slice(0, 500), sessionId: A.session.id, productId: (A.ctx.product && A.ctx.product.id) || null, igUsername: A.ctx.igUsername || null }) }, 4000).catch(() => {});
}

// ── Оплата: ibanoplata + monobank (порт із двигуна, без графа) ────────────────────────────────
async function activeFop(A) {
    const r = await crmFetch(A.keys, '/fops', {}, 3000);
    const list = Array.isArray(r.data) ? r.data : [];
    return list.find((f) => f && f.isActive === true && f.name && f.iban) || null;
}
async function createInvoice(A) {
    const { ctx, keys } = A;
    if (ctx.testMode) { if (!ctx.orderRef) ctx.orderRef = 'TEST' + Date.now().toString(36).toUpperCase(); ctx.ibanInvoiceUid = 'test-uid'; ctx.ibanPayUrl = 'https://test.local/pay/' + ctx.orderRef; return { ok: true, test: true }; }
    const fop = await activeFop(A).catch(() => null);
    const apiKey = String(keys.IBANOPLATA_API_KEY || '').trim();
    const orgName = (fop && fop.name) || keys.FOP_NAME || '';
    const idCode = (fop && fop.taxId) || keys.FOP_CODE || '';
    const iban = (fop && fop.iban) || keys.FOP_IBAN || '';
    const amountNum = Number(ctx.payAmount) || 0;
    if (!apiKey || !iban || !amountNum) { ctx.ibanPayUrl = ''; return { ok: false, error: 'no key/iban/amount' }; }
    if (!ctx.orderRef) ctx.orderRef = 'GOV' + Date.now().toString(36).slice(-6).toUpperCase();
    const body = { organizationName: orgName, identificationCode: idCode, iban, amount: Math.round(amountNum * 100) / 100, paymentPurpose: 'Оплата за товар ' + ctx.orderRef, notes: ctx.orderRef, clientNotes: 'Замовлення ' + ctx.orderRef, expirationHours: parseInt(keys.IBANOPLATA_EXPIRATION_HOURS || '24', 10) || 24 };
    let j = {}; let status = 0; const t0 = Date.now();
    for (let attempt = 1; attempt <= 2 && !j.ibanInvoiceUrl; attempt++) {
        if (attempt > 1) await new Promise((r) => setTimeout(r, 1500));
        const ac = new AbortController(); const to = setTimeout(() => { try { ac.abort(); } catch (e) { /* noop */ } }, 15000);
        try {
            const r = await fetch('https://api.ibanoplata.com/v2/iban-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Api-Key': apiKey }, body: JSON.stringify(body), signal: ac.signal });
            status = r.status; j = await r.json().catch(() => ({}));
        } catch (e) { j = { error: e.message }; } finally { clearTimeout(to); }
    }
    db.apiCall.create({ data: { sessionId: A.session.id, service: 'ibanoplata', method: 'create_invoice', requestData: { amount: body.amount, orderRef: ctx.orderRef }, responseData: { ok: !!j.ibanInvoiceUrl, error: j.error || null }, statusCode: status, durationMs: Date.now() - t0 } }).catch(() => {});
    if (j.ibanInvoiceUrl) { ctx.ibanPayUrl = j.ibanInvoiceUrl; ctx.ibanInvoiceUid = j.uid || j.id || j.ibanInvoiceUid || ''; return { ok: true }; }
    ctx.ibanPayUrl = ''; return { ok: false, error: j.error || ('HTTP ' + status) };
}
async function deleteInvoice(A) {
    const { ctx, keys } = A; const uid = String(ctx.ibanInvoiceUid || '').trim();
    if (!uid || ctx.testMode || uid === 'test-uid') return;
    await fetch('https://api.ibanoplata.com/v2/iban-invoice/' + encodeURIComponent(uid), { method: 'DELETE', headers: { Accept: 'application/json', 'X-Api-Key': String(keys.IBANOPLATA_API_KEY || '').trim() } }).catch(() => {});
    ctx.ibanInvoiceUid = '';
}
async function monoStatement(A) {
    const { ctx, keys } = A;
    if (ctx.testMode) {
        // Тестова виписка: крок тесту з bankPaid=N імітує надходження N грн (коментар = референс замовлення).
        const _paid = (global.__testBankPaid && global.__testBankPaid[A.session.id]) || ctx.testBankPaid;
        console.log('[bankmock] monoStatement session=' + String(A.session.id).slice(0, 8) + ' paid=' + _paid + ' keys=' + Object.keys(global.__testBankPaid || {}).map((k) => k.slice(0, 8)).join(','));
        ctx.monoStatement = _paid ? [{ id: 'test-tx-1', time: Math.floor(Date.now() / 1000), amountUah: Number(_paid), comment: String(ctx.orderRef || ''), counterName: 'Test Payer', description: 'test payment' }] : [];
        return { ok: true, test: true };
    }
    let token = ''; let account = '0';
    try {
        const r = await crmFetch(keys, '/fops', {}, 3000);
        const fop = (Array.isArray(r.data) ? r.data : []).find((f) => f && f.isActive === true && f.monobankToken) || null;
        if (fop) {
            token = String(fop.monobankToken).trim();
            const cached = ctx.fop && ctx.fop.monoAccountId && ctx.fop.monoTokenHint === token.slice(0, 6) ? ctx.fop.monoAccountId : null;
            if (cached) account = cached;
            else {
                const ac = new AbortController(); const to = setTimeout(() => { try { ac.abort(); } catch (e) { /* noop */ } }, 5000);
                try {
                    const ci = await fetch('https://api.monobank.ua/personal/client-info', { headers: { 'X-Token': token }, signal: ac.signal });
                    const cij = ci.ok ? await ci.json().catch(() => ({})) : {}; const accs = Array.isArray(cij.accounts) ? cij.accounts : [];
                    const fopIban = String(fop.iban || '').replace(/\s/g, '');
                    const pick = accs.find((a) => fopIban && String(a.iban || '').replace(/\s/g, '') === fopIban) || accs.find((a) => String(a.type || '').toLowerCase() === 'fop' && Number(a.currencyCode) === 980) || accs.find((a) => String(a.type || '').toLowerCase() === 'fop');
                    if (pick && pick.id) { account = pick.id; ctx.fop = Object.assign({}, ctx.fop || {}, { monoAccountId: pick.id, monoTokenHint: token.slice(0, 6) }); }
                } catch (e) { /* best-effort */ } finally { clearTimeout(to); }
            }
        }
    } catch (e) { /* best-effort */ }
    if (!token) { ctx.monoStatement = []; return { ok: false, error: 'no mono token in CRM' }; }
    const t0 = Date.now();
    const { items, fromCache, status } = await getMonoStatement({ redisClient, token, account, windowHours: 48 });
    ctx.monoStatement = (items || []).filter((t) => t && Number(t.amount) > 0).map((t) => ({ id: t.id, amountUah: Math.round(Number(t.amount)) / 100, time: t.time, comment: t.comment || '', description: t.description || '', counterName: t.counterName || '', counterIban: t.counterIban || '' }));
    try { const g = await getMonoConsumedSet({ redisClient, botId: A.botId }); ctx.consumedTxIds = Array.from(new Set([...(Array.isArray(ctx.consumedTxIds) ? ctx.consumedTxIds : []), ...g])); } catch (e) { /* ignore */ }
    db.apiCall.create({ data: { sessionId: A.session.id, service: 'monobank', method: 'get_statement', requestData: { account, windowHours: 48 }, responseData: { count: ctx.monoStatement.length, fromCache: !!fromCache }, statusCode: status || (fromCache ? 304 : null), durationMs: Date.now() - t0 } }).catch(() => {});
    return { ok: true };
}
async function markConsumed(A) { const tx = String(A.ctx.payTxId || '').trim(); if (tx && !A.ctx.testMode) await markMonoConsumed({ redisClient, botId: A.botId, txId: tx }).catch(() => {}); }

// ── CRM: етапи воронки (аналітика) ─────────────────────────────────────────────────────────────
async function funnelStage(A, stageName, stageOrder) {
    const { ctx, keys, session } = A;
    if (!stageName || ctx.testMode || session.isTest || !keys.CRM_API_KEY) return;
    try {
        const r = await crmFetch(keys, '/funnel-events', { method: 'POST', body: JSON.stringify({ funnelSlug: A.assets.bot.slug || A.botId, sessionId: session.id, stageName, stageOrder: Number(stageOrder) || 0, igUsername: ctx.igUsername || null, senderName: ctx.senderName || null, psid: ctx.psid || null, product: ctx.product && (ctx.product.sku || ctx.product.name) ? { id: ctx.product.id || null, sku: ctx.product.sku || '', name: ctx.product.customerName || ctx.product.name || '', price: Number(ctx.product.price) || 0 } : null }) }, 6000);
        if (ctx.crmOrderId && !String(ctx.crmOrderId).startsWith('TEST-')) {
            const p = await crmFetch(keys, '/pipelines', {}, 4000);
            let stageId = null; const want = stageName.toLowerCase();
            for (const pl of (Array.isArray(p.data) ? p.data : [])) { const hit = (pl.stages || []).find((s) => String(s.name || '').trim().toLowerCase() === want); if (hit) { stageId = hit.id; break; } }
            if (stageId) await crmFetch(keys, '/orders/' + ctx.crmOrderId, { method: 'PATCH', body: JSON.stringify({ stageId }) }, 4000);
        }
        return r.ok;
    } catch (e) { return false; }
}

// ── Telegram-алерт менеджеру (той самий формат, що notifyTg-ноди) ─────────────────────────────
async function alert(A, nodeIdOrFields, extra = {}) {
    const { ctx, keys, session } = A;
    if (ctx.testMode) { const _t = typeof nodeIdOrFields === 'string' ? nodeIdOrFields : (nodeIdOrFields.title || '?'); A.trace.push({ alert: _t, skipped: 'testMode' }); ctx.testAlerts = [...(ctx.testAlerts || []), _t]; return false; }
    const f = typeof nodeIdOrFields === 'string' ? alertFields(A.assets, nodeIdOrFields, ctx) : nodeIdOrFields;
    const adminId = keys.ADMIN_TELEGRAM_ID || ''; const tok = keys.TELEGRAM_BOT_TOKEN || '';
    if (!adminId || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(tok)) { A.trace.push({ alert: f.title, error: 'no ADMIN_TELEGRAM_ID/TELEGRAM_BOT_TOKEN' }); return false; }
    // Централізовано, В ОДНОМУ МІСЦІ, для КОЖНОГО сповіщення менеджеру: будь-яке http(s)-посилання
    // (сире посилання клієнта, посилання на квитанцію Zernio без авторизації тощо) ховається за
    // коротким текстом — так само, як фото вже ховається у фолбеку нижче. Точкові виправлення по
    // кожному окремому вузлу/виклику нічого не гарантують: досить одного забутого місця (живий
    // приклад — n_receipt_alert), і сире посилання знову з'являється. Тут воно ловиться завжди.
    const txt = buildAdminAlert({ funnelEnv: keys, title: hideLinks(f.title), main: hideLinks(f.main), details: hideLinks([f.details, extra.details].filter(Boolean).join('\n')), ctx, sessionId: session.id });
    let j = {};
    const photo = /^https?:\/\//.test(String(f.photoUrl || extra.photoUrl || '')) ? String(f.photoUrl || extra.photoUrl) : '';
    if (photo && txt.length <= 1000) {
        try {
            let buf = null; const pu = new URL(photo);
            if (pu.hostname.toLowerCase() === 'zernio.com' && keys.ZERNIO_API_TOKEN) { const ir = await fetch(photo, { headers: { Authorization: 'Bearer ' + keys.ZERNIO_API_TOKEN } }); if (ir.ok) buf = Buffer.from(await ir.arrayBuffer()); }
            if (buf) { const fd = new FormData(); fd.append('chat_id', String(adminId)); fd.append('caption', txt); fd.append('parse_mode', 'HTML'); fd.append('photo', new Blob([buf]), 'photo.jpg'); const rp = await fetch('https://api.telegram.org/bot' + tok + '/sendPhoto', { method: 'POST', body: fd }).catch(() => null); j = rp ? await rp.json().catch(() => ({})) : {}; }
            else { const rp = await fetch('https://api.telegram.org/bot' + tok + '/sendPhoto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(adminId), photo, caption: txt, parse_mode: 'HTML' }) }).catch(() => null); j = rp ? await rp.json().catch(() => ({})) : {}; }
        } catch (e) { /* fallback below */ }
    }
    if (!j.ok) {
        const text = photo ? (txt + '\n<a href="' + photo.replace(/"/g, '&quot;') + '">📷 фото</a>') : txt;
        const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(adminId), text, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(() => null);
        j = r ? await r.json().catch(() => ({})) : {};
    }
    A.trace.push({ alert: f.title, ok: !!j.ok, error: j.ok ? null : (j.description || 'fetch failed') });
    // 2026-09-17 (власник: "візьми всі сповіщення в телеграм за тиждень і зроби аналіз") — раніше
    // єдиним слідом сповіщення був A.trace/ctx.agent.lastTrace, який ПЕРЕЗАПИСУЄТЬСЯ щоходу: історія
    // існувала лише для ОСТАННЬОГО ходу сесії, тож повний тижневий аудит фізично неможливо було
    // зібрати з БД. ctx.agent.alertLog — стійкий (30 днів, до 50 записів) слід КОЖНОГО сповіщення,
    // зберігається разом з рештою ctx у кінці ходу (index.js) — без окремого запису в БД тут.
    const cutoff = Date.now() - 30 * 86400000;
    const prevAlertLog = (Array.isArray(ctx.agent.alertLog) ? ctx.agent.alertLog : []).filter((e) => !e.ts || new Date(e.ts).getTime() > cutoff);
    prevAlertLog.push({ ts: new Date().toISOString(), title: f.title, ok: !!j.ok, error: j.ok ? null : (j.description || 'fetch failed') });
    ctx.agent.alertLog = prevAlertLog.slice(-50);
    return !!j.ok;
}

module.exports = { tool, resolveProduct, setApply, calcSize, checkAvail, availSearch, extraResolve, orderPrefill, intlRoute, payAmount, npCheck, reconcile, crmOrder, supplierRoute, supplierOrder, confirmPrep, ttnSync, returnCrmUpdate, kbContext, kbAsk, createInvoice, deleteInvoice, monoStatement, markConsumed, funnelStage, alert, activeFop };
