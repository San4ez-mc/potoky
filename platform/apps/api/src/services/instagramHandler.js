'use strict';

/**
 * instagramHandler.js
 *
 * Вхідні повідомлення з Instagram (реклама → Direct) і вихідні відповіді через
 * Meta Send API. Ізольований від Telegram — платформний Telegram-хендлер не чіпаємо.
 *
 * Вхід:  POST /webhook/instagram/:botId  → handleInstagramEvent(botId, body)
 *        Створює/знаходить користувача + сесію, зберігає вхідне повідомлення.
 *        Воронку НЕ проганяємо (поки порожня) — оператор відповідає вручну з «Сесій».
 *
 * Вихід: sendInstagramMessage(botId, igsid, text) — ручна відповідь оператора
 *        (викликається з POST /api/sessions/:id/send для IG-сесій).
 *
 * Ідентифікація користувача: Instagram-Scoped User ID (IGSID) — 16-17-значне число,
 * значно вище діапазону Telegram-ID (< ~1e12), тож колізій у User.telegramId немає.
 * Зберігаємо IGSID у telegramId (унікальність працює природно) + дублюємо в metadata.
 */

const { db } = require('@platform/db');
const logger = require('@platform/logger');

const GRAPH_VERSION_DEFAULT = 'v21.0';

