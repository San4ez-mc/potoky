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
function fmtProduct(pr, withDesc, adsByProduct) {
    const name = String(pr.customerName || pr.name || '').split('\n')[0].replace(/\.?\s*Артикул:?.*$/i, '').trim();
    const offers = Array.isArray(pr.offers) ? pr.offers : [];
    const inStockOffers = offers.filter((o) => o.inStock !== false);
    const colors = [...new Set(inStockOffers.map(colorOf).filter(Boolean))];
    const perColor = inStockOffers.map((o) => ({ c: colorOf(o), s: Array.isArray(o.effectiveSizes) && o.effectiveSizes.length ? o.effectiveSizes : (o.sizesCustomized ? (o.availableSizes || []) : []) })).filter((x) => x.c && x.s.length);
    const generalSizes = (Array.isArray(pr.sizes) && pr.sizes.length ? pr.sizes.join(', ') : '') || sizesFromText(pr);
    // «Немає в наявності» в CRM (outOfStock, 03.10) — перекриває все інше (товар без варіантів інакше вважався наявним).
    const available = !pr.outOfStock && !!(pr.alwaysAvailable || inStockOffers.length || !offers.length);
    const bulk = Array.isArray(pr.bulkPricing) && pr.bulkPricing.length ? ' (' + pr.bulkPricing.map((b) => (b.qty || b.minQty) + ' шт: ' + (b.total || b.price) + ' грн').join(', ') + ')' : '';
    const parts = [name + ' (арт. ' + pr.sku + ')', 'ціна ' + Number(pr.price) + ' грн' + bulk, available ? 'є в наявності' : 'НЕМАЄ в наявності'];
    if (colors.length) parts.push('кольори в наявності: ' + colors.join(', '));
    if (perColor.length) parts.push('розміри за кольорами: ' + perColor.map((x) => x.c + ' — ' + x.s.join(', ')).join('; '));
    else if (generalSizes) parts.push('розміри: ' + generalSizes);
    if (withDesc) {
        // Опис і нотатки з CRM — для питань про властивості («є капюшон?», «змійка на всю довжину?») і порівнянь.
        const desc = String(pr.presentationText || '').split('\n').map((l) => l.replace(/^[\s✔️🧶🎨📏🍂⚡️💵👉❄️🍁]+/u, '').trim()).filter((l) => l && !/ціна|₴|грн|Артикул/i.test(l)).join('; ');
        const notes = String(pr.aiNotes || '').replace(/\s+/g, ' ').trim();
        if (desc) parts.push('опис: ' + desc.slice(0, 350));
        if (notes) parts.push('деталі: ' + notes.slice(0, 350));
        // Власні тексти магазину — підписи постів/реклам, привʼязаних до цього товару в CRM (Edit e0cb8b5c: склад «80% акрил,
        // 20% віскоза» є в пості, а в картці лише «ангора» — бот відповідав неповно). Лише рядки-характеристики, без закликів.
        const caps = [...new Set((adsByProduct && adsByProduct.get(String(pr.id))) || [])];
        const capFacts = [...new Set(caps.flatMap((c) => String(c).split('\n')).map((l) => l.replace(/^[\s✔️🧶🎨📏🍂⚡️💵👉❄️🍁📌📩•\-]+/u, '').trim()).filter((l) => l.length > 6 && /:/.test(l) && !/(щоб замовити|пишіть|direct|ціна|₴|грн|артикул|встигніть)/i.test(l)))];
        if (capFacts.length) parts.push('з постів магазину: ' + capFacts.join(' / ').slice(0, 400));
    }
    return '• ' + parts.join('; ');
}

async function catalogFacts(A, texts, opts = {}) {
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
    // Товари щойно показаного списку («які з показаних кофт…?»).
    for (const s0 of String(ctx.catalogHintSkus || '').split(',').map((x) => x.trim()).filter(Boolean)) add(bySku.get(s0.toUpperCase()));
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
    const adsByProduct = new Map();
    if (opts.withDesc) for (const ad of (cat.ads || [])) { if (ad && ad.productId && ad.captionText) { const k = String(ad.productId); if (!adsByProduct.has(k)) adsByProduct.set(k, []); adsByProduct.get(k).push(ad.captionText); } }
    const lines = picked.slice(0, 14).map((pr) => fmtProduct(pr, !!opts.withDesc, adsByProduct));
    if (missing.length) lines.push('• У каталозі НЕМАЄ товарів за словом: ' + missing.join(', ') + ' — так і скажи, запропонуй схоже з переліку, якщо доречно.');
    return lines.join('\n');
}

