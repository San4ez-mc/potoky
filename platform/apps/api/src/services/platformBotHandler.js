'use strict';

/**
 * platformBotHandler.js
 *
 * Production Telegram webhook handler for platform flow bots.
 * Replaces the finance-course handler for bot-scoped webhook endpoints.
 *
 * Responsibilities:
 *  1. Find the bot by UUID (from webhook URL)
 *  2. Load the bot's TELEGRAM_BOT_TOKEN from funnelKey
 *  3. Find or create a User from the Telegram update
 *  4. On /start  → deactivate old sessions, create new session, executeFlowStep
 *  5. On message → find active session, executeFlowStep with user text
 *  6. Send all new assistant messages using the bot's own token
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
    return res;
}

async function sendTelegramMessage(token, chatId, text, extra = {}) {
    // Telegram max message length is 4096 chars; split if needed
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
            // Only attach extra (e.g. reply_markup) to the last part so buttons appear once
            ...(isLast ? extra : {}),
        });
    }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

// Telegram token format: digits:alphanumeric (e.g. 123456789:AABBcc...)
function isValidTelegramToken(val) {
    return typeof val === 'string' && /^\d+:[A-Za-z0-9_-]{20,}$/.test(val.trim());
}

async function getBotToken(botId) {
    const keys = await db.funnelKey.findMany({
        where: { botId, key: { in: ['TELEGRAM_CONNECTOR_ID', 'TELEGRAM_BOT_TOKEN'] } },
        select: { key: true, value: true },
    });
    const keyMap = Object.fromEntries(keys.map(k => [k.key, k.value]));

    // 1. Connector reference
    const connectorId = keyMap.TELEGRAM_CONNECTOR_ID;
    if (connectorId) {
        try {
            const connector = await db.savedConnector.findUnique({ where: { id: connectorId }, select: { config: true } });
            const t = connector?.config?.token;
            if (isValidTelegramToken(t)) return t.trim();
        } catch { /* ignore */ }
    }
    // 2. Direct key in funnelKey
    const directVal = keyMap.TELEGRAM_BOT_TOKEN?.trim();
    if (isValidTelegramToken(directVal)) return directVal;
    // 3. Global env
    const envVal = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (isValidTelegramToken(envVal)) {
        logger.debug('[platformBotHandler] Using global TELEGRAM_BOT_TOKEN for bot', { botId });
        return envVal;
    }
    return null;
}

