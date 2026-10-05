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
const { loadDispatchSource } = require('./orderSource');
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

/** Відбиток того, що піде постачальнику: «Так, оформити» з перегляду, після якого замовлення змінили в CRM, не оформлює наосліп. */
function sourceHash(src) {
    const od = src.orderData || {};
    const key = JSON.stringify({ l: src.lines.map((l) => [l.sku, l.color, l.size, l.qty, l.price]), o: [od.fullName, od.phone, od.city, od.branch] });
    return crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
}
const linesTotal = (lines) => Math.round(lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 1), 0) * 100) / 100;

/** Перегляд: що САМЕ піде постачальникам — позиції й доставка із замовлення CRM (з правками менеджера). */
async function previewText(A, src) {
    const { ctx } = A;
    src = src || await loadDispatchSource(A);
    const groups = await planOrder(A, src.lines);
    const edited = src.order && src.order.managerEditedAt;
    const out = ['<b>📦 Оформити постачальнику?</b>' + (ctx.orderRef ? ' · <code>' + esc(ctx.orderRef) + '</code>' : '')];
    if (edited) out.push('✏️ Змінено менеджером у CRM ' + esc(kyivTime(new Date(edited))));
    if (src.warn) out.push('⚠️ ' + esc(src.warn));
    out.push('');
    if (!groups.length) out.push('⚠️ У замовленні не знайдено жодної позиції — оформіть вручну.');
    // Рядки без кольору/розміру (у товару їх кілька) кнопка не оформить — постачальник узяв би перший варіант (Edit 91843fa8).
    const gaps = groups.flatMap((g) => g.lines).filter((l) => Array.isArray(l.missing) && l.missing.length);
    if (gaps.length) { out.push('⛔ Не вказано ' + gaps.map((l) => esc(String(l.name || l.sku).split('(')[0].trim()) + ' — ' + l.missing.join(' і ')).join('; ') + '. Таке не оформлю — натисніть «✏️ Редагувати», вкажіть і збережіть.'); out.push(''); }
    for (const g of groups) {
        out.push('🏭 <b>' + esc(g.name) + '</b> — ' + esc(MECH_LABEL[g.mechanism] || g.mechanism));
        for (const l of g.lines) out.push('   • ' + esc(l.name) + (l.sku && !String(l.name || '').toUpperCase().includes(String(l.sku).toUpperCase()) ? ' (' + esc(l.sku) + ')' : '') + [l.color, l.size].filter(Boolean).map((x) => ' · ' + esc(x)).join('') + ((l.color || l.size) ? '' : ' · ⚠️ без кольору/розміру') + ' × ' + (Number(l.qty) || 1) + ' — ' + Math.round((Number(l.price) || 0) * (Number(l.qty) || 1)) + ' грн');
    }
    const od = src.orderData || {};
    out.push('');
    out.push('👤 ' + esc(od.fullName || '—') + ' · ' + esc(od.phone || '—'));
    out.push('📍 ' + esc(od.city || '—') + ', НП ' + esc(od.branch || (ctx.np && ctx.np.branch) || '—'));
    const total = linesTotal(src.lines) || Number(ctx.orderTotal) || 0; const pre = Number(ctx.payAmount) || 0;
    if (Number(ctx.orderTotal) && Math.abs(total - Number(ctx.orderTotal)) >= 1) out.push('⚠️ Сума змінилась: було ' + Number(ctx.orderTotal) + ' грн, стало ' + total + ' грн — повідомте клієнта.');
    const method = ctx.paymentInfo && ctx.paymentInfo.method;
    const payLine = method === 'full' || (pre && pre >= total) ? 'повна передоплата ' + (pre || total) + ' грн' : (pre ? 'передоплата ' + pre + ' грн, накладений платіж ' + Math.max(0, total - pre) + ' грн' : 'накладений платіж ' + total + ' грн');
    out.push('💳 ' + payLine + ' · ' + (ctx.payStatus === 'confirmed' ? '✅ оплату у виписці знайдено' : '⚠️ оплату у виписці НЕ знайдено — оформлюйте, лише якщо перевірили оплату самі'));
    if (groups.length > 1) out.push('📮 ' + groups.length + ' окремі посилки (різні постачальники).');
    out.push('');
    out.push('Кнопка оформлює саме те, що вище. Щось не так — «✏️ Редагувати» (картка в CRM), збережіть і натисніть «📦 Оформити постачальнику» ще раз.');
    return { text: out.join('\n'), hash: sourceHash(src), src };
}
function previewKeyboard(A, sessionId, hash) {
    const { crmOrderEditUrl } = require('./policy');
    return { inline_keyboard: [[{ text: '✅ Так, оформити', callback_data: 'sy:' + sessionId + ':' + hash }, { text: '✖️ Скасувати', callback_data: 'sb:' + sessionId }], [{ text: '✏️ Редагувати замовлення', url: crmOrderEditUrl(A.keys, A.ctx.crmOrderId) }]] };
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
    if (ctx.supplierHandled && !/manual_disabled|incomplete|error/.test(String(ctx.supplierOrderStatus || ''))) return 'Постачальнику вже оформлено автоматично (' + String(ctx.supplierOrderStatus || '') + ').';
    return null;
}

