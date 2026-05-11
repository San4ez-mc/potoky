'use strict';

const { Router } = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');

const router = Router();

const paginationSchema = z.object({
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

function normalizeUser(user) {
    return {
        ...user,
        telegramId: user.telegramId != null ? user.telegramId.toString() : null,
    };
}

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
        res.json({ ok: true, data: users.map(normalizeUser), meta: { total, page, limit } });
    })
);

// GET /api/users/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const user = await db.user.findUnique({ where: { id: req.params.id } });
        if (!user) throw new NotFoundError('User', req.params.id);
        res.json({ ok: true, data: normalizeUser(user) });
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

// POST /api/users/:id/mcp-token  — generate (or regenerate) MCP token for user
router.post('/:id/mcp-token',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const user = await db.user.findUnique({ where: { id: req.params.id } });
        if (!user) throw new NotFoundError('User', req.params.id);

        const token = crypto.randomBytes(32).toString('hex');
        const updated = await db.user.update({
            where: { id: req.params.id },
            data: { mcpToken: token },
        });
        const host = process.env.PUBLIC_URL || 'https://flows.fineko.space';
        res.json({ ok: true, data: { mcpToken: updated.mcpToken, mcpUrl: `${host}/mcp?token=${updated.mcpToken}` } });
    })
);

// GET /api/users/:id/mcp-token  — get existing MCP token (or generate if missing)
router.get('/:id/mcp-token',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        let user = await db.user.findUnique({ where: { id: req.params.id } });
        if (!user) throw new NotFoundError('User', req.params.id);

        if (!user.mcpToken) {
            const token = crypto.randomBytes(32).toString('hex');
            user = await db.user.update({ where: { id: req.params.id }, data: { mcpToken: token } });
        }
        const host = process.env.PUBLIC_URL || 'https://flows.fineko.space';
        res.json({ ok: true, data: { mcpToken: user.mcpToken, mcpUrl: `${host}/mcp?token=${user.mcpToken}` } });
    })
);

module.exports = router;
