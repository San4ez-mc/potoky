'use strict';

/**
 * MCP HTTP route — exposes the same tools as apps/mcp/src/index.js
 * but via HTTP transport (Streamable HTTP) for Claude.ai remote MCP.
 *
 * Endpoint: POST /mcp  (or GET /mcp for SSE stream negotiation)
 *
 * Auth (two options):
 *   1. Global:   Authorization: Bearer <MCP_SECRET env var>
 *   2. Per-user: ?token=<user.mcpToken>  OR  Authorization: Bearer <user.mcpToken>
 *
 * Add to Claude.ai: https://flows.fineko.space/mcp?token=<your_token>
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// ─── Auth ──────────────────────────────────────────────────────────────────────

async function checkAuth(req, res) {
    const globalSecret = process.env.MCP_SECRET;
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    const queryToken = req.query.token;
    const candidate = bearer || queryToken;

    if (!candidate) {
        if (!globalSecret) return true; // no auth configured — open
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }

    // Check global secret first
    if (globalSecret && candidate === globalSecret) return true;

    // Check per-user token in DB
    try {
        const user = await prisma.user.findUnique({ where: { mcpToken: candidate } });
        if (user) return true;
    } catch (_) {}

    res.status(401).json({ error: 'Unauthorized' });
    return false;
}

// ─── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'list_funnels',
        description: 'List all bots and their funnel status on the platform',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'get_funnel',
        description: 'Get the full funnel definition (nodes, edges, keys) for a bot',
        inputSchema: {
            type: 'object',
            properties: { botId: { type: 'string', description: 'Bot UUID' } },
            required: ['botId'],
        },
    },
    {
        name: 'update_node',
        description: 'Update data on an existing node in the funnel',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                nodeId: { type: 'string' },
                data: { type: 'object' },
            },
            required: ['botId', 'nodeId', 'data'],
        },
    },
    {
        name: 'add_node',
        description: 'Add a new node to the funnel canvas',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                type: { type: 'string', enum: ['start', 'message', 'claude', 'js', 'condition', 'connector', 'saveFile', 'wait'] },
                data: { type: 'object' },
                position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
            },
            required: ['botId', 'type', 'data', 'position'],
        },
    },
    {
        name: 'delete_node',
        description: 'Delete a node and all its connected edges from the funnel',
        inputSchema: {
            type: 'object',
            properties: { botId: { type: 'string' }, nodeId: { type: 'string' } },
            required: ['botId', 'nodeId'],
        },
    },
    {
        name: 'update_funnel_key',
        description: 'Create or update a funnel key (environment variable) for a bot',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                key: { type: 'string', description: 'Must match [A-Z0-9_]+' },
                value: { type: 'string' },
                label: { type: 'string' },
                isSecret: { type: 'boolean' },
            },
            required: ['botId', 'key', 'value'],
        },
    },
    {
        name: 'delete_funnel_key',
        description: 'Delete a funnel key for a bot',
        inputSchema: {
            type: 'object',
            properties: { botId: { type: 'string' }, key: { type: 'string' } },
            required: ['botId', 'key'],
        },
    },
    {
        name: 'list_connectors',
        description: 'List all connector definitions available on the platform',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'get_connector',
        description: 'Get a single connector definition by id or type slug',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                type: { type: 'string' },
            },
        },
    },
    {
        name: 'create_connector',
        description: 'Create a new connector definition',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                type: { type: 'string' },
                description: { type: 'string' },
                icon: { type: 'string' },
                color: { type: 'string' },
                schema: { type: 'object' },
            },
            required: ['name', 'type'],
        },
    },
    {
        name: 'update_connector',
        description: 'Update fields of an existing connector definition',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                icon: { type: 'string' },
                color: { type: 'string' },
                schema: { type: 'object' },
                isActive: { type: 'boolean' },
            },
            required: ['id'],
        },
    },
    {
        name: 'delete_connector',
        description: 'Delete a connector definition by id',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
        },
    },
];

// ─── Tool handlers ─────────────────────────────────────────────────────────────

async function listFunnels() {
    const bots = await prisma.bot.findMany({
        include: { project: true, flowDefinition: { select: { updatedAt: true } }, _count: { select: { funnelKeys: true } } },
    });
    return bots.map(b => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        project: b.project.name,
        hasFlow: !!b.flowDefinition,
        flowUpdatedAt: b.flowDefinition?.updatedAt,
        keysCount: b._count.funnelKeys,
    }));
}

async function getFunnel({ botId }) {
    const [flow, keys, bot] = await Promise.all([
        prisma.flowDefinition.findUnique({ where: { botId } }),
        prisma.funnelKey.findMany({ where: { botId } }),
        prisma.bot.findUnique({ where: { id: botId }, include: { project: true } }),
    ]);
    if (!bot) throw new Error(`Bot not found: ${botId}`);
    return {
        bot: { id: bot.id, name: bot.name, slug: bot.slug, project: bot.project.name },
        nodes: flow?.nodes || [],
        edges: flow?.edges || [],
        viewport: flow?.viewport || { x: 0, y: 0, zoom: 1 },
        keys: (keys || []).map(k => ({
            key: k.key,
            label: k.label,
            isSecret: k.isSecret,
            value: k.isSecret ? '••••••••' : k.value,
        })),
    };
}

async function updateNode({ botId, nodeId, data }) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) throw new Error(`No flow found for botId: ${botId}`);
    const nodes = flow.nodes;
    const idx = nodes.findIndex(n => n.id === nodeId);
    if (idx === -1) throw new Error(`Node ${nodeId} not found`);
    nodes[idx] = { ...nodes[idx], data: { ...nodes[idx].data, ...data } };
    await prisma.flowDefinition.update({ where: { botId }, data: { nodes } });
    return { updated: nodes[idx] };
}

async function addNode({ botId, type, data, position }) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    const newNode = { id: `node_${Date.now()}`, type, position, data };
    if (!flow) {
        await prisma.flowDefinition.create({ data: { botId, nodes: [newNode], edges: [] } });
    } else {
        await prisma.flowDefinition.update({ where: { botId }, data: { nodes: [...flow.nodes, newNode] } });
    }
    return { added: newNode };
}

async function deleteNode({ botId, nodeId }) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) throw new Error(`No flow found for botId: ${botId}`);
    const nodes = flow.nodes.filter(n => n.id !== nodeId);
    const edges = flow.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    await prisma.flowDefinition.update({ where: { botId }, data: { nodes, edges } });
    return { deleted: nodeId, removedEdges: flow.edges.length - edges.length };
}

async function updateFunnelKey({ botId, key, value, label, isSecret }) {
    if (!/^[A-Z0-9_]+$/.test(key)) throw new Error('Key must match [A-Z0-9_]+');
    const result = await prisma.funnelKey.upsert({
        where: { botId_key: { botId, key } },
        update: { value, label: label || null, isSecret: isSecret ?? false },
        create: { botId, key, value, label: label || null, isSecret: isSecret ?? false },
    });
    return { key: result.key, label: result.label, isSecret: result.isSecret };
}

async function deleteFunnelKey({ botId, key }) {
    await prisma.funnelKey.delete({ where: { botId_key: { botId, key } } });
    return { deleted: key };
}

async function listConnectors() {
    const connectors = await prisma.connectorDef.findMany({ orderBy: { name: 'asc' } });
    return connectors.map(c => ({
        id: c.id, name: c.name, type: c.type, description: c.description,
        icon: c.icon, color: c.color, isBuiltin: c.isBuiltin, isActive: c.isActive,
    }));
}

async function getConnector({ id, type }) {
    if (!id && !type) throw new Error('Provide either id or type');
    const c = await prisma.connectorDef.findUnique({ where: id ? { id } : { type } });
    if (!c) throw new Error('Connector not found');
    return c;
}

async function createConnector({ name, type, description, icon, color, schema }) {
    return prisma.connectorDef.create({
        data: { name, type, description: description || null, icon: icon || '🔌', color: color || '#6366f1', schema: schema || {}, isBuiltin: false, isActive: true },
    });
}

async function updateConnector({ id, ...fields }) {
    const allowed = ['name', 'description', 'icon', 'color', 'schema', 'isActive'];
    const data = {};
    for (const k of allowed) { if (k in fields) data[k] = fields[k]; }
    if (!Object.keys(data).length) throw new Error('No valid fields to update');
    return prisma.connectorDef.update({ where: { id }, data });
}

async function deleteConnector({ id }) {
    const c = await prisma.connectorDef.findUnique({ where: { id } });
    if (!c) throw new Error('Connector not found');
    if (c.isBuiltin) throw new Error('Cannot delete builtin connectors');
    await prisma.connectorDef.delete({ where: { id } });
    return { deleted: id, name: c.name };
}

async function callTool(name, args) {
    switch (name) {
        case 'list_funnels': return listFunnels();
        case 'get_funnel': return getFunnel(args);
        case 'update_node': return updateNode(args);
        case 'add_node': return addNode(args);
        case 'delete_node': return deleteNode(args);
        case 'update_funnel_key': return updateFunnelKey(args);
        case 'delete_funnel_key': return deleteFunnelKey(args);
        case 'list_connectors': return listConnectors();
        case 'get_connector': return getConnector(args);
        case 'create_connector': return createConnector(args);
        case 'update_connector': return updateConnector(args);
        case 'delete_connector': return deleteConnector(args);
        default: throw new Error(`Unknown tool: ${name}`);
    }
}

// ─── MCP JSON-RPC handler ──────────────────────────────────────────────────────

async function handleJsonRpc(msg) {
    const { id, method, params } = msg;

    if (method === 'initialize') {
        return { jsonrpc: '2.0', id, result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'platform-funnel-mcp', version: '1.0.0' },
        }};
    }

    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
        const { name, arguments: args } = params;
        try {
            const result = await callTool(name, args || {});
            return { jsonrpc: '2.0', id, result: {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            }};
        } catch (err) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: err.message } };
        }
    }

    if (method === 'notifications/initialized') {
        return null; // no response needed
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /mcp — SSE endpoint for MCP Streamable HTTP transport
 * Claude.ai connects here first for negotiation.
 */
router.get('/', async (req, res) => {
    if (!await checkAuth(req, res)) return;
    // Return server info for capability discovery
    res.json({
        name: 'platform-funnel-mcp',
        version: '1.0.0',
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
    });
});

/**
 * POST /mcp — JSON-RPC over HTTP (Streamable HTTP transport)
 * Claude.ai sends tool calls here.
 */
router.post('/', async (req, res) => {
    if (!await checkAuth(req, res)) return;

    const body = req.body;
    try {
        // Handle batch (array) or single request
        if (Array.isArray(body)) {
            const results = await Promise.all(body.map(handleJsonRpc));
            res.json(results.filter(Boolean));
        } else {
            const result = await handleJsonRpc(body);
            if (result === null) {
                res.status(204).end(); // notification — no response
            } else {
                res.json(result);
            }
        }
    } catch (err) {
        res.json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32603, message: err.message } });
    }
});

module.exports = router;
