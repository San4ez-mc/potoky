'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const logger = require('@platform/logger');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { executeFlowStep } = require('../services/testSession');
const { deliverSessionMessages } = require('../services/platformBotHandler');

const router = Router();

// WayForPay sends JSON as raw body. Express urlencoded (qs) parses it strangely:
// Case 1: entire JSON as one key with empty value  -> { '{...}': '' }
// Case 2: qs splits on '[' (array notation) -> { '{...,"products":': { '{...}': '' } }
// This function reconstructs the original JSON object from either case.
function parseWfpBody(body) {
    if (!body || typeof body !== 'object') return body;
    const keys = Object.keys(body);
    if (keys.length !== 1 || !keys[0].startsWith('{')) return body;

    const outerKey = keys[0];
    const outerValue = body[outerKey];

    // Case 1: entire JSON as single key with empty value
    if (outerValue === '' || outerValue === undefined || outerValue === null) {
        try { return JSON.parse(outerKey); } catch {}
    }

    // Case 2: JSON split at products array — qs parsed '[{...}]' as nested object
    // Reconstruct: outerKey + '[' + innerKey + ']}'
    if (outerValue !== null && typeof outerValue === 'object') {
        const innerKeys = Object.keys(outerValue);
        if (innerKeys.length === 1 && innerKeys[0].startsWith('{')) {
            try {
                const reconstructed = outerKey + '[' + innerKeys[0] + ']}';
                const parsed = JSON.parse(reconstructed);
                if (parsed.merchantAccount) return parsed;
            } catch {}
        }
    }

    return body;
}

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
                const { handleTelegramUpdate } = require('../../../../projects/finance-course/src/telegramHandler');
                await handleTelegramUpdate(update);
            } catch (error) {
                logger.error('Telegram webhook handler failed', { error: error.message, stack: error.stack });
            }
        });
    })
);

// POST /webhook/telegram/:botId — bot-scoped webhook endpoint (platform flow bots)
router.post('/telegram/:botId',
    verifyTelegramSecretForBot,
    asyncHandler(async (req, res) => {
        const update = req.body;
        const botId = req.params.botId;
        res.json({ ok: true });

        setImmediate(async () => {
            try {
                const { handlePlatformBotUpdate } = require('../services/platformBotHandler');
                await handlePlatformBotUpdate(botId, update);
            } catch (error) {
                logger.error('Telegram webhook handler failed (bot-scoped)', {
                    botId,
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

// POST /webhook/wayforpay — WayForPay payment notification
router.post('/wayforpay',
    asyncHandler(async (req, res) => {
        const body = parseWfpBody(req.body || {});
        const {
            merchantAccount,
            orderReference,
            merchantSignature,
            transactionStatus,
            amount,
            currency,
        } = body;

        // Load WayForPay connector config to verify signature
        const savedConnector = await db.savedConnector.findFirst({
            where: { type: 'wayforpay', isActive: true },
        });

        if (!savedConnector) {
            logger.warn('[wayforpay webhook] Connector not found');
            return res.status(200).json({ orderReference, status: 'decline', time: Math.floor(Date.now() / 1000), signature: '' });
        }

        const config = savedConnector.config || {};
        const merchantSecret = config.merchant_secret || '';

        // Verify incoming signature: HMAC MD5 of "merchantAccount;orderReference;amount;currency;authCode;cardPan;transactionStatus;reasonCode"
        const signatureFields = [
            body.merchantAccount,
            body.orderReference,
            body.amount,
            body.currency,
            body.authCode || '',
            body.cardPan || '',
            body.transactionStatus || '',
            body.reasonCode || '',
        ].join(';');

        const expectedSignature = crypto
            .createHmac('md5', merchantSecret)
            .update(signatureFields)
            .digest('hex');

        logger.info('[wayforpay webhook] DEBUG callback', { body: JSON.stringify(body), expectedSignature, merchantSignature });
        if (merchantSignature !== expectedSignature) {
            logger.warn('[wayforpay webhook] Signature mismatch', { orderReference });
            return res.status(200).json({ orderReference, status: 'decline', time: Math.floor(Date.now() / 1000), signature: '' });
        }

        logger.info('[wayforpay webhook] Payment received', { orderReference, transactionStatus, amount, currency });

        // Respond to WayForPay immediately — flow advancement happens in the background
        const responseSignature = crypto
            .createHmac('md5', merchantSecret)
            .update([orderReference, 'accept'].join(';'))
            .digest('hex');

        res.status(200).json({
            orderReference,
            status: 'accept',
            time: Math.floor(Date.now() / 1000),
            signature: responseSignature,
        });

        // Advance the flow session in the background so wait_payment node can proceed
        if (transactionStatus === 'Approved') {
            setImmediate(async () => {
                try {
                    const sessions = await db.session.findMany({
                        where: { state: { not: 'completed' } },
                        select: { id: true, context: true, botId: true, userId: true },
                    });

                    const matchedSession = sessions.find((s) => {
                        const ctx = s.context || {};
                        return ctx.wfp_order_reference === orderReference;
                    });

                    if (!matchedSession) {
                        logger.warn('[wayforpay webhook] No active session found for orderReference', { orderReference });
                        return;
                    }

                    // Mark payment as approved in session context
                    await db.session.update({
                        where: { id: matchedSession.id },
                        data: {
                            context: {
                                ...matchedSession.context,
                                wfp_payment_status: 'approved',
                                wfp_transaction_status: transactionStatus,
                            },
                        },
                    });
                    logger.info('[wayforpay webhook] Session updated with payment status', { sessionId: matchedSession.id });

                    // Advance the flow (wait_payment node checks wfp_payment_status === 'approved')
                    const sinceTime = new Date();
                    await executeFlowStep({ sessionId: matchedSession.id, incomingUserMessage: null });

                    // Deliver new messages to the user via Telegram
                    if (matchedSession.userId) {
                        const user = await db.user.findUnique({
                            where: { id: matchedSession.userId },
                            select: { telegramId: true },
                        });
                        if (user?.telegramId) {
                            await deliverSessionMessages(
                                matchedSession.botId,
                                matchedSession.id,
                                Number(user.telegramId),
                                sinceTime,
                            );
                        }
                    }

                    logger.info('[wayforpay webhook] Flow advanced after payment', { sessionId: matchedSession.id });
                } catch (err) {
                    logger.error('[wayforpay webhook] Failed to advance flow after payment', {
                        orderReference,
                        error: err.message,
                        stack: err.stack,
                    });
                }
            });
        }
    })
);

module.exports = router;
