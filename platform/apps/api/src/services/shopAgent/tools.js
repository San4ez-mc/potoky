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

async function tool(A, nodeId, label) {
    const code = nodeCode(A.assets, nodeId);
    if (!code) { logger.warn('[shopAgent] no code for node ' + nodeId); return { ok: false, error: 'no code' }; }
    const r = await runNodeCode(code, { ctx: A.ctx, keys: A.keys, user: A.user, session: A.session, input: A.ctx.lastUserMessage || '', label: label || nodeId });
    A.trace.push({ tool: nodeId, ok: r.ok, ms: r.ms, error: r.error || null });
    return r;
}

// ── Товар ─────────────────────────────────────────────────────────────────────────────────────
/** Повний конвеєр визначення товару: n_route → n_shop_profile → n_prev_match_snapshot → n_signal_check → n_lookup → (підказка каталогу). */
async function resolveProduct(A, { forceSignal } = {}) {
    const { ctx, keys } = A;
    await tool(A, 'n_route');
    await tool(A, 'n_shop_profile');
    await tool(A, 'n_prev_match_snapshot');
    if (forceSignal) ctx.hasFreshSignalThisTurn = true;
    await tool(A, 'n_signal_check');
    const hadProduct = !!(ctx.product && ctx.product.sku);
    const cat = await loadCatalog(A.botId, keys);
    ctx.lookupProductsRaw = cat.products; ctx.lookupAdsRaw = cat.ads; ctx.lookupCategoriesRaw = cat.categories || [];
    let status = 'none';
    if (ctx.hasProductSignal || ctx.catalogHintPick || forceSignal || hadProduct) {
        delete ctx.productUnknown; delete ctx.productUnknownReason;
        await tool(A, 'n_lookup');
        if (ctx.product && ctx.product.sku && !ctx.productUnknown) status = 'found';
    }
    if (status !== 'found' && !hadProduct) {
        // підказка каталогу за категорією/словом (кофта, костюм, ангора, «сірий»…)
        delete ctx.catalogHintPick;
        await tool(A, 'n_catalog_hint_prep');
        if (ctx.catalogHintNeedsFetch) {
            ctx.catalogHintProductsRaw = cat.products;
            ctx.catalogHintCategoriesRaw = await loadCategories(A.botId, keys);
            // 2026-09-15 (живий аудит: клієнти, що описують товар/комплект словами замість
            // пересилання поста, постійно отримували "перешліть пост" замість списку товарів):
            // нода зветься 'n_catalog_hint' (сама себе в шапці коду досі називає старою назвою
            // 'n_catalog_hint_process' з патчу 2026-09-04, звідки й узявся мисматч) — виклик тут
            // ішов на НЕІСНУЮЧИЙ id, тому весь фільтр/матчинг (зокрема логіка "комплект" — показ
          // усіх наборів каталогу за словесним описом складу) НІКОЛИ не виконувався: tool()
            // мовчки повертав {ok:false, error:'no code'}, і catalogHint лишався порожнім.
            await tool(A, 'n_catalog_hint');
        }
        if (ctx.catalogHintPick) {
            ctx.hasFreshSignalThisTurn = true; ctx.hasProductSignal = true;
            delete ctx.productUnknown;
            await tool(A, 'n_lookup');
            if (ctx.product && ctx.product.sku && !ctx.productUnknown) status = 'found';
        }
        if (status !== 'found' && ctx.catalogHint) status = 'hint';
        if (status !== 'found' && status !== 'hint' && ctx.hasProductSignal) status = 'unknown';
    } else if (status !== 'found' && hadProduct) {
        status = ctx.product && ctx.product.sku ? 'kept' : 'unknown';
    }
    delete ctx.lookupProductsRaw; delete ctx.lookupAdsRaw; delete ctx.lookupCategoriesRaw; delete ctx.catalogHintProductsRaw; delete ctx.catalogHintCategoriesRaw;
    return { status, skipPresentation: !!ctx.skipPresentation };
}

async function setApply(A) { return tool(A, 'n_set_apply'); }
async function calcSize(A) { return tool(A, 'n_calc'); }
async function checkAvail(A) { return tool(A, 'n_avail'); }
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
    const hits = Array.isArray(r.data) ? r.data : [];
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
    if (ctx.testMode) { if (!Array.isArray(ctx.monoStatement)) ctx.monoStatement = []; return { ok: true, test: true }; }
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
    if (ctx.testMode) { A.trace.push({ alert: typeof nodeIdOrFields === 'string' ? nodeIdOrFields : (nodeIdOrFields.title || '?'), skipped: 'testMode' }); return false; }
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
    return !!j.ok;
}

module.exports = { tool, resolveProduct, setApply, calcSize, checkAvail, availSearch, extraResolve, orderPrefill, intlRoute, payAmount, npCheck, reconcile, crmOrder, supplierRoute, supplierOrder, confirmPrep, ttnSync, returnCrmUpdate, kbContext, kbAsk, createInvoice, deleteInvoice, monoStatement, markConsumed, funnelStage, alert, activeFop };
