'use strict';
/**
 * shopAgent/basket.js — кошик із кількох РІЗНИХ товарів (аудит B4, 14.10; власник: «роби, я думав це давно готово»).
 *
 * Чому: бот вів від картки до кольору лише ОДИН товар (ctx.product). Другий товар ставав «додатковою позицією» без розміру й кольору
 * («КОЛІР НЕ ОБРАНО») або підміняв перший: khalilov_ruslan (куртка + светр + 2 футболки → лише куртка, і не та), budny.y (дві різні
 * кофти → одна), krevula (кофта, джинси, лофери → футболка).
 *
 * Модель (стан — лише ДАНІ, крок обчислюється з них):
 *   ctx.product (+ розмір/колір/наявність)  — товар, який бот зараз веде («фокус»), тими самими секціями policy, що й завжди;
 *   ctx.basket.queue  — інші товари, які клієнт хоче купити, ще не пройдені ({sku} або {category, ref} + колір/розмір/к-сть зі слів);
 *   ctx.basket.lines  — уже пройдені товари (розмір, колір, к-сть, ціна) у формі «додаткової позиції» (extraItems);
 *   ctx.basket.anchor — знімок першого (головного) товару, поки бот веде товари з черги; потім він повертається у фокус.
 * Готові рядки йдуть у суму, CRM і постачальнику через ctx.extraItems — той самий шлях, що вже працює для «і ще джинси 32»
 * (n_pay_amount → orderExtras → n_crm_order / supplierDispatch), без змін у них.
 * Вмикається ключем воронки BASKET_V1=1.
 */

// Стан фокус-товару в ctx / ctx.agent (те, що скидає resetForNewProduct, + показ картки). Параметри ЛЮДИНИ (зріст/вага) не тут.
const FOCUS_KEYS = ['product', 'supplier', 'recommendedSize', 'sizeSource', 'sizeReplyText', 'sizeColorFollowup', 'sizeOutOfRange', 'sizeOorReason', 'sizeOorAlternative', 'isSetSizeCalc', 'setSizesText', 'setSizeMap', 'setSizeOor', 'colorChoice', 'available', 'availReason', 'orderUnits', 'orderUnitsText', 'orderUnitsTotal', 'orderQty', 'setMode', 'setPick', 'setSelection', 'availChecked', 'unavailableColors', 'availableColorsNow', 'presentedAt', 'lastPresentedSku'];
const FOCUS_AGENT_KEYS = ['presentedSku', 'setOriginal', 'setPricing', 'setStageSent', 'setEditNote', 'setParams', 'setItemsAll', 'setItemColorHints', 'setColorHints', 'setColorsResolved', 'availKey', 'sizeCalcKey', 'originSet', 'setColorAskingArticle', 'setColorPhotosFor', 'setSizesAsked2', 'chartSentFor', 'pendingColor', 'pendingColorRaw', 'pendingUnits', 'pendingQty', 'pairSizes', 'pairWho', 'personsKey', 'sizeVerifyAsked', 'sizeVerifyMissingAsked', 'sizeClaim', 'setAskedAt', 'setNamedItem', 'setGeneralQ', 'asks'];

// BASKET_V1_FORCE=1 у середовищі процесу — лише для тестових прогонів з робочої копії (бойовий бот — тільки ключ воронки).
function enabled(A) { return /^(1|true|on)$/i.test(String(((A && A.keys) || {}).BASKET_V1 || '').trim()) || process.env.BASKET_V1_FORCE === '1'; }

function ensure(ctx) {
    if (!ctx.basket || typeof ctx.basket !== 'object') ctx.basket = { lines: [], queue: [] };
    if (!Array.isArray(ctx.basket.lines)) ctx.basket.lines = [];
    if (!Array.isArray(ctx.basket.queue)) ctx.basket.queue = [];
    return ctx.basket;
}
function active(ctx) { const b = ctx.basket; return !!(b && ((b.lines && b.lines.length) || (b.queue && b.queue.length) || b.anchor)); }

