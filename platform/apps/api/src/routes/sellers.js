'use strict';
// Сторінка «ШІ-продавці» (адмінка Flows): перегляд і правка налаштувань продавців експертів.
// Дані зберігає content2 (профіль експерта, SellerConfig); Flows лише проксіює через службовий вебхук content2
// /api/webhooks/seller-admin (list/get/put) і додає те, що знає сам: клон-воронку та посилання на неї.
// Доступ: лише superadmin (запуск продавця = рішення власника). Секрет content2 береться з ключів воронки `onboard`.

const { Router } = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');

const { createContent2Client } = require('../services/content2Client');

function createSellersRouter({ db, fetchImpl = fetch, env = process.env }) {
    const router = Router();
    const { c2 } = createContent2Client({ db, fetchImpl, env });

    // клон-воронки продавців у Flows: projectId → { botId, slug, isActive, username, link }
    async function clonesByProject(projectIds) {
        const out = {};
        if (!projectIds.length) return out;
        const keys = await db.funnelKey.findMany({ where: { key: 'EXPERT_PROJECT_ID', value: { in: projectIds } }, select: { botId: true, value: true } });
        if (!keys.length) return out;
        const bots = await db.bot.findMany({ where: { id: { in: keys.map((k) => k.botId) } }, select: { id: true, slug: true, isActive: true } });
        const names = await db.funnelKey.findMany({ where: { botId: { in: keys.map((k) => k.botId) }, key: 'TELEGRAM_BOT_USERNAME' }, select: { botId: true, value: true } });
        const uname = Object.fromEntries(names.map((n) => [n.botId, n.value]));
        for (const k of keys) {
            const b = bots.find((x) => x.id === k.botId);
            if (!b || b.slug === 'tpl-expert-seller') continue;
            const username = uname[b.id] || '';
            out[k.value] = { botId: b.id, slug: b.slug, isActive: b.isActive, username, link: username ? `https://t.me/${username}?start=${b.slug}` : '' };
        }
        return out;
    }

    router.get('/', asyncHandler(async (req, res) => {
        const r = await c2({ action: 'list' });
        const sellers = r.sellers || [];
        const clones = await clonesByProject(sellers.map((s) => s.projectId));
        res.json({ ok: true, data: sellers.map((s) => ({ ...s, clone: clones[s.projectId] || null })) });
    }));

    // Вивантаження відповідей онбордингу для аналізу (зустріч 22.10, п. «Перевірка»): усі експерти × усі поля досьє.
    // ?format=csv (за замовчуванням, UTF-8 з BOM для Excel) | json. Токени й паролі в досьє не зберігаються.
    router.get('/export', asyncHandler(async (req, res) => {
        const files = await db.file.findMany({ where: { fileType: 'seller_dossier' }, orderBy: { updatedAt: 'desc' } });
        const users = await db.user.findMany({ where: { id: { in: files.map((f) => f.userId) } }, select: { id: true, firstName: true, lastName: true, username: true, telegramId: true } });
        const um = Object.fromEntries(users.map((u) => [u.id, u]));
        const rows = [];
        for (const f of files) {
            let st; try { st = JSON.parse(f.content); } catch { continue; }
            const u = um[f.userId] || {};
            const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
            const who = { expert: name, username: u.username || '', telegramId: u.telegramId ? String(u.telegramId) : '' };
            for (const fld of Object.values((st && st.fields) || {})) {
                rows.push({
                    ...who, field: fld.id, title: fld.title, status: fld.status, value: fld.value || '', quote: fld.quote || '',
                    source: fld.source || '', weak: fld.quality && fld.quality.weak ? 'так' : '', weakHint: fld.quality && fld.quality.weak ? fld.quality.hint : '',
                    note: fld.note || '', conflict: fld.conflict || '', updatedAt: fld.updatedAt || '',
                });
            }
            for (const q of (st && st.specialistRequests) || []) {
                rows.push({ ...who, field: 'ЗАПИТ_ФАХІВЦЮ', title: q.topic || '', status: '', value: q.reason || '', quote: '', source: '', weak: '', weakHint: '', note: '', conflict: '', updatedAt: q.at || '' });
            }
        }
        if (String(req.query.format || 'csv') === 'json') return res.json({ ok: true, data: rows });
        const cols = ['expert', 'username', 'telegramId', 'field', 'title', 'status', 'value', 'quote', 'source', 'weak', 'weakHint', 'note', 'conflict', 'updatedAt'];
        const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const csv = '﻿' + cols.join(',') + '\r\n' + rows.map((r) => cols.map((c) => cell(r[c])).join(',')).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="onboarding-answers.csv"');
        res.send(csv);
    }));

    // Створити (або показати наявний) клон продавця для експерта: вручну, якщо автоматика онбордингу не спрацювала.
    router.post('/:projectId/provision', asyncHandler(async (req, res) => {
        const { provisionSeller } = require('../services/sellerProvision');
        const { callTool } = require('../../../../apps/mcp/src/tools-flows');
        const r = await provisionSeller({ db, callTool, projectId: req.params.projectId, fetchImpl });
        res.json({ ok: true, data: r });
    }));

    router.get('/:projectId', asyncHandler(async (req, res) => {
        const r = await c2({ action: 'get', projectId: req.params.projectId });
        const clones = await clonesByProject([req.params.projectId]);
        const { ok, ...view } = r;
        res.json({ ok: true, data: { ...view, clone: clones[req.params.projectId] || null } });
    }));

    router.put('/:projectId', asyncHandler(async (req, res) => {
        const patch = req.body && typeof req.body === 'object' ? req.body : {};
        const r = await c2({ action: 'put', projectId: req.params.projectId, patch });
        res.json({ ok: true, data: { status: r.status, readiness: r.readiness } });
    }));

    // помилки content2 віддаємо людською мовою з правильним кодом (400 «не готово до запуску» тощо)
    router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
        const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
        res.status(status).json({ ok: false, error: { code: 'SELLERS_ERROR', message: err.message || 'Помилка', missing: err.missing } });
    });

    return router;
}

module.exports = { createSellersRouter };
