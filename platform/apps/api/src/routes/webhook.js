'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const logger = require('@platform/logger');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = Router();

/**
 * Verify Telegram webhook secret token.
 */
function verifyTelegramSecret(req, res, next) {
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (!token || token !== process.env.TELEGRAM_WEBHOOK_SECRET) {
        logger.warn('Invalid Telegram webhook secret', { ip: req.ip });
        return res.status(403).json({ ok: false });
    }
    next();
}

async function verifyTelegramSecretForBot(req, res, next) {
    const token = req.headers['x-telegram-bot-api-secret-token'];
    const botId = req.params.botId;

    const key = await db.funnelKey.findUnique({
        where: { botId_key: { botId, key: 'TELEGRAM_WEBHOOK_SECRET' } },
        select: { value: true },
    });

    const expected = key?.value || process.env.TELEGRAM_WEBHOOK_SECRET || null;

    // If secret is not configured, do not block delivery.
    if (!expected) return next();

    if (!token || token !== expected) {
        logger.warn('Invalid Telegram webhook secret (bot-scoped)', { ip: req.ip, botId });
        return res.status(403).json({ ok: false });
    }

    next();
}

// POST /webhook/telegram — finance-course bot
router.post('/telegram',
    verifyTelegramSecret,
    asyncHandler(async (req, res) => {
        const update = req.body;
        res.json({ ok: true }); // відповідаємо Telegram одразу

        // Обробка у фоні (щоб не timeout)
        setImmediate(async () => {
            try {
                const { handleTelegramUpdate } = require('../../../../../../projects/finance-course/src/telegramHandler');
                await handleTelegramUpdate(update);
            } catch (error) {
                logger.error('Telegram webhook handler failed', { error: error.message, stack: error.stack });
            }
        });
    })
);

// POST /webhook/telegram/:botId — bot-scoped webhook endpoint
router.post('/telegram/:botId',
    verifyTelegramSecretForBot,
    asyncHandler(async (req, res) => {
        const update = req.body;
        res.json({ ok: true });

        setImmediate(async () => {
            try {
                const { handleTelegramUpdate } = require('../../../../../../projects/finance-course/src/telegramHandler');
                await handleTelegramUpdate(update);
            } catch (error) {
                logger.error('Telegram webhook handler failed (bot-scoped)', {
                    botId: req.params.botId,
                    error: error.message,
                    stack: error.stack,
                });
            }
        });
    })
);

// GET /webhook/instagram/:botId — Meta verification challenge
router.get('/instagram/:botId',
    asyncHandler(async (req, res) => {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        const botId = req.params.botId;

        const key = await db.funnelKey.findUnique({
            where: { botId_key: { botId, key: 'INSTAGRAM_VERIFY_TOKEN' } },
            select: { value: true },
        });

        if (mode === 'subscribe' && key?.value && token === key.value) {
            return res.status(200).send(String(challenge || 'OK'));
        }

        logger.warn('Instagram webhook verify failed', { botId, ip: req.ip });
        return res.status(403).send('Forbidden');
    })
);

// POST /webhook/instagram/:botId — incoming Instagram events
router.post('/instagram/:botId',
    asyncHandler(async (req, res) => {
        // ACK quickly to avoid retries from Meta.
        res.status(200).json({ ok: true });

        setImmediate(async () => {
            try {
                logger.info('Instagram webhook event received', {
                    botId: req.params.botId,
                    object: req.body?.object,
                });
            } catch (error) {
                logger.error('Instagram webhook handler failed', {
                    botId: req.params.botId,
                    error: error.message,
                });
            }
        });
    })
);

module.exports = router;
