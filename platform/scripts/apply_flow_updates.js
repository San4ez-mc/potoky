'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ONBOARDING_LOADFILE_CONFIG = [
    { idPrefix: '6adc79da', slug: 'bot-3-2-pl-table', afterNodeId: 'loadfile_pl_articles' },
    { idPrefix: 'bd796da5', slug: 'bot-3-3-diagnostics', afterNodeId: 'loadfile_pl_articles' },
    { idPrefix: '0062e7e3', slug: 'bot-4-1-process-update', afterNodeId: 'loadfile_pl_articles' },
    { idPrefix: '15b79289', slug: 'bot-4-2-salaries', afterNodeId: 'loadfile_business_process' },
    { idPrefix: '26c78700', slug: 'bot-4-3-payments', afterNodeId: 'loadfile_cashflow_articles' },
    { idPrefix: 'a99faa7c', slug: 'bot-4-4-combined-table', afterNodeId: 'loadfile_cashflow_table_url' },
    { idPrefix: '907b31e9', slug: 'bot-4-5-team-instructions', afterNodeId: 'loadfile_pl_articles' },
    { idPrefix: '69da1d5f', slug: 'bot-5-1-balance-articles', afterNodeId: 'loadfile_business_process' },
    { idPrefix: '8bb47937', slug: 'bot-5-2-balance-table', afterNodeId: 'loadfile_combined_table_url' },
    { idPrefix: 'e50af81c', slug: 'bot-5-3-balance-process', afterNodeId: 'loadfile_business_process_v2' },
];

const GENERATED_DOC_CONFIG = [
    { idPrefix: 'bd796da5', slug: 'bot-3-3-diagnostics', template: 'financial_diagnostics', sourceVar: 'context.mechanics_md' },
    { idPrefix: '0062e7e3', slug: 'bot-4-1-process-update', template: 'business_process_v2', sourceVar: 'context.process_v2_md' },
    { idPrefix: '15b79289', slug: 'bot-4-2-salaries', template: 'salary_processes', sourceVar: 'context.salary_md' },
    { idPrefix: '26c78700', slug: 'bot-4-3-payments', template: 'payment_processes', sourceVar: 'context.payments_md' },
    { idPrefix: '907b31e9', slug: 'bot-4-5-team-instructions', template: 'team_instructions', sourceVar: 'context.instructions_md' },
    { idPrefix: '69da1d5f', slug: 'bot-5-1-balance-articles', template: 'balance_articles', sourceVar: 'context.balance_articles_md' },
    { idPrefix: 'e50af81c', slug: 'bot-5-3-balance-process', template: 'balance_process_guide', sourceVar: 'context.balance_process_md' },
];

const BOT_43 = { idPrefix: '26c78700', slug: 'bot-4-3-payments' };
const BOT_44 = { idPrefix: 'a99faa7c', slug: 'bot-4-4-combined-table' };
const BOT_52 = { idPrefix: '8bb47937', slug: 'bot-5-2-balance-table' };

function edgeExists(edges, source, target) {
    return edges.some((edge) => edge.source === source && edge.target === target);
}

