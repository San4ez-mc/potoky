'use strict';

require('dotenv').config();

const Bull = require('bull');
const logger = require('@platform/logger');
const { db } = require('@platform/db');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ── Queues ───────────────────────────────────────────────────
const telegramQueue = new Bull('telegram-messages', REDIS_URL);
const notificationQueue = new Bull('notifications', REDIS_URL);

// ── Processors ───────────────────────────────────────────────
telegramQueue.process(async (job) => {
    const { chatId, text, options } = job.data;
    const { sendMessage } = require('@platform/telegram');
    await sendMessage(chatId, text, options);
});

notificationQueue.process(async (job) => {
    const { text } = job.data;
    const { notifyOwner } = require('@platform/telegram');
    await notifyOwner(text);
});

// ── Error handlers ───────────────────────────────────────────
telegramQueue.on('failed', (job, error) => {
    logger.error('Telegram queue job failed', { jobId: job.id, error: error.message });
});

notificationQueue.on('failed', (job, error) => {
    logger.error('Notification queue job failed', { jobId: job.id, error: error.message });
});

// ── Follow-up checker ────────────────────────────────────────
// Runs every 30 min. Finds sessions where user went silent for >4h
// and sends one gentle follow-up message if configured.

const FOLLOW_UP_DELAY_HOURS = Number(process.env.FOLLOW_UP_DELAY_HOURS || 4);
const FOLLOW_UP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function sendFollowUpViaTelegram(token, chatId, text) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram API error: ${err}`);
    }
}

async function checkInactiveSessions() {
    try {
        const cutoff = new Date(Date.now() - FOLLOW_UP_DELAY_HOURS * 60 * 60 * 1000);

        // Find active sessions that haven't had activity for >FOLLOW_UP_DELAY_HOURS hours
        const staleSessions = await db.session.findMany({
            where: {
                isActive: true,
                lastActive: { lte: cutoff },
            },
            include: {
                user: { select: { telegramId: true } },
                bot: { select: { id: true, name: true } },
            },
        });

        for (const session of staleSessions) {
            try {
                const ctx = (typeof session.context === 'object' ? session.context : JSON.parse(session.context || '{}')) || {};
                const runtime = ctx.flowRuntime || {};

                // Only act if we're waiting for user input
                if (!runtime.waitingForUser) continue;

                // Max 1 follow-up per session
                const followUpCount = ctx.followUpCount || 0;
                if (followUpCount >= 1) continue;

                // Per-bot delay override via FOLLOW_UP_DELAY_HOURS funnelKey
                const delayKey = await db.funnelKey.findUnique({
                    where: { botId_key: { botId: session.botId, key: 'FOLLOW_UP_DELAY_HOURS' } },
                    select: { value: true },
                });
                const sessionDelayHours = delayKey ? Number(delayKey.value) : FOLLOW_UP_DELAY_HOURS;
                const sessionCutoff = new Date(Date.now() - sessionDelayHours * 60 * 60 * 1000);
                if (session.lastActive > sessionCutoff) continue; // Not stale enough yet

                const telegramId = session.user?.telegramId;
                if (!telegramId) continue;

                // Get bot's Telegram token — check TELEGRAM_CONNECTOR_ID first, then TELEGRAM_BOT_TOKEN
                const allKeys = await db.funnelKey.findMany({
                    where: { botId: session.botId, key: { in: ['TELEGRAM_CONNECTOR_ID', 'TELEGRAM_BOT_TOKEN'] } },
                    select: { key: true, value: true },
                });
                const km = Object.fromEntries(allKeys.map(k => [k.key, k.value]));
                let token = null;
                if (km.TELEGRAM_CONNECTOR_ID) {
                    const sc = await db.savedConnector.findUnique({ where: { id: km.TELEGRAM_CONNECTOR_ID }, select: { config: true } });
                    token = sc?.config?.token || null;
                }
                if (!token) token = km.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || null;
                if (!token) continue;

                // Get follow-up message from bot key or use default
                const followUpMsgKey = await db.funnelKey.findUnique({
                    where: { botId_key: { botId: session.botId, key: 'FOLLOW_UP_MESSAGE' } },
                    select: { value: true },
                });

                const followUpText = followUpMsgKey?.value
                    || `Привіт! 👋 Ми ще на зв'язку — якщо є питання або хочеш продовжити розмову, просто напиши. Буду радий допомогти! 😊`;

                await sendFollowUpViaTelegram(token, String(telegramId), followUpText);

                // Update session context to track follow-up sent
                const updatedCtx = { ...ctx, followUpCount: followUpCount + 1 };
                await db.session.update({
                    where: { id: session.id },
                    data: { context: updatedCtx },
                });

                logger.info('Follow-up sent', {
                    sessionId: session.id,
                    botId: session.botId,
                    chatId: String(telegramId),
                });
            } catch (sessionError) {
                logger.warn('Follow-up failed for session', {
                    sessionId: session.id,
                    error: sessionError.message,
                });
            }
        }
    } catch (err) {
        logger.error('Follow-up checker error', { error: err.message });
    }
}

