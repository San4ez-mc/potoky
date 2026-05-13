'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');
const { sendMessage } = require('@platform/telegram');
const {
    startTestSession,
    sendTestMessage,
    getTestSessionState,
    endTestSession,
} = require('../services/testSession');

const router = Router();

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
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId, botSlug, userId } = req.body;
        if (!botId && !botSlug) {
            return res.status(400).json({ ok: false, error: 'Provide botId or botSlug' });
        }

        const data = await startTestSession({ botId, botSlug, userId });
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

// POST /api/sessions/:id/send — manual message from admin
router.post('/:id/send',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ text: z.string().min(1).max(4096) }),
    }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.id },
            include: { user: true },
        });
        if (!session) throw new NotFoundError('Session', req.params.id);

        const { text } = req.body;

        await sendMessage(Number(session.user.telegramId), text, {}, session.id);

        await db.message.create({
            data: {
                sessionId: session.id,
                role: 'assistant',
                content: text,
                metadata: { source: 'admin_manual' },
            },
        });

        res.json({ ok: true });
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

module.exports = router;
