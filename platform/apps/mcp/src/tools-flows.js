'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function safeJsonStringify(value) {
    return JSON.stringify(value, (_, current) => (typeof current === 'bigint' ? current.toString() : current), 2);
}

const NODE_TYPES = [
    'start',
    'message',
    'claude',
    'js',
    'condition',
    'connector',
    'saveFile',
    'wait',
    'loadFile',
    'httpRequest',
    'tag',
    'abtest',
    // ── Admin / Telegram ──────────────────────────────────────────
    'notifyAdmin',          // sends Telegram message to admin;   data: { message, targetKey }
    'sendDocument',         // sends file/PDF to user;             data: { fileKey, fileVar, caption }
    'sendPhoto',            // sends image to user;                data: { photoVar, caption }
    // ── Payments ──────────────────────────────────────────────────
    'wait_payment',         // blocks until WayForPay webhook fires; data: { timeoutHours }
    // ── AI + Documents ────────────────────────────────────────────
    'generateDocument',     // generates DOCX via template;       data: { template, sourceVar, filename, sendToUser }
    // ── Utility ───────────────────────────────────────────────────
    'httpEncode',           // Base64-encodes a context var;      data: { sourceVar, outputVar }
    'fetchTelegramProfile', // fetches TG bio + photo_url (silent); data: {}
];

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
        name: 'new_bot',
        description: 'Instantiates a new bot record with an empty FlowDefinition in PostgreSQL for the finance-course project.',
        inputSchema: {
            type: 'object',
            properties: {
                projectSlug: { type: 'string', description: 'Project slug, default: finance-course' },
                name: { type: 'string', description: 'Bot display name' },
                slug: { type: 'string', description: 'Bot slug unique inside project' },
                description: { type: 'string', description: 'Short description of what this bot does' },
                goal: { type: 'string', description: 'What the student receives on completion (output goal)' },
                outputFiles: { type: 'array', items: { type: 'string' }, description: 'List of output file types this bot creates, e.g. ["student_profile", "business_process"]' },
                trigger: { type: 'string' },
                isActive: { type: 'boolean', default: true },
            },
            required: ['name', 'slug'],
        },
    },
    {
        name: 'update_bot',
        description: 'Update bot metadata fields: name, description, goal, outputFiles',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string', description: 'Bot UUID' },
                name: { type: 'string', description: 'Bot display name' },
                description: { type: 'string', description: 'Short bot description' },
                goal: { type: 'string', description: 'What the student receives on completion' },
                outputFiles: { type: 'array', items: { type: 'string' }, description: 'List of output file types, e.g. ["student_profile", "business_process"]' },
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
        description: 'Add a new node to the funnel canvas. Key types and their required data fields:\n' +
            '• message — { text, label } — optional: attachmentUrl, attachmentFileName, buttons: [[{text,url}]]\n' +
            '• claude — { systemPrompt, model, mode, outputVar, connectorId, exitCondition } — mode: "single"|"dialog"; exitCondition: "json_output"|"first_response"|"user_confirms"|"keyword:WORD"\n' +
            '• condition — { conditions: [{ id, label, expression }] } — expression is a JS boolean expression on context\n' +
            '• js — { code } — JS code with access to context/user/session; must return context object\n' +
            '• connector — { connectorType, action, amount, currency, orderReference, description, outputVar } — for WayForPay: action="create_invoice"\n' +
            '• saveFile — { fileType, contentVar } — saves context var as user file; fileType: "cashflow_articles"|"business_process"|etc.\n' +
            '• loadFile — { fileType, outputVar, onMissing } — onMissing: "ask"|"skip"|"block"\n' +
            '• httpRequest — { url, method, bodyTemplate, outputVar, responsePath } — method: "GET"|"POST"|"PUT"|"DELETE"\n' +
            '• wait — { duration, unit } — unit: "minutes"|"hours"|"days"|"weeks"\n' +
            '• tag — { tag, action } — action: "add"|"remove"\n' +
            '• abtest — { percentA, variantA, percentB, variantB } — splits users A/B by percentage\n' +
            '• notifyAdmin — { message, targetKey } — targetKey is funnel-key name (e.g. "ADMIN_TELEGRAM_ID"); supports {{user.firstName}}, {{user.telegramId}}, {{session.id}}\n' +
            '• sendDocument — { fileKey, fileVar, caption } — fileKey: env key name (e.g. "PRESENTATION_PDF_URL"); fileVar: context path; supports Telegram file_ids\n' +
            '• sendPhoto — { photoVar, caption } — photoVar: context path to image URL or base64\n' +
            '• wait_payment — { timeoutHours } — pauses until WayForPay webhook; exits via "paid" handle\n' +
            '• generateDocument — { template, sourceVar, filename, sendToUser } — template: "student_profile"|"business_process"|"cashflow_table"|"pl_table"|"balance_table"\n' +
            '• httpEncode — { sourceVar, outputVar } — Base64-encodes a context variable\n' +
            '• fetchTelegramProfile — {} — silently loads tg_bio and tg_photo_url into context',
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
        name: 'delete_edge',
        description: 'Delete a specific edge by its ID from the funnel',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                edgeId: { type: 'string', description: 'Edge ID to delete (e.g. edge_1234567890)' },
            },
            required: ['botId', 'edgeId'],
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
    return bots.map((bot) => {
        const settings = bot.settings && typeof bot.settings === 'object' && !Array.isArray(bot.settings)
            ? bot.settings
            : {};

        // Parse outputFiles JSON array if stored as string
        let outputFiles = [];
        if (bot.outputFiles) {
            try {
                outputFiles = typeof bot.outputFiles === 'string' ? JSON.parse(bot.outputFiles) : bot.outputFiles;
            } catch (_error) {
                outputFiles = [];
            }
        }

        return {
            id: bot.id,
            name: bot.name,
            slug: bot.slug,
            project: bot.project.name,
            description: bot.description || settings.description || null,
            goal: bot.goal || settings.goal || null,
            outputFiles: outputFiles.length > 0 ? outputFiles : [],
            hasFlow: !!bot.flowDefinition,
            flowUpdatedAt: bot.flowDefinition?.updatedAt,
            keysCount: bot._count.funnelKeys,
        };
    });
}