// Start follow-up checker after a 2-minute warm-up delay
setTimeout(() => {
    checkInactiveSessions();
    setInterval(checkInactiveSessions, FOLLOW_UP_INTERVAL_MS);
}, 2 * 60 * 1000);

// ── Morning homework reminder ─────────────────────────────────
// Runs every 30 min. Between 09:00-09:30 Kyiv time (UTC+2/+3),
// sends a reminder to users whose course session is stuck waiting
// for a homework event and who haven't received a reminder today.

const HOMEWORK_REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const KYIV_UTC_OFFSET_HOURS = 3; // UTC+3 (use 2 in winter if needed; +3 covers summer DST)

function isKyivMorningWindow() {
    const now = new Date();
    const kyivHour = (now.getUTCHours() + KYIV_UTC_OFFSET_HOURS) % 24;
    const kyivMinute = now.getUTCMinutes();
    return kyivHour === 9 && kyivMinute < 30;
}

function todayKyivDateStr() {
    const now = new Date();
    const kyivMs = now.getTime() + KYIV_UTC_OFFSET_HOURS * 3600 * 1000;
    return new Date(kyivMs).toISOString().slice(0, 10); // YYYY-MM-DD
}

async function resolveBotToken(botId) {
    // Prefer TELEGRAM_CONNECTOR_ID → savedConnector.config.token
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
            if (t && /^\d+:[A-Za-z0-9_-]{20,}$/.test(t.trim())) return t.trim();
        } catch { /* ignore */ }
    }
    const direct = keyMap.TELEGRAM_BOT_TOKEN?.trim();
    if (direct && /^\d+:[A-Za-z0-9_-]{20,}$/.test(direct)) return direct;
    return null;
}

async function sendReminderMessage(token, chatId, text) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Telegram API ${res.status}: ${err.slice(0, 200)}`);
    }
}

async function sendHomeworkReminders() {
    if (!isKyivMorningWindow()) return;

    const today = todayKyivDateStr();

    try {
        // Find active sessions that are paused at an event-wait node (homework gate)
        // runtime.waitEventNodeId is set when the wait node is in event mode and hasn't fired yet
        const activeSessions = await db.session.findMany({
            where: { state: { not: 'completed' } },
            include: {
                user: { select: { id: true, telegramId: true, firstName: true } },
                bot: { select: { id: true, name: true } },
            },
        });

        for (const session of activeSessions) {
            try {
                const ctx = (typeof session.context === 'object' ? session.context : {}) || {};
                const runtime = (typeof ctx.flowRuntime === 'object' ? ctx.flowRuntime : {}) || {};

                // Only sessions stuck waiting for a homework event
                if (!runtime.waitEventNodeId) continue;

                // Only once per day
                if (ctx.homeworkReminderDate === today) continue;

                const telegramId = session.user?.telegramId;
                if (!telegramId) continue;

                const token = await resolveBotToken(session.botId);
                if (!token) continue;

                // Get custom reminder message from funnelKey, or use default
                const reminderKey = await db.funnelKey.findUnique({
                    where: { botId_key: { botId: session.botId, key: 'HOMEWORK_REMINDER_TEXT' } },
                    select: { value: true },
                });

                const firstName = session.user?.firstName || 'друже';
                const reminderText = reminderKey?.value
                    || `🌅 Доброго ранку, ${firstName}!\n\nНагадую, що тебе чекає домашнє завдання від Майкла. Виконай його і повертайся за наступним уроком! 💪`;

                await sendReminderMessage(token, String(telegramId), reminderText);

                // Mark reminder sent today
                const updatedCtx = { ...ctx, homeworkReminderDate: today };
                await db.session.update({ where: { id: session.id }, data: { context: updatedCtx } });

                logger.info('Homework reminder sent', {
                    sessionId: session.id, botId: session.botId, telegramId: String(telegramId),
                });
            } catch (err) {
                logger.warn('Homework reminder failed for session', {
                    sessionId: session.id, error: err.message,
                });
            }
        }
    } catch (err) {
        logger.error('Homework reminder checker error', { error: err.message });
    }
}

// Start homework reminder checker after warm-up
setTimeout(() => {
    sendHomeworkReminders();
    setInterval(sendHomeworkReminders, HOMEWORK_REMINDER_INTERVAL_MS);
}, 3 * 60 * 1000);

// ── Broadcast queue ──────────────────────────────────────────
const broadcastQueue = new Bull('broadcasts', REDIS_URL);

async function sendTelegramMessage(token, chatId, msg) {
    const base = `https://api.telegram.org/bot${token}`;
    let method, body;

    if (msg.photoUrl) {
        method = 'sendPhoto';
        body = { chat_id: chatId, photo: msg.photoUrl, caption: msg.caption || msg.text || '', parse_mode: msg.parseMode || 'Markdown' };
    } else if (msg.documentUrl) {
        method = 'sendDocument';
        body = { chat_id: chatId, document: msg.documentUrl, caption: msg.caption || msg.text || '', parse_mode: msg.parseMode || 'Markdown' };
    } else {
        method = 'sendMessage';
        body = { chat_id: chatId, text: msg.text, parse_mode: msg.parseMode || 'Markdown', disable_web_page_preview: true };
    }

    const res = await fetch(`${base}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram ${method} error: ${err}`);
    }
}

