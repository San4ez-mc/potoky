'use strict';
/**
 * colorPhotoMatch.js — який із кольорів нашого товару на фото, яке надіслав клієнт (3.11.2026, Edits Олексія: Яна Горулько).
 *
 * Клієнтка переслала НАШЕ фото світло-сірої кофти й питала «оце який колір?» — бот двічі відповів «за фото я не можу визначити відтінок».
 * Тепер порівнюємо фото клієнта з фото кольорів цього товару з CRM (offers[].images за властивістю «Колір»): vision отримує підписані
 * еталони й фото клієнта і каже, котрий колір збігається — або null, якщо не впевнений (тоді поведінка як раніше: просимо назвати колір).
 * Один дешевий запит на фото; результат кешується на хід.
 */
const { geminiFetch } = require('../geminiKey');
const { logger } = require('./lib');
const { loadImage } = require('./receiptCheck');

const MAX_COLORS = 6;

function colorRefs(product, base) {
    const abs = (u) => (/^https?:/.test(String(u)) ? String(u) : base + (String(u).charAt(0) === '/' ? u : '/' + u));
    const seen = new Map();
    for (const of of (product && product.offers) || []) {
        const pc = (of.properties || []).find((q) => /кол|цвет/i.test(q.name || ''));
        const color = pc && String(pc.value || '').trim();
        const img = Array.isArray(of.images) && of.images.find(Boolean);
        if (color && img && !seen.has(color.toLowerCase())) seen.set(color.toLowerCase(), { color, url: abs(img) });
    }
    return [...seen.values()].slice(0, MAX_COLORS);
}

/** Назва кольору з палітри товару, що збігається з фото клієнта, або null (не впевнені / нема еталонів / помилка). */
async function matchPhotoColor(A, url, product) {
    if (!url || !product) return null;
    A._colorPhotoMatch = A._colorPhotoMatch || {};
    if (A._colorPhotoMatch[url] !== undefined) return A._colorPhotoMatch[url];
    let res = null;
    try {
        const base = String((A.keys && A.keys.CRM_PUBLIC_BASE) || 'https://pcrm.fineko.space').replace(/\/$/, '');
        const refs = colorRefs(product, base);
        if (refs.length >= 2) {
            const loaded = [];
            for (const r of refs) { const img = await loadImage(A, r.url); if (img) loaded.push({ color: r.color, img }); }
            const client = await loadImage(A, url);
            if (client && loaded.length >= 2) {
                const parts = [{ text: 'Ми продаємо один товар у кількох кольорах. Нижче еталонні фото наших кольорів, кожне з підписом, а в кінці — фото від клієнта. Визнач, який з НАШИХ кольорів на фото клієнта. Якщо це не наш товар, не видно кольору або ти не впевнений — null. Відповідь ЛИШЕ JSON: {"color": "<точна назва кольору з підписів>" або null}.' }];
                for (const l of loaded) { parts.push({ text: 'Еталон — колір «' + l.color + '»:' }); parts.push({ inline_data: { mime_type: l.img.mime, data: l.img.data } }); }
                parts.push({ text: 'Фото клієнта:' }); parts.push({ inline_data: { mime_type: client.mime, data: client.data } });
                const r = await geminiFetch((A.keys && A.keys.__geminiKeys) || [], { contents: [{ parts }], generationConfig: { maxOutputTokens: 60, temperature: 0, thinkingConfig: { thinkingBudget: 0 } } });
                const j = await r.json().catch(() => ({}));
                const t = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
                const m = t.match(/\{[\s\S]*?\}/);
                if (m) {
                    const c = String(JSON.parse(m[0]).color || '').trim().toLowerCase();
                    const hit = loaded.find((l) => l.color.toLowerCase() === c);
                    if (hit) res = hit.color;
                }
            }
        }
    } catch (e) { logger.warn('[shopAgent] colorPhotoMatch: ' + e.message, { sessionId: A.session && A.session.id }); res = null; }
    A._colorPhotoMatch[url] = res;
    return res;
}

module.exports = { matchPhotoColor, colorRefs };
