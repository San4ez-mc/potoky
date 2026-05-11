'use strict';

const { getBot } = require('./bot');
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { TelegramError } = require('@platform/errors');

const MAX_MESSAGE_LENGTH = 4000;

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

/**
 * Send a text message (splits if >4000 chars). Logs to api_calls.
 */
async function sendMessage(chatId, text, options = {}, sessionId = null) {
    const bot = getBot();
    const startTime = Date.now();
    const defaultOptions = { parse_mode: 'Markdown', ...options };

    try {
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
        await _logApiCall({ sessionId, method: 'sendMessage', chatId, statusCode: error.code || 500, durationMs: Date.now() - startTime, error: error.message });
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
        await bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: replyMarkup,
        });
        await _logApiCall({ sessionId, method: 'sendInlineKeyboard', chatId, statusCode: 200, durationMs: Date.now() - startTime });
    } catch (error) {
        logger.error('Telegram sendInlineKeyboard failed', { chatId, error: error.message });
        await _logApiCall({ sessionId, method: 'sendInlineKeyboard', chatId, statusCode: error.code || 500, durationMs: Date.now() - startTime, error: error.message });
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

module.exports = { sendMessage, sendInlineKeyboard, notifyOwner };
