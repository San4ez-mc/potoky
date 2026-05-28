'use strict';

/**
 * MCP HTTP route — FLOWS EDIT server
 * Exposes write/edit tools for bots, nodes, keys, and connectors
 * (~10 tools)
 *
 * Endpoint: POST https://flows.fineko.space/api/mcp-edit
 * Auth: Authorization: Bearer <MCP_SECRET> OR ?token=<user.mcpToken>
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { TOOLS, callTool, safeJsonStringify } = require('../../../../apps/mcp/src/tools-flows');

const router = express.Router();
const prisma = new PrismaClient();

const EDIT_TOOL_NAMES = new Set([
    'new_bot',
    'create_funnel',
    'add_node',
    'update_node',
    'delete_node',
    'create_edge',
    'update_funnel_key',
    'delete_funnel_key',
    'create_connector',
    'update_connector',
    'delete_connector',
    // Project management
    'list_projects',
    'create_project',
    'update_project',
    'delete_project',
]);

const EDIT_TOOLS = TOOLS.filter((tool) => EDIT_TOOL_NAMES.has(tool.name));

async function checkAuth(req, res) {
    const globalSecret = process.env.MCP_SECRET;
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    const queryToken = req.query.token;
    const candidate = bearer || queryToken;

    if (!candidate) {
        if (!globalSecret) return true;
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }

    if (globalSecret && candidate === globalSecret) return true;

    try {
        const user = await prisma.user.findUnique({ where: { mcpToken: candidate } });
        if (user) return true;
    } catch (_) { }

    res.status(401).json({ error: 'Unauthorized' });
    return false;
}

async function handleJsonRpc(msg) {
    const { id, method, params } = msg;

    if (method === 'initialize') {
        return {
            jsonrpc: '2.0', id, result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'platform-flows-edit-mcp', version: '2.0.0' },
            }
        };
    }

    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: EDIT_TOOLS } };
    }

    if (method === 'tools/call') {
        const { name, arguments: args } = params;
        if (!EDIT_TOOL_NAMES.has(name)) {
            return { jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not available on mcp-edit: ${name}` } };
        }

        try {
            const result = await callTool(name, args || {});
            return {
                jsonrpc: '2.0', id, result: {
                    content: [{ type: 'text', text: safeJsonStringify(result) }],
                }
            };
        } catch (err) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: err.message } };
        }
    }

    if (method === 'notifications/initialized') {
        return { jsonrpc: '2.0', id: id ?? null, result: { acknowledged: true } };
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

router.get('/', async (req, res) => {
    if (!await checkAuth(req, res)) return;
    res.json({
        name: 'platform-flows-edit-mcp',
        version: '2.0.0',
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
    });
});

router.post('/', async (req, res) => {
    if (!await checkAuth(req, res)) return;

    const body = req.body;
    try {
        if (Array.isArray(body)) {
            const results = await Promise.all(body.map(handleJsonRpc));
            res.json(results.filter(Boolean));
        } else {
            const result = await handleJsonRpc(body);
            res.json(result);
        }
    } catch (err) {
        res.json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32603, message: err.message } });
    }
});

module.exports = router;