async function getBotToken(botId) {
    // Check TELEGRAM_CONNECTOR_ID -> savedConnector
    const connectorKey = await db.funnelKey.findFirst({
        where: { botId, key: 'TELEGRAM_CONNECTOR_ID' },
    });
    if (connectorKey?.value) {
        const sc = await db.savedConnector.findUnique({ where: { id: connectorKey.value } });
        if (sc?.config?.token) return sc.config.token;
    }
    // Check TELEGRAM_BOT_TOKEN directly
    const tokenKey = await db.funnelKey.findFirst({
        where: { botId, key: 'TELEGRAM_BOT_TOKEN' },
    });
    return tokenKey?.value || null;
}

broadcastQueue.process(async (job) => {
    const { broadcastId } = job.data;
    const broadcast = await db.broadcast.findUnique({ where: { id: broadcastId } });
    if (!broadcast || broadcast.status === 'cancelled') return;

    await db.broadcast.update({ where: { id: broadcastId }, data: { status: 'sending' } });

    const recipients = Array.isArray(broadcast.recipients) ? broadcast.recipients : [];
    const message = broadcast.message || {};

    // Cache bot tokens
    const tokenCache = {};
    const getToken = async (botId) => {
        if (!tokenCache[botId]) tokenCache[botId] = await getBotToken(botId);
        return tokenCache[botId];
    };

    let sent = 0, failed = 0;
    const updatedRecipients = [...recipients];

    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        try {
            const token = await getToken(r.botId);
            if (!token) throw new Error('No bot token');
            await sendTelegramMessage(token, r.telegramId, message);
            updatedRecipients[i] = { ...r, sent: true };
            sent++;
        } catch (err) {
            const errMsg = String(err.message || '').toLowerCase();
            const isBlocked = errMsg.includes('blocked') || errMsg.includes('forbidden') || errMsg.includes('403') || errMsg.includes('deactivated');
            if (isBlocked && r.botId) {
                // Mark user session as unsubscribed
                db.session.updateMany({
                    where: { botId: r.botId, isActive: true, user: { telegramId: BigInt(r.telegramId) } },
                    data: { isActive: false, state: 'unsubscribed' },
                }).catch(() => {});
            }
            updatedRecipients[i] = { ...r, sent: false, error: err.message, unsubscribed: isBlocked };
            failed++;
            logger.error('Broadcast send error', { broadcastId, telegramId: r.telegramId, error: err.message, isBlocked });
        }
        // Rate limit: 30 msg/sec max, use 50ms delay
        if (i < recipients.length - 1) await new Promise(resolve => setTimeout(resolve, 50));
    }

    await db.broadcast.update({
        where: { id: broadcastId },
        data: {
            status: 'sent',
            sentAt: new Date(),
            stats: { total: recipients.length, sent, failed },
            recipients: updatedRecipients,
        },
    });

    logger.info('Broadcast completed', { broadcastId, sent, failed });
});

broadcastQueue.on('failed', (job, error) => {
    logger.error('Broadcast queue job failed', { jobId: job.id, error: error.message });
    db.broadcast.update({ where: { id: job.data.broadcastId }, data: { status: 'failed' } }).catch(() => {});
});

// ── Graceful shutdown ────────────────────────────────────────
async function shutdown() {
    logger.info('Worker shutting down...');
    await telegramQueue.close();
    await notificationQueue.close();
    await broadcastQueue.close();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info('Platform worker started', { redis: REDIS_URL });

module.exports = { telegramQueue, notificationQueue, broadcastQueue };
