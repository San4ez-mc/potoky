'use strict';

const { PrismaClient } = require('@prisma/client');
const {
    startTestSession,
    sendTestMessage,
    getTestSessionState,
    endTestSession,
} = require('../../api/src/services/testSession');

const prisma = new PrismaClient();

function safeJsonStringify(value) {
    return JSON.stringify(value, (_, current) => (typeof current === 'bigint' ? current.toString() : current), 2);
}

const TOOLS = [
    {
        name: 'get_session_logs',
        description: 'Get recent sessions list with message history and API calls for debugging',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                userId: { type: 'string' },
                isActive: { type: 'boolean' },
                limit: { type: 'number' },
                page: { type: 'number' },
            },
            required: [],
        },
    },
    {
        name: 'get_session',
        description: 'Get a single session with bot and user details',
        inputSchema: {
            type: 'object',
            properties: { sessionId: { type: 'string' } },
            required: ['sessionId'],
        },
    },
    {
        name: 'get_session_messages',
        description: 'Get messages from session — all messages for a session',
        inputSchema: {
            type: 'object',
            properties: { sessionId: { type: 'string' } },
            required: ['sessionId'],
        },
    },
    {
        name: 'get_session_api_calls',
        description: 'Get api calls from session — all API calls for a session',
        inputSchema: {
            type: 'object',
            properties: { sessionId: { type: 'string' } },
            required: ['sessionId'],
        },
    },
    {
        name: 'get_session_context',
        description: 'Get context of session — load context variables derived from files saved in previous sessions',
        inputSchema: {
            type: 'object',
            properties: { sessionId: { type: 'string' } },
            required: ['sessionId'],
        },
    },
    {
        name: 'get_errors',
        description: 'Get bot errors log — get application errors with stack traces and resolution status',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                resolved: { type: 'boolean' },
                limit: { type: 'number' },
                page: { type: 'number' },
            },
            required: [],
        },
    },
    {
        name: 'start_test_session',
        description: 'Start test session for bot testing — start a simulated Telegram test session for a bot',
        inputSchema: {
            type: 'object',
            properties: {
                botId: { type: 'string' },
                botSlug: { type: 'string' },
                userId: { type: 'string' },
                contextOverride: {
                    type: 'object',
                    description: 'Optional context variables preloaded into flow test runtime (keys with or without context. prefix)',
                    additionalProperties: true,
                },
            },
            required: [],
        },
    },
    {
        name: 'send_test_message',
        description: 'Send message to test session — send a message into an existing simulated test session',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                message: { type: 'string' },
            },
            required: ['sessionId', 'message'],
        },
    },
    {
        name: 'get_test_session_state',
        description: 'Get state of test session — get current state, context and history of a simulated test session',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
            },
            required: ['sessionId'],
        },
    },
    {
        name: 'end_test_session',
        description: 'End close test session — finish a simulated test session and return summary',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
            },
            required: ['sessionId'],
        },
    },
];

async function getSessionLogs({ botId, userId, isActive, limit = 20, page = 0 }) {
    const where = {};
    if (botId) where.botId = botId;
    if (userId) where.userId = userId;
    if (typeof isActive === 'boolean') where.isActive = isActive;

    const sessions = await prisma.session.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: Math.min(limit, 50),
        skip: Math.max(page, 0) * Math.min(limit, 50),
        include: {
            user: { select: { id: true, firstName: true, username: true, telegramId: true } },
            bot: { select: { id: true, name: true, slug: true } },
            messages: { orderBy: { createdAt: 'asc' }, take: 100 },
            apiCalls: { orderBy: { createdAt: 'asc' }, take: 100 },
        },
    });

    return sessions;
}

async function getSession({ sessionId }) {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { user: true, bot: true },
    });
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
}

async function getSessionMessages({ sessionId }) {
    return prisma.message.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
}

async function getSessionApiCalls({ sessionId }) {
    return prisma.apiCall.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
}

async function getSessionContext({ sessionId }) {
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true } });
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const files = await prisma.file.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: 'desc' },
    });

    const fileTypeToContextVar = {
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
        user_onboarding_data: 'onboarding_result',
    };

    const context = {};
    const seenTypes = new Set();
    for (const file of files) {
        if (seenTypes.has(file.fileType)) continue;
        seenTypes.add(file.fileType);
        const contextVar = fileTypeToContextVar[file.fileType];
        if (contextVar) {
            context[contextVar] = {
                url: file.url,
                fileName: file.fileName,
                savedAt: file.createdAt,
                botId: file.botId,
            };
        }
    }

    return {
        sessionId,
        userId: session.userId,
        context,
        filesCount: files.length,
    };
}

async function getErrors({ botId, resolved, limit = 50, page = 0 }) {
    const where = {};
    if (botId) where.botId = botId;
    if (typeof resolved === 'boolean') where.resolved = resolved;

    return prisma.appError.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        skip: Math.max(page, 0) * Math.min(limit, 100),
        include: {
            bot: { select: { name: true, slug: true } },
            user: { select: { firstName: true, username: true } },
        },
    });
}

async function callTool(name, args = {}) {
    switch (name) {
        case 'get_session_logs': return getSessionLogs(args);
        case 'get_session': return getSession(args);
        case 'get_session_messages': return getSessionMessages(args);
        case 'get_session_api_calls': return getSessionApiCalls(args);
        case 'get_session_context': return getSessionContext(args);
        case 'get_errors': return getErrors(args);
        case 'start_test_session': return startTestSession(args);
        case 'send_test_message': return sendTestMessage(args);
        case 'get_test_session_state': return getTestSessionState(args);
        case 'end_test_session': return endTestSession(args);
        default: throw new Error(`Unknown tool: ${name}`);
    }
}

async function disconnect() {
    await prisma.$disconnect();
}

module.exports = { TOOLS, callTool, disconnect, safeJsonStringify };
