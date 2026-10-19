'use strict';
/**
 * Сітка підбору розміру (зріст/вага) і межі від експерта — перед КОЖНИМ підбором розміру (19.10).
 * Товар у памʼяті розмови міг потрапити туди до того, як пошук товару почав класти сітку з CRM (давні розмови), або іншим шляхом,
 * що бере сирий товар каталогу. Тоді n_calc падав на запасний ключ воронки: без ключа — порожня сітка й «буде малий» (5 клієнтів 18.10),
 * з ключем — сітка без меж Олексія (62 з 83 погоджених прикладів). Порядок той самий, що в пошуку товару: товар → категорія → магазин.
 */
const { loadCatalog, crmFetch } = require('./lib');

const hasObj = (o) => !!(o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length);
const hasArr = (a) => Array.isArray(a) && a.length > 0;
const _shop = new Map(); // botId → { at, fit } — загальна сітка магазину, 60 с

async function shopFit(A) {
    const c = _shop.get(A.botId);
    if (c && Date.now() - c.at < 60 * 1000) return c.fit;
    const r = await crmFetch(A.keys, '/tenant/size-fit', {}, 4000).catch(() => ({}));
    const fit = (r && r.ok && r.data) || null;
    if (fit) _shop.set(A.botId, { at: Date.now(), fit });
    return fit || (c && c.fit) || {};
}

/** Обʼєкт товару/позиції → {fitChart, sizeRules} з каталогу CRM: власні, інакше категорії, інакше магазину. */
function resolveFor(raw, cats, shop) {
    const cat = (raw && cats.find((x) => x.id === (raw.categoryId || (raw.category && raw.category.id)))) || {};
    return {
        fitChart: hasObj(raw && raw.fitChart) ? raw.fitChart : hasObj(cat.fitChart) ? cat.fitChart : hasObj(shop.fitChart) ? shop.fitChart : null,
        sizeRules: hasArr(raw && raw.sizeRules) ? raw.sizeRules : hasArr(cat.sizeRules) ? cat.sizeRules : hasArr(shop.sizeRules) ? shop.sizeRules : [],
    };
}

async function ensureFit(A) {
    const p = A.ctx && A.ctx.product;
    if (!p || !p.sku) return;
    const items = Array.isArray(p.setItems) ? p.setItems : [];
    const needMain = !hasObj(p.fitChart);
    const needItems = items.some((it) => !hasObj(it && it.fitChart));
    if (!needMain && !needItems) return;
    let cat = { products: [], categories: [] };
    try { cat = await loadCatalog(A.botId, A.keys); } catch (e) { /* лишаємо запас n_calc */ }
    const shop = await shopFit(A);
    const bySku = (sku) => cat.products.find((x) => String(x.sku || '').toUpperCase() === String(sku || '').toUpperCase());
    if (needMain) {
        const f = resolveFor(bySku(p.sku) || p, cat.categories || [], shop);
        if (f.fitChart) { p.fitChart = f.fitChart; p.sizeRules = f.sizeRules; }
    }
    for (const it of items) {
        if (!it || hasObj(it.fitChart)) continue;
        const f = resolveFor(bySku(it.article || it.sku) || it, cat.categories || [], shop);
        if (f.fitChart) { it.fitChart = f.fitChart; it.sizeRules = f.sizeRules; }
    }
}

module.exports = { ensureFit, _resolveFor: resolveFor };
