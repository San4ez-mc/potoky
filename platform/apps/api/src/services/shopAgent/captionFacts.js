'use strict';
/**
 * Товар за ФАКТАМИ з підпису допису/реклами без артикула (21.10, lilitvinovvva): ціна («Нова ціна костюму: 1799 ₴»), кольори
 * («Кольори: чорний, графітовий, хакі…»), розміри («Розміри: S … XXXL»), звірені з даними CRM (ціна товару, кольори й розміри
 * варіантів). Слова «флісовий костюм, полар-фліс» є в назвах трьох костюмів, а автоприв'язка за фото переплутала схожі half-zip
 * костюми (5 дописів «Останні дні розпродажу…» → SH617927 за 2179 грн, хоча ціна, кольори й розміри в підписі — A0068).
 * Одне джерело для бота (productMatch) і автоприв'язки дописів (adAutoBind) — урок 15.25 про копії логіки.
 */

const norm5 = (s) => String(s || '').toLowerCase().replace(/[^а-яіїєґa-z-]/gi, '').slice(0, 5);
const nzSize = (z) => String(z || '').toUpperCase().trim().replace(/^3XL$/, 'XXXL').replace(/^2XL$/, 'XXL');

/** Факти з тексту підпису: ціни (грн/₴, ≥100), кольори з рядка «Кольори:», розміри з рядка «Розміри:». */
function parseCaption(caption) {
    const s = String(caption || '');
    const prices = (s.match(/(\d[\d\s]{2,6})\s*(?:₴|грн)/gi) || []).map((x) => Number(String(x).replace(/[^\d]/g, ''))).filter((n) => n >= 100);
    const colLine = (s.match(/Кольор[иа]?\s*:\s*([^\n]+)/i) || [])[1] || '';
    const colors = colLine.split(/[,;]+/).map(norm5).filter((c) => c.length >= 3);
    const sizLine = ((s.match(/Розмір[и]?\s*:\s*([^\n]+)/i) || [])[1] || '').toUpperCase();
    const sizes = (sizLine.match(/(?<![A-Z0-9])(XXXL|XXL|XL|XS|S|M|L|3XL|2XL)(?![A-Z0-9])/g) || []).map(nzSize);
    return { prices, colors, sizes };
}

function productColors(p) {
    const out = new Set();
    for (const o of (Array.isArray(p.offers) ? p.offers : [])) for (const q of (o.properties || [])) if (/кол|цвет/i.test(q.name || '')) out.add(norm5(q.value));
    return [...out];
}
function productSizesAll(p) {
    const l = (Array.isArray(p.sizes) ? p.sizes : []).concat(...(Array.isArray(p.offers) ? p.offers : []).map((o) => o.effectiveSizes || []));
    return [...new Set(l.map(nzSize))];
}

/** Бали товару за фактами підпису: ціна збігається — 3; кожен колір підпису є/нема у товару — +1/−1; розміри так само. null — ціна не збігається. */
function scoreProduct(facts, p) {
    if (!p || p.isSet || !(Number(p.price) > 0) || !facts.prices.includes(Number(p.price))) return null;
    const pc = productColors(p), ps = productSizesAll(p);
    const colHit = facts.colors.filter((c) => pc.includes(c)).length;
    const szHit = facts.sizes.filter((z) => ps.includes(z)).length;
    return 3 + colHit - (facts.colors.length - colHit) + szHit - (facts.sizes.length - szHit);
}

/**
 * Явний лідер за фактами підпису серед products: {product, score} або null. Потрібні ціна + хоч кольори чи розміри; лідер — ≥5 балів
 * і на ≥2 більше за наступного. Інакше — не вгадуємо.
 */
function pickByCaptionFacts(caption, products) {
    const facts = parseCaption(caption);
    if (!facts.prices.length || !(facts.colors.length || facts.sizes.length)) return null;
    const scored = (products || []).map((p) => ({ product: p, score: scoreProduct(facts, p) })).filter((x) => x.score != null).sort((a, b) => b.score - a.score);
    if (!scored.length || scored[0].score < 5) return null;
    if (scored.length > 1 && scored[0].score - scored[1].score < 2) return null;
    return scored[0];
}

module.exports = { parseCaption, pickByCaptionFacts, scoreProduct };