async function handleAdminCallback({ secret, cq }) {
    const m = /^(so|sy|sb|sd):([0-9a-f-]{36})(?::([0-9a-f]{10}))?$/.exec(String((cq && cq.data) || ''));
    if (!m) return;
    const [, action, sessionId, seenHash] = m;
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
        const p = await previewText(A);
        await tg(tok, 'sendMessage', { chat_id: chatId, text: p.text, parse_mode: 'HTML', disable_web_page_preview: true, reply_to_message_id: msgId, allow_sending_without_reply: true, reply_markup: previewKeyboard(A, sessionId, p.hash) });
        return;
    }

    // Перегляд застарів (замовлення змінили в CRM після нього) — показуємо свіжий замість оформлення наосліп.
    const fresh = await previewText(A);
    if (fresh.hash !== seenHash) {
        await answer('Замовлення змінилось після перевірки — перевірте ще раз', true);
        await tg(tok, 'editMessageText', { chat_id: chatId, message_id: msgId, text: '🔄 Оновлено після змін у CRM\n' + fresh.text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: previewKeyboard(A, sessionId, fresh.hash) });
        return;
    }
    const src = fresh.src;

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
        // Доставка й сума — як у CRM (менеджер міг виправити): постачальнику, а також памʼяті розмови (подальші повідомлення клієнту).
        const prevOd = ctx.orderData || {};
        if (src.fromCrm) {
            if (String(prevOd.city || '') !== String(src.orderData.city || '') || String(prevOd.branch || '') !== String(src.orderData.branch || '')) delete ctx.np; // довідка НП застаріла
            ctx.orderData = src.orderData;
            const t = linesTotal(src.lines); if (t > 0) ctx.orderTotal = t;
        }
        const { runSupplierDispatch } = require('./policy');
        const dispatch = await runSupplierDispatch(A, { force: true, silent: true, lines: src.lines });
        const by = whoPressed(cq.from);
        const anyManual = dispatch.groups.some((g) => g.needsManual);
        // Нічого не пішло, бо в замовленні не вказано колір/розмір (missingVariant) — це не «оформлено»: менеджер виправляє
        // замовлення в CRM і натискає кнопку ще раз (кнопки під сповіщенням лишаються).
        // Жодна група не пішла постачальнику (incomplete, мережевий збій, помилка brewdrop) — це НЕ «оформлено»: не ставимо
        // managerDispatch (інакше повторне натискання каже «Вже оформлено»), показуємо причину й лишаємо кнопку (05.10: GOVTUXUZ2I9).
        if (dispatch.groups.length && dispatch.groups.every((g) => g.needsManual)) {
            await saveCtxDiff(sessionId, before, ctx);
            const onlyIncomplete = dispatch.groups.every((g) => g.status === 'incomplete');
            const msg = ['<b>⛔ Не оформлено</b>' + (ctx.orderRef ? ' · <code>' + esc(ctx.orderRef) + '</code>' : ''), ''].concat(dispatch.groups.map((g) => '<b>' + esc(g.supplier) + '</b>: ' + esc(String(g.result || g.status || '').slice(0, 600))), ['', onlyIncomplete ? 'Натисніть «✏️ Редагувати», вкажіть колір/розмір, збережіть і натисніть «📦 Оформити постачальнику» ще раз.' : 'Постачальнику НІЧОГО не відправлено. Виправте причину (за потреби — «✏️ Редагувати») і натисніть «📦 Оформити постачальнику» ще раз або оформіть вручну.']);
            await tg(tok, 'editMessageText', { chat_id: chatId, message_id: msgId, text: msg.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true });
            return;
        }
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
