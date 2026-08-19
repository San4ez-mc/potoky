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

async function findOrCreateZernioUser(psid, botId, name) {
    const existing = await db.user.findFirst({ where: { metadata: { path: ['psid'], equals: String(psid) } } });
    if (existing) {
        if (name && existing.firstName !== name) await db.user.update({ where: { id: existing.id }, data: { firstName: name } }).catch(() => {});
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
                    metadata: { source: 'zernio', channel: 'zernio', psid: String(psid) },
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
async function sendZernioMessage(botId, conversationId, text) {
    const km = await getZernioKeys(botId);
    if (!isReal(km.ZERNIO_API_TOKEN)) throw new Error('ZERNIO_API_TOKEN ще не налаштований у ключах воронки.');
    if (!isReal(km.ZERNIO_ACCOUNT_ID)) throw new Error('ZERNIO_ACCOUNT_ID ще не налаштований у ключах воронки.');
    if (!conversationId) throw new Error('Немає conversationId у сесії — неможливо надіслати відповідь через Zernio.');
    const tmpl = km.ZERNIO_SEND_URL || 'https://zernio.com/api/v1/inbox/conversations/{conversationId}/messages';
    const url = tmpl.replace('{conversationId}', encodeURIComponent(conversationId));
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${km.ZERNIO_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: km.ZERNIO_ACCOUNT_ID, message: String(text || '') }),
    });
    const data = await res.json().catch(() => ({}));
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
async function handleZernioEvent(botId, body) {
    const event = body?.event;
    if (!event) return { ok: true, skipped: 'no-event' };
    const convId = body?.conversation?.id || body?.conversation?.conversationId || body?.data?.conversationId || 'nc';
    return withConvLock(`${botId}:${convId}`, () =>
        (event === 'message.received' ? handleIncomingMessage(botId, body) : handleSideEvent(botId, event, body))
    );
}

async function dedup(botId, id) {
    if (!id) return true;
    try { await db.processedMessage.create({ data: { botId, updateId: `zn_${id}` } }); return true; }
    catch (e) { if (e.code === 'P2002') return false; throw e; }
}

