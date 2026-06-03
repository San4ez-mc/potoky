'use strict';

/**
 * platformBotHandler.js
 *
 * Production Telegram webhook handler for platform flow bots.
 *
 * Routing logic:
 *   /start <slug>  → find bot by slug in the same project, route there
 *   /start         → returning user  → restart their last non-system bot
 *                    new user        → route to system bot (settings.isSystem=true), if any
 *   /start lesson_X_Y → store lessonSlug, keep current bot
 *   <message>      → continue active session on whatever bot it belongs to
 */

const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { executeFlowStep } = require('./testSession');

// ---------------------------------------------------------------------------
// Telegram API helper (direct HTTP, per-bot token)
// ---------------------------------------------------------------------------

async function tgRequest(token, method, payload) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const body = JSON.stringify(payload);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.warn('[platformBotHandler] Telegram API error', { method, status: res.status, body: text });
    }
    // Parse and return JSON so callers can read result.message_id
    try { return await res.json(); } catch { return {}; }
}

/**
 * Mark all active sessions for a user+bot as unsubscribed when we get 403.
 */
async function markUnsubscribed(botId, telegramChatId) {
    try {
        await db.session.updateMany({
            where: {
                botId,
                isActive: true,
                user: { telegramId: BigInt(telegramChatId) },
            },
            data: { isActive: false, state: 'unsubscribed' },
        });
        logger.info('[platformBotHandler] Marked user as unsubscribed', { botId, telegramChatId });
    } catch (err) {
        logger.warn('[platformBotHandler] Failed to mark unsubscribed', { error: err.message });
    }
}

async function sendTelegramMessage(token, chatId, text, extra = {}) {
    const MAX_LEN = 4000;
    const parts = [];
    let remaining = String(text || '');
    while (remaining.length > MAX_LEN) {
        parts.push(remaining.slice(0, MAX_LEN));
        remaining = remaining.slice(MAX_LEN);
    }
    if (remaining.length > 0) parts.push(remaining);

    for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: parts[i],
            parse_mode: 'HTML',
            ...(isLast ? extra : {}),
        });
    }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function isValidTelegramToken(val) {
    return typeof val === 'string' && /^\d+:[A-Za-z0-9_-]{20,}$/.test(val.trim());
}

async function getBotToken(botId) {
    const keys = await db.funnelKey.findMany({
        where: { botId, key: { in: ['TELEGRAM_CONNECTOR_ID', 'TELEGRAM_BOT_TOKEN'] } },
        select: { key: true, value: true },
    });
    const keyMap = Object.fromEntries(keys.map(k => [k.key, k.value]));

    const connectorId = keyMap.TELEGRAM_CONNECTOR_ID;
    if (connectorId) {
        try {
            const connector = await db.savedConnector.findUnique({ where: { id: connectorId }, select: { config: true } });
            const t = connector?.config?.token;
            if (isValidTelegramToken(t)) return t.trim();
        } catch { /* ignore */ }
    }
    const directVal = keyMap.TELEGRAM_BOT_TOKEN?.trim();
    if (isValidTelegramToken(directVal)) return directVal;
    const envVal = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (isValidTelegramToken(envVal)) return envVal;
    return null;
}

/**
 * Extract incoming media (photo / video / document / animation) from a Telegram
 * message and resolve a downloadable URL. Returns null if no media present.
 * Result: { type, fileId, fileUrl, fileName, mimeType, caption }
 */
async function extractIncomingMedia(message, token) {
    if (!message) return null;
    let type = null;
    let fileId = null;
    let fileName = null;
    let mimeType = null;

    if (Array.isArray(message.photo) && message.photo.length) {
        // largest size is last
        const largest = message.photo[message.photo.length - 1];
        type = 'photo';
        fileId = largest?.file_id;
    } else if (message.video) {
        type = 'video';
        fileId = message.video.file_id;
        mimeType = message.video.mime_type || null;
    } else if (message.animation) {
        type = 'animation';
        fileId = message.animation.file_id;
        mimeType = message.animation.mime_type || null;
    } else if (message.voice) {
        type = 'voice';
        fileId = message.voice.file_id;
        mimeType = message.voice.mime_type || 'audio/ogg';
    } else if (message.audio) {
        type = 'audio';
        fileId = message.audio.file_id;
        fileName = message.audio.file_name || null;
        mimeType = message.audio.mime_type || null;
    } else if (message.document) {
        const mt = message.document.mime_type || '';
        type = mt.startsWith('video') ? 'video'
            : mt.startsWith('image') ? 'photo'
            : mt.startsWith('audio') ? 'audio'
            : 'document';
        fileId = message.document.file_id;
        fileName = message.document.file_name || null;
        mimeType = mt || null;
    }

    if (!fileId) return null;

    let fileUrl = null;
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
        const data = await res.json();
        const filePath = data?.result?.file_path;
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
        }
    } catch (err) {
        logger.warn('[platformBotHandler] getFile failed for incoming media', { error: err.message });
    }

    return {
        type,
        fileId,
        fileUrl,
        fileName,
        mimeType,
        caption: message.caption || '',
    };
}

