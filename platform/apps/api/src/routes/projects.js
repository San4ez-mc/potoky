'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');
const { allowedProjectIds, isProjectAllowed } = require('../middleware/rbac');

const router = Router();

// Гард обʼєктного доступу: 404 (не 403 — щоб не розкривати існування) на чужий проєкт.
function guardProject(req, res, next) {
    if (!isProjectAllowed(req, req.params.id)) throw new NotFoundError('Project', req.params.id);
    next();
}
// Покриваємо ВСІ роути з :id (включно з global-keys, delete тощо), не лише перелічені.
router.param('id', guardProject);

// GET /api/projects — для 'user' лише дозволені проєкти.
router.get('/', asyncHandler(async (req, res) => {
    const allowed = allowedProjectIds(req);
    const projects = await db.project.findMany({
        where: { isActive: true, ...(allowed ? { id: { in: allowed } } : {}) },
        orderBy: { createdAt: 'asc' },
    });
    res.json({ ok: true, data: projects });
}));

// GET /api/projects/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    guardProject,
    asyncHandler(async (req, res) => {
        const project = await db.project.findUnique({ where: { id: req.params.id } });
        if (!project) throw new NotFoundError('Project', req.params.id);
        res.json({ ok: true, data: project });
    })
);

// GET /api/projects/:id/bots
router.get('/:id/bots',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    guardProject,
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
                const [activeSessions, unresolvedErrors, distinctUsers, channelKeys] = await Promise.all([
                    db.session.count({ where: { botId: bot.id, isActive: true, isTest: false } }),
                    db.appError.count({ where: { botId: bot.id, resolved: false } }),
                    db.session.findMany({
                        where: { botId: bot.id, isTest: false },
                        distinct: ['userId'],
                        select: { userId: true },
                    }),
                    db.funnelKey.findMany({
                        where: {
                            botId: bot.id,
                            key: { in: ['TELEGRAM_CONNECTOR_ID', 'TELEGRAM_BOT_TOKEN', 'INSTAGRAM_ACCESS_TOKEN', 'FUNNEL_CHANNELS'] },
                        },
                        select: { key: true, value: true },
                    }),
                ]);

                // Build channels array
                const km = Object.fromEntries(channelKeys.map(k => [k.key, k.value]));
                const channels = [];
                if (km.FUNNEL_CHANNELS) {
                    try {
                        JSON.parse(km.FUNNEL_CHANNELS).forEach(c => { if (!channels.includes(c)) channels.push(c); });
                    } catch { /* ignore parse errors */ }
                } else {
                    if (km.TELEGRAM_CONNECTOR_ID || km.TELEGRAM_BOT_TOKEN) channels.push('telegram');
                    if (km.INSTAGRAM_ACCESS_TOKEN) channels.push('instagram');
                }

                // Resolve connector label
                let botLabel = null;
                if (km.TELEGRAM_CONNECTOR_ID) {
                    try {
                        const sc = await db.savedConnector.findUnique({
                            where: { id: km.TELEGRAM_CONNECTOR_ID },
                            select: { name: true },
                        });
                        botLabel = sc?.name || null;
                    } catch { /* ignore */ }
                }

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
                    channels,
                    botLabel,
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

// POST /api/projects/:id/bots — create a new funnel/bot in the project
router.post('/:id/bots',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
            name: z.string().min(1).max(255),
            slug: z.string().min(1).max(100),
            description: z.string().max(1000).optional(),
            trigger: z.string().max(255).optional(),
            isSystem: z.boolean().optional(), // marks a system/default bot (hidden in UI, non-deletable)
        }),
    }),
    guardProject,
    asyncHandler(async (req, res) => {
        const { id: projectId } = req.params;
        const { name, slug, description, trigger, isSystem } = req.body;

        const project = await db.project.findUnique({ where: { id: projectId } });
        if (!project) throw new NotFoundError('Project', projectId);

        const existingBot = await db.bot.findFirst({
            where: { projectId, slug },
        });
        if (existingBot) {
            return res.status(409).json({ ok: false, error: { message: 'Воронка з таким slug вже існує в проєкті' } });
        }

        const settings = {};
        if (isSystem) settings.isSystem = true;

        const bot = await db.bot.create({
            data: {
                projectId,
                name,
                slug,
                description: description || null,
                trigger: trigger || null,
                isActive: true,
                settings,
            },
        });

        res.status(201).json({ ok: true, data: bot });
    })
);

// GET /api/projects/:id/stats
router.get('/:id/stats',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    guardProject,
    asyncHandler(async (req, res) => {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [uniqueUserRows, activeUserRows, errors] = await Promise.all([
            // Unique real users (exclude test sessions)
            db.session.findMany({
                where: { bot: { projectId: req.params.id }, isTest: false },
                distinct: ['userId'],
                select: { userId: true },
            }),
            // Unique real users active in last 7 days
            db.session.findMany({
                where: {
                    bot: { projectId: req.params.id },
                    isTest: false,
                    lastActive: { gte: sevenDaysAgo },
                },
                distinct: ['userId'],
                select: { userId: true },
            }),
            db.appError.count({
                where: {
                    bot: { projectId: req.params.id },
                    resolved: false,
                    createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                },
            }),
        ]);

        res.json({ ok: true, data: {
            totalUsers: uniqueUserRows.length,
            activeUsers: activeUserRows.length,
            errorsLast24h: errors,
        } });
    })
);

// DELETE /api/projects/:id/bots/:botId — remove a funnel from project (unassign, keep bot intact)
router.delete('/:id/bots/:botId',
    validateParams({ params: z.object({ id: z.string().uuid(), botId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const bot = await db.bot.findFirst({
            where: { id: req.params.botId, projectId: req.params.id },
        });
        if (!bot) throw new NotFoundError('Bot', req.params.botId);

        // System bots are protected — they handle default /start routing and cannot be removed
        if (bot.settings?.isSystem === true) {
            return res.status(403).json({
                ok: false,
                error: { message: 'Системну воронку не можна видалити. Це захищений компонент бота.' },
            });
        }

        await db.bot.update({
            where: { id: req.params.botId },
            data: { projectId: null },
        });

        res.json({ ok: true });
    })
);

// GET /api/projects/bots/all — get all active bots (for moving between projects)
router.get('/bots/all', asyncHandler(async (req, res) => {
    const allowed = allowedProjectIds(req);
    const bots = await db.bot.findMany({
        where: { isActive: true, ...(allowed ? { projectId: { in: allowed } } : {}) },
        orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, slug: true, projectId: true },
    });
    res.json({ ok: true, data: bots });
}));

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
