'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');

const router = Router();

const { guardBotParam, requireCanEdit } = require('../middleware/rbac');
router.param('id', guardBotParam);

const paginationSchema = z.object({
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    hasErrors: z.enum(['true', 'false']).optional(),
    isTest: z.enum(['true', 'false']).optional(),
    source: z.enum(['bot', 'webhook', 'instagram']).optional(),
    search: z.string().trim().min(1).max(200).optional(),
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
    requireCanEdit,
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
            name: z.string().min(1).max(255).optional(),
            description: z.string().optional(),
            goal: z.string().optional(),
            projectId: z.string().uuid().nullable().optional(),
            isActive: z.boolean().optional(),
            settings: z.object({
                testMode: z.boolean().optional(),
                testModeAllowedUsers: z.array(z.string()).optional(),
            }).partial().optional(),
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
                // settings — часткове злиття (не перезаписує інші ключі типу isSystem/anchorBotId).
                ...(req.body.settings !== undefined && { settings: { ...(bot.settings || {}), ...req.body.settings } }),
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
        const { page, limit, hasErrors, isTest, source, search } = req.query;
        const where = { botId: req.params.id };
        if (hasErrors !== undefined) {
            where.errors = hasErrors === 'true' ? { some: {} } : { none: {} };
        }
        if (isTest !== undefined) where.isTest = isTest === 'true';
        if (source === 'webhook') where.user = { username: 'webhook_system' };
        else if (source === 'instagram') where.context = { path: ['channel'], equals: 'instagram' };
        else if (source === 'bot') {
            where.user = { NOT: { username: 'webhook_system' } };
            where.NOT = { context: { path: ['channel'], equals: 'instagram' } };
        }
        // Пошук по імені/username користувача АБО по тексту переписки (по словах, AND між словами).
        // Аудит 2026-09-04 (скрін власника: "олексій сір" знаходив kristina/Андрій/…): раніше
        // кожне слово шукалось окремо по будь-якому полю АБО по тексту ВСІХ повідомлень —
        // "олексій" збігався з реквізитами ФОП у відповідях бота, "сір" — із "сірий" колір,
        // тож майже всі сесії проходили. Тепер: усі слова мають збігтись у ОДНІЙ групі —
        // або в даних клієнта (імʼя/username/igUsername/senderName із context), або лише в
        // повідомленнях самого клієнта (role user), не бота.
        if (search) {
            const tokens = search.split(/\s+/).filter(Boolean);
            const userGroup = { AND: tokens.map((token) => ({
                OR: [
                    { user: { firstName: { contains: token, mode: 'insensitive' } } },
                    { user: { lastName: { contains: token, mode: 'insensitive' } } },
                    { user: { username: { contains: token, mode: 'insensitive' } } },
                    { context: { path: ['igUsername'], string_contains: token } },
                    { context: { path: ['senderName'], string_contains: token } },
                    { context: { path: ['igUsername'], string_contains: token.toLowerCase() } },
                ],
            })) };
            const messagesGroup = { AND: tokens.map((token) => ({
                messages: { some: { role: 'user', content: { contains: token, mode: 'insensitive' } } },
            })) };
            where.AND = [...(where.AND || []), { OR: [userGroup, messagesGroup] }];
        }

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
