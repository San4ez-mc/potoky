'use strict';

/**
 * zernioHandler.js — транспорт IG-воронки через Zernio (Meta Tech Provider), без App Review.
 * Реальна структура вебхука Zernio ПЛОСКА (top-level): { id, event, message?, conversation?,
 * account?, reaction?, comment?, editHistory?, statusAt?, error?, timestamp }.
 * (Ранній клієнтський приклад із data.* — спрощений; тут підтримуємо і його як фолбек.)
 *
 * Статуси (delivered/read/failed) і реакції кріпляться до КОНКРЕТНОГО повідомлення
 * (по zernioMessageId / platformMessageId) — як у месенджерах.
 */

const crypto = require('crypto');
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { executeFlowStep } = require('./testSession');
const { isBlockedByTestMode, isTestModeOn } = require('./testModeGate');

async function getZernioKeys(botId) {
    const keys = await db.funnelKey.findMany({
        where: { botId, key: { in: ['ZERNIO_API_TOKEN', 'ZERNIO_ACCOUNT_ID', 'ZERNIO_SEND_URL'] } },
        select: { key: true, value: true },
    });
    return Object.fromEntries(keys.map((k) => [k.key, (k.value || '').trim()]));
}
function isReal(v) { return typeof v === 'string' && v.length > 3 && v !== 'REPLACE_ME'; }
// Власні ідентифікатори (бізнес-акаунт, Zernio-акаунт) — щоб не плодити сесії на самих себе.
async function getSelfIds(botId) {
    const rows = await db.funnelKey.findMany({ where: { botId, key: { in: ['INSTAGRAM_BUSINESS_ID', 'ZERNIO_ACCOUNT_ID', 'INSTAGRAM_BUSINESS_ACCOUNT_ID'] } }, select: { value: true } });
    return new Set(rows.map((r) => (r.value || '').trim()).filter(Boolean));
}
async function sendTelegramAlert(botId, text, sessionId) {
    const rows = await db.funnelKey.findMany({ where: { botId, key: { in: ['TELEGRAM_BOT_TOKEN', 'ADMIN_TELEGRAM_ID', 'SHOP_TAG'] } }, select: { key: true, value: true } });
    const m = Object.fromEntries(rows.map((r) => [r.key, (r.value || '').trim()]));
    // Назва магазину в кожному сповіщенні — воронка дублюється на різні магазини.
    const shop = m.SHOP_TAG || '';
    const body = (shop ? '🏪 ' + shop + '\n' : '') + text;
    if (!m.TELEGRAM_BOT_TOKEN || m.TELEGRAM_BOT_TOKEN === 'REPLACE_ME' || !m.ADMIN_TELEGRAM_ID || m.ADMIN_TELEGRAM_ID === 'REPLACE_ME') {
        await logDelivery(sessionId, botId, 'telegram_alert', false, 'немає TELEGRAM_BOT_TOKEN або ADMIN_TELEGRAM_ID', { chatId: m.ADMIN_TELEGRAM_ID || null });
        return false;
    }
    try {
        const r = await fetch('https://api.telegram.org/bot' + m.TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: m.ADMIN_TELEGRAM_ID, text: body }) });
        const d = await r.json().catch(() => ({}));
        await logDelivery(sessionId, botId, 'telegram_alert', !!d.ok, d.ok ? null : (d.description || ('HTTP ' + r.status)), { chatId: m.ADMIN_TELEGRAM_ID, messageId: d?.result?.message_id || null, text: String(body).slice(0, 200) });
        return !!d.ok;
    } catch (e) {
        logger.warn('[zernioHandler] TG alert: ' + e.message);
        await logDelivery(sessionId, botId, 'telegram_alert', false, e.message, { chatId: m.ADMIN_TELEGRAM_ID });
        return false;
    }
}

// Лог доставки у сесію (runtime.deliveryLog) — щоб «чому не прийшло» було видно у вкладці Ноди.
// Кап на 100 записів; старіші за DELIVERY_LOG_TTL_DAYS (14) відсікаються.
const DELIVERY_LOG_MAX = 100;
const DELIVERY_LOG_TTL_DAYS = 14;
async function logDelivery(sessionId, botId, channel, ok, error, extra) {
    if (!sessionId) return;
    try {
        const s = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
        if (!s) return;
        const ctx = s.context || {};
        const rt = ctx.flowRuntime || {};
        const cutoff = Date.now() - DELIVERY_LOG_TTL_DAYS * 86400000;
        const prev = (Array.isArray(rt.deliveryLog) ? rt.deliveryLog : []).filter((e) => !e.ts || new Date(e.ts).getTime() > cutoff);
        prev.push({ ts: new Date().toISOString(), channel, ok: !!ok, ...(error ? { error: String(error).slice(0, 300) } : {}), ...(extra || {}) });
        rt.deliveryLog = prev.slice(-DELIVERY_LOG_MAX);
        await db.session.update({ where: { id: sessionId }, data: { context: { ...ctx, flowRuntime: rt } } });
    } catch (_e) { /* лог не має ламати основний потік */ }
}
function synthIdFromPsid(psid) {
    const hex = crypto.createHash('sha256').update('zernio:' + String(psid)).digest('hex').slice(0, 15);
    return BigInt('0x' + hex);
}

// Спільні поля з плоского payload (з фолбеками на різні можливі назви).
function extractCommon(body) {
    const conv = body.conversation || {};
    const contact = conv.contact || conv.participant || {};
    const msg = body.message || body.data || {};
    const conversationId = conv.id || conv.conversationId || body?.data?.conversationId || null;
    const contactId = contact.id || contact.platformId || contact.psid
        || msg.from?.id || msg.sender?.id || body?.data?.sender?.id || null;
    const contactName = contact.name || contact.displayName || contact.username
        || msg.from?.name || msg.sender?.name || body?.data?.sender?.name || null;
    const contactUsername = conv.participantUsername || conv.participantUserName || contact.username || contact.handle || (msg.from && msg.from.username) || null;
    return { conv, contact, msg, conversationId, contactId, contactName, contactUsername };
}

// Кеш INSTAGRAM_USERNAME per botId — уникнути зайвого SELECT на КОЖЕН вхідний
// webhook (гарячий шлях, викликається на кожне message.received).
const _igUsernameCache = new Map();
async function getOwnInstagramUsername(botId) {
    if (_igUsernameCache.has(botId)) return _igUsernameCache.get(botId);
    const row = await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_USERNAME' }, select: { value: true } }).catch(() => null);
    const v = String((row && row.value) || '').trim().toLowerCase();
    _igUsernameCache.set(botId, v);
    return v;
}

async function findOrCreateZernioUser(psid, botId, name) {
    // Аудит 2026-08-30 (живий кейс, сесія covercar_ua cd3f0a27 — контент і артикул
    // ІНШОГО магазину, goverla_shop A0068, просочився у сесію covercar_ua): раніше
    // psid матчився ГЛОБАЛЬНО, без botId, — усі боти платформи (обидва в тому ж
    // projectId, тож projectId теж не рятує) ділили ОДИН user-запис на один psid.
    // Якщо той самий числовий psid коли-небудь прилітає для ДВОХ різних ботів
    // (Zernio inbox-sync, квірк Meta ID тощо — причина на боці вендора, поза нашим
    // контролем) — user, а з ним і сесія/каталог, змішувались між магазинами.
    // Захист: якщо кандидат-user з таким psid УЖЕ має сесію під ІНШИМ ботом — це
    // для НАШОЇ мети вже не той самий контакт, заводимо йому окремий user саме під
    // (psid, botId). Легасі-користувачі без цього конфлікту (переважна більшість —
    // включно з реальними тестерами) поводяться як раніше, історія не рветься.
    const candidates = await db.user.findMany({ where: { metadata: { path: ['psid'], equals: String(psid) } } });
    let existing = candidates.find((u) => u.metadata && u.metadata.zernioBotId === botId) || null;
    if (!existing) {
        for (const u of candidates) {
            if (u.metadata && u.metadata.zernioBotId && u.metadata.zernioBotId !== botId) continue;
            const crossBotSession = await db.session.findFirst({ where: { userId: u.id, botId: { not: botId } }, select: { id: true, botId: true } });
            if (!crossBotSession) { existing = u; break; }
            logger.warn('[zernioHandler] psid вже має сесію під ІНШИМ ботом — не змішую каталоги, заводжу окремого user', {
                psid: String(psid), botId, otherBotId: crossBotSession.botId, existingUserId: u.id,
            });
        }
    }
    if (existing) {
        const needsPatch = (name && existing.firstName !== name) || (existing.metadata && existing.metadata.zernioBotId !== botId);
        if (needsPatch) {
            await db.user.update({
                where: { id: existing.id },
                data: { firstName: name || existing.firstName, metadata: { ...existing.metadata, zernioBotId: botId } },
            }).catch(() => {});
        }
        return existing;
    }
    const bot = await db.bot.findUnique({ where: { id: botId }, select: { projectId: true } });
    let tid = synthIdFromPsid(psid);
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            return await db.user.create({
                data: {
                    telegramId: tid, firstName: name || 'Instagram',
                    username: 'ig_' + String(psid).replace(/[^0-9a-zA-Z]/g, '').slice(-6),
                    languageCode: 'uk', projectId: bot?.projectId,
                    metadata: { source: 'zernio', channel: 'zernio', psid: String(psid), zernioBotId: botId },
                },
            });
        } catch (e) { if (e.code === 'P2002') { tid = tid + 1n; continue; } throw e; }
    }
    throw new Error('Не вдалося створити zernio-користувача (колізії telegramId).');
}

async function findOrCreateZernioSession(userId, botId, patch = {}) {
    const existing = await db.session.findFirst({ where: { userId, botId }, orderBy: { startedAt: 'desc' } });
    if (existing) {
        const ctx = existing.context || {};
        const next = { ...ctx, channel: 'zernio' };
        for (const [k, v] of Object.entries(patch)) if (v != null) next[k] = v;
        const data = { context: next, lastActive: new Date() };
        if (!existing.isActive) { data.isActive = true; data.completedAt = null; if (existing.state === 'completed') data.state = 'inbox'; }
        return db.session.update({ where: { id: existing.id }, data });
    }
    const flowDef = await db.flowDefinition.findUnique({ where: { botId } });
    const nodes = Array.isArray(flowDef?.nodes) ? flowDef.nodes : [];
    const startNode = nodes.find((n) => n.type === 'start') || nodes[0] || null;
    return db.session.create({
        data: {
            userId, botId, state: startNode?.id || 'start',
            context: {
                channel: 'zernio', ...patch, currentNode: startNode?.id || null,
                flowRuntime: { currentNodeId: startNode?.id || null, waitingForUser: false, nodesVisited: [], lastUserMessage: '', dialogHistory: {} },
            },
        },
    });
}
async function findSessionByConversation(botId, conversationId) {
    if (!conversationId) return null;
    return db.session.findFirst({ where: { botId, context: { path: ['conversationId'], equals: String(conversationId) } }, orderBy: { startedAt: 'desc' } });
}

// Знайти наше збережене повідомлення за id повідомлення Zernio (для статусів/реакцій/редагувань).
async function findMessageByZid(sessionId, zernioMessageId, platformMessageId) {
    if (zernioMessageId) {
        const m = await db.message.findFirst({ where: { sessionId, metadata: { path: ['zernioMessageId'], equals: String(zernioMessageId) } } });
        if (m) return m;
    }
    if (platformMessageId) {
        const m = await db.message.findFirst({ where: { sessionId, metadata: { path: ['platformMessageId'], equals: String(platformMessageId) } } });
        if (m) return m;
    }
    return null;
}

// ── Вихід ──────────────────────────────────────────────────────────────────
// Аудит 2026-08-30 (розслідування "коментар → DM не дійшов"): sendZernioMessage
// і postZernioCommentReply писали статус ЛИШЕ в per-сесійний flowRuntime.deliveryLog
// (logDelivery нижче) — жодного рядка в db.apiCall (таблиця "api_calls", вкладка
// «API» у сесії й ОСНОВНЕ місце, де за стандартом проєкту мають бути ВСІ зовнішні
// виклики, §0 Правило 5). Наслідок: неможливо було запитати "покажи всі невдалі
// DM за останні 5 днів" — SELECT по service='zernio' повертав 0 рядків, хоча
// реальні виклики (успішні й ні) відбувались щохвилини. Тепер кожен виклик
// Zernio/Meta Send API логується в api_calls (statusCode, тривалість, сирі
// requestData/responseData) — окремо від deliveryLog, який лишається для
// людського перегляду в конкретній сесії.
// 2026-09-08 17:06 (лог: «unexpected end of hex escape» у prisma.message.create / apiCall.create): обрізання рядків
// (.slice(0, N)) розриває пару сурогатів емодзі → самотній сурогат → JSON для Postgres невалідний → вхідне повідомлення
// НЕ зберігалось. Чистимо всі рядки в даних перед записом (самотні сурогати + \u0000).
function cleanJsonDeep(v) {
    if (typeof v === 'string') return v.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1').replace(/\u0000/g, '');
    if (Array.isArray(v)) return v.map(cleanJsonDeep);
    if (v && typeof v === 'object' && !(v instanceof Date)) { const o = {}; for (const k of Object.keys(v)) o[k] = cleanJsonDeep(v[k]); return o; }
    return v;
}
async function logZernioApiCall(sessionId, method, requestData, responseData, statusCode, startedAt) {
    try {
        requestData = cleanJsonDeep(requestData); responseData = cleanJsonDeep(responseData);
        await db.apiCall.create({
            data: {
                sessionId: sessionId || null, service: 'zernio', method,
                requestData: requestData || {}, responseData: responseData || {},
                statusCode: statusCode == null ? null : statusCode, durationMs: Date.now() - startedAt,
            },
        });
    } catch (e) { logger.warn('[zernioHandler] logZernioApiCall failed: ' + e.message); }
}

