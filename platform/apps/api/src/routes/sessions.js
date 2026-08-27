'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');
const { sendMessage, sendPhoto } = require('@platform/telegram');
const {
    startTestSession,
    sendTestMessage,
    getTestSessionState,
    endTestSession,
} = require('../services/testSession');

const router = Router();

const { guardSessionParam } = require('../middleware/rbac');
router.param('id', guardSessionParam);
router.param('sessionId', guardSessionParam);

async function deleteSessionCascade(sessionId) {
    return db.$transaction(async (tx) => {
        const exists = await tx.session.findUnique({
            where: { id: sessionId },
            select: { id: true },
        });
        if (!exists) {
            throw new NotFoundError('Session', sessionId);
        }

        await tx.message.deleteMany({ where: { sessionId } });
        await tx.apiCall.deleteMany({ where: { sessionId } });
        await tx.file.deleteMany({ where: { sessionId } });
        await tx.appError.deleteMany({ where: { sessionId } });
        await tx.session.delete({ where: { id: sessionId } });
    });
}

// POST /api/sessions/test/start
router.post('/test/start',
    validateParams({
        body: z.object({
            botId: z.string().uuid().optional(),
            botSlug: z.string().min(1).optional(),
            userId: z.string().uuid().optional(),
            contextOverride: z.record(z.any()).optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId, botSlug, userId, contextOverride } = req.body;
        if (!botId && !botSlug) {
            return res.status(400).json({ ok: false, error: 'Provide botId or botSlug' });
        }

        const data = await startTestSession({ botId, botSlug, userId, contextOverride });
        res.json({ ok: true, data });
    })
);

// POST /api/sessions/test/:id/send
router.post('/test/:id/send',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ message: z.string().min(1).max(4096) }),
    }),
    asyncHandler(async (req, res) => {
        const data = await sendTestMessage({ sessionId: req.params.id, message: req.body.message });
        res.json({ ok: true, data });
    })
);

// GET /api/sessions/test/:id/state
router.get('/test/:id/state',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const data = await getTestSessionState({ sessionId: req.params.id });
        res.json({ ok: true, data });
    })
);

// POST /api/sessions/test/:id/end
router.post('/test/:id/end',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const data = await endTestSession({ sessionId: req.params.id });
        res.json({ ok: true, data });
    })
);

// GET /api/sessions/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.id },
            include: {
                user: true,
                bot: true,
            },
        });
        if (!session) throw new NotFoundError('Session', req.params.id);
        res.json({ ok: true, data: session });
    })
);

// GET /api/sessions/:id/errors
router.get('/:id/errors',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const [appErrors, failedApiCalls] = await Promise.all([
            db.appError.findMany({
                where: { sessionId: req.params.id },
                orderBy: { createdAt: 'desc' },
                take: 100,
            }),
            db.apiCall.findMany({
                where: {
                    sessionId: req.params.id,
                    OR: [
                        { error: { not: null } },
                        { statusCode: { gte: 400 } },
                    ],
                },
                orderBy: { createdAt: 'desc' },
                take: 100,
            }),
        ]);

        res.json({ ok: true, data: { appErrors, failedApiCalls } });
    })
);

// GET /api/sessions/:id/messages
router.get('/:id/messages',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const messages = await db.message.findMany({
            where: { sessionId: req.params.id },
            orderBy: { createdAt: 'asc' },
        });
        res.json({ ok: true, data: messages });
    })
);

// GET /api/sessions/:id/api-calls
router.get('/:id/api-calls',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const apiCalls = await db.apiCall.findMany({
            where: { sessionId: req.params.id },
            orderBy: { createdAt: 'asc' },
        });
        res.json({ ok: true, data: apiCalls });
    })
);

