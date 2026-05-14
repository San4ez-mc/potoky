'use strict';

const { getBot } = require('./bot');
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { TelegramError } = require('@platform/errors');

const MAX_MESSAGE_LENGTH = 4000;
const testChatIds = new Set();
const testMessageBuffer = new Map();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function splitByLength(text, maxLen) {
    const parts = [];
    let remaining = text;
    while (remaining.length > maxLen) {
        let splitAt = remaining.lastIndexOf('\n', maxLen);
        if (splitAt <= 0) splitAt = maxLen;
        parts.push(remaining.substring(0, splitAt));
        remaining = remaining.substring(splitAt).trim();
    }
    if (remaining) parts.push(remaining);
    return parts;
}

function toTestChatKey(chatId) {
    return String(chatId);
}

function isTestChat(chatId) {
    return testChatIds.has(toTestChatKey(chatId));
}

function pushTestMessage(chatId, payload) {
    const key = toTestChatKey(chatId);
    const list = testMessageBuffer.get(key) || [];
    list.push(payload);
    testMessageBuffer.set(key, list);
}

function enableTestChat(chatId) {
    testChatIds.add(toTestChatKey(chatId));
}

function disableTestChat(chatId) {
    testChatIds.delete(toTestChatKey(chatId));
}

function consumeTestMessages(chatId) {
    const key = toTestChatKey(chatId);
    const list = testMessageBuffer.get(key) || [];
    testMessageBuffer.delete(key);
    return list;
}

function normalizeStatusCode(statusCode) {
    const num = Number(statusCode);
    if (Number.isInteger(num)) return num;
    return 500;
}

/**
 * Send a text message (splits if >4000 chars). Logs to api_calls.
 */
async function sendMessage(chatId, text, options = {}, sessionId = null) {
    const bot = getBot();
    const startTime = Date.now();
    const defaultOptions = { parse_mode: 'Markdown', ...options };

    try {
        if (isTestChat(chatId)) {
            pushTestMessage(chatId, {
                method: 'sendMessage',
                text,
                options: defaultOptions,
                createdAt: new Date().toISOString(),
            });
            await _logApiCall({
                sessionId,
                method: 'sendMessage[test]',
                chatId,
                statusCode: 200,
                durationMs: Date.now() - startTime,
            });
            return;
        }

        if (text.length <= MAX_MESSAGE_LENGTH) {
            await bot.sendMessage(chatId, text, defaultOptions);
        } else {
            const parts = splitByLength(text, MAX_MESSAGE_LENGTH);
            for (const part of parts) {
                await bot.sendMessage(chatId, part, defaultOptions);
                await sleep(300);
            }
        }

        await _logApiCall({ sessionId, method: 'sendMessage', chatId, statusCode: 200, durationMs: Date.now() - startTime });
    } catch (error) {
        logger.error('Telegram sendMessage failed', { chatId, error: error.message });
        await _logApiCall({
            sessionId,
            method: 'sendMessage',
            chatId,
            statusCode: normalizeStatusCode(error.response?.statusCode || error.code || 500),
            durationMs: Date.now() - startTime,
            error: error.message,
        });
        throw new TelegramError(error.message, { chatId });
    }
}

/**
 * Send photo with optional caption.
 */
async function sendPhoto(chatId, photo, caption = '', options = {}, sessionId = null) {
    const bot = getBot();
    const startTime = Date.now();
    const defaultOptions = { parse_mode: 'Markdown', ...options };

    try {
        if (isTestChat(chatId)) {
            pushTestMessage(chatId, {
                method: 'sendPhoto',
                text: caption || '',
                hasPhoto: true,
                options: defaultOptions,
                createdAt: new Date().toISOString(),
            });
            await _logApiCall({
                sessionId,
                method: 'sendPhoto[test]',
                chatId,
                statusCode: 200,
                durationMs: Date.now() - startTime,
            });
            return;
        }

        await bot.sendPhoto(chatId, photo, {
            caption,
            ...defaultOptions,
        });

        await _logApiCall({ sessionId, method: 'sendPhoto', chatId, statusCode: 200, durationMs: Date.now() - startTime });
    } catch (error) {
        logger.error('Telegram sendPhoto failed', { chatId, error: error.message });
        await _logApiCall({
            sessionId,
            method: 'sendPhoto',
            chatId,
            statusCode: normalizeStatusCode(error.response?.statusCode || error.code || 500),
            durationMs: Date.now() - startTime,
            error: error.message,
        });
        throw new TelegramError(error.message, { chatId });
    }
}

/**
 * Send inline keyboard message.
 */
async function sendInlineKeyboard(chatId, text, buttons, sessionId = null) {
    const bot = getBot();
    const startTime = Date.now();

    const replyMarkup = {
        inline_keyboard: buttons,
    };

    try {
        if (isTestChat(chatId)) {
            pushTestMessage(chatId, {
                method: 'sendInlineKeyboard',
                text,
                buttons,
                createdAt: new Date().toISOString(),
            });
            await _logApiCall({
                sessionId,
                method: 'sendInlineKeyboard[test]',
                chatId,
                statusCode: 200,
                durationMs: Date.now() - startTime,
            });
            return;
        }

        await bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: replyMarkup,
        });
        await _logApiCall({ sessionId, method: 'sendInlineKeyboard', chatId, statusCode: 200, durationMs: Date.now() - startTime });
    } catch (error) {
        logger.error('Telegram sendInlineKeyboard failed', { chatId, error: error.message });
        await _logApiCall({
            sessionId,
            method: 'sendInlineKeyboard',
            chatId,
            statusCode: normalizeStatusCode(error.response?.statusCode || error.code || 500),
            durationMs: Date.now() - startTime,
            error: error.message,
        });
        throw new TelegramError(error.message, { chatId });
    }
}

/**
 * Send notification to owner (uses TELEGRAM_OWNER_ID from env).
 */
async function notifyOwner(text) {
    const ownerId = process.env.TELEGRAM_OWNER_ID;
    if (!ownerId) {
        logger.warn('TELEGRAM_OWNER_ID not set, skipping owner notification');
        return;
    }
    await sendMessage(ownerId, text);
}

async function _logApiCall({ sessionId, method, chatId, statusCode, durationMs, error = null }) {
    try {
        await db.apiCall.create({
            data: {
                sessionId,
                service: 'telegram',
                method,
                requestData: { chatId },
                responseData: {},
                statusCode,
                durationMs,
                error,
            },
        });
    } catch (dbError) {
        logger.warn('Failed to log Telegram API call', { error: dbError.message });
    }
}

module.exports = {
    sendMessage,
    sendPhoto,
    sendInlineKeyboard,
    notifyOwner,
    enableTestChat,
    disableTestChat,
    consumeTestMessages,
};
