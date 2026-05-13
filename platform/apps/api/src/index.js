'use strict';

require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const session = require('express-session');

const logger = require('@platform/logger');
const { db } = require('@platform/db');

const { asyncHandler } = require('./middleware/asyncHandler');
const { authMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

const projectsRouter = require('./routes/projects');
const botsRouter = require('./routes/bots');
const sessionsRouter = require('./routes/sessions');
const usersRouter = require('./routes/users');
const adminRouter = require('./routes/admin');
const webhookRouter = require('./routes/webhook');
const funnelsRouter = require('./routes/funnels');
const connectorsRouter = require('./routes/connectors');
const savedConnectorsRouter = require('./routes/saved-connectors');
const mcpRouter = require('./routes/mcp');
const mcpFlowsRouter = require('./routes/mcp-flows');
const mcpFlowsEditRouter = require('./routes/mcp-flows-edit');
const mcpDebugRouter = require('./routes/mcp-debug');

const app = express();
const PORT = process.env.PORT || 3000;
const MCP_PATH_PREFIXES = ['/api/mcp', '/api/mcp-edit', '/api/mcp-debug', '/mcp'];

function isMcpRequestPath(pathname) {
    return typeof pathname === 'string' && MCP_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function truncateForLog(value, maxLength = 2000) {
    if (typeof value !== 'string') return value;
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function summarizeMcpBody(body) {
    if (!body || typeof body !== 'object') {
        return { type: typeof body };
    }

    if (Array.isArray(body)) {
        return {
            type: 'batch',
            size: body.length,
            methods: body.map((item) => item?.method).filter(Boolean).slice(0, 10),
        };
    }

    return {
        type: 'single',
        id: body.id ?? null,
        method: body.method ?? null,
        hasParams: Boolean(body.params),
    };
}

function mcpRequestLogger(req, res, next) {
    if (!isMcpRequestPath(req.originalUrl)) return next();

    const startedAt = process.hrtime.bigint();
    const requestSummary = req.body && typeof req.body === 'object'
        ? summarizeMcpBody(req.body)
        : { type: 'unparsed' };

    logger.info('MCP request started', {
        path: req.originalUrl,
        method: req.method,
        remoteAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestSummary,
    });

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        logger.info('MCP request finished', {
            path: req.originalUrl,
            method: req.method,
            statusCode: res.statusCode,
            durationMs: Math.round(durationMs),
            requestSummary,
        });
    });

    next();
}

function captureRawBody(req, _res, buffer) {
    if (!isMcpRequestPath(req.originalUrl)) return;
    req.rawBody = buffer.toString('utf8');
}

// Prevent JSON serialization crashes for DB bigint fields (e.g. telegramId).
app.set('json replacer', (_key, value) => (typeof value === 'bigint' ? value.toString() : value));

// Trust nginx reverse proxy (needed for secure cookies via HTTPS)
app.set('trust proxy', 1);

// ── Body parsing ────────────────────────────────────────────
app.use(express.json({ limit: '1mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true }));

// ── Session ──────────────────────────────────────────────────
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24h
    },
}));

// ── Rate limiting (global) ───────────────────────────────────
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(globalLimiter);

// ── Webhook rate limiting (Telegram) ────────────────────────
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => {
        const body = req.body;
        return body?.message?.from?.id?.toString()
            || body?.callback_query?.from?.id?.toString()
            || req.ip;
    },
});

// ── Routes ───────────────────────────────────────────────────
app.use('/webhook', webhookLimiter, webhookRouter);

app.use('/api/projects', authMiddleware, projectsRouter);
app.use('/api/bots', authMiddleware, botsRouter);
app.use('/api/sessions', authMiddleware, sessionsRouter);
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/funnels', authMiddleware, funnelsRouter);
app.use('/api/connectors', authMiddleware, connectorsRouter);
app.use('/api/saved-connectors', authMiddleware, savedConnectorsRouter);
app.use('/api/admin', adminRouter);

// MCP endpoints: split into flows read-only, flows-edit write, and debug
app.use(mcpRequestLogger);
app.use('/api/mcp', mcpFlowsRouter);
app.use('/api/mcp-edit', mcpFlowsEditRouter);
app.use('/api/mcp-debug', mcpDebugRouter);
// Legacy MCP endpoint (kept for backward compatibility)
app.use('/mcp', mcpRouter);

// Body-parser throws before the MCP route handlers run when the incoming JSON is malformed.
// For MCP clients, return a JSON-RPC parse error instead of a generic 500 so the handshake
// can fail cleanly and the client can retry with a fresh request.
app.use((err, req, res, next) => {
    const isJsonParseError = err && (
        err.type === 'entity.parse.failed' ||
        err instanceof SyntaxError
    );
    const isMcpRequest = typeof req?.originalUrl === 'string' && (
        req.originalUrl.startsWith('/api/mcp') ||
        req.originalUrl.startsWith('/mcp')
    );

    if (!isJsonParseError || !isMcpRequest) return next(err);

    logger.warn('MCP JSON parse error', {
        path: req.originalUrl,
        message: err.message,
        rawBody: truncateForLog(req.rawBody || ''),
    });

    return res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
            code: -32700,
            message: 'Parse error',
        },
    });
});

// Health check (public)
app.get('/health', asyncHandler(async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
}));

// ── Error handler ─────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
    logger.info(`Platform API started`, { port: PORT, env: process.env.NODE_ENV });
});

module.exports = app;
