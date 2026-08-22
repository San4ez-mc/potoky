'use strict';

/**
 * authSso.js — вхід у флоус через центральний SSO (sso.fineko.space), OAuth2 authorization-code.
 * Публічний роутер (без authMiddleware): /api/auth/sso/login → редірект на SSO;
 * /api/auth/sso/callback → обмін code→token, перевірка email, створення сесії флоус.
 *
 * Фаза 1: успішний SSO-вхід дозволених email → повний доступ (isAdmin), як старий пароль.
 * Обмеження по проєктах (RBAC) додамо у Фазі 2 (доступи прийдуть із SSO).
 */

const { Router } = require('express');
const { randomBytes } = require('node:crypto');
const logger = require('@platform/logger');

const router = Router();

const SSO_BASE = (process.env.SSO_BASE_URL || 'https://sso.fineko.space').replace(/\/$/, '');
const CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.SSO_REDIRECT_URI || 'https://flows.fineko.space/api/auth/sso/callback';

function allowedEmails() {
    return String(process.env.SSO_ALLOWED_EMAILS || '')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// GET /api/auth/sso/login → редірект на SSO /authorize
router.get('/sso/login', (req, res) => {
    if (!CLIENT_ID) return res.status(500).send('SSO не налаштовано (SSO_CLIENT_ID)');
    const state = randomBytes(16).toString('hex');
    req.session.ssoState = state;
    req.session.save(() => {
        const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state });
        res.redirect(`${SSO_BASE}/authorize?${params.toString()}`);
    });
});

// GET /api/auth/sso/callback?code&state → обмін коду на токен + сесія
router.get('/sso/callback', async (req, res) => {
    try {
        const code = String(req.query.code || '');
        const state = String(req.query.state || '');
        if (!code || !state || state !== req.session.ssoState) return res.redirect('/login?sso=state');
        delete req.session.ssoState;

        const r = await fetch(`${SSO_BASE}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.user) {
            logger.warn('[authSso] token exchange failed', { status: r.status });
            return res.redirect('/login?sso=exchange');
        }

        const email = String(data.user.email || '').toLowerCase();

        // Тягнемо доступи (роль + проєкти + сторінки) з SSO для продукту flows.
        let role = 'none';
        let allowedProjectIds = [];
        let allowedPageIds = [];
        try {
            const pr = await fetch(`${SSO_BASE}/oauth/permissions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, userId: data.user.id, product: 'flows' }),
            });
            const pd = await pr.json().catch(() => ({}));
            if (pr.ok) {
                role = pd.role || 'none';
                allowedProjectIds = Array.isArray(pd.projectIds) ? pd.projectIds : [];
                allowedPageIds = Array.isArray(pd.pageIds) ? pd.pageIds : [];
            }
        } catch (e) { logger.warn('[authSso] permissions fetch failed', { error: e.message }); }

        // Bootstrap суперадміна за email (щоб власник ніколи не втратив доступ).
        if (allowedEmails().includes(email)) role = 'superadmin';

        if (role !== 'superadmin' && role !== 'user') {
            logger.warn('[authSso] no flows access', { email, role });
            return res.redirect('/login?sso=denied');
        }

        await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
        req.session.isAdmin = true;
        req.session.role = role;
        req.session.allowedProjectIds = role === 'superadmin' ? null : allowedProjectIds; // null = усі
        req.session.allowedPageIds = role === 'superadmin' ? null : allowedPageIds; // null = усі; [] = лише базові сторінки
        req.session.ssoUser = { id: data.user.id, email, name: data.user.name || null };
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));

        logger.info('[authSso] SSO login ok', { email, role });
        res.redirect('/');
    } catch (e) {
        logger.error('[authSso] callback error', { error: e.message });
        res.redirect('/login?sso=error');
    }
});

// GET /api/auth/me — фронт дізнається роль + дозволені проєкти/сторінки поточного користувача.
router.get('/me', (req, res) => {
    if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, authenticated: false });
    // Пароль-резерв (без ролі) = суперадмін (власник).
    const role = req.session.role || 'superadmin';
    const allowedProjectIds = role === 'superadmin' ? null : (req.session.allowedProjectIds || []);
    const allowedPageIds = role === 'superadmin' ? null : (req.session.allowedPageIds || []);
    res.json({ ok: true, authenticated: true, role, allowedProjectIds, allowedPageIds, user: req.session.ssoUser || { email: 'admin' } });
});

// GET /api/auth/sso/projects — SSO («Компанії») читає список проєктів flows (shared secret = client secret).
router.get('/sso/projects', async (req, res) => {
    if ((req.header('x-sso-secret') || '') !== CLIENT_SECRET) return res.status(401).json({ error: 'unauthorized' });
    try {
        const { db } = require('@platform/db');
        const projects = await db.project.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } });
        res.json({ projects });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/auth/sso/pages — SSO («Компанії») читає список сторінок (пунктів меню) flows,
// для яких можна давати доступ по одній конкретній людині з роллю 'user'. Джерело правди —
// той самий перелік, що і Sidebar.jsx (superadminOnly-пункти); базові 4 пункти (Воронки,
// Аналітика, Сесії, Підписники) сюди НЕ входять — вони завжди доступні будь-якому 'user'.
router.get('/sso/pages', (req, res) => {
    if ((req.header('x-sso-secret') || '') !== CLIENT_SECRET) return res.status(401).json({ error: 'unauthorized' });
    const pages = [
        { id: 'projects', label: 'Проєкти' },
        { id: 'broadcasts', label: 'Розсилки' },
        { id: 'dashboard', label: 'Дашборд' },
        { id: 'connectors', label: 'Конектори' },
        { id: 'logs', label: 'Логи' },
        { id: 'settings', label: 'Налаштування' },
    ];
    res.json({ pages });
});

module.exports = router;
