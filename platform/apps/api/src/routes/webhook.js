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

// ---------------------------------------------------------------------------
// deliverResultToTelegram — sends generated content to a Telegram chat.
// Called after a webhook-triggered flow completes if context.deliverTo is set.
// context.deliverTo = { botToken, chatId, caption? }
// Checks known output context variables in priority order across all content funnels.
// ---------------------------------------------------------------------------
async function deliverResultToTelegram(ctx, slug) {
    const { botToken, chatId, caption } = ctx.deliverTo || {};
    if (!botToken || !chatId) return;

    const tgBase = `https://api.telegram.org/bot${botToken}`;

    try {
        // ── Carousel: array of base64 slides ─────────────────────────────────
        const slidesRaw = ctx.slidesBase64;
        if (Array.isArray(slidesRaw) && slidesRaw.length > 0) {
            // Send up to 10 images as a media group
            const mediaGroup = slidesRaw.slice(0, 10).map((b64, i) => ({
                type: 'photo',
                media: `attach://slide${i}`,
                ...(i === 0 && caption ? { caption } : {}),
            }));
            const form = new FormData();
            form.set('chat_id', String(chatId));
            form.set('media', JSON.stringify(mediaGroup));
            slidesRaw.slice(0, 10).forEach((b64, i) => {
                const buf = Buffer.from(b64, 'base64');
                form.set(`slide${i}`, new Blob([buf], { type: 'image/png' }), `slide${i}.png`);
            });
            await fetch(`${tgBase}/sendMediaGroup`, { method: 'POST', body: form });
            logger.info('[webhookBot] Carousel delivered to Telegram', { slug, chatId, count: slidesRaw.length });
            return;
        }

        // ── Single image base64 ───────────────────────────────────────────────
        const imgB64 = ctx.finalImageBase64 || ctx.imageBase64 || ctx.outputImageBase64;
        if (imgB64) {
            const form = new FormData();
            const buf = Buffer.from(imgB64, 'base64');
            form.set('chat_id', String(chatId));
            form.set('photo', new Blob([buf], { type: 'image/png' }), 'result.png');
            if (caption) form.set('caption', caption);
            await fetch(`${tgBase}/sendPhoto`, { method: 'POST', body: form });
            logger.info('[webhookBot] Image delivered to Telegram', { slug, chatId });
            return;
        }

        // ── Video URL ─────────────────────────────────────────────────────────
        const videoUrl = ctx.videoUrl || ctx.outputVideoUrl || ctx.outputUrl;
        if (videoUrl && /\.(mp4|mov|webm)/i.test(videoUrl)) {
            await fetch(`${tgBase}/sendVideo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(chatId), video: videoUrl, caption: caption || '' }),
            });
            logger.info('[webhookBot] Video delivered to Telegram', { slug, chatId, videoUrl });
            return;
        }

        // ── Generic URL (image) ───────────────────────────────────────────────
        const anyUrl = ctx.outputUrl || ctx.resultUrl;
        if (anyUrl) {
            await fetch(`${tgBase}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(chatId), photo: anyUrl, caption: caption || '' }),
            });
            logger.info('[webhookBot] URL-based result delivered to Telegram', { slug, chatId });
            return;
        }

        logger.warn('[webhookBot] deliverTo set but no recognisable output found in context', { slug, ctxKeys: Object.keys(ctx) });
    } catch (err) {
        logger.error('[webhookBot] deliverResultToTelegram failed', { slug, error: err.message });
    }
}

