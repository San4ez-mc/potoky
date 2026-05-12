'use strict';

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_BASE_URL || 'https://flows.fineko.space';
const MCP_SECRET = process.env.TEST_MCP_SECRET || process.env.MCP_SECRET || '';
const API_SECRET = process.env.TEST_API_SECRET || process.env.API_SECRET || '';

function ensure(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function postJson(url, body, headers = {}) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
    const data = await response.json();
    return { status: response.status, data };
}

async function getJson(url, headers = {}) {
    const response = await fetch(url, { headers });
    const data = await response.json();
    return { status: response.status, data };
}

async function callMcpTool(name, args = {}) {
    ensure(MCP_SECRET, 'MCP secret is missing');
    const body = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
            name,
            arguments: args,
        },
    };

    const { data } = await postJson(`${BASE_URL}/mcp`, body, {
        Authorization: `Bearer ${MCP_SECRET}`,
    });

    if (data.error) {
        throw new Error(`${name} failed: ${data.error.message}`);
    }

    return JSON.parse(data.result.content[0].text);
}

async function mcpToolsList() {
    ensure(MCP_SECRET, 'MCP secret is missing');
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const { data } = await postJson(`${BASE_URL}/mcp`, body, {
        Authorization: `Bearer ${MCP_SECRET}`,
    });
    if (data.error) throw new Error(data.error.message);
    return data.result.tools.map((tool) => tool.name);
}

async function api(method, endpoint, body) {
    ensure(API_SECRET, 'API secret is missing');
    const url = `${BASE_URL}/api${endpoint}`;
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'x-api-secret': API_SECRET,
        },
    };
    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const payload = await response.json();
    if (!payload.ok) {
        throw new Error(`${method} ${endpoint} failed: ${payload.error?.message || 'request failed'}`);
    }
    return payload.data;
}

async function runForBot(bot) {
    const result = {
        bot: { id: bot.id, name: bot.name, slug: bot.slug },
        ok: true,
        checks: {},
        errors: [],
    };

    let sessionId = null;

    try {
        const started = await callMcpTool('start_test_session', { botId: bot.id });
        sessionId = started.sessionId;
        result.checks.startTestSession = Boolean(sessionId);

        const sent = await callMcpTool('send_test_message', {
            sessionId,
            message: 'we provide accounting services for b2b companies',
        });
        result.checks.sendTestMessage = Boolean(sent.botResponse || sent.warning === null);

        const state = await callMcpTool('get_test_session_state', { sessionId });
        result.checks.getTestSessionState = Boolean(state.currentState) && Array.isArray(state.history);

        const messages = await callMcpTool('get_session_messages', { sessionId });
        result.checks.getSessionMessages = Array.isArray(messages) && messages.length > 0;

        const apiCalls = await callMcpTool('get_session_api_calls', { sessionId });
        result.checks.getSessionApiCalls = Array.isArray(apiCalls);

        const context = await callMcpTool('get_session_context', { sessionId });
        result.checks.getSessionContext = Boolean(context.sessionId);

        const logs = await callMcpTool('get_session_logs', { limit: 10 });
        result.checks.getSessionLogs = Array.isArray(logs) && logs.some((row) => row.id === sessionId);

        await callMcpTool('end_test_session', { sessionId });
        result.checks.endTestSession = true;
    } catch (error) {
        result.ok = false;
        result.errors.push(error.message);
        if (sessionId) {
            try {
                await callMcpTool('end_test_session', { sessionId });
            } catch (_ignored) {
                // noop
            }
        }
    }

    return result;
}

