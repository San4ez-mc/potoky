'use strict';
const { Router } = require('express');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { authMiddleware } = require('../middleware/auth');
const { requirePage } = require('../middleware/rbac');
const Bull = require('bull');

const router = Router();
router.use(authMiddleware);
// Весь роутер належить ЛИШЕ сторінці "Розсилки" (перевірено: жодна інша сторінка
// адмінки цей API не читає) — безпечно гейтити ЦІЛИМ роутером, на відміну від
// connectors.js/projects.js, де GET-и використовуються й іншими сторінками.
router.use(requirePage('broadcasts'));

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const broadcastQueue = new Bull('broadcasts', REDIS_URL);

// GET /api/broadcasts/eligible-bots
// Returns bots that have at least one real (non-test) user session with a telegramId
router.get('/eligible-bots', asyncHandler(async (req, res) => {
    const bots = await db.bot.findMany({
        where: {
            isActive: true,
            sessions: {
                some: {
                    isTest: false,
                    user: { username: { not: 'webhook_system' } },
                },
            },
        },
        select: {
            id: true,
            name: true,
            slug: true,
            _count: { select: { sessions: { where: { isTest: false, user: { username: { not: 'webhook_system' } } } } } },
        },
        orderBy: { name: 'asc' },
    });
    res.json({ ok: true, data: bots });
}));

// GET /api/broadcasts/subscribers?botIds=id1,id2
// Returns distinct real users for those bots (non-test sessions, real telegramId)
router.get('/subscribers', asyncHandler(async (req, res) => {
    const botIds = (req.query.botIds || '').split(',').filter(Boolean);
    if (!botIds.length) return res.json({ ok: true, data: [] });

    // Get distinct users who have non-test sessions with these bots
    // Order by lastActive desc so the most recent session wins (for isUnsubscribed status)
    const sessions = await db.session.findMany({
        where: {
            botId: { in: botIds },
            isTest: false,
            user: { username: { not: 'webhook_system' } },
        },
        orderBy: { lastActive: 'desc' },
        select: {
            botId: true,
            state: true,
            user: { select: { id: true, telegramId: true, firstName: true, lastName: true, username: true } },
        },
    });

    // Deduplicate: one entry per unique telegramId (prefer keeping first/most-recent session)
    const seen = new Set();
    const result = [];
    for (const s of sessions) {
        const key = String(s.user.telegramId);
        if (!seen.has(key)) {
            seen.add(key);
            result.push({
                userId: s.user.id,
                telegramId: String(s.user.telegramId),
                firstName: s.user.firstName || '',
                lastName: s.user.lastName || '',
                username: s.user.username || '',
                botId: s.botId,
                isUnsubscribed: s.state === 'unsubscribed',
            });
        }
    }
    res.json({ ok: true, data: result });
}));

// GET /api/broadcasts
router.get('/', asyncHandler(async (req, res) => {
    const broadcasts = await db.broadcast.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
    });
    res.json({ ok: true, data: broadcasts });
}));

// GET /api/broadcasts/:id
router.get('/:id', asyncHandler(async (req, res) => {
    const bc = await db.broadcast.findUnique({ where: { id: req.params.id } });
    if (!bc) return res.status(404).json({ ok: false, error: { message: 'Not found' } });
    res.json({ ok: true, data: bc });
}));

// POST /api/broadcasts — create and send/schedule
router.post('/', asyncHandler(async (req, res) => {
    const { name, message, recipients, scheduledAt } = req.body;
    if (!recipients?.length) return res.status(400).json({ ok: false, error: { message: 'No recipients' } });
    if (!message?.text && !message?.photoUrl && !message?.documentUrl) {
        return res.status(400).json({ ok: false, error: { message: 'Message must have text, photo or document' } });
    }

    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();
    const status = isScheduled ? 'scheduled' : 'sending';

    const broadcast = await db.broadcast.create({
        data: {
            name: name || null,
            status,
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
            message: message || {},
            recipients: recipients,
            stats: { total: recipients.length, sent: 0, failed: 0 },
        },
    });

    const delay = isScheduled ? (new Date(scheduledAt).getTime() - Date.now()) : 0;
    await broadcastQueue.add({ broadcastId: broadcast.id }, { delay: Math.max(0, delay), attempts: 2 });

    res.status(201).json({ ok: true, data: broadcast });
}));

// DELETE /api/broadcasts/:id — cancel scheduled
router.delete('/:id', asyncHandler(async (req, res) => {
    const bc = await db.broadcast.findUnique({ where: { id: req.params.id } });
    if (!bc) return res.status(404).json({ ok: false, error: { message: 'Not found' } });
    if (bc.status !== 'scheduled') {
        return res.status(400).json({ ok: false, error: { message: 'Can only cancel scheduled broadcasts' } });
    }
    await db.broadcast.update({ where: { id: req.params.id }, data: { status: 'cancelled' } });
    res.json({ ok: true });
}));

module.exports = router;
