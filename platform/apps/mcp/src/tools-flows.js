'use strict';

const { PrismaClient } = require('@prisma/client');
const { computeAutoLayout } = require('@platform/flow-layout');

const prisma = new PrismaClient();

function safeJsonStringify(value) {
    return JSON.stringify(value, (_, current) => (typeof current === 'bigint' ? current.toString() : current), 2);
}

const NODE_TYPES = [
    // ── Керування потоком ─────────────────────────────────────────
    'start',                // вхід у воронку; data: { label, trigger:'/start <slug>' }
    'condition',            // розгалуження; data: { condition } (ребра true/false) АБО { conditions:[{id,label,expression}] } (порядок ребер = порядок умов). ОБИДВІ гілки мають вести кудись осмислено
    'wait',                 // пауза/подія; data: { mode:'delay'|'event', unit, duration, eventKey, buttonText, waitMessage }
    'js',                   // довільний код; data: { code }. Доступно context,user,session,input,keys,fetch,Buffer,FormData,Blob,crypto; return {} мержиться в context (root!)
    // ── Спілкування ───────────────────────────────────────────────
    'message',              // статичний текст; data: { text, variants:[], buttons:[[{text,url}]], attachmentUrl }. УВАГА: Instagram НЕ показує inline-кнопки — посилання давай текстом
    'claude',               // AI; data: { mode:'dialog'|'single', systemPrompt, exitCondition:'json_output'|'user_confirms'|'keyword:X'|'markdown_output'|'none', outputVar, messagesTemplate, model, temperature, connectorId, useKb }
    'agent',                // AI з інструментами в циклі; data: { systemPrompt, tools, maxIterations, outputVar, dialogMode, finishTool }
    'knowledgeBase',        // пошук по вбудованих блоках; data: { blocks:[{id,title,content}], contextKey }
    // ── Медіа та файли ────────────────────────────────────────────
    'sendPhoto',            // фото з context; data: { photoVar, caption } (порожній caption = без тексту)
    'sendDocument',         // файл/PDF; data: { fileKey, fileType, fileVar, url, fileName, caption }
    'sendFile',             // файл за прямим URL; data: { fileUrl, fileName, caption }
    'readFile',             // приймає документ від клієнта → текст; data: { outputVar, maxChars }; мета в context.readFileMeta
    'saveFile',             // чекпоінт; data: { fileType, contentVar, template }
    'loadFile',             // відновлення чекпоінта; data: { fileType, outputVar, onMissing }
    'generateDocument',     // DOCX за шаблоном; data: { template, sourceVar, filename, sendToUser }
    // ── Сповіщення ────────────────────────────────────────────────
    'notifyTg',             // ⭐ ОСНОВНЕ сповіщення менеджеру: chat_id з КЛЮЧА ВОРОНКИ; data: { targetKey:'ADMIN_TELEGRAM_ID', message }
    'notifyAdmin',          // легасі (має системні фолбеки → може піти не туди); data: { targetKey|telegramId, message, notifyUser, userMessage }
    // ── Інтеграції ────────────────────────────────────────────────
    'httpRequest',          // простий виклик API; data: { url, method, headers, body|bodyFields, outputVar, responseField }
    'httpEncode',           // base64; data: { sourceVar, outputVar }
    'connector',            // data: { connectorType:'wayforpay'|'ibanoplata'|'monobank'|'browser_agent', action, outputVar, ... } — ключі читаються з funnelEnv
    'wait_payment',         // блокує до вебхука WayForPay; data: { timeoutHours }
    'fbEvent',              // Facebook CAPI; data: { eventName, value, currency }; ключі FB_PIXEL_ID + FB_CAPI_TOKEN
    'fetchTelegramProfile', // тихо кладе context.tg_bio, context.tg_photo_url; data: {}
    // ── Легасі (є у старих воронках) ──────────────────────────────
    'tag',
    'abtest',
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
            '• connector — { connectorType, action, amount, currency, orderReference, description, outputVar } — WayForPay: action="create_invoice"; ibanoplata: action="create_invoice"(amount,paymentPurpose,outputVar→ctx.ibanPayUrl,ctx.orderRef,ctx.ibanInvoiceUid)|"delete_invoice"(invoiceUid); monobank: action="get_statement"(windowHours,outputVar→ctx.monoStatement=[{amountUah,comment,counterName,time,id}])|"mark_consumed"(txId); browser_agent: action="replay"(scenarioKey|scenarioVar,dataVar,outputVar)|"agent"(task,startUrl,dataVar,dryRun,outputVar)|"read"(url,mode,renderJs,outputVar); скрін у ctx.browserScreenshot\n' +
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
            '• fetchTelegramProfile — {} — silently loads tg_bio and tg_photo_url into context\n' +
            '• knowledgeBase — { contextKey, blocks: [{id,title,content}] } — smart keyword search; contextKey defaults to "knowledge_base"; place before Claude node; Claude reads via {{context.knowledge_base}} in systemPrompt',
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
        name: 'auto_layout',
        description: 'Recompute grid positions for ALL nodes in the funnel (BFS row = distance from start, column = branch lane, barycenter edge-crossing minimization, merge-point centering, zigzag for long linear chains). '
            + 'ALWAYS call this after any batch of add_node/create_edge/delete_node calls that changes the funnel structure — never hand-pick x/y coordinates. Safe to re-run any time; positions-only, no logic changes.',
        inputSchema: {
            type: 'object',
            properties: { botId: { type: 'string' } },
            required: ['botId'],
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
    // ── Project management ────────────────────────────────────────────────────
    {
        name: 'list_projects',
        description: 'List all projects on the platform with their bot counts',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'create_project',
        description: 'Create a new project. Returns the new project object.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Display name of the project' },
                slug: { type: 'string', description: 'URL-safe slug (lowercase, hyphens). Auto-generated from name if omitted.' },
                description: { type: 'string', description: 'Optional project description' },
            },
            required: ['name'],
        },
    },
    {
        name: 'update_project',
        description: 'Update a project name, slug, or description',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Project UUID' },
                name: { type: 'string' },
                slug: { type: 'string' },
                description: { type: 'string' },
            },
            required: ['id'],
        },
    },
    {
        name: 'delete_project',
        description: 'Delete a project by id. Fails if the project still has bots — move or delete them first.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Project UUID' } },
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
    // ── Broadcasts ───────────────────────────────────────────────────────────
    {
        name: 'list_broadcasts',
        description: 'List recent broadcast campaigns with status and stats (sent/failed counts)',
        inputSchema: {
            type: 'object',
            properties: { limit: { type: 'number', description: 'Max results, default 20' } },
            required: [],
        },
    },
    {
        name: 'get_broadcast_subscribers',
        description: 'Get real (non-test) subscribers for a list of bot IDs. Returns telegramId, name, username, botId, isUnsubscribed flag.',
        inputSchema: {
            type: 'object',
            properties: {
                botIds: { type: 'array', items: { type: 'string' }, description: 'List of bot UUIDs to get subscribers from' },
            },
            required: ['botIds'],
        },
    },
    {
        name: 'create_broadcast',
        description: 'Create and queue a broadcast to subscribers of specified bots. Unsubscribed users are excluded by default.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Optional name for the broadcast' },
                botIds: { type: 'array', items: { type: 'string' }, description: 'Bot UUIDs whose subscribers receive the message' },
                message: {
                    type: 'object',
                    description: 'Message content',
                    properties: {
                        text: { type: 'string', description: 'Message text (Markdown)' },
                        photoUrl: { type: 'string', description: 'URL or Telegram file_id of photo (optional)' },
                        documentUrl: { type: 'string', description: 'URL or Telegram file_id of document (optional)' },
                        documentName: { type: 'string', description: 'Document filename for display' },
                        caption: { type: 'string', description: 'Caption for photo/document (if different from text)' },
                        parseMode: { type: 'string', enum: ['Markdown', 'HTML'], description: 'Parse mode, default Markdown' },
                    },
                },
                scheduledAt: { type: 'string', description: 'ISO datetime to schedule the broadcast. Omit for immediate send.' },
                includeUnsubscribed: { type: 'boolean', description: 'Include users who unsubscribed. Default: false.' },
            },
            required: ['botIds', 'message'],
        },
    },
    {
        name: 'cancel_broadcast',
        description: 'Cancel a scheduled broadcast (only possible while status is "scheduled")',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Broadcast UUID' } },
            required: ['id'],
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

async function autoLayout({ botId }) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) throw new Error(`No flow found for botId: ${botId}`);
    const nodes = computeAutoLayout(flow.nodes || [], flow.edges || []);
    await prisma.flowDefinition.update({ where: { botId }, data: { nodes } });
    return { relaidOut: nodes.length };
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

