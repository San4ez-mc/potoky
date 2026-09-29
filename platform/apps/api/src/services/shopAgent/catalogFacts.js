'use strict';
/**
 * catalogFacts.js — точні дані з CRM для «каталожних» питань (ціна, кольори, розміри, наявність, «а є …?»).
 *
 * 2026-09-29 (рішення власника): усе, що є в CRM, бот знає сам і відповідає сам — такі питання НЕ йдуть менеджеру
 * й НЕ пишуться в базу знань. Живий кейс: «Які розміри є у наявності для кофти A0187?» при активному комплекті set1112
 * пішло менеджеру як «бот не знає», бо в фактах був лише комплект, без даних його позицій.
 *
 * Обсяг: активний товар (для комплекту — кожна позиція), допродаж, товари, названі артикулом у питанні, і товари
 * категорії, названої в питанні («а є джинси?»). Відсутність у переліку = немає в асортименті.
 */
const { loadCatalog } = require('./lib');

const CAT_WORDS = [
    ['кофт', /кофт|светр|джемпер/], ['джинс', /джинс/], ['штан', /штан|брюк|джинс/], ['костюм', /костюм|комплект/],
    ['футболк', /футболк/], ['лофер', /лофер/], ['взутт', /лофер|туфл|кросів|черевик|взутт/], ['куртк', /куртк|вітровк|пухов|кожанк/],
    ['бомбер', /бомбер/], ['сороч', /сороч/], ['шорт', /шорт/], ['худі', /худі/], ['жилет', /жилет/], ['шапк', /шапк/],
];

function colorOf(o) { const pr = (o.properties || []).find((q) => /кол|цвет/i.test(q.name || '')); return pr ? String(pr.value) : ''; }
function sizesFromText(pr) { const m = String(pr.presentationText || '').match(/Розміри[^:]*:\s*([^\n]+)/i); return m ? m[1].replace(/[🍂🍁❄️]/g, '').trim() : ''; }
function fmtProduct(pr) {
    const name = String(pr.customerName || pr.name || '').split('\n')[0].replace(/\.?\s*Артикул:?.*$/i, '').trim();
    const offers = Array.isArray(pr.offers) ? pr.offers : [];
    const inStockOffers = offers.filter((o) => o.inStock !== false);
    const colors = [...new Set(inStockOffers.map(colorOf).filter(Boolean))];
    const perColor = inStockOffers.map((o) => ({ c: colorOf(o), s: Array.isArray(o.effectiveSizes) && o.effectiveSizes.length ? o.effectiveSizes : (o.sizesCustomized ? (o.availableSizes || []) : []) })).filter((x) => x.c && x.s.length);
    const generalSizes = (Array.isArray(pr.sizes) && pr.sizes.length ? pr.sizes.join(', ') : '') || sizesFromText(pr);
    const available = !!(pr.alwaysAvailable || inStockOffers.length || !offers.length);
    const bulk = Array.isArray(pr.bulkPricing) && pr.bulkPricing.length ? ' (' + pr.bulkPricing.map((b) => (b.qty || b.minQty) + ' шт: ' + (b.total || b.price) + ' грн').join(', ') + ')' : '';
    const parts = [name + ' (арт. ' + pr.sku + ')', 'ціна ' + Number(pr.price) + ' грн' + bulk, available ? 'є в наявності' : 'НЕМАЄ в наявності'];
    if (colors.length) parts.push('кольори в наявності: ' + colors.join(', '));
    if (perColor.length) parts.push('розміри за кольорами: ' + perColor.map((x) => x.c + ' — ' + x.s.join(', ')).join('; '));
    else if (generalSizes) parts.push('розміри: ' + generalSizes);
    return '• ' + parts.join('; ');
}

async function catalogFacts(A, texts) {
    const { ctx } = A;
    const cat = await loadCatalog(A.botId, A.keys);
    const all = cat.products || [];
    const byId = new Map(all.map((p) => [String(p.id), p]));
    const bySku = new Map(all.map((p) => [String(p.sku || '').toUpperCase(), p]));
    const picked = []; const add = (p) => { if (p && !picked.includes(p)) picked.push(p); };
    const cur = ctx.product && (byId.get(String(ctx.product.id)) || bySku.get(String(ctx.product.sku || '').toUpperCase()));
    if (cur) {
        add(cur);
        for (const c of (cur.setComponents || [])) add(byId.get(String(c.productId)) || bySku.get(String(c.sku || '').toUpperCase()));
    }
    const up = ctx.product && Array.isArray(ctx.product.upsellItems) && ctx.product.upsellItems[0];
    if (up) add(byId.get(String(up.id)) || bySku.get(String(up.sku || '').toUpperCase()));
    const txt = (Array.isArray(texts) ? texts : [texts]).join('\n');
    for (const a of (txt.match(/\b[A-Za-z]{0,4}\d{3,8}\b/g) || [])) add(bySku.get(a.toUpperCase()));
    const low = txt.toLowerCase(); const missing = [];
    for (const [w, re] of CAT_WORDS) {
        if (!low.includes(w)) continue;
        const inCat = all.filter((p) => !p.isSet && re.test(String((p.customerName || '') + ' ' + (p.name || '') + ' ' + ((p.category && p.category.name) || '')).toLowerCase()));
        if (!inCat.length) missing.push(w);
        inCat.slice(0, 6).forEach(add);
    }
    const lines = picked.slice(0, 14).map(fmtProduct);
    if (missing.length) lines.push('• У каталозі НЕМАЄ товарів за словом: ' + missing.join(', ') + ' — так і скажи, запропонуй схоже з переліку, якщо доречно.');
    return lines.join('\n');
}

module.exports = { catalogFacts };
