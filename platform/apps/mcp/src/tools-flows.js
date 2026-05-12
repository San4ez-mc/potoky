'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function safeJsonStringify(value) {
    return JSON.stringify(value, (_, current) => (typeof current === 'bigint' ? current.toString() : current), 2);
}

const NODE_TYPES = ['start', 'message', 'claude', 'js', 'condition', 'connector', 'saveFile', 'wait', 'loadFile', 'httpRequest', 'tag', 'abtest'];

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
                type: { type: 'string', enum: NODE_TYPES },
                data: { type: 'object', description: 'Initial node data' },
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
            properties: { botId: { type: 'string' }, nodeId: { type: 'string' } },
            required: ['botId', 'nodeId'],
        },
    },
    {
        name: 'create_edge',
        description: 'Create an edge between two nodes in the funnel',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                source: { type: 'string' },
                target: { type: 'string' },
            },
            required: ['botId', 'source', 'target'],
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
                label: { type: 'string' },
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
    {
        name: 'get_node_stats',
        description: 'Get node statistics — get node performance stats and error indicator for a bot node',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                nodeId: { type: 'string' },
                period: { type: 'string', enum: ['24h', '7d', '30d'] },
            },
            required: ['botId', 'nodeId'],
        },
    },
    {
        name: 'get_api_logs',
        description: 'Get api logs — get recent API calls across the platform',
        inputSchema: {
            type: 'object',
            properties: {
                service: { type: 'string' },
                limit: { type: 'number' },
                page: { type: 'number' },
            },
            required: [],
        },
    },
];

async function listFunnels() {
    const bots = await prisma.bot.findMany({
        include: { project: true, flowDefinition: { select: { updatedAt: true } }, _count: { select: { funnelKeys: true } } },
    });
    return bots.map((bot) => ({
        id: bot.id,
        name: bot.name,
        slug: bot.slug,
        project: bot.project.name,
        hasFlow: !!bot.flowDefinition,
        flowUpdatedAt: bot.flowDefinition?.updatedAt,
        keysCount: bot._count.funnelKeys,
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
        keys: (keys || []).map((key) => ({
            key: key.key,
            label: key.label,
            isSecret: key.isSecret,
            value: key.isSecret ? '••••••••' : key.value,
        })),
    };
}

async function updateNode({ botId, nodeId, data }) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) throw new Error(`No flow found for botId: ${botId}`);

    const nodes = [...flow.nodes];
    const index = nodes.findIndex((node) => node.id === nodeId);
    if (index === -1) throw new Error(`Node ${nodeId} not found`);

    nodes[index] = { ...nodes[index], data: { ...nodes[index].data, ...data } };
    await prisma.flowDefinition.update({ where: { botId }, data: { nodes } });
    return { updated: nodes[index] };
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

    const nodes = flow.nodes.filter((node) => node.id !== nodeId);
    const edges = flow.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    await prisma.flowDefinition.update({ where: { botId }, data: { nodes, edges } });
    return { deleted: nodeId, removedEdges: flow.edges.length - edges.length };
}

async function createEdge({ botId, source, target }) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) throw new Error(`No flow found for botId: ${botId}`);
    if (!flow.nodes.some((node) => node.id === source)) throw new Error(`Source node ${source} not found`);
    if (!flow.nodes.some((node) => node.id === target)) throw new Error(`Target node ${target} not found`);

    const edge = { id: `edge_${Date.now()}`, source, target };
    await prisma.flowDefinition.update({
        where: { botId },
        data: { edges: [...(flow.edges || []), edge] },
    });
    return { edge };
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
    return connectors.map((connector) => ({
        id: connector.id,
        name: connector.name,
        type: connector.type,
        description: connector.description,
        icon: connector.icon,
        color: connector.color,
        isBuiltin: connector.isBuiltin,
        isActive: connector.isActive,
    }));
}

async function getConnector({ id, type }) {
    if (!id && !type) throw new Error('Provide either id or type');
    const connector = await prisma.connectorDef.findUnique({ where: id ? { id } : { type } });
    if (!connector) throw new Error('Connector not found');
    return connector;
}

async function createConnector({ name, type, description, icon, color, schema }) {
    if (!name || !type) throw new Error('name and type are required');
    return prisma.connectorDef.create({
        data: {
            name,
            type,
            description: description || null,
            icon: icon || '🔌',
            color: color || '#6366f1',
            schema: schema || {},
            isBuiltin: false,
            isActive: true,
        },
    });
}

async function updateConnector({ id, ...fields }) {
    const allowed = ['name', 'description', 'icon', 'color', 'schema', 'isActive'];
    const data = {};
    for (const key of allowed) {
        if (key in fields) data[key] = fields[key];
    }
    if (!Object.keys(data).length) throw new Error('No valid fields to update');
    return prisma.connectorDef.update({ where: { id }, data });
}

async function deleteConnector({ id }) {
    const connector = await prisma.connectorDef.findUnique({ where: { id } });
    if (!connector) throw new Error('Connector not found');
    if (connector.isBuiltin) throw new Error('Cannot delete builtin connectors');
    await prisma.connectorDef.delete({ where: { id } });
    return { deleted: id, name: connector.name };
}

async function getNodeStats({ botId, nodeId, period = '24h' }) {
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error(`Bot not found: ${botId}`);

    const durations = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
    };
    const timeFrom = new Date(Date.now() - (durations[period] || durations['24h']));

    const sessionsPassedThrough = await prisma.session.count({
        where: {
            botId,
            createdAt: { gte: timeFrom },
        },
    });

    const errorsAtNode = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM app_errors
        WHERE "botId" = ${botId}
        AND "nodeId" = ${nodeId}
        AND "createdAt" >= ${timeFrom}
        AND "resolved" = false
    `;

    const errorCount = Number(errorsAtNode?.[0]?.count || 0);

    return {
        nodeId,
        period,
        sessionsPassedThrough,
        errors: errorCount,
        errorRate: sessionsPassedThrough > 0 ? `${((errorCount / sessionsPassedThrough) * 100).toFixed(2)}%` : '0%',
        indicator: errorCount > 0 ? 'error' : sessionsPassedThrough > 100 ? 'warning' : 'ok',
    };
}

async function getApiLogs({ service, limit = 50, page = 0 }) {
    const where = {};
    if (service) where.service = service;
    return prisma.apiCall.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        skip: Math.max(page, 0) * Math.min(limit, 100),
    });
}

async function callTool(name, args = {}) {
    switch (name) {
        case 'list_funnels': return listFunnels();
        case 'get_funnel': return getFunnel(args);
        case 'update_node': return updateNode(args);
        case 'add_node': return addNode(args);
        case 'delete_node': return deleteNode(args);
        case 'create_edge': return createEdge(args);
        case 'update_funnel_key': return updateFunnelKey(args);
        case 'delete_funnel_key': return deleteFunnelKey(args);
        case 'list_connectors': return listConnectors();
        case 'get_connector': return getConnector(args);
        case 'create_connector': return createConnector(args);
        case 'update_connector': return updateConnector(args);
        case 'delete_connector': return deleteConnector(args);
        case 'get_node_stats': return getNodeStats(args);
        case 'get_api_logs': return getApiLogs(args);
        default: throw new Error(`Unknown tool: ${name}`);
    }
}

async function disconnect() {
    await prisma.$disconnect();
}

module.exports = { TOOLS, callTool, disconnect, safeJsonStringify };