// ── Project CRUD ──────────────────────────────────────────────────────────

function slugifyProject(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9а-яіїєґ\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

async function listProjects() {
    const projects = await prisma.project.findMany({
        include: { _count: { select: { bots: true } } },
        orderBy: { name: 'asc' },
    });
    return projects.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description || null,
        botsCount: p._count.bots,
        createdAt: p.createdAt,
    }));
}

async function createProject({ name, slug, description }) {
    if (!name?.trim()) throw new Error('name is required');
    const finalSlug = (slug || slugifyProject(name)).trim();
    if (!finalSlug) throw new Error('slug cannot be empty');

    const existing = await prisma.project.findUnique({ where: { slug: finalSlug } });
    if (existing) throw new Error(`Project with slug "${finalSlug}" already exists (id: ${existing.id})`);

    const project = await prisma.project.create({
        data: {
            name: name.trim(),
            slug: finalSlug,
            description: description?.trim() || null,
        },
    });
    return { id: project.id, name: project.name, slug: project.slug, description: project.description };
}

async function updateProject({ id, name, slug, description }) {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) throw new Error(`Project not found: ${id}`);

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (slug !== undefined) {
        const trimmed = slug.trim();
        if (!trimmed) throw new Error('slug cannot be empty');
        data.slug = trimmed;
    }
    if (description !== undefined) data.description = description?.trim() || null;

    if (!Object.keys(data).length) throw new Error('No fields to update');

    const updated = await prisma.project.update({ where: { id }, data });
    return { id: updated.id, name: updated.name, slug: updated.slug, description: updated.description };
}