async function handleIncomingMessage(botId, body) {
    const { msg, conversationId, contactId, contactName, contactUsername } = extractCommon(body);
    if (msg.direction && msg.direction === 'outgoing') return { ok: true, skipped: 'outgoing' };
    if (!contactId || !conversationId) {
        logger.warn('[zernioHandler] message.received без contactId/conversationId — RAW', { botId, raw: JSON.stringify(body).slice(0, 1200) });
        return { ok: true, skipped: 'no-ids' };
    }
    const eventId = body.id || msg.id || `${conversationId}_${body.timestamp || Date.now()}`;
    if (!(await dedup(botId, eventId))) return { ok: true, processed: 0 };

    const text = msg.text || body?.data?.text || '';
    const zMsgId = msg.id || null;
    const platformMessageId = msg.platformMessageId || null;
    const ref = body.metadata?.referral || msg.referral || body.referral || body.conversation?.referral || msg.metadata?.referral || body?.data?.referral || null;
    const storyReply = body.metadata?.storyReply || msg.metadata?.storyReply || null;
    const adId = ref?.ad_id || ref?.adId || msg.metadata?.ad_id || null;
    const postId = ref?.ads_context_data?.post_id || ref?.ads_context_data?.postId || null;
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
    const mediaLabel = !attachment ? '[порожнє повідомлення]'
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
    const user = await findOrCreateZernioUser(contactId, botId, contactName);
    patch.lastUserTs = Date.now();
    if (user && user.metadata && user.metadata.crmClientId) patch.crmClientId = user.metadata.crmClientId;
    const session = await findOrCreateZernioSession(user.id, botId, patch);

    await db.message.create({
        data: {
            sessionId: session.id, role: 'user', content: text || (sharedPost && sharedPost.caption ? ('[переслав ' + sharedPost.kind + '] ' + sharedPost.caption.slice(0, 80)) : mediaLabel),
            metadata: {
                source: 'zernio', zernioMessageId: zMsgId, platformMessageId, messageId: zMsgId,
                ...(adId ? { adId } : {}),
                ...(attachment ? { attachment, attachments: mappedAtts } : {}),
                ...(sharedPost ? { sharedPost } : {}),
            },
        },
    });

    const ctxNow = session.context || {};
    // Детект «клієнт просить людину» тепер ЄДИНИЙ і живе в движку (executeFlowStep) —
    // спрацьовує однаково для всіх каналів (раніше тут був окремий дубль-regex, який
    // міг розійтися з движковим). Адаптер лише транспортує: викликає крок і доставляє
    // повідомлення, які движок вже сам поклав у БД (включно з handoff-відповіддю).
    // Бот замовк лише тому, що не визначив товар? Якщо клієнт САМ прислав товар
    // (рілс/пост/реклама або артикул) — це нова спроба: рушій зніме прапорець і знайде товар.
    const _resumeOnProduct = ctxNow.adminEngaged && ctxNow.handoffKind === 'product_unknown' && !ctxNow.funnelPaused
        && (Boolean(sharedPost && sharedPost.caption) || Boolean(adId)
            || /(?:артикул|арт\.?|код|sku|№)\s*[:#№.-]?\s*[A-Za-zА-Яа-я]{0,5}\d{2,8}|\b[A-Za-z]\d{3,6}\b|\b\d{4,8}\b/i.test(String(text || '')));
    if ((!ctxNow.adminEngaged && !ctxNow.funnelPaused) || _resumeOnProduct) {
        const sinceTime = new Date();
        const inImageUrl = (attachment && attachment.type === 'photo' && attachment.url && String(attachment.url).startsWith('http')) ? attachment.url : null;
        try { await executeFlowStep({ sessionId: session.id, incomingUserMessage: text, incomingImageUrl: inImageUrl }); }
        catch (e) { logger.error('[zernioHandler] flow step failed', { botId, sessionId: session.id, error: e.message }); }
        const outMsgs = await db.message.findMany({ where: { sessionId: session.id, role: 'assistant', createdAt: { gt: sinceTime } }, orderBy: { createdAt: 'asc' } });
        for (const om of outMsgs) {
            const m = om.metadata || {};
            if (m.hidden) continue;
            const att = m.attachment;
            const imgUrl = att && (att.type === 'photo' || att.type === 'image') && att.url && String(att.url).startsWith('http') ? att.url : null;
            try {
                if (imgUrl) {
                    // Усі фото товару з CRM (галерея) поспіль; підпис → текстом.
                    const _fresh = await db.session.findUnique({ where: { id: session.id }, select: { context: true } }).catch(() => null);
                    const _gal = (((_fresh && _fresh.context && _fresh.context.product && _fresh.context.product.imageUrls) || [])).filter((u) => u && String(u).startsWith('http'));
                    // IG приймає до 10 attachment-обʼєктів в одному повідомленні → шлемо АЛЬБОМОМ.
                    const _maxRow = await db.funnelKey.findFirst({ where: { botId, key: 'PRODUCT_PHOTOS_MAX' }, select: { value: true } }).catch(() => null);
                    const _max = Math.min(10, Math.max(1, parseInt((_maxRow && _maxRow.value) || '10', 10) || 10));
                    const _list = (_gal.length ? _gal : [imgUrl]).slice(0, _max);
                    try {
                        const _albumId = await sendMetaPhotoAlbum(botId, contactId, _list);
                        await logDelivery(session.id, botId, 'ig_photo_album', true, null, { nodeId: m.nodeId || null, count: _list.length, messageId: _albumId });
                    } catch (e) {
                        logger.warn('[zernioHandler] альбом не пройшов, шлемо по одному: ' + e.message);
                        await logDelivery(session.id, botId, 'ig_photo_album', false, e.message, { nodeId: m.nodeId || null, count: _list.length });
                        for (const _g of _list) {
                            try { await sendMetaPhoto(botId, contactId, _g); await logDelivery(session.id, botId, 'ig_photo', true, null, { nodeId: m.nodeId || null, url: _g }); }
                            catch (e2) { logger.warn('[zernioHandler] фото: ' + e2.message); await logDelivery(session.id, botId, 'ig_photo', false, e2.message, { nodeId: m.nodeId || null, url: _g }); }
                        }
                    }
                    const cap = att.caption || om.content;
                    if (cap) {
                        const zcid = await sendZernioMessage(botId, conversationId, cap);
                        await logDelivery(session.id, botId, 'zernio', !!zcid, zcid ? null : 'sendZernioMessage не повернув id', { nodeId: m.nodeId || null, text: String(cap).slice(0, 160) });
                    }
                } else if (om.content) {
                    const zid = await sendZernioMessage(botId, conversationId, om.content);
                    await logDelivery(session.id, botId, 'zernio', !!zid, zid ? null : 'sendZernioMessage не повернув id', { nodeId: m.nodeId || null, text: String(om.content).slice(0, 160) });
                    if (zid) await db.message.update({ where: { id: om.id }, data: { metadata: { ...m, zernioMessageId: zid, status: 'sent' } } }).catch(() => {});
                }
            } catch (e) {
                // Фолбек: Meta-фото не пройшло → підпис+URL текстом через Zernio.
                await logDelivery(session.id, botId, imgUrl ? 'ig_photo' : 'zernio', false, e.message, { nodeId: m.nodeId || null });
                if (imgUrl) { await sendZernioMessage(botId, conversationId, (att.caption || om.content || '') + '\n' + imgUrl).catch(() => {}); }
                logger.warn('[zernioHandler] доставка: ' + e.message);
            }
        }
    }
    try {
        const _fr = await db.session.findUnique({ where: { id: session.id }, select: { context: true } });
        const _c = (_fr && _fr.context) || {};
        const _prod = _c.product || {};
        const _hadSignal = adId || (sharedPost && sharedPost.caption);
        if (_prod._via === 'default' && _hadSignal && !_c.unmatchedNotified) {
            const _reason = adId ? ('ad_id ne zmapleno: ' + adId) : 'post/artykul ne znaydeno v CRM';
            const _postPart = (sharedPost && sharedPost.caption) ? (' | Post: ' + String(sharedPost.caption).slice(0, 70)) : '';
            const _msg = 'UVAGA: bot ne vyznachyv tovar, obrobit vruchnu. Klient: ' + (contactName || 'klient') + ' | Prychyna: ' + _reason + _postPart + ' | Povidomlennia: ' + (text || '') + ' | Default: ' + (_prod.name || '');
            await sendTelegramAlert(botId, _msg, session.id);
            await db.session.update({ where: { id: session.id }, data: { context: { ..._c, unmatchedNotified: true } } }).catch(() => {});
        }
    } catch (e) { logger.warn('[zernioHandler] unmatched notify: ' + e.message); }
    try { const _fs = await db.session.findUnique({ where: { id: session.id }, select: { context: true } }); const _cc = _fs && _fs.context && _fs.context.crmClientId; if (_cc && (!user.metadata || user.metadata.crmClientId !== _cc)) await db.user.update({ where: { id: user.id }, data: { metadata: { ...(user.metadata || {}), crmClientId: _cc } } }).catch(function(){}); } catch (e) {}
    logger.info('[zernioHandler] Inbound stored', { botId, sessionId: session.id, hasAd: !!adId });
    return { ok: true, processed: 1 };
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
    if (!session) { logger.warn('[zernioHandler] event без сесії', { botId, event }); return { ok: true, processed: 0 }; }

    // ── Статуси доставки → позначка на конкретному повідомленні ──
    if (event === 'message.delivered' || event === 'message.read' || event === 'message.failed') {
        const target = await findMessageByZid(session.id, msg.id, msg.platformMessageId);
        const status = event === 'message.read' ? 'read' : event === 'message.failed' ? 'failed' : 'delivered';
        if (target) {
            const cur = target.metadata || {};
            const rank = { sent: 1, delivered: 2, read: 3 };
            // read не «даунгрейдиться» до delivered
            const nextStatus = status === 'failed' ? 'failed' : ((rank[status] || 0) >= (rank[cur.status] || 0) ? status : cur.status);
            await db.message.update({ where: { id: target.id }, data: { metadata: { ...cur, status: nextStatus, ...(event === 'message.failed' && body.error ? { failError: body.error.message || body.error.title } : {}) } } }).catch(() => {});
            return { ok: true, processed: 1, attachedTo: target.id };
        }
        // фолбек — рядок-подія
        await db.message.create({ data: { sessionId: session.id, role: 'event', content: EVENT_CONTENT[event] || event, metadata: { source: 'zernio', eventType: event } } });
        return { ok: true, processed: 1 };
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
        await db.message.create({ data: { sessionId: session.id, role: 'assistant', content: msg.text || '[повідомлення]', metadata: { source: 'zernio_inbox', zernioMessageId: msg.id || null, platformMessageId: msg.platformMessageId || null, status: 'sent' } } });
        return { ok: true, processed: 1 };
    }

    // ── Коментарі / інші події → рядок-подія ──
    let content;
    if (event === 'comment.received') {
        const c = body.comment || {};
        const t = c.text || '';
        content = `💬 Коментар${c.ad ? ' (з реклами)' : ''}${t ? ': ' + t : ''}`;
    } else {
        content = EVENT_CONTENT[event] || `ℹ️ ${event}`;
    }
    await db.message.create({ data: { sessionId: session.id, role: 'event', content, metadata: { source: 'zernio', eventType: event } } });
    logger.info('[zernioHandler] side event stored', { botId, event, sessionId: session.id });
    return { ok: true, processed: 1 };
}

module.exports = { handleZernioEvent, sendZernioMessage };

