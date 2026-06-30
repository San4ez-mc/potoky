#!/usr/bin/env node
'use strict';
/**
 * Happy-path smoke test for the flows platform. Run after every deploy:
 *   cd /var/www/flows.fineko.space/platform/apps/api && node ../../scripts/smoke-test.js
 * Exits 1 if any check fails, so a deploy hook / CI can gate on it.
 *
 * Checks (cheap, no content generation):
 *   1. flows webhook + content2 reachable
 *   2. Vertex AI auth (service-account token mint) — guards image generation
 *   3. Claude dispatch dependency: a real call through the wrapper with a
 *      sliced-emoji (lone surrogate) message must return text, not 400 —
 *      guards the path that broke the content bot.
 */

const fs = require('fs');
const crypto = require('crypto');

// Load DATABASE_URL etc. from the platform .env if not already in the environment.
if (!process.env.DATABASE_URL) {
    try {
        const env = fs.readFileSync('/var/www/flows.fineko.space/platform/.env', 'utf8');
        for (const line of env.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* ignore */ }
}

const { db } = require('@platform/db');
const { callClaude } = require('@platform/claude');

const CM2_BOT = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const IMAGE_BOT = 'e54a4974-a910-4a04-b5bf-3853eb109dff';      // has GOOGLE_SA_KEY + PROJECT
const HAIKU_CONNECTOR = '4a8000aa-837f-4a73-bf5c-224949ebaf9a';

const results = [];
const pass = (n) => { results.push({ n, ok: true }); console.log('  PASS  ' + n); };
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('  FAIL  ' + n + (d ? '  — ' + d : '')); };

async function checkHttp(name, url, method, body, okCodes) {
    try {
        const r = await fetch(url, {
            method, redirect: 'manual',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        okCodes.includes(r.status) ? pass(`${name} (HTTP ${r.status})`) : fail(name, `HTTP ${r.status}`);
    } catch (e) { fail(name, e.message); }
}

async function getKey(botId, key) {
    const row = await db.funnelKey.findFirst({ where: { botId, key }, select: { value: true } });
    return (row && row.value) || '';
}

async function checkVertexAuth() {
    try {
        const saStr = await getKey(IMAGE_BOT, 'GOOGLE_SA_KEY');
        const proj = await getKey(IMAGE_BOT, 'GOOGLE_PROJECT_ID');
        if (!saStr || !proj) return fail('vertex auth', 'missing GOOGLE_SA_KEY / GOOGLE_PROJECT_ID');
        const sa = JSON.parse(saStr);
        const now = Math.floor(Date.now() / 1000);
        const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const p = Buffer.from(JSON.stringify({
            iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
            aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
        })).toString('base64url');
        const s = crypto.createSign('RSA-SHA256'); s.update(`${h}.${p}`);
        const sig = s.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${sig}`,
        });
        const j = await r.json();
        j.access_token ? pass('vertex auth (token minted)') : fail('vertex auth', JSON.stringify(j).slice(0, 160));
    } catch (e) { fail('vertex auth', e.message); }
}

async function checkClaudeDispatch() {
    try {
        const conn = await db.savedConnector.findUnique({ where: { id: HAIKU_CONNECTOR }, select: { config: true } });
        const apiKey = conn && conn.config && (conn.config.api_key || conn.config.token);
        if (!apiKey) return fail('claude dispatch', 'no api_key on connector');
        // Message ends with a lone high surrogate (a sliced emoji) — must not 400.
        const text = await callClaude({
            sessionId: null,
            systemPrompt: 'Reply with the single word OK.',
            messages: [{ role: 'user', content: 'привіт ' + String.fromCharCode(0xD83D) }],
            options: { apiKey, maxTokens: 10 },
        });
        (typeof text === 'string' && text.length > 0)
            ? pass('claude dispatch (sliced-emoji safe)')
            : fail('claude dispatch', 'empty response');
    } catch (e) { fail('claude dispatch', e.message); }
}

(async () => {
    console.log('flows smoke test — ' + new Date().toISOString());
    await checkHttp('flows webhook', 'https://flows.fineko.space/webhook/bot/__smoke_nonexistent__', 'POST', { ping: 1 }, [200]);
    await checkHttp('content2', 'https://content2.fineko.space/storage', 'GET', null, [200, 307, 308]);
    await checkVertexAuth();
    await checkClaudeDispatch();

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (failed.length ? `✗ ${failed.length} FAILED` : `✓ all ${results.length} checks passed`));
    await db.$disconnect().catch(() => {});
    process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('smoke test crashed:', e.message); process.exit(1); });