async function testFunnelCrud(bot) {
    const original = await api('GET', `/funnels/${bot.id}`);
    const originalNodes = original.flow?.nodes || [];
    const originalEdges = original.flow?.edges || [];
    const viewport = original.flow?.viewport || { x: 0, y: 0, zoom: 1 };

    const marker = `regression_${Date.now()}`;
    const testNode = {
        id: marker,
        type: 'message',
        position: { x: 120, y: 80 },
        data: { text: 'regression test node' },
    };

    const withNode = [...originalNodes, testNode];
    await api('PUT', `/funnels/${bot.id}`, { nodes: withNode, edges: originalEdges, viewport });

    const afterCreate = await api('GET', `/funnels/${bot.id}`);
    const created = (afterCreate.flow?.nodes || []).some((node) => node.id === marker);

    await api('PUT', `/funnels/${bot.id}`, { nodes: originalNodes, edges: originalEdges, viewport });

    const afterRollback = await api('GET', `/funnels/${bot.id}`);
    const removed = !(afterRollback.flow?.nodes || []).some((node) => node.id === marker);

    return { created, removed };
}

async function testWebhook(bot) {
    const update = {
        update_id: Date.now(),
        message: {
            message_id: Date.now(),
            from: {
                id: Math.floor(700000000 + Math.random() * 10000000),
                is_bot: false,
                first_name: 'Regression',
                username: `reg_${Date.now()}`,
                language_code: 'uk',
            },
            chat: {
                id: Math.floor(700000000 + Math.random() * 10000000),
                type: 'private',
            },
            date: Math.floor(Date.now() / 1000),
            text: `/start ${bot.slug}`,
        },
    };

    const headers = { 'Content-Type': 'application/json' };
    if (process.env.TEST_TELEGRAM_WEBHOOK_SECRET) {
        headers['x-telegram-bot-api-secret-token'] = process.env.TEST_TELEGRAM_WEBHOOK_SECRET;
    }

    const response = await fetch(`${BASE_URL}/webhook/telegram/${bot.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(update),
    });

    return {
        accepted: response.status === 200,
        secured: response.status === 403,
    };
}

async function main() {
    const report = {
        startedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        checks: {},
        perBot: [],
        errors: [],
    };

    try {
        const tools = await mcpToolsList();
        const required = [
            'list_funnels',
            'start_test_session',
            'send_test_message',
            'get_test_session_state',
            'end_test_session',
            'get_session_logs',
            'get_session_messages',
            'get_session_api_calls',
            'get_session_context',
            'get_api_logs',
            'get_errors',
        ];

        report.checks.mcpToolsPresent = required.every((name) => tools.includes(name));

        const funnels = await callMcpTool('list_funnels');
        const financeBots = funnels.filter((bot) => bot.project && bot.project.toLowerCase().includes('finance'));
        report.checks.financeBotsDetected = financeBots.length > 0;

        for (const bot of financeBots) {
            const botResult = await runForBot(bot);
            report.perBot.push(botResult);
        }

        report.checks.perBotPass = report.perBot.every((row) => row.ok);

        if (financeBots.length > 0) {
            const crud = await testFunnelCrud(financeBots[0]);
            report.checks.funnelCrudCreate = crud.created;
            report.checks.funnelCrudDelete = crud.removed;

            const webhookResult = await testWebhook(financeBots[0]);
            report.checks.telegramWebhookAck = webhookResult.accepted;
            report.checks.telegramWebhookSecured = webhookResult.secured;
        }

        const apiLogs = await callMcpTool('get_api_logs', { limit: 5 });
        report.checks.getApiLogs = Array.isArray(apiLogs);

        const errors = await callMcpTool('get_errors', { limit: 5 });
        report.checks.getErrors = Array.isArray(errors);
    } catch (error) {
        report.errors.push(error.message);
    }

    report.finishedAt = new Date().toISOString();

    const reportDir = path.join(__dirname, '..', 'test-reports');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `regression-${Date.now()}.json`);
    const latestPath = path.join(reportDir, 'latest.json');

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(latestPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`REPORT_PATH=${reportPath}`);
    console.log(`PASSED_BOTS=${report.perBot.filter((row) => row.ok).length}`);
    console.log(`FAILED_BOTS=${report.perBot.filter((row) => !row.ok).length}`);
    console.log(`HAS_ERRORS=${report.errors.length > 0}`);

    if (report.errors.length > 0 || Object.values(report.checks).some((value) => value === false)) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
