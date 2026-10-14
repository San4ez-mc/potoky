'use strict';
/**
 * shopAgent/payRecheck.js — фонова перезвірка оплат (аудит B14, 14.10).
 *
 * Чому: звірка запускалась лише тоді, коли клієнт щось пише. Гроші, що дійшли пізніше (переказ з Ощадбанку на IBAN — 19:53 скріншот,
 * 00:44 у виписці: vita.zayika) або поки бот на паузі через менеджера (_artem_0503: оплата з кодом замовлення о 21:36, скріншот —
 * менеджеру), так і лишались «не знайдено».
 * Тепер раз на 5 хв: розмови з виданим кодом оплати (orderRef) за 3 доби, оплату не підтверджено → спільна виписка monobank (кеш на
 * рахунок, 1 запит/хв на всіх) → ОДНОЗНАЧНИЙ збіг: код замовлення в коментарі платежу, або єдиний платіж потрібної суми від того,
 * чий ПІБ у даних доставки. Знайшли — «оплачено» в розмові, платіж і стадія в CRM, повідомлення в групу. Клієнту нічого не пишемо.
 * Працює лише в platform-api (process.env.name).
 */
const { db, logger, crmFetch } = require('./lib');

const WINDOW_MS = 72 * 3600 * 1000;

function normName(s) { return String(s || '').toLowerCase().replace(/[^0-9a-zа-яіїєґ]+/gi, ' ').trim(); }
/** Та сама людина: щонайменше ДВА слова ПІБ (прізвище й імʼя) з даних доставки є в назві платника — одне імʼя («Артем») не доказ. */
function samePerson(a, b) { const aa = [...new Set(normName(a).split(' ').filter((x) => x.length > 2))]; const bb = normName(b).split(' '); return aa.filter((w) => bb.includes(w)).length >= 2; }

/** Чистий вибір платежу (без БД — для тестів). stmt — [{id, amountUah, time, comment, counterName, description}]. */
function pickPayment(ctx, stmt, consumed) {
    const ref = String(ctx.orderRef || '').toUpperCase();
    const need = Number(ctx.payAmount) || 0;
    const since = Math.floor((Number(ctx.orderRefAt) || 0) / 1000) - 600;
    const used = new Set(consumed || []);
    const fresh = (stmt || []).filter((t) => t && !used.has(t.id) && (!since || !t.time || Number(t.time) >= since));
    if (ref) {
        const byRef = fresh.filter((t) => String(t.comment || '').toUpperCase().includes(ref) || String(t.description || '').toUpperCase().includes(ref));
        if (byRef.length === 1 && Number(byRef[0].amountUah) + 0.01 >= need) return { tx: byRef[0], via: 'mono:recheck:ref' };
        if (byRef.length === 1) return { partial: byRef[0] };
    }
    const payer = (ctx.orderData && ctx.orderData.fullName) || '';
    if (payer && need) {
        const byName = fresh.filter((t) => Math.abs(Number(t.amountUah) - need) < 0.01 && samePerson(payer, (t.counterName || '') + ' ' + (t.description || '')));
        if (byName.length === 1) return { tx: byName[0], via: 'mono:recheck:name' };
    }
    return null;
}

