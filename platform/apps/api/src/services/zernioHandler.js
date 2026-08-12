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
    return { conv, contact, msg, conversationId, contactId, contactName };
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
    return data.id || data.messageId || data.message?.id || null;
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
    const { msg, conversationId, contactId, contactName } = extractCommon(body);
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
    const ref = msg.referral || body.referral || body.conversation?.referral || msg.metadata?.referral || body?.data?.referral || null;
    const adId = ref?.ad_id || ref?.adId || msg.metadata?.ad_id || null;

    // Вхідне медіа (фото/відео/файл) від клієнта.
    const attachments = Array.isArray(msg.attachments) ? msg.attachments : (Array.isArray(msg.media) ? msg.media : []);
    let attachment = null;
    if (attachments.length) {
        const a = attachments[0] || {};
        const url = a.url || a.payload?.url || a.src || a.mediaUrl || a.link || null;
        const rawType = String(a.type || a.mimeType || a.contentType || '').toLowerCase();
        const type = /video|animation|gif/.test(rawType) ? 'video' : /image|photo/.test(rawType) ? 'photo' : (a.type || 'file');
        if (url) attachment = { type, url, caption: text || '' };
    }
    const mediaLabel = attachment ? (attachment.type === 'video' ? '[відео]' : attachment.type === 'photo' ? '[фото]' : '[вкладення]') : '[порожнє повідомлення]';

    const patch = { conversationId, psid: String(contactId), senderName: contactName || undefined };
    if (adId) { patch.entryAdId = String(adId); patch.lastReferral = ref; }
    const user = await findOrCreateZernioUser(contactId, botId, contactName);
    const session = await findOrCreateZernioSession(user.id, botId, patch);

    await db.message.create({
        data: {
            sessionId: session.id, role: 'user', content: text || mediaLabel,
            metadata: { source: 'zernio', zernioMessageId: zMsgId, platformMessageId, messageId: zMsgId, ...(adId ? { adId } : {}), ...(attachment ? { attachment } : {}) },
        },
    });

    const ctxNow = session.context || {};
    if (!ctxNow.adminEngaged && !ctxNow.funnelPaused) {
        const sinceTime = new Date();
        try { await executeFlowStep({ sessionId: session.id, incomingUserMessage: text }); }
        catch (e) { logger.error('[zernioHandler] flow step failed', { botId, sessionId: session.id, error: e.message }); }
        const outMsgs = await db.message.findMany({ where: { sessionId: session.id, role: 'assistant', createdAt: { gt: sinceTime } }, orderBy: { createdAt: 'asc' } });
        for (const om of outMsgs) {
            const m = om.metadata || {};
            if (m.hidden) continue;
            const att = m.attachment;
            let out = om.content;
            if (att && (att.type === 'photo' || att.type === 'image')) out = (att.caption || om.content || '') + (att.url && String(att.url).startsWith('http') ? `\n${att.url}` : '');
            if (!out) continue;
            try {
                const zid = await sendZernioMessage(botId, conversationId, out);
                if (zid) await db.message.update({ where: { id: om.id }, data: { metadata: { ...m, zernioMessageId: zid, status: 'sent' } } }).catch(() => {});
            } catch (e) { logger.warn('[zernioHandler] доставка чекає (токен/акаунт Zernio)', { error: e.message }); }
        }
    }
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
    if (contactId) {
        const user = await findOrCreateZernioUser(contactId, botId, contactName);
        session = await findOrCreateZernioSession(user.id, botId, { conversationId, psid: String(contactId), senderName: contactName || undefined });
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
