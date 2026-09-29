'use strict';
/**
 * igLink.js — посилання на допис Instagram, надіслане ТЕКСТОМ («Хочу цей костюм https://www.instagram.com/p/Das03JygYEX/»).
 *
 * 2026-09-29 (правка f170331d, f1ght3r1990): клієнт вставив посилання замість «переслати», бот його не розбирав і показав
 * список «інших костюмів». Рекламні дописи часто відсутні у стрічці (/me/media їх не віддає), а oEmbed вимагає рев'ю Meta,
 * тому беремо відкриту сторінку допису: у тегах og:title/og:description є підпис, у og:image — обкладинка. Далі хід
 * обробляється як пересланий допис (підпис → артикул/звʼязка в CRM /ads; обкладинка → розпізнавання фото).
 */
const { logger } = require('./lib');

const cache = new Map(); // shortcode -> { at, post }
const TTL_MS = 6 * 3600 * 1000;
const LINK_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i;

function decodeEntities(s) {
    return String(s || '')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'");
}
function meta(html, prop) {
    const m = html.match(new RegExp('<meta[^>]+property="' + prop + '"[^>]+content="([^"]*)"', 'i')) || html.match(new RegExp('<meta[^>]+content="([^"]*)"[^>]+property="' + prop + '"', 'i'));
    return m ? decodeEntities(m[1]) : '';
}

/** Повертає { kind, mediaId, caption, url, permalink } або null. url — обкладинка (для розпізнавання фото). */
async function resolveIgLink(text) {
    const m = String(text || '').match(LINK_RE);
    if (!m) return null;
    const kind = /reel|tv/i.test(m[1]) ? 'reel' : 'post';
    const sc = m[2];
    const c = cache.get(sc);
    if (c && Date.now() - c.at < TTL_MS) return c.post;
    const permalink = 'https://www.instagram.com/' + (kind === 'reel' ? 'reel' : 'p') + '/' + sc + '/';
    const ac = new AbortController(); const to = setTimeout(() => { try { ac.abort(); } catch (e) { } }, 7000);
    try {
        const r = await fetch(permalink, { headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'uk' }, signal: ac.signal });
        if (!r.ok) return null;
        const html = await r.text();
        const title = meta(html, 'og:title');
        const desc = meta(html, 'og:description');
        // og:title: «<профіль> в Instagram: "<підпис>"»; og:description: «N likes, … on <дата>: "<підпис>"».
        const pick = (s) => { const q = s.match(/:\s*"([\s\S]+)"\s*$/); return q ? q[1] : ''; };
        const caption = (pick(desc) || pick(title) || '').trim();
        const image = meta(html, 'og:image');
        if (!caption && !image) return null;
        const post = { kind, mediaId: 'sc_' + sc, caption, url: image || '', permalink, fromLink: true };
        cache.set(sc, { at: Date.now(), post });
        return post;
    } catch (e) {
        logger.warn('[shopAgent] resolveIgLink failed: ' + e.message, { shortcode: sc });
        return null;
    } finally { clearTimeout(to); }
}

module.exports = { resolveIgLink, LINK_RE };
