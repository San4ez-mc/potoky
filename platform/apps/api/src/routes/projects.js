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
        });
        res.json({ ok: true, data: bots });
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

module.exports = router;
