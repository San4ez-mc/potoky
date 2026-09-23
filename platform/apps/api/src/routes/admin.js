'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { authMiddleware, loginHandler, logoutHandler } = require('../middleware/auth');
const { runBotRegression, runProjectRegressions } = require('../services/regressionRunner');
const { startTestSession } = require('../services/testSession');
const funnelTests = require('../services/funnelTests');
const { requireSuperadmin, allowedProjectIds } = require('../middleware/rbac');

const router = Router();

// POST /api/admin/login (public)
router.post('/login', asyncHandler(loginHandler));

// POST /api/admin/logout
router.post('/logout', asyncHandler(logoutHandler));

// ── Protected admin routes ───────────────────────────────────
router.use(authMiddleware);

// GET /api/admin/analytics — platform-wide stats (лише суперадмін)
router.get('/analytics', requireSuperadmin, asyncHandler(async (req, res) => {
    const [totalUsers, totalSessions, totalApiCalls, unresolvedErrors] = await Promise.all([
        db.user.count(),
        db.session.count(),
        db.apiCall.count(),
        db.appError.count({ where: { resolved: false } }),
    ]);

    const apiCallsByService = await db.apiCall.groupBy({
        by: ['service'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
    });

    res.json({
        ok: true,
        data: {
            totalUsers,
            totalSessions,
            totalApiCalls,
            unresolvedErrors,
            apiCallsByService,
        },
    });
}));

// GET /api/admin/errors — all errors (лише суперадмін)
router.get('/errors',
    requireSuperadmin,
    validateParams({
        query: z.object({
            resolved: z.enum(['true', 'false']).optional(),
            botId: z.string().uuid().optional(),
            page: z.coerce.number().int().min(0).default(0),
            limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { resolved, botId, page, limit } = req.query;
        const where = {};
        if (resolved !== undefined) where.resolved = resolved === 'true';
        if (botId) where.botId = botId;

        const [errors, total] = await Promise.all([
            db.appError.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: page * limit,
                include: {
                    bot: { select: { name: true, slug: true } },
                    user: { select: { firstName: true, username: true } },
                },
            }),
            db.appError.count({ where }),
        ]);

        res.json({ ok: true, data: errors, meta: { total, page, limit } });
    })
);

// PATCH /api/admin/errors/:id/resolve
router.patch('/errors/:id/resolve',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const error = await db.appError.update({
            where: { id: req.params.id },
            data: { resolved: true },
        });
        res.json({ ok: true, data: error });
    })
);

// GET /api/admin/sessions/unread-count — active bot sessions with last message from user
router.get('/sessions/unread-count',
    asyncHandler(async (req, res) => {
        // Лише свіжі (останні 7 днів) сесії справжніх користувачів (telegramId != null;
        // webhook/тести без telegramId не рахуємо). Інакше старі «активні» сесії з останнім
        // повідомленням юзера копляться назавжди і лічильник завжди показує те саме число.
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        // 2026-09-13 (OOM-шторм на проді: platform-api вбивався OOM-кілером кожні ~3 хв, dmesg
        // «Killed process node … anon-rss 3–4 ГБ»; після кожного вбивства гинули дебаунс-черги
        // Zernio → клієнти без відповіді). Корінь — САМЕ цей запит: адмінка смикає його щохвилини,
        // а findMany без select вантажив у памʼять УСІ активні сесії за 7 днів РАЗОМ із context
        // (~3 000 сесій × ~90 КБ JSON, у сумі сотні МБ на один поворот + include messages), і
        // паралельні поли не встигали збиратись GC. Тепер — один SQL: лічильник рахує БД, у Node
        // приходить одне число. Фільтр telegramId зайвий (BigInt @unique), службового юзера
        // виключаємо за username, як і раніше.
        const projects = allowedProjectIds(req);
        const rows = projects
            ? await db.$queryRaw`
                SELECT COUNT(*)::int AS count FROM (
                    SELECT s.id,
                        (SELECT m.role FROM messages m WHERE m."sessionId" = s.id ORDER BY m."createdAt" DESC LIMIT 1) AS last_role
                    FROM sessions s
                    JOIN users u ON u.id = s."userId"
                    JOIN bots b ON b.id = s."botId"
                    WHERE s."isActive" = true AND s."isTest" = false AND s."lastActive" >= ${since}
                      AND u.username IS DISTINCT FROM 'webhook_system'
                      AND b."projectId" = ANY(${projects.map((p) => String(p))})
                ) t WHERE t.last_role = 'user'`
            : await db.$queryRaw`
                SELECT COUNT(*)::int AS count FROM (
                    SELECT s.id,
                        (SELECT m.role FROM messages m WHERE m."sessionId" = s.id ORDER BY m."createdAt" DESC LIMIT 1) AS last_role
                    FROM sessions s
                    JOIN users u ON u.id = s."userId"
                    WHERE s."isActive" = true AND s."isTest" = false AND s."lastActive" >= ${since}
                      AND u.username IS DISTINCT FROM 'webhook_system'
                ) t WHERE t.last_role = 'user'`;
        const count = Number((rows && rows[0] && rows[0].count) || 0);
        res.json({ ok: true, data: { count } });
    })
);

