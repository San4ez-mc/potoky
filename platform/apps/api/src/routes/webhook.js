'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const logger = require('@platform/logger');
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

module.exports = router;
