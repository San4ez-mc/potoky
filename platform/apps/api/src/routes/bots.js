'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');

const router = Router();

const paginationSchema = z.object({
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    hasErrors: z.enum(['true', 'false']).optional(),
    isTest: z.enum(['true', 'false']).optional(),
});

// GET /api/bots/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const bot = await db.bot.findUnique({ where: { id: req.params.id } });
        if (!bot) throw new NotFoundError('Bot', req.params.id);
        res.json({ ok: true, data: bot });
    })
);

// PATCH /api/bots/:id — update bot name / description / goal
router.patch('/:id',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
            name: z.string().min(1).max(255).optional(),
            description: z.string().optional(),
            goal: z.string().optional(),
            projectId: z.string().uuid().nullable().optional(),
            isActive: z.boolean().optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const bot = await db.bot.findUnique({ where: { id: req.params.id } });
        if (!bot) throw new NotFoundError('Bot', req.params.id);

        // Validate projectId if provided
        if (req.body.projectId) {
            const project = await db.project.findUnique({ where: { id: req.body.projectId } });
            if (!project) return res.status(404).json({ ok: false, error: { message: 'Project not found' } });
        }

        const updated = await db.bot.update({
            where: { id: req.params.id },
            data: {
                ...(req.body.name !== undefined && { name: req.body.name }),
                ...(req.body.description !== undefined && { description: req.body.description }),
                ...(req.body.goal !== undefined && { goal: req.body.goal }),
                ...(req.body.projectId !== undefined && { projectId: req.body.projectId }),
                ...(req.body.isActive !== undefined && { isActive: req.body.isActive }),
            },
        });
        res.json({ ok: true, data: updated });
    })
);

// GET /api/bots/:id/sessions
router.get('/:id/sessions',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        query: paginationSchema,
    }),
    asyncHandler(async (req, res) => {
        const { page, limit, hasErrors, isTest } = req.query;
        const where = { botId: req.params.id };
        if (hasErrors !== undefined) {
            where.errors = hasErrors === 'true' ? { some: {} } : { none: {} };
        }
        if (isTest !== undefined) where.isTest = isTest === 'true';

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
                            telegramId: true,
                            firstName: true,
                            lastName: true,
                            username: true,
                        }
                    },
                    _count: { select: { messages: true, apiCalls: true, errors: true } },
                    messages: { orderBy: { createdAt: 'desc' }, take: 10, select: { role: true, createdAt: true } },
                },
            }),
            db.session.count({ where }),
        ]);
        res.json({ ok: true, data: sessions, meta: { total, page, limit } });
    })
);

module.exports = router;
