'use strict';
/**
 * shopAgent/managerActions.js — кнопки під сповіщеннями менеджерам у Telegram.
 *
 * НАВІЩО (власник, 2026-10-02): поки автооформлення постачальнику вимкнено (ключ воронки
 * SUPPLIER_ORDERS_DISABLED=1), замовлення висіло з приміткою «оформити вручну», і менеджер мусив
 * сам переносити дані в BrewDrop/EasyDrop. Тепер під «НОВЕ ЗАМОВЛЕННЯ» (і під «оформіть вручну» після
 * оплати) є кнопка «📦 Оформити постачальнику»: менеджер перевіряє замовлення → кнопка показує, що САМЕ
 * піде постачальнику (позиції, отримувач, оплата) → «✅ Так, оформити» викликає той самий dispatchOrder,
 * що й автооформлення (force — оминає вимикач лише для цього замовлення).
 *
 * Натискання приходять вебхуком бота сповіщень (TELEGRAM_BOT_TOKEN воронки) на /webhook/admin-tg.
 * Справжність — секрет вебхука, похідний від токена; доступ — лише з чату ADMIN_TELEGRAM_ID воронки.
 * callback_data: so:<sessionId> — попередній перегляд, sy: — підтвердити, sb: — скасувати, sd: — уже оформлено.
 */
const crypto = require('crypto');
const { db, logger, loadAssets, cleanJsonDeep } = require('./lib');
const { planOrder } = require('./supplierDispatch');
const { redisClient } = require('../../lib/sessionStore');