// ---------------------------------------------------------------------------
// Витяг ключів воронки
// ---------------------------------------------------------------------------
async function getIgKeys(botId) {
    const keys = await db.funnelKey.findMany({
        where: {
            botId,
            key: { in: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_SEND_API_BASE', 'INSTAGRAM_GRAPH_VERSION', 'IG_BUSINESS_ID'] },
        },
        select: { key: true, value: true },
    });
    return Object.fromEntries(keys.map((k) => [k.key, (k.value || '').trim()]));
}

function isRealToken(v) {
    return typeof v === 'string' && v.length > 10 && v !== 'REPLACE_ME';
}

// ---------------------------------------------------------------------------
// Користувач + сесія (IG-специфічні, без Telegram-залежностей)
// ---------------------------------------------------------------------------
async function findOrCreateIgUser(igsid, botId, profile = {}) {
    const telegramId = BigInt(igsid); // IGSID — числовий; діапазон не перетинається з Telegram
    const existing = await db.user.findUnique({ where: { telegramId } });
    if (existing) return existing;

    const bot = await db.bot.findUnique({ where: { id: botId }, select: { projectId: true } });

    return db.user.create({
        data: {
            telegramId,
            username: profile.username || `ig_${String(igsid).slice(-6)}`,
            firstName: profile.firstName || 'Instagram',
            lastName: profile.lastName || null,
            languageCode: 'uk',
            projectId: bot?.projectId,
            metadata: { source: 'instagram', channel: 'instagram', igsid: String(igsid) },
        },
    });
}

async function findOrCreateIgSession(userId, botId, igsid, extraCtx = {}) {
    const existing = await db.session.findFirst({
        where: { userId, botId, state: { not: 'completed' } },
        orderBy: { startedAt: 'desc' },
    });
    if (existing) {
        // Дотягуємо канал/IGSID + свіжий реферал (реклама) в контекст, якщо зʼявився.
        const ctx = existing.context || {};
        const patch = {};
        if (ctx.channel !== 'instagram') patch.channel = 'instagram';
        if (ctx.igsid !== String(igsid)) patch.igsid = String(igsid);
        for (const [k, v] of Object.entries(extraCtx)) if (v != null) patch[k] = v;
        if (Object.keys(patch).length) {
            const updated = await db.session.update({
                where: { id: existing.id },
                data: { context: { ...ctx, ...patch }, lastActive: new Date() },
            });
            return updated;
        }
        await db.session.update({ where: { id: existing.id }, data: { lastActive: new Date() } });
        return existing;
    }

    const flowDef = await db.flowDefinition.findUnique({ where: { botId } });
    const nodes = Array.isArray(flowDef?.nodes) ? flowDef.nodes : [];
    const startNode = nodes.find((n) => n.type === 'start') || nodes[0] || null;

    return db.session.create({
        data: {
            userId,
            botId,
            state: startNode?.id || 'start',
            context: {
                channel: 'instagram',
                igsid: String(igsid),
                currentNode: startNode?.id || null,
                flowRuntime: {
                    currentNodeId: startNode?.id || null,
                    waitingForUser: false,
                    nodesVisited: [],
                    lastUserMessage: '',
                    dialogHistory: {},
                },
                ...extraCtx,
            },
        },
    });
}

// ---------------------------------------------------------------------------
// Розбір одного messaging-події Instagram
// ---------------------------------------------------------------------------
function extractText(m) {
    if (m.message) {
        if (typeof m.message.text === 'string' && m.message.text) return m.message.text;
        if (m.message.quick_reply?.payload) return String(m.message.quick_reply.payload);
        if (Array.isArray(m.message.attachments) && m.message.attachments.length) {
            const a = m.message.attachments[0];
            return `[вкладення: ${a.type || 'media'}]${a.payload?.url ? ' ' + a.payload.url : ''}`;
        }
    }
    if (m.postback) return String(m.postback.title || m.postback.payload || '[postback]');
    return '';
}

// Реферал реклами: звідки прийшов клієнт (для підлаштування під товар/рекламу).
function extractReferral(m) {
    const r = m.referral || m.postback?.referral || m.message?.referral;
    if (!r) return null;
    return {
        ref: r.ref || null,
        adId: r.ad_id || r.ads_context_data?.ad_id || null,
        source: r.source || null,
        type: r.type || null,
        adTitle: r.ads_context_data?.ad_title || null,
    };
}

// ---------------------------------------------------------------------------
// Головний вхідний обробник
// ---------------------------------------------------------------------------
async function handleInstagramEvent(botId, body) {
    if (!body || (body.object !== 'instagram' && body.object !== 'page')) {
        logger.info('[instagramHandler] Ignoring non-instagram payload', { botId, object: body?.object });
        return { ok: true, skipped: 'not-instagram' };
    }

    let processed = 0;
    for (const entry of body.entry || []) {
        const events = entry.messaging || entry.standby || [];
        for (const m of events) {
            try {
                // Echo — це наше ж вихідне повідомлення, повернене Meta. Пропускаємо.
                if (m.message?.is_echo) continue;

                const senderId = m.sender?.id;
                if (!senderId) continue;

                const text = extractText(m);
                const referral = extractReferral(m);
                const mid = m.message?.mid || `${senderId}_${m.timestamp || Date.now()}`;

                // Ідемпотентність: Meta ретраїть — дубль mid тихо ігноруємо.
                try {
                    await db.processedMessage.create({ data: { botId, updateId: `ig_${mid}` } });
                } catch (e) {
                    if (e.code === 'P2002') {
                        logger.info('[instagramHandler] Duplicate mid skipped', { botId, mid });
                        continue;
                    }
                    throw e;
                }

                const user = await findOrCreateIgUser(senderId, botId);
                const extraCtx = {};
                if (referral) { extraCtx.lastReferral = referral; extraCtx.entryAdId = referral.adId || undefined; }
                const session = await findOrCreateIgSession(user.id, botId, senderId, extraCtx);

                await db.message.create({
                    data: {
                        sessionId: session.id,
                        role: 'user',
                        content: text || '[порожнє повідомлення]',
                        metadata: { source: 'instagram', mid, ...(referral ? { referral } : {}) },
                    },
                });

                processed++;
                logger.info('[instagramHandler] Inbound IG message stored', {
                    botId, sessionId: session.id, igsid: String(senderId), hasReferral: !!referral,
                });
            } catch (err) {
                logger.error('[instagramHandler] Failed to process messaging event', { botId, error: err.message, stack: err.stack });
            }
        }
    }
    return { ok: true, processed };
}

// ---------------------------------------------------------------------------
// Вихідне повідомлення (ручна відповідь оператора)
// ---------------------------------------------------------------------------
async function sendInstagramMessage(botId, igsid, text) {
    const km = await getIgKeys(botId);
    const token = km.INSTAGRAM_ACCESS_TOKEN;
    if (!isRealToken(token)) {
        throw new Error('Instagram access token ще не налаштований (INSTAGRAM_ACCESS_TOKEN). Додайте токен клієнта у ключі воронки, щоб відповідати в Direct.');
    }
    if (!igsid) throw new Error('Немає IGSID отримувача в сесії — неможливо надіслати відповідь.');

    const version = km.INSTAGRAM_GRAPH_VERSION || GRAPH_VERSION_DEFAULT;
    const base = km.INSTAGRAM_SEND_API_BASE || `https://graph.facebook.com/${version}/me/messages`;
    const url = `${base}${base.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;

    const payload = {
        recipient: { id: String(igsid) },
        message: { text: String(text || '') },
        messaging_type: 'RESPONSE',
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        logger.warn('[instagramHandler] Send API error', { botId, status: res.status, error: msg });
        throw new Error(`Instagram Send API: ${msg}`);
    }
    return data.message_id || data.mid || null;
}

module.exports = { handleInstagramEvent, sendInstagramMessage };