// ─── Helper: resolve bot token for a session ─────────────────────────────────
// Tries per-bot funnelKey first, falls back to global singleton.
async function resolveBotToken(botId) {
    if (!botId) return null;
    try {
        const keys = await db.funnelKey.findMany({
            where: { botId, key: { in: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CONNECTOR_ID'] } },
            select: { key: true, value: true },
        });
        const keyMap = Object.fromEntries(keys.map(k => [k.key, k.value]));

        const connectorId = keyMap.TELEGRAM_CONNECTOR_ID;
        if (connectorId) {
            const conn = await db.savedConnector.findUnique({ where: { id: connectorId }, select: { config: true } });
            const t = conn?.config?.token;
            if (t && /^\d+:[A-Za-z0-9_-]{20,}$/.test(t.trim())) return t.trim();
        }
        const direct = keyMap.TELEGRAM_BOT_TOKEN;
        if (direct && /^\d+:[A-Za-z0-9_-]{20,}$/.test(direct.trim())) return direct.trim();

        // Fallback to env (same as getBotToken in platformBotHandler)
        const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
        if (envToken && /^\d+:[A-Za-z0-9_-]{20,}$/.test(envToken)) return envToken;
    } catch { /* fall through */ }
    return null;
}

// ─── Helper: send via per-bot token (or fallback to global) ──────────────────
// opts: { photoBuffer, docBuffer, docName, docMimeType }
async function sendViaBot(botId, chatId, text, photoBuffer, opts = {}) {
    const token = await resolveBotToken(botId);
    const { docBuffer, docName, docMimeType } = opts;

    if (token) {
        const apiBase = `https://api.telegram.org/bot${token}`;
        // Аудит 2026-08-27: пакет 'form-data' + нативний fetch (undici, Node 22) на
        // sendPhoto/sendDocument мовчки повертав 400 з ПОРОЖНІМ тілом — form-data
        // генерує body як Node-стрім, а undici його не консюмить як multipart без
        // ручного duplex-налаштування. Знайдено при тестуванні розпізнавання фото
        // для goverla_shop (інший канал, Zernio, але саме ця функція — спільна для
        // всіх Telegram-ботів і вручну ручного відправлення фото/документів з
        // адмінки — тобто це реальний, тихий збій для Telegram-каналів). Замінено
        // на нативні FormData/Blob (глобальні в Node 18+, fetch-сумісні напряму).

        if (docBuffer) {
            const form = new FormData();
            form.append('chat_id', String(chatId));
            form.append('document', new Blob([docBuffer], { type: docMimeType || 'application/octet-stream' }), docName || 'document');
            if (text) form.append('caption', text);
            const res = await fetch(`${apiBase}/sendDocument`, { method: 'POST', body: form });
            if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`ETELEGRAM: ${res.status} ${txt}`); }
            const data = await res.json().catch(() => ({}));
            return data?.result?.message_id || null;
        }

        if (photoBuffer) {
            const form = new FormData();
            form.append('chat_id', String(chatId));
            form.append('photo', new Blob([photoBuffer], { type: 'image/jpeg' }), 'photo.jpg');
            if (text) form.append('caption', text);
            const res = await fetch(`${apiBase}/sendPhoto`, { method: 'POST', body: form });
            if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`ETELEGRAM: ${res.status} ${txt}`); }
            const data = await res.json().catch(() => ({}));
            return data?.result?.message_id || null;
        }

        const res = await fetch(`${apiBase}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'HTML', disable_web_page_preview: true }),
        });
        if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`ETELEGRAM: ${res.status} ${txt}`); }
        const data = await res.json().catch(() => ({}));
        return data?.result?.message_id || null;
    }

    // Fallback: global singleton (photo only, docs not supported via global)
    if (photoBuffer) {
        await sendPhoto(Number(chatId), photoBuffer, text || '', {});
    } else {
        await sendMessage(Number(chatId), text, {});
    }
}

// POST /api/sessions/:id/send — manual message from admin to user's Telegram
router.post('/:id/send',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.id },
            include: { user: true },
        });
        if (!session) throw new NotFoundError('Session', req.params.id);

        const rawText = typeof req.body?.text === 'string' ? req.body.text : '';
        const text = rawText.trim();
        const photoBase64 = typeof req.body?.photoBase64 === 'string' ? req.body.photoBase64 : '';
        const photoName = typeof req.body?.photoName === 'string' ? req.body.photoName : 'image';
        const photoMimeType = typeof req.body?.photoMimeType === 'string' ? req.body.photoMimeType : 'image/jpeg';
        const docBase64 = typeof req.body?.docBase64 === 'string' ? req.body.docBase64 : '';
        const docName = typeof req.body?.docName === 'string' ? req.body.docName : 'document';
        const docMimeType = typeof req.body?.docMimeType === 'string' ? req.body.docMimeType : 'application/octet-stream';

        if (!text && !photoBase64 && !docBase64) {
            return res.status(400).json({ ok: false, error: { message: 'Надішліть текст, фото або документ' } });
        }

        // ── Zernio-сесія (Instagram через Zernio): відповідь через Zernio Send API,
        // НЕ Telegram. Без цієї гілки ручна відповідь падала в telegram-логіку нижче
        // й показувала «Чат не знайдено в Telegram», хоча в цій воронці Telegram
        // взагалі не використовується (напр. covercar/goverla_shop).
        if (session.context?.channel === 'zernio') {
            if (!text) {
                return res.status(422).json({ ok: false, error: { message: 'Для Zernio поки підтримується лише текстова відповідь.' } });
            }
            const conversationId = session.context?.conversationId || '';
            let znMsgId = null;
            try {
                const { sendZernioMessage } = require('../services/zernioHandler');
                znMsgId = await sendZernioMessage(session.botId, conversationId, text);
            } catch (znErr) {
                return res.status(422).json({ ok: false, error: { message: znErr.message } });
            }
            await db.message.create({
                data: {
                    sessionId: session.id,
                    role: 'assistant',
                    content: text,
                    metadata: { source: 'admin_manual', channel: 'zernio', ...(znMsgId ? { zernioMessageId: znMsgId } : {}) },
                },
            });
            const ctxUpdate = { ...(session.context || {}) };
            if (!ctxUpdate.adminEngaged) ctxUpdate.adminEngaged = true;
            if (!ctxUpdate.funnelPaused) ctxUpdate.funnelPaused = true;
            await db.session.update({ where: { id: session.id }, data: { context: ctxUpdate } });
            return res.json({ ok: true });
        }

        // ── Instagram-сесія: відповідь через Meta Send API (не Telegram) ──────────
        // Ізольована гілка — Telegram-логіка нижче лишається без змін.
        if (session.context?.channel === 'instagram') {
            if (!text) {
                return res.status(422).json({ ok: false, error: { message: 'Для Instagram поки підтримується лише текстова відповідь.' } });
            }
            const igsid = session.context?.igsid || String(session.user?.telegramId || '');
            let igMsgId = null;
            try {
                const { sendInstagramMessage } = require('../services/instagramHandler');
                igMsgId = await sendInstagramMessage(session.botId, igsid, text);
            } catch (igErr) {
                return res.status(422).json({ ok: false, error: { message: igErr.message } });
            }
            await db.message.create({
                data: {
                    sessionId: session.id,
                    role: 'assistant',
                    content: text,
                    metadata: { source: 'admin_manual', channel: 'instagram', ...(igMsgId ? { instagramMessageId: igMsgId } : {}) },
                },
            });
            const ctxUpdate = { ...(session.context || {}) };
            if (!ctxUpdate.adminEngaged) ctxUpdate.adminEngaged = true;
            if (!ctxUpdate.funnelPaused) ctxUpdate.funnelPaused = true;
            await db.session.update({ where: { id: session.id }, data: { context: ctxUpdate } });
            return res.json({ ok: true });
        }

        const decodeBase64 = (b64, label) => {
            const normalized = b64.includes(',') ? b64.split(',')[1] : b64;
            const buf = Buffer.from(normalized, 'base64');
            if (!buf || buf.length === 0) throw new Error(`Порожній ${label}`);
            if (buf.length > 50 * 1024 * 1024) throw new Error(`${label} завеликий (макс 50MB)`);
            return buf;
        };

        let photoBuffer = null;
        if (photoBase64) {
            try { photoBuffer = decodeBase64(photoBase64, 'фото'); }
            catch (e) { return res.status(400).json({ ok: false, error: { message: e.message } }); }
        }

        let docBuffer = null;
        if (docBase64) {
            try { docBuffer = decodeBase64(docBase64, 'документ'); }
            catch (e) { return res.status(400).json({ ok: false, error: { message: e.message } }); }
        }

        let tgMessageId = null;
        try {
            tgMessageId = await sendViaBot(session.botId, session.user.telegramId, text, photoBuffer, { docBuffer, docName, docMimeType });
        } catch (tgErr) {
            const msg = tgErr.message || '';
            if (msg.includes('403') || msg.includes('blocked')) {
                return res.status(422).json({ ok: false, error: { message: 'Користувач заблокував бота — повідомлення не доставлено' } });
            }
            if (msg.includes('400') || msg.includes('chat not found')) {
                return res.status(422).json({ ok: false, error: { message: 'Чат не знайдено в Telegram — можливо бот ще не запущений цим користувачем' } });
            }
            throw tgErr;
        }

        const contentLabel = docBuffer ? `📎 ${docName}` : photoBuffer ? '📷 Фото' : text;
        await db.message.create({
            data: {
                sessionId: session.id,
                role: 'assistant',
                content: text || contentLabel,
                metadata: {
                    source: 'admin_manual',
                    hasPhoto: Boolean(photoBuffer),
                    hasDoc: Boolean(docBuffer),
                    photoName: photoBuffer ? photoName : null,
                    photoMimeType: photoBuffer ? photoMimeType : null,
                    docName: docBuffer ? docName : null,
                    docMimeType: docBuffer ? docMimeType : null,
                    ...(tgMessageId ? { telegramMessageId: tgMessageId } : {}),
                },
            },
        });

        // Mark session as admin-engaged + auto-pause funnel so bot doesn't interrupt
        const ctxUpdate = { ...(session.context || {}) };
        if (!ctxUpdate.adminEngaged) ctxUpdate.adminEngaged = true;
        if (!ctxUpdate.funnelPaused) ctxUpdate.funnelPaused = true;
        await db.session.update({ where: { id: session.id }, data: { context: ctxUpdate } });

        res.json({ ok: true });
    })
);

// PATCH /api/sessions/:id/flags — toggle adminEngaged / funnelPaused in session context
router.patch('/:id/flags',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
            adminEngaged: z.boolean().optional(),
            funnelPaused: z.boolean().optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({ where: { id: req.params.id } });
        if (!session) throw new NotFoundError('Session', req.params.id);
        const ctx = { ...(session.context || {}) };
        if (req.body.adminEngaged !== undefined) ctx.adminEngaged = req.body.adminEngaged;
        if (req.body.funnelPaused !== undefined) ctx.funnelPaused = req.body.funnelPaused;

        const data = { context: ctx };
        // «Запустити бота» (знімаємо паузу) має реально повертати бота в діалог:
        // 1) знімаємо і handoff-прапорець (інакше бот лишається мовчазним),
        // 2) якщо флоу нікуди не вказує (сесія завершилась/була передана людині) —
        //    ставимо на стартову ноду, щоб бот відповів на НАСТУПНЕ повідомлення.
        if (req.body.funnelPaused === false) {
            ctx.adminEngaged = false;
            delete ctx.handoffReason;
            const rt = { ...(ctx.flowRuntime || {}) };
            if (!rt.currentNodeId) {
                const flowDef = await db.flowDefinition.findUnique({ where: { botId: session.botId } }).catch(() => null);
                const nodes = Array.isArray(flowDef?.nodes) ? flowDef.nodes : [];
                const startNode = nodes.find((n) => n.type === 'start') || nodes[0] || null;
                if (startNode) {
                    rt.currentNodeId = startNode.id;
                    rt.waitingForUser = false;
                    ctx.currentNode = startNode.id;
                    data.state = startNode.id;
                }
            }
            ctx.flowRuntime = rt;
            data.isActive = true;
            data.completedAt = null;
        }

        const updated = await db.session.update({ where: { id: session.id }, data });
        res.json({ ok: true, data: { context: updated.context } });
    })
);

// GET /api/sessions/:id/user-photo — proxy Telegram profile photo for the session user
router.get('/:id/user-photo',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.id },
            include: { user: { select: { telegramId: true } } },
        });
        if (!session?.user?.telegramId) return res.status(404).end();

        // Resolve bot token
        const keys = await db.funnelKey.findMany({
            where: { botId: session.botId, key: { in: ['TELEGRAM_CONNECTOR_ID', 'TELEGRAM_BOT_TOKEN'] } },
            select: { key: true, value: true },
        });
        const kv = Object.fromEntries(keys.map(k => [k.key, k.value]));
        let token = kv.TELEGRAM_BOT_TOKEN;
        if (!token && kv.TELEGRAM_CONNECTOR_ID) {
            const conn = await db.savedConnector.findUnique({ where: { id: kv.TELEGRAM_CONNECTOR_ID } });
            token = conn?.config?.token;
        }
        if (!token) return res.status(404).end();

        const tgBase = `https://api.telegram.org/bot${token}`;
        const photosRes = await fetch(`${tgBase}/getUserProfilePhotos?user_id=${session.user.telegramId}&limit=1`);
        const photosData = await photosRes.json();
        const fileId = photosData?.result?.photos?.[0]?.[2]?.file_id // larger size
            || photosData?.result?.photos?.[0]?.[0]?.file_id;
        if (!fileId) return res.status(404).end();

        const fileRes = await fetch(`${tgBase}/getFile?file_id=${fileId}`);
        const fileData = await fileRes.json();
        const filePath = fileData?.result?.file_path;
        if (!filePath) return res.status(404).end();

        const imgRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
        if (!imgRes.ok) return res.status(404).end();
        res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        imgRes.body.pipe(res);
    })
);

