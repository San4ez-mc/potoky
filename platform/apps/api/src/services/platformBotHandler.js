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

    for (const part of parts) {
        await tgRequest(token, 'sendMessage', {
            chat_id: chatId,
            text: part,
            parse_mode: 'HTML',
            ...extra,
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

            if (attachment?.type === 'document' && attachment.url) {
                await tgRequest(token, 'sendDocument', {
                    chat_id: chatId,
                    document: attachment.url,
                    caption: attachment.caption || msg.content || undefined,
                    parse_mode: 'HTML',
                });
            } else if (attachment?.type === 'photo' && attachment.url) {
                if (attachment.url.startsWith('http')) {
                    await tgRequest(token, 'sendPhoto', {
                        chat_id: chatId,
                        photo: attachment.url,
                        caption: attachment.caption || undefined,
                        parse_mode: 'HTML',
                    });
                } else {
                    // base64 or data URL — fallback to text
                    await sendTelegramMessage(token, chatId, attachment.caption || msg.content || '📸');
                }
            } else {
                await sendTelegramMessage(token, chatId, msg.content);
            }
        } catch (err) {
            logger.error('[platformBotHandler] Failed to send message', {
                sessionId: session.id, msgId: msg.id, error: err.message,
            });
        }
    }
}

module.exports = { handlePlatformBotUpdate };