/**
 * Resolve an OpenAI API key for a bot (for Whisper transcription).
 * Order: funnelKey OPENAI_API_KEY/GPT_API_KEY → saved connector via *_CONNECTOR_ID
 * → any active openai_gpt4 connector.
 */
async function resolveOpenAIKey(botId) {
    try {
        const keys = await db.funnelKey.findMany({
            where: { botId, key: { in: ['OPENAI_API_KEY', 'GPT_API_KEY', 'OPENAI_CONNECTOR_ID', 'GPT_CONNECTOR_ID'] } },
            select: { key: true, value: true },
        });
        const km = Object.fromEntries(keys.map(k => [k.key, k.value]));
        const direct = (km.OPENAI_API_KEY || km.GPT_API_KEY || '').trim();
        if (direct) return direct;
        const cid = (km.OPENAI_CONNECTOR_ID || km.GPT_CONNECTOR_ID || '').trim();
        if (cid) {
            const c = await db.savedConnector.findUnique({ where: { id: cid }, select: { config: true } });
            const k = c?.config?.api_key || c?.config?.apiKey || c?.config?.key;
            if (k) return String(k).trim();
        }
        const any = await db.savedConnector.findFirst({ where: { type: 'openai_gpt4', isActive: true }, select: { config: true } });
        if (any) {
            const k = any.config?.api_key || any.config?.apiKey || any.config?.key;
            if (k) return String(k).trim();
        }
    } catch (err) {
        logger.warn('[platformBotHandler] resolveOpenAIKey failed', { error: err.message });
    }
    return '';
}

/**
 * Transcribe an audio file (Telegram voice note) via OpenAI Whisper (whisper-1).
 * Returns plain text or null.
 */
async function transcribeAudio(fileUrl, apiKey, language = 'uk') {
    try {
        const fileRes = await fetch(fileUrl);
        if (!fileRes.ok) return null;
        const buf = Buffer.from(await fileRes.arrayBuffer());
        const form = new FormData();
        form.append('file', new Blob([buf], { type: 'audio/ogg' }), 'voice.ogg');
        form.append('model', 'whisper-1');
        if (language) form.append('language', language);
        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
        });
        if (!res.ok) {
            const errTxt = await res.text().catch(() => '');
            logger.warn('[platformBotHandler] Whisper error', { status: res.status, body: errTxt.slice(0, 200) });
            return null;
        }
        const data = await res.json();
        return (data.text || '').trim() || null;
    } catch (err) {
        logger.warn('[platformBotHandler] transcribeAudio failed', { error: err.message });
        return null;
    }
}

/**
 * Fetch and store Telegram profile photo for a user (fire-and-forget, non-blocking).
 */
