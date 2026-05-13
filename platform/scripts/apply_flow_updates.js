const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const FILE_TYPE_TO_CONTEXT_VAR = {
    cashflow_articles: 'cashflowArticles',
    pl_articles: 'plArticles',
    business_process: 'businessProcess',
    business_process_v2: 'businessProcessV2',
    cashflow_table_url: 'sheetsUrl',
    combined_table_url: 'combinedUrl',
    financial_mechanics: 'financialMechanics',
    salary_processes: 'salaryProcesses',
    payment_processes: 'paymentProcesses',
    balance_articles: 'balanceArticles',
    balance_table_url: 'balanceUrl',
    payment_calendar_url: 'calendarUrl',
    team_instructions: 'teamInstructions',
};

const BOT_LOADFILE_CONFIG = [
    { idPrefix: 'ef42640d', slug: 'bot-2-2-cashflow-table', fileTypes: ['cashflow_articles'] },
    { idPrefix: 'c1b1103d', slug: 'bot-2-3-payment-calendar', fileTypes: ['cashflow_articles'] },
    { idPrefix: '6adc79da', slug: 'bot-3-2-pl-table', fileTypes: ['pl_articles', 'cashflow_table_url'] },
    { idPrefix: 'bd796da5', slug: 'bot-3-3-diagnostics', fileTypes: ['cashflow_articles', 'pl_articles', 'business_process'] },
    { idPrefix: '0062e7e3', slug: 'bot-4-1-process-update', fileTypes: ['business_process', 'cashflow_articles', 'pl_articles'] },
    { idPrefix: '15b79289', slug: 'bot-4-2-salaries', fileTypes: ['financial_mechanics', 'business_process'] },
    { idPrefix: '26c78700', slug: 'bot-4-3-payments', fileTypes: ['cashflow_articles'] },
    { idPrefix: 'a99faa7c', slug: 'bot-4-4-combined-table', fileTypes: ['salary_processes', 'payment_processes', 'cashflow_table_url'] },
    { idPrefix: '907b31e9', slug: 'bot-4-5-team-instructions', fileTypes: ['business_process_v2', 'cashflow_articles', 'pl_articles', 'salary_processes', 'payment_processes'] },
    { idPrefix: '69da1d5f', slug: 'bot-5-1-balance-articles', fileTypes: ['cashflow_articles', 'pl_articles', 'business_process'] },
    { idPrefix: '8bb47937', slug: 'bot-5-2-balance-table', fileTypes: ['balance_articles', 'combined_table_url'] },
    { idPrefix: 'e50af81c', slug: 'bot-5-3-balance-process', fileTypes: ['balance_articles', 'business_process_v2'] },
];

function edgeExists(edges, source, target) {
    return edges.some((e) => e.source === source && e.target === target);
}

