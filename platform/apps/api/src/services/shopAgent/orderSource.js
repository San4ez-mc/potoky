'use strict';
/**
 * shopAgent/orderSource.js — замовлення в CRM як джерело правди для оформлення постачальнику (2026-10-02).
 *
 * НАВІЩО: менеджер перевіряє замовлення і може його виправити в CRM (кнопка «✏️ Редагувати замовлення» під
 * сповіщенням → картка замовлення в режимі редагування). Тому «📦 Оформити постачальнику» бере позиції й доставку
 * саме з CRM, а не з памʼяті розмови (ctx) — інакше постачальнику пішло б те, що клієнт казав, а не те, що
 * менеджер виправив, і CRM розійшлась би з реальною посилкою.
 *
 * Комплект у CRM — один рядок (виручка/собівартість по комплекту), склад — у його components
 * [{productId, sku, name, color, size, qty}]. syncSetComponents пише туди setSelection розмови одразу після
 * створення замовлення; для старих замовлень без складу linesFromCrm бере склад з розмови (buildLines).
 */
const { crmFetch, loadCatalog, logger } = require('./lib');
const { buildLines } = require('./supplierDispatch');

const COLOR_RE = /кол|цвет|color/i;
const SIZE_RE = /розм|разм|size/i;
function propValue(props, re) { const p = (Array.isArray(props) ? props : []).find((x) => x && re.test(x.name || '')); return p ? String(p.value || '').trim() : ''; }
const up = (s) => String(s || '').trim().toUpperCase();

function itemPayload(it) {
    return { productId: it.productId || null, offerId: it.offerId || null, name: it.name, price: Number(it.price) || 0, quantity: it.quantity || 1, properties: Array.isArray(it.properties) ? it.properties : undefined, components: Array.isArray(it.components) && it.components.length ? it.components : undefined, isUpsell: !!it.isUpsell };
}

/** Склад комплекту з розмови → у рядок-комплект замовлення CRM (лише якщо там складу ще немає). */
async function syncSetComponents(A) {
    const { ctx, keys } = A;
    const p = ctx.product;
    if (!ctx.crmOrderId || String(ctx.crmOrderId).startsWith('TEST-') || !p || !p.isSet || !Array.isArray(ctx.setSelection) || !ctx.setSelection.length) return false;
    const r = await crmFetch(keys, '/orders/' + ctx.crmOrderId, {}, 6000);
    const order = r.ok && r.data;
    if (!order || !Array.isArray(order.items)) return false;
    const setItem = order.items.find((it) => (it.productId && it.productId === p.id) || (it.product && up(it.product.sku) === up(p.sku)));
    if (!setItem || (Array.isArray(setItem.components) && setItem.components.length)) return false;
    const components = ctx.setSelection.map((s) => ({ productId: s.id || null, sku: s.article || '', name: s.name || '', color: s.color || '', size: s.size || '', qty: Number(s.qty) || 1 }));
    const items = order.items.map((it) => (it.id === setItem.id ? { ...itemPayload(it), components } : itemPayload(it)));
    const w = await crmFetch(keys, '/orders/' + ctx.crmOrderId + '/items', { method: 'PUT', body: JSON.stringify({ items, source: 'funnel' }) }, 8000);
    if (!w.ok) logger.warn('[orderSource] set components sync failed', { sessionId: A.session.id, status: w.status, error: w.json && w.json.error });
    return !!w.ok;
}