// POST /api/sessions/:id/restart — reset session to initial state and re-run flow
router.post('/:id/restart',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.id },
            include: { user: true },
        });
        if (!session) throw new NotFoundError('Session', req.params.id);

        // Аудит 2026-08-27 (запит користувача): раніше цей ендпоінт ВИДАЛЯВ усю
        // історію (повідомлення/API-виклики/помилки) — сесія фактично губилась
        // (ставала непомітною в списках/пошуку без жодного повідомлення). Тепер
        // історія ЗБЕРІГАЄТЬСЯ — скидається лише логіка воронки (context/state),
        // і в саму сесію додається технічне повідомлення-мітка про рестарт.
        await db.message.create({
            data: {
                sessionId: session.id,
                role: 'event',
                content: '🔄 Сесію перезапущено вручну (адмін-панель) — історія збережена, воронка почала з початку.',
                metadata: { source: 'admin_restart' },
            },
        });
        await db.session.update({
            where: { id: session.id },
            data: {
                state: '',
                context: {},
                isActive: true,
                completedAt: null,
                lastActive: new Date(),
            },
        });

        // Re-run flow from start (like /start was pressed again)
        const { executeFlowStep } = require('../services/testSession');
        await executeFlowStep({ sessionId: session.id, incomingUserMessage: null }).catch(() => {});

        res.json({ ok: true });
    })
);

