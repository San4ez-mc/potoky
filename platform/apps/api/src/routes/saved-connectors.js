'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');

const router = Router();

const savedConnectorSchema = z.object({
    name: z.string().min(1).max(100),
    type: z.enum(['telegram', 'openai', 'anthropic', 'google', 'custom']),
    description: z.string().optional(),
    config: z.record(z.string(), z.any()).default({}),
});

// GET /api/saved-connectors — list all
router.get('/', asyncHandler(async (_req, res) => {
    const items = await db.savedConnector.findMany({
        where: { isActive: true },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    res.json({ ok: true, data: items });
}));

// GET /api/saved-connectors/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const item = await db.savedConnector.findUnique({ where: { id: req.params.id } });
        if (!item) throw new NotFoundError('SavedConnector', req.params.id);
        res.json({ ok: true, data: item });
    })
);

// POST /api/saved-connectors — create
router.post('/', asyncHandler(async (req, res) => {
    const parsed = savedConnectorSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    const item = await db.savedConnector.create({ data: parsed.data });
    res.status(201).json({ ok: true, data: item });
}));

// PUT /api/saved-connectors/:id — update
router.put('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const item = await db.savedConnector.findUnique({ where: { id: req.params.id } });
        if (!item) throw new NotFoundError('SavedConnector', req.params.id);
        const parsed = savedConnectorSchema.partial().safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ ok: false, error: parsed.error.flatten() });
        }
        const updated = await db.savedConnector.update({
            where: { id: req.params.id },
            data: parsed.data,
        });
        res.json({ ok: true, data: updated });
    })
);

// DELETE /api/saved-connectors/:id — soft delete
router.delete('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const item = await db.savedConnector.findUnique({ where: { id: req.params.id } });
        if (!item) throw new NotFoundError('SavedConnector', req.params.id);
        await db.savedConnector.update({
            where: { id: req.params.id },
            data: { isActive: false },
        });
        res.json({ ok: true });
    })
);

module.exports = router;