async function deleteProject({ id }) {
    const project = await prisma.project.findUnique({
        where: { id },
        include: { _count: { select: { bots: true } } },
    });
    if (!project) throw new Error(`Project not found: ${id}`);
    if (project._count.bots > 0) {
        throw new Error(`Cannot delete project "${project.name}" — it still has ${project._count.bots} bot(s). Move or delete them first.`);
    }
    await prisma.project.delete({ where: { id } });
    return { deleted: id, name: project.name };
}

// ── Broadcasts ───────────────────────────────────────────────────────────────

async function listBroadcasts({ limit = 20 } = {}) {
    const broadcasts = await prisma.broadcast.findMany({
        orderBy: { createdAt: 'desc' },
        take: Number(limit) || 20,
        select: { id: true, name: true, status: true, scheduledAt: true, sentAt: true, stats: true, createdAt: true },
    });
    return broadcasts.map(b => ({
        id: b.id,
        name: b.name || null,
        status: b.status,
        scheduledAt: b.scheduledAt,
        sentAt: b.sentAt,
        stats: b.stats,
        createdAt: b.createdAt,
    }));
}

async function getBroadcastSubscribers({ botIds = [] } = {}) {
    if (!botIds.length) return [];
    const sessions = await prisma.session.findMany({
        where: {
            botId: { in: botIds },
            isTest: false,
            user: { telegramId: { not: null } },
        },
        orderBy: { lastActive: 'desc' },
        select: {
            botId: true,
            state: true,
            user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true } },
        },
    });
    const seen = new Set();
    const result = [];
    for (const s of sessions) {
        const key = String(s.user.telegramId);
        if (!seen.has(key)) {
            seen.add(key);
            result.push({
                userId: s.user.id,
                telegramId: String(s.user.telegramId),
                firstName: s.user.firstName || '',
                username: s.user.username || '',
                botId: s.botId,
                isUnsubscribed: s.state === 'unsubscribed',
            });
        }
    }
    return result;
}

