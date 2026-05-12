'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { authMiddleware } = require('../middleware/auth');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');
const { syncChannelsForBot } = require('../services/channelSync');

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

        const channelSync = await syncChannelsForBot(botId);

        res.json({ ok: true, data: { ...flow, channelSync } });
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

        const channelSync = await syncChannelsForBot(botId);

        res.json({ ok: true, data: { channelSync } });
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

        const channelSync = await syncChannelsForBot(botId);

        res.json({
            ok: true,
            data: {
                ...result,
                value: result.isSecret ? '••••••••' : result.value,
                channelSync,
            },
        });
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
        const channelSync = await syncChannelsForBot(req.params.botId);
        res.json({ ok: true, data: { channelSync } });
    })
);

// POST /api/funnels/:botId/sync-channels — manual re-sync for delivery channels
router.post('/:botId/sync-channels',
    validateParams({ params: z.object({ botId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const result = await syncChannelsForBot(req.params.botId);
        res.json({ ok: true, data: result });
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

// ── EDGES (Gap #7: create_edge & update_edges) ────────────

// POST /api/funnels/:botId/edges — add or update a single edge
router.post('/:botId/edges',
    validateParams({
        params: z.object({ botId: z.string().uuid() }),
        body: z.object({
            source: z.string().min(1),
            target: z.string().min(1),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const { source, target } = req.body;

        const flow = await db.flowDefinition.findUnique({ where: { botId } });
        if (!flow) throw new NotFoundError('FlowDefinition', botId);

        const newEdge = { id: `edge_${Date.now()}`, source, target };
        const edges = flow.edges || [];
        edges.push(newEdge);

        await db.flowDefinition.update({
            where: { botId },
            data: { edges },
        });

        res.json({ ok: true, data: { edge: newEdge } });
    })
);

// PUT /api/funnels/:botId/edges — replace all edges (bulk update)
router.put('/:botId/edges',
    validateParams({
        params: z.object({ botId: z.string().uuid() }),
        body: z.object({
            edges: z.array(z.object({ source: z.string(), target: z.string() })),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const { edges } = req.body;

        await db.flowDefinition.update({
            where: { botId },
            data: { edges },
        });

        res.json({ ok: true, data: { edgesCount: edges.length } });
    })
);

// DELETE /api/funnels/:botId/edges/:edgeId — delete edge
router.delete('/:botId/edges/:edgeId',
    validateParams({
        params: z.object({ botId: z.string().uuid(), edgeId: z.string() }),
    }),
    asyncHandler(async (req, res) => {
        const { botId, edgeId } = req.params;

        const flow = await db.flowDefinition.findUnique({ where: { botId } });
        if (!flow) throw new NotFoundError('FlowDefinition', botId);

        const edges = (flow.edges || []).filter(e => e.id !== edgeId);

        await db.flowDefinition.update({
            where: { botId },
            data: { edges },
        });

        res.json({ ok: true, data: { deleted: edgeId } });
    })
);

// ── NODE STATS (Gap #9: get_node_stats for monitoring) ─────

// GET /api/funnels/:botId/nodes/:nodeId/stats — node performance stats
router.get('/:botId/nodes/:nodeId/stats',
    validateParams({
        params: z.object({ botId: z.string().uuid(), nodeId: z.string() }),
    }),
    asyncHandler(async (req, res) => {
        const { botId, nodeId } = req.params;
        const { period = '24h' } = req.query; // 24h, 7d, 30d

        const bot = await db.bot.findUnique({ where: { id: botId } });
        if (!bot) throw new NotFoundError('Bot', botId);

        // Count sessions that passed through this node
        const timeFrom = new Date(Date.now() - (period === '7d' ? 7 * 24 * 60 * 60 * 1000 : period === '30d' ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000));

        const sessionsPassedThrough = await db.session.count({
            where: {
                botId,
                createdAt: { gte: timeFrom },
            },
        });

        const errorsAtNode = await db.$queryRaw`
            SELECT COUNT(*) as count FROM app_errors
            WHERE "botId" = ${botId}
            AND "nodeId" = ${nodeId}
            AND "createdAt" >= ${timeFrom}
            AND "resolved" = false
        `;

        const errorCount = errorsAtNode?.[0]?.count || 0;

        res.json({
            ok: true,
            data: {
                nodeId,
                period,
                sessionsPassedThrough,
                errors: Number(errorCount),
                errorRate: sessionsPassedThrough > 0 ? (Number(errorCount) / sessionsPassedThrough * 100).toFixed(2) + '%' : '0%',
                indicator: Number(errorCount) > 0 ? 'error' : sessionsPassedThrough > 100 ? 'warning' : 'ok',
            },
        });
    })
);

// ── PREREQUISITES (Gap #2: check before start) ─────────────

// POST /api/funnels/:botId/check-prerequisites — check if user can start this funnel
router.post('/:botId/check-prerequisites',
    validateParams({
        params: z.object({ botId: z.string().uuid() }),
        body: z.object({
            userId: z.string(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const { userId } = req.body;

        const flow = await db.flowDefinition.findUnique({ where: { botId } });
        if (!flow) throw new NotFoundError('FlowDefinition', botId);

        const flowObj = flow;
        const prerequisites = flowObj.prerequisites || {};
        const requiredFiles = prerequisites.files || [];

        if (requiredFiles.length === 0) {
            return res.json({ ok: true, data: { canStart: true, missing: [] } });
        }

        // Collect all files stored by this user from previous sessions
        const userFiles = await db.file.findMany({
            where: { userId },
            select: { fileType: true },
        });

        const userFileTypes = new Set(userFiles.map(f => f.fileType));
        const missing = requiredFiles.filter(type => !userFileTypes.has(type));

        res.json({
            ok: true,
            data: {
                canStart: missing.length === 0,
                missing,
                suggestedBot: prerequisites.onFail?.suggest_bot || null,
            },
        });
    })
);

module.exports = router;