const shortName = (n) => String(n || '').split('\n')[0].replace(/[.,]?\s*Артикул:?\s*\S*\s*$/i, '').trim();
const up = (x) => String(x || '').toUpperCase().trim();
const round2 = (x) => Math.round(Number(x) * 100) / 100;
function tierTotal(qp, unit, n) {
    qp = qp || {}; const tiers = Object.keys(qp).map(Number).filter((t) => t > 1 && Number(qp[t]) > 0).sort((a, b) => b - a);
    let left = n; let total = 0;
    for (const t of tiers) while (left >= t) { total += Number(qp[t]); left -= t; }
    return total + left * (Number(unit) || 0);
}
function colorsOfProduct(p) {
    if (Array.isArray(p.colorsListAll) && p.colorsListAll.length) return p.colorsListAll.slice();
    if (Array.isArray(p.colorsList) && p.colorsList.length) return p.colorsList.slice();
    return String(p.colorsAll || p.colors || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Пройдений фокус-товар (не комплект) → рядки кошика, по рядку на колір+розмір. Ціна за кількість (акція «2 шт») — на весь
 * артикул, рядкам — середня ціна за штуку (n_pay_amount рахує рядок як ціна × к-сть, без акції). [] — товар ще не пройдений. */
function focusLines(ctx) {
    const p = ctx.product;
    if (!p || !p.sku || p.isSet) return [];
    const size = String(ctx.recommendedSize || '').trim();
    const cc = ctx.colorChoice || {};
    let units = Array.isArray(ctx.orderUnits) && ctx.orderUnits.length ? ctx.orderUnits.map((x) => ({ color: String((x && x.color) || '').trim(), size: String((x && x.size) || size).trim() })) : null;
    if (!units || !units.some((x) => x.color)) {
        const cols = Array.isArray(cc.colors) && cc.colors.length ? cc.colors : (cc.color ? [cc.color] : []);
        if (!cols.length && colorsOfProduct(p).length > 1) return [];
        const qty = Math.max(Number(cc.qty) || 0, cols.length, 1);
        units = cols.length > 1 ? cols.map((c) => ({ color: c, size })) : Array.from({ length: qty }, () => ({ color: cols[0] || colorsOfProduct(p)[0] || '', size }));
    }
    const groups = [];
    for (const u of units) { const g = groups.find((x) => x.color === u.color && x.size === u.size); if (g) g.qty += 1; else groups.push({ color: u.color, size: u.size, qty: 1 }); }
    const totalQty = units.length;
    const total = tierTotal(p.qtyPrices, p.price, totalQty);
    const unit = round2(total / totalQty);
    const offers = (Array.isArray(p.offers) ? p.offers : []).map((o) => ({ id: o.id, sku: o.sku || '', properties: (o.properties || []).map((q) => ({ name: q.name, value: q.value })) }));
    return groups.map((g) => ({ _basket: true, id: p.id || null, sku: String(p.sku), name: shortName(p.customerName || p.name) || String(p.sku), price: unit, qtyPrices: {}, color: g.color, size: g.size, qty: g.qty, colorsList: colorsOfProduct(p), sizes: Array.isArray(p.sizes) ? p.sizes : [], supplier: String(p.supplier || ctx.supplier || ''), supplierArticle: String(p.supplierArticle || ''), offers }));
}

function snapshotFocus(ctx) {
    const s = { ctx: {}, agent: {} };
    for (const k of FOCUS_KEYS) if (ctx[k] !== undefined) s.ctx[k] = JSON.parse(JSON.stringify(ctx[k]));
    for (const k of FOCUS_AGENT_KEYS) if (ctx.agent && ctx.agent[k] !== undefined) s.agent[k] = JSON.parse(JSON.stringify(ctx.agent[k]));
    if (ctx.sizeInput) s.sizeInput = JSON.parse(JSON.stringify(ctx.sizeInput));
    return s;
}
/** Скинути стан фокус-товару. Зріст/вага/живіт/розмір взуття — параметри людини — лишаються (як у resetForNewProduct). */
function clearFocus(ctx) {
    for (const k of FOCUS_KEYS) delete ctx[k];
    for (const k of FOCUS_AGENT_KEYS) if (ctx.agent) delete ctx.agent[k];
    const si = ctx.sizeInput || {};
    if (si.height && si.weight) { ctx.sizeInput = { height: si.height, weight: si.weight, ...(si.belly ? { belly: true } : {}), ...(si.shoeSize ? { shoeSize: si.shoeSize } : {}) }; ctx.agent.hwCarried = true; }
    else delete ctx.sizeInput;
}
function restoreFocus(ctx, s) {
    clearFocus(ctx);
    const hw = ctx.sizeInput;
    for (const k of Object.keys(s.ctx || {})) ctx[k] = s.ctx[k];
    for (const k of Object.keys(s.agent || {})) ctx.agent[k] = s.agent[k];
    ctx.sizeInput = { ...(s.sizeInput || {}), ...(hw || {}) };
    delete ctx.agent.hwCarried;
}

/** ctx.extraItems = додаткові позиції (не з кошика) + рядки кошика. Викликати після будь-якого місця, що перезаписує extraItems. */
function sync(ctx) {
    if (!ctx.basket) return;
    const own = (Array.isArray(ctx.extraItems) ? ctx.extraItems : []).filter((x) => x && !x._basket);
    ctx.extraItems = own.concat(ensure(ctx).lines);
}

/** Чи вже є цей товар у кошику / черзі / фокусі (щоб не додати двічі). */
function has(ctx, sku) {
    const b = ensure(ctx); const S = up(sku);
    return !!S && (b.lines.some((l) => up(l.sku) === S) || b.queue.some((q) => up(q.sku) === S) || (ctx.product && up(ctx.product.sku) === S) || !!(b.anchor && b.anchor.ctx && b.anchor.ctx.product && up(b.anchor.ctx.product.sku) === S));
}
function enqueue(ctx, entry) {
    const b = ensure(ctx);
    if (entry.sku && has(ctx, entry.sku)) return false;
    if (!entry.sku && b.queue.some((q) => !q.sku && String(q.category || '').toLowerCase() === String(entry.category || '').toLowerCase())) return false;
    b.queue.push({ ...entry, at: Date.now() });
    return true;
}

/** Слова клієнта → товар каталогу (артикул; унікальна назва) або категорія CRM (назва/синоніми). null — не знайдено. */
function resolveRef(ref, products, categories) {
    const raw = String(ref || '').trim(); if (!raw) return null;
    const LAT = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X' };
    const toks = (raw.match(/(?<![A-Za-zА-Яа-яІіЇїЄєҐґ\d])[A-Za-zА-Яа-яІі]{0,4}\d{3,8}(?!\d)/g) || []).map((t) => t.toUpperCase().replace(/[А-ЯІ]/g, (c) => LAT[c] || c));
    for (const t of toks) { const p = products.find((x) => up(x.sku) === t || up(x.supplierArticle) === t); if (p) return { sku: String(p.sku), name: shortName(p.customerName || p.name) }; }
    const low = raw.toLowerCase();
    // Корінь із 4 літер: «кофту»/«Кофти», «курточку»/«Куртки» (назви категорій у CRM — у множині).
    const stem = (w) => String(w).toLowerCase().replace(/[^a-zа-яіїєґ]/gi, '').slice(0, 4);
    const words = low.split(/[^a-zа-яіїєґ0-9]+/i).filter((w) => w.length >= 4).map(stem).filter((w) => w.length >= 4);
    const catNames = (c) => [c.name].concat(Array.isArray(c.synonyms) ? c.synonyms : String(c.synonyms || '').split(/[,;\n]+/)).map((s) => String(s || '').toLowerCase().trim()).filter(Boolean);
    // Категорія за назвою чи синонімами CRM (дані, не хардкод).
    let cat = null;
    for (const c of (categories || [])) if (catNames(c).some((n) => words.includes(stem(n)))) { cat = c; break; }
    // Конкретний товар за словами назви, що НЕ є назвою категорії («шкіряний бомбер» → один товар): найбільше збігів, і лише один такий.
    const STOP = /^(чолов|жіноч|колі|розм|темн|світл|бажа|хочу|треба|такс|такий|таку)/;
    const catStems = cat ? catNames(cat).map(stem) : [];
    const specific = words.filter((w) => !catStems.includes(w) && !STOP.test(w));
    if (specific.length) {
        const pool = products.filter((x) => !x.isSet && x.isActive !== false && (!cat || x.categoryId === cat.id || (x.category && x.category.id === cat.id)));
        const score = (x) => { const n = String((x.customerName || '') + ' ' + (x.name || '')).toLowerCase(); return specific.filter((w) => n.includes(w)).length; };
        const best = Math.max(0, ...pool.map(score));
        const hits = best ? pool.filter((x) => score(x) === best) : [];
        if (hits.length === 1) return { sku: String(hits[0].sku), name: shortName(hits[0].customerName || hits[0].name) };
    }
    if (cat) return { category: String(cat.name), ref: raw };
    return null;
}

/** Рядок підсумку для позиції кошика. */
function lineText(l) {
    const det = [l.color, l.size].filter(Boolean).join(', ');
    return '• ' + l.name + (det ? ' (' + det + ')' : '') + (l.qty > 1 ? ' ×' + l.qty : '') + ' — ' + round2(l.price * l.qty) + ' грн';
}
/** Блок кошика в підсумку: рядки + сума. withOwnExtras — показати й інші додаткові позиції (коли головний товар не комплект). */
function summaryBlock(ctx, opts = {}) {
    const lines = ensure(ctx).lines;
    const own = opts.withOwnExtras ? (Array.isArray(ctx.extraItems) ? ctx.extraItems : []).filter((x) => x && !x._basket && x.sku && Number(x.price) > 0) : [];
    const all = lines.concat(own.map((x) => ({ ...x, price: tierTotal(x.qtyPrices, x.price, Number(x.qty) || 1) / (Number(x.qty) || 1) })));
    if (!all.length) return null;
    const sum = round2(all.reduce((s, l) => s + l.price * (Number(l.qty) || 1), 0));
    return { text: all.map(lineText).join('\n'), sum, count: all.length };
}

/** Що бот зараз веде і що ще в черзі — для аналізатора (щоб «і цю теж», «светр не треба» читались у контексті кошика). */
function stateLine(ctx) {
    const b = ctx.basket; if (!b) return '';
    const parts = [];
    if (b.lines && b.lines.length) parts.push('уже записано: ' + b.lines.map((l) => l.name + ' (' + l.sku + ')' + (l.color ? ' ' + l.color : '') + (l.size ? ' ' + l.size : '') + (l.qty > 1 ? ' ×' + l.qty : '')).join('; '));
    if (b.queue && b.queue.length) parts.push('ще підібрати: ' + b.queue.map((q) => q.name || q.category || q.ref || q.sku).join('; '));
    if (b.anchor && b.anchor.ctx && b.anchor.ctx.product) parts.push('головний товар (повернемось після черги): ' + shortName(b.anchor.ctx.product.customerName || b.anchor.ctx.product.name) + ' (' + b.anchor.ctx.product.sku + ')');
    return parts.length ? 'КОШИК (кілька різних товарів): ' + parts.join(' | ') : '';
}

module.exports = { enabled, ensure, active, focusLines, snapshotFocus, clearFocus, restoreFocus, sync, has, enqueue, resolveRef, summaryBlock, lineText, stateLine, tierTotal, FOCUS_KEYS, FOCUS_AGENT_KEYS };
