'use strict';

/**
 * zernioHandler.js
 *
 * Транспорт для IG-воронки через Zernio (Meta Tech Provider) — працює БЕЗ App Review.
 * Ізольований від Meta-direct (instagramHandler) і Telegram.
 *
 * Вхід:  POST /webhook/zernio/:botId  → handleZernioEvent(botId, body)
 *   Формат Zernio: { event:'message.received', data:{ messageId, conversationId, platform,
 *     direction:'incoming', text, sender:{id:PSID, name}, referral?:{ad_id,source,type}, timestamp } }
 *   referral (ad_id) приходить ЛИШЕ в 1-му повідомленні діалогу → зберігаємо у context.entryAdId.
 *
 * Вихід: sendZernioMessage(botId, conversationId, text)
 *   POST {ZERNIO_SEND_URL з підставленим conversationId}, Bearer ZERNIO_API_TOKEN,
 *   body { accountId: ZERNIO_ACCOUNT_ID, message: text }.
 *
 * Ідентифікація: PSID (`psid_...`) — рядок, не число. Зберігаємо у User.metadata.psid і шукаємо
 * JSON-фільтром; для required-унікального User.telegramId кладемо синтетичний BigInt із хешу PSID.
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

// Синтетичний унікальний telegramId із PSID (User.telegramId — required+unique BigInt).
function synthIdFromPsid(psid) {
    const hex = crypto.createHash('sha256').update('zernio:' + String(psid)).digest('hex').slice(0, 15);
    return BigInt('0x' + hex); // ~ до 1.15e18, поміщається в PG BigInt
}

async function findOrCreateZernioUser(psid, botId, name) {
    const existing = await db.user.findFirst({ where: { metadata: { path: ['psid'], equals: String(psid) } } });
    if (existing) {
        if (name && existing.firstName !== name) {
            await db.user.update({ where: { id: existing.id }, data: { firstName: name } }).catch(() => {});
        }
        return existing;
    }
    const bot = await db.bot.findUnique({ where: { id: botId }, select: { projectId: true } });
    let tid = synthIdFromPsid(psid);
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            return await db.user.create({
                data: {
                    telegramId: tid,
                    firstName: name || 'Instagram',
                    username: 'ig_' + String(psid).replace(/[^0-9a-zA-Z]/g, '').slice(-6),
                    languageCode: 'uk',
                    projectId: bot?.projectId,
                    metadata: { source: 'zernio', channel: 'zernio', psid: String(psid) },
                },
            });
        } catch (e) {
            if (e.code === 'P2002') { tid = tid + 1n; continue; } // колізія telegramId — зсув
            throw e;
        }
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
                channel: 'zernio', ...patch,
                currentNode: startNode?.id || null,
                flowRuntime: { currentNodeId: startNode?.id || null, waitingForUser: false, nodesVisited: [], lastUserMessage: '', dialogHistory: {} },
            },
        },
    });
}

// ---------------------------------------------------------------------------
// Вихідне повідомлення через Zernio
// ---------------------------------------------------------------------------
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
    return data.id || data.messageId || null;
}

// ---------------------------------------------------------------------------
// Головний вхідний обробник
// ---------------------------------------------------------------------------
// Читабельні лейбли для подій-статусів (реакція/коментар — динамічні нижче).
const EVENT_CONTENT = {
    'message.sent': '📤 Повідомлення надіслано',
    'message.edited': '✏️ Повідомлення відредаговано',
    'message.deleted': '🗑 Повідомлення видалено',
    'message.delivered': '✓ Доставлено',
    'message.read': '✓✓ Прочитано',
    'message.failed': '⚠️ Не доставлено',
    'conversation.started': '🟢 Розмову розпочато',
    'call.received': '📞 Вхідний дзвінок',
};

async function findSessionByConversation(botId, conversationId) {
    if (!conversationId) return null;
    return db.session.findFirst({
        where: { botId, context: { path: ['conversationId'], equals: String(conversationId) } },
        orderBy: { startedAt: 'desc' },
    });
}

// Диспетчер вебхука Zernio: message.received веде діалог; решта подій пишеться у стрічку сесії.
async function handleZernioEvent(botId, body) {
    const event = body?.event;
    if (!event) return { ok: true, skipped: 'no-event' };
    if (event === 'message.received') return handleIncomingMessage(botId, body.data || {});
    return handleSideEvent(botId, event, body.data || {});
}

// Побічні події (лайки, прочитано, доставлено, дзвінки, коментарі…) → рядок-подія в сесії.
async function handleSideEvent(botId, event, d) {
    const psid = d.sender?.id || d.from?.id || d.commenter?.id || d.user?.id || null;
    const conversationId = d.conversationId || null;
    const name = d.sender?.name || d.from?.name || d.commenter?.name || null;

    const evId = d.id || d.messageId || d.reactionId || d.commentId || `${event}_${conversationId || psid}_${d.timestamp || Date.now()}`;
    try {
        await db.processedMessage.create({ data: { botId, updateId: `zn_${evId}` } });
    } catch (e) {
        if (e.code === 'P2002') return { ok: true, processed: 0 };
        throw e;
    }

    let session = null;
    if (psid) {
        const user = await findOrCreateZernioUser(psid, botId, name);
        session = await findOrCreateZernioSession(user.id, botId, { conversationId, psid: String(psid), senderName: name || undefined });
    } else {
        session = await findSessionByConversation(botId, conversationId);
    }
    if (!session) {
        logger.warn('[zernioHandler] event without resolvable session', { botId, event });
        return { ok: true, processed: 0 };
    }

    let content;
    if (event === 'reaction.received') {
        const emo = d.reaction?.emoji || d.emoji || '❤️';
        content = `${emo} Реакція`;
    } else if (event === 'comment.received') {
        const t = d.text || d.comment?.text || '';
        content = `💬 Коментар${t ? ': ' + t : ''}`;
    } else {
        content = EVENT_CONTENT[event] || `ℹ️ ${event}`;
    }

    await db.message.create({
        data: {
            sessionId: session.id,
            role: 'event',
            content,
            metadata: { source: 'zernio', eventType: event, raw: { messageId: d.messageId || null, conversationId, emoji: d.reaction?.emoji || d.emoji || null, text: d.text || null } },
        },
    });
    logger.info('[zernioHandler] side event stored', { botId, event, sessionId: session.id });
    return { ok: true, processed: 1 };
}

async function handleIncomingMessage(botId, d) {
    if (d.direction && d.direction !== 'incoming') return { ok: true, skipped: 'not-incoming' };

    const psid = d.sender?.id;
    const conversationId = d.conversationId;
    if (!psid || !conversationId) {
        logger.warn('[zernioHandler] Missing psid/conversationId', { botId });
        return { ok: true, skipped: 'no-ids' };
    }
    const text = typeof d.text === 'string' ? d.text : '';
    const name = d.sender?.name || null;
    const adId = d.referral?.ad_id || null; // лише в 1-му повідомленні діалогу
    const messageId = d.messageId || `${conversationId}_${d.timestamp || Date.now()}`;

    // Ідемпотентність
    try {
        await db.processedMessage.create({ data: { botId, updateId: `zn_${messageId}` } });
    } catch (e) {
        if (e.code === 'P2002') { logger.info('[zernioHandler] Duplicate messageId', { botId, messageId }); return { ok: true, processed: 0 }; }
        throw e;
    }

    const user = await findOrCreateZernioUser(psid, botId, name);
    const patch = { conversationId, psid: String(psid), senderName: name || undefined };
    if (adId) { patch.entryAdId = String(adId); patch.lastReferral = d.referral; }
    const session = await findOrCreateZernioSession(user.id, botId, patch);

    await db.message.create({
        data: { sessionId: session.id, role: 'user', content: text || '[порожнє повідомлення]',
            metadata: { source: 'zernio', messageId, conversationId, ...(adId ? { adId } : {}) } },
    });

    // Проганяємо флоу і доставляємо відповіді через Zernio.
    const ctxNow = session.context || {};
    if (!ctxNow.adminEngaged && !ctxNow.funnelPaused) {
        const sinceTime = new Date();
        try {
            await executeFlowStep({ sessionId: session.id, incomingUserMessage: text });
        } catch (e) {
            logger.error('[zernioHandler] flow step failed', { botId, sessionId: session.id, error: e.message });
        }
        const outMsgs = await db.message.findMany({
            where: { sessionId: session.id, role: 'assistant', createdAt: { gt: sinceTime } },
            orderBy: { createdAt: 'asc' },
        });
        for (const om of outMsgs) {
            const meta = om.metadata || {};
            if (meta.hidden) continue;
            // Zernio (за ТЗ) приймає лише текстовий message. Фото — шлемо підпис/URL текстом.
            const att = meta.attachment;
            let out = om.content;
            if (att && (att.type === 'photo' || att.type === 'image')) {
                out = (att.caption || om.content || '') + (att.url && String(att.url).startsWith('http') ? `\n${att.url}` : '');
            }
            if (!out) continue;
            try {
                await sendZernioMessage(botId, conversationId, out);
            } catch (e) {
                logger.warn('[zernioHandler] доставка чекає (токен/акаунт Zernio)', { error: e.message });
            }
        }
    }

    logger.info('[zernioHandler] Inbound stored', { botId, sessionId: session.id, hasAd: !!adId });
    return { ok: true, processed: 1 };
}

module.exports = { handleZernioEvent, sendZernioMessage };
