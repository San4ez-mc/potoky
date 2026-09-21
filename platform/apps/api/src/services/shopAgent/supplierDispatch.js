'use strict';
/**
 * shopAgent/supplierDispatch.js — оформлення постачальникам по групах.
 *
 * НАВІЩО (рішення власника 2026-09-14): позиції одного замовлення можуть належати РІЗНИМ
 * постачальникам (BrewDrop API, EasyDrop форма, ручний). Старий код (brewdrop-supplier-code.js)
 * умів оформити ОДНЕ замовлення за виклик — основний товар плюс позиції ТОГО САМОГО
 * постачальника, а решту складав у список «оформіть окремо» для менеджера. Це не архітектурна
 * прив'язка, а реальність: кожен постачальник — окрема система (API проти html-форми) і фізично
 * окрема посилка з окремою накладною. Замість одного виклику — цикл: групуємо позиції замовлення
 * за постачальником і для КОЖНОЇ групи з відомим механізмом викликаємо відповідний інструмент
 * окремо (той самий код нод, що й раніше, без змін — n_supplier_order/_ed/_cart). Вручну
 * лишається тільки те, для чого механізм справді невідомий/не налаштований у CRM.
 *
 * Передоплата розподіляється по групах послідовно (перша посилка поглинає її, наступні —
 * повний накладений платіж на свою суму) — рішення за замовчуванням, власник може скоригувати.
 */
const { logger, nodeCode, runNodeCode, crmFetch, loadCatalog } = require('./lib');

function normSupplier(s) { return String(s || '').trim().toLowerCase(); }

const _supplierCache = new Map(); // botId -> Map(normName -> {id,name,info})
async function resolveSupplierMeta(A, name) {
    const key = normSupplier(name);
    if (!_supplierCache.has(A.botId)) _supplierCache.set(A.botId, new Map());
    const cache = _supplierCache.get(A.botId);
    if (cache.has(key)) return cache.get(key);
    const cat = await loadCatalog(A.botId, A.keys);
    const prod = cat.products.find((p) => normSupplier(p.supplier && p.supplier.name) === key);
    let info = null;
    if (prod && prod.supplier && prod.supplier.id) {
        const r = await crmFetch(A.keys, '/suppliers/' + prod.supplier.id, {}, 5000);
        if (r.ok && r.data) info = r.data;
    }
    const meta = { id: prod && prod.supplier && prod.supplier.id, name, info };
    cache.set(key, meta);
    return meta;
}

/** Той самий код, що n_supplier_route, застосований до постачальника ГРУПИ (не лише основного товару). */
async function mechanismFor(A, meta) {
    const scoped = { product: { supplier: meta.name, supplierInfo: meta.info, setItems: [] }, supplier: meta.name };
    await runNodeCode(nodeCode(A.assets, 'n_supplier_route'), { ctx: scoped, keys: A.keys, user: A.user, session: A.session, input: '', label: 'n_supplier_route:' + meta.name });
    return { mechanism: scoped.supplierMechanism || 'manual', supplierCfg: scoped.supplierCfg || null };
}

