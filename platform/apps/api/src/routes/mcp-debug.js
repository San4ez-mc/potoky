'use strict';

/**
 * MCP HTTP route — DEBUG server
 * Exposes session debugging, error logs, and test session tools
 * (~10 tools: get_session_logs, get_session, start_test_session, send_test_message, etc.)
 *
 * Endpoint: POST https://flows.fineko.space/api/mcp-debug
 * Auth: Authorization: Bearer <MCP_SECRET> OR ?token=<user.mcpToken>
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { TOOLS, callTool, safeJsonStringify } = require('../../../../apps/mcp/src/tools-debug');

const router = express.Router();
const prisma = new PrismaClient();

// ─── Auth ──────────────────────────────────────────────────────────────────────

async function checkAuth(req, res) {
    const globalSecret = process.env.MCP_SECRET;
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    const queryToken = req.query.token;
    const candidate = bearer || queryToken;

    if (!candidate) {
        if (!globalSecret) return true; // no auth configured — open
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }

    // Check global secret first
    if (globalSecret && candidate === globalSecret) return true;

    // Check per-user token in DB
    try {
        const user = await prisma.user.findUnique({ where: { mcpToken: candidate } });
        if (user) return true;
    } catch (_) { }

    res.status(401).json({ error: 'Unauthorized' });
    return false;
}

// ─── MCP JSON-RPC handler ──────────────────────────────────────────────────────

async function handleJsonRpc(msg) {
    const { id, method, params } = msg;

    if (method === 'initialize') {
        return {
            jsonrpc: '2.0', id, result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'platform-debug-mcp', version: '2.0.0' },
            }
        };
    }

    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
        const { name, arguments: args } = params;
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
        return null; // no response needed
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/mcp-debug — SSE endpoint for MCP Streamable HTTP transport
 * Claude.ai connects here first for capability discovery.
 */
router.get('/', async (req, res) => {
    if (!await checkAuth(req, res)) return;
    res.json({
        name: 'platform-debug-mcp',
        version: '2.0.0',
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
    });
});

/**
 * POST /api/mcp-debug — JSON-RPC over HTTP (Streamable HTTP transport)
 * Claude.ai sends tool calls here.
 */
router.post('/', async (req, res) => {
    if (!await checkAuth(req, res)) return;

    const body = req.body;
    try {
        // Handle batch (array) or single request
        if (Array.isArray(body)) {
            const results = await Promise.all(body.map(handleJsonRpc));
            res.json(results.filter(Boolean));
        } else {
            const result = await handleJsonRpc(body);
            if (result === null) {
                res.status(204).end(); // notification — no response
            } else {
                res.json(result);
            }
        }
    } catch (err) {
        res.json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32603, message: err.message } });
    }
});

module.exports = router;