/** Позиції для постачальника з замовлення CRM (формат buildLines). */
async function linesFromCrm(A, order) {
    const cat = await loadCatalog(A.botId, A.keys);
    const byId = new Map(cat.products.map((p) => [p.id, p]));
    const bySku = new Map(cat.products.map((p) => [up(p.sku), p]));
    const find = (id, sku) => (id && byId.get(id)) || (sku && bySku.get(up(sku))) || null;
    const lines = [];
    for (const it of order.items || []) {
        const sku = (it.product && it.product.sku) || '';
        const prod = find(it.productId, sku);
        const qty = Number(it.quantity) || 1;
        const comps = Array.isArray(it.components) ? it.components : [];
        if (comps.length || (prod && prod.isSet)) {
            let parts = comps.map((c) => {
                const cp = find(c.productId, c.sku);
                return { sku: c.sku || (cp && cp.sku) || '', id: c.productId || (cp && cp.id) || null, name: c.name || (cp && (cp.customerName || cp.name)) || '', catPrice: Number(cp && cp.price) || 0, qty: (Number(c.qty) || 1) * qty, color: c.color || '', size: c.size || '', supplierName: (cp && cp.supplier && cp.supplier.name) || '', supplierArticle: (cp && cp.supplierArticle) || '', isSetItem: true };
            });
            if (!parts.length) {
                // Старе замовлення-комплект без складу в CRM — склад з розмови (те саме, що оформлювалось досі).
                if (A.ctx.product && up(A.ctx.product.sku) === up(sku)) parts = buildLines(A.ctx).filter((l) => l.isSetItem).map((l) => ({ ...l, catPrice: l.price }));
                if (!parts.length) { lines.push({ sku, id: it.productId, name: it.name, price: Number(it.price) || 0, qty, color: '', size: '', supplierName: '', supplierArticle: '', isSetItem: true, unresolvedSet: true }); continue; }
            }
            // Ціна комплекту розподіляється пропорційно цінам речей (сума = ціна комплекту), як у buildLines.
            const setTotal = (Number(it.price) || 0) * qty;
            const sum = parts.reduce((t, x) => t + x.catPrice * x.qty, 0);
            for (const x of parts) {
                const price = sum > 0 ? Math.round((x.catPrice * setTotal / sum) * 100) / 100 : Math.round((setTotal / parts.reduce((t, y) => t + y.qty, 0)) * 100) / 100;
                const { catPrice, ...rest } = x;
                lines.push({ ...rest, price });
            }
            continue;
        }
        lines.push({
            sku: sku || (it.offer && String(it.offer.sku || '').replace(/-\d+$/, '')) || '',
            id: it.productId || null,
            name: it.name,
            price: Number(it.price) || 0,
            qty,
            color: propValue(it.properties, COLOR_RE),
            size: propValue(it.properties, SIZE_RE),
            supplierName: (prod && prod.supplier && prod.supplier.name) || '',
            supplierArticle: (prod && prod.supplierArticle) || '',
            ...(it.isUpsell ? { isUpsell: true } : {}),
        });
    }
    // Рядки без товару з каталогу не губимо мовчки — вони підуть як «(невідомий постачальник)» → вручну.
    return lines;
}

/** Доставка з CRM (фолбек — дані з розмови). */
function orderDataFromCrm(order, ctx) {
    const sh = (order && order.shipping) || {}; const od = ctx.orderData || {};
    return {
        ...od,
        fullName: sh.recipientFullName || od.fullName || '',
        phone: sh.recipientPhone || od.phone || '',
        city: sh.city || od.city || '',
        branch: sh.branch || sh.warehouse || od.branch || '',
    };
}

/**
 * Що САМЕ піде постачальнику: { lines, orderData, order, fromCrm, warn }.
 * CRM недоступна → дані з розмови з попередженням (кнопка все одно працює).
 */
async function loadDispatchSource(A) {
    const { ctx } = A;
    const r = await crmFetch(A.keys, '/orders/' + ctx.crmOrderId, {}, 8000);
    if (!r.ok || !r.data || !Array.isArray(r.data.items)) {
        return { lines: buildLines(ctx), orderData: ctx.orderData || {}, order: null, fromCrm: false, warn: 'CRM не відповіла — показано дані з розмови, без правок менеджера.' };
    }
    const lines = await linesFromCrm(A, r.data);
    return { lines, orderData: orderDataFromCrm(r.data, ctx), order: r.data, fromCrm: true, warn: lines.some((l) => l.unresolvedSet) ? 'У комплекті не вказано склад — відкрийте «Редагувати» і задайте колір/розмір кожної речі.' : '' };
}

module.exports = { syncSetComponents, linesFromCrm, orderDataFromCrm, loadDispatchSource };
