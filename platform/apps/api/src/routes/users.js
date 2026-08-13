'use strict';

const { Router } = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');

const router = Router();

const { guardUserParam, projectScopeWhere } = require('../middleware/rbac');
router.param('id', guardUserParam);

const paginationSchema = z.object({
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().optional(),
    // realOnly=true (default) — only users with at least one real (non-test) session
    realOnly: z.preprocess(v => v === 'false' ? false : true, z.boolean()).default(true),
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
        const { page, limit, search, realOnly } = req.query;

        const where = {
            // RBAC: 'user' бачить лише підписників дозволених проєктів.
            ...projectScopeWhere(req),
            // Hide test-runner accounts: real only = must have at least 1 non-test session
            ...(realOnly ? {
                sessions: { some: { isTest: false } },
            } : {}),
            // Hide system/webhook/test accounts by username pattern
            ...(realOnly ? {
                NOT: {
                    OR: [
                        { username: { startsWith: 'test_' } },
                        { username: { contains: 'webhook' } },
                    ],
                },
            } : {}),
            ...(search ? {
                AND: [{
                    OR: [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { username: { contains: search, mode: 'insensitive' } },
                    ],
                }],
            } : {}),
        };

        const [users, total] = await Promise.all([
            db.user.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: page * limit,
                include: {
                    project: { select: { id: true, name: true } },
                    _count: { select: { sessions: { where: realOnly ? { isTest: false } : {} } } },
                },
            }),
            db.user.count({ where }),
        ]);
        res.json({ ok: true, data: users.map(normalizeUser), meta: { total, page, limit, realOnly } });
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

// GET /api/users/:id/photo — proxy Telegram profile photo
router.get('/:id/photo',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const user = await db.user.findUnique({ where: { id: req.params.id }, select: { metadata: true } });
        if (!user?.metadata?.photoFilePath) return res.status(404).end();

        const filePath = user.metadata.photoFilePath;

        // Find any bot this user has a session with to get its token
        const session = await db.session.findFirst({
            where: { user: { id: req.params.id } },
            select: { botId: true },
        });
        if (!session) return res.status(404).end();

        // Get bot token (check TELEGRAM_CONNECTOR_ID first, then TELEGRAM_BOT_TOKEN)
        const keys = await db.funnelKey.findMany({
            where: { botId: session.botId, key: { in: ['TELEGRAM_CONNECTOR_ID', 'TELEGRAM_BOT_TOKEN'] } },
            select: { key: true, value: true },
        });
        const km = Object.fromEntries(keys.map(k => [k.key, k.value]));
        let token = null;
        if (km.TELEGRAM_CONNECTOR_ID) {
            const sc = await db.savedConnector.findUnique({ where: { id: km.TELEGRAM_CONNECTOR_ID }, select: { config: true } });
            token = sc?.config?.token || null;
        }
        if (!token) token = km.TELEGRAM_BOT_TOKEN || null;
        if (!token) return res.status(404).end();

        const photoUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
        try {
            const tgRes = await fetch(photoUrl);
            if (!tgRes.ok) return res.status(404).end();
            res.setHeader('Content-Type', tgRes.headers.get('content-type') || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            const buf = await tgRes.arrayBuffer();
            res.send(Buffer.from(buf));
        } catch {
            res.status(404).end();
        }
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