async function getFunnel({ botId }) {
    const [flow, keys, bot] = await Promise.all([
        prisma.flowDefinition.findUnique({ where: { botId } }),
        prisma.funnelKey.findMany({ where: { botId } }),
        prisma.bot.findUnique({ where: { id: botId }, include: { project: true } }),
    ]);

    if (!bot) throw new Error(`Bot not found: ${botId}`);

    const settings = bot.settings && typeof bot.settings === 'object' && !Array.isArray(bot.settings)
        ? bot.settings
        : {};

    // Parse outputFiles JSON array if stored as string
    let outputFiles = [];
    if (bot.outputFiles) {
        try {
            outputFiles = typeof bot.outputFiles === 'string' ? JSON.parse(bot.outputFiles) : bot.outputFiles;
        } catch (_error) {
            outputFiles = [];
        }
    }

    return {
        bot: {
            id: bot.id,
            name: bot.name,
            slug: bot.slug,
            project: bot.project.name,
            description: bot.description || settings.description || null,
            goal: bot.goal || settings.goal || null,
            outputFiles: outputFiles.length > 0 ? outputFiles : [],
        },
        nodes: flow?.nodes || [],
        edges: flow?.edges || [],
        viewport: flow?.viewport || { x: 0, y: 0, zoom: 1 },
        keySource: {
            scope: 'bot',
            table: 'funnel_keys',
            botId,
            inheritedFromProject: false,
        },
        keys: (keys || []).map((key) => ({
            key: key.key,
            label: key.label,
            isSecret: key.isSecret,
            value: key.isSecret ? '••••••••' : key.value,
        })),
    };
}

