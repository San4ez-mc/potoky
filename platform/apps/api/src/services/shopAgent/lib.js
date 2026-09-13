'use strict';
/**
 * shopAgent/lib.js — спільні хелпери агента-продавця (goverla/covercar).
 *
 * Принцип: памʼять агента = той самий session.context, який уже читають/пишуть перевірені
 * js-ноди (n_lookup, n_calc, n_avail, n_pay_amount, n_crm_order, brewdrop…) і шаблони
 * message-нод. Коди нод і шаблони беремо з flowDefinition бота за id ноди — граф більше не
 * маршрутизує розмову, але лишається бібліотекою інструментів і текстів.
 */
const { db } = require('@platform/db');
const logger = require('@platform/logger');

function getByPath(source, path) {
    if (!source || typeof path !== 'string') return undefined;
    return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), source);
}
function setByPath(target, path, value) {
    const parts = String(path).split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) { if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}; cur = cur[parts[i]]; }
    cur[parts[parts.length - 1]] = value;
}
function safeJsonStringify(v) { try { return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)); } catch (e) { return String(v); } }
function renderTemplate(input, scope) {
    if (typeof input !== 'string') return input || '';
    return input.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_m, expr) => {
        const resolved = getByPath(scope, String(expr).trim());
        if (resolved === null || resolved === undefined) return '';
        if (typeof resolved === 'string') return resolved;
        if (typeof resolved === 'bigint') return resolved.toString();
        return safeJsonStringify(resolved);
    });
}
function stripLoneSurrogates(str) {
    return String(str || '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1');
}
function cleanJsonDeep(v) {
    if (typeof v === 'string') return stripLoneSurrogates(v);
    if (Array.isArray(v)) return v.map(cleanJsonDeep);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = cleanJsonDeep(x); return o; }
    return v;
}
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Вибір варіанта тексту message-ноди (text + variants[]) — рівномірно, але стабільно в межах ходу. */
function pickVariant(tpl, seed) {
    if (!tpl) return '';
    const list = [];
    if (tpl.text) list.push(tpl.text);
    const vs = tpl.variants;
    if (Array.isArray(vs)) for (const v of vs) { const t = typeof v === 'string' ? v : (v && (v.text || v.message)); if (t) list.push(t); }
    else if (vs && typeof vs === 'object') for (const v of Object.values(vs)) { const t = typeof v === 'string' ? v : (v && (v.text || v.message)); if (t) list.push(t); }
    if (!list.length) return '';
    const uniq = [...new Set(list.map((x) => String(x)))];
    let h = 0; const s = String(seed || Date.now()); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return uniq[h % uniq.length];
}