async function sendZernioMessage(botId, conversationId, text, opts = {}) {
    const km = await getZernioKeys(botId);
    if (!isReal(km.ZERNIO_API_TOKEN)) throw new Error('ZERNIO_API_TOKEN ще не налаштований у ключах воронки.');
    if (!isReal(km.ZERNIO_ACCOUNT_ID)) throw new Error('ZERNIO_ACCOUNT_ID ще не налаштований у ключах воронки.');
    if (conversationId) {
        const tmpl = km.ZERNIO_SEND_URL || 'https://zernio.com/api/v1/inbox/conversations/{conversationId}/messages';
        const url = tmpl.replace('{conversationId}', encodeURIComponent(conversationId));
        const _t0 = Date.now();
        // 2026-09-09 (34 відмови HTTP 429 за ранок, 26 розмов — повідомлення клієнтам не доходили): ліміт Zernio Send API →
        // повторюємо до 4 разів із паузою 1.5 / 3 / 6 / 10 с; інші помилки не повторюємо.
        let res, data;
        for (let attempt = 0; attempt < 5; attempt++) {
            res = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${km.ZERNIO_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: km.ZERNIO_ACCOUNT_ID, message: String(text || '') }),
            });
            data = await res.json().catch(() => ({}));
            if (res.status !== 429 || attempt === 4) break;
            await new Promise((r) => setTimeout(r, [1500, 3000, 6000, 10000][attempt]));
        }
        await logZernioApiCall(opts.sessionId, 'send_message', { conversationId, text: String(text || '').slice(0, 300) }, data, res.status, _t0);
        if (!res.ok || data.error) {
            const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
            logger.warn('[zernioHandler] Send error', { botId, status: res.status, error: msg });
            throw new Error(`Zernio Send API: ${msg}`);
        }
        // Реальна форма відповіді Zernio: {"success":true,"data":{"messageId":"...","conversationId":"..."}}
        // (перевірено live-запитом 2026-08-19) — id лежить у data.data.messageId, а НЕ на
        // верхньому рівні. Через це кожна УСПІШНА відправка логувалась як "не повернув id"
        // (deliveryLog показував ok:false для реально доставлених повідомлень).
        return data.data?.messageId || data.data?.id || data.id || data.messageId || data.message?.id || null;
    }
    // Немає conversationId — клієнт лише ЗАЛИШИВ КОМЕНТАР, ще не писав нам у директ.
    // Аудит 2026-08-27: перший здогад (Zernio-обгортка /v1/inbox/messages) дав живий
    // HTTP 404 — шлях не існує. Перемкнувся на ПРЯМИЙ виклик Meta Graph API (той самий
    // endpoint /me/messages, що вже перевірено робочим у sendMetaPhoto нижче, з
    // INSTAGRAM_ACCESS_TOKEN) — офіційна фіча Meta "Private Replies": той самий
    // /me/messages, але recipient:{comment_id} замість recipient:{id}.
    if (opts.commentId) {
        const igKey = await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_ACCESS_TOKEN' }, select: { value: true } });
        const igToken = (igKey?.value || '').trim();
        if (!igToken || igToken === 'REPLACE_ME') throw new Error('немає INSTAGRAM_ACCESS_TOKEN для приватної відповіді на коментар.');
        const _t0b = Date.now();
        const res = await fetch(`https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(igToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: { comment_id: opts.commentId }, message: { text: String(text || '') } }),
        });
        const data = await res.json().catch(() => ({}));
        await logZernioApiCall(opts.sessionId, 'private_reply', { commentId: opts.commentId, text: String(text || '').slice(0, 300) }, data, res.status, _t0b);
        if (!res.ok || data.error) {
            const msg = data?.error?.message || `HTTP ${res.status}`;
            logger.warn('[zernioHandler] Private reply (Meta direct) error', { botId, status: res.status, error: msg, commentId: opts.commentId });
            throw new Error(`Meta Private Reply API: ${msg}`);
        }
        return data.message_id || data.id || null;
    }
    throw new Error('Немає ні conversationId, ні commentId — неможливо надіслати повідомлення через Zernio.');
}

// Публічна відповідь ПІД коментарем (видима всім, на відміну від private reply
// вище) — підтверджено кількома джерелами документації Zernio: POST на
// /v1/inbox/comments/{postId} з {accountId, commentId, message}. postId тут —
// mediaId допису, під яким лишили коментар.
async function postZernioCommentReply(botId, commentId, text, mediaId, sessionId) {
    const km = await getZernioKeys(botId);
    if (!isReal(km.ZERNIO_API_TOKEN)) throw new Error('ZERNIO_API_TOKEN ще не налаштований у ключах воронки.');
    if (!isReal(km.ZERNIO_ACCOUNT_ID)) throw new Error('ZERNIO_ACCOUNT_ID ще не налаштований у ключах воронки.');
    const postSegment = encodeURIComponent(mediaId || commentId);
    const url = `https://zernio.com/api/v1/inbox/comments/${postSegment}`;
    const _t0c = Date.now();
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${km.ZERNIO_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: km.ZERNIO_ACCOUNT_ID, commentId, message: String(text || '') }),
    });
    const data = await res.json().catch(() => ({}));
    await logZernioApiCall(sessionId, 'comment_reply', { commentId, mediaId, text: String(text || '').slice(0, 300) }, data, res.status, _t0c);
    if (!res.ok || data.error) {
        const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
        logger.warn('[zernioHandler] Comment reply error', { botId, status: res.status, error: msg, commentId });
        throw new Error(`Zernio Comment Reply API: ${msg}`);
    }
    return data.data?.id || data.id || data.data?.commentId || null;
}

// Фото через Meta-direct: Zernio-send текстовий, тож зображення шлемо напряму в Meta
// (psid із Zernio-вебхука = реальний Meta IGSID). imageUrl — публічний http-URL.
async function sendMetaPhoto(botId, igsid, imageUrl) {
    if (!igsid) throw new Error('немає IGSID отримувача');
    const km = await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_ACCESS_TOKEN' }, select: { value: true } });
    const token = (km?.value || '').trim();
    if (!token || token === 'REPLACE_ME') throw new Error('немає INSTAGRAM_ACCESS_TOKEN для Meta-фото');
    // Завантажуємо байти й вантажимо у Meta → attachment_id (URL-метод у Meta нестабільний — «Upload failed»).
    const ir = await fetch(String(imageUrl));
    if (!ir.ok) throw new Error('не завантажилось зображення: HTTP ' + ir.status);
    const buf = Buffer.from(await ir.arrayBuffer());
    const ct = ir.headers.get('content-type') || 'image/jpeg';
    const fd = new FormData();
    fd.append('access_token', token);
    fd.append('message', JSON.stringify({ attachment: { type: 'image', payload: { is_reusable: true } } }));
    fd.append('filedata', new Blob([buf], { type: ct }), 'photo.jpg');
    const ur = await fetch('https://graph.instagram.com/v21.0/me/message_attachments', { method: 'POST', body: fd });
    const ud = await ur.json().catch(() => ({}));
    if (!ur.ok || !ud.attachment_id) throw new Error(ud?.error?.message || ('upload HTTP ' + ur.status));
    const sr = await fetch(`https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: String(igsid) }, message: { attachment: { type: 'image', payload: { attachment_id: ud.attachment_id } } } }),
    });
    const sd = await sr.json().catch(() => ({}));
    if (!sr.ok || sd.error) throw new Error(sd?.error?.message || `HTTP ${sr.status}`);
    return sd.message_id || null;
}

// Альбом: IG приймає до 10 attachment-обʼєктів в ОДНОМУ повідомленні (message.attachments[]).
// Вантажимо кожне фото у Meta (attachment_id) і шлемо одним повідомленням.
async function sendMetaPhotoAlbum(botId, igsid, imageUrls) {
    const urls = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean).slice(0, 10);
    if (!urls.length) return null;
    if (urls.length === 1) return sendMetaPhoto(botId, igsid, urls[0]);
    if (!igsid) throw new Error('немає IGSID отримувача');
    const km = await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_ACCESS_TOKEN' }, select: { value: true } });
    const token = (km?.value || '').trim();
    if (!token || token === 'REPLACE_ME') throw new Error('немає INSTAGRAM_ACCESS_TOKEN для Meta-фото');
    const ids = [];
    for (const u of urls) {
        try {
            const ir = await fetch(String(u));
            if (!ir.ok) continue;
            const buf = Buffer.from(await ir.arrayBuffer());
            const ct = ir.headers.get('content-type') || 'image/jpeg';
            const fd = new FormData();
            fd.append('access_token', token);
            fd.append('message', JSON.stringify({ attachment: { type: 'image', payload: { is_reusable: true } } }));
            fd.append('filedata', new Blob([buf], { type: ct }), 'photo.jpg');
            const ur = await fetch('https://graph.instagram.com/v21.0/me/message_attachments', { method: 'POST', body: fd });
            const ud = await ur.json().catch(() => ({}));
            if (ur.ok && ud.attachment_id) ids.push(ud.attachment_id);
        } catch (_e) { /* пропускаємо збійне фото */ }
    }
    if (!ids.length) throw new Error('жодне фото не завантажилось у Meta');
    const sr = await fetch(`https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipient: { id: String(igsid) },
            message: { attachments: ids.map((id) => ({ type: 'image', payload: { attachment_id: id } })) },
        }),
    });
    const sd = await sr.json().catch(() => ({}));
    if (!sr.ok || sd.error) throw new Error(sd?.error?.message || `HTTP ${sr.status}`);
    return sd.message_id || null;
}

// ── Диспетчер ────────────────────────────────────────────────────────────────
// Серіалізуємо обробку подій ОДНІЄЇ розмови (per conversation), щоб паралельні
// reaction/read/delivered не перетирали metadata одного повідомлення (read-modify-write гонка).
const _convLocks = new Map();
function withConvLock(key, fn) {
    const prev = _convLocks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    _convLocks.set(key, next.then(() => {}, () => {}));
    return next;
}
// Свап трафіку на нову СРМ (2026-09-04): Zernio шле вебхук на URL зі СТАРИМ botId
// (/webhook/zernio/:botId), а робочою воронкою тепер є CRM-клон. Щоб не чіпати
// налаштування Zernio, старий бот отримує funnelKey ZERNIO_FORWARD_BOT_ID = id клона —
// всі події обробляються під ботом-ціллю (його ключі Zernio/Instagram ідентичні). Старий
// бот можна архівувати (isActive=false) — форвардинг від цього не залежить.
const _forwardCache = new Map();
async function resolveZernioTargetBot(botId) {
    const cached = _forwardCache.get(botId);
    if (cached && cached.until > Date.now()) return cached.target;
    let target = botId;
    try {
        const row = await db.funnelKey.findFirst({ where: { botId, key: 'ZERNIO_FORWARD_BOT_ID' }, select: { value: true } });
        const v = (row && row.value || '').trim();
        if (/^[0-9a-f-]{36}$/i.test(v) && v !== botId) {
            const bot = await db.bot.findUnique({ where: { id: v }, select: { id: true } });
            if (bot) target = v;
            else logger.warn('[zernioHandler] ZERNIO_FORWARD_BOT_ID вказує на неіснуючого бота — обробляю під старим', { botId, forwardTo: v });
        }
    } catch (e) { logger.warn('[zernioHandler] forward lookup failed: ' + e.message); }
    _forwardCache.set(botId, { target, until: Date.now() + 60 * 1000 });
    return target;
}
async function handleZernioEvent(webhookBotId, body) {
    const event = body?.event;
    if (!event) return { ok: true, skipped: 'no-event' };
    const botId = await resolveZernioTargetBot(webhookBotId);
    if (botId !== webhookBotId) logger.info('[zernioHandler] forward', { from: webhookBotId, to: botId, event });
    const convId = body?.conversation?.id || body?.conversation?.conversationId || body?.data?.conversationId || 'nc';
    return withConvLock(`${botId}:${convId}`, () =>
        (event === 'message.received' ? handleIncomingMessage(botId, body)
            : event === 'comment.received' ? handleCommentReceived(botId, body)
            : handleSideEvent(botId, event, body))
    );
}

// ── Автоматизації Zernio "на пост" (аудит 2026-08-28) ───────────────────────
// Замість ОДНІЄЇ catch-all автоматизації зі статичним "напишіть артикул"
// (Zernio dmMessage — просто рядок, не шаблон/webhook) — окрема автоматизація
// НА КОЖЕН активний пост (platformPostId), з dmMessage = вже готовий опис
// САМЕ цього товару (той самий текст, що й n_welcome шле в DM). Товар
// визначається так само, як у n_lookup: артикул з підпису допису → каталог
// KeyCRM (sku/CT_1001/CT_1006). Питання власника "як це працюватиме, коли я
// додам нові товари" — вирішено САМООБСЛУГОВУЮЧО: щойно приходить ПЕРШИЙ
// коментар під НОВИМ постом (якого ще нема серед platformPostId наявних
// автоматизацій), ця функція одразу створює автоматизацію для нього тут-таки,
// без жодного ручного кроку чи окремого cron. Best-effort — помилка тут НЕ
// має ламати основний потік обробки коментаря (публічна відповідь і т.д.).
const CLOTHING_CATEGORY_IDS = [1, 2, 4, 5, 6, 8];
function extractArticleCandidatesForAutomation(txt) {
    if (!txt) return [];
    const s = String(txt);
    const out = [];
    let m;
    const re1 = /(?:артикул|арт\.?|art|код|sku|#|№)\s*[:#№.-]?\s*([A-Za-zА-Яа-яІЇЄҐіїєґ]{0,5}\d{2,8})/gi;
    while ((m = re1.exec(s))) out.push(m[1].toUpperCase());
    const re2 = /\b([A-Za-z]\d{3,6})\b/g;
    while ((m = re2.exec(s))) out.push(m[1].toUpperCase());
    const re3 = /\b(\d{4,8})\b/g;
    while ((m = re3.exec(s))) out.push(m[1]);
    return [...new Set(out)];
}
function matchArticleInCatalog(all, art) {
    if (!art) return null;
    const A = String(art).toUpperCase().trim();
    for (const p of all) {
        if (p.sku && String(p.sku).toUpperCase().trim() === A) return p;
        const cf = p.custom_fields || [];
        for (const f of cf) {
            if (!f || (f.uuid !== 'CT_1001' && f.uuid !== 'CT_1006')) continue;
            if (f.value == null) continue;
            if (String(f.value).toUpperCase().split(/[\s,;]+/).indexOf(A) >= 0) return p;
        }
    }
    return null;
}

// ── Матчинг без явного артикулу (аудит 2026-08-31, запит власника) ─────────
// Перенесено з n_lookup-ноди (Priority 2.5 / Priority 2.9 живого коду n_lookup,
// підтверджено МСР `get_funnel` — локальний n_lookup-code.js у репо був
// застарілий, без category-фільтра й без поля `confident`). Той самий поріг і
// та сама логіка тай-брейку — навмисно не переізобретено.

// РІВЕНЬ 2: keyword-overlap підпису проти назви товару. Поріг: мінімум 2
// значущих слова-збіги, і найкращий кандидат ЯВНО кращий за другого (інакше —
// тай-брейк за ціною: товар з price>0 виграє в товару з price=0; якщо
// двозначність лишається — чесно "не визначив").
const KEYWORD_STOPWORDS = { та: 1, і: 1, й: 1, на: 1, до: 1, за: 1, від: 1, для: 1, або: 1, це: 1, вже: 1, ще: 1, як: 1, що: 1, по: 1, при: 1, без: 1, між: 1 };
function tokenizeCaptionWords(s) {
    return String(s || '').toLowerCase().replace(/[^\wа-яіїєґ\s]/gi, ' ').split(/\s+/).filter((w) => w.length >= 4 && !KEYWORD_STOPWORDS[w]);
}
function matchByKeywordOverlap(all, caption) {
    const capWords = tokenizeCaptionWords(caption);
    if (!capWords.length) return null;
    const capSet = new Set(capWords);
    const scored = [];
    for (const p of all) {
        const nameWords = tokenizeCaptionWords(p.name);
        let overlap = 0;
        for (const w of nameWords) if (capSet.has(w)) overlap++;
        if (overlap > 0) scored.push({ p, score: overlap });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ap = (a.p.price != null ? a.p.price : a.p.min_price) || 0;
        const bp = (b.p.price != null ? b.p.price : b.p.min_price) || 0;
        return (bp > 0 ? 1 : 0) - (ap > 0 ? 1 : 0);
    });
    if (scored[0].score < 2) return null;
    const topScore = scored[0].score;
    const topPrice = (scored[0].p.price != null ? scored[0].p.price : scored[0].p.min_price) || 0;
    const tiedRivals = scored.filter((x, i) => i > 0 && x.score === topScore);
    const ambiguous = tiedRivals.some((x) => {
        const xp = (x.p.price != null ? x.p.price : x.p.min_price) || 0;
        return (topPrice > 0) === (xp > 0);
    });
    if (ambiguous) return null;
    return { product: scored[0].p, score: topScore };
}

