'use strict';
// Сховище «досьє експерта» для agent-ноди онбордингу ШІ-продавця (воронка onboard-seller).
// Доступ — як у websearch: заголовок X-Search-Secret із ключів воронки. Дані (з 27.10) живуть у content2, єдине джерело правди;
// тіньова копія files(seller_dossier) за userId+botId. Експерт може зупинитись і продовжити в наступній сесії.
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

// Сховище: основне, content2 (таблиця seller_dossiers); тіньова копія: files(seller_dossier). Див. services/dossierStore.js
const { createContent2Client } = require('../services/content2Client');
const { createDossierStore } = require('../services/dossierStore');
const store = createDossierStore({ db, content2: createContent2Client({ db }), logger, emptyState: D.emptyState });
const load = store.load;
const save = store.save;

// Відповідь розмита: агент має перепитати одним конкретним уточненням (максимум двічі), запис при цьому лишається.
const weakInfo = (fields) => {
    const weak = fields.filter((f) => f.quality && f.quality.weak).map((f) => ({ id: f.id, hint: f.quality.hint }));
    return weak.length ? { weak, qualityNote: 'Записано, але відповідь розмита: уточни одним конкретним питанням (див. weak[].hint). Після двох спроб лиши як є.' } : {};
};

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
        critical: card.rows.map((r) => ({ id: r.id, title: r.title, status: r.status, value: r.value, source: r.source, hasQuote: !!r.quote, conflict: r.conflict, defaultText: r.defaultText, weak: r.weak || undefined, weakHint: r.weak ? r.weakHint : undefined })),
        weak: card.weak, specialistRequests: card.specialistRequests.length,
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
    res.json({ ok: true, id: r.field.id, status: r.field.status, closed: `${card.done}/${card.total}`, stillNeeded: card.blockers.map((b) => b.id), ...weakInfo([r.field]) });
}));

// Записати кілька полів одним викликом (розбір матеріалів).
router.post('/set-many', wrap(async (req, res, ctx) => {
    const items = Array.isArray(req.body && req.body.fields) ? req.body.fields : [];
    const results = items.map((it) => { const r = D.setField(ctx.state, it); return r.ok ? { id: r.field.id, ok: true, status: r.field.status } : { id: it && it.id, ok: false, error: r.error }; });
    for (const m of (Array.isArray(req.body && req.body.materials) ? req.body.materials : [])) D.addMaterial(ctx.state, m);
    await save(ctx);
    const card = D.computeCard(ctx.state);
    res.json({ ok: results.every((r) => r.ok), results, closed: `${card.done}/${card.total}`, stillNeeded: card.blockers.map((b) => b.id), ...weakInfo(items.map((it) => ctx.state.fields[String(it && it.id || '').toUpperCase()]).filter(Boolean)) });
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

// «Потрібна допомога фахівця»: запит лишається в досьє (видно в картці власнику) і одразу йде в Telegram власнику та фахівцям.
router.post('/request-specialist', wrap(async (req, res, ctx) => {
    const r = D.addSpecialistRequest(ctx.state, req.body || {});
    if (!r.ok) return res.status(400).json(r);
    await save(ctx);
    let sent = 0;
    try {
        const { getBotToken } = require('../services/platformBotHandler');
        const token = await getBotToken(ctx.session.botId);
        const keys = await db.funnelKey.findMany({ where: { botId: ctx.session.botId, key: { in: ['ADMIN_TELEGRAM_ID', 'SPECIALIST_TELEGRAM_IDS'] } }, select: { key: true, value: true } });
        const km = Object.fromEntries(keys.map((k) => [k.key, k.value]));
        const ids = [...new Set(String((km.ADMIN_TELEGRAM_ID || '') + ',' + (km.SPECIALIST_TELEGRAM_IDS || '')).split(/[\s,;]+/).filter((x) => /^\d+$/.test(x)))];
        const user = await db.user.findUnique({ where: { id: ctx.session.userId }, select: { firstName: true, lastName: true, username: true, telegramId: true } }).catch(() => null);
        const who = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') + (user.username ? ' (@' + user.username + ')' : '') + (user.telegramId ? ', tg ' + user.telegramId : '') : 'невідомо';
        const esc = (x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const text = ['🙋 <b>Експерту потрібна допомога фахівця</b> (онбординг ШІ-продавця)', 'Експерт: ' + esc(who), 'Тема: ' + esc(r.request.topic || '—'), 'Причина: ' + esc(r.request.reason || '—'), 'Сесія: https://flows.fineko.space/sessions/' + ctx.session.id].join('\n');
        if (token) for (const id of ids) {
            const tr = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true }) }).then((x) => x.json()).catch(() => ({}));
            if (tr.ok) sent += 1;
        }
    } catch (e) { logger.warn('[sellerDossier] request-specialist notify: ' + e.message); }
    res.json({ ok: true, notified: sent, message: sent ? 'Фахівцям передано, вони напишуть експерту сюди в Telegram.' : 'Запит збережено, фахівець побачить його в картці.' });
}));

// Автоматичний перехід «онбординг → продавець»: коли всі критичні поля закриті, створюємо клон (чернетку) на спільному боті.
// projectId береться з контексту сесії (його туди поклала нода «Записати в content2»), а не з тіла запиту.
router.post('/provision', wrap(async (req, res, ctx) => {
    const card = D.computeCard(ctx.state);
    if (!card.ready) return res.json({ ok: true, skipped: 'not_ready', verdict: card.verdict });
    const sess = await db.session.findUnique({ where: { id: ctx.session.id }, select: { context: true } });
    const projectId = sess && sess.context && sess.context.c2ProjectId;
    if (!projectId) return res.json({ ok: true, skipped: 'no_project' });
    try {
        const { provisionSeller } = require('../services/sellerProvision');
        const { callTool } = require('../../../../apps/mcp/src/tools-flows');
        res.json(await provisionSeller({ db, callTool, projectId }));
    } catch (e) {
        logger.error('[sellerDossier] provision: ' + e.message);
        res.json({ ok: false, error: e.message });
    }
}));

module.exports = router;