// PATCH /api/sessions/:id/mark-test — toggle isTest flag
router.patch('/:id/mark-test',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ isTest: z.boolean() }),
    }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({ where: { id: req.params.id } });
        if (!session) throw new NotFoundError('Session', req.params.id);

        const updated = await db.session.update({
            where: { id: req.params.id },
            data: { isTest: req.body.isTest },
        });
        res.json({ ok: true, data: { id: updated.id, isTest: updated.isTest } });
    })
);

// DELETE /api/sessions/:id
router.delete('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        await deleteSessionCascade(req.params.id);
        res.json({ ok: true });
    })
);

// POST /api/sessions/bulk-delete
router.post('/bulk-delete',
    validateParams({
        body: z.object({
            ids: z.array(z.string().uuid()).min(1).max(200),
        }),
    }),
    asyncHandler(async (req, res) => {
        const ids = Array.from(new Set(req.body.ids));

        await db.$transaction(async (tx) => {
            await tx.message.deleteMany({ where: { sessionId: { in: ids } } });
            await tx.apiCall.deleteMany({ where: { sessionId: { in: ids } } });
            await tx.file.deleteMany({ where: { sessionId: { in: ids } } });
            await tx.appError.deleteMany({ where: { sessionId: { in: ids } } });
            await tx.session.deleteMany({ where: { id: { in: ids } } });
        });

        res.json({ ok: true, data: { deleted: ids.length } });
    })
);

