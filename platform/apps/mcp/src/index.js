/**
 * MCP (Model Context Protocol) Server for funnel editing via Claude chat.
 *
 * Transport: stdio (Claude Desktop / MCP clients read/write JSON-RPC on stdin/stdout).
 *
 * Tools exposed:
 *   list_funnels         — list all bots with flow definitions
 *   get_funnel(botId)    — get full funnel (nodes, edges, keys)
 *   update_node(botId, nodeId, data) — patch node data
 *   add_node(botId, type, data, position) — add new node to funnel
 *   delete_node(botId, nodeId) — delete a node and its edges
 *   update_funnel_key(botId, key, value, label, isSecret) — upsert key
 *   delete_funnel_key(botId, key) — delete key
 *   list_connectors      — list all connector definitions
 *   get_connector(id)    — get one connector by id or type
 *   create_connector(name, type, description, icon, color, schema) — create new connector
 *   update_connector(id, fields) — update connector fields
 *   delete_connector(id) — delete connector definition
 */

'use strict';

const readline = require('readline');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── JSON-RPC helpers ──────────────────────────────────────────────────────────

function respond(id, result) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
    process.stdout.write(msg + '\n');
}

function error(id, code, message) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
    process.stdout.write(msg + '\n');
}

// ─── Tool definitions (MCP schema) ────────────────────────────────────────────

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
            properties: {
                botId: { type: 'string', description: 'Bot UUID' },
            },
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
                nodeId: { type: 'string', description: 'Node ID in React Flow' },
                data: { type: 'object', description: 'Key-value pairs to merge into node.data' },
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
                data: { type: 'object', description: 'Initial node data (label, text, systemPrompt, code, etc.)' },
                position: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' } },
                    required: ['x', 'y'],
                },
            },
            required: ['botId', 'type', 'data', 'position'],
        },
    },
    {
        name: 'delete_node',
        description: 'Delete a node and all its connected edges from the funnel',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                nodeId: { type: 'string' },
            },
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
                key: { type: 'string', description: 'Key name, must match [A-Z0-9_]+' },
                value: { type: 'string' },
                label: { type: 'string', description: 'Human-readable label' },
                isSecret: { type: 'boolean', default: false },
            },
            required: ['botId', 'key', 'value'],
        },
    },
    {
        name: 'delete_funnel_key',
        description: 'Delete a funnel key for a bot',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                key: { type: 'string' },
            },
            required: ['botId', 'key'],
        },
    },

    // ── Connector definitions ──────────────────────────────────
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
                id: { type: 'string', description: 'Connector UUID (optional if type is provided)' },
                type: { type: 'string', description: 'Connector type slug (optional if id is provided)' },
            },
        },
    },
    {
        name: 'create_connector',
        description: 'Create a new connector definition',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Display name, e.g. "Google Sheets"' },
                type: { type: 'string', description: 'Unique slug, e.g. "google_sheets"' },
                description: { type: 'string' },
                icon: { type: 'string', description: 'Emoji or URL' },
                color: { type: 'string', description: 'Hex color, e.g. "#34a853"' },
                schema: { type: 'object', description: 'JSON schema for the connector config fields' },
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
                id: { type: 'string', description: 'Connector UUID' },
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
            properties: {
                id: { type: 'string', description: 'Connector UUID' },
            },
            required: ['id'],
        },
    },
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
    return {
        bot: { id: bot.id, name: bot.name, slug: bot.slug, project: bot.project.name },
        nodes: flow?.nodes || [],
        edges: flow?.edges || [],
        viewport: flow?.viewport || { x: 0, y: 0, zoom: 1 },
        keys: keys.map(k => ({
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
    let flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    const newNode = { id: `node_${Date.now()}`, type, position, data };

    if (!flow) {
        await prisma.flowDefinition.create({ data: { botId, nodes: [newNode], edges: [] } });
    } else {
        await prisma.flowDefinition.update({
            where: { botId },
            data: { nodes: [...flow.nodes, newNode] },
        });
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

// ─── Connector handlers ────────────────────────────────────────────────────────

async function listConnectors() {
    const connectors = await prisma.connectorDef.findMany({ orderBy: { name: 'asc' } });
    return connectors.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        description: c.description,
        icon: c.icon,
        color: c.color,
        isBuiltin: c.isBuiltin,
        isActive: c.isActive,
    }));
}

async function getConnector({ id, type }) {
    if (!id && !type) throw new Error('Provide either id or type');
    const where = id ? { id } : { type };
    const c = await prisma.connectorDef.findUnique({ where });
    if (!c) throw new Error(`Connector not found`);
    return c;
}

async function createConnector({ name, type, description, icon, color, schema }) {
    if (!name || !type) throw new Error('name and type are required');
    const c = await prisma.connectorDef.create({
        data: { name, type, description: description || null, icon: icon || '🔌', color: color || '#6366f1', schema: schema || {}, isBuiltin: false, isActive: true },
    });
    return c;
}

async function updateConnector({ id, ...fields }) {
    const allowed = ['name', 'description', 'icon', 'color', 'schema', 'isActive'];
    const data = {};
    for (const k of allowed) { if (k in fields) data[k] = fields[k]; }
    if (Object.keys(data).length === 0) throw new Error('No valid fields to update');
    const c = await prisma.connectorDef.update({ where: { id }, data });
    return c;
}

async function deleteConnector({ id }) {
    const c = await prisma.connectorDef.findUnique({ where: { id } });
    if (!c) throw new Error('Connector not found');
    if (c.isBuiltin) throw new Error('Cannot delete builtin connectors');
    await prisma.connectorDef.delete({ where: { id } });
    return { deleted: id, name: c.name };
}
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

// ─── MCP message handler ──────────────────────────────────────────────────────

async function handleMessage(msg) {
    const { id, method, params } = msg;

    try {
        if (method === 'initialize') {
            return respond(id, {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'platform-funnel-mcp', version: '1.0.0' },
            });
        }

        if (method === 'tools/list') {
            return respond(id, { tools: TOOLS });
        }

        if (method === 'tools/call') {
            const { name, arguments: args } = params;
            const result = await callTool(name, args || {});
            return respond(id, {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            });
        }

        if (method === 'notifications/initialized') {
            return; // no response needed for notifications
        }

        error(id, -32601, `Method not found: ${method}`);
    } catch (err) {
        error(id, -32603, err.message);
    }
}

// ─── Stdio transport ──────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
        const msg = JSON.parse(trimmed);
        await handleMessage(msg);
    } catch (err) {
        process.stderr.write(`MCP parse error: ${err.message}\n`);
    }
});

process.on('SIGINT', () => { prisma.$disconnect(); process.exit(0); });
process.on('SIGTERM', () => { prisma.$disconnect(); process.exit(0); });

process.stderr.write('Platform Funnel MCP server started (stdio transport)\n');
