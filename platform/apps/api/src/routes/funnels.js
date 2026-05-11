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

// GET /api/funnels/:botId — get flow definition + keys
router.get('/:botId',
    validateParams({ params: z.object({ botId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const bot = await db.bot.findUnique({ where: { id: req.params.botId } });
        if (!bot) throw new NotFoundError('Bot', req.params.botId);

        const [flow, keys] = await Promise.all([
            db.flowDefinition.findUnique({ where: { botId: req.params.botId } }),
            db.funnelKey.findMany({ where: { botId: req.params.botId }, orderBy: { key: 'asc' } }),
        ]);

        res.json({
            ok: true,
            data: {
                bot,
                flow: flow || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
                keys: keys.map(k => ({
                    ...k,
                    value: k.isSecret ? '••••••••' : k.value,
                })),
            },
        });
    })
);

// PUT /api/funnels/:botId — save flow definition (nodes + edges)
router.put('/:botId',
    validateParams({
        params: z.object({ botId: z.string().uuid() }),
        body: z.object({
            nodes: z.array(z.any()),
            edges: z.array(z.any()),
            viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const { nodes, edges, viewport } = req.body;

        const flow = await db.flowDefinition.upsert({
            where: { botId },
            create: { botId, nodes, edges, viewport: viewport || { x: 0, y: 0, zoom: 1 } },
            update: { nodes, edges, ...(viewport ? { viewport } : {}) },
        });

        res.json({ ok: true, data: flow });
    })
);

// GET /api/funnels/:botId/export — export full funnel as JSON
router.get('/:botId/export',
    validateParams({ params: z.object({ botId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const bot = await db.bot.findUnique({ where: { id: req.params.botId } });
        if (!bot) throw new NotFoundError('Bot', req.params.botId);

        const [flow, keys] = await Promise.all([
            db.flowDefinition.findUnique({ where: { botId: req.params.botId } }),
            db.funnelKey.findMany({ where: { botId: req.params.botId } }),
        ]);

        const exportData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            bot: { name: bot.name, slug: bot.slug, description: bot.description },
            flow: flow || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
            keys: keys.map(k => ({ key: k.key, label: k.label, isSecret: k.isSecret, value: k.isSecret ? '' : k.value })),
        };

        res.setHeader('Content-Disposition', `attachment; filename="${bot.slug}-funnel.json"`);
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(exportData, null, 2));
    })
);

// POST /api/funnels/:botId/import — import funnel from JSON
router.post('/:botId/import',
    validateParams({
        params: z.object({ botId: z.string().uuid() }),
        body: z.object({
            flow: z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const { flow } = req.body;

        await db.flowDefinition.upsert({
            where: { botId },
            create: { botId, nodes: flow.nodes, edges: flow.edges },
            update: { nodes: flow.nodes, edges: flow.edges },
        });

        res.json({ ok: true });
    })
);

// ── Funnel Keys ──────────────────────────────────────────────

// GET /api/funnels/:botId/keys
router.get('/:botId/keys',
    validateParams({ params: z.object({ botId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const keys = await db.funnelKey.findMany({
            where: { botId: req.params.botId },
            orderBy: { key: 'asc' },
        });
        res.json({
            ok: true,
            data: keys.map(k => ({ ...k, value: k.isSecret ? '••••••••' : k.value })),
        });
    })
);

// PUT /api/funnels/:botId/keys — upsert a key
router.put('/:botId/keys',
    validateParams({
        params: z.object({ botId: z.string().uuid() }),
        body: z.object({
            key: z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/),
            value: z.string(),
            label: z.string().optional(),
            isSecret: z.boolean().optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const { key, value, label, isSecret } = req.body;

        const result = await db.funnelKey.upsert({
            where: { botId_key: { botId, key } },
            create: { botId, key, value, label, isSecret: isSecret ?? false },
            update: { value, label, isSecret: isSecret ?? false },
        });

        res.json({ ok: true, data: { ...result, value: result.isSecret ? '••••••••' : result.value } });
    })
);

// DELETE /api/funnels/:botId/keys/:key
router.delete('/:botId/keys/:key',
    validateParams({
        params: z.object({ botId: z.string().uuid(), key: z.string() }),
    }),
    asyncHandler(async (req, res) => {
        await db.funnelKey.deleteMany({
            where: { botId: req.params.botId, key: req.params.key },
        });
        res.json({ ok: true });
    })
);

// GET /api/funnels/:botId/keys/:key/reveal — reveal secret value (admin only)
router.get('/:botId/keys/:key/reveal',
    validateParams({ params: z.object({ botId: z.string().uuid(), key: z.string() }) }),
    asyncHandler(async (req, res) => {
        const k = await db.funnelKey.findUnique({
            where: { botId_key: { botId: req.params.botId, key: req.params.key } },
        });
        if (!k) throw new NotFoundError('FunnelKey', req.params.key);
        res.json({ ok: true, data: { value: k.value } });
    })
);

module.exports = router;