async function fetchAndStoreProfilePhoto(userId, telegramId, token) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${telegramId}&limit=1`);
        if (!res.ok) return;
        const data = await res.json();
        const photos = data?.result?.photos;
        if (!photos?.length) return;
        // Pick the largest size of the first photo
        const sizes = photos[0];
        const largest = sizes[sizes.length - 1];
        const fileId = largest?.file_id;
        if (!fileId) return;
        // Get file path
        const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
        if (!fileRes.ok) return;
        const fileData = await fileRes.json();
        const filePath = fileData?.result?.file_path;
        if (!filePath) return;
        // Store in user metadata
        const user = await db.user.findUnique({ where: { id: userId }, select: { metadata: true } });
        await db.user.update({
            where: { id: userId },
            data: { metadata: { ...(user?.metadata || {}), photoFileId: fileId, photoFilePath: filePath } },
        });
    } catch (err) {
        logger.warn('[platformBotHandler] Failed to fetch profile photo', { userId, error: err.message });
    }
}

async function findOrCreateUser(from, botId) {
    const telegramId = BigInt(from.id);

    const existing = await db.user.findUnique({ where: { telegramId } });
    if (existing) {
        const needsUpdate = (
            (from.first_name && existing.firstName !== from.first_name) ||
            (from.last_name !== undefined && existing.lastName !== (from.last_name || null)) ||
            (from.username && existing.username !== from.username)
        );
        if (needsUpdate) {
            return db.user.update({
                where: { telegramId },
                data: {
                    firstName: from.first_name || existing.firstName,
                    lastName: from.last_name || existing.lastName,
                    username: from.username || existing.username,
                },
            });
        }
        // Fetch photo if not yet stored (fire-and-forget)
        if (!existing.metadata?.photoFileId) {
            getBotToken(botId).then(token => {
                if (token) fetchAndStoreProfilePhoto(existing.id, String(telegramId), token);
            }).catch(() => {});
        }
        return existing;
    }

    const bot = await db.bot.findUnique({ where: { id: botId }, select: { projectId: true } });

    const user = await db.user.create({
        data: {
            telegramId,
            firstName: from.first_name || null,
            lastName: from.last_name || null,
            username: from.username || null,
            languageCode: from.language_code || 'uk',
            projectId: bot?.projectId || null,
            metadata: { source: 'telegram-platform-bot' },
        },
    });
    // Fetch photo for new user (fire-and-forget)
    getBotToken(botId).then(token => {
        if (token) fetchAndStoreProfilePhoto(user.id, String(telegramId), token);
    }).catch(() => {});
    return user;
}

async function findActiveSession(userId, botId) {
    return db.session.findFirst({
        where: { userId, botId, state: { not: 'completed' } },
        orderBy: { startedAt: 'desc' },
    });
}

async function createNewSession(userId, botId) {
    const flowDef = await db.flowDefinition.findUnique({ where: { botId } });
    const nodes = Array.isArray(flowDef?.nodes) ? flowDef.nodes : [];
    const startNode = nodes.find((n) => n.type === 'start') || nodes[0] || null;

    return db.session.create({
        data: {
            userId,
            botId,
            state: startNode?.id || 'start',
            context: {
                currentNode: startNode?.id || null,
                flowRuntime: {
                    currentNodeId: startNode?.id || null,
                    waitingForUser: false,
                    nodesVisited: [],
                    lastUserMessage: '',
                    dialogHistory: {},
                },
            },
        },
    });
}

async function getNewAssistantMessages(sessionId, since) {
    const where = { sessionId, role: 'assistant' };
    if (since) {
        where.createdAt = { gt: since };
    }
    const msgs = await db.message.findMany({
        where,
        orderBy: { createdAt: 'asc' },
    });
    // Filter out hidden messages (e.g. raw JSON from json_output Claude nodes)
    return msgs.filter(m => !m.metadata?.hidden);
}

async function persistUserMessage(sessionId, content) {
    await db.message.create({
        data: {
            sessionId,
            role: 'user',
            content,
            metadata: { source: 'telegram-platform-bot' },
        },
    });
}

// ---------------------------------------------------------------------------
// Routing helpers
// ---------------------------------------------------------------------------

/**
 * Given the webhook bot ID and a startPayload, resolve which bot should
 * actually handle this session.
 *
 * Rules (in priority order):
 *   1. Payload matches a bot slug in the same project → route there
 *   2. Payload matches lesson_X_Y format → keep current bot, store lessonSlug
 *   3. No payload + returning user → restart their last non-system bot
 *   4. No payload + new user → system bot in project (settings.isSystem = true)
 *   5. Fallback: use the webhook bot (botId)
 *
 * Returns { targetBotId, lessonSlug | null }
 */
async function resolveTargetBot(botId, startPayload, userId) {
    // Load origin bot's project once
    const originBot = await db.bot.findUnique({
        where: { id: botId },
        select: { projectId: true },
    });
    const projectId = originBot?.projectId;

    // ── Rule 1: slug routing ───────────────────────────────────────────────
    if (startPayload && !/^lesson_\d+_\d+$/.test(startPayload)) {
        if (projectId) {
            const slugBot = await db.bot.findFirst({
                where: { slug: startPayload, projectId, isActive: true },
                select: { id: true },
            });
            if (slugBot) {
                logger.info('[platformBotHandler] Routed by slug', { slug: startPayload, targetBotId: slugBot.id });
                return { targetBotId: slugBot.id, lessonSlug: null };
            }
            logger.warn('[platformBotHandler] Slug not found in project, using webhook bot', { slug: startPayload, botId });
        }
        return { targetBotId: botId, lessonSlug: null };
    }

    // ── Rule 2: lesson slug → route to matching lesson bot ────────────────
    // Deep link: /start lesson_1_2 → find bot whose slug starts with "bot-1-2-"
    if (startPayload && /^lesson_\d+_\d+$/.test(startPayload)) {
        if (projectId) {
            const match = startPayload.match(/^lesson_(\d+)_(\d+)$/);
            const prefix = `bot-${match[1]}-${match[2]}-`;
            const lessonBot = await db.bot.findFirst({
                where: { projectId, isActive: true, slug: { startsWith: prefix } },
                select: { id: true },
            });
            if (lessonBot) {
                logger.info('[platformBotHandler] Routed lesson slug to bot', { lessonSlug: startPayload, prefix, targetBotId: lessonBot.id });
                return { targetBotId: lessonBot.id, lessonSlug: startPayload };
            }
            logger.warn('[platformBotHandler] Lesson bot not found for slug, using webhook bot', { lessonSlug: startPayload, prefix });
        }
        return { targetBotId: botId, lessonSlug: startPayload };
    }

    // ── Rules 3 & 4: plain /start (no payload) ────────────────────────────
    if (!startPayload && userId && projectId) {
        // Returning user: find last non-test, non-system session in same project.
        // Exclude automated/scheduler bots — they create background sessions and
        // should not become the "last interacted" target for returning users.
        // Also exclude the legacy content-manager slug — users should be routed to
        // content-manager-v2 (the webhook bot) instead of the old deprecated version.
        const AUTOMATED_SLUGS = ['content-scheduler', 'content-manager'];
        const lastSession = await db.session.findFirst({
            where: {
                userId,
                isTest: false,
                bot: { projectId, slug: { notIn: AUTOMATED_SLUGS } },
            },
            orderBy: { startedAt: 'desc' },
            select: { botId: true, bot: { select: { settings: true } } },
        });

        const isLastSystem = lastSession?.bot?.settings?.isSystem === true;

        if (lastSession && !isLastSystem) {
            logger.info('[platformBotHandler] Returning user — restarting last bot', {
                targetBotId: lastSession.botId, userId,
            });
            return { targetBotId: lastSession.botId, lessonSlug: null };
        }

        // New user (or last was system bot) — find system bot that is anchored to THIS webhook bot.
        // anchorBotId in settings ties a system bot to a specific physical Telegram bot.
        // Fall back to any isSystem bot in project only if no anchored one exists.
        const projectBots = await db.bot.findMany({
            where: { projectId, isActive: true },
            select: { id: true, settings: true },
        });
        const sysBotAnchored = projectBots.find(b => b.settings?.isSystem === true && b.settings?.anchorBotId === botId);
        const sysBotAny      = projectBots.find(b => b.settings?.isSystem === true);
        const sysBot         = sysBotAnchored || sysBotAny;
        if (sysBotAnchored) {
            logger.info('[platformBotHandler] New user — routing to anchored system bot', { targetBotId: sysBot.id, anchorBotId: botId });
            return { targetBotId: sysBot.id, lessonSlug: null };
        }
        if (sysBotAny && sysBotAny.settings?.anchorBotId && sysBotAny.settings.anchorBotId !== botId) {
            // Only system bot belongs to a DIFFERENT physical bot — don't use it, fall through to webhook bot
            logger.info('[platformBotHandler] New user — system bot anchored to different bot, using webhook bot', { webhookBotId: botId });
        } else if (sysBotAny) {
            logger.info('[platformBotHandler] New user — routing to system bot (no anchor)', { targetBotId: sysBotAny.id });
            return { targetBotId: sysBotAny.id, lessonSlug: null };
        }
    }

    return { targetBotId: botId, lessonSlug: null };
}

// ---------------------------------------------------------------------------
// Inline keyboard callback handler (quality check buttons from deliverResultToTelegram)
// Handles: cm_approve, cm_regen, cm_fix
// ---------------------------------------------------------------------------

async function handleCallbackQuery(botId, callbackQuery) {
    const token = await getBotToken(botId);
    if (!token) return;

    const data = callbackQuery.data || '';
    const chatId = callbackQuery.message?.chat?.id;
    const msgId = callbackQuery.message?.message_id;
    const from = callbackQuery.from;

    // Always answer to remove the loading spinner from the button
    await tgRequest(token, 'answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
    }).catch(() => {});

    // ── Homework-done button ───────────────────────────────────────────────────
    if (data.startsWith('hw_done:') && from?.id) {
        const eventKey = data.slice('hw_done:'.length); // e.g. "homework_done_lesson_1_1"

        const hwUser = await db.user.findUnique({ where: { telegramId: BigInt(from.id) } }).catch(() => null);
        if (!hwUser) return;

        const hwSession = await db.session.findFirst({
            where: { userId: hwUser.id, botId, state: { not: 'completed' } },
            orderBy: { startedAt: 'desc' },
        }).catch(() => null);
        if (!hwSession) return;

        // Remove the button from the original message (clean up UI)
        await tgRequest(token, 'editMessageReplyMarkup', {
            chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] },
        }).catch(() => {});

        await tgRequest(token, 'answerCallbackQuery', {
            callback_query_id: callbackQuery.id,
            text: '🎉 Відмінно! Продовжуємо...',
            show_alert: false,
        }).catch(() => {});

        // Set the event key in session context
        const updatedCtx = { ...(hwSession.context || {}), [eventKey]: true };
        await db.session.update({ where: { id: hwSession.id }, data: { context: updatedCtx } });

        const sinceTime = new Date();
        await executeFlowStep({ sessionId: hwSession.id, incomingUserMessage: null }).catch(err => {
            logger.error('[platformBotHandler] hw_done executeFlowStep failed', { error: err.message });
        });
        await deliverSessionMessages(botId, hwSession.id, Number(chatId), sinceTime);
        return;
    }

    // ── Generic choice button (cta:xxx) — treat as user message ──────────────
    if (data.startsWith('cta:') && from?.id) {
        const choiceMap = {
            'cta:demo': '📞 Хочу демо-дзвінок',
            'cta:test': '💻 Хочу потестувати',
            'cta:questions': '❓ Більше питань',
        };
        const userText = choiceMap[data] || data.slice(4);

        const ctaUser = await db.user.findUnique({ where: { telegramId: BigInt(from.id) } }).catch(() => null);
        if (ctaUser) {
            const ctaSession = await db.session.findFirst({
                where: { userId: ctaUser.id, botId, state: { not: 'completed' } },
                orderBy: { startedAt: 'desc' },
            }).catch(() => null);
            if (ctaSession) {
                await tgRequest(token, 'editMessageReplyMarkup', {
                    chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] },
                }).catch(() => {});
                await tgRequest(token, 'answerCallbackQuery', {
                    callback_query_id: callbackQuery.id,
                    text: '✅ Отримав',
                    show_alert: false,
                }).catch(() => {});
                await db.message.create({
                    data: { sessionId: ctaSession.id, role: 'user', content: userText, metadata: { source: 'callback_cta', callbackData: data } },
                }).catch(() => {});
                const sinceTime = new Date();
                await executeFlowStep({ sessionId: ctaSession.id, incomingUserMessage: userText }).catch(() => {});
                await deliverSessionMessages(botId, ctaSession.id, Number(chatId), sinceTime);
                return;
            }
        }
    }

    if (!data.startsWith('cm_') || !from?.id) return;

    // Find the user
    const user = await db.user.findUnique({ where: { telegramId: BigInt(from.id) } }).catch(() => null);
    if (!user) return;

    // Find their active content-manager session
    const session = await db.session.findFirst({
        where: {
            userId: user.id,
            state: { not: 'completed' },
            bot: { slug: 'content-manager' },
        },
        orderBy: { lastActive: 'desc' },
    }).catch(() => null);
    if (!session) return;

    // Remove inline keyboard buttons from the original message
    await tgRequest(token, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: msgId,
        reply_markup: { inline_keyboard: [] },
    }).catch(() => {});

    let userMessage = null;

    if (data === 'cm_approve') {
        // Confirm and inject "approve" as a user message into the session
        await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: '✅ Збережено в план!',
        }).catch(() => {});
        userMessage = '✅ Підходить, збережи в план';

    } else if (data === 'cm_regen') {
        // Tell Claude to regenerate same content
        await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: '🔄 Запускаю генерацію ще раз...',
        }).catch(() => {});
        userMessage = '🔄 Перегенеруй те саме з тими ж параметрами';

    } else if (data === 'cm_fix') {
        // Just prompt the user to describe what to fix; session already waiting
        await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: '✏️ Напиши що потрібно виправити:',
        }).catch(() => {});
        return; // session stays waitingForUser — next message from user continues naturally

    } else if (data.startsWith('cm_quick:')) {
        const option = data.slice('cm_quick:'.length);
        const quickMessages = {
            instagram: 'Напиши великий продаючий пост для Instagram',
            threads:   'Напиши пост для Threads',
            plan:      'Створи контент-план на наступні 7 днів',
            media:     'Запусти AI медіа — я скажу деталі',
        };
        userMessage = quickMessages[option] || option;
    }

    if (!userMessage) return;

    // Persist user "message" and advance the flow
    await db.message.create({
        data: {
            sessionId: session.id,
            role: 'user',
            content: userMessage,
            metadata: { source: 'callback_query', callbackData: data },
        },
    }).catch(() => {});

    const sinceTime = new Date();
    await executeFlowStep({ sessionId: session.id, incomingUserMessage: userMessage }).catch(err => {
        logger.error('[platformBotHandler] handleCallbackQuery: executeFlowStep failed', { error: err.message });
    });
    await deliverSessionMessages(session.botId, session.id, Number(chatId), sinceTime);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handlePlatformBotUpdate(botId, update) {
    // ── Handle inline keyboard callbacks (quality check buttons) ─────────────
    if (update.callback_query) {
        await handleCallbackQuery(botId, update.callback_query);
        return;
    }

    const message = update.message || update.edited_message;
    if (!message) {
        logger.debug('[platformBotHandler] No message in update, skipping', { botId });
        return;
    }

    const chatId = message.chat?.id;
    const from = message.from;
    // Use text, or fall back to media caption so "ось фото, додай завтра" works
    let text = message.text || message.caption || '';

    if (!from || !chatId) {
        logger.debug('[platformBotHandler] Missing from/chatId, skipping', { botId });
        return;
    }

    const isStart = (message.text || '').startsWith('/start');
    const startPayload = isStart ? text.slice('/start'.length).trim() : '';

    // ── Phase 1: token (use webhook bot — same connector for all bots in project) ──
    const token = await getBotToken(botId);
    if (!token) {
        logger.error('[platformBotHandler] No TELEGRAM_BOT_TOKEN for bot', { botId });
        return;
    }

    // ── Phase 1.5: incoming media + голосова транскрибація (OpenAI Whisper) ──
    // Дозволяє надиктовувати зміни голосом — текст піде в агента як звичайне повідомлення.
    const incomingMedia = await extractIncomingMedia(message, token).catch(() => null);
    if (incomingMedia && (incomingMedia.type === 'voice' || incomingMedia.type === 'audio')
        && incomingMedia.fileUrl && !message.text) {
        const oaiKey = await resolveOpenAIKey(botId);
        if (oaiKey) {
            const transcript = await transcribeAudio(incomingMedia.fileUrl, oaiKey, 'uk');
            if (transcript) {
                incomingMedia.transcript = transcript;
                text = text ? `${text}\n${transcript}` : transcript;
                logger.info('[platformBotHandler] Voice transcribed', { chars: transcript.length });
            }
        } else {
            logger.warn('[platformBotHandler] Voice received but no OpenAI key for transcription', { botId });
        }
    }

    // ── Phase 2: find or create user (use webhook bot for projectId on new users) ──
    let user;
    try {
        user = await findOrCreateUser(from, botId);
    } catch (err) {
        logger.error('[platformBotHandler] Failed to find/create user', { botId, error: err.message });
        return;
    }

    // Bots that are permanently retired — sessions never resume, routing skips them.
    const ARCHIVED_BOT_SLUGS = ['content-manager'];

    // ── Phase 3: resolve target bot ────────────────────────────────────────────
    let targetBotId = botId;
    let lessonSlug = null;

    if (isStart) {
        const resolved = await resolveTargetBot(botId, startPayload, user.id);
        targetBotId = resolved.targetBotId;
        lessonSlug = resolved.lessonSlug;
    }

    // ── Phase 3.5: archived bot guard ─────────────────────────────────────────
    // Retired bots are silently rerouted to the webhook bot. Existing archived
    // sessions are completed so they can never resume.
    const resolvedBotRecord = await db.bot.findUnique({
        where: { id: targetBotId },
        select: { id: true, slug: true },
    }).catch(() => null);

    if (resolvedBotRecord && ARCHIVED_BOT_SLUGS.includes(resolvedBotRecord.slug)) {
        logger.info('[platformBotHandler] Archived bot — rerouting to webhook bot', {
            archivedSlug: resolvedBotRecord.slug, archivedBotId: targetBotId, webhookBotId: botId,
        });
        // Complete any lingering archived sessions for this user
        await db.session.updateMany({
            where: { userId: user.id, botId: targetBotId, state: { not: 'completed' } },
            data: { state: 'completed' },
        }).catch(() => {});
        // Restart on the current webhook bot instead
        targetBotId = botId;
        lessonSlug = null;
    }

    // ── Phase 4: verify flow definition exists ─────────────────────────────────
    const flowDef = await db.flowDefinition.findUnique({ where: { botId: targetBotId }, select: { id: true } });
    if (!flowDef) {
        logger.warn('[platformBotHandler] No flow definition for bot', { targetBotId });
        await sendTelegramMessage(token, chatId, 'Вибачте, бот ще не налаштований.');
        return;
    }

    let session;
    let sinceTime;

    if (isStart) {
        // Deactivate all previous active sessions for this specific bot
        await db.session.updateMany({
            where: { userId: user.id, botId: targetBotId, state: { not: 'completed' } },
            data: { state: 'completed' },
        });

        session = await createNewSession(user.id, targetBotId);

        // Store lesson slug in context if present
        if (lessonSlug) {
            const updatedCtx = { ...(session.context || {}), lessonSlug };
            session = await db.session.update({
                where: { id: session.id },
                data: { context: updatedCtx },
            });
        }

        logger.info('[platformBotHandler] New session created on /start', {
            webhookBotId: botId,
            targetBotId,
            userId: user.id,
            sessionId: session.id,
        });
    } else {
        // Non-start message: find active session on the BOT it was last running on.
        // We search across all bots in the project (user might be in the middle of SPIN
        // while the webhook belongs to Automation, or vice versa).
        session = await findActiveSession(user.id, targetBotId);

        if (!session) {
            // Also try across all bots in the same project (handles cross-bot continuation),
            // but skip archived bots — they must never resume.
            const originBot = await db.bot.findUnique({ where: { id: botId }, select: { projectId: true } });
            if (originBot?.projectId) {
                session = await db.session.findFirst({
                    where: {
                        userId: user.id,
                        state: { not: 'completed' },
                        bot: { projectId: originBot.projectId, slug: { notIn: ARCHIVED_BOT_SLUGS } },
                    },
                    orderBy: { lastActive: 'desc' },
                    include: { bot: { select: { slug: true } } },
                });
                if (session) targetBotId = session.botId;
            }
        }

        // If found session belongs to an archived bot — complete it and prompt restart
        if (session && ARCHIVED_BOT_SLUGS.includes(session.bot?.slug)) {
            await db.session.update({ where: { id: session.id }, data: { state: 'completed' } }).catch(() => {});
            session = null;
        }

        if (!session) {
            await sendTelegramMessage(token, chatId, 'Натисніть /start щоб розпочати.');
            return;
        }

        await persistUserMessage(session.id, text);

        // Reset follow-up counter when user responds — so future follow-ups can be sent again
        const currentCtx = session.context || {};
        if ((currentCtx.followUpCount || 0) > 0) {
            const resetCtx = { ...currentCtx, followUpCount: 0 };
            session = await db.session.update({ where: { id: session.id }, data: { context: resetCtx } });
        }

        logger.info('[platformBotHandler] Continuing session', {
            targetBotId, userId: user.id, sessionId: session.id, text: text.slice(0, 80),
        });
    }

    // ── Phase 4.5: persist telegramChatId + incoming media in session context ──
    // Content-manager bot uses telegramChatId for deliverTo (sends generated content back here)
    // and lastUserMedia to let the agent reuse a sent photo/video as a background.
    // incomingMedia вже витягнуто у Phase 1.5 (з можливою транскрипцією голосу).
    if (chatId && (session?.context?.telegramChatId !== chatId || incomingMedia)) {
        const nextCtx = { ...(session.context || {}), telegramChatId: chatId };
        if (incomingMedia) {
            nextCtx.lastUserMedia = incomingMedia;
            logger.info('[platformBotHandler] Captured incoming media', {
                sessionId: session.id, type: incomingMedia.type, hasUrl: !!incomingMedia.fileUrl,
            });
        }
        session = await db.session.update({
            where: { id: session.id },
            data: { context: nextCtx },
        }).catch(() => session);

        // Push photo/video to content dashboard situational media library (fire-and-forget)
        if (incomingMedia && ['photo', 'video', 'animation'].includes(incomingMedia.type) && incomingMedia.fileUrl) {
            const mediaKeys = await db.funnelKey.findMany({
                where: { botId: targetBotId, key: { in: ['SITUATIONAL_MEDIA_URL', 'CONTENT_IMPORT_TOKEN', 'CONTENT_PROJECT_ID'] } },
                select: { key: true, value: true },
            }).catch(() => []);
            const mk = Object.fromEntries(mediaKeys.map(k => [k.key, k.value]));
            if (mk.SITUATIONAL_MEDIA_URL && mk.CONTENT_IMPORT_TOKEN) {
                const projectId = parseInt(mk.CONTENT_PROJECT_ID || '0', 10) || 0;
                fetch(mk.SITUATIONAL_MEDIA_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Import-Token': mk.CONTENT_IMPORT_TOKEN },
                    body: JSON.stringify({
                        projectId,
                        type: incomingMedia.type,
                        fileUrl: incomingMedia.fileUrl,
                        caption: incomingMedia.caption || '',
                        mimeType: incomingMedia.mimeType || '',
                    }),
                }).then(r => r.json()).then(d => {
                    if (!d.ok) logger.warn('[platformBotHandler] Situational media save failed', d);
                }).catch(err => logger.warn('[platformBotHandler] Situational media upload error', { error: err.message }));
            }
        }
    }

    // ── Phase 5: execute flow step ────────────────────────────────────────────
    sinceTime = new Date();
    await tgRequest(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    const typingTimer = setInterval(() => {
        tgRequest(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    }, 4000);

    try {
        await executeFlowStep({
            sessionId: session.id,
            incomingUserMessage: isStart ? null : text,
        });
    } catch (err) {
        clearInterval(typingTimer);
        logger.error('[platformBotHandler] executeFlowStep failed', {
            targetBotId, sessionId: session.id, error: err.message, stack: err.stack,
        });
        const errText = 'От халепа 😅 Щось пішло не так, але Олександру вже пішло сповіщення — все виправиться найближчим часом і тобі прийде наступне повідомлення.';
        // Persist error response so it's visible in session messages tab
        await db.message.create({
            data: {
                sessionId: session.id,
                role: 'assistant',
                content: errText,
                metadata: { source: 'error-handler', error: err.message },
            },
        }).catch(() => {});
        await sendTelegramMessage(token, chatId, errText);
        return;
    }
    clearInterval(typingTimer);

    // ── Phase 6: deliver new messages ─────────────────────────────────────────
    const newMessages = await getNewAssistantMessages(session.id, sinceTime);

    if (newMessages.length === 0) {
        logger.debug('[platformBotHandler] No new assistant messages after step', { sessionId: session.id });
    }

    for (const msg of newMessages) {
        try {
            const meta = msg.metadata || {};
            const attachment = meta.attachment;
            const keyboard = Array.isArray(meta.keyboard) && meta.keyboard.length > 0
                ? { inline_keyboard: meta.keyboard }
                : null;

            if (attachment?.type === 'document' && attachment.url) {
                const docRes = await tgRequest(token, 'sendDocument', {
                    chat_id: chatId,
                    document: attachment.url,
                    caption: attachment.caption || msg.content || undefined,
                    parse_mode: 'HTML',
                    ...(keyboard ? { reply_markup: keyboard } : {}),
                });
                // If Telegram can't fetch the document URL, fall back to text-only message
                if (!docRes.ok) {
                    logger.warn('[platformBotHandler] sendDocument failed, falling back to text', {
                        sessionId: session.id, url: attachment.url,
                    });
                    if (msg.content) {
                        await sendTelegramMessage(token, chatId, msg.content,
                            keyboard ? { reply_markup: keyboard } : {});
                    }
                }
            } else if (attachment?.type === 'photo' && attachment.url) {
                if (attachment.url.startsWith('http')) {
                    await tgRequest(token, 'sendPhoto', {
                        chat_id: chatId,
                        photo: attachment.url,
                        caption: attachment.caption || undefined,
                        parse_mode: 'HTML',
                        ...(keyboard ? { reply_markup: keyboard } : {}),
                    });
                } else {
                    await sendTelegramMessage(token, chatId, attachment.caption || msg.content || '📸',
                        keyboard ? { reply_markup: keyboard } : {});
                }
            } else {
                await sendTelegramMessage(token, chatId, msg.content,
                    keyboard ? { reply_markup: keyboard } : {});
            }
        } catch (err) {
            logger.error('[platformBotHandler] Failed to send message', {
                sessionId: session.id, msgId: msg.id, error: err.message,
            });
        }
    }

    await tryTriggerHomeworkDone(targetBotId, user.id, isStart ? null : text, session.id);
}

// ---------------------------------------------------------------------------
// Homework-done cross-bot trigger
// ---------------------------------------------------------------------------

async function tryTriggerHomeworkDone(practiceBotId, userId, userText, sessionId) {
    try {
        const courseBotKey = await db.funnelKey.findUnique({
            where: { botId_key: { botId: practiceBotId, key: 'COURSE_BOT_ID' } },
            select: { value: true },
        });
        if (!courseBotKey?.value) return;
        const courseBotId = courseBotKey.value;

        const currentSession = await db.session.findUnique({
            where: { id: sessionId },
            select: { state: true, context: true },
        });
        if (!currentSession || currentSession.state !== 'completed') return;

        const pracCtx = currentSession.context || {};
        const lessonSlug = pracCtx.lessonSlug;
        if (!lessonSlug) return;

        const courseSession = await db.session.findFirst({
            where: { userId, botId: courseBotId, state: { not: 'completed' } },
            orderBy: { startedAt: 'desc' },
        });
        if (!courseSession) return;

        const eventKey = `homework_done_${lessonSlug}`;
        logger.info('[platformBotHandler] Homework done — triggering course session', {
            practiceBotId, courseBotId, lessonSlug, courseSessionId: courseSession.id,
        });

        const courseCtx = { ...(courseSession.context || {}), [eventKey]: true };
        await db.session.update({
            where: { id: courseSession.id },
            data: { context: courseCtx },
        });

        const sinceTime = new Date();
        await executeFlowStep({ sessionId: courseSession.id, incomingUserMessage: null });

        const courseUser = await db.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
        if (!courseUser?.telegramId) return;
        const courseChatId = Number(courseUser.telegramId);

        await deliverSessionMessages(courseBotId, courseSession.id, courseChatId, sinceTime);
    } catch (err) {
        logger.warn('[platformBotHandler] tryTriggerHomeworkDone failed', { error: err.message });
    }
}

// ---------------------------------------------------------------------------
// Exported delivery helper
// ---------------------------------------------------------------------------

async function deliverSessionMessages(botId, sessionId, telegramChatId, sinceTime) {
    const token = await getBotToken(botId);
    if (!token) {
        logger.warn('[platformBotHandler] deliverSessionMessages: no token for bot', { botId });
        return;
    }
    const msgs = await getNewAssistantMessages(sessionId, sinceTime);
    for (const msg of msgs) {
        try {
            const meta = msg.metadata || {};
            const keyboard = Array.isArray(meta.keyboard) && meta.keyboard.length > 0
                ? { inline_keyboard: meta.keyboard }
                : null;
            const attachment = meta.attachment;
            let tgResult;
            if (attachment?.type === 'document' && attachment.url) {
                tgResult = await tgRequest(token, 'sendDocument', {
                    chat_id: telegramChatId,
                    document: attachment.url,
                    caption: attachment.caption || msg.content || undefined,
                    parse_mode: 'HTML',
                    ...(keyboard ? { reply_markup: keyboard } : {}),
                });
            } else {
                // sendTelegramMessage splits long messages — only last part gets keyboard
                // For message_id tracking we call tgRequest directly for single-part messages
                const text = String(msg.content || '');
                if (text.length <= 4000) {
                    tgResult = await tgRequest(token, 'sendMessage', {
                        chat_id: telegramChatId,
                        text,
                        parse_mode: 'HTML',
                        ...(keyboard ? { reply_markup: keyboard } : {}),
                    });
                } else {
                    await sendTelegramMessage(token, telegramChatId, text,
                        keyboard ? { reply_markup: keyboard } : {});
                }
            }
            // Store telegram message_id in DB metadata
            const tgMsgId = tgResult?.result?.message_id;
            if (tgMsgId) {
                db.message.update({
                    where: { id: msg.id },
                    data: { metadata: { ...meta, telegramMessageId: tgMsgId } },
                }).catch(() => {});
            }
        } catch (err) {
            const errText = String(err.message || '').toLowerCase();
            const isBlocked = errText.includes('blocked') || errText.includes('forbidden') || errText.includes('403') || errText.includes('user is deactivated');
            if (isBlocked) {
                await markUnsubscribed(botId, telegramChatId);
            }
            logger.warn('[platformBotHandler] deliverSessionMessages: send failed', { msgId: msg.id, error: err.message, isBlocked });
        }
    }
}

module.exports = { handlePlatformBotUpdate, deliverSessionMessages, getBotToken };
