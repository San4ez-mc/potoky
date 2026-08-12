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
        const allow = allowedEmails();
        // Фаза 1: пускаємо лише дозволені email (щоб випадкові SSO-акаунти не отримали доступ).
        if (allow.length && !allow.includes(email)) {
            logger.warn('[authSso] email not allowed for flows', { email });
            return res.redirect('/login?sso=denied');
        }

        await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
        req.session.isAdmin = true;
        req.session.ssoUser = { id: data.user.id, email, name: data.user.name || null };
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));

        logger.info('[authSso] SSO login ok', { email });
        res.redirect('/');
    } catch (e) {
        logger.error('[authSso] callback error', { error: e.message });
        res.redirect('/login?sso=error');
    }
});

module.exports = router;
