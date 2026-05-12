'use strict';

const readline = require('readline');
const { TOOLS, callTool, disconnect, safeJsonStringify } = require('./tools');

function respond(id, result) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function fail(id, code, message) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

async function handleMessage(message) {
    const { id, method, params } = message;

    try {
        if (method === 'initialize') {
            return respond(id, {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'platform-funnel-mcp', version: '1.1.0' },
            });
        }

        if (method === 'tools/list') {
            return respond(id, { tools: TOOLS });
        }

        if (method === 'tools/call') {
            const { name, arguments: args } = params;
            const result = await callTool(name, args || {});
            return respond(id, {
                content: [{ type: 'text', text: safeJsonStringify(result) }],
            });
        }

        if (method === 'notifications/initialized') {
            return;
        }

        return fail(id, -32601, `Method not found: ${method}`);
    } catch (error) {
        return fail(id, -32603, error.message);
    }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
        await handleMessage(JSON.parse(trimmed));
    } catch (error) {
        process.stderr.write(`MCP parse error: ${error.message}\n`);
    }
});

process.on('SIGINT', async () => { await disconnect(); process.exit(0); });
process.on('SIGTERM', async () => { await disconnect(); process.exit(0); });

process.stderr.write('Platform Funnel MCP server started (stdio transport)\n');