async function createBroadcastMcp({ name, botIds = [], message = {}, scheduledAt, includeUnsubscribed = false }) {
    if (!botIds.length) throw new Error('botIds is required');
    if (!message.text && !message.photoUrl && !message.documentUrl) {
        throw new Error('message must have text, photoUrl, or documentUrl');
    }

    // Get subscribers
    const allSubs = await getBroadcastSubscribers({ botIds });
    const recipients = includeUnsubscribed ? allSubs : allSubs.filter(s => !s.isUnsubscribed);
    if (!recipients.length) throw new Error('No eligible recipients found');

    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();
    const status = isScheduled ? 'scheduled' : 'sending';

    const broadcast = await prisma.broadcast.create({
        data: {
            name: name || null,
            status,
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
            message,
            recipients,
            stats: { total: recipients.length, sent: 0, failed: 0 },
        },
    });

    // Enqueue via Bull
    const Bull = require('bull');
    const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    const broadcastQueue = new Bull('broadcasts', REDIS_URL);
    const delay = isScheduled ? Math.max(0, new Date(scheduledAt).getTime() - Date.now()) : 0;
    await broadcastQueue.add({ broadcastId: broadcast.id }, { delay, attempts: 2 });
    await broadcastQueue.close();

    return {
        id: broadcast.id,
        name: broadcast.name,
        status: broadcast.status,
        scheduledAt: broadcast.scheduledAt,
        recipientCount: recipients.length,
        stats: broadcast.stats,
    };
}

async function cancelBroadcastMcp({ id }) {
    const bc = await prisma.broadcast.findUnique({ where: { id } });
    if (!bc) throw new Error(`Broadcast not found: ${id}`);
    if (bc.status !== 'scheduled') throw new Error(`Cannot cancel broadcast with status "${bc.status}"`);
    await prisma.broadcast.update({ where: { id }, data: { status: 'cancelled' } });
    return { cancelled: id, name: bc.name };
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
        case 'auto_layout': return autoLayout(args);
        case 'update_funnel_key': return updateFunnelKey(args);
        case 'delete_funnel_key': return deleteFunnelKey(args);
        case 'list_connectors': return listConnectors();
        case 'get_connector': return getConnector(args);
        case 'create_connector': return createConnector(args);
        case 'update_connector': return updateConnector(args);
        case 'delete_connector': return deleteConnector(args);
        case 'get_node_stats': return getNodeStats(args);
        case 'get_api_logs': return getApiLogs(args);
        // Projects
        case 'list_projects': return listProjects();
        case 'create_project': return createProject(args);
        case 'update_project': return updateProject(args);
        case 'delete_project': return deleteProject(args);
        // Broadcasts
        case 'list_broadcasts': return listBroadcasts(args);
        case 'get_broadcast_subscribers': return getBroadcastSubscribers(args);
        case 'create_broadcast': return createBroadcastMcp(args);
        case 'cancel_broadcast': return cancelBroadcastMcp(args);
        default: throw new Error(`Unknown tool: ${name}`);
    }
}

async function disconnect() {
    await prisma.$disconnect();
}

module.exports = { TOOLS, callTool, disconnect, safeJsonStringify };
