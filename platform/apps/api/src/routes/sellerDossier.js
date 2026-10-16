'use strict';
// Сховище «досьє експерта» для agent-ноди онбордингу ШІ-продавця (воронка onboard-seller).
// Доступ — як у websearch: заголовок X-Search-Secret із ключів воронки. Дані — таблиця files (fileType='seller_dossier'),
// ключ userId+botId, тож експерт може зупинитись і продовжити в наступній сесії. Схему БД не міняємо.
const express = require('express');
const router = express.Router();
const logger = require('@platform/logger');
const { db } = require('@platform/db');
const D = require('../services/sellerDossier');

const SEARCH_SECRET = process.env.SEARCH_SECRET || '';
function requireSecret(req, res, next) {
    if (!SEARCH_SECRET) return next();
    if (req.headers['x-search-secret'] !== SEARCH_SECRET) return res.status(401).json({ error: 'unauthorized' });
    next();
}
router.use(requireSecret);

const FILE_TYPE = 'seller_dossier';

async function load(sessionId) {
    const session = await db.session.findUnique({ where: { id: String(sessionId || '') }, select: { id: true, userId: true, botId: true } });
    if (!session) return null;
    const row = await db.file.findFirst({ where: { userId: session.userId, botId: session.botId, fileType: FILE_TYPE }, orderBy: { updatedAt: 'desc' } });
    let state;
    try { state = row ? JSON.parse(row.content) : D.emptyState(); } catch { state = D.emptyState(); }
    if (!state || typeof state !== 'object' || !state.fields) state = D.emptyState();
    return { session, row, state };
}

async function save(ctx) {
    const content = JSON.stringify(ctx.state);
    if (ctx.row) await db.file.update({ where: { id: ctx.row.id }, data: { content, sessionId: ctx.session.id } });
    else ctx.row = await db.file.create({ data: { userId: ctx.session.userId, botId: ctx.session.botId, sessionId: ctx.session.id, fileType: FILE_TYPE, fileName: 'seller_dossier.json', filePath: `/seller-dossier/${ctx.session.userId}.json`, content, version: 1 } });
}

const wrap = (fn) => async (req, res) => {
    try {
        const ctx = await load(req.query.sessionId);
        if (!ctx) return res.status(404).json({ ok: false, error: 'session not found' });
        await fn(req, res, ctx);
    } catch (e) {
        logger.error('[sellerDossier] ' + e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
};

// Поточний стан: що вже записано, що закрито, чого бракує (агент бере це на старті й після кожного блоку).
router.post('/get', wrap(async (req, res, ctx) => {
    const card = D.computeCard(ctx.state);
    res.json({
        ok: true, ready: card.ready, verdict: card.verdict,
        critical: card.rows.map((r) => ({ id: r.id, title: r.title, status: r.status, value: r.value, source: r.source, hasQuote: !!r.quote, conflict: r.conflict, defaultText: r.defaultText })),
        optional: card.optional.filter((o) => o.status !== 'missing').map((o) => ({ id: o.id, title: o.title, status: o.status, value: o.value })),
        materials: ctx.state.materials,
    });
}));

// Записати поле. Відповідь ok:false з поясненням = виправ виклик і повтори (не кажи експерту «збережено»).
router.post('/set', wrap(async (req, res, ctx) => {
    const r = D.setField(ctx.state, req.body || {});
    if (!r.ok) return res.status(400).json(r);
    await save(ctx);
    const card = D.computeCard(ctx.state);
    res.json({ ok: true, id: r.field.id, status: r.field.status, closed: `${card.done}/${card.total}`, stillNeeded: card.blockers.map((b) => b.id) });
}));

// Записати кілька полів одним викликом (розбір матеріалів).
router.post('/set-many', wrap(async (req, res, ctx) => {
    const items = Array.isArray(req.body && req.body.fields) ? req.body.fields : [];
    const results = items.map((it) => { const r = D.setField(ctx.state, it); return r.ok ? { id: r.field.id, ok: true, status: r.field.status } : { id: it && it.id, ok: false, error: r.error }; });
    for (const m of (Array.isArray(req.body && req.body.materials) ? req.body.materials : [])) D.addMaterial(ctx.state, m);
    await save(ctx);
    const card = D.computeCard(ctx.state);
    res.json({ ok: results.every((r) => r.ok), results, closed: `${card.done}/${card.total}`, stillNeeded: card.blockers.map((b) => b.id) });
}));

// Експерт підтвердив усю картку («усе вірно»): 🟡 → ✅, крім K4/K9 (потрібні його слова саме про ціну й обіцянки).
router.post('/confirm-all', wrap(async (req, res, ctx) => {
    const r = D.confirmAll(ctx.state, req.body && req.body.quote);
    if (!r.ok) return res.status(400).json(r);
    await save(ctx);
    const card = D.computeCard(ctx.state);
    res.json({ ok: true, confirmed: r.confirmed, stillNeedExplicit: r.skippedNeedExplicit, closed: `${card.done}/${card.total}`, stillNeeded: card.blockers.map((b) => b.id) });
}));

// Картка для експерта (простою мовою) — щоб показати й підтвердити.
router.post('/expert-card', wrap(async (req, res, ctx) => {
    const card = D.computeCard(ctx.state);
    res.json({ ok: true, ready: card.ready, text: D.renderExpertCard(card), stillNeeded: card.blockers.map((b) => b.id) });
}));

// Картка власнику + повні відповіді. Викликається js-нодою після завершення діалогу.
router.post('/owner-card', wrap(async (req, res, ctx) => {
    const card = D.computeCard(ctx.state);
    const parts = D.renderFull(card, ctx.state);
    res.json({ ok: true, ready: card.ready, verdict: card.verdict, cardText: D.renderOwnerCard(card, ctx.state), fullParts: parts.slice(0, 2) });
}));

module.exports = router;
