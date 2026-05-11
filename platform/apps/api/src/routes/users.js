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
});

// GET /api/users
router.get('/',
    validateParams({ query: paginationSchema }),
    asyncHandler(async (req, res) => {
        const { page, limit } = req.query;
        const [users, total] = await Promise.all([
            db.user.findMany({
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: page * limit,
            }),
            db.user.count(),
        ]);
        res.json({ ok: true, data: users, meta: { total, page, limit } });
    })
);

// GET /api/users/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const user = await db.user.findUnique({ where: { id: req.params.id } });
        if (!user) throw new NotFoundError('User', req.params.id);
        res.json({ ok: true, data: user });
    })
);

// GET /api/users/:id/progress
router.get('/:id/progress',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const progress = await db.userProgress.findMany({
            where: { userId: req.params.id },
            orderBy: [{ blockNumber: 'asc' }, { lessonNumber: 'asc' }],
            include: { bot: { select: { name: true, slug: true } } },
        });
        res.json({ ok: true, data: progress });
    })
);

// GET /api/users/:id/files
router.get('/:id/files',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const files = await db.file.findMany({
            where: { userId: req.params.id },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ ok: true, data: files });
    })
);

// GET /api/users/:id/sessions
router.get('/:id/sessions',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        query: paginationSchema,
    }),
    asyncHandler(async (req, res) => {
        const { page, limit } = req.query;
        const [sessions, total] = await Promise.all([
            db.session.findMany({
                where: { userId: req.params.id },
                orderBy: { startedAt: 'desc' },
                take: limit,
                skip: page * limit,
                include: { bot: { select: { name: true, slug: true } } },
            }),
            db.session.count({ where: { userId: req.params.id } }),
        ]);
        res.json({ ok: true, data: sessions, meta: { total, page, limit } });
    })
);

module.exports = router;