async function catalogProducts(A, texts) {
    // Ті самі товари, що й у фактах, — для фото при порівнянні.
    const cat = await loadCatalog(A.botId, A.keys);
    const all = cat.products || []; const bySku = new Map(all.map((p) => [String(p.sku || '').toUpperCase(), p]));
    const out = []; const add = (p) => { if (p && !out.includes(p)) out.push(p); };
    const txt = (Array.isArray(texts) ? texts : [texts]).join('\n');
    for (const a of (txt.match(/\b[A-Za-z]{0,4}\d{3,8}\b/g) || [])) add(bySku.get(a.toUpperCase()));
    for (const s0 of String(A.ctx.catalogHintSkus || '').split(',').map((x) => x.trim()).filter(Boolean)) add(bySku.get(s0.toUpperCase()));
    if (A.ctx.product && A.ctx.product.sku) add(bySku.get(String(A.ctx.product.sku).toUpperCase()));
    return out;
}

/**
 * Товари ІНШОЇ категорії, про яку клієнт питає посеред розмови («А джинси у вас є?» під час оформлення кофти) — щоб
 * разом із відповіддю показати їх фото (2026-09-30, правка 0a8d38b5: «Не надіслав фото джинсів»). Поточний товар,
 * позиції його комплекту й допродаж не повертаються — їх клієнт уже бачив.
 */
async function otherCategoryProducts(A, texts) {
    const { ctx } = A;
    const cat = await loadCatalog(A.botId, A.keys);
    const all = cat.products || [];
    const cur = ctx.product || {};
    const skip = new Set([String(cur.sku || '').toUpperCase()].concat((cur.setItems || []).map((it) => String(it.article || '').toUpperCase())).concat(((cur.upsellItems || [])[0] ? [String(cur.upsellItems[0].sku || '').toUpperCase()] : [])));
    const low = (Array.isArray(texts) ? texts : [texts]).join(' ').toLowerCase();
    const curCat = String(((all.find((p) => String(p.sku).toUpperCase() === String(cur.sku || '').toUpperCase()) || {}).category || {}).name || '').toLowerCase();
    const out = [];
    for (const [w, re] of CAT_WORDS) {
        if (!low.includes(w) || (curCat && re.test(curCat))) continue;
        all.filter((p) => !p.isSet && !skip.has(String(p.sku || '').toUpperCase()) && re.test(String((p.customerName || '') + ' ' + (p.name || '') + ' ' + ((p.category && p.category.name) || '')).toLowerCase()))
            .forEach((p) => { if (!out.includes(p)) out.push(p); });
    }
    return out.slice(0, 3);
}

/** Розміри, у яких шиється колір: CRM effectiveSizes (або власноруч задані availableSizes). null — даних нема (колір вважається наявним). */
function offerSizes(o) { if (Array.isArray(o.effectiveSizes) && o.effectiveSizes.length) return o.effectiveSizes; if (o.sizesCustomized && Array.isArray(o.availableSizes)) return o.availableSizes; return null; }
const sizeKey = (s) => String(s || '').toUpperCase().trim().replace(/^2XL$/, 'XXL').replace(/^3XL$/, 'XXXL').replace(/^4XL$/, 'XXXXL');
/** Чи є колір у розмірі за даними CRM (2026-10-05, Edit 26658740: графітові джинси j0032 — лише XS і L). Єдине джерело для
 * питання про колір, звірки обраного кольору й речей комплекту. */
function colorHasSize(product, color, size) {
    if (!size || !color) return true;
    const offers = (product && Array.isArray(product.offers)) ? product.offers : [];
    const own = offers.filter((o) => colorOf(o).toLowerCase() === String(color).toLowerCase());
    const lists = own.map(offerSizes).filter(Boolean);
    if (!lists.length) return true;
    return lists.some((l) => l.map(sizeKey).includes(sizeKey(size)));
}

module.exports = { catalogFacts, catalogProducts, otherCategoryProducts, colorHasSize };
