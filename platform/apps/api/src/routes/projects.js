'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');

const router = Router();

// GET /api/projects
router.get('/', asyncHandler(async (req, res) => {
    const projects = await db.project.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
    });
    res.json({ ok: true, data: projects });
}));

// GET /api/projects/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const project = await db.project.findUnique({ where: { id: req.params.id } });
        if (!project) throw new NotFoundError('Project', req.params.id);
        res.json({ ok: true, data: project });
    })
);

// GET /api/projects/:id/bots
router.get('/:id/bots',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const bots = await db.bot.findMany({
            where: { projectId: req.params.id, isActive: true },
            orderBy: { createdAt: 'asc' },
            include: {
                flowDefinition: { select: { updatedAt: true } },
                _count: { select: { sessions: true } },
            },
        });

        const botsWithMetrics = await Promise.all(
            bots.map(async (bot) => {
                const [activeSessions, unresolvedErrors, distinctUsers] = await Promise.all([
                    db.session.count({ where: { botId: bot.id, isActive: true } }),
                    db.appError.count({ where: { botId: bot.id, resolved: false } }),
                    db.session.findMany({
                        where: { botId: bot.id },
                        distinct: ['userId'],
                        select: { userId: true },
                    }),
                ]);

                return {
                    id: bot.id,
                    projectId: bot.projectId,
                    name: bot.name,
                    slug: bot.slug,
                    description: bot.description,
                    trigger: bot.trigger,
                    isActive: bot.isActive,
                    settings: bot.settings,
                    createdAt: bot.createdAt,
                    metrics: {
                        totalSessions: bot._count.sessions,
                        activeSessions,
                        usersCount: distinctUsers.length,
                        unresolvedErrors,
                        flowUpdatedAt: bot.flowDefinition?.updatedAt || null,
                    },
                };
            })
        );

        res.json({ ok: true, data: botsWithMetrics });
    })
);

// GET /api/projects/:id/stats
router.get('/:id/stats',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const [totalUsers, activeUsers, errors] = await Promise.all([
            db.user.count({ where: { projectId: req.params.id } }),
            db.session.count({
                where: {
                    bot: { projectId: req.params.id },
                    lastActive: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                },
            }),
            db.appError.count({
                where: {
                    bot: { projectId: req.params.id },
                    resolved: false,
                    createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                },
            }),
        ]);

        res.json({ ok: true, data: { totalUsers, activeUsers, errorsLast24h: errors } });
    })
);

// ── Global Keys ──────────────────────────────────────────────

// GET /api/projects/:id/global-keys
router.get('/:id/global-keys',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const project = await db.project.findUnique({ where: { id: req.params.id } });
        if (!project) throw new NotFoundError('Project', req.params.id);

        const keys = await db.globalKey.findMany({
            where: { projectId: req.params.id },
            orderBy: { createdAt: 'asc' },
        });

        res.json({
            ok: true,
            data: keys.map(k => ({
                ...k,
                value: k.isSecret ? '••••••••' : k.value,
            })),
        });
    })
);

// PUT /api/projects/:id/global-keys/:key
router.put('/:id/global-keys/:key',
    validateParams({
        params: z.object({ id: z.string().uuid(), key: z.string().min(1) }),
        body: z.object({
            label: z.string().min(1),
            value: z.string().min(1),
            isSecret: z.boolean().optional(),
            description: z.string().optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { id: projectId, key } = req.params;
        const { label, value, isSecret, description } = req.body;

        const project = await db.project.findUnique({ where: { id: projectId } });
        if (!project) throw new NotFoundError('Project', projectId);

        const globalKey = await db.globalKey.upsert({
            where: { projectId_key: { projectId, key } },
            create: { projectId, key, label, value, isSecret: isSecret ?? false, description },
            update: { label, value, isSecret: isSecret ?? false, description, updatedAt: new Date() },
        });

        res.json({
            ok: true,
            data: { ...globalKey, value: globalKey.isSecret ? '••••••••' : globalKey.value },
        });
    })
);

// DELETE /api/projects/:id/global-keys/:key
router.delete('/:id/global-keys/:key',
    validateParams({
        params: z.object({ id: z.string().uuid(), key: z.string().min(1) }),
    }),
    asyncHandler(async (req, res) => {
        const { id: projectId, key } = req.params;

        const project = await db.project.findUnique({ where: { id: projectId } });
        if (!project) throw new NotFoundError('Project', projectId);

        const globalKey = await db.globalKey.findUnique({
            where: { projectId_key: { projectId, key } },
        });

        if (!globalKey) throw new NotFoundError('GlobalKey', key);

        await db.globalKey.delete({ where: { id: globalKey.id } });

        res.json({ ok: true });
    })
);

// GET /api/projects/:id/global-keys/:key/reveal
router.get('/:id/global-keys/:key/reveal',
    validateParams({
        params: z.object({ id: z.string().uuid(), key: z.string().min(1) }),
    }),
    asyncHandler(async (req, res) => {
        const { id: projectId, key } = req.params;

        const project = await db.project.findUnique({ where: { id: projectId } });
        if (!project) throw new NotFoundError('Project', projectId);

        const globalKey = await db.globalKey.findUnique({
            where: { projectId_key: { projectId, key } },
        });

        if (!globalKey) throw new NotFoundError('GlobalKey', key);

        res.json({ ok: true, data: { key, value: globalKey.value } });
    })
);

// ── CRUD Operations ──────────────────────────────────────────

// POST /api/projects — create new project
router.post('/',
    validateParams({
        body: z.object({
            name: z.string().min(1).max(255),
            slug: z.string().min(1).max(100),
            description: z.string().max(1000).optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { name, slug, description } = req.body;

        const existing = await db.project.findUnique({ where: { slug } });
        if (existing) throw new Error('Проект з таким slug уже існує');

        const project = await db.project.create({
            data: { name, slug, description: description || null },
        });

        res.json({ ok: true, data: project });
    })
);

// PUT /api/projects/:id — update project
router.put('/:id',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
            name: z.string().min(1).max(255).optional(),
            description: z.string().max(1000).optional(),
            isActive: z.boolean().optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const project = await db.project.findUnique({ where: { id: req.params.id } });
        if (!project) throw new NotFoundError('Project', req.params.id);

        const updated = await db.project.update({
            where: { id: req.params.id },
            data: req.body,
        });

        res.json({ ok: true, data: updated });
    })
);

// DELETE /api/projects/:id — soft delete project (mark as inactive)
router.delete('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const project = await db.project.findUnique({ where: { id: req.params.id } });
        if (!project) throw new NotFoundError('Project', req.params.id);

        const updated = await db.project.update({
            where: { id: req.params.id },
            data: { isActive: false },
        });

        res.json({ ok: true, data: updated });
    })
);

module.exports = router;
