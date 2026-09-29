'use strict';
/**
 * geminiKey.js — один спосіб викликати Gemini з резервними ключами/провайдерами.
 *
 * 2026-09-29 (goverla: власний GEMINI_API_KEY воронки вичерпав prepaid-кредити, 402) — розпізнавання
 * фото клієнта, голосові й автопривʼязка постів мовчки лягли. Конектор «Gemini для воронок» — free tier
 * (20 запитів/добу), для бою замало. Тому черга така:
 *   1) ключ воронки GEMINI_API_KEY → 2) ключ конектора GEMINI_CONNECTOR_ID →
 *   3) Claude (CLAUDE_CONNECTOR_ID / CLAUDE_API_KEY воронки) — для тексту й зображень →
 *   4) OpenAI Whisper (OPENAI_API_KEY / конектор GPT) — лише для аудіо (розшифровка).
 * Відповідь 3)/4) загортаємо у формат Gemini ({candidates:[{content:{parts:[{text}]}}]}), тож місця
 * виклику не змінюються. Ключ, що повернув 401/402/403/429, на 30 хв іде в кінець черги.
 */
const { db } = require('@platform/db');

const BAD_TTL_MS = 30 * 60 * 1000;
const CLAUDE_MODEL = process.env.VISION_FALLBACK_CLAUDE_MODEL || 'claude-sonnet-4-6';
const bad = new Map(); // key -> until

function isBad(k) { const t = bad.get(k); return !!(t && t > Date.now()); }
function markBad(k, status) { if ([401, 402, 403, 429].includes(Number(status))) bad.set(k, Date.now() + BAD_TTL_MS); }

function cfgKey(cfg) { const c = cfg || {}; return String(c.api_key || c.apiKey || c.key || '').trim(); }
async function connectorKey(id) {
    if (!id) return '';
    try { const c = await db.savedConnector.findUnique({ where: { id: String(id).trim() }, select: { config: true } }); return cfgKey(c && c.config); } catch (e) { return ''; }
}

const KEY_NAMES = ['GEMINI_API_KEY', 'GEMINI_CONNECTOR_ID', 'CLAUDE_API_KEY', 'CLAUDE_CONNECTOR_ID', 'OPENAI_API_KEY', 'GPT_API_KEY', 'OPENAI_CONNECTOR_ID', 'GPT_CONNECTOR_ID'];

/**
 * Упорядкований список: Gemini-ключі як є, резерви з префіксом 'claude:' / 'openai:'.
 * `keys` — уже завантажені funnelKeys (необовʼязково).
 */
async function geminiKeys(botId, keys) {
    let km = keys || {};
    if (!KEY_NAMES.some((n) => km[n])) {
        km = Object.fromEntries((await db.funnelKey.findMany({ where: { botId, key: { in: KEY_NAMES } }, select: { key: true, value: true } })).map((k) => [k.key, String(k.value || '').trim()]));
    }
    const gem = [String(km.GEMINI_API_KEY || '').trim(), await connectorKey(km.GEMINI_CONNECTOR_ID)].filter(Boolean);
    const cl = String(km.CLAUDE_API_KEY || '').trim() || await connectorKey(km.CLAUDE_CONNECTOR_ID);
    let oa = String(km.OPENAI_API_KEY || km.GPT_API_KEY || '').trim() || await connectorKey(km.OPENAI_CONNECTOR_ID || km.GPT_CONNECTOR_ID);
    if (!oa) {
        try { const any = await db.savedConnector.findFirst({ where: { type: 'openai_gpt4', isActive: true }, select: { config: true } }); oa = cfgKey(any && any.config); } catch (e) { /* нема — без аудіо-резерву */ }
    }
    const uniq = [...new Set(gem)];
    const ordered = uniq.filter((k) => !isBad(k)).concat(uniq.filter(isBad));
    if (cl) ordered.push('claude:' + cl);
    if (oa) ordered.push('openai:' + oa);
    return ordered;
}

function partsOf(body) {
    const b = typeof body === 'string' ? JSON.parse(body) : body;
    return ((((b && b.contents) || [])[0] || {}).parts) || [];
}
function geminiShaped(text) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: String(text || '') }] } }], _fallback: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function viaClaude(key, parts, signal) {
    const content = [];
    for (const p of parts) {
        if (p.text) content.push({ type: 'text', text: p.text });
        else if (p.inline_data && /^image\//i.test(p.inline_data.mime_type || '')) content.push({ type: 'image', source: { type: 'base64', media_type: /^image\/(jpeg|png|gif|webp)$/i.test(p.inline_data.mime_type) ? p.inline_data.mime_type.toLowerCase() : 'image/jpeg', data: p.inline_data.data } });
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1200, temperature: 0, messages: [{ role: 'user', content }] }),
    });
    if (!r.ok) return r;
    const j = await r.json();
    return geminiShaped(((j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')));
}

async function viaWhisper(key, audioPart, signal) {
    const mime = audioPart.inline_data.mime_type || 'audio/mp4';
    const ext = (/ogg/i.test(mime) ? 'ogg' : /mpeg|mp3/i.test(mime) ? 'mp3' : /wav/i.test(mime) ? 'wav' : /webm/i.test(mime) ? 'webm' : 'm4a');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audioPart.inline_data.data, 'base64')], { type: mime }), 'voice.' + ext);
    form.append('model', 'whisper-1');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form, signal });
    if (!r.ok) return r;
    const j = await r.json();
    return geminiShaped(String(j.text || '').trim());
}

/**
 * POST generateContent по черзі ключів. Повертає Response першого успішного (Gemini-формат), або
 * останню відповідь (щоб виклик бачив справжній статус помилки). 500/503 — одна повторна спроба.
 */
async function geminiFetch(keyList, body, { model, signal } = {}) {
    const m = model || process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-latest';
    const list = Array.isArray(keyList) ? keyList.filter(Boolean) : [keyList].filter(Boolean);
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const parts = partsOf(payload);
    const audio = parts.find((p) => p.inline_data && /^audio\//i.test(p.inline_data.mime_type || ''));
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        let transient = false;
        for (const k of list) {
            if (attempt && isBad(k)) continue;
            try {
                if (k.startsWith('claude:')) { if (audio) continue; last = await viaClaude(k.slice(7), parts, signal); }
                else if (k.startsWith('openai:')) { if (!audio) continue; last = await viaWhisper(k.slice(7), audio, signal); }
                else last = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + encodeURIComponent(k), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal });
            } catch (e) {
                if (e && e.name === 'AbortError') throw e;
                transient = true; continue;
            }
            if (last.ok) return last;
            markBad(k, last.status);
            if (last.status === 500 || last.status === 503 || last.status === 529) transient = true;
            else if (![400, 401, 402, 403, 404, 429].includes(last.status)) return last;
        }
        if (!transient) break;
        await new Promise((r) => setTimeout(r, 1500));
    }
    return last || new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'жоден провайдер не прийняв запит' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
}

module.exports = { geminiKeys, geminiFetch, markBad };