function ensureEdge(edges, source, target, idPrefix) {
    if (!source || !target) return;
    if (!edgeExists(edges, source, target)) {
        edges.push({ id: `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, source, target });
    }
}

function removeEdge(edges, source, target) {
    return edges.filter((edge) => !(edge.source === source && edge.target === target));
}

function removeEdgesForNode(edges, nodeId) {
    return edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
}

function findNodeById(nodes, nodeId) {
    return nodes.find((node) => node.id === nodeId) || null;
}

function findNodeByFileType(nodes, fileType) {
    return nodes.find((node) => node.type === 'loadFile' && node?.data?.fileType === fileType) || null;
}

function getIncomingEdges(edges, target) {
    return edges.filter((edge) => edge.target === target);
}

function findFirstLoadFileBeforeIntro(nodes, edges, introNodeId) {
    const incomingToIntro = getIncomingEdges(edges, introNodeId);
    if (!incomingToIntro.length) return null;

    let currentNode = findNodeById(nodes, incomingToIntro[0].source);
    if (!currentNode || currentNode.type !== 'loadFile') return null;

    while (currentNode) {
        const incomingToCurrent = getIncomingEdges(edges, currentNode.id);
        const previousLoad = incomingToCurrent
            .map((edge) => findNodeById(nodes, edge.source))
            .find((node) => node && node.type === 'loadFile');

        if (!previousLoad) {
            return currentNode;
        }

        currentNode = previousLoad;
    }

    return null;
}

function findIntroNode(nodes) {
    return nodes.find((node) => node.id === 'msg_intro' || (typeof node.id === 'string' && node.id.includes('msg_intro'))) || null;
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

async function loadFlowByBotConfig(config) {
    const bot = await findBot(config);
    if (!bot) {
        console.log(`SKIP: bot not found for prefix ${config.idPrefix} (${config.slug})`);
        return null;
    }

    const flow = await prisma.flowDefinition.findUnique({ where: { botId: bot.id } });
    if (!flow) {
        console.log(`SKIP: flow not found for ${bot.slug} (${bot.id})`);
        return null;
    }

    return {
        bot,
        flow,
        nodes: Array.isArray(flow.nodes) ? [...flow.nodes] : [],
        edges: Array.isArray(flow.edges) ? [...flow.edges] : [],
    };
}

function ensureOnboardingLoadFileNode(nodes, anchorNode) {
    const existing = nodes.find((node) => node.id === 'loadfile_user_onboarding_data')
        || nodes.find((node) => node.type === 'loadFile' && node?.data?.fileType === 'user_onboarding_data');

    const node = {
        id: existing?.id || 'loadfile_user_onboarding_data',
        type: 'loadFile',
        position: {
            x: (anchorNode?.position?.x || 0) + 260,
            y: anchorNode?.position?.y || 0,
        },
        data: {
            ...(existing?.data || {}),
            label: 'loadFile — онбординг',
            fileType: 'user_onboarding_data',
            outputVar: 'context.onboarding_result',
            onMissing: 'skip',
        },
    };

    if (!existing) {
        nodes.push(node);
        return node.id;
    }

    const idx = nodes.findIndex((item) => item.id === existing.id);
    nodes[idx] = { ...nodes[idx], ...node, data: node.data };
    return existing.id;
}

async function applyOnboardingLoadFile(config) {
    const loaded = await loadFlowByBotConfig(config);
    if (!loaded) return;

    const { bot, nodes } = loaded;
    let { edges } = loaded;

    const fromNode = findNodeById(nodes, config.afterNodeId);
    const introNode = findIntroNode(nodes);

    if (!introNode) {
        console.log(`SKIP: msg_intro not found for ${bot.slug} (${bot.id})`);
        return;
    }

    const onboardingNodeId = ensureOnboardingLoadFileNode(nodes, fromNode);
    edges = removeEdgesForNode(edges, onboardingNodeId);

    const firstLoadNode = findFirstLoadFileBeforeIntro(nodes, edges, introNode.id);

    if (firstLoadNode && firstLoadNode.id !== onboardingNodeId) {
        const incomingToFirst = getIncomingEdges(edges, firstLoadNode.id).filter((edge) => edge.source !== onboardingNodeId);

        for (const edge of incomingToFirst) {
            edges = removeEdge(edges, edge.source, firstLoadNode.id);
            ensureEdge(edges, edge.source, onboardingNodeId, 'edge_onboarding_from');
        }

        ensureEdge(edges, onboardingNodeId, firstLoadNode.id, 'edge_onboarding_to_first_load');
    } else if (fromNode) {
        edges = removeEdge(edges, fromNode.id, introNode.id);
        ensureEdge(edges, fromNode.id, onboardingNodeId, 'edge_onboarding_from');
        ensureEdge(edges, onboardingNodeId, introNode.id, 'edge_onboarding_to_intro');
    } else {
        const incomingToIntro = getIncomingEdges(edges, introNode.id);
        for (const edge of incomingToIntro) {
            edges = removeEdge(edges, edge.source, introNode.id);
            ensureEdge(edges, edge.source, onboardingNodeId, 'edge_onboarding_from_intro_in');
        }
        ensureEdge(edges, onboardingNodeId, introNode.id, 'edge_onboarding_to_intro_fallback');
    }

    await prisma.flowDefinition.update({
        where: { botId: bot.id },
        data: { nodes, edges },
    });

    console.log(`OK: ${bot.slug} (${bot.id}) -> onboarding loadFile inserted`);
}

function ensureGenerateDocumentNode(nodes, saveResultNode, config) {
    const existing = nodes.find((node) => node.id === 'generate_document')
        || nodes.find((node) => node.type === 'generateDocument');

    const node = {
        id: existing?.id || 'generate_document',
        type: 'generateDocument',
        position: {
            x: (saveResultNode?.position?.x || 0) + 260,
            y: saveResultNode?.position?.y || 0,
        },
        data: {
            ...(existing?.data || {}),
            label: 'Generate DOCX',
            template: config.template,
            sourceVar: config.sourceVar,
            filename: '{{user.firstName}}_{{bot.slug}}.docx',
            sendToUser: true,
        },
    };

    if (!existing) {
        nodes.push(node);
        return node.id;
    }

    const idx = nodes.findIndex((item) => item.id === existing.id);
    nodes[idx] = { ...nodes[idx], ...node, data: node.data };
    return existing.id;
}

async function applyGenerateDocument(config) {
    const loaded = await loadFlowByBotConfig(config);
    if (!loaded) return;

    const { bot, nodes } = loaded;
    let { edges } = loaded;

    const saveResultNode = findNodeById(nodes, 'save_result');
    const doneNode = findNodeById(nodes, 'msg_done');

    if (!saveResultNode || !doneNode) {
        console.log(`SKIP: save_result/msg_done not found for ${bot.slug} (${bot.id})`);
        return;
    }

    const generateNodeId = ensureGenerateDocumentNode(nodes, saveResultNode, config);

    edges = removeEdge(edges, saveResultNode.id, doneNode.id);
    ensureEdge(edges, saveResultNode.id, generateNodeId, 'edge_save_generate');
    ensureEdge(edges, generateNodeId, doneNode.id, 'edge_generate_done');

    await prisma.flowDefinition.update({
        where: { botId: bot.id },
        data: { nodes, edges },
    });

    console.log(`OK: ${bot.slug} (${bot.id}) -> generateDocument inserted`);
}

function ensureBusinessProcessLoadNode(nodes, anchorNode) {
    const existing = nodes.find((node) => node.id === 'loadfile_business_process')
        || nodes.find((node) => node.type === 'loadFile' && node?.data?.fileType === 'business_process');

    const node = {
        id: existing?.id || 'loadfile_business_process',
        type: 'loadFile',
        position: {
            x: (anchorNode?.position?.x || 0) + 180,
            y: (anchorNode?.position?.y || 0) + 120,
        },
        data: {
            ...(existing?.data || {}),
            label: 'loadFile — business_process',
            fileType: 'business_process',
            outputVar: 'context.businessProcess',
            onMissing: 'skip',
        },
    };

    if (!existing) {
        nodes.push(node);
        return node.id;
    }

    const idx = nodes.findIndex((item) => item.id === existing.id);
    nodes[idx] = { ...nodes[idx], ...node, data: node.data };
    return existing.id;
}

async function applyBot43BusinessProcessLoad() {
    const loaded = await loadFlowByBotConfig(BOT_43);
    if (!loaded) return;

    const { bot, nodes } = loaded;
    let { edges } = loaded;

    const cashflowNode = findNodeById(nodes, 'loadfile_cashflow_articles');
    const onboardingNode = nodes.find((node) => node.id === 'loadfile_user_onboarding_data')
        || nodes.find((node) => node.type === 'loadFile' && node?.data?.fileType === 'user_onboarding_data');

    if (!cashflowNode || !onboardingNode) {
        console.log(`SKIP: bot 4.3 chain nodes not found (${bot.id})`);
        return;
    }

    const businessNodeId = ensureBusinessProcessLoadNode(nodes, cashflowNode);

    edges = removeEdge(edges, cashflowNode.id, onboardingNode.id);
    ensureEdge(edges, cashflowNode.id, businessNodeId, 'edge_cashflow_business');
    ensureEdge(edges, businessNodeId, onboardingNode.id, 'edge_business_onboarding');

    await prisma.flowDefinition.update({
        where: { botId: bot.id },
        data: { nodes, edges },
    });

    console.log(`OK: ${bot.slug} (${bot.id}) -> business_process loadFile inserted`);
}

function ensureSheetsIdParserNode(nodes, anchorNode) {
    const existing = nodes.find((node) => node.id === 'js_extract_combined_sheets_id');

    const code = [
        "const url = context.sheetsUrl || context.combinedUrl;",
        'if (url) {',
        "    const match = url.match(/spreadsheets\\/d\\/([a-zA-Z0-9-_]+)/);",
        "    context.sheetsId = match ? match[1] : null;",
        "    context.combinedSheetsId = context.sheetsId;",
        '}',
        'return { context };',
    ].join('\n');

    const node = {
        id: existing?.id || 'js_extract_combined_sheets_id',
        type: 'js',
        position: {
            x: (anchorNode?.position?.x || 0) + 240,
            y: anchorNode?.position?.y || 0,
        },
        data: {
            ...(existing?.data || {}),
            label: 'Parse combinedSheetsId',
            code,
        },
    };

    if (!existing) {
        nodes.push(node);
        return node.id;
    }

    const idx = nodes.findIndex((item) => item.id === existing.id);
    nodes[idx] = { ...nodes[idx], ...node, data: node.data };
    return existing.id;
}

async function applyBot52CombinedSheetsIdFix() {
    const loaded = await loadFlowByBotConfig(BOT_52);
    if (!loaded) return;

    const { bot, nodes } = loaded;
    let { edges } = loaded;

    const combinedLoadNode = findNodeById(nodes, 'loadfile_combined_table_url')
        || findNodeById(nodes, 'loadfile_cashflow_table_url')
        || findNodeByFileType(nodes, 'cashflow_table_url')
        || findNodeByFileType(nodes, 'combined_table_url');
    const introNode = findIntroNode(nodes);

    if (!combinedLoadNode || !introNode) {
        console.log(`SKIP: bot 5.2 required nodes not found (${bot.id})`);
        return;
    }

    const parserNodeId = ensureSheetsIdParserNode(nodes, combinedLoadNode);

    edges = removeEdge(edges, combinedLoadNode.id, introNode.id);
    ensureEdge(edges, combinedLoadNode.id, parserNodeId, 'edge_combined_parser');
    ensureEdge(edges, parserNodeId, introNode.id, 'edge_parser_intro');

    await prisma.flowDefinition.update({
        where: { botId: bot.id },
        data: { nodes, edges },
    });

    console.log(`OK: ${bot.slug} (${bot.id}) -> combinedSheetsId parser inserted`);
}

async function applyBot44FileTypeUnification() {
    const loaded = await loadFlowByBotConfig(BOT_44);
    if (!loaded) return;

    const { bot, nodes, edges } = loaded;

    let changed = false;
    const updatedNodes = nodes.map((node) => {
        if (node.type !== 'saveFile') return node;
        if (node?.data?.fileType !== 'combined_table_url') return node;
        changed = true;
        return {
            ...node,
            data: {
                ...(node.data || {}),
                fileType: 'cashflow_table_url',
            },
        };
    });

    if (!changed) {
        console.log(`SKIP: bot 4.4 saveFile with combined_table_url not found (${bot.id})`);
        return;
    }

    await prisma.flowDefinition.update({
        where: { botId: bot.id },
        data: { nodes: updatedNodes, edges },
    });

    console.log(`OK: ${bot.slug} (${bot.id}) -> saveFile fileType unified to cashflow_table_url`);
}

async function main() {
    console.log('Applying flow updates v15...');

    for (const config of ONBOARDING_LOADFILE_CONFIG) {
        // eslint-disable-next-line no-await-in-loop
        await applyOnboardingLoadFile(config);
    }

    await applyBot43BusinessProcessLoad();

    for (const config of GENERATED_DOC_CONFIG) {
        // eslint-disable-next-line no-await-in-loop
        await applyGenerateDocument(config);
    }

    await applyBot52CombinedSheetsIdFix();
    await applyBot44FileTypeUnification();

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