// ── CONTEXT PASSING (Gap #4: load context from previous sessions) ────

// GET /api/sessions/:sessionId/context — load context from user's files
router.get('/:sessionId/context',
    validateParams({ params: z.object({ sessionId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.sessionId },
            select: { userId: true, botId: true },
        });
        if (!session) throw new NotFoundError('Session', req.params.sessionId);

        // Load all files saved by this user
        const files = await db.file.findMany({
            where: { userId: session.userId },
            orderBy: { createdAt: 'desc' },
        });

        // Map files to context variables based on fileType
        const context = {};
        const fileTypeToContextVar = {
            cashflow_articles: 'cashflowArticles',
            pl_articles: 'plArticles',
            business_process: 'businessProcess',
            business_process_v2: 'businessProcessV2',
            cashflow_table_url: 'sheetsUrl',
            combined_table_url: 'combinedUrl',
            financial_mechanics: 'financialMechanics',
            salary_processes: 'salaryProcesses',
            payment_processes: 'paymentProcesses',
            balance_articles: 'balanceArticles',
            balance_table_url: 'balanceUrl',
            payment_calendar_url: 'calendarUrl',
            team_instructions: 'teamInstructions',
            user_onboarding_data: 'onboarding_result',
        };

        // For each file type, use the most recent file
        const seenTypes = new Set();
        for (const file of files) {
            if (seenTypes.has(file.fileType)) continue;
            seenTypes.add(file.fileType);

            const contextVar = fileTypeToContextVar[file.fileType];
            if (contextVar) {
                context[contextVar] = {
                    url: file.url,
                    fileName: file.fileName,
                    savedAt: file.createdAt,
                    botId: file.botId,
                };
            }
        }

        res.json({
            ok: true,
            data: {
                sessionId: req.params.sessionId,
                userId: session.userId,
                context,
                filesCount: files.length,
            },
        });
    })
);

