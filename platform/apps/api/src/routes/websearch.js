'use strict';
// Пошук в інтернеті для agent-нод (Digital Hiring: boolean/x-ray по кандидатах).
// Ключ Serper приходить заголовком X-Serper-Key з ключів воронки — у .env нічого не тримаємо.
// Без ключа працює через DuckDuckGo HTML: гірша якість, зате нульова вартість і жодних креденшелів.
const express = require('express');
const router = express.Router();
const logger = require('@platform/logger');
const dns = require('dns').promises;

const SEARCH_TIMEOUT_MS = 15000;

// Роут ходить в мережу від імені сервера, тому:
//  1) вимагаємо секрет (як rag.js із X-Rag-Secret) — інакше це відкритий проксі;
//  2) забороняємо приватні адреси — інакше через /page можна дотягнутись
//     до внутрішніх сервісів (ORG API, redis, метадані хмари). Це SSRF.
const SEARCH_SECRET = process.env.SEARCH_SECRET || '';

function requireSearchSecret(req, res, next) {
    if (!SEARCH_SECRET) return next(); // локальна розробка без секрета
    if (req.headers['x-search-secret'] !== SEARCH_SECRET) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
}

const PRIVATE_HOST = /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd])/i;

function isPrivateIp(ip) {
    if (/^(127\.|10\.|169\.254\.|0\.)/.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (ip === '::1' || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip)) return true;
    return false;
}

/** Перевірка і за іменем, і за реальною IP-адресою: домен теж може вказувати всередину. */
async function assertPublicUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { throw new Error('Некоректний URL'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Дозволені лише http(s)');
    if (PRIVATE_HOST.test(u.hostname)) throw new Error('Внутрішні адреси читати не можна');

    let addrs;
    try { addrs = await dns.lookup(u.hostname, { all: true }); }
    catch { throw new Error(`Не вдалося визначити адресу ${u.hostname}`); }
    if (addrs.some((a) => isPrivateIp(a.address))) {
        throw new Error('Хост вказує на внутрішню адресу — читати не можна');
    }
    return u.toString();
}

function decodeDdgHref(href) {
    // DDG загортає посилання: //duckduckgo.com/l/?uddg=<encoded>&rut=...
    const m = /[?&]uddg=([^&]+)/.exec(href || '');
    if (m) { try { return decodeURIComponent(m[1]); } catch { /* нижче */ } }
    if (href && href.startsWith('//')) return 'https:' + href;
    return href || '';
}

function stripTags(html) {
    return String(html || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function searchSerper(query, limit, apiKey) {
    const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: Math.min(limit, 20) }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return (j.organic || []).slice(0, limit).map((r) => ({
        title: r.title || '', url: r.link || '', snippet: r.snippet || '',
    }));
}

async function searchDuckDuckGo(query, limit) {
    // Саме GET: на POST DDG віддає 202 і сторінку-заглушку (перевірено).
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
            // Без правдоподібного UA DDG віддає порожню сторінку.
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    const html = await res.text();
    // DDG на потік запитів відповідає 202 + сторінкою-заглушкою. Це НЕ «нічого не знайдено»:
    // якщо повернути порожній список, агент збреше користувачу, що результатів немає.
    if (res.status === 202 || /anomaly|captcha|challenge/i.test(html.slice(0, 4000))) {
        throw new Error('DuckDuckGo тимчасово блокує запити (ліміт безкоштовного доступу). Потрібен ключ Serper.');
    }
    if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);

    const out = [];
    const blockRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = blockRe.exec(html)) && out.length < limit) {
        out.push({ title: stripTags(m[2]), url: decodeDdgHref(m[1]), snippet: '' });
    }
    // Сніпети йдуть окремим класом і в тому ж порядку.
    const snipRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let i = 0; let sm;
    while ((sm = snipRe.exec(html)) && i < out.length) { out[i].snippet = stripTags(sm[1]); i++; }
    return out;
}

router.post('/', requireSearchSecret, async (req, res) => {
    const started = Date.now();
    const query = String(req.body?.query || req.query?.query || '').trim();
    const limit = Math.min(Math.max(Number(req.body?.limit) || 10, 1), 20);
    if (!query) return res.status(400).json({ error: 'Поле "query" обовʼязкове' });

    const apiKey = req.get('x-serper-key') || '';
    let engine = apiKey ? 'serper' : 'duckduckgo';
    let results = [];
    try {
        results = apiKey ? await searchSerper(query, limit, apiKey) : await searchDuckDuckGo(query, limit);
    } catch (e) {
        // Serper впав (ліміт/ключ) — не лишаємо агента без результату.
        if (apiKey) {
            logger.warn('[websearch] serper failed, fallback to ddg', { error: e.message });
            try { results = await searchDuckDuckGo(query, limit); engine = 'duckduckgo (fallback)'; }
            catch (e2) { return res.status(502).json({ error: `Пошук недоступний: ${e2.message}` }); }
        } else {
            return res.status(502).json({ error: `Пошук недоступний: ${e.message}` });
        }
    }

    logger.info('[websearch] done', { engine, query: query.slice(0, 80), found: results.length, ms: Date.now() - started });
    const body = { query, engine, count: results.length, results };
    if (engine.startsWith('duckduckgo')) {
        body.note = 'Працює безкоштовний резерв (DuckDuckGo): він витримує лише кілька запитів поспіль. Для стабільного пошуку потрібен ключ Serper у ключах воронки.';
    }
    res.json(body);
});

/**
 * Читання сторінки в текст. Легка альтернатива browser-agent `/read`:
 * без браузера, тому не бере JS-сторінки — зате не потребує мікросервіса.
 * Для складних випадків лишається browser_agent.
 */
router.post('/page', requireSearchSecret, async (req, res) => {
    let url;
    try {
        url = await assertPublicUrl(String(req.body?.url || req.query?.url || '').trim());
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
    const maxChars = Math.min(Math.max(Number(req.body?.maxChars) || 8000, 500), 40000);

    try {
        const r = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36' },
            signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        });
        const ctype = r.headers.get('content-type') || '';
        if (!/text|html|json|xml/i.test(ctype)) {
            return res.json({ url, status: r.status, contentType: ctype, text: '', note: 'Не текстовий контент — читати нічого.' });
        }
        const html = await r.text();
        const body = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
            .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
        const text = stripTags(body).slice(0, maxChars);
        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
        logger.info('[websearch] page read', { url: url.slice(0, 100), status: r.status, chars: text.length });
        res.json({ url, status: r.status, title: titleMatch ? stripTags(titleMatch[1]) : '', chars: text.length, text });
    } catch (e) {
        res.status(502).json({ error: `Не вдалося прочитати сторінку: ${e.message}` });
    }
});

module.exports = router;