async function tick() {
    const rows = await db.$queryRawUnsafe(`select s.id, s."botId" from sessions s
        where not s."isTest" and coalesce(s.context->>'testMode','') <> 'true' and coalesce(s.context->>'orderRef','') <> ''
          and coalesce(s.context->>'payStatus','') not in ('confirmed') and coalesce(nullif(s.context->>'payAmount',''),'0')::numeric > 0
          and coalesce(nullif(s.context->>'orderRefAt',''),'0')::bigint > $1 limit 200`, Date.now() - WINDOW_MS).catch((e) => { logger.warn('[payRecheck] query: ' + e.message); return []; });
    if (!rows.length) return;
    const T = require('./tools');
    const byBot = new Map(); for (const r of rows) { if (!byBot.has(r.botId)) byBot.set(r.botId, []); byBot.get(r.botId).push(r.id); }
    for (const [botId, ids] of byBot) {
        const keys = {}; for (const k of await db.funnelKey.findMany({ where: { botId }, select: { key: true, value: true } })) keys[k.key] = k.value;
        if (!keys.CRM_API_KEY) continue;
        for (const id of ids) {
            try {
                const s = await db.session.findUnique({ where: { id }, select: { id: true, context: true } }); const ctx = (s && s.context) || {};
                if (ctx.payStatus === 'confirmed') continue;
                ctx.agent = ctx.agent || {};
                const A = { botId, keys, ctx, session: { id }, trace: [], assets: null, user: {} };
                await T.monoStatement(A); // спільний кеш на рахунок — для всіх розмов один запит до банку на хвилину
                const hit = pickPayment(ctx, ctx.monoStatement, ctx.consumedTxIds);
                if (!hit || !hit.tx) continue;
                const tx = hit.tx;
                const patch = { payStatus: 'confirmed', payStatusText: 'підтверджено ✅', payVia: hit.via, payTxId: tx.id, payPaidAmount: Number(tx.amountUah) || 0, consumedTxIds: [...new Set([...(ctx.consumedTxIds || []), tx.id])], payConfirmedLine: 'Оплату отримали ✅ ', payRecheckAt: new Date().toISOString() };
                // Злиття лише цих полів (атомарно) — хід бота, що йде паралельно, не перезаписуємо.
                await db.$executeRawUnsafe('update sessions set context = context || $2::jsonb where id = $1', id, JSON.stringify(patch));
                Object.assign(ctx, patch);
                await T.markConsumed(A);
                let crmNote = 'замовлення в CRM ще нема — бракує даних доставки, бот дозбирає їх, коли клієнт напише';
                if (ctx.crmOrderId && !String(ctx.crmOrderId).startsWith('TEST-')) {
                    const pr = await crmFetch(keys, '/payments', { method: 'POST', body: JSON.stringify({ orderId: ctx.crmOrderId, amount: Number(tx.amountUah) || 0, method: 'monobank', status: 'success' }) }, 6000);
                    const pl = await crmFetch(keys, '/pipelines', {}, 4000); let stageId = null;
                    for (const p of (Array.isArray(pl.data) ? pl.data : [])) { const st = (p.stages || []).find((x) => String(x.name || '').trim().toLowerCase() === 'замовлення прийняте'); if (st) { stageId = st.id; break; } }
                    if (stageId) await crmFetch(keys, '/orders/' + ctx.crmOrderId, { method: 'PATCH', body: JSON.stringify({ stageId }) }, 4000);
                    await db.$executeRawUnsafe('update sessions set context = context || $2::jsonb where id = $1', id, JSON.stringify({ crmPaymentPosted: !!pr.ok }));
                    crmNote = 'у CRM: платіж ' + (pr.ok ? 'записано' : 'НЕ записано (' + pr.status + ')') + ', стадія «Замовлення прийняте»' + (ctx.supplierHandled ? '' : ' — оформіть постачальнику');
                }
                await T.alert(A, { title: '💰 Оплату знайдено у виписці — бот позначив «оплачено»', main: (ctx.orderData && ctx.orderData.fullName ? ctx.orderData.fullName + ' · ' : '') + tx.amountUah + ' грн від «' + String(tx.counterName || '—') + '»' + (hit.via.endsWith(':ref') ? ' з кодом ' + ctx.orderRef : ' (збіг за ПІБ і сумою)'), details: crmNote + '.' });
                logger.info('[payRecheck] оплату знайдено', { botId, sessionId: id, via: hit.via, amount: tx.amountUah });
            } catch (e) { logger.warn('[payRecheck] ' + e.message, { sessionId: id }); }
        }
    }
}

const __runsBackground = !process.env.name || process.env.name === 'platform-api';
if (__runsBackground) setTimeout(() => { tick().catch(() => {}); setInterval(() => tick().catch(() => {}), 5 * 60 * 1000).unref(); }, 3 * 60 * 1000).unref();

module.exports = { tick, pickPayment, samePerson };