// ── Активи бота: коди js-нод, шаблони message-нод, тексти алертів, ключі ─────────────────────
const _assets = new Map(); // botId -> { at, nodes, keys }
const ASSET_TTL_MS = 60 * 1000;
async function loadAssets(botId, { force } = {}) {
    const c = _assets.get(botId);
    if (!force && c && Date.now() - c.at < ASSET_TTL_MS) return c;
    const [flow, keyRows, bot] = await Promise.all([
        db.flowDefinition.findUnique({ where: { botId } }),
        db.funnelKey.findMany({ where: { botId }, select: { key: true, value: true } }),
        db.bot.findUnique({ where: { id: botId }, select: { slug: true, name: true, settings: true } }),
    ]);
    const nodes = new Map();
    for (const n of ((flow && flow.nodes) || [])) nodes.set(n.id, { id: n.id, type: n.type, data: n.data || {} });
    const keys = Object.fromEntries(keyRows.map((k) => [k.key, String(k.value == null ? '' : k.value)]));
    const a = { at: Date.now(), nodes, keys, bot: bot || {}, botId };
    _assets.set(botId, a);
    return a;
}
function nodeCode(assets, nodeId) { const n = assets.nodes.get(nodeId); return (n && n.data && n.data.code) ? String(n.data.code) : ''; }
function nodeData(assets, nodeId) { const n = assets.nodes.get(nodeId); return (n && n.data) || {}; }
/** Текст message-ноди з рендером {{context.*}}/{{env.*}}. */
function messageText(assets, nodeId, ctx, seed) {
    const d = nodeData(assets, nodeId);
    const raw = pickVariant({ text: d.text || d.message || '', variants: d.variants }, seed);
    return norm(renderTemplate(raw, { context: ctx, env: assets.keys })).replace(/ *\n */g, '\n');
}
/** Рендер шаблону з ЗБЕРЕЖЕННЯМ переносів рядків (для довгих текстів типу реквізитів). */
function messageTextMultiline(assets, nodeId, ctx, seed) {
    const d = nodeData(assets, nodeId);
    const raw = pickVariant({ text: d.text || d.message || '', variants: d.variants }, seed);
    return renderTemplate(raw, { context: ctx, env: assets.keys }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** Поля notifyTg-ноди (alertTitle/alertMain/alertDetails/alertPhoto), відрендерені. */
function alertFields(assets, nodeId, ctx) {
    const d = nodeData(assets, nodeId); const scope = { context: ctx, env: assets.keys };
    return { title: renderTemplate(d.alertTitle || '', scope), main: renderTemplate(d.alertMain || '', scope), details: renderTemplate(d.alertDetails || '', scope), photoUrl: d.alertPhoto ? renderTemplate(d.alertPhoto, scope) : '' };
}

/** Виконати код js-ноди так само, як двигун: async IIFE з тими ж глобалами; повернений обʼєкт зливається в ctx. */
async function runNodeCode(code, { ctx, keys, user, session, input, label, timeoutMs = 60000 }) {
    if (!code) return { ok: false, error: 'empty code' };
    const started = Date.now();
    try {
        const notifyBalanceIssue = () => {};
        const fn = new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto', 'notifyBalanceIssue',
            'return (async function(){"use strict";\n' + code + '\n})();');
        const res = await Promise.race([
            fn(ctx, user || {}, { id: session && session.id, state: session && session.state }, input || '', keys || {}, fetch, Buffer, FormData, Blob, console, require('crypto'), notifyBalanceIssue),
            new Promise((_, rej) => setTimeout(() => rej(new Error('JS tool timeout')), timeoutMs)),
        ]);
        if (res && typeof res === 'object' && !Array.isArray(res)) Object.assign(ctx, res);
        return { ok: true, result: res, ms: Date.now() - started };
    } catch (e) {
        logger.warn('[shopAgent] tool failed: ' + (label || '?') + ': ' + e.message, { sessionId: session && session.id });
        return { ok: false, error: e.message, ms: Date.now() - started };
    }
}

// ── CRM ───────────────────────────────────────────────────────────────────────────────────────
function crmBase(keys) { const raw = String(keys.CRM_API_URL || keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').trim().replace(/\/$/, ''); return raw.endsWith('/api') ? raw : raw + '/api'; }
function crmHeaders(keys, json) { const h = { Authorization: 'Bearer ' + String(keys.CRM_API_KEY || '').trim(), Accept: 'application/json' }; if (json) h['Content-Type'] = 'application/json'; return h; }
async function crmFetch(keys, path, opts = {}, timeoutMs = 8000) {
    const ac = new AbortController(); const to = setTimeout(() => { try { ac.abort(); } catch (e) { /* noop */ } }, timeoutMs);
    try {
        const r = await fetch(crmBase(keys) + path, { ...opts, headers: { ...crmHeaders(keys, !!opts.body), ...(opts.headers || {}) }, signal: ac.signal });
        const j = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, json: j, data: j && j.data };
    } catch (e) { return { ok: false, status: 0, error: e.message, json: {}, data: null }; }
    finally { clearTimeout(to); }
}
const _catalog = new Map(); // botId -> {at, products, ads}
async function loadCatalog(botId, keys, { force } = {}) {
    const c = _catalog.get(botId);
    if (!force && c && Date.now() - c.at < 60 * 1000) return c;
    const [p, a] = await Promise.all([crmFetch(keys, '/products?take=300'), crmFetch(keys, '/ads?take=300')]);
    const v = { at: Date.now(), products: Array.isArray(p.data) ? p.data : [], ads: Array.isArray(a.data) ? a.data : [], ok: p.ok };
    if (p.ok) _catalog.set(botId, v);
    return v;
}
async function loadCategories(botId, keys) { const r = await crmFetch(keys, '/categories'); return Array.isArray(r.data) ? r.data : []; }

module.exports = { db, logger, getByPath, setByPath, renderTemplate, safeJsonStringify, stripLoneSurrogates, cleanJsonDeep, norm, pickVariant, loadAssets, nodeCode, nodeData, messageText, messageTextMultiline, alertFields, runNodeCode, crmBase, crmHeaders, crmFetch, loadCatalog, loadCategories };