async function findOrCreateUser(from, botId) {
    const telegramId = BigInt(from.id);

    const existing = await db.user.findUnique({ where: { telegramId } });
    if (existing) {
        // Update name if changed
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
        return existing;
    }

    // Resolve projectId via bot
    const bot = await db.bot.findUnique({ where: { id: botId }, select: { projectId: true } });

    return db.user.create({
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
}

async function findActiveSession(userId, botId) {
    return db.session.findFirst({
        where: { userId, botId, state: { not: 'completed' } },
        orderBy: { startedAt: 'desc' },
    });
}

async function createNewSession(userId, botId) {
    // Get flow definition to find start node
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

async function getNewAssistantMessages(sessionId, sinceMessageId) {
    const where = { sessionId, role: 'assistant' };
    if (sinceMessageId) {
        where.id = { gt: sinceMessageId };
    }
    return db.message.findMany({
        where,
        orderBy: { createdAt: 'asc' },
    });
}

async function getLastMessageId(sessionId) {
    const msg = await db.message.findFirst({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    return msg?.id || null;
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
// Main handler
// ---------------------------------------------------------------------------

async function handlePlatformBotUpdate(botId, update) {
    const message = update.message || update.edited_message;
    if (!message) {
        logger.debug('[platformBotHandler] No message in update, skipping', { botId });
        return;
    }

    const chatId = message.chat?.id;
    const from = message.from;
    const text = message.text || '';

    if (!from || !chatId) {
        logger.debug('[platformBotHandler] Missing from/chatId, skipping', { botId });
        return;
    }

    // 1. Load bot's Telegram token
    const token = await getBotToken(botId);
    if (!token) {
        logger.error('[platformBotHandler] No TELEGRAM_BOT_TOKEN for bot', { botId });
        return;
    }

    // 2. Find or create user
    let user;
    try {
        user = await findOrCreateUser(from, botId);
    } catch (err) {
        logger.error('[platformBotHandler] Failed to find/create user', { botId, error: err.message });
        return;
    }

    // 3. Determine flow definition exists
    const flowDef = await db.flowDefinition.findUnique({ where: { botId }, select: { id: true } });
    if (!flowDef) {
        logger.warn('[platformBotHandler] No flow definition for bot', { botId });
        await sendTelegramMessage(token, chatId, 'Вибачте, бот ще не налаштований.');
        return;
    }

    const isStart = text.startsWith('/start');
    // Extract /start payload (e.g. "/start lesson_1_1" or "/start bot-slug__l2")
    const startPayload = isStart ? text.slice('/start'.length).trim() : '';

    let session;
    let lastMsgId;

    if (isStart) {
        // Deactivate all previous active sessions
        await db.session.updateMany({
            where: { userId: user.id, botId, state: { not: 'completed' } },
            data: { state: 'completed' },
        });

        // Create fresh session
        session = await createNewSession(user.id, botId);

        // If the start payload looks like a lesson slug (e.g. "lesson_1_1"), store it in session context
        if (startPayload && /^lesson_\d+_\d+$/.test(startPayload)) {
            const updatedCtx = { ...(session.context || {}), lessonSlug: startPayload };
            session = await db.session.update({
                where: { id: session.id },
                data: { context: updatedCtx },
            });
        }

        lastMsgId = null; // we want ALL messages created after session creation

        logger.info('[platformBotHandler] New session created on /start', {
            botId, userId: user.id, sessionId: session.id,
        });
    } else {
        // Find active session
        session = await findActiveSession(user.id, botId);

        if (!session) {
            // No active session — prompt user to start
            await sendTelegramMessage(token, chatId, 'Натисніть /start щоб розпочати.');
            return;
        }

        // Persist user message before executing step
        lastMsgId = await getLastMessageId(session.id);
        await persistUserMessage(session.id, text);

        logger.info('[platformBotHandler] Continuing session', {
            botId, userId: user.id, sessionId: session.id, text: text.slice(0, 80),
        });
    }

    // 4. Execute flow step
    try {
        await executeFlowStep({
            sessionId: session.id,
            incomingUserMessage: isStart ? null : text,
        });
    } catch (err) {
        logger.error('[platformBotHandler] executeFlowStep failed', {
            botId, sessionId: session.id, error: err.message, stack: err.stack,
        });
        await sendTelegramMessage(token, chatId, 'Вибачте, сталася помилка. Спробуйте ще раз або /start.');
        return;
    }

    // 5. Fetch new assistant messages and send them
    const newMessages = await getNewAssistantMessages(session.id, lastMsgId);

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
                await tgRequest(token, 'sendDocument', {
                    chat_id: chatId,
                    document: attachment.url,
                    caption: attachment.caption || msg.content || undefined,
                    parse_mode: 'HTML',
                    ...(keyboard ? { reply_markup: keyboard } : {}),
                });
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
                    // base64 or data URL — fallback to text
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

    // After sending messages, check if this session just completed and it's a Michael-style
    // homework bot. If so, signal the user's course bot session to advance.
    await tryTriggerHomeworkDone(botId, user.id, isStart ? null : text, session.id);
}

// ---------------------------------------------------------------------------
// Homework-done cross-bot trigger
// ---------------------------------------------------------------------------

/**
 * When a session on a "practice" bot completes (reaches a node marked as homework_done),
 * find the user's active session on the linked course bot and fire the homework event.
 *
 * Triggered after every flow step on non-start messages.
 * The course bot must be linked via the COURSE_BOT_ID funnelKey on the practice bot.
 */
async function tryTriggerHomeworkDone(practiceBotId, userId, userText, sessionId) {
    try {
        // Check if this bot has a COURSE_BOT_ID key (meaning it's a practice/homework bot)
        const courseBotKey = await db.funnelKey.findUnique({
            where: { botId_key: { botId: practiceBotId, key: 'COURSE_BOT_ID' } },
            select: { value: true },
        });
        if (!courseBotKey?.value) return;
        const courseBotId = courseBotKey.value;

        // Check if current session just completed
        const currentSession = await db.session.findUnique({
            where: { id: sessionId },
            select: { state: true, context: true },
        });
        if (!currentSession || currentSession.state !== 'completed') return;

        // Find the lesson slug from session context (set when /start=lesson_X_Y)
        // Stored at session.context.lessonSlug (root level)
        const pracCtx = currentSession.context || {};
        const lessonSlug = pracCtx.lessonSlug;
        if (!lessonSlug) return;

        // Find the user's active course bot session
        const courseSession = await db.session.findFirst({
            where: { userId, botId: courseBotId, state: { not: 'completed' } },
            orderBy: { startedAt: 'desc' },
        });
        if (!courseSession) return;

        const eventKey = `homework_done_${lessonSlug}`;
        logger.info('[platformBotHandler] Homework done — triggering course session', {
            practiceBotId, courseBotId, lessonSlug, courseSessionId: courseSession.id,
        });

        // Set the event key at the root of session.context so executeFlowStep's `ctx[eventKey]` picks it up
        const courseCtx = { ...(courseSession.context || {}), [eventKey]: true };
        await db.session.update({
            where: { id: courseSession.id },
            data: { context: courseCtx },
        });

        // Execute the next step in the course session
        await executeFlowStep({ sessionId: courseSession.id, incomingUserMessage: null });

        // Send any new course bot messages to the user
        const courseBotToken = await getBotToken(courseBotId);
        if (!courseBotToken) return;

        const courseUser = await db.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
        if (!courseUser?.telegramId) return;
        const courseChatId = Number(courseUser.telegramId);

        const courseMessages = await db.message.findMany({
            where: { sessionId: courseSession.id, role: 'assistant' },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });

        // Only send messages created very recently (last 10 seconds)
        const cutoff = Date.now() - 10_000;
        const freshMessages = courseMessages
            .filter(m => new Date(m.createdAt).getTime() > cutoff)
            .reverse();

        for (const msg of freshMessages) {
            const meta = msg.metadata || {};
            const keyboard = Array.isArray(meta.keyboard) && meta.keyboard.length > 0
                ? { inline_keyboard: meta.keyboard }
                : null;
            await sendTelegramMessage(courseBotToken, courseChatId, msg.content,
                keyboard ? { reply_markup: keyboard } : {});
        }
    } catch (err) {
        logger.warn('[platformBotHandler] tryTriggerHomeworkDone failed', { error: err.message });
    }
}

// ---------------------------------------------------------------------------
// Exported delivery helper (for use by API routes after advancing a session)
// ---------------------------------------------------------------------------

/**
 * Deliver any assistant messages created after `sinceMessageId` to the given
 * Telegram chat. Used by the homework-done endpoint to push course messages.
 */
async function deliverSessionMessages(botId, sessionId, telegramChatId, sinceMessageId) {
    const token = await getBotToken(botId);
    if (!token) {
        logger.warn('[platformBotHandler] deliverSessionMessages: no token for bot', { botId });
        return;
    }
    const msgs = await getNewAssistantMessages(sessionId, sinceMessageId);
    for (const msg of msgs) {
        try {
            const meta = msg.metadata || {};
            const keyboard = Array.isArray(meta.keyboard) && meta.keyboard.length > 0
                ? { inline_keyboard: meta.keyboard }
                : null;
            const attachment = meta.attachment;
            if (attachment?.type === 'document' && attachment.url) {
                await tgRequest(token, 'sendDocument', {
                    chat_id: telegramChatId,
                    document: attachment.url,
                    caption: attachment.caption || msg.content || undefined,
                    parse_mode: 'HTML',
                    ...(keyboard ? { reply_markup: keyboard } : {}),
                });
            } else {
                await sendTelegramMessage(token, telegramChatId, msg.content,
                    keyboard ? { reply_markup: keyboard } : {});
            }
        } catch (err) {
            logger.warn('[platformBotHandler] deliverSessionMessages: send failed', { msgId: msg.id, error: err.message });
        }
    }
}

module.exports = { handlePlatformBotUpdate, deliverSessionMessages, getBotToken };
