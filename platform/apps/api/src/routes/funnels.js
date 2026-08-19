'use strict';

const { Router } = require('express');
const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { authMiddleware } = require('../middleware/auth');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');
const { syncChannelsForBot, resolveTelegramUsername } = require('../services/channelSync');

const UPLOADS_DIR = process.env.BOT_FILES_DIR
    || path.join(__dirname, '..', '..', '..', '..', 'uploads', 'bot-files');

const router = Router();

const { guardBotParam, allowedProjectIds } = require('../middleware/rbac');
router.param('botId', guardBotParam);
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
                keySource: {
                    scope: 'bot',
                    table: 'funnel_keys',
                    botId: req.params.botId,
                    inheritedFromProject: false,
                },
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

// POST /api/funnels/:botId/homework-done — signal that a user completed homework for a lesson
// Called by practice (Michael) bots to advance the user's session in the course bot.
// Body: { telegramId: string|number, lessonSlug: string }
router.post('/:botId/homework-done',
    validateParams({
        params: z.object({ botId: z.string().uuid() }),
        body: z.object({
            telegramId: z.union([z.string(), z.number()]),
            lessonSlug: z.string().min(1),
        }),
    }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const { telegramId, lessonSlug } = req.body;

        const telegramIdBig = BigInt(telegramId);
        const user = await db.user.findUnique({ where: { telegramId: telegramIdBig }, select: { id: true } });
        if (!user) {
            return res.status(404).json({ ok: false, error: { message: 'User not found' } });
        }

        // Find the user's active session on this (course) bot
        const session = await db.session.findFirst({
            where: { userId: user.id, botId, state: { not: 'completed' } },
            orderBy: { startedAt: 'desc' },
        });
        if (!session) {
            return res.status(404).json({ ok: false, error: { message: 'No active session for this user' } });
        }

        // Set the homework event key at root session.context level
        // (executeFlowStep reads ctx = session.context, so ctx[eventKey] works directly)
        const eventKey = `homework_done_${lessonSlug}`;
        const updatedCtx = { ...(session.context || {}), [eventKey]: true };

        await db.session.update({
            where: { id: session.id },
            data: { context: updatedCtx },
        });

        // Import here to avoid circular dep at module load
        const { executeFlowStep } = require('../services/testSession');
        const { deliverSessionMessages, getBotToken } = require('../services/platformBotHandler');

        // Capture timestamp before execution — only deliver messages created after this point
        const sinceTime = new Date();

        await executeFlowStep({ sessionId: session.id, incomingUserMessage: null });

        // Deliver new messages via Telegram if user has a telegramId
        const userWithTg = await db.user.findUnique({ where: { id: user.id }, select: { telegramId: true } });
        if (userWithTg?.telegramId) {
            const chatId = Number(userWithTg.telegramId);
            await deliverSessionMessages(botId, session.id, chatId, sinceTime);
        }

        res.json({ ok: true, data: { sessionId: session.id, eventKey, triggered: true } });
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

// POST /api/funnels/:botId/refresh-telegram-username — підтягнути @username бота (getMe, БЕЗ setWebhook).
// Опційно body.connectorId → спершу проставляє TELEGRAM_CONNECTOR_ID напряму (не через /keys),
// щоб не тригерити syncChannelsForBot і не перехопити вебхук у ботів, що ділять кілька воронок.
router.post('/:botId/refresh-telegram-username',
    validateParams({ params: z.object({ botId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const botId = req.params.botId;
        const connectorId = typeof req.body?.connectorId === 'string' ? req.body.connectorId.trim() : '';
        if (connectorId) {
            await db.funnelKey.upsert({
                where: { botId_key: { botId, key: 'TELEGRAM_CONNECTOR_ID' } },
                update: { value: connectorId },
                create: { botId, key: 'TELEGRAM_CONNECTOR_ID', value: connectorId, label: 'Telegram Connector ID', isSecret: false },
            });
        }
        const result = await resolveTelegramUsername(botId);
        res.json(result);
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
// POST /api/funnels/:botId/auto-layout — перерахувати grid-позиції всіх нод
// (кнопка «🧹 Впорядкувати» в редакторі). Той самий алгоритм, що й MCP auto_layout.
router.post('/:botId/auto-layout',
    validateParams({ params: z.object({ botId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const flow = await db.flowDefinition.findUnique({ where: { botId } });
        if (!flow) throw new NotFoundError('FlowDefinition', botId);
        const { computeAutoLayout } = require('@platform/flow-layout');
        const nodes = computeAutoLayout(flow.nodes || [], flow.edges || []);
        await db.flowDefinition.update({ where: { botId }, data: { nodes } });
        res.json({ ok: true, data: { nodes } });
    })
);

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
                startedAt: { gte: timeFrom },
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

        // Token usage for Claude nodes — aggregate from api_calls responseData
        const claudeApiCalls = await db.apiCall.findMany({
            where: {
                session: { botId },
                service: 'claude',
                method: 'messages.create',
                createdAt: { gte: timeFrom },
            },
            select: { responseData: true },
        });

        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let claudeCallCount = 0;

        for (const call of claudeApiCalls) {
            const rd = (call.responseData && typeof call.responseData === 'object') ? call.responseData : {};
            if (typeof rd.inputTokens === 'number') {
                totalInputTokens += rd.inputTokens;
                totalOutputTokens += rd.outputTokens || 0;
                claudeCallCount++;
            }
        }

        res.json({
            ok: true,
            data: {
                nodeId,
                period,
                sessionsPassedThrough,
                errors: Number(errorCount),
                errorRate: sessionsPassedThrough > 0 ? (Number(errorCount) / sessionsPassedThrough * 100).toFixed(2) + '%' : '0%',
                indicator: Number(errorCount) > 0 ? 'error' : sessionsPassedThrough > 100 ? 'warning' : 'ok',
                tokens: {
                    input: totalInputTokens,
                    output: totalOutputTokens,
                    total: totalInputTokens + totalOutputTokens,
                    calls: claudeCallCount,
                },
            },
        });
    })
);

// ── ANALYTICS ─────────────────────────────────────────────────────────────────

// GET /api/funnels/:botId/analytics — per-link session counts + node visit stats
router.get('/:botId/analytics',
    validateParams({
        params: z.object({ botId: z.string().uuid() }),
    }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const { period = '30d', includeTest = 'false' } = req.query;

        const bot = await db.bot.findUnique({ where: { id: botId } });
        if (!bot) throw new NotFoundError('Bot', botId);

        const ms = period === '7d' ? 7 * 86400000 : period === '24h' ? 86400000 : 30 * 86400000;
        const timeFrom = new Date(Date.now() - ms);
        const testFilter = includeTest === 'true' ? {} : { isTest: false };

        // ── Flow definition → node labels + order (BFS from start) ────────────
        const flow = await db.flowDefinition.findUnique({ where: { botId } });
        const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
        const edges = Array.isArray(flow?.edges) ? flow.edges : [];
        const nodeMeta = {};
        for (const n of nodes) nodeMeta[n.id] = { label: n.data?.label || n.id, type: n.type || 'node' };
        const adj = {};
        for (const e of edges) { (adj[e.source] ||= []).push(e.target); }
        const startNode = nodes.find(n => n.type === 'start') || nodes[0];
        const order = [];
        const seen = new Set();
        if (startNode) {
            const queue = [startNode.id];
            while (queue.length) {
                const id = queue.shift();
                if (seen.has(id)) continue;
                seen.add(id); order.push(id);
                for (const t of (adj[id] || [])) if (!seen.has(t)) queue.push(t);
            }
        }
        for (const n of nodes) if (!seen.has(n.id)) { seen.add(n.id); order.push(n.id); }

        // ── Sessions in period ────────────────────────────────────────────────
        const sessions = await db.session.findMany({
            where: { botId, startedAt: { gte: timeFrom }, ...testFilter },
            select: { id: true, context: true, state: true, isActive: true },
        });

        const linkCounts = {};   // _linkSource -> session count
        const nodeReached = {};  // nodeId -> sessions that visited it
        const stuckCounts = {};  // current node -> non-completed sessions sitting there
        let totalSessions = 0, activeSessions = 0, completedSessions = 0, unsubscribedSessions = 0;

        for (const s of sessions) {
            totalSessions++;
            if (s.isActive) activeSessions++;
            if (s.state === 'completed') completedSessions++;
            else if (s.state === 'unsubscribed') unsubscribedSessions++;

            const ctx = (s.context && typeof s.context === 'object') ? s.context : {};
            const linkSource = ctx._linkSource || 'direct';
            linkCounts[linkSource] = (linkCounts[linkSource] || 0) + 1;

            const rt = ctx.flowRuntime || {};
            const visited = Array.isArray(rt.nodesVisited) ? new Set(rt.nodesVisited) : new Set();
            for (const nodeId of visited) nodeReached[nodeId] = (nodeReached[nodeId] || 0) + 1;

            if (s.state !== 'completed' && rt.currentNodeId) {
                stuckCounts[rt.currentNodeId] = (stuckCounts[rt.currentNodeId] || 0) + 1;
            }
        }

        // Funnel flow in path order, with drop-off between consecutive reached nodes
        const funnelFlow = order
            .filter(id => nodeMeta[id])
            .map(id => ({ nodeId: id, label: nodeMeta[id].label, type: nodeMeta[id].type, reached: nodeReached[id] || 0 }));
        for (let i = 0; i < funnelFlow.length; i++) {
            let nextReached = 0;
            for (let j = i + 1; j < funnelFlow.length; j++) { if (funnelFlow[j].reached > 0) { nextReached = funnelFlow[j].reached; break; } }
            funnelFlow[i].dropAfter = Math.max(0, funnelFlow[i].reached - nextReached);
            funnelFlow[i].dropPct = funnelFlow[i].reached > 0 ? Math.round((funnelFlow[i].dropAfter / funnelFlow[i].reached) * 100) : 0;
        }

        // Where non-completed sessions are sitting right now
        const stuckAt = Object.entries(stuckCounts)
            .map(([nodeId, count]) => ({ nodeId, label: nodeMeta[nodeId]?.label || nodeId, type: nodeMeta[nodeId]?.type || 'node', count }))
            .sort((a, b) => b.count - a.count);

        const linkStats = Object.entries(linkCounts)
            .map(([source, count]) => ({ source, count }))
            .sort((a, b) => b.count - a.count);
        // Legacy unordered node stats — kept for backward compat
        const nodeStats = funnelFlow.filter(n => n.reached > 0).map(n => ({ nodeId: n.nodeId, count: n.reached })).sort((a, b) => b.count - a.count);

        // ── Tracked deep links for this funnel: channels (per-network) + per-post ─
        let channels = [];   // channel links (post_item_id IS NULL), one per network
        let postSources = []; // per-post links (post_item_id set), nested under a channel
        try {
            const rows = await db.$queryRaw`
                SELECT id, code, post_item_id, parent_id, platform, name, description, bot_username, lead_magnet_id, clicks, last_click_at, created_at
                FROM tracked_links WHERE bot_id = ${botId} OR funnel_slug = ${bot.slug} ORDER BY created_at ASC LIMIT 1000`;
            const chById = {};
            for (const r of rows) {
                if (!r.post_item_id) {
                    const ch = {
                        id: r.id, code: r.code, platform: r.platform, name: r.name, description: r.description,
                        url: r.bot_username ? `https://t.me/${r.bot_username}?start=${r.code}` : null,
                        directClicks: Number(r.clicks) || 0, postClicks: 0, postLinks: 0,
                        totalClicks: Number(r.clicks) || 0,
                    };
                    chById[r.id] = ch;
                    channels.push(ch);
                }
            }
            for (const r of rows) {
                if (r.post_item_id) {
                    const c = Number(r.clicks) || 0;
                    postSources.push({
                        code: r.code, postItemId: r.post_item_id, parentId: r.parent_id, platform: r.platform,
                        leadMagnetId: r.lead_magnet_id, clicks: c, sessions: linkCounts[r.code] || 0, lastClickAt: r.last_click_at,
                    });
                    if (r.parent_id && chById[r.parent_id]) {
                        chById[r.parent_id].postClicks += c;
                        chById[r.parent_id].postLinks += 1;
                        chById[r.parent_id].totalClicks += c;
                    }
                }
            }
        } catch { /* tracked_links table may not exist yet */ }
        channels.sort((a, b) => b.totalClicks - a.totalClicks);
        postSources.sort((a, b) => b.clicks - a.clicks);
        const trackedClicks = channels.reduce((a, c) => a + c.totalClicks, 0)
            + postSources.filter(p => !p.parentId || !channels.some(c => c.id === p.parentId)).reduce((a, p) => a + p.clicks, 0);

        // «Є відповідь» — сесії, де підписник написав НЕ-командне повідомлення (не лише /start)
        let repliedSessions = 0;
        try {
            const testCond = includeTest === 'true' ? '' : 'AND s."isTest" = false';
            const rr = await db.$queryRawUnsafe(
                `SELECT COUNT(DISTINCT s.id)::int AS c FROM sessions s JOIN messages m ON m."sessionId" = s.id AND m.role = 'user' AND m.content NOT LIKE '/%' WHERE s."botId" = $1 AND s."startedAt" >= $2::timestamptz ${testCond}`,
                botId, timeFrom.toISOString());
            repliedSessions = Number(rr[0]?.c || 0);
        } catch { /* ignore */ }

        res.json({ ok: true, data: {
            period,
            summary: {
                totalSessions, activeSessions, completedSessions, unsubscribedSessions,
                repliedSessions, repliedRate: totalSessions > 0 ? Math.round((repliedSessions / totalSessions) * 100) : 0,
                otherSessions: Math.max(0, totalSessions - completedSessions - unsubscribedSessions),
                conversionRate: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0,
                trackedClicks,
            },
            channels,
            postSources,
            linkStats,
            funnelFlow,
            stuckAt,
            nodeStats,
        }});
    })
);

// GET /api/funnels/analytics/compare — зведена таблиця метрик по всіх воронках (порівняння)
router.get('/analytics/compare', asyncHandler(async (req, res) => {
    const { period = '30d', projectId = '', includeTest = 'false' } = req.query;
    const ms = period === '7d' ? 7 * 86400000 : period === '24h' ? 86400000 : period === 'all' ? null : 30 * 86400000;
    const timeFrom = ms ? new Date(Date.now() - ms) : null;
    const testFilter = includeTest === 'true' ? {} : { isTest: false };

    // RBAC: 'user' — лише дозволені проєкти (і не може вийти за них через ?projectId).
    const _allowed = allowedProjectIds(req);
    let _projWhere = {};
    if (projectId) {
        _projWhere = (_allowed && !_allowed.includes(String(projectId))) ? { projectId: '__none__' } : { projectId: String(projectId) };
    } else if (_allowed) {
        _projWhere = { projectId: { in: _allowed } };
    }
    const bots = await db.bot.findMany({
        where: _projWhere,
        select: { id: true, name: true, slug: true, isActive: true, project: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
    });

    // Кліки з трекованих deep-links — одним запитом на всі боти
    const clicksByBot = {};
    try {
        const rows = await db.$queryRaw`SELECT bot_id, COALESCE(SUM(clicks),0)::int AS clicks FROM tracked_links WHERE bot_id IS NOT NULL GROUP BY bot_id`;
        for (const r of rows) clicksByBot[r.bot_id] = Number(r.clicks) || 0;
    } catch { /* таблиці може не бути */ }

    // «Є відповідь» — сесії, де підписник написав хоч одне НЕ-командне повідомлення (не лише /start)
    const repliedByBot = {};
    try {
        const testCond = includeTest === 'true' ? '' : 'AND s."isTest" = false';
        const rows = await db.$queryRawUnsafe(
            `SELECT s."botId" AS bot_id, COUNT(DISTINCT s.id)::int AS replied
             FROM sessions s JOIN messages m ON m."sessionId" = s.id AND m.role = 'user' AND m.content NOT LIKE '/%'
             WHERE s."startedAt" >= $1::timestamptz ${testCond} GROUP BY s."botId"`,
            (timeFrom || new Date(0)).toISOString());
        for (const r of rows) repliedByBot[r.bot_id] = Number(r.replied) || 0;
    } catch { /* ignore */ }

    const out = [];
    for (const bot of bots) {
        const flow = await db.flowDefinition.findUnique({ where: { botId: bot.id } });
        const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
        const edges = Array.isArray(flow?.edges) ? flow.edges : [];

        // BFS-порядок нод від старту (щоб визначити «перший notifyAdmin» = лід)
        const adj = {};
        for (const e of edges) (adj[e.source] ||= []).push(e.target);
        const startNode = nodes.find(n => n.type === 'start') || nodes[0];
        const order = []; const seen = new Set();
        if (startNode) {
            const q = [startNode.id];
            while (q.length) { const id = q.shift(); if (seen.has(id)) continue; seen.add(id); order.push(id); for (const t of (adj[id] || [])) if (!seen.has(t)) q.push(t); }
        }
        // Цільові ноди = оплата (connector/wait_payment); якщо їх нема (демо-воронки) — 2-й+ notifyAdmin (офер/гарячий лід)
        const paymentIds = nodes.filter(n => n.type === 'connector' || n.type === 'wait_payment').map(n => n.id);
        let targetSet;
        if (paymentIds.length) targetSet = new Set(paymentIds);
        else {
            const notifyInOrder = order.filter(id => (nodes.find(n => n.id === id)?.type) === 'notifyAdmin');
            targetSet = new Set(notifyInOrder.slice(1));
        }

        const sessions = await db.session.findMany({
            where: { botId: bot.id, ...(timeFrom ? { startedAt: { gte: timeFrom } } : {}), ...testFilter },
            select: { context: true, state: true, isActive: true },
        });
        let subscribers = 0, active = 0, completed = 0, unsubscribed = 0, reachedTarget = 0;
        for (const s of sessions) {
            subscribers++;
            if (s.isActive) active++;
            if (s.state === 'completed') completed++;
            else if (s.state === 'unsubscribed') unsubscribed++;
            const ctx = (s.context && typeof s.context === 'object') ? s.context : {};
            const visited = Array.isArray(ctx.flowRuntime?.nodesVisited) ? ctx.flowRuntime.nodesVisited : [];
            if (targetSet.size && visited.some(v => targetSet.has(v))) reachedTarget++;
        }

        const replied = repliedByBot[bot.id] || 0;
        out.push({
            botId: bot.id, name: bot.name, slug: bot.slug, isActive: bot.isActive,
            projectId: bot.project?.id || null, project: bot.project?.name || '—',
            subscribers, replied, repliedRate: subscribers > 0 ? Math.round((replied / subscribers) * 100) : 0,
            active, completed,
            conversionRate: subscribers > 0 ? Math.round((completed / subscribers) * 100) : 0,
            reachedTarget, reachedRate: subscribers > 0 ? Math.round((reachedTarget / subscribers) * 100) : 0,
            unsubscribed, clicks: clicksByBot[bot.id] || 0,
        });
    }
    res.json({ ok: true, data: out });
}));

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

// POST /api/funnels/:botId/upload-file — upload a static file for a sendFile node
// Body: { filename: 'name.pdf', data: '<base64>' }
router.post('/:botId/upload-file',
    validateParams({ params: z.object({ botId: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const { botId } = req.params;
        const { filename, data } = req.body;

        if (!filename || !data) {
            return res.status(400).json({ ok: false, error: { message: 'filename and data are required' } });
        }

        const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
        const ts = Date.now();
        const storedName = `${ts}-${safeName}`;

        const botDir = path.join(UPLOADS_DIR, botId);
        fs.mkdirSync(botDir, { recursive: true });

        const filePath = path.join(botDir, storedName);
        const buffer = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64');
        fs.writeFileSync(filePath, buffer);

        const baseUrl = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://flows.fineko.space';
        const fileUrl = `${baseUrl}/bot-files/${botId}/${storedName}`;

        res.json({ ok: true, data: { fileUrl, fileName: safeName, storedName } });
    })
);

module.exports = router;
