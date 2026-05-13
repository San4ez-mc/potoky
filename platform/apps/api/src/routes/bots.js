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

// GET /api/bots/:id/sessions
router.get('/:id/sessions',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        query: paginationSchema,
    }),
    asyncHandler(async (req, res) => {
        const { page, limit, hasErrors } = req.query;
        const where = { botId: req.params.id };
        if (hasErrors !== undefined) {
            where.errors = hasErrors === 'true' ? { some: {} } : { none: {} };
        }

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
                            telegramId: true, 
                            firstName: true, 
                            lastName: true,
                            username: true,
                        } 
                    },
                    _count: { select: { messages: true, apiCalls: true, errors: true } },
                },
            }),
            db.session.count({ where }),
        ]);
        res.json({ ok: true, data: sessions, meta: { total, page, limit } });
    })
);

module.exports = router;
