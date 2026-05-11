'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { authMiddleware } = require('../middleware/auth');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');

const router = Router();
router.use(authMiddleware);

// GET /api/connectors — list all active connectors
router.get('/', asyncHandler(async (_req, res) => {
    const connectors = await db.connectorDef.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
    });
    res.json({ ok: true, data: connectors });
}));

// GET /api/connectors/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const c = await db.connectorDef.findUnique({ where: { id: req.params.id } });
        if (!c) throw new NotFoundError('Connector', req.params.id);
        res.json({ ok: true, data: c });
    })
);

module.exports = router;