/** Позиції замовлення з context: основний товар + допродаж + додаткові/компонентні (orderExtras). */
function buildLines(ctx) {
    const lines = [];
    const mainQty = Array.isArray(ctx.orderUnits) ? ctx.orderUnits.length : (Number(ctx.orderQty) || 1);
    if (Number(ctx.orderUnitsTotal) > 0 && ctx.product && ctx.product.sku) {
        lines.push({
            sku: ctx.product.sku, id: ctx.product.id, name: ctx.product.customerName || ctx.product.name,
            price: Number(ctx.orderUnitsTotal) / mainQty, qty: mainQty,
            color: (ctx.colorChoice && ctx.colorChoice.color) || '', size: ctx.recommendedSize || '',
            supplierName: ctx.product.supplier || '', supplierArticle: ctx.product.supplierArticle || '', isMain: true,
        });
    }
    if (ctx.orderIntent && ctx.orderIntent.addUpsell) {
        const up = ((ctx.product && ctx.product.upsellItems) || [])[0];
        if (up) {
            // 2026-09-21 (живий баг власника: "Футболки він вміє оформляти тільки чорні і тільки
            // С розміру" — color/size тут завжди були порожніми рядками, незалежно від того, що
            // клієнт назвав; постачальник мовчки брав перший варіант з каталогу). upsellUnits (той
            // самий формат units, з understand.js) групуються по color+size так само, як основний
            // товар вище, і кожна група стає ОКРЕМИМ рядком — інакше "1 біла + 1 чорна" не можна
            // було б передати постачальнику взагалі (одна позиція, один колір на всю кількість).
            const qty = Number(ctx.upsellQty || ctx.orderIntent.upsellQty) || 1;
            const total = Number(ctx.upsellSum) || (Number(up.price) || 0) * qty;
            const rawUnits = (Array.isArray(ctx.orderIntent.upsellUnits) && ctx.orderIntent.upsellUnits.length)
                ? ctx.orderIntent.upsellUnits
                : Array.from({ length: qty }, () => ({ color: '', size: '' }));
            const groups = [];
            for (const u of rawUnits) {
                const c = String((u && u.color) || '').trim(); const s = String((u && u.size) || '').trim();
                const g = groups.find((x) => x.color === c && x.size === s);
                if (g) g.qty += 1; else groups.push({ color: c, size: s, qty: 1 });
            }
            const totalUnits = groups.reduce((s, g) => s + g.qty, 0) || 1;
            const perUnitPrice = total / totalUnits;
            for (const g of groups) {
                lines.push({ sku: up.sku, id: up.id, name: up.name, price: perUnitPrice, qty: g.qty, color: g.color, size: g.size, supplierName: '', supplierArticle: up.supplierArticle || '', isUpsell: true });
            }
        }
    }
    for (const x of (Array.isArray(ctx.orderExtras) ? ctx.orderExtras : [])) {
        lines.push({ sku: x.sku, id: x.id, name: x.name, price: Number(x.price) || 0, qty: Number(x.qty) || 1, color: x.color || '', size: x.size || '', supplierName: x.supplier || '', supplierArticle: x.supplierArticle || '' });
    }
    return lines.filter((l) => l.sku || l.id);
}

async function groupBySupplier(A, lines) {
    const cat = await loadCatalog(A.botId, A.keys);
    const bySku = new Map(cat.products.map((p) => [String(p.sku || '').toUpperCase(), p]));
    const groups = new Map(); // normName -> {name, lines[]}
    for (const l of lines) {
        let supplierName = l.supplierName;
        if (!supplierName) { const p = bySku.get(String(l.sku || '').toUpperCase()); supplierName = (p && p.supplier && p.supplier.name) || ''; }
        const key = normSupplier(supplierName) || '(невідомий постачальник)';
        if (!groups.has(key)) groups.set(key, { name: supplierName || '(невідомий постачальник)', lines: [] });
        groups.get(key).lines.push(l);
    }
    return [...groups.values()];
}

async function dispatchBrewdrop(A, group, alloc) {
    const first = group.lines[0];
    const scoped = {
        testMode: A.ctx.testMode,
        product: { id: first.id, name: first.name, article: first.sku, supplierArticle: first.supplierArticle, supplier: group.name, price: first.price, upsellItems: [] },
        orderData: A.ctx.orderData, np: A.ctx.np,
        orderUnits: Array.from({ length: Math.max(1, first.qty) }, () => ({ color: first.color, size: first.size })),
        colorChoice: { color: first.color }, recommendedSize: first.size,
        paymentInfo: A.ctx.paymentInfo, orderTotal: alloc.total, payAmount: alloc.prepay,
        orderIntent: { addUpsell: false },
        orderExtras: group.lines.slice(1).map((l) => ({ id: l.id, sku: l.sku, name: l.name, price: l.price, color: l.color, size: l.size, qty: l.qty, supplier: group.name, supplierArticle: l.supplierArticle, offers: [] })),
        crmOrderId: A.ctx.crmOrderId, supplier: group.name,
    };
    const r = await runNodeCode(nodeCode(A.assets, 'n_supplier_order'), { ctx: scoped, keys: A.keys, user: A.user, session: A.session, input: '', label: 'n_supplier_order:' + group.name });
    A.trace.push({ tool: 'n_supplier_order:' + group.name, ok: r.ok, ms: r.ms, error: r.error || null });
    return { supplier: group.name, mechanism: 'brewdrop', status: scoped.supplierOrderStatus || 'error', result: scoped.supplierOrderResult || '', ttn: scoped.supplierTtn || '', id: scoped.supplierOrderId || '', needsManual: !!scoped.supplierNeedsManual };
}