function webhookSecret(tok) { return crypto.createHash('sha256').update('admin-tg:' + String(tok || '')).digest('hex').slice(0, 48); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function kyivTime(d = new Date()) { return d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function whoPressed(from) { return [from && from.first_name, from && from.last_name].filter(Boolean).join(' ') || (from && from.username ? '@' + from.username : 'менеджер'); }

async function tg(tok, method, body) {
    try {
        const r = await fetch('https://api.telegram.org/bot' + tok + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return await r.json().catch(() => ({}));
    } catch (e) { return { ok: false, description: e.message }; }
}

const MECH_LABEL = { brewdrop: 'автоматично через API BrewDrop', easydrop_offline: 'автоматично через форму EasyDrop', easydrop_cart: 'автоматично через кошик EasyDrop', manual: 'механізм не налаштований — лишиться вручну' };

/** Текст попереднього перегляду: що САМЕ піде постачальникам. */
async function previewText(A) {
    const { ctx } = A;
    const groups = await planOrder(A);
    const out = ['<b>📦 Оформити постачальнику?</b>' + (ctx.orderRef ? ' · <code>' + esc(ctx.orderRef) + '</code>' : ''), ''];
    if (!groups.length) out.push('⚠️ У замовленні не знайдено жодної позиції з артикулом — оформіть вручну.');
    for (const g of groups) {
        out.push('🏭 <b>' + esc(g.name) + '</b> — ' + esc(MECH_LABEL[g.mechanism] || g.mechanism));
        for (const l of g.lines) out.push('   • ' + esc(l.name) + (l.sku ? ' (' + esc(l.sku) + ')' : '') + [l.color, l.size].filter(Boolean).map((x) => ' · ' + esc(x)).join('') + ' × ' + (Number(l.qty) || 1) + ' — ' + Math.round((Number(l.price) || 0) * (Number(l.qty) || 1)) + ' грн');
    }
    const od = ctx.orderData || {};
    out.push('');
    out.push('👤 ' + esc(od.fullName || '—') + ' · ' + esc(od.phone || '—'));
    out.push('📍 ' + esc(od.city || '—') + ', НП ' + esc(od.branch || (ctx.np && ctx.np.branch) || '—'));
    const total = Number(ctx.orderTotal) || 0; const pre = Number(ctx.payAmount) || 0;
    const method = ctx.paymentInfo && ctx.paymentInfo.method;
    const payLine = method === 'full' || (pre && pre >= total) ? 'повна передоплата ' + (pre || total) + ' грн' : (pre ? 'передоплата ' + pre + ' грн, накладений платіж ' + Math.max(0, total - pre) + ' грн' : 'накладений платіж ' + total + ' грн');
    out.push('💳 ' + payLine + ' · ' + (ctx.payStatus === 'confirmed' ? '✅ оплату у виписці знайдено' : '⚠️ оплату у виписці НЕ знайдено — оформлюйте, лише якщо перевірили оплату самі'));
    if (groups.length > 1) out.push('📮 ' + groups.length + ' окремі посилки (різні постачальники).');
    out.push('');
    out.push('Щоб змінити позиції чи дані — виправте до натискання (кнопка оформлює саме те, що вище).');
    return out.join('\n');
}

/** Зберігає лише змінені цим обробником поля поверх СВІЖОГО контексту (клієнт міг написати, поки йшло оформлення). */
async function saveCtxDiff(sessionId, before, ctx) {
    const s = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
    const fresh = { ...((s && s.context) || {}) };
    for (const k of Object.keys(ctx)) if (k !== 'agent' && JSON.stringify(ctx[k]) !== before.top[k]) fresh[k] = ctx[k];
    const ag = { ...(fresh.agent || {}) };
    for (const k of Object.keys(ctx.agent || {})) if (JSON.stringify(ctx.agent[k]) !== before.agent[k]) ag[k] = ctx.agent[k];
    fresh.agent = ag;
    await db.session.update({ where: { id: sessionId }, data: { context: cleanJsonDeep(fresh) } });
}
function snapshot(ctx) {
    const top = {}; for (const k of Object.keys(ctx)) if (k !== 'agent') top[k] = JSON.stringify(ctx[k]);
    const agent = {}; for (const k of Object.keys(ctx.agent || {})) agent[k] = JSON.stringify(ctx.agent[k]);
    return { top, agent };
}

/** Чому кнопку зараз натискати не можна (або null). */
function blockedReason(session, ctx) {
    if (session.isTest || ctx.testMode) return 'Це тестова сесія — постачальнику не оформлюємо.';
    if (!ctx.crmOrderId || String(ctx.crmOrderId).startsWith('TEST-')) return 'Замовлення ще не створене в CRM.';
    if (ctx.managerDispatch) return 'Вже оформлено: ' + (ctx.managerDispatch.by || 'менеджер') + ', ' + (ctx.managerDispatch.atText || '') + '.';
    if (ctx.supplierHandled && !/manual_disabled/.test(String(ctx.supplierOrderStatus || ''))) return 'Постачальнику вже оформлено автоматично (' + String(ctx.supplierOrderStatus || '') + ').';
    return null;
}

async function handleAdminCallback({ secret, cq }) {
    const m = /^(so|sy|sb|sd):([0-9a-f-]{36})$/.exec(String((cq && cq.data) || ''));
    if (!m) return;
    const [, action, sessionId] = m;
    const session = await db.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session) return;
    const assets = await loadAssets(session.botId);
    const keys = assets.keys; const tok = String(keys.TELEGRAM_BOT_TOKEN || '');
    if (!tok || secret !== webhookSecret(tok)) { logger.warn('[managerActions] bad webhook secret', { sessionId }); return; }
    const answer = (text, alert = false) => tg(tok, 'answerCallbackQuery', { callback_query_id: cq.id, text: String(text || '').slice(0, 190), show_alert: alert });
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    if (String(chatId) !== String(keys.ADMIN_TELEGRAM_ID || '')) { await answer('Немає доступу.', true); return; }
    const msgId = cq.message.message_id;
    const ctx = session.context || {};
    ctx.agent = ctx.agent || {};
    const A = { botId: session.botId, session, ctx, keys, assets, user: session.user ? { id: session.user.id, firstName: session.user.firstName, username: session.user.username } : {}, trace: [], out: [] };

    if (action === 'sd') { await answer(blockedReason(session, ctx) || 'Оформлено.', true); return; }
    if (action === 'sb') { await answer('Скасовано — нічого не відправлено.'); await tg(tok, 'deleteMessage', { chat_id: chatId, message_id: msgId }); return; }

    const blocked = blockedReason(session, ctx);
    if (blocked) {
        await answer(blocked, true);
        if (ctx.managerDispatch) await tg(tok, 'editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: '✅ Оформлено постачальнику', callback_data: 'sd:' + sessionId }]] } });
        return;
    }

    if (action === 'so') {
        await answer('Перевірте, що піде постачальнику');
        const text = await previewText(A);
        await tg(tok, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_to_message_id: msgId, allow_sending_without_reply: true, reply_markup: { inline_keyboard: [[{ text: '✅ Так, оформити', callback_data: 'sy:' + sessionId }, { text: '✖️ Скасувати', callback_data: 'sb:' + sessionId }]] } });
        return;
    }

    // sy — оформлюємо. Замок від подвійного натискання (двоє менеджерів / подвійний тап).
    const lockKey = 'mgr-supplier:' + sessionId;
    let locked = 'OK';
    try { locked = await redisClient.set(lockKey, String(cq.from && cq.from.id), { NX: true, EX: 600 }); } catch (e) { /* redis недоступний — покладаємось на managerDispatch */ }
    if (!locked) { await answer('Вже оформлюється іншим натисканням…', true); return; }
    const origMsgId = cq.message.reply_to_message && cq.message.reply_to_message.message_id;
    try {
        await answer('Оформлюю…');
        await tg(tok, 'editMessageText', { chat_id: chatId, message_id: msgId, text: '⏳ Оформлюю постачальнику…', parse_mode: 'HTML' });
        const before = snapshot(ctx);
        const { runSupplierDispatch } = require('./policy');
        const dispatch = await runSupplierDispatch(A, { force: true, silent: true });
        const by = whoPressed(cq.from);
        const anyManual = dispatch.groups.some((g) => g.needsManual);
        ctx.managerDispatch = { at: new Date().toISOString(), atText: kyivTime(), by, tgUserId: cq.from && cq.from.id, status: ctx.supplierOrderStatus };
        await saveCtxDiff(sessionId, before, ctx);
        logger.info('[managerActions] supplier dispatch by manager', { sessionId, by, status: ctx.supplierOrderStatus });
        const lines = [(anyManual ? '<b>⚠️ Оформлено частково</b>' : '<b>✅ Оформлено постачальнику</b>') + (ctx.orderRef ? ' · <code>' + esc(ctx.orderRef) + '</code>' : ''), esc(by) + ', ' + esc(ctx.managerDispatch.atText), ''];
        if (!dispatch.groups.length) lines.push('⚠️ Позицій для постачальника не знайдено — оформіть вручну.');
        for (const g of dispatch.groups) {
            lines.push((g.needsManual ? '⚠️ ' : '✅ ') + '<b>' + esc(g.supplier) + '</b>: ' + esc(g.needsManual ? 'не оформилось — оформіть вручну' : 'оформлено') + (g.ttn ? ' · ТТН ' + esc(g.ttn) : '') + (g.id ? ' · № ' + esc(g.id) : ''));
            if (g.result) lines.push('   ' + esc(String(g.result).slice(0, 600)));
        }
        await tg(tok, 'editMessageText', { chat_id: chatId, message_id: msgId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true });
        if (origMsgId) await tg(tok, 'editMessageReplyMarkup', { chat_id: chatId, message_id: origMsgId, reply_markup: { inline_keyboard: [[{ text: anyManual ? '⚠️ Оформлено частково' : '✅ Оформлено постачальнику', callback_data: 'sd:' + sessionId }]] } });
    } catch (e) {
        logger.error('[managerActions] supplier dispatch failed', { sessionId, error: e.message });
        await tg(tok, 'editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Не вдалося оформити: ' + esc(e.message).slice(0, 300) + '\nСпробуйте ще раз кнопкою під замовленням або оформіть вручну.', parse_mode: 'HTML' });
    } finally {
        try { await redisClient.del(lockKey); } catch (e) { /* ignore */ }
    }
}

module.exports = { handleAdminCallback, webhookSecret, previewText };
