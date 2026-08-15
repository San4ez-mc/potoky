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
const { executeFlowStep } = require('./testSession');

const GRAPH_VERSION_DEFAULT = 'v21.0';

// ---------------------------------------------------------------------------
// Витяг ключів воронки
// ---------------------------------------------------------------------------
async function getIgKeys(botId) {
    const keys = await db.funnelKey.findMany({
        where: {
            botId,
            key: { in: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_SEND_API_BASE', 'INSTAGRAM_GRAPH_VERSION', 'INSTAGRAM_BUSINESS_ID'] },
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
    // Instagram-діалог — це один безперервний тред на користувача. Тому переваикористовуємо
    // ОСТАННЮ сесію (незалежно від completed) і реактивуємо, а не плодимо нові.
    const existing = await db.session.findFirst({
        where: { userId, botId },
        orderBy: { startedAt: 'desc' },
    });
    if (existing) {
        const ctx = existing.context || {};
        const patch = {};
        if (ctx.channel !== 'instagram') patch.channel = 'instagram';
        if (ctx.igsid !== String(igsid)) patch.igsid = String(igsid);
        for (const [k, v] of Object.entries(extraCtx)) if (v != null) patch[k] = v;
        const data = { lastActive: new Date() };
        if (Object.keys(patch).length) data.context = { ...ctx, ...patch };
        // Реактивуємо, якщо флоу welcome завершив сесію (message-нода завершує флоу).
        if (!existing.isActive) { data.isActive = true; data.completedAt = null; if (existing.state === 'completed') data.state = 'inbox'; }
        return db.session.update({ where: { id: existing.id }, data });
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
        let events = entry.messaging || entry.standby || [];
        // Частина IG-подій приходить у форматі changes[] (field: "messages") замість messaging[].
        // Мапимо value → messaging-подібний обʼєкт (там ті самі sender/recipient/message).
        if ((!events || !events.length) && Array.isArray(entry.changes)) {
            events = entry.changes
                .filter((c) => c && c.value && (c.field === 'messages' || c.field === 'message'))
                .map((c) => c.value);
        }
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

                // ── Проганяємо воронку на КОЖНЕ повідомлення і доставляємо відповіді в Direct.
                //    Флоу сам паузиться на claude/wait-нодах, тож спаму вітань немає.
                //    Оператор може перехопити: adminEngaged / funnelPaused ставлять флоу на паузу.
                const ctxNow = session.context || {};
                if (!ctxNow.adminEngaged && !ctxNow.funnelPaused) {
                    const sinceTime = new Date();
                    // Вхідне зображення (скрін/квитанція оплати) → context.lastReceiptImageUrl.
                    let inImageUrl = null;
                    const _atts = m.message && Array.isArray(m.message.attachments) ? m.message.attachments : [];
                    for (const a of _atts) {
                        const u = a && a.payload && a.payload.url;
                        const t = String((a && a.type) || '').toLowerCase();
                        if (u && String(u).startsWith('http') && (t === 'image' || t === 'photo')) { inImageUrl = u; break; }
                    }
                    try {
                        await executeFlowStep({ sessionId: session.id, incomingUserMessage: text, incomingImageUrl: inImageUrl });
                    } catch (e) {
                        logger.error('[instagramHandler] flow step failed', { botId, sessionId: session.id, error: e.message });
                    }
                    const outMsgs = await db.message.findMany({
                        where: { sessionId: session.id, role: 'assistant', createdAt: { gt: sinceTime } },
                        orderBy: { createdAt: 'asc' },
                    });
                    for (const om of outMsgs) {
                        const meta = om.metadata || {};
                        if (meta.hidden) continue;
                        const att = meta.attachment;
                        const kb = Array.isArray(meta.keyboard) ? meta.keyboard : null;
                        // Telegram inline-кнопки → Instagram quick_replies.
                        const quickReplies = kb
                            ? kb.reduce((acc, row) => acc.concat(Array.isArray(row) ? row : [row]), [])
                                .filter((b) => b && b.text)
                                .map((b) => ({ title: b.text, payload: b.callback_data || b.text }))
                            : null;
                        try {
                            if (att && (att.type === 'photo' || att.type === 'image') && att.url && String(att.url).startsWith('http')) {
                                await sendInstagramMessage(botId, senderId, '', { imageUrl: att.url });
                                const cap = att.caption || om.content;
                                if (cap) await sendInstagramMessage(botId, senderId, cap, quickReplies ? { quickReplies } : {});
                            } else if (om.content) {
                                const dmid = await sendInstagramMessage(botId, senderId, om.content, quickReplies ? { quickReplies } : {});
                                if (dmid) await db.message.update({ where: { id: om.id }, data: { metadata: { ...meta, instagramMessageId: dmid } } }).catch(() => {});
                            }
                        } catch (e) {
                            logger.warn('[instagramHandler] доставка відповіді чекає (токен/доступ)', { error: e.message });
                        }
                    }
                }

                processed++;
                logger.info('[instagramHandler] Inbound IG message stored', {
                    botId, sessionId: session.id, igsid: String(senderId), hasReferral: !!referral,
                });
            } catch (err) {
                logger.error('[instagramHandler] Failed to process messaging event', { botId, error: err.message, stack: err.stack });
            }
        }
    }
    if (processed === 0) {
        // Діагностика: показуємо сиру структуру, щоб точно знати формат події від Meta.
        logger.warn('[instagramHandler] 0 подій опрацьовано — RAW payload', { botId, raw: JSON.stringify(body).slice(0, 1800) });
    }
    return { ok: true, processed };
}

// ---------------------------------------------------------------------------
// Вихідне повідомлення (ручна відповідь оператора)
// ---------------------------------------------------------------------------
async function sendInstagramMessage(botId, igsid, text, opts = {}) {
    const km = await getIgKeys(botId);
    const token = km.INSTAGRAM_ACCESS_TOKEN;
    if (!isRealToken(token)) {
        throw new Error('Instagram access token ще не налаштований (INSTAGRAM_ACCESS_TOKEN). Додайте токен клієнта у ключі воронки, щоб відповідати в Direct.');
    }
    if (!igsid) throw new Error('Немає IGSID отримувача в сесії — неможливо надіслати відповідь.');

    const version = km.INSTAGRAM_GRAPH_VERSION || GRAPH_VERSION_DEFAULT;
    const base = km.INSTAGRAM_SEND_API_BASE || `https://graph.facebook.com/${version}/me/messages`;
    const url = `${base}${base.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;

    // message: або зображення (attachment), або текст (+опційно quick_replies).
    const message = {};
    if (opts.imageUrl) {
        message.attachment = { type: 'image', payload: { url: String(opts.imageUrl), is_reusable: true } };
    } else {
        message.text = String(text || '');
        if (Array.isArray(opts.quickReplies) && opts.quickReplies.length) {
            message.quick_replies = opts.quickReplies.slice(0, 13).map((q) => ({
                content_type: 'text',
                title: String(q.title || '').slice(0, 20),
                payload: String(q.payload || q.title || '').slice(0, 1000),
            }));
        }
    }
    const payload = {
        recipient: { id: String(igsid) },
        message,
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