// POST /webhook/bot/:slug — direct webhook trigger for content funnels
// Accepts any JSON body, injects it into session context, runs the flow asynchronously.
// Optional: include deliverTo: { botToken, chatId, caption? } in the body to receive
// the generated result directly in Telegram when the flow completes.
router.post('/bot/:slug',
    asyncHandler(async (req, res) => {
        const { slug } = req.params;
        res.json({ ok: true, slug });

        setImmediate(async () => {
            try {
                const bot = await db.bot.findFirst({
                    where: { slug },
                    select: { id: true, slug: true, isActive: true },
                });
                if (!bot) {
                    logger.warn('[webhookBot] Bot not found', { slug });
                    return;
                }
                if (!bot.isActive) {
                    logger.warn('[webhookBot] Bot inactive', { slug });
                    return;
                }

                const flow = await db.flowDefinition.findUnique({ where: { botId: bot.id } });
                if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length === 0) {
                    logger.warn('[webhookBot] No flow definition', { slug });
                    return;
                }

                const startNode = flow.nodes.find((n) => n.type === 'start') || flow.nodes[0];

                // Reuse or create a dedicated webhook system user
                // telegramId is BigInt — use a reserved numeric ID (1 = system)
                const WEBHOOK_SYSTEM_TG_ID = BigInt(1);
                let user = await db.user.findFirst({ where: { telegramId: WEBHOOK_SYSTEM_TG_ID } });
                if (!user) {
                    // Resolve projectId from the bot's project
                    const botWithProject = await db.bot.findUnique({
                        where: { id: bot.id },
                        select: { project: { select: { id: true } } },
                    });
                    user = await db.user.create({
                        data: {
                            telegramId: WEBHOOK_SYSTEM_TG_ID,
                            username: 'webhook_system',
                            firstName: 'Webhook',
                            projectId: botWithProject?.project?.id || bot.id,
                        },
                    });
                }

                const contextFromBody = (req.body && typeof req.body === 'object') ? req.body : {};

                const session = await db.session.create({
                    data: {
                        userId: user.id,
                        botId: bot.id,
                        state: startNode?.id || 'start',
                        isActive: true,
                        isTest: false,
                        startedAt: new Date(),
                        lastActive: new Date(),
                        context: {
                            ...contextFromBody,
                            flowRuntime: {
                                currentNodeId: startNode?.id || null,
                                waitingForUser: false,
                                nodesVisited: [],
                                lastUserMessage: '',
                            },
                        },
                    },
                });

                logger.info('[webhookBot] Session created, running flow', { slug, sessionId: session.id });
                await executeFlowStep({ sessionId: session.id });
                logger.info('[webhookBot] Flow step executed', { slug, sessionId: session.id });

                // ── deliverTo: forward result to Telegram ──────────────────────
                if (contextFromBody.deliverTo?.chatId && contextFromBody.deliverTo?.botToken) {
                    const finalCtx = (await db.session.findUnique({
                        where: { id: session.id },
                        select: { context: true },
                    }))?.context || {};
                    await deliverResultToTelegram(finalCtx, slug);
                }

            } catch (error) {
                logger.error('[webhookBot] Unhandled error', {
                    slug,
                    error: error.message,
                    stack: error.stack,
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
            // Log signature mismatch (no sessionId — can't match without valid order)
            db.apiCall.create({
                data: {
                    service: 'wayforpay',
                    method: 'callback',
                    requestData: { orderReference, transactionStatus, amount, currency, merchantAccount },
                    responseData: { signatureValid: false, action: 'decline' },
                    statusCode: 403,
                    durationMs: 0,
                    error: 'Signature mismatch',
                },
            }).catch(() => {});
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

                    // Log callback to api_calls for visibility in session API tab
                    await db.apiCall.create({
                        data: {
                            sessionId: matchedSession.id,
                            service: 'wayforpay',
                            method: 'callback',
                            requestData: {
                                orderReference,
                                transactionStatus,
                                amount,
                                currency,
                                merchantAccount,
                            },
                            responseData: {
                                signatureValid: true,
                                action: 'accept',
                            },
                            statusCode: 200,
                            durationMs: 0,
                        },
                    }).catch(e => logger.error('[wayforpay webhook] Failed to log callback:', { error: e.message }));

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
