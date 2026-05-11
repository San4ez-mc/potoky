'use strict';

require('dotenv').config();

const Bull = require('bull');
const logger = require('@platform/logger');

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

// ── Graceful shutdown ────────────────────────────────────────
async function shutdown() {
    logger.info('Worker shutting down...');
    await telegramQueue.close();
    await notificationQueue.close();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info('Platform worker started', { redis: REDIS_URL });

module.exports = { telegramQueue, notificationQueue };