function buildDefaultFlow() {
    return {
        nodes: [
            {
                id: 'start_1',
                type: 'start',
                position: { x: 80, y: 80 },
                data: { label: 'Start', trigger: '/start' },
            },
            {
                id: 'msg_intro',
                type: 'message',
                position: { x: 80, y: 240 },
                data: { label: 'Intro', text: 'Привіт! Опиши, будь ласка, свою задачу.' },
            },
        ],
        edges: [
            { id: 'e_start_intro', source: 'start_1', target: 'msg_intro', animated: true },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
    };
}

async function createFunnel({
    projectSlug = 'finance-course',
    name,
    slug,
    description,
    goal,
    outputFiles,
    trigger,
    isActive = true,
}) {
    if (!name || !slug) {
        throw new Error('name and slug are required');
    }

    const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
    if (!project) {
        throw new Error(`Project not found: ${projectSlug}`);
    }

    const exists = await prisma.bot.findFirst({
        where: {
            projectId: project.id,
            slug,
        },
    });
    if (exists) {
        throw new Error(`Bot already exists in project: ${slug}`);
    }

    const flow = buildDefaultFlow();

    // Serialize outputFiles array to JSON if provided
    const outputFilesJson = Array.isArray(outputFiles) ? JSON.stringify(outputFiles) : null;

    const result = await prisma.$transaction(async (tx) => {
        const bot = await tx.bot.create({
            data: {
                projectId: project.id,
                name,
                slug,
                description: description || null,
                goal: goal || null,
                outputFiles: outputFilesJson,
                trigger: trigger || null,
                isActive: isActive ?? true,
                settings: {},
            },
        });

        const flowDefinition = await tx.flowDefinition.create({
            data: {
                botId: bot.id,
                nodes: flow.nodes,
                edges: flow.edges,
                viewport: flow.viewport,
            },
        });

        return { bot, flowDefinition };
    });

    return {
        created: true,
        bot: {
            id: result.bot.id,
            name: result.bot.name,
            slug: result.bot.slug,
            projectSlug,
            isActive: result.bot.isActive,
        },
        flow: {
            id: result.flowDefinition.id,
            nodes: flow.nodes.length,
            edges: flow.edges.length,
        },
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

async function updateBot({ botId, name, description, goal, outputFiles }) {
    if (!botId) throw new Error('botId is required');

    const updateData = {};

    if (typeof name === 'string') updateData.name = name.trim();
    if (typeof description === 'string') updateData.description = description.trim() || null;
    if (typeof goal === 'string') updateData.goal = goal.trim() || null;

    if (outputFiles !== undefined) {
        if (!Array.isArray(outputFiles)) {
            throw new Error('outputFiles must be an array of strings');
        }
        const normalized = outputFiles.map((item) => String(item).trim()).filter(Boolean);
        updateData.outputFiles = JSON.stringify(normalized);
    }

    if (!Object.keys(updateData).length) {
        throw new Error('No valid fields to update');
    }

    const updated = await prisma.bot.update({
        where: { id: botId },
        data: updateData,
        include: { project: true },
    });

    let parsedOutputFiles = [];
    if (updated.outputFiles) {
        try {
            parsedOutputFiles = typeof updated.outputFiles === 'string'
                ? JSON.parse(updated.outputFiles)
                : updated.outputFiles;
        } catch (_error) {
            parsedOutputFiles = [];
        }
    }

    return {
        id: updated.id,
        projectSlug: updated.project?.slug || null,
        name: updated.name,
        slug: updated.slug,
        description: updated.description,
        goal: updated.goal,
        outputFiles: Array.isArray(parsedOutputFiles) ? parsedOutputFiles : [],
    };
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

async function deleteEdge({ botId, edgeId }) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) throw new Error(`No flow found for botId: ${botId}`);
    const before = (flow.edges || []).length;
    const edges = (flow.edges || []).filter((e) => e.id !== edgeId);
    if (edges.length === before) throw new Error(`Edge ${edgeId} not found in bot ${botId}`);
    await prisma.flowDefinition.update({ where: { botId }, data: { edges } });
    return { deleted: edgeId, remainingEdges: edges.length };
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

function mapConnectorInstance(instance) {
    return {
        id: instance.id,
        label: instance.name,
    };
}

async function getConnectorInstancesMap() {
    const instances = await prisma.savedConnector.findMany({
        where: { isActive: true },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    return instances.reduce((acc, item) => {
        if (!acc[item.type]) acc[item.type] = [];
        acc[item.type].push(mapConnectorInstance(item));
        return acc;
    }, {});
}

async function listConnectors() {
    const instancesByType = await getConnectorInstancesMap();
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
        instances: instancesByType[connector.type] || [],
    }));
}

async function getConnector({ id, type }) {
    if (!id && !type) throw new Error('Provide either id or type');
    const connector = await prisma.connectorDef.findUnique({ where: id ? { id } : { type } });
    if (!connector) throw new Error('Connector not found');
    const instancesByType = await getConnectorInstancesMap();
    return {
        ...connector,
        instances: instancesByType[connector.type] || [],
    };
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
            startedAt: { gte: timeFrom },
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
        case 'new_bot': return createFunnel(args);
        case 'create_funnel': return createFunnel(args);
        case 'update_bot': return updateBot(args);
        case 'update_node': return updateNode(args);
        case 'add_node': return addNode(args);
        case 'delete_node': return deleteNode(args);
        case 'create_edge': return createEdge(args);
        case 'delete_edge': return deleteEdge(args);
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
