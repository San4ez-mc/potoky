'use strict';
// Сторінка «ШІ-продавці» (адмінка Flows): перегляд і правка налаштувань продавців експертів.
// Дані зберігає content2 (профіль експерта, SellerConfig); Flows лише проксіює через службовий вебхук content2
// /api/webhooks/seller-admin (list/get/put) і додає те, що знає сам: клон-воронку та посилання на неї.
// Доступ: лише superadmin (запуск продавця = рішення власника). Секрет content2 береться з ключів воронки `onboard`.

const { Router } = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');

const CREDS_TTL_MS = 60 * 1000;

function createSellersRouter({ db, fetchImpl = fetch, env = process.env }) {
    const router = Router();
    let credsCache = { at: 0, value: null };

    async function creds() {
        if (credsCache.value && Date.now() - credsCache.at < CREDS_TTL_MS) return credsCache.value;
        let url = env.CONTENT2_URL || '';
        let secret = env.CONTENT2_WEBHOOK_SECRET || '';
        if (!url || !secret) {
            const bot = await db.bot.findFirst({ where: { slug: 'onboard' }, select: { id: true } });
            if (bot) {
                const rows = await db.funnelKey.findMany({ where: { botId: bot.id, key: { in: ['CONTENT2_URL', 'CONTENT2_WEBHOOK_SECRET'] } }, select: { key: true, value: true } });
                const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
                url = url || m.CONTENT2_URL || '';
                secret = secret || m.CONTENT2_WEBHOOK_SECRET || '';
            }
        }
        if (!url || !secret) throw Object.assign(new Error('Не налаштовано звʼязок із content2 (CONTENT2_URL / CONTENT2_WEBHOOK_SECRET у ключах воронки onboard)'), { status: 503 });
        credsCache = { at: Date.now(), value: { url: url.replace(/\/$/, ''), secret } };
        return credsCache.value;
    }

    async function c2(body) {
        const c = await creds();
        let res;
        try {
            res = await fetchImpl(c.url + '/api/webhooks/seller-admin', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': c.secret }, body: JSON.stringify(body),
            });
        } catch (e) {
            throw Object.assign(new Error('Content2 недоступний: ' + e.message), { status: 502 });
        }
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.ok === false) throw Object.assign(new Error(j.error || ('content2 HTTP ' + res.status)), { status: res.status === 404 ? 404 : (res.status >= 500 ? 502 : res.status), missing: j.missing });
        return j;
    }

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