function ensureEdge(edges, source, target, idPrefix) {
    if (!edgeExists(edges, source, target)) {
        edges.push({ id: `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, source, target });
    }
}

async function findBot(config) {
    const byPrefix = await prisma.bot.findFirst({
        where: {
            project: { slug: 'finance-course' },
            id: { startsWith: config.idPrefix },
        },
    });

    if (byPrefix) return byPrefix;

    return prisma.bot.findFirst({
        where: {
            project: { slug: 'finance-course' },
            slug: config.slug,
        },
    });
}

function findStartNode(nodes) {
    return nodes.find((n) => n.id === 'start_1') || nodes.find((n) => n.type === 'start');
}

function findIntroNode(nodes, edges, startId) {
    const explicit = nodes.find((n) => n.id === 'msg_intro' || (typeof n.id === 'string' && n.id.includes('msg_intro')));
    if (explicit) return explicit;

    const out = edges.find((e) => e.source === startId);
    if (!out) return null;
    return nodes.find((n) => n.id === out.target) || null;
}

function ensureLoadFileNode(nodes, fileType, startNode, index) {
    const existing = nodes.find((n) => n.type === 'loadFile' && n?.data?.fileType === fileType);
    if (existing) {
        return existing.id;
    }

    const outputVar = `context.${FILE_TYPE_TO_CONTEXT_VAR[fileType]}`;
    const nodeId = `loadfile_${fileType}`;

    nodes.push({
        id: nodeId,
        type: 'loadFile',
        position: {
            x: (startNode.position?.x || 0) + 260 + index * 260,
            y: startNode.position?.y || 0,
        },
        data: {
            label: `Load ${fileType}`,
            fileType,
            outputVar,
            onMissing: 'skip',
        },
    });

    return nodeId;
}

async function applyLoadFileForBot(config) {
    const bot = await findBot(config);
    if (!bot) {
        console.log(`SKIP: bot not found for prefix ${config.idPrefix} (${config.slug})`);
        return;
    }

    const flow = await prisma.flowDefinition.findUnique({ where: { botId: bot.id } });
    if (!flow) {
        console.log(`SKIP: flow not found for ${bot.slug} (${bot.id})`);
        return;
    }

    const nodes = Array.isArray(flow.nodes) ? [...flow.nodes] : [];
    const edges = Array.isArray(flow.edges) ? [...flow.edges] : [];

    const startNode = findStartNode(nodes);
    if (!startNode) {
        console.log(`SKIP: start node not found for ${bot.slug} (${bot.id})`);
        return;
    }

    const introNode = findIntroNode(nodes, edges, startNode.id);
    if (!introNode) {
        console.log(`SKIP: intro node not found for ${bot.slug} (${bot.id})`);
        return;
    }

    const chainNodeIds = config.fileTypes.map((ft, idx) => ensureLoadFileNode(nodes, ft, startNode, idx));

    const filteredEdges = edges.filter((e) => {
        if (e.source === startNode.id && (e.target === introNode.id || chainNodeIds.includes(e.target))) return false;
        if (chainNodeIds.includes(e.source) && (e.target === introNode.id || chainNodeIds.includes(e.target))) return false;
        return true;
    });

    const updatedEdges = [...filteredEdges];
    if (chainNodeIds.length > 0) {
        ensureEdge(updatedEdges, startNode.id, chainNodeIds[0], 'edge_start_load');
        for (let i = 0; i < chainNodeIds.length - 1; i += 1) {
            ensureEdge(updatedEdges, chainNodeIds[i], chainNodeIds[i + 1], 'edge_load_load');
        }
        ensureEdge(updatedEdges, chainNodeIds[chainNodeIds.length - 1], introNode.id, 'edge_load_intro');
    }

    await prisma.flowDefinition.update({
        where: { botId: bot.id },
        data: { nodes, edges: updatedEdges },
    });

    console.log(`OK: ${bot.slug} (${bot.id}) -> inserted ${config.fileTypes.length} loadFile nodes`);
}

async function fixBot21EdgeRouting() {
    const botId = 'f4bd6571-e386-4a36-a086-ff631c3d77e4';
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });

    if (!flow) {
        console.log(`SKIP: flow not found for botId ${botId}`);
        return;
    }

    const nodes = Array.isArray(flow.nodes) ? [...flow.nodes] : [];
    const edges = Array.isArray(flow.edges) ? [...flow.edges] : [];

    const saveResultIndex = nodes.findIndex((n) => n.id === 'save_result');
    const plSaveIndex = nodes.findIndex((n) => n.id === 'node_1778531261129');

    if (saveResultIndex < 0 || plSaveIndex < 0) {
        console.log(`SKIP: required saveFile nodes not found for botId ${botId}`);
        return;
    }

    nodes[saveResultIndex] = {
        ...nodes[saveResultIndex],
        data: {
            ...(nodes[saveResultIndex].data || {}),
            fileType: 'cashflow_articles',
        },
    };

    nodes[plSaveIndex] = {
        ...nodes[plSaveIndex],
        data: {
            ...(nodes[plSaveIndex].data || {}),
            fileType: 'pl_articles',
        },
    };

    const filtered = edges.filter((e) => {
        if (e.source === 'claude_main' && e.target === 'msg_done') return false;
        if (e.source === 'save_result' && e.target === 'msg_done') return false;
        return true;
    });

    ensureEdge(filtered, 'claude_main', 'save_result', 'edge_claude_save');
    ensureEdge(filtered, 'save_result', 'node_1778531261129', 'edge_save_pl');
    ensureEdge(filtered, 'node_1778531261129', 'msg_done', 'edge_pl_done');

    await prisma.flowDefinition.update({
        where: { botId },
        data: { nodes, edges: filtered },
    });

    console.log(`OK: fixed routing for botId ${botId}`);
}

async function main() {
    console.log('Applying flow updates...');

    for (const config of BOT_LOADFILE_CONFIG) {
        // eslint-disable-next-line no-await-in-loop
        await applyLoadFileForBot(config);
    }

    await fixBot21EdgeRouting();

    console.log('Done.');
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
