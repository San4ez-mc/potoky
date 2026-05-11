'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');
const { sendMessage } = require('@platform/telegram');

const router = Router();

// GET /api/sessions/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.id },
            include: {
                user: true,
                bot: true,
            },
        });
        if (!session) throw new NotFoundError('Session', req.params.id);
        res.json({ ok: true, data: session });
    })
);

// GET /api/sessions/:id/messages
router.get('/:id/messages',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const messages = await db.message.findMany({
            where: { sessionId: req.params.id },
            orderBy: { createdAt: 'asc' },
        });
        res.json({ ok: true, data: messages });
    })
);

// GET /api/sessions/:id/api-calls
router.get('/:id/api-calls',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const apiCalls = await db.apiCall.findMany({
            where: { sessionId: req.params.id },
            orderBy: { createdAt: 'asc' },
        });
        res.json({ ok: true, data: apiCalls });
    })
);

// POST /api/sessions/:id/send — manual message from admin
router.post('/:id/send',
    validateParams({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ text: z.string().min(1).max(4096) }),
    }),
    asyncHandler(async (req, res) => {
        const session = await db.session.findUnique({
            where: { id: req.params.id },
            include: { user: true },
        });
        if (!session) throw new NotFoundError('Session', req.params.id);

        const { text } = req.body;

        await sendMessage(Number(session.user.telegramId), text, {}, session.id);

        await db.message.create({
            data: {
                sessionId: session.id,
                role: 'assistant',
                content: text,
                metadata: { source: 'admin_manual' },
            },
        });

        res.json({ ok: true });
    })
);

module.exports = router;
