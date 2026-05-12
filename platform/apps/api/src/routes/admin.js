'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { authMiddleware, loginHandler, logoutHandler } = require('../middleware/auth');
const { runBotRegression, runProjectRegressions } = require('../services/regressionRunner');

const router = Router();

// POST /api/admin/login (public)
router.post('/login', asyncHandler(loginHandler));

// POST /api/admin/logout
router.post('/logout', asyncHandler(logoutHandler));

// ── Protected admin routes ───────────────────────────────────
router.use(authMiddleware);

// GET /api/admin/analytics — platform-wide stats
router.get('/analytics', asyncHandler(async (req, res) => {
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

// GET /api/admin/errors — all errors with filters
router.get('/errors',
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

// GET /api/admin/sessions — all sessions across all bots
router.get('/sessions',
    validateParams({
        query: z.object({
            botId: z.string().uuid().optional(),
            isActive: z.enum(['true', 'false']).optional(),
            page: z.coerce.number().int().min(0).default(0),
            limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId, isActive, page, limit } = req.query;
        const where = {};
        if (botId) where.botId = botId;
        if (isActive !== undefined) where.isActive = isActive === 'true';

        const [sessions, total] = await Promise.all([
            db.session.findMany({
                where,
                orderBy: { startedAt: 'desc' },
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
                            telegramUsername: true,
                        } 
                    },
                    bot: { select: { id: true, name: true, slug: true } },
                    _count: { select: { messages: true, apiCalls: true } },
                },
            }),
            db.session.count({ where }),
        ]);

        res.json({ ok: true, data: sessions, meta: { total, page, limit } });
    })
);

// GET /api/admin/api-logs — stream of recent API calls
router.get('/api-logs',
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

// POST /api/admin/projects/:slug/run-regressions — run automated regressions for all project bots
router.post('/projects/:slug/run-regressions',
    validateParams({ params: z.object({ slug: z.string().min(1) }) }),
    asyncHandler(async (req, res) => {
        const data = await runProjectRegressions(req.params.slug);
        res.json({ ok: true, data });
    })
);

module.exports = router;
