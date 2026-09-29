'use strict';
/**
 * geminiKey.js — один спосіб викликати Gemini з резервним ключем.
 *
 * 2026-09-29 (goverla: власний GEMINI_API_KEY воронки вичерпав prepaid-кредити, 402) — розпізнавання
 * фото клієнта, голосові й автопривʼязка постів мовчки лягли, хоча у воронки ВЖЕ прописаний
 * GEMINI_CONNECTOR_ID (збережений конектор «Gemini для воронок») з робочим ключем. Код брав лише
 * перший ключ. Тепер: ключ воронки → ключ конектора воронки; ключ, що повернув 401/402/403/429,
 * на 30 хв опускається в кінець черги (не палимо зайвий запит на кожному ході).
 */
const { db } = require('@platform/db');

const BAD_TTL_MS = 30 * 60 * 1000;
const bad = new Map(); // key -> until

function isBad(k) { const t = bad.get(k); return !!(t && t > Date.now()); }
function markBad(k, status) { if ([401, 402, 403, 429].includes(Number(status))) bad.set(k, Date.now() + BAD_TTL_MS); }

function connectorKey(cfg) { const c = cfg || {}; return String(c.api_key || c.apiKey || c.key || '').trim(); }

/** Упорядкований список ключів для воронки: власний → конектор воронки. `keys` — уже завантажені funnelKeys (необовʼязково). */
async function geminiKeys(botId, keys) {
    let km = keys || null;
    if (!km || (!km.GEMINI_API_KEY && !km.GEMINI_CONNECTOR_ID)) {
        km = Object.fromEntries((await db.funnelKey.findMany({ where: { botId, key: { in: ['GEMINI_API_KEY', 'GEMINI_CONNECTOR_ID'] } }, select: { key: true, value: true } })).map((k) => [k.key, String(k.value || '').trim()]));
    }
    const out = [];
    if (km.GEMINI_API_KEY) out.push(String(km.GEMINI_API_KEY).trim());
    if (km.GEMINI_CONNECTOR_ID) {
        try {
            const c = await db.savedConnector.findUnique({ where: { id: String(km.GEMINI_CONNECTOR_ID).trim() }, select: { config: true } });
            const k = connectorKey(c && c.config);
            if (k) out.push(k);
        } catch (e) { /* немає конектора — лишається власний ключ */ }
    }
    const uniq = [...new Set(out.filter(Boolean))];
    return uniq.filter((k) => !isBad(k)).concat(uniq.filter(isBad));
}

/**
 * POST generateContent по черзі ключів. Повертає Response першого успішного ключа, або останню
 * відповідь (щоб виклик бачив справжній статус помилки). 503/500 теж пробує наступний ключ.
 */
async function geminiFetch(keyList, body, { model, signal } = {}) {
    const m = model || process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-latest';
    const list = Array.isArray(keyList) ? keyList.filter(Boolean) : [keyList].filter(Boolean);
    let last = null;
    for (const k of list) {
        last = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + encodeURIComponent(k), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body), signal });
        if (last.ok) return last;
        markBad(k, last.status);
        if (![401, 402, 403, 429, 500, 503].includes(last.status)) return last;
    }
    return last;
}

module.exports = { geminiKeys, geminiFetch, markBad };