// DELETE /api/sessions/:id/messages/:msgId — delete message from Telegram + DB
// PATCH /api/sessions/:id/messages/:msgId — edit message content (+ Telegram editMessageText)
router.patch('/:id/messages/:msgId',
    validateParams({
        params: z.object({ id: z.string().uuid(), msgId: z.string().uuid() }),
        body: z.object({ content: z.string().min(1).max(4096) }),
    }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.id },
            include: { user: { select: { telegramId: true } } },
        });
        if (!session) throw new NotFoundError('Session', req.params.id);

        const msg = await db.message.findUnique({ where: { id: req.params.msgId } });
        if (!msg || msg.sessionId !== session.id) {
            return res.status(404).json({ ok: false, error: { message: 'Message not found' } });
        }

        const newContent = req.body.content.trim();
        const tgMsgId = msg.metadata?.telegramMessageId;
        const chatId = session.user?.telegramId;
        let tgEdited = false;

        if (tgMsgId && chatId) {
            const token = await resolveBotToken(session.botId);
            if (token) {
                const editRes = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: String(chatId), message_id: tgMsgId, text: newContent, parse_mode: 'HTML' }),
                }).catch(() => null);
                if (editRes?.ok) tgEdited = true;
            }
        }

        const updated = await db.message.update({
            where: { id: msg.id },
            data: { content: newContent, metadata: { ...(msg.metadata || {}), edited: true } },
        });

        res.json({ ok: true, data: updated, telegramEdited: tgEdited });
    })
);

router.delete('/:id/messages/:msgId',
    validateParams({
        params: z.object({ id: z.string().uuid(), msgId: z.string().uuid() }),
    }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.id },
            include: { user: true },
        });
        if (!session) throw new NotFoundError('Session', req.params.id);

        const msg = await db.message.findUnique({ where: { id: req.params.msgId } });
        if (!msg || msg.sessionId !== session.id) {
            return res.status(404).json({ ok: false, error: { message: 'Message not found' } });
        }

        const tgMsgId = msg.metadata?.telegramMessageId;
        const chatId = session.user?.telegramId;

        // Try to delete from Telegram if we have the message_id
        if (tgMsgId && chatId) {
            const token = await resolveBotToken(session.botId);
            if (token) {
                await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: String(chatId), message_id: tgMsgId }),
                }).catch(() => {}); // Don't fail if TG delete fails (message too old etc.)
            }
        }

        // Delete from DB
        await db.message.delete({ where: { id: msg.id } });
        res.json({ ok: true, telegramDeleted: Boolean(tgMsgId && chatId) });
    })
);

module.exports = router;