/** EasyDrop (offline/cart) не підтримує кількість &gt;1 і кілька товарів за один виклик (якщо
 * колись піднімуть — тут єдине місце, де це треба буде прибрати) — оформлюємо кожну одиницю
 * кожної позиції окремим викликом і зводимо результат в один звіт по групі. */
async function dispatchEasydrop(A, nodeId, group, alloc) {
    const results = [];
    for (const l of group.lines) {
        for (let i = 0; i < Math.max(1, l.qty || 1); i++) {
            const scoped = {
                testMode: A.ctx.testMode,
                supplierCfg: alloc.supplierCfg,
                product: { supplierArticle: l.supplierArticle, article: l.sku, sku: l.sku, price: l.price },
                orderSku: l.sku, recommendedSize: l.size, sizeInput: {}, orderData: A.ctx.orderData, np: A.ctx.np, orderRef: A.ctx.orderRef,
            };
            const r = await runNodeCode(nodeCode(A.assets, nodeId), { ctx: scoped, keys: A.keys, user: A.user, session: A.session, input: '', label: nodeId + ':' + group.name });
            A.trace.push({ tool: nodeId + ':' + group.name, ok: r.ok, ms: r.ms, error: r.error || null });
            results.push({ item: l.name, status: scoped.supplierOrderStatus || 'error', result: scoped.supplierOrderResult || '', needsManual: !!scoped.supplierNeedsManual });
        }
    }
    const anyFail = results.some((r) => r.needsManual || r.status === 'error');
    return { supplier: group.name, mechanism: 'easydrop', status: anyFail ? (results.every((r) => r.needsManual || r.status === 'error') ? 'error' : 'partial') : 'created', result: results.map((r) => r.item + ': ' + (r.result || r.status)).join('\n'), needsManual: anyFail };
}

/**
 * Оформлює замовлення постачальникам групами. Повертає { groups:[{supplier,mechanism,status,
 * result,ttn,id,needsManual,items,total}], multiParcel }.
 */
async function dispatchOrder(A) {
    const { ctx } = A;
    const lines = buildLines(ctx);
    if (!lines.length) return { groups: [], multiParcel: false };
    const groups = await groupBySupplier(A, lines);
    let remainingPrepay = Number(ctx.payAmount) || 0;
    const out = [];
    for (const g of groups) {
        const gTotal = g.lines.reduce((s, l) => s + l.price * l.qty, 0);
        const gPrepay = Math.min(remainingPrepay, gTotal); remainingPrepay -= gPrepay;
        const meta = await resolveSupplierMeta(A, g.name);
        const { mechanism, supplierCfg } = await mechanismFor(A, meta);
        let res;
        try {
            if (mechanism === 'brewdrop') res = await dispatchBrewdrop(A, g, { total: gTotal, prepay: gPrepay });
            else if (mechanism === 'easydrop_offline') res = await dispatchEasydrop(A, 'n_supplier_order_ed', g, { supplierCfg });
            else if (mechanism === 'easydrop_cart') res = await dispatchEasydrop(A, 'n_supplier_order_cart', g, { supplierCfg });
            else res = { supplier: g.name, mechanism: 'manual', status: 'manual', result: '', needsManual: true };
        } catch (e) {
            logger.warn('[shopAgent] supplier dispatch failed: ' + e.message, { sessionId: A.session.id, supplier: g.name });
            res = { supplier: g.name, mechanism, status: 'error', result: e.message, needsManual: true };
        }
        res.items = g.lines; res.total = gTotal;
        out.push(res);
    }
    return { groups: out, multiParcel: out.length > 1 };
}

module.exports = { dispatchOrder, buildLines, groupBySupplier };
