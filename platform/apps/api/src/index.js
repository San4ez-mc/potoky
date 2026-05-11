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
const mcpRouter = require('./routes/mcp');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust nginx reverse proxy (needed for secure cookies via HTTPS)
app.set('trust proxy', 1);

// ── Body parsing ────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
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
app.use('/api/admin', adminRouter);

// MCP endpoint (public with optional Bearer token via MCP_SECRET)
app.use('/mcp', mcpRouter);

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
