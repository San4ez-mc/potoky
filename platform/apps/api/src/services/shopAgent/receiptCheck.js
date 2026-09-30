'use strict';
/**
 * receiptCheck.js — чи фото клієнта на етапі оплати справді квитанція/скрін переказу.
 *
 * 2026-09-30 (FunnelTest 14, cd1f1cb5): після вибору способу оплати БУДЬ-ЯКЕ фото вважалось квитанцією — на зразок кольору
 * («Оце такий колір хочу») бот відповідав «Дякую! Оплату звіримо, щойно надійде». Коротка перевірка вмісту через
 * geminiFetch (ключ воронки → конектор Gemini → Claude vision). null — перевірити не вдалось (поведінка як раніше).
 */
const fs = require('fs');
const path = require('path');
const { geminiFetch } = require('../geminiKey');
const { logger } = require('./lib');

const BOT_FILES_DIR = process.env.BOT_FILES_DIR || path.resolve(__dirname, '../../../../uploads/bot-files');

async function loadImage(A, url) {
    try {
        const m = String(url).match(/\/bot-files\/(.+)$/);
        if (m) { const p = path.join(BOT_FILES_DIR, decodeURIComponent(m[1].split('?')[0])); if (fs.existsSync(p)) return { mime: /\.png$/i.test(p) ? 'image/png' : 'image/jpeg', data: fs.readFileSync(p).toString('base64') }; }
        const headers = {};
        try { if (new URL(url).hostname.toLowerCase() === 'zernio.com' && A.keys.ZERNIO_API_TOKEN) headers.Authorization = 'Bearer ' + A.keys.ZERNIO_API_TOKEN; } catch (e) { /* not a URL */ }
        const ac = new AbortController(); const to = setTimeout(() => { try { ac.abort(); } catch (e) { /* noop */ } }, 12000);
        try {
            const r = await fetch(url, { headers, signal: ac.signal });
            if (!r.ok) return null;
            const ct = (r.headers.get('content-type') || '').split(';')[0];
            if (ct && !/^image\//.test(ct)) return null;
            const buf = Buffer.from(await r.arrayBuffer());
            if (!buf.length || buf.length > 4 * 1024 * 1024) return null;
            return { mime: ct || 'image/jpeg', data: buf.toString('base64') };
        } finally { clearTimeout(to); }
    } catch (e) { return null; }
}

async function imageIsReceipt(A, url) {
    if (!url) return null;
    A._receiptCheck = A._receiptCheck || {};
    if (A._receiptCheck[url] !== undefined) return A._receiptCheck[url];
    let res = null;
    try {
        const img = await loadImage(A, url);
        if (img) {
            const prompt = 'Це фото від клієнта інтернет-магазину одягу на етапі оплати. Це квитанція / скріншот банківського переказу чи оплати (сума, отримувач, «успішно», банк)? Фото одягу, кольору, товару, людини чи будь-що інше — НЕ квитанція. Відповідь ЛИШЕ JSON: {"receipt": true|false}';
            const r = await geminiFetch(A.keys.__geminiKeys || [], { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.data } }] }], generationConfig: { maxOutputTokens: 40, temperature: 0, thinkingConfig: { thinkingBudget: 0 } } });
            const j = await r.json().catch(() => ({}));
            const t = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
            const m = t.match(/\{[\s\S]*?\}/);
            if (m) { const o = JSON.parse(m[0]); if (typeof o.receipt === 'boolean') res = o.receipt; }
        }
    } catch (e) { logger.warn('[shopAgent] receiptCheck failed: ' + e.message, { sessionId: A.session && A.session.id }); res = null; }
    A._receiptCheck[url] = res;
    return res;
}

module.exports = { imageIsReceipt };