// GET /api/admin/sessions — all sessions across all bots
router.get('/sessions',
    validateParams({
        query: z.object({
            botId: z.string().uuid().optional(),
            isActive: z.enum(['true', 'false']).optional(),
            hasErrors: z.enum(['true', 'false']).optional(),
            isTest: z.enum(['true', 'false']).optional(),
            source: z.enum(['bot', 'webhook', 'instagram']).optional(),
            search: z.string().trim().min(1).max(200).optional(),
            page: z.coerce.number().int().min(0).default(0),
            limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId, isActive, hasErrors, isTest, source, search, page, limit } = req.query;
        const where = {};
        if (botId) where.botId = botId;
        if (isActive !== undefined) where.isActive = isActive === 'true';
        if (isTest !== undefined) where.isTest = isTest === 'true';
        if (hasErrors !== undefined) {
            where.errors = hasErrors === 'true' ? { some: {} } : { none: {} };
        }
        if (source === 'webhook') where.user = { username: 'webhook_system' };
        // Instagram-сесії позначені context.channel = 'instagram'.
        else if (source === 'instagram') where.context = { path: ['channel'], equals: 'instagram' };
        // TG = все, крім webhook_system і крім Instagram-каналу.
        else if (source === 'bot') {
            where.user = { NOT: { username: 'webhook_system' } };
            where.NOT = { context: { path: ['channel'], equals: 'instagram' } };
        }
        // Пошук по імені/username користувача АБО по тексту переписки.
        // Розбиваємо на слова, щоб "Олексій Сіразетдінов" знаходило юзера
        // з таким firstName+lastName, а не шукало точну фразу як одне поле.
        if (search) {
            const tokens = search.split(/\s+/).filter(Boolean);
            where.AND = [
                ...(where.AND || []),
                ...tokens.map((token) => ({
                    OR: [
                        { user: { firstName: { contains: token, mode: 'insensitive' } } },
                        { user: { lastName: { contains: token, mode: 'insensitive' } } },
                        { user: { username: { contains: token, mode: 'insensitive' } } },
                        { messages: { some: { content: { contains: token, mode: 'insensitive' } } } },
                    ],
                })),
            ];
        }
        // RBAC: 'user' — лише сесії ботів дозволених проєктів.
        const _allowedS = allowedProjectIds(req);
        if (_allowedS) where.bot = { ...(where.bot || {}), projectId: { in: _allowedS } };

        const [sessions, total] = await Promise.all([
            db.session.findMany({
                where,
                orderBy: { lastActive: 'desc' },
                take: limit,
                skip: page * limit,
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            username: true,
                            telegramId: true,
                        }
                    },
                    bot: { select: { id: true, name: true, slug: true } },
                    _count: { select: { messages: true, apiCalls: true, errors: true } },
                    messages: { orderBy: { createdAt: 'desc' }, take: 10, select: { role: true, createdAt: true } },
                },
            }),
            db.session.count({ where }),
        ]);

        res.json({ ok: true, data: sessions, meta: { total, page, limit } });
    })
);

// GET /api/admin/api-logs — stream of recent API calls (лише суперадмін)
router.get('/api-logs',
    requireSuperadmin,
    validateParams({
        query: z.object({
            service: z.string().optional(),
            botId: z.string().uuid().optional(),
            page: z.coerce.number().int().min(0).default(0),
            limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { service, page, limit } = req.query;
        const where = {};
        if (service) where.service = service;

        const [calls, total] = await Promise.all([
            db.apiCall.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: page * limit,
            }),
            db.apiCall.count({ where }),
        ]);

        res.json({ ok: true, data: calls, meta: { total, page, limit } });
    })
);

// POST /api/admin/bots/:id/run-regression — run automated regression for one bot
router.post('/bots/:id/run-regression',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const data = await runBotRegression(req.params.id);
        res.json({ ok: true, data });
    })
);

