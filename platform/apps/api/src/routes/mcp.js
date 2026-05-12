'use strict';

/**
 * MCP HTTP route — exposes the same tools as apps/mcp/src/index.js
 * but via HTTP transport (Streamable HTTP) for Claude.ai remote MCP.
 *
 * Endpoint: POST /mcp  (or GET /mcp for SSE stream negotiation)
 *
 * Auth (two options):
 *   1. Global:   Authorization: Bearer <MCP_SECRET env var>
 *   2. Per-user: ?token=<user.mcpToken>  OR  Authorization: Bearer <user.mcpToken>
 *
 * Add to Claude.ai: https://flows.fineko.space/mcp?token=<your_token>
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { TOOLS, callTool } = require('../../../../apps/mcp/src/tools');

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
                serverInfo: { name: 'platform-funnel-mcp', version: '1.0.0' },
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
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
 * GET /mcp — SSE endpoint for MCP Streamable HTTP transport
 * Claude.ai connects here first for negotiation.
 */
router.get('/', async (req, res) => {
    if (!await checkAuth(req, res)) return;
    // Return server info for capability discovery
    res.json({
        name: 'platform-funnel-mcp',
        version: '1.0.0',
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
    });
});

/**
 * POST /mcp — JSON-RPC over HTTP (Streamable HTTP transport)
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