// РІВЕНЬ 3: ШІ-візія (Gemini) проти обкладинки допису/рілсу. Вимагає
// `confident:true` у відповіді моделі — інакше НЕ вважається збігом (той самий
// захист, що вніс patch-lookup-remove-default-and-vision-confidence.js у
// n_lookup: "найближчий" заохочував модель завжди щось вигадати).
function isTrustedImageHost(u) {
    try {
        const h = new URL(u).hostname.toLowerCase();
        if (h === 'api.telegram.org') return true;
        return ['cdninstagram.com', 'fbcdn.net', 'fbsbx.com', 'lookaside.fbsbx.com'].some((d) => h === d || h.endsWith('.' + d));
    } catch (_e) { return false; }
}
async function matchByVision(all, imageUrl, geminiApiKey) {
    if (!imageUrl || !geminiApiKey || !isTrustedImageHost(imageUrl)) return null;
    const ac = new AbortController();
    const to = setTimeout(() => { try { ac.abort(); } catch (_e) { /* noop */ } }, 10000);
    try {
        const ir = await fetch(imageUrl, { signal: ac.signal });
        const ab = await ir.arrayBuffer();
        if (ab.byteLength > 8000000) return null;
        const b64 = Buffer.from(ab).toString('base64');
        // Telegram file-сервер віддає photos з application/octet-stream навіть коли
        // байти — реальний JPEG; Gemini на цей MIME мовчки відповідає 400.
        const mimeRaw = (ir.headers.get('content-type') || '').split(';')[0];
        const mime = (!mimeRaw || mimeRaw === 'application/octet-stream') ? 'image/jpeg' : mimeRaw;
        const catList = all.map((p, i) => i + ': ' + (p.name || '')).join('\n').slice(0, 6000);
        const prompt = 'Це обкладинка допису/рілсу в Instagram — ймовірно, товар з нашого магазину. '
            + 'Опиши коротко, що на фото (тип товару, колір, помітний текст/бренд). Потім перевір, чи Є в '
            + 'каталозі нижче (формат: індекс: назва) ТОЧНО ЦЕЙ САМИЙ товар — не просто схожий за категорією '
            + 'чи кольором, а саме він. Якщо не впевнений на 100%, що це той самий товар — bestMatchIndex '
            + 'завжди null, це нормальний очікуваний результат, краще чесно "не визначив", ніж вгадати '
            + 'найближчий. Поверни ЛИШЕ JSON {"description":"...","confident":true_або_false,"bestMatchIndex":число_або_null}.\n'
            + 'Каталог:\n' + catList;
        const gr = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(geminiApiKey), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }] }),
        });
        const gj = await gr.json();
        const t = ((((gj.candidates || [])[0] || {}).content || {}).parts || [{}])[0].text || '';
        const mm = t.match(/\{[\s\S]*\}/);
        if (!mm) return null;
        const fp = JSON.parse(mm[0]);
        if (fp.confident === true && fp.bestMatchIndex != null && all[fp.bestMatchIndex]) {
            return { product: all[fp.bestMatchIndex], description: fp.description || '' };
        }
        return null;
    } catch (_e) {
        return null;
    } finally {
        clearTimeout(to);
    }
}
// Обкладинка посту/рілсу за mediaId — caption у handleCommentReceived вже
// тягнеться з Meta Graph API, але БЕЗ картинки. Для reels media_url веде на
// відео (.mp4) — vision потребує саме thumbnail_url; для звичайного посту
// media_url вже є статичним фото.
async function getPostImageUrl(botId, mediaId) {
    try {
        const igKey = await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_ACCESS_TOKEN' }, select: { value: true } });
        const igToken = (igKey?.value || '').trim();
        if (!igToken || igToken === 'REPLACE_ME') return null;
        const mr = await fetch(`https://graph.instagram.com/v21.0/${encodeURIComponent(mediaId)}?fields=media_type,media_url,thumbnail_url&access_token=${encodeURIComponent(igToken)}`);
        const md = await mr.json().catch(() => ({}));
        if (!mr.ok) { logger.warn('[zernioHandler] media image fetch failed', { botId, mediaId, status: mr.status, error: md?.error?.message }); return null; }
        if (String(md.media_type || '').toUpperCase() === 'VIDEO') return md.thumbnail_url || null;
        return md.media_url || md.thumbnail_url || null;
    } catch (e) {
        logger.warn('[zernioHandler] media image fetch error: ' + e.message, { botId, mediaId });
        return null;
    }
}
// Аудит-слід для КОЖНОГО рівня матчингу (щоб було видно у вкладці «API», який
// саме рівень спрацював чи не спрацював) — той самий патерн service:'zernio',
// що logZernioApiCall вище.
async function logAutomationMatchAttempt(botId, mediaId, level, found, extra = {}) {
    try {
        await db.apiCall.create({
            data: {
                sessionId: null, service: 'zernio', method: 'ensure_automation_match_' + level,
                requestData: { botId, mediaId, level, ...(extra.request || {}) },
                responseData: { found: !!found, productId: found ? found.id : null, productName: found ? found.name : null, ...(extra.response || {}) },
                statusCode: found ? 200 : 204,
                durationMs: 0,
            },
        });
    } catch (e) { logger.warn('[zernioHandler] logAutomationMatchAttempt failed: ' + e.message); }
}
// Аудит 2026-08-29 (запит користувача, аналіз анти-спаму за 12г): Zernio dmMessage —
// статичний рядок на ВЕСЬ пост, без підстановки імені — усі, хто коментує ПІД ОДНИМ
// постом, отримували ДОСЛІВНО ідентичний текст DM. На відміну від публічних
// відповідей (10 варіантів + ім'я), тут це реальна відмінність. Оскільки Zernio не
// підтримує per-recipient-шаблони, ротуємо саму АВТОМАТИЗАЦІЮ: кожне вітання —
// один із кількох варіантів, і щоразу, коли для вже існуючого поста приходить ЩЕ
// один коментар, PATCH'имо automation на ІНШИЙ варіант вітання (не той, що зараз) —
// так наступний коментатор під тим самим постом отримає інший текст.
const AUTOMATION_OPENERS = [
    'Вітаю! 👋 Дякуємо за коментар під цим постом 💛\n\n',
    'Доброго дня! 😊 Раді бачити ваш коментар під постом 💙\n\n',
    'Привіт! 🙌 Дякуємо, що написали під цим постом 💛\n\n',
    'Вітаємо! 💛 Ось усе про цей товар, як і питали в коментарі 😊\n\n',
    'Дякуємо за коментар! 🙌 Ось повна інформація про товар 💙\n\n',
];
function buildAutomationPresentation(p, opener) {
    const descClean = String(p.description || '').split('\n').filter((ln) => !/^\s*ℹ️/.test(ln)).join('\n').trim();
    const isClothing = CLOTHING_CATEGORY_IDS.indexOf(p.category_id) >= 0;
    // Аудит 2026-09-01 (Проблема 1, третій прояв того самого класу): це Zernio-
    // автоматизація — DM надсилається САМИМ Zernio, зовні від нашого пайплайну, коли
    // клієнт коментує пост. Але подальше повідомлення клієнта в тому ж DM все одно
    // йде через n_route→n_lookup→n_welcome→n_size (handleCommentReceived), і n_size
    // САМ питає зріст/вагу на своєму першому ході — той самий дубль, що вже виправлено
    // в n_lookup.followUpQuestion (patch-size-followup-dedup.js). Тут — той самий
    // текст, той самий фікс: не питати зріст/вагу тут дослівно (n_size питає їх сам).
    const followUp = isClothing
        ? '👉 Зараз підберемо для вас ідеальний розмір 😊'
        : (p.category_id === 7 ? 'Напишіть, будь ласка, який розмір взуття зазвичай носите? 😊' : 'Цікавить? 😊');
    return (opener || AUTOMATION_OPENERS[0]) + descClean + '\n\n' + followUp;
}
// 2026-09-08 03:00 (vadim.lutchenko та ще 19 з 22 коментаторів за добу): Zernio-автоматизація сама шле DM з
// карткою товару, а наша сесія про цей товар НЕ знала — на «180-88» бот питав «це артикул чи розмір?».
// Повертаємо, ЩО саме презентувала автоматизація ({ article, name }), щоб handleCommentReceived поклав це в
// контекст сесії, а n_lookup підхопив як артикул, коли клієнт відповість у директ.
function automationArticle(dmMessage) {
    const m = String(dmMessage || '').match(/Артикул:\s*([A-Za-zА-Яа-я]{0,3}\d{3,8}|[A-Za-z]{1,4}\d{2,8}|set\d{3,6})/i);
    return m ? m[1] : null;
}
async function ensurePostAutomation(botId, mediaId, caption) {
    if (!mediaId || !caption) return null;
    try {
        const zk = await getZernioKeys(botId);
        if (!isReal(zk.ZERNIO_API_TOKEN) || !isReal(zk.ZERNIO_ACCOUNT_ID)) return null;

        const existR = await fetch('https://zernio.com/api/v1/comment-automations', { headers: { Authorization: 'Bearer ' + zk.ZERNIO_API_TOKEN } });
        const existD = await existR.json().catch(() => ({}));
        const existing = (existD.automations || []).find((a) => String(a.platformPostId || '') === String(mediaId));
        if (existing) {
            // Ротація вітання на КОЖЕН наступний коментар під цим постом (best-effort —
            // якщо PATCH не вдасться, наступний коментатор просто отримає той самий
            // текст, що й попередній; не критично).
            try {
                const curOpenerIdx = AUTOMATION_OPENERS.findIndex((o) => (existing.dmMessage || '').startsWith(o));
                const otherIdxs = AUTOMATION_OPENERS.map((_, i) => i).filter((i) => i !== curOpenerIdx);
                const nextOpener = AUTOMATION_OPENERS[otherIdxs[Math.floor(Math.random() * otherIdxs.length)]];
                const rest = curOpenerIdx >= 0 ? (existing.dmMessage || '').slice(AUTOMATION_OPENERS[curOpenerIdx].length) : (existing.dmMessage || '');
                await fetch('https://zernio.com/api/v1/comment-automations/' + existing.id, {
                    method: 'PATCH',
                    headers: { Authorization: 'Bearer ' + zk.ZERNIO_API_TOKEN, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dmMessage: nextOpener + rest }),
                }).catch(() => {});
            } catch (_e) { /* ротація — best-effort, не критична */ }
            return { article: automationArticle(existing.dmMessage), name: existing.postTitle || null, existed: true };
        }

        // Аудит 2026-08-31 (запит власника, живий аудит 41 коментатора): раніше тут
        // був ранній вихід, якщо в підписі взагалі нема артикулу — 19 з 41
        // коментаторів не отримали DM саме через це (рекламні пости, які не можна
        // відредагувати). Каталог тепер завжди тягнемо, а РІВЕНЬ матчингу (артикул →
        // keyword-overlap → vision) вибирається нижче — перенесено з n_lookup.
        const candidates = extractArticleCandidatesForAutomation(caption).slice(0, 8);

        const tokenRow = await db.funnelKey.findFirst({ where: { botId, key: 'KEYCRM_API_TOKEN' }, select: { value: true } });
        const baseRow = await db.funnelKey.findFirst({ where: { botId, key: 'KEYCRM_API_BASE' }, select: { value: true } });
        const catIncRow = await db.funnelKey.findFirst({ where: { botId, key: 'KEYCRM_CATEGORY_INCLUDE' }, select: { value: true } });
        const catExcRow = await db.funnelKey.findFirst({ where: { botId, key: 'KEYCRM_CATEGORY_EXCLUDE' }, select: { value: true } });
        const token = (tokenRow?.value || '').trim();
        if (!isReal(token)) return;
        const base = (baseRow?.value || 'https://openapi.keycrm.app/v1').replace(/\/$/, '');

        let all = [];
        for (let page = 1; page <= 10; page++) {
            const r = await fetch(base + '/products?include=customFields&limit=50&page=' + page, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
            if (!r.ok) break;
            const d = await r.json();
            const items = (d && d.data) || [];
            all.push(...items);
            if (items.length < 50) break;
        }
        // goverla_shop і covercar_ua діляться ОДНИМ KEYCRM_API_TOKEN (спільний
        // каталог) — той самий фільтр, що вже стоїть у n_lookup (аудит 2026-08-30),
        // інакше keyword/vision-рівні нижче можуть підставити товар ІНШОГО магазину.
        const catInc = String(catIncRow?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
        const catExc = String(catExcRow?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (catInc.length) all = all.filter((p) => catInc.indexOf(String(p.category_id)) >= 0);
        if (catExc.length) all = all.filter((p) => catExc.indexOf(String(p.category_id)) < 0);

        // РІВЕНЬ 1: артикул у підписі (як і раніше).
        let found = null; let foundArticle = null;
        if (candidates.length) {
            for (const c of candidates) { found = matchArticleInCatalog(all, c); if (found) { foundArticle = c; break; } }
        }
        await logAutomationMatchAttempt(botId, mediaId, 'article', found, { request: { candidates } });

        // РІВЕНЬ 2: keyword-overlap підпису проти назв товарів каталогу.
        if (!found) {
            const kw = matchByKeywordOverlap(all, caption);
            if (kw) found = kw.product;
            await logAutomationMatchAttempt(botId, mediaId, 'keyword', found, { response: { score: kw ? kw.score : null } });
        }

        // РІВЕНЬ 3: ШІ-візія по обкладинці посту/рілсу (Gemini), лише якщо перші
        // два рівні нічого не дали і в ключах воронки є GEMINI_API_KEY.
        if (!found) {
            const geminiRow = await db.funnelKey.findFirst({ where: { botId, key: 'GEMINI_API_KEY' }, select: { value: true } });
            const geminiKey = (geminiRow?.value || '').trim();
            if (isReal(geminiKey)) {
                const imageUrl = await getPostImageUrl(botId, mediaId);
                if (imageUrl) {
                    const vis = await matchByVision(all, imageUrl, geminiKey);
                    if (vis) found = vis.product;
                    await logAutomationMatchAttempt(botId, mediaId, 'vision', found, { request: { imageUrl }, response: { description: vis ? vis.description : null } });
                } else {
                    logger.info('[zernioHandler] ensurePostAutomation: vision пропущено — не вдалось дістати URL обкладинки', { botId, mediaId });
                }
            }
        }

        if (!found) { logger.info('[zernioHandler] ensurePostAutomation: жоден рівень матчингу (артикул/keyword/vision) не знайшов товар — автоматизацію не створюю', { botId, mediaId, candidates }); return null; }

        const profR = await fetch('https://zernio.com/api/v1/profiles', { headers: { Authorization: 'Bearer ' + zk.ZERNIO_API_TOKEN } });
        const profD = await profR.json().catch(() => ({}));
        const profileId = profD.profiles && profD.profiles[0] && profD.profiles[0]._id;
        if (!profileId) { logger.warn('[zernioHandler] ensurePostAutomation: не знайдено Zernio profileId', { botId }); return null; }

        const body = {
            profileId,
            accountId: zk.ZERNIO_ACCOUNT_ID,
            trigger: 'comment',
            platformPostId: String(mediaId),
            postTitle: found.name,
            name: 'Презентація товару — ' + found.name,
            keywords: [],
            matchMode: 'contains',
            dmMessage: buildAutomationPresentation(found, AUTOMATION_OPENERS[Math.floor(Math.random() * AUTOMATION_OPENERS.length)]),
            audience: { followerStatus: 'any', whenUnknown: 'send' },
            isActive: true,
        };
        const cr = await fetch('https://zernio.com/api/v1/comment-automations', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + zk.ZERNIO_API_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const cd = await cr.json().catch(() => ({}));
        if (cr.ok && cd.automation) {
            logger.info('[zernioHandler] ensurePostAutomation: створено нову автоматизацію на пост', { botId, mediaId, product: found.name, automationId: cd.automation.id });
            return { article: foundArticle || automationArticle(body.dmMessage) || found.sku || null, name: found.name || null, existed: false };
        } else {
            logger.warn('[zernioHandler] ensurePostAutomation: створення не вдалось', { botId, mediaId, status: cr.status, error: JSON.stringify(cd).slice(0, 300) });
        }
    } catch (e) {
        logger.warn('[zernioHandler] ensurePostAutomation error: ' + e.message, { botId, mediaId });
    }
    return null;
}

// Аудит 2026-08-27 (автовідповіді на коментарі, запит користувача): раніше
// comment.received лише логувався рядком-подією. Тепер — повноцінний вхід у
// воронку: класифікуємо коментар (нода n_comment_entry) → приватна відповідь у
// директ (Meta Private Reply, без conversationId) → публічна відповідь на сам
// коментар (з іменем — тому ж коментарю з різним іменем НЕ рахується дублем
// антиспам-фільтром IG) → далі сесія зливається зі звичайним n_route/n_lookup,
// той самий товар (за mediaId → CT_1001), 100% решти логіки не дублюється.
// Лайк коментаря НЕ реалізовано — Instagram прибрав цю можливість з API ще в
// 2018 (підтверджено документацією Zernio), жодного способу обійти немає.
async function handleCommentReceived(botId, body) {
    const c = body.comment || {};
    const conv = body.conversation || {};
    const contact = conv.contact || conv.participant || c.from || c.author || {};
    const commentId = c.id || c.commentId || c.cid || null;
    // Аудит 2026-08-27 (живий трафік, перші реальні коментарі): реальна форма
    // Zernio кладе id допису в c.platformPostId, а НЕ mediaId/postId (ті були
    // здогадкою з фрагментів документації) — c.postId в реальних подіях завжди null.
    const mediaId = c.platformPostId || c.mediaId || c.media_id || c.postId || c.post_id || conv.mediaId || conv.postId || null;
    const commentText = c.text || c.content || c.message || '';
    const contactId = contact.id || contact.platformId || contact.psid || contact.accountId || null;
    const contactName = contact.name || contact.displayName || contact.username || contact.accountUsername || 'друже';
    const contactUsername = contact.username || contact.handle || contact.accountUsername || null;

    const eventId = body.id || `comment_${commentId || contactId || Date.now()}`;
    if (!(await dedup(botId, eventId))) return { ok: true, processed: 0 };

    // Аудит 2026-08-27 (живий трафік): наші ВЛАСНІ реплаї на чужі коментарі (менеджер
    // відповів вручну в Instagram) теж прилітають як comment.received — Zernio явно
    // позначає це полем author.isOwnAccount. Без цього гарду бот сприймав власний
    // акаунт як "клієнта", що міг би призвести до відповіді самому собі.
    if (contact.isOwnAccount) { return { ok: true, skipped: 'own-account' }; }

    if (!commentId || !contactId) {
        logger.warn('[zernioHandler] comment.received без commentId/contactId — RAW', { botId, raw: JSON.stringify(body).slice(0, 1500) });
        return { ok: true, skipped: 'no-ids' };
    }

    const testModeBlocked = await isBlockedByTestMode(botId, [contactUsername, contactName]);

    // Аудит 2026-08-28 (запит користувача): коментар типу "🔥" не містить артикулу в
    // ТЕКСТІ САМОГО коментаря — але майже завжди пише його ПІД ПОСТОМ, де артикул є в
    // ПІДПИСІ (як і при пересиланні поста в DM). Тягнемо підпис допису напряму з Meta
    // Graph API і подаємо його як звичайний sharedPost.caption — n_lookup вже вміє
    // шукати артикул саме там (той самий шлях, що й для пересланих постів у DM), без
    // жодних змін у самому n_lookup.
    let postCaption = null;
    if (mediaId) {
        try {
            const igKey = await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_ACCESS_TOKEN' }, select: { value: true } });
            const igToken = (igKey?.value || '').trim();
            if (igToken && igToken !== 'REPLACE_ME') {
                const mr = await fetch(`https://graph.instagram.com/v21.0/${encodeURIComponent(mediaId)}?fields=caption&access_token=${encodeURIComponent(igToken)}`);
                const md = await mr.json().catch(() => ({}));
                if (mr.ok && md.caption) postCaption = String(md.caption);
                else if (!mr.ok) logger.warn('[zernioHandler] media caption fetch failed', { botId, mediaId, status: mr.status, error: md?.error?.message });
            }
        } catch (e) { logger.warn('[zernioHandler] media caption fetch error: ' + e.message); }
    }

    // Best-effort: якщо для ЦЬОГО поста ще нема Zernio-автоматизації "презентація
    // товару" — створити її прямо зараз (self-service, без ручного кроку при
    // додаванні нових товарів/постів). Помилка тут НЕ має ламати основний потік.
    //
    // Аудит 2026-08-31 (запит власника, живий аудит коментарів): ensurePostAutomation
    // створює автоматизацію НА СТОРОНІ ZERNIO (trigger:'comment', audience:'any',
    // isActive:true) — вона потім триггериться і шле DM САМА, повністю в обхід нашого
    // testMode-гейту (той існує лише в НАШОМУ коді, isBlockedByTestMode тут ще не
    // перевірявся). Підтверджено живими логами Zernio: 19 з 41 реальних (НЕ з
    // allowlist) коментаторів отримали "status":"sent" — повний опис товару й ціну —
    // хоча testMode=true мав тримати бота мовчазним для всіх, крім 3 тестерів.
    // Власник ЯВНО вирішив: testMode = повна тиша для реальних клієнтів. Поки він
    // увімкнений — НЕ створюємо і НЕ ротуємо жодної Zernio-автоматизації (вона не вміє
    // фільтрувати по нашому allowlist, тільки по followerStatus). Коли власник вимкне
    // testMode — усе почне створюватись і ротуватись як і раніше, без жодних змін.
    let automationHint = null;
    if (mediaId && postCaption) {
        if (await isTestModeOn(botId)) {
            logger.info('[zernioHandler] ensurePostAutomation пропущено — testMode увімкнено', { botId, mediaId });
        } else {
            automationHint = await ensurePostAutomation(botId, mediaId, postCaption);
        }
    }

    const user = await findOrCreateZernioUser(contactId, botId, contactName);
    const patch = {
        psid: String(contactId), senderName: contactName || undefined, igUsername: contactUsername || undefined,
        commentId: String(commentId), commentText, commentMediaId: mediaId ? String(mediaId) : null,
        // 2026-09-08: товар, який Zernio-автоматизація презентувала в DM після цього коментаря — n_lookup бере його
        // як артикул, коли клієнт відповідає в директ («180-88», «XL»). Ключі НЕ в списку очищення DM-гілки.
        ...(automationHint && (automationHint.article || automationHint.name) ? { commentProductArticle: automationHint.article || '', commentProductName: automationHint.name || '', commentProductAt: new Date().toISOString() } : {}),
        // entryAd — той самий механізм, яким уже користується n_lookup (ПРІОРІТЕТ 1,
        // ad_id по CT_1001) — коментар під конкретним постом ідентифікує товар так
        // само, як клік із реклами на цей пост.
        entryAd: mediaId ? String(mediaId) : undefined,
        ...(postCaption ? { sharedPost: { kind: 'post', mediaId: String(mediaId), caption: postCaption } } : {}),
        // Аудит 2026-08-28 (живий кейс, тестер matsukoleksandr — ПОВТОРНИЙ коментар не
        // отримав публічної відповіді): commentReplyPosted — прапорець, який зернioHandler
        // САМ ставить у true ПІСЛЯ успішного посту (рядок ~649), а не n_comment_entry.
        // Патч-мердж findOrCreateZernioSession може лише ДОДАВАТИ/перезаписувати поля, не
        // очищати — тож без явного скидання тут прапорець від ПОПЕРЕДНЬОГО коментаря
        // лишався true назавжди, і КОЖЕН НАСТУПНИЙ коментар цього ж клієнта (навіть з
        // геть іншим текстом) мовчки пропускав публічну відповідь, бо код бачив
        // "вже опубліковано". commentReplyText НЕ скидаємо явно — n_comment_entry все
        // одно рахує його заново щоразу, коли реально запускається.
        commentReplyPosted: false,
        commentCategory: '',
    };
    const session = await findOrCreateZernioSession(user.id, botId, patch);

    await db.message.create({
        data: {
            sessionId: session.id, role: 'event', content: `💬 Коментар від ${contactName}: ${String(commentText).slice(0, 200)}`,
            // authorName/commentText/commentId структуровано (не лише в готовому content) —
            // щоб SessionDetail.jsx міг показати коментар окремою карткою, не парсячи рядок.
            metadata: { source: 'zernio', eventType: 'comment.received', authorName: contactName || '', commentText: String(commentText), commentId: String(commentId), raw: c },
        },
    });

    if (testModeBlocked) { logger.info('[zernioHandler] comment blocked by testMode', { botId, sessionId: session.id }); return { ok: true, processed: 1 }; }

    const ctxNow = session.context || {};
    if (ctxNow.adminEngaged || ctxNow.funnelPaused) return { ok: true, processed: 1 };

    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    const hasCommentFlow = flow && flow.nodes.some((n) => n.id === 'n_comment_entry');
    if (!hasCommentFlow) {
        logger.info('[zernioHandler] n_comment_entry не підключено в цій воронці — коментар лише залоговано', { botId });
        return { ok: true, processed: 1 };
    }

    // Скеровуємо сесію на спеціальний вхід "коментар" (не звичайний start_1) — щойно
    // він зробить своє (класифікація + відповіді), решта графа веде в n_route/n_lookup
    // так само, як і для DM.
    await db.session.update({
        where: { id: session.id },
        data: { context: { ...session.context, flowRuntime: { ...(session.context.flowRuntime || {}), currentNodeId: 'n_comment_entry', waitingForUser: false } } },
    });

    scheduleFlowRun(session.id, {
        botId, contactId, conversationId: conv.id || conv.conversationId || null, contactName, commentId: String(commentId), text: commentText,
        ctxPatch: patch, flowRuntimePatch: { currentNodeId: 'n_comment_entry', waitingForUser: false },
    });
    logger.info('[zernioHandler] Comment routed to n_comment_entry', { botId, sessionId: session.id, commentId, mediaId });
    return { ok: true, processed: 1 };
}

async function dedup(botId, id) {
    if (!id) return true;
    try { await db.processedMessage.create({ data: { botId, updateId: `zn_${id}` } }); return true; }
    catch (e) { if (e.code === 'P2002') return false; throw e; }
}

async function handleIncomingMessage(botId, body) {
    const { conv, contact, msg, conversationId, contactId, contactName, contactUsername } = extractCommon(body);
    if (msg.direction && msg.direction === 'outgoing') return { ok: true, skipped: 'outgoing' };
    // Аудит 2026-08-31 (запит власника, живий кейс "однакове питання надіслано ДВІЧІ
    // поспіль"): Zernio comment-automation (dmMessage, trigger:'comment' —
    // ensurePostAutomation) шле DM ЯК ОКРЕМЕ повідомлення в ту саму розмову. Zernio
    // потім реплікує це ЖОДНИМ direction:'outgoing' — той самий webhook message.received,
    // що й для реальних вхідних, летить і на ВЛАСНЕ повідомлення бізнес-акаунту.
    // handleCommentReceived вже мав гард contact.isOwnAccount (Meta явно позначає
    // власний акаунт) — тут його НЕ було: наш рушій сприймав ВЛАСНИЙ DM-текст
    // автоматизації як НОВЕ повідомлення КЛІЄНТА, заново матчив товар і надсилав
    // ЩЕ ОДНУ, майже ідентичну презентацію в ТУ Ж розмову — звідси видиме "клієнт
    // отримав однакове питання двічі". Живий доказ: сесія cd3f0a27 (contactUsername
    // = "goverla_shop", senderName = власний бізнес-опис акаунту) — раніше вже
    // виявлено як крос-бот витік (psid без botId), причина сплутування ТА САМА.
    if (contact.isOwnAccount) return { ok: true, skipped: 'own-account' };
    if (contactUsername) {
        const ownUsername = await getOwnInstagramUsername(botId);
        if (ownUsername && String(contactUsername).trim().toLowerCase() === ownUsername) {
            logger.info('[zernioHandler] message.received від власного IG-акаунту — пропускаю (echo автоматизації)', { botId, contactUsername });
            return { ok: true, skipped: 'own-account-username' };
        }
    }
    if (!contactId || !conversationId) {
        logger.warn('[zernioHandler] message.received без contactId/conversationId — RAW', { botId, raw: JSON.stringify(body).slice(0, 1200) });
        return { ok: true, skipped: 'no-ids' };
    }
    const eventId = body.id || msg.id || `${conversationId}_${body.timestamp || Date.now()}`;
    if (!(await dedup(botId, eventId))) return { ok: true, processed: 0 };

    // Тестовий режим воронки: не в списку дозволених -> бот просто МОВЧИТЬ (як після
    // ручної кнопки "зупинити"), АЛЕ сесія і повідомлення все одно створюються —
    // видно в дашборді. НЕ займає ctxNow.funnelPaused/adminEngaged (див. нижче) —
    // це окремий, незалежний гейт, щоб перемикання тестового режиму ніколи не чіпало
    // ручний per-сесійний стоп/старт конкретного клієнта.
    const testModeBlocked = await isBlockedByTestMode(botId, [contactUsername, contactName]);

    const text = msg.text || body?.data?.text || '';
    const zMsgId = msg.id || null;
    const platformMessageId = msg.platformMessageId || null;
    const ref = body.metadata?.referral || msg.referral || body.referral || body.conversation?.referral || msg.metadata?.referral || body?.data?.referral || null;
    const storyReply = body.metadata?.storyReply || msg.metadata?.storyReply || null;
    let adId = ref?.ad_id || ref?.adId || msg.metadata?.ad_id || null;
    const postId = ref?.ads_context_data?.post_id || ref?.ads_context_data?.postId || null;
    let adTitleFromConv = null;
    // 2026-09-08 (_hladkyi_vitalii_ 11:38: «Яка ціна товарів?» з реклами прийшло БЕЗ referral → бот не знав товару; за 17 хв той
    // самий текст із referral → комплект). Для коротких «рекламних» питань без referral беремо meta_ad_id із самої розмови Zernio.
    // 17:30 (mrs_fox_28 «З реклами» → referral прийшов лише за 90 с у conversation.started): короткі відкриваючі
    // повідомлення без referral (до 40 символів) теж перевіряємо через метадані розмови.
    // 18:21 (dk7777dk «Вага 93 зріст 188» без referral, реклама привʼязана): будь-яке повідомлення без referral і без
    // пересланого поста — перевіряємо метадані розмови; продукт у сесії (якщо вже є) звіряється нижче після створення сесії.
    if (!adId && !postId && conversationId && !(Array.isArray(msg.attachments) && msg.attachments.some((a) => /ig_post|ig_reel|share/i.test(String((a && (a.originalType || a.type)) || ''))))) {
        try {
            // Лише для НОВОЇ розмови (у сесії ще нема товару і воронка ще не йшла) — інакше старий meta_ad_id зі сторінки
            // розмови перетворив би «Дякую за посилку» на повторну презентацію старого товару.
            const _prev = contactId ? await db.session.findFirst({ where: { botId, isActive: true, context: { path: ['psid'], equals: String(contactId) } }, orderBy: { lastActive: 'desc' }, select: { context: true } }) : null;
            const _pc = (_prev && _prev.context) || {};
            if (_pc.product || ((_pc.flowRuntime || {}).currentNodeId)) throw new Error('skip: session already has product/flow');
            const zk = await getZernioKeys(botId);
            if (isReal(zk.ZERNIO_API_TOKEN)) {
                const cr = await fetch('https://zernio.com/api/v1/inbox/conversations/' + encodeURIComponent(conversationId), { headers: { Authorization: 'Bearer ' + zk.ZERNIO_API_TOKEN } });
                const cj = await cr.json().catch(() => ({})); const md = ((cj && cj.data) || {}).metadata || {};
                if (md.meta_ad_id) { adId = String(md.meta_ad_id); adTitleFromConv = md.meta_ad_title || null; logger.info('[zernioHandler] ad resolved from conversation metadata', { botId, conversationId, adId }); }
            }
        } catch (e) { logger.warn('[zernioHandler] conversation metadata lookup failed: ' + e.message, { botId, conversationId }); }
    }
    const storyId = storyReply?.storyId || storyReply?.story_id || null;

    // Вхідні медіа (може бути кілька — «альбом» до 10 фото). Зберігаємо ВСІ.
    const rawAtts = Array.isArray(msg.attachments) ? msg.attachments : (Array.isArray(msg.media) ? msg.media : []);
    const mappedAtts = rawAtts.map((a) => {
        const url = a.url || a.payload?.url || a.src || a.mediaUrl || a.link || null;
        const rawType = String(a.type || a.mimeType || a.contentType || '').toLowerCase();
        const type = /video|animation|gif/.test(rawType) ? 'video' : /image|photo/.test(rawType) ? 'photo' : (a.type || 'file');
        return url ? { type, url } : null;
    }).filter(Boolean);
    const attachment = mappedAtts[0] || null;
    const imgCount = mappedAtts.filter((a) => a.type === 'photo').length;
    // 2026-09-07 (OsmanoV поділився сторіс «Переглянути світлину» — до нас дійшов лише текст): фіксуємо СИРІ типи
    // вкладень і ключі payload у метаданих, щоб бачити, що саме Zernio (не) передає; вкладення без url → мітка.
    const rawAttTypes = rawAtts.map((a) => String((a && (a.type || a.mimeType || a.contentType)) || 'unknown')).slice(0, 10);
    const unknownAtts = rawAtts.filter((a) => !(a && (a.url || (a.payload && a.payload.url) || a.src || a.mediaUrl || a.link)));
    const mediaLabel = !attachment ? (unknownAtts.length ? ('[вкладення без файлу: ' + rawAttTypes.join(', ') + ']') : '[порожнє повідомлення]')
        : mappedAtts.length > 1 ? `[${mappedAtts.length} медіа]`
        : attachment.type === 'video' ? '[відео]' : attachment.type === 'photo' ? '[фото]' : '[вкладення]';

    // Переслані пости/рілси: caption + media_id для визначення товару по артикулу.
    let sharedPost = null;
    for (const a of rawAtts) {
        const ot = String(a.originalType || a.type || '').toLowerCase();
        if (ot.includes('ig_post') || ot.includes('ig_reel') || ot === 'share') {
            const pl = a.payload || {};
            sharedPost = { kind: ot.includes('reel') ? 'reel' : 'post', mediaId: pl.ig_post_media_id || pl.reel_video_id || pl.media_id || null, caption: pl.title || pl.caption || null, url: a.url || pl.url || null };
            break;
        }
    }
    const patch = { conversationId, psid: String(contactId), senderName: contactName || undefined, igUsername: contactUsername || undefined };
    if (adId) { patch.entryAdId = String(adId); patch.lastReferral = ref; }
    else if (ref) { patch.lastReferral = ref; }
    if (sharedPost) patch.sharedPost = sharedPost;
    if (postId) patch.postId = String(postId);
    if (storyId) patch.storyId = String(storyId);
    if (ref && ref.ads_context_data && ref.ads_context_data.ad_title) patch.adTitle = ref.ads_context_data.ad_title;
    else if (adTitleFromConv) patch.adTitle = adTitleFromConv;
    const user = await findOrCreateZernioUser(contactId, botId, contactName);
    patch.lastUserTs = Date.now();
    if (user && user.metadata && user.metadata.crmClientId) patch.crmClientId = user.metadata.crmClientId;
    let session = await findOrCreateZernioSession(user.id, botId, patch);

    // Аудит 2026-08-28 (живий тест): якщо клієнт РАНІШЕ лишав коментар,
    // context.commentId лишався в сесії НАЗАВЖДИ (findOrCreateZernioSession
    // мерджить лише non-null поля — не вміє "стерти" старе). Реальна DM-подія —
    // однозначний сигнал, що клієнт тепер у СПРАВЖНІЙ розмові з відкритим
    // вікном; без цього чищення n_have_product_gate (див. відповідний патч)
    // помилково трактував ЦЕЙ DM як "усе ще коментар" і тихо ігнорував його
    // (adminEngaged без жодного повідомлення), навіть коли клієнт РЕАЛЬНО пише.
    if (session.context && session.context.commentId) {
        const _c = { ...session.context };
        delete _c.commentId; delete _c.commentMediaId; delete _c.commentText;
        delete _c.commentReplyText; delete _c.commentReplyPosted; delete _c.commentCategory;
        session = await db.session.update({ where: { id: session.id }, data: { context: _c } });
    }

    // Живий тест 2026-09-04 (Олексій, сесія 5a542121): вебхуки Zernio приходили із затримкою
    // 2 хв ("Сірий") і 18,5 хв ("Світло-сірий") відносно часу створення повідомлення (час
    // зашитий у Mongo ObjectId msg.id; body.timestamp, якщо є). Запізніле повідомлення
    // оброблялось як нове — після завершеного замовлення бот заново показував товар.
    // Рахуємо реальний вік повідомлення; "застаріле" (старіше за нашу останню відповідь
    // на 90+ с, без товарного сигналу) зберігаємо в історію, але у воронку НЕ пускаємо.
    let msgCreatedAt = null;
    try {
        const rawTs = body.timestamp || msg.timestamp || msg.createdAt || msg.created_at || null;
        if (rawTs) { const n = Number(rawTs); msgCreatedAt = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(rawTs); }
        if ((!msgCreatedAt || isNaN(msgCreatedAt.getTime())) && zMsgId && /^[0-9a-f]{24}$/i.test(String(zMsgId))) msgCreatedAt = new Date(parseInt(String(zMsgId).slice(0, 8), 16) * 1000);
        if (msgCreatedAt && isNaN(msgCreatedAt.getTime())) msgCreatedAt = null;
    } catch (_e) { msgCreatedAt = null; }
    const channelLatencyMs = msgCreatedAt ? Math.max(0, Date.now() - msgCreatedAt.getTime()) : null;
    const lastAssistantMsg = await db.message.findMany({ where: { sessionId: session.id, role: 'assistant' }, orderBy: { createdAt: 'desc' }, take: 8, select: { createdAt: true, metadata: true } })
        .then((rows) => rows.find((r) => ((r.metadata || {}).source) !== 'zernio_inbox') || null).catch(() => null);
    const hasProductSignal = !!(sharedPost || adId || postId || storyId || (Array.isArray(mappedAtts) && mappedAtts.length) || /(?:артикул|арт\.?|art|код|sku|#|№)\s*[:#№.\-]?\s*[A-Za-zА-Яа-яІЇЄҐіїєґ]{0,5}\d{2,8}/i.test(String(text || '')) || /\b[A-Za-z]\d{3,6}\b/.test(String(text || '')));
    const staleInbound = !!(msgCreatedAt && lastAssistantMsg && !hasProductSignal && (lastAssistantMsg.createdAt.getTime() - msgCreatedAt.getTime()) > 90 * 1000);

    await db.message.create({
        data: cleanJsonDeep({
            sessionId: session.id, role: 'user', content: text || (sharedPost && sharedPost.caption ? ('[переслав ' + sharedPost.kind + '] ' + sharedPost.caption.slice(0, 80)) : mediaLabel),
            metadata: {
                source: 'zernio', zernioMessageId: zMsgId, platformMessageId, messageId: zMsgId,
                ...(msgCreatedAt ? { channelCreatedAt: msgCreatedAt.toISOString(), channelLatencyMs } : {}),
                ...(rawAttTypes.length ? { rawAttachmentTypes: rawAttTypes } : {}),
                rawKeys: Object.keys(msg || {}).slice(0, 25),
                ...(staleInbound ? { stale: true, staleReason: 'older than last bot reply by >90s (channel delay)' } : {}),
                ...(adId ? { adId } : {}),
                ...(attachment ? { attachment, attachments: mappedAtts } : {}),
                ...(sharedPost ? { sharedPost } : {}),
            },
        }),
    });

    let ctxNow = session.context || {};
    // 2026-09-08 05:45 (рішення власника): пауза від менеджера (manager_message / бекфіл 594 розмов) — не назавжди.
    // Клієнт повертається з НОВИМ сигналом товару (пост/рілс, реклама, артикул, фото) після ≥24 год тиші в розмові
    // (ні клієнт, ні менеджер, ні бот не писали) → пауза знімається, бот відповідає. Ручна пауза (manual) — ніколи.
    if (ctxNow.funnelPaused && (ctxNow.pausedBy === 'manager_message' || ctxNow.pausedBy === 'manager_message_backfill') && hasProductSignal && !testModeBlocked) {
        try {
            const prev = await db.message.findFirst({ where: { sessionId: session.id, createdAt: { lt: new Date(Date.now() - 5000) } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
            const quietMs = prev ? (Date.now() - prev.createdAt.getTime()) : Infinity;
            if (quietMs >= 24 * 3600 * 1000) {
                const fresh = await db.session.findUnique({ where: { id: session.id }, select: { context: true } });
                const fc = (fresh && fresh.context) || {};
                ctxNow = { ...fc, funnelPaused: false, pausedBy: null, resumedBy: 'client_return_24h', resumedAt: new Date().toISOString() };
                session = await db.session.update({ where: { id: session.id }, data: { context: ctxNow } });
                await logDelivery(session.id, botId, 'zernio_inbound', true, null, { reason: 'client_return_24h: клієнт повернувся з новим товаром після ' + Math.round(quietMs / 3600000) + ' год тиші — паузу менеджера знято', text: String(text || '').slice(0, 80) });
                logger.info('[zernioHandler] manager pause lifted: client returned with product signal', { botId, sessionId: session.id, quietHours: Math.round(quietMs / 3600000) });
            }
        } catch (e) { logger.warn('[zernioHandler] client_return_24h check failed: ' + e.message, { botId, sessionId: session.id }); }
    }
    // Детект «клієнт просить людину» тепер ЄДИНИЙ і живе в движку (executeFlowStep) —
    // спрацьовує однаково для всіх каналів (раніше тут був окремий дубль-regex, який
    // міг розійтися з движковим). Адаптер лише транспортує: викликає крок і доставляє
    // повідомлення, які движок вже сам поклав у БД (включно з handoff-відповіддю).
    //
    // Аудит 2026-08-31 (запит власника, живі кейси "Добрий день ігнорується" /
    // "не відповідає взагалі після пересланих рілсів"): раніше тут стояв ВУЗЬКИЙ гейт
    // (_resumeOnProduct) — пропускав повідомлення до движка ТІЛЬКИ якщо
    // ctxNow.handoffKind === 'product_unknown' І в повідомленні є явна ознака товару.
    // Але движок (testSession.js, "Загальне відновлення після БУДЬ-ЯКОГО автоматичного
    // хендофу") вже вміє коректно й ЗАГАЛЬНО auto-resume-ити adminEngaged НЕЗАЛЕЖНО
    // від handoffKind — просто на будь-яке наступне повідомлення клієнта (не лише з
    // сигналом товару). Через цей вузький гейт-дублікат в адаптері рушій НІКОЛИ не
    // отримував шансу відпрацювати для handoff-ів БЕЗ handoffKind='product_unknown'
    // (напр. n_size_oor_stop ставить adminEngaged=true взагалі без handoffKind) —
    // клієнт лишався в АБСОЛЮТНІЙ тиші назавжди, навіть коли пересилав рілси з
    // артикулами чи писав "Добрий день" після завершеного діалогу. Правило "критичні
    // рішення — в движку, адаптер — тонкий" (Корінь 8 стандарту воронок): прибрано
    // дубль-логіку тут, лишається тільки funnelPaused (РУЧНА пауза адміна — і ТІЛЬКИ
    // вона має тримати бота мовчазним; adminEngaged — автоматичне рішення системи,
    // resume на нього рушій робить сам).
    const inImageUrl = (attachment && attachment.type === 'photo' && attachment.url && String(attachment.url).startsWith('http')) ? attachment.url : null;
    if (channelLatencyMs != null && channelLatencyMs > 60 * 1000) {
        logger.warn('[zernioHandler] inbound arrived late from channel', { botId, sessionId: session.id, latencySec: Math.round(channelLatencyMs / 1000), stale: staleInbound, text: String(text || '').slice(0, 60) });
        await logDelivery(session.id, botId, 'zernio_inbound', true, null, { latencyMs: channelLatencyMs, stale: staleInbound, text: String(text || '').slice(0, 80), reason: staleInbound ? 'stale: skipped flow (older than last bot reply)' : 'late but processed' });
    }
    if (staleInbound) {
        logger.info('[zernioHandler] stale inbound — stored, flow not run', { botId, sessionId: session.id });
        // 2026-09-12 (живий кейс, igorigor_ 95ef30ab): "Яка ціна кофти?" прийшла stale — flow
        // на неї не пускали взагалі, і текст ("кофти" — категорійний сигнал) губився повністю.
        // Наступні повідомлення оброблялись без жодного сигналу товару → 2x "не знаю товару".
        // Мінімально-інвазивний фікс: НЕ відповідаємо на це повідомлення окремо (щоб не
        // дублювати вже дану відповідь), але зберігаємо його текст у context.pendingStaleText —
        // testSession.js долучає його до сигналу НАСТУПНОГО реального ходу (n_signal_check/
        // n_catalog_hint), щоб дані не втрачались назавжди. Обмежено 3 останніми записами.
        if (text && String(text).trim()) {
            try {
                const freshS = await db.session.findUnique({ where: { id: session.id }, select: { context: true } });
                const fc = (freshS && freshS.context) || {};
                const pending = (Array.isArray(fc.pendingStaleText) ? fc.pendingStaleText : []).slice(-2);
                pending.push(String(text).slice(0, 300));
                await db.session.update({ where: { id: session.id }, data: { context: { ...fc, pendingStaleText: pending } } });
            } catch (e) { logger.warn('[zernioHandler] failed to store pendingStaleText: ' + e.message, { botId, sessionId: session.id }); }
        }
        return { ok: true, processed: 1, stale: true };
    }
    // 2026-09-08 (реальні замовлення 01:53, 02:14, 03:14): після тексту з адресою Instagram досилає порожнє вкладення
    // типу «template» без файлу й тексту. У воронку його не пускаємо — інакше «[вкладення без файлу: template]»
    // стає окремим ходом клієнта і провокує зайву відповідь.
    if (!text && !attachment && !sharedPost && unknownAtts.length) {
        logger.info('[zernioHandler] attachment-only inbound without file — stored, flow not run', { botId, sessionId: session.id, types: rawAttTypes });
        return { ok: true, processed: 1, skipped: 'attachment-without-file' };
    }
    // 2026-09-07 (бойовий старт goverla, 19:45): десятки розмов у цей момент вели МЕНЕДЖЕРИ вручну (клієнти вже
    // платили), а бот на перше ж повідомлення після увімкнення слав презентацію з нуля. Правило: якщо за останні
    // 12 год у розмові писав менеджер (zernio_inbox), а бот жодного разу ще не вів цю розмову (нема повідомлень з
    // nodeId) — розмова «менеджерська», бот мовчить. Менеджер може віддати її боту кнопкою рестарту в адмінці.
    // Уточнення 19:58 (скрін власника: бот відповів «Так, це джинси j0032» у розмові, яку менеджер уже забрав):
    // менеджер написав ПІСЛЯ останнього повідомлення бота → розмова менеджерська, доки адмін не зробить
    // рестарт сесії (запис admin_restart новіший за повідомлення менеджера повертає бота).
    // Рішення власника 20:05: без прихованого гейту — повідомлення менеджера (message.sent не від бота) ставить
    // ЗВИЧАЙНУ паузу сесії (funnelPaused, та сама іконка в адмінці), менеджер сам знімає її, коли віддає розмову боту.
    // Див. handleMessageSent нижче (pausedBy: 'manager_message'). Тут лише стандартна перевірка funnelPaused.
    // 2026-09-08 16:18 (grechkodmitrii: менеджер учора оформив замовлення сам, сьогодні клієнт написав «Зелений)» — бот
    // продовжив зі свого старого кроку розміру): останнє вихідне в розмові — від менеджера, а в новому повідомленні
    // немає сигналу товару → розмова менеджерська: пауза (той самий перемикач), бот мовчить. Новий пост/реклама/артикул
    // після ≥24 год тиші відкриває розмову заново (правило client_return_24h вище).
    if (!testModeBlocked && !ctxNow.funnelPaused && !hasProductSignal) {
        try {
            const _lastOut = await db.message.findFirst({ where: { sessionId: session.id, role: 'assistant' }, orderBy: { createdAt: 'desc' }, select: { metadata: true, createdAt: true } });
            if (_lastOut && ((_lastOut.metadata || {}).source) === 'zernio_inbox') {
                ctxNow = { ...ctxNow, funnelPaused: true, pausedBy: 'manager_message', pausedAt: _lastOut.createdAt.toISOString() };
                await db.session.update({ where: { id: session.id }, data: { context: ctxNow } });
                await logDelivery(session.id, botId, 'zernio_inbound', true, null, { reason: 'manager_last: останнє вихідне від менеджера, сигналу товару нема — пауза, бот мовчить', text: String(text || '').slice(0, 80) });
                logger.info('[zernioHandler] manager wrote last — session paused on client reply', { botId, sessionId: session.id });
            }
        } catch (e) { logger.warn('[zernioHandler] manager_last check failed: ' + e.message, { botId, sessionId: session.id }); }
    }
    if (!testModeBlocked && !ctxNow.funnelPaused) {
        // Аудит 2026-08-27 (антипатерн A12, реальний кейс Сіразетдінова): рілс/пост і
        // підпис-текст до нього іноді приходять ДВОМА окремими webhook-подіями за
        // частки секунди. Кожна раніше одразу й НЕЗАЛЕЖНО викликала executeFlowStep —
        // перша знаходила товар за підписом, друга (лише текст "Яка ціна?", без
        // сигналу товару) виконувалась ЯК ОКРЕМИЙ крок і могла дати суперечливу
        // відповідь. Дебаунс зливає такі близькі повідомлення ОДНІЄЇ сесії в ОДИН
        // виклик рушія — чекаємо коротке вікно, чи не прийде ще щось майже одразу.
        // ctxPatch: пост/реклама/реферал цього повідомлення — runFlowAndDeliver накладе їх на контекст ЩЕ РАЗ перед
        // запуском, бо прогін, що саме виконується, наприкінці перезаписує контекст своїм знімком (2026-09-09,
        // oleksandr.ruslanovych / tetianashablenko: пост, що прийшов під час прогону, губився — бот не бачив товар).
        scheduleFlowRun(session.id, { botId, contactId, conversationId, contactName, text, imageUrl: inImageUrl, ctxPatch: patch });
    }
    logger.info('[zernioHandler] Inbound stored', { botId, sessionId: session.id, hasAd: !!adId });
    return { ok: true, processed: 1 };
}

// sessionId -> { timer, texts:[], imageUrl, botId, contactId, conversationId, contactName }
const _pendingFlowRuns = new Map();
// 2026-09-07 (тест Олексія 11:14): «Так що? 😡» і «Буде відповідь?» за 3.2 с → два окремі прогони, дві майже
// однакові відповіді. Вікно 2.5 с склеює такі «дуплети» в одне повідомлення; затримка для клієнта непомітна.
const FLOW_DEBOUNCE_MS = 2500;

// Проблема Д (аудит 2026-09-01, живий кейс F0029 — фото+презентація надіслані
// повторно кілька разів поспіль): дебаунс вище зливає повідомлення, що прийшли
// В МЕЖАХ 1200мс одне від одного, в ОДИН виклик — але НЕ захищає від ДВОХ
// РІЗНИХ debounce-циклів для ТІЄЇ САМОЇ сесії, коли пауза між ними БІЛЬША за
// 1200мс, але МЕНША за час, який реально займає runFlowAndDeliver (KeyCRM +
// Claude + Gemini vision — 2-3с). Підтверджено живим трейсом: клієнт переслав
// рілс (t=0), через 2.3с написав "Прийняв рішення..." — debounce №1 вже
// СТАРТУВАВ (спрацював через 1.2с) і виконувався, коли прийшло друге
// повідомлення; воно створило НОВИЙ debounce-запис (старий вже видалений з
// _pendingFlowRuns після старту таймера) і за своїм ТАЙМЕРОМ стартувало
// runFlowAndDeliver #2 ще ДО того, як #1 встиг дописати runtime.currentNodeId
// у БД — обидва прочитали сесію ще на start_1 і НЕЗАЛЕЖНО прогнали
// start→n_route→n_lookup→n_welcome, звідси видиме подвійне фото+презентація.
// Фікс: чергу виконання runFlowAndDeliver СЕРІАЛІЗУЄМО по sessionId (проміс-
// ланцюжок у пам'яті процесу — platform-api працює в одному fork, не кластері,
// тож цього достатньо, без розподіленого Redis-локу) — другий виклик ЧЕКАЄ,
// поки перший повністю завершиться (включно з записом у БД), перш ніж читати
// сесію заново.
const _sessionRunQueue = new Map();

function scheduleFlowRun(sessionId, msg) {
    let entry = _pendingFlowRuns.get(sessionId);
    if (!entry) {
        entry = { texts: [], imageUrl: null, botId: msg.botId, contactId: msg.contactId, conversationId: msg.conversationId, contactName: msg.contactName, commentId: msg.commentId || null, timer: null };
        _pendingFlowRuns.set(sessionId, entry);
    }
    if (msg.text) entry.texts.push(msg.text);
    if (msg.imageUrl && !entry.imageUrl) entry.imageUrl = msg.imageUrl;
    if (msg.ctxPatch && typeof msg.ctxPatch === 'object') { entry.ctxPatch = entry.ctxPatch || {}; for (const [k, v] of Object.entries(msg.ctxPatch)) if (v != null) entry.ctxPatch[k] = v; }
    if (msg.flowRuntimePatch && typeof msg.flowRuntimePatch === 'object') entry.flowRuntimePatch = { ...(entry.flowRuntimePatch || {}), ...msg.flowRuntimePatch };
    if (msg.contactName) entry.contactName = msg.contactName;
    if (msg.commentId) entry.commentId = msg.commentId;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
        _pendingFlowRuns.delete(sessionId);
        const prevInQueue = _sessionRunQueue.get(sessionId) || Promise.resolve();
        const thisRun = prevInQueue
            .catch(() => {}) // попередній запуск міг впасти — не блокуємо чергу його помилкою
            .then(() => runFlowAndDeliver(sessionId, entry))
            .catch((e) => logger.error('[zernioHandler] debounced flow run failed', { sessionId, error: e.message }));
        _sessionRunQueue.set(sessionId, thisRun);
        thisRun.finally(() => { if (_sessionRunQueue.get(sessionId) === thisRun) _sessionRunQueue.delete(sessionId); });
    }, FLOW_DEBOUNCE_MS);
}

async function runFlowAndDeliver(sessionId, entry) {
    const { botId, contactId, conversationId, contactName, commentId } = entry;
    const sendOpts = { sessionId, ...(commentId ? { commentId } : {}) };
    const mergedText = entry.texts.filter(Boolean).join('\n').trim();
    // Повторне накладання патчу контексту (пост/реклама/реферал) — попередній прогін у черзі міг перезаписати його.
    if ((entry.ctxPatch && Object.keys(entry.ctxPatch).length) || entry.flowRuntimePatch) {
        try {
            const _s = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
            const _c = { ...((_s && _s.context) || {}) };
            for (const [k, v] of Object.entries(entry.ctxPatch || {})) if (v != null) _c[k] = v;
            if (entry.flowRuntimePatch) _c.flowRuntime = { ...(_c.flowRuntime || {}), ...entry.flowRuntimePatch };
            await db.session.update({ where: { id: sessionId }, data: { context: cleanJsonDeep(_c) } });
        } catch (e) { logger.warn('[zernioHandler] ctxPatch re-apply failed: ' + e.message, { sessionId }); }
    }
    const sinceTime = new Date();
    try { await executeFlowStep({ sessionId, incomingUserMessage: mergedText, incomingImageUrl: entry.imageUrl }); }
    catch (e) { logger.error('[zernioHandler] flow step failed', { botId, sessionId, error: e.message }); }
    const outMsgs = await db.message.findMany({ where: { sessionId, role: 'assistant', createdAt: { gt: sinceTime } }, orderBy: { createdAt: 'asc' } });
    for (const om of outMsgs) {
        const m = om.metadata || {};
        if (m.hidden) continue;
        // Живий тест 2026-09-04 (Олексій): клієнт отримав текст "[повідомлення]" — це луна inbox-синку
        // (наш же щойно надісланий фото-альбом без тексту, збережений як zernio_inbox з плейсхолдером)
        // потрапила у вибірку "нові повідомлення асистента" і пішла клієнту як текст. Луну і порожні
        // плейсхолдери НЕ доставляємо.
        if (m.source === 'zernio_inbox' || m.status === 'sent') continue;
        if (!String(om.content || '').trim() && !(m.attachment && m.attachment.url)) continue;
        if (/^\[повідомлення\]$/.test(String(om.content || '').trim())) continue;
        const att = m.attachment;
        const imgUrl = att && (att.type === 'photo' || att.type === 'image') && att.url && String(att.url).startsWith('http') ? att.url : null;
        try {
            if (imgUrl) {
                // Аудит 2026-08-28 (живий кейс, goverla_shop): для фото ДОПРОДАЖУ
                // (m.nodeType === 'photo_on_demand_upsell') галерея ОСНОВНОГО товару
                // (context.product.imageUrls) — це фото ІНШОГО товару, підміняти нею
                // upImg НЕ можна (раніше клієнт, що просив фото футболки-допродажу,
                // отримував альбом бомберів — фото основного товару). Для будь-якого
                // іншого фото (sendPhoto-нода, wantsPhoto основного товару) — як і
                // раніше: усі фото товару з CRM (галерея) поспіль; підпис → текстом.
                const _isUpsellPhoto = m.nodeType === 'photo_on_demand_upsell';
                // 2026-09-11 (photo_on_demand_catalog — фото КІЛЬКОХ РІЗНИХ товарів зі списку-підказки,
                // не одного товару з context.product): att.urls, якщо є, це вже готовий, точний
                // список для альбому — не підміняти галереєю жодного окремого товару.
                const _explicitUrls = Array.isArray(att.urls) ? att.urls.filter((u) => u && String(u).startsWith('http')) : null;
                const _fresh = (_isUpsellPhoto || _explicitUrls) ? null : await db.session.findUnique({ where: { id: sessionId }, select: { context: true } }).catch(() => null);
                const _gal = _explicitUrls ? _explicitUrls : (_isUpsellPhoto ? [] : (((_fresh && _fresh.context && _fresh.context.product && _fresh.context.product.imageUrls) || [])).filter((u) => u && String(u).startsWith('http')));
                // IG приймає до 10 attachment-обʼєктів в одному повідомленні → шлемо АЛЬБОМОМ.
                const _maxRow = await db.funnelKey.findFirst({ where: { botId, key: 'PRODUCT_PHOTOS_MAX' }, select: { value: true } }).catch(() => null);
                const _max = Math.min(10, Math.max(1, parseInt((_maxRow && _maxRow.value) || '10', 10) || 10));
                const _list = (_gal.length ? _gal : [imgUrl]).slice(0, _max);
                try {
                    const _albumId = await sendMetaPhotoAlbum(botId, contactId, _list);
                    await logDelivery(sessionId, botId, 'ig_photo_album', true, null, { nodeId: m.nodeId || null, count: _list.length, messageId: _albumId });
                } catch (e) {
                    logger.warn('[zernioHandler] альбом не пройшов, шлемо по одному: ' + e.message);
                    await logDelivery(sessionId, botId, 'ig_photo_album', false, e.message, { nodeId: m.nodeId || null, count: _list.length });
                    for (const _g of _list) {
                        try { await sendMetaPhoto(botId, contactId, _g); await logDelivery(sessionId, botId, 'ig_photo', true, null, { nodeId: m.nodeId || null, url: _g }); }
                        catch (e2) { logger.warn('[zernioHandler] фото: ' + e2.message); await logDelivery(sessionId, botId, 'ig_photo', false, e2.message, { nodeId: m.nodeId || null, url: _g }); }
                    }
                }
                const cap = att.caption || om.content;
                if (cap) {
                    const zcid = await sendZernioMessage(botId, conversationId, cap, sendOpts);
                    await logDelivery(sessionId, botId, 'zernio', !!zcid, zcid ? null : 'sendZernioMessage не повернув id', { nodeId: m.nodeId || null, text: String(cap).slice(0, 160) });
                }
            } else if (om.content) {
                const zid = await sendZernioMessage(botId, conversationId, om.content, sendOpts);
                await logDelivery(sessionId, botId, 'zernio', !!zid, zid ? null : 'sendZernioMessage не повернув id', { nodeId: m.nodeId || null, text: String(om.content).slice(0, 160) });
                if (zid) await db.message.update({ where: { id: om.id }, data: { metadata: { ...m, zernioMessageId: zid, status: 'sent' } } }).catch(() => {});
            }
        } catch (e) {
            // Фолбек: Meta-фото не пройшло → підпис+URL текстом через Zernio.
            await logDelivery(sessionId, botId, imgUrl ? 'ig_photo' : 'zernio', false, e.message, { nodeId: m.nodeId || null });
            if (imgUrl) { await sendZernioMessage(botId, conversationId, (att.caption || om.content || '') + '\n' + imgUrl, sendOpts).catch(() => {}); }
            logger.warn('[zernioHandler] доставка: ' + e.message);
        }
    }
    // Публічна відповідь на сам коментар — окремо від DM-доставки вище. Нода
    // n_comment_entry кладе готовий текст (з іменем, для антиспаму) у
    // context.commentReplyText; тут лише ОДИН раз постимо його в Zernio.
    if (commentId) {
        try {
            const _frc = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
            const _cc2 = (_frc && _frc.context) || {};
            if (_cc2.commentReplyText && !_cc2.commentReplyPosted) {
                let _rid = null, _rerr = null;
                try {
                    _rid = await postZernioCommentReply(botId, commentId, _cc2.commentReplyText, _cc2.commentMediaId, sessionId);
                    await logDelivery(sessionId, botId, 'zernio_comment_reply', !!_rid, _rid ? null : 'без id відповіді', { commentId, text: String(_cc2.commentReplyText).slice(0, 160) });
                } catch (e) {
                    _rerr = e.message;
                    await logDelivery(sessionId, botId, 'zernio_comment_reply', false, e.message, { commentId });
                    logger.warn('[zernioHandler] публічна відповідь на коментар не пройшла: ' + e.message);
                }
                // Аудит 2026-08-28 (запит користувача): публічна відповідь на коментар раніше
                // існувала ЛИШЕ в deliveryLog (вкладка «Ноди») — у чаті сесії її взагалі не
                // було видно. Тепер зберігаємо як повноцінне повідомлення (окремий source,
                // щоб SessionDetail.jsx показав її ІНШЕ, ніж звичайну DM-відповідь бота).
                await db.message.create({
                    data: {
                        sessionId, role: 'assistant', content: _cc2.commentReplyText,
                        metadata: { source: 'comment_public_reply', eventType: 'comment.reply', commentId, ok: !!_rid, ...(_rerr ? { error: _rerr } : {}) },
                    },
                }).catch(() => {});
                await db.session.update({ where: { id: sessionId }, data: { context: { ..._cc2, commentReplyPosted: true } } }).catch(() => {});
            }
        } catch (e) { logger.warn('[zernioHandler] comment reply block: ' + e.message); }
    }
    try {
        const _fr = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
        const _c = (_fr && _fr.context) || {};
        const _prod = _c.product || {};
        const _hadSignal = _c.entryAdId || (_c.sharedPost && _c.sharedPost.caption);
        if (_prod._via === 'default' && _hadSignal && !_c.unmatchedNotified) {
            const _reason = _c.entryAdId ? ('ad_id ne zmapleno: ' + _c.entryAdId) : 'post/artykul ne znaydeno v CRM';
            const _postPart = (_c.sharedPost && _c.sharedPost.caption) ? (' | Post: ' + String(_c.sharedPost.caption).slice(0, 70)) : '';
            const _msg = 'UVAGA: bot ne vyznachyv tovar, obrobit vruchnu. Klient: ' + (contactName || 'klient') + ' | Prychyna: ' + _reason + _postPart + ' | Povidomlennia: ' + (mergedText || '') + ' | Default: ' + (_prod.name || '');
            await sendTelegramAlert(botId, _msg, sessionId);
            await db.session.update({ where: { id: sessionId }, data: { context: { ..._c, unmatchedNotified: true } } }).catch(() => {});
        }
    } catch (e) { logger.warn('[zernioHandler] unmatched notify: ' + e.message); }
    try {
        const _fs = await db.session.findUnique({ where: { id: sessionId }, select: { context: true, userId: true } });
        const _cc = _fs && _fs.context && _fs.context.crmClientId;
        if (_cc && _fs.userId) {
            const _u = await db.user.findUnique({ where: { id: _fs.userId } });
            if (_u && (!_u.metadata || _u.metadata.crmClientId !== _cc)) await db.user.update({ where: { id: _u.id }, data: { metadata: { ...(_u.metadata || {}), crmClientId: _cc } } }).catch(() => {});
        }
    } catch (e) { /* некритично */ }
}

const EVENT_CONTENT = {
    'conversation.started': '🟢 Розмову розпочато',
    'call.received': '📞 Вхідний дзвінок',
    'review.new': '⭐ Новий відгук',
    'review.updated': '⭐ Відгук оновлено',
};

async function handleSideEvent(botId, event, body) {
    const { msg, conversationId, contactId, contactName } = extractCommon(body);
    const eventId = body.id || `${event}_${conversationId || contactId}_${body.timestamp || Date.now()}`;
    if (!(await dedup(botId, eventId))) return { ok: true, processed: 0 };

    // Резолв сесії
    let session = null;
    const selfIds = await getSelfIds(botId);
    const realContactId = (contactId && !selfIds.has(String(contactId))) ? contactId : null;
    if (realContactId) {
        const user = await findOrCreateZernioUser(realContactId, botId, contactName);
        session = await findOrCreateZernioSession(user.id, botId, { conversationId, psid: String(realContactId), senderName: contactName || undefined });
    } else {
        session = await findSessionByConversation(botId, conversationId);
    }
    // 2026-09-08 03:00 (vadim.lutchenko): менеджер відповів «готовою відповіддю» клієнту, чия сесія почалась із
    // КОМЕНТАРЯ (conversationId ще не відомий) → «event без сесії» → пауза не стала → о 03:02 бот вліз у розмову.
    // Для message.sent дістаємо учасника розмови з Zernio (GET /inbox/conversations/{id}) і знаходимо/створюємо
    // сесію за контактом — тоді пауза від менеджера спрацьовує і для таких розмов.
    if (!session && event === 'message.sent' && conversationId) {
        try {
            const zk = await getZernioKeys(botId);
            if (isReal(zk.ZERNIO_API_TOKEN)) {
                const cr = await fetch('https://zernio.com/api/v1/inbox/conversations/' + encodeURIComponent(conversationId), { headers: { Authorization: 'Bearer ' + zk.ZERNIO_API_TOKEN } });
                const cj = await cr.json().catch(() => ({}));
                const cd = (cj && cj.data) || {};
                const pid = cd.participantId || ((cd.participants || []).find((p) => p && p.id && !selfIds.has(String(p.id))) || {}).id || null;
                if (pid && !selfIds.has(String(pid))) {
                    const user = await findOrCreateZernioUser(String(pid), botId, cd.participantName || null);
                    session = await findOrCreateZernioSession(user.id, botId, { conversationId, psid: String(pid), senderName: cd.participantName || undefined });
                    logger.info('[zernioHandler] message.sent: сесію знайдено через Zernio conversation', { botId, sessionId: session.id, conversationId });
                }
            }
        } catch (e) { logger.warn('[zernioHandler] conversation lookup failed: ' + e.message, { botId, conversationId }); }
    }
    if (!session) { logger.warn('[zernioHandler] event без сесії', { botId, event, conversationId, contactId, bodyKeys: Object.keys(body || {}).slice(0, 15) }); return { ok: true, processed: 0 }; }

    // ── Статуси доставки → позначка на конкретному повідомленні ──
    if (event === 'message.delivered' || event === 'message.read' || event === 'message.failed') {
        const target = await findMessageByZid(session.id, msg.id, msg.platformMessageId);
        const status = event === 'message.read' ? 'read' : event === 'message.failed' ? 'failed' : 'delivered';
        if (target) {
            const cur = target.metadata || {};
            const rank = { sent: 1, delivered: 2, read: 3 };
            // read не «даунгрейдиться» до delivered
            const nextStatus = status === 'failed' ? 'failed' : ((rank[status] || 0) >= (rank[cur.status] || 0) ? status : cur.status);
            // Аудит 2026-08-28: галочки (StatusTicks, admin UI) показують ЧАС прочитання/доставки
            // по наведенню — без timestamp'ів це нічим не наповнити. Пишемо лише на РЕАЛЬНИЙ
            // перехід (nextStatus !== cur.status), щоб не затирати ранній readAt пізнішим дублем.
            const now = new Date().toISOString();
            const stamps = {};
            if (nextStatus === 'delivered' && cur.status !== 'delivered') stamps.deliveredAt = now;
            if (nextStatus === 'read' && cur.status !== 'read') stamps.readAt = now;
            await db.message.update({ where: { id: target.id }, data: { metadata: { ...cur, status: nextStatus, ...stamps, ...(event === 'message.failed' && body.error ? { failError: body.error.message || body.error.title } : {}) } } }).catch(() => {});
            return { ok: true, processed: 1, attachedTo: target.id };
        }
        // Аудит 2026-08-28 (скарга користувача: "мітки прочитано незрозуміло, до якого
        // повідомлення відносяться"): фолбек-бульбашка-подія для delivered/read була НЕ
        // прив'язана до жодного конкретного повідомлення (типова причина — читання прийшло
        // раніше, ніж ми встигли дотегнути zernioMessageId на щойно відправлене повідомлення,
        // класична гонитва). Замість заплутаної окремої бульбашки — тихо пропускаємо: сам
        // статус на конкретному повідомленні (checkmarks) важливіший за окрему подію, а без
        // target прив'язати їй нема до чого. message.failed лишаємо — це дія, яку менеджер
        // має побачити, навіть без прив'язки до конкретного повідомлення.
        if (event === 'message.failed') {
            await db.message.create({ data: { sessionId: session.id, role: 'event', content: EVENT_CONTENT[event] || event, metadata: { source: 'zernio', eventType: event } } });
        }
        return { ok: true, processed: target ? 1 : 0 };
    }

    // ── Реакція → емодзі на повідомленні ──
    if (event === 'reaction.received') {
        const r = body.reaction || {};
        const target = await findMessageByZid(session.id, r.messageId, r.platformMessageId);
        if (target) {
            const cur = target.metadata || {};
            let reactions = Array.isArray(cur.reactions) ? cur.reactions.slice() : [];
            if (r.action === 'removed') {
                reactions = r.emoji ? reactions.filter((e) => e !== r.emoji) : []; // на removed emoji часто порожній → чистимо
            } else if (r.emoji && !reactions.includes(r.emoji)) {
                reactions.push(r.emoji);
            }
            await db.message.update({ where: { id: target.id }, data: { metadata: { ...cur, reactions } } }).catch(() => {});
            return { ok: true, processed: 1, attachedTo: target.id };
        }
        await db.message.create({ data: { sessionId: session.id, role: 'event', content: `${r.emoji || '❤️'} Реакція`, metadata: { source: 'zernio', eventType: event } } });
        return { ok: true, processed: 1 };
    }

    // ── Редагування / видалення → оновлюємо саме повідомлення ──
    if (event === 'message.edited') {
        const target = await findMessageByZid(session.id, msg.id, msg.platformMessageId);
        if (target) { await db.message.update({ where: { id: target.id }, data: { content: msg.text || target.content, metadata: { ...(target.metadata || {}), edited: true } } }).catch(() => {}); return { ok: true, processed: 1 }; }
        await db.message.create({ data: { sessionId: session.id, role: 'event', content: '✏️ Повідомлення відредаговано', metadata: { source: 'zernio', eventType: event } } });
        return { ok: true, processed: 1 };
    }
    if (event === 'message.deleted') {
        const target = await findMessageByZid(session.id, msg.id, msg.platformMessageId);
        if (target) { await db.message.update({ where: { id: target.id }, data: { metadata: { ...(target.metadata || {}), deleted: true } } }).catch(() => {}); return { ok: true, processed: 1 }; }
        await db.message.create({ data: { sessionId: session.id, role: 'event', content: '🗑 Повідомлення видалено', metadata: { source: 'zernio', eventType: event } } });
        return { ok: true, processed: 1 };
    }

    // ── message.sent: оператор відповів прямо з інбокса Zernio (не наш API) ──
    if (event === 'message.sent') {
        if (msg.id) { const mine = await findMessageByZid(session.id, msg.id, msg.platformMessageId); if (mine) return { ok: true, processed: 0 }; }
        // Echo нашого ж вихідного (flow вже зберіг це повідомлення) — не дублювати, лише дотегнути id.
        // Порівнюємо НОРМАЛІЗОВАНИЙ текст (trim + згорнуті пробіли/переноси) в JS, а не
        // точну SQL-рівність — Zernio-echo інколи трохи відрізняється пробілами/CRLF,
        // через що exact-match запит не знаходив щойно збережене повідомлення й
        // створював видимий дубль у сесії (той самий текст двічі).
        const _sentText = msg.text || '';
        const _norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        if (_sentText) {
            const _recent = await db.message.findMany({ where: { sessionId: session.id, role: 'assistant', createdAt: { gte: new Date(Date.now() - 180000) } }, orderBy: { createdAt: 'desc' }, take: 10 });
            const _sentNorm = _norm(_sentText);
            const _ourEcho = _recent.find((r) => ((r.metadata || {}).source) !== 'zernio_inbox' && _norm(r.content) === _sentNorm);
            if (_ourEcho) { const _c = _ourEcho.metadata || {}; if (!_c.zernioMessageId && msg.id) await db.message.update({ where: { id: _ourEcho.id }, data: { metadata: { ..._c, zernioMessageId: msg.id, status: 'sent' } } }).catch(() => {}); return { ok: true, processed: 0 }; }
        }
        // Луна НАШОГО ж медіа (фото-альбом товару без тексту): у сесії вона показувалась як
        // «[повідомлення] від менеджера (напряму в Instagram)» (скрін власника 2026-09-05).
        // Без тексту шукаємо своє свіже повідомлення з фото без zernioMessageId і дотегуємо його.
        const _sentAtts = Array.isArray(msg.attachments) ? msg.attachments : (Array.isArray(msg.media) ? msg.media : []);
        if (!_sentText) {
            const _recentM = await db.message.findMany({ where: { sessionId: session.id, role: 'assistant', createdAt: { gte: new Date(Date.now() - 300000) } }, orderBy: { createdAt: 'desc' }, take: 15 });
            const _ourMedia = _recentM.find((r) => { const c = r.metadata || {}; return c.source !== 'zernio_inbox' && !c.zernioMessageId && (c.attachment || c.nodeType === 'sendPhoto' || /photo/.test(String(c.nodeType || '')) || (Array.isArray(c.attachments) && c.attachments.length)); });
            if (_ourMedia) { const _c = _ourMedia.metadata || {}; await db.message.update({ where: { id: _ourMedia.id }, data: { metadata: { ..._c, zernioMessageId: msg.id || null, platformMessageId: msg.platformMessageId || _c.platformMessageId || null, status: 'sent' } } }).catch(() => {}); return { ok: true, processed: 0 }; }
        }
        const _label = _sentText || (_sentAtts.length ? ('[' + (_sentAtts.length > 1 ? 'фото ×' + _sentAtts.length : ((_sentAtts[0] && /video/i.test(String(_sentAtts[0].type || ''))) ? 'відео' : 'фото')) + ' від менеджера]') : '[повідомлення від менеджера]');
        await db.message.create({ data: cleanJsonDeep({ sessionId: session.id, role: 'assistant', content: _label, metadata: { source: 'zernio_inbox', zernioMessageId: msg.id || null, platformMessageId: msg.platformMessageId || null, status: 'sent', ...(_sentAtts.length ? { attachments: _sentAtts.slice(0, 10) } : {}) } }) });
        // 2026-09-07 20:05 (рішення власника, бойовий старт): менеджер написав клієнту з інбокса → сесія стає на
        // ЗВИЧАЙНУ паузу (funnelPaused — та сама іконка в адмінці). Бот мовчить, доки менеджер сам не зніме паузу.
        try {
            const _fresh = await db.session.findUnique({ where: { id: session.id }, select: { context: true } });
            const _pc = (_fresh && _fresh.context) || {};
            // 2026-09-08 (Maltsev): у «готовій відповіді» менеджера є «Артикул: A0187» — запамʼятовуємо, щоб після відновлення бот знав товар.
            const _artM = String(_sentText || '').match(/Артикул:?\s*([A-Za-z]{1,4}\d{3,8}|set\d{3,6}|\d{5,8})/i);
            if (_artM) { _pc.managerArticleHint = _artM[1]; _pc.managerArticleAt = new Date().toISOString(); if (_pc.funnelPaused) await db.session.update({ where: { id: session.id }, data: { context: _pc } }).catch(() => {}); }
            if (!_pc.funnelPaused) {
                await db.session.update({ where: { id: session.id }, data: { context: { ..._pc, funnelPaused: true, pausedBy: 'manager_message', pausedAt: new Date().toISOString() } } });
                await logDelivery(session.id, botId, 'zernio_inbound', true, null, { reason: 'manager_message → funnelPaused (бот на паузі, зняти можна в адмінці)' });
                logger.info('[zernioHandler] manager wrote — session paused', { botId, sessionId: session.id });
            }
        } catch (_e) { logger.warn('[zernioHandler] pause on manager message failed: ' + _e.message); }
        return { ok: true, processed: 1 };
    }

    // ── Інші події → рядок-подія (comment.received іде окремим шляхом, handleCommentReceived) ──
    const content = EVENT_CONTENT[event] || `ℹ️ ${event}`;
    await db.message.create({ data: { sessionId: session.id, role: 'event', content, metadata: { source: 'zernio', eventType: event } } });
    logger.info('[zernioHandler] side event stored', { botId, event, sessionId: session.id });
    return { ok: true, processed: 1 };
}

// ── Авто-відновлення після втручання менеджера (2026-09-07 21:17, Валерій) ────────────────────────────
// Бот вів діалог, менеджер вставив «готову відповідь» з Instagram (→ пауза manager_message) і замовк;
// клієнт написав «Часткова», «Скільки буде доставка?» — тиша. Правило: якщо ДО повідомлення менеджера
// розмову вів бот (є повідомлення з nodeId), менеджер мовчить ≥10 хв після ОСТАННЬОГО повідомлення клієнта,
// а клієнт після менеджера писав — знімаємо паузу, бот відповідає на все накопичене, менеджеру — сигнал.
// Розмови, які менеджер вів від початку (бекфіл 20:23 і нові без bot-nodeId), НЕ відновлюються.
const MANAGER_SILENCE_RESUME_MS = 10 * 60 * 1000;
async function resumeAfterManagerSilence() {
    try {
        const since = new Date(Date.now() - 24 * 3600 * 1000);
        const sessions = await db.session.findMany({ where: { isActive: true, isTest: false, lastActive: { gte: since }, context: { path: ['pausedBy'], equals: 'manager_message' } }, select: { id: true, botId: true, context: true }, take: 200 });
        for (const s of sessions) {
            try {
                const ctx = s.context || {};
                if (!ctx.funnelPaused || !ctx.conversationId) continue;
                const msgs = await db.message.findMany({ where: { sessionId: s.id, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { role: true, content: true, createdAt: true, metadata: true } });
                let lastManagerIdx = -1; for (let i = msgs.length - 1; i >= 0; i--) { if (((msgs[i].metadata || {}).source) === 'zernio_inbox') { lastManagerIdx = i; break; } }
                if (lastManagerIdx < 0) continue;
                // 23:13 (Людмила): відновлення влізло в розмову, яку менеджер вів ГОДИНАМИ (бот там лише один раз
                // встряв 19:46) і обійшло тестовий режим. Умови: (а) НЕ testMode/allowlist-блок; (б) до менеджера
                // розмову вів бот, і ЖОДНОГО повідомлення менеджера перед першим повідомленням бота за добу не було;
                // (в) менеджер написав лише 1–2 повідомлення (готова відповідь), а не веде діалог.
                if (await isBlockedByTestMode(s.botId, [ctx.igUsername, ctx.senderName])) continue;
                const firstBotIdx = msgs.findIndex((m) => m.role !== 'user' && !!((m.metadata || {}).nodeId));
                if (firstBotIdx < 0 || firstBotIdx > lastManagerIdx) continue;
                const managerBeforeBot = msgs.slice(0, firstBotIdx).some((m) => ((m.metadata || {}).source) === 'zernio_inbox');
                if (managerBeforeBot) continue;
                const managerMsgsAfterBot = msgs.slice(firstBotIdx).filter((m) => ((m.metadata || {}).source) === 'zernio_inbox').length;
                if (managerMsgsAfterBot > 2) continue;
                // 2026-09-08 18:46 (Бой Бой: «Зріст 1.75 вага 85» написав ДО відповіді менеджера, бот після відновлення параметрів не бачив):
                // накопичене = усі повідомлення клієнта після ОСТАННЬОЇ відповіді бота (включно з тими, що були до репліки менеджера).
                let lastBotIdx = -1; msgs.forEach((m, idx) => { if (m.role === 'assistant' && (m.metadata || {}).nodeId) lastBotIdx = idx; });
                const after = msgs.slice(Math.min(lastManagerIdx, lastBotIdx) + 1).filter((m) => m.role === 'user');
                if (!after.length) continue;
                // 2026-09-08 19:30 (oleksandr7776777): менеджер спитав «Який у вас обʼєм по грудях?» о 16:24, а о 16:30 бот
                // «відновився» і відповів на повідомлення клієнта 16:19, яке менеджер уже опрацював. Правила: (1) відновлюємось
                // ЛИШЕ коли є повідомлення клієнта ПІСЛЯ останньої репліки менеджера (без відповіді); (2) 10 хв тиші рахуємо
                // від останнього повідомлення БУДЬ-КОГО з двох (клієнт і менеджер), а не лише клієнта.
                const unanswered = msgs.slice(lastManagerIdx + 1).filter((m) => m.role === 'user');
                if (!unanswered.length) continue;
                const lastClientAt = after[after.length - 1].createdAt.getTime();
                const lastManagerAt = msgs[lastManagerIdx].createdAt.getTime();
                if (Date.now() - Math.max(lastClientAt, lastManagerAt) < MANAGER_SILENCE_RESUME_MS) continue;
                const fresh = await db.session.findUnique({ where: { id: s.id }, select: { context: true } });
                const fc = (fresh && fresh.context) || {};
                await db.session.update({ where: { id: s.id }, data: { context: { ...fc, funnelPaused: false, pausedBy: null, resumedBy: 'manager_silence', resumedAt: new Date().toISOString() } } });
                const text = after.map((m) => String(m.content || '')).filter((t) => t && !/^\[порожнє/.test(t)).join('\n').trim();
                const att = after.map((m) => (m.metadata || {}).attachment).find((a) => a && a.type === 'photo' && /^http/.test(a.url || ''));
                await logDelivery(s.id, s.botId, 'zernio_inbound', true, null, { reason: 'manager_silence_resume: менеджер мовчить 10 хв — бот відновив і відповідає на накопичене', text: text.slice(0, 80) });
                logger.info('[zernioHandler] resumed after manager silence', { sessionId: s.id });
                if (text || att) scheduleFlowRun(s.id, { botId: s.botId, contactId: ctx.contactId || ctx.psid, conversationId: ctx.conversationId, contactName: ctx.senderName, text, imageUrl: att ? att.url : null });
                // 2026-09-08 (власник): Telegram-сповіщення про відновлення не потрібне — лише лог доставки вище.
            } catch (e) { logger.warn('[zernioHandler] resumeAfterManagerSilence session error', { sessionId: s.id, error: e.message }); }
        }
    } catch (e) { logger.warn('[zernioHandler] resumeAfterManagerSilence error: ' + e.message); }
}
setTimeout(() => { resumeAfterManagerSilence(); setInterval(resumeAfterManagerSilence, 60 * 1000); }, 90 * 1000);

// 2026-09-09 (власник, п.7 аудиту після регресії v12.7, коли 2 год нові сесії лишались без картки): сторож мовчання бота.
// Раз на 10 хв: нові живі сесії за 30 хв, у яких є повідомлення клієнта (старше 3 хв), нема жодної відповіді бота (message з
// metadata.nodeId), нема паузи і блоку тестового режиму. ≥ BOT_SILENCE_MIN таких → Telegram (OWNER_TELEGRAM_ID, інакше
// ADMIN_TELEGRAM_ID), не частіше ніж раз на годину на бота.
const BOT_SILENCE_MIN = 5;
const _silenceAlertAt = {};
async function checkBotSilence() {
    try {
        const since = new Date(Date.now() - 30 * 60 * 1000);
        const sessions = await db.session.findMany({ where: { isTest: false, startedAt: { gte: since } }, select: { id: true, botId: true, context: true } });
        if (!sessions.length) return;
        const msgs = await db.message.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) } }, select: { sessionId: true, role: true, createdAt: true, metadata: true } });
        const bySess = {}; for (const m of msgs) (bySess[m.sessionId] ||= []).push(m);
        const silent = {};
        for (const s of sessions) {
            const c = s.context || {};
            if (c.funnelPaused || c.testBlocked || c.paused) continue;
            const list = bySess[s.id] || [];
            const users = list.filter((m) => m.role === 'user');
            if (!users.length) continue;
            if (Date.now() - Math.min(...users.map((m) => m.createdAt.getTime())) < 3 * 60 * 1000) continue;
            const botReplied = list.some((m) => m.role === 'assistant' && (m.metadata || {}).nodeId);
            if (botReplied) continue;
            (silent[s.botId] ||= []).push({ id: s.id, ig: c.igUsername || c.senderName || '' });
        }
        for (const [botId, arr] of Object.entries(silent)) {
            if (arr.length < BOT_SILENCE_MIN) continue;
            if (Date.now() - (_silenceAlertAt[botId] || 0) < 60 * 60 * 1000) continue;
            _silenceAlertAt[botId] = Date.now();
            const rows = await db.funnelKey.findMany({ where: { botId, key: { in: ['OWNER_TELEGRAM_ID', 'TELEGRAM_BOT_TOKEN', 'SHOP_TAG'] } }, select: { key: true, value: true } });
            const m = Object.fromEntries(rows.map((r) => [r.key, (r.value || '').trim()]));
            const text = '🚨 БОТ МОВЧИТЬ: за останні 30 хв ' + arr.length + ' нових розмов без жодної відповіді бота (не на паузі, не тест).\nМожлива поломка воронки після правки — перевірте сесії:\n' + arr.slice(0, 6).map((x) => '• ' + (x.ig || x.id.slice(0, 8)) + ' — https://flows.fineko.space/sessions/' + x.id).join('\n') + (arr.length > 6 ? '\n… і ще ' + (arr.length - 6) : '');
            if (m.OWNER_TELEGRAM_ID && m.TELEGRAM_BOT_TOKEN) {
                await fetch('https://api.telegram.org/bot' + m.TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: m.OWNER_TELEGRAM_ID, text: (m.SHOP_TAG ? '🏪 ' + m.SHOP_TAG + '\n' : '') + text, disable_web_page_preview: true }) }).catch(() => null);
            } else {
                await sendTelegramAlert(botId, text, null);
            }
            logger.warn('[zernioHandler] bot silence alert', { botId, count: arr.length });
        }
    } catch (e) { logger.warn('[zernioHandler] checkBotSilence error: ' + e.message); }
}
setTimeout(() => { checkBotSilence(); setInterval(checkBotSilence, 10 * 60 * 1000); }, 120 * 1000);

// ensurePostAutomation/scheduleFlowRun експортовано для живого тестування (напр.
// живий кейс mediaId без артикулу; Проблема Д — race condition у серіалізації
// runFlowAndDeliver) і майбутніх регресійних тестів — не викликаються поза
// handleZernioEvent у нормальному потоці.
module.exports = { handleZernioEvent, sendZernioMessage, ensurePostAutomation, scheduleFlowRun };