// POST /api/admin/bots/:id/webhook-test — trigger a webhook-start bot with a custom JSON body
router.post('/bots/:id/webhook-test',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.record(z.string(), z.any()).optional().default({}),
    }),
    asyncHandler(async (req, res) => {
        const bot = await db.bot.findUnique({ where: { id: req.params.id } });
        if (!bot) return res.status(404).json({ ok: false, error: { message: 'Bot not found' } });

        const result = await startTestSession({ botId: bot.id, contextOverride: req.body || {} });
        res.json({
            ok: true,
            data: {
                sessionId: result.sessionId,
                firstMessage: result.firstMessage,
                currentState: result.currentState,
            },
        });
    })
);

// POST /api/admin/projects/:slug/run-regressions — run automated regressions for all project bots
router.post('/projects/:slug/run-regressions',
    validateParams({ params: z.object({ slug: z.string().min(1) }) }),
    asyncHandler(async (req, res) => {
        const data = await runProjectRegressions(req.params.slug);
        res.json({ ok: true, data });
    })
);

// ── Funnel tests (повноцінна система тестування, apps/api/src/services/funnelTests.js) ──

const stepSchema = z.object({
    type: z.enum(['text', 'photo', 'forward_post', 'ad_reply']).optional(),
    text: z.string().optional(),
    imageUrl: z.string().optional().nullable(),
    sharedPost: z.record(z.string(), z.any()).optional().nullable(),
    referral: z.record(z.string(), z.any()).optional().nullable(),
    entryAdId: z.string().optional().nullable(),
    delayMs: z.number().optional().nullable(),
});

// GET /api/admin/bots/:id/tests — list saved tests for a bot
router.get('/bots/:id/tests',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const data = await funnelTests.listTests(req.params.id);
        res.json({ ok: true, data });
    })
);

// POST /api/admin/bots/:id/tests — create a new test
router.post('/bots/:id/tests',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            steps: z.array(stepSchema).min(1),
            expectedOutcome: z.string().min(1),
            connectorId: z.string().optional().nullable(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const data = await funnelTests.createTest({
            botId: req.params.id,
            ...req.body,
            createdBy: req.session?.login || null,
        });
        res.json({ ok: true, data });
    })
);

// POST /api/admin/bots/:id/tests/run-all — run every saved test for this bot
router.post('/bots/:id/tests/run-all',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const data = await funnelTests.runAllTests(req.params.id);
        res.json({ ok: true, data });
    })
);

// GET /api/admin/tests/:testId
router.get('/tests/:testId',
    validateParams({ params: z.object({ testId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const data = await funnelTests.getTest(req.params.testId);
        res.json({ ok: true, data });
    })
);

// PUT /api/admin/tests/:testId — update
router.put('/tests/:testId',
    validateParams({
        params: z.object({ testId: z.string().uuid() }),
        body: z.object({
            name: z.string().min(1).optional(),
            description: z.string().optional().nullable(),
            steps: z.array(stepSchema).optional(),
            expectedOutcome: z.string().min(1).optional(),
            connectorId: z.string().optional().nullable(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const data = await funnelTests.updateTest(req.params.testId, req.body);
        res.json({ ok: true, data });
    })
);

// DELETE /api/admin/tests/:testId
router.delete('/tests/:testId',
    validateParams({ params: z.object({ testId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const data = await funnelTests.deleteTest(req.params.testId);
        res.json({ ok: true, data });
    })
);

// POST /api/admin/tests/:testId/duplicate
router.post('/tests/:testId/duplicate',
    validateParams({ params: z.object({ testId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const data = await funnelTests.duplicateTest(req.params.testId);
        res.json({ ok: true, data });
    })
);

// POST /api/admin/tests/:testId/run
router.post('/tests/:testId/run',
    validateParams({ params: z.object({ testId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const data = await funnelTests.runTest(req.params.testId);
        res.json({ ok: true, data });
    })
);

// GET /api/admin/mcp-config — ready-to-copy MCP URLs for admin UI
router.get('/mcp-config',
    asyncHandler(async (_req, res) => {
        const token = process.env.MCP_SECRET || null;
        const baseUrl = process.env.PUBLIC_URL || 'https://flows.fineko.space';
        const withToken = (path) => token ? `${baseUrl}${path}?token=${token}` : `${baseUrl}${path}`;

        res.json({
            ok: true,
            data: {
                token,
                baseUrl,
                flowsUrl: withToken('/api/mcp'),
                flowsEditUrl: withToken('/api/mcp-edit'),
                debugUrl: withToken('/api/mcp-debug'),
            },
        });
    })
);

module.exports = router;
