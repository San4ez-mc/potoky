'use strict';
/**
 * resolveShoppingIntent.js — replaces the old resolveProduct()'s internals in tools.js.
 * Same public contract (returns {status, skipPresentation}), but the decision of WHETHER
 * to re-examine the active product, and WHAT a fresh match means relative to it, is now
 * explicit here instead of being smeared across n_lookup's own early-exit guard and
 * policy.js's freshSignal/forceSignal pair (see cart.js and signal.js docblocks for why).
 *
 * `tool` is passed in by the caller (tools.js) rather than required directly, to avoid a
 * circular require (tools.js requires this module to build resolveProduct()).
 */
const { classifySignal, hasAnySignal } = require('./signal');
const { matchProduct } = require('./productMatch');
const { computeCatalogHint } = require('./catalogHint');
const { ensureCart, reconcile } = require('./cart');
const { loadCatalog, loadCategories } = require('./lib');

// А9 — довгий простій сесії: не успадковувати старий колір/розмір навіть при збігу sku,
// бо клієнт міг вважати, що починає нову розмову (раніше такого порогу не було взагалі,
// лише 6-годинне вікно n_prev_match_snapshot).
const LONG_IDLE_MS = 24 * 60 * 60 * 1000;

async function resolveShoppingIntent(A, u, tool) {
    const { ctx, keys } = A;
    ensureCart(ctx);

    await tool(A, 'n_route');
    await tool(A, 'n_shop_profile');
    await tool(A, 'n_prev_match_snapshot');

    if (ctx.presentedAt && (Date.now() - Number(ctx.presentedAt)) > LONG_IDLE_MS) {
        delete ctx.colorChoice; delete ctx.recommendedSize; delete ctx.sizeInput; delete ctx.prevProductSnapshot;
    }

    const signal = classifySignal(A, u, ctx);
    ctx.cart.lastSignal = Object.assign({}, signal, { turnAt: Date.now() });
    const hadProduct = !!(ctx.product && ctx.product.sku);
    const beforeProduct = ctx.product;
    const text = String(ctx.lastUserMessage || A.turnText || '');

    if (!hasAnySignal(signal)) {
        // А6 — немає жодного сигналу про товар цього ходу: не чіпаємо активний товар.
        return { status: hadProduct ? 'kept' : 'none', skipPresentation: true, signal, action: 'NONE' };
    }

    const cat = await loadCatalog(A.botId, keys);
    ctx.lookupProductsRaw = cat.products; ctx.lookupAdsRaw = cat.ads; ctx.lookupCategoriesRaw = cat.categories || [];
    // policy.js уже звів вибір зі списку до реального SKU (ctx.catalogHintPick) — сирий рядок LLM
    // («Футболка оверсайз база (L0056)») його не перезаписує (FunnelTest 2: «так, першу» → куртка D0005).
    if (signal.catalogListPick && !ctx.catalogHintPick) ctx.catalogHintPick = signal.catalogListPick;

    delete ctx.productUnknown; delete ctx.productUnknownReason;
    // Знімок УСЬОГО ctx перед матчингом — matchProduct() мутує не лише ctx.product (dialogState,
    // presentedAt, lastPresentedSku, adLinkMismatch, skipPresentation тощо). Якщо reconcile()
    // нижче вирішить, що кандидат НЕ стає головним товаром, треба відкотити ВСІ ці побічні
    // мутації, а не лише ctx.product — інакше стан презентації розсинхронізується з тим, який
    // товар насправді лишився активним.
    const ctxSnapshotBefore = Object.assign({}, ctx);
    Object.assign(ctx, await matchProduct(ctx, keys, text));
    let status = (ctx.product && ctx.product.sku && !ctx.productUnknown) ? 'found' : 'none';
    let decision = { action: 'SET_MAIN' };

    if (status === 'found') {
        const candidate = ctx.product;
        if (hadProduct) {
            decision = reconcile(beforeProduct, candidate, signal, ctx);
            if (ctx.hintAddsExtra && signal.catalogListPick && decision.action === 'REPLACE_MAIN') decision = { action: 'ADD_EXTRA' };
            if (signal.catalogListPick) delete ctx.hintAddsExtra;
        }
        if (decision.action === 'ADD_EXTRA' || decision.action === 'ASK_REPLACE_OR_ADD') {
            // Кандидат НЕ стає активним товаром — відкочуємо ВЕСЬ ctx до стану перед матчингом,
            // головний товар лишається як був, кандидат іде в існуючий, уже перевірений шлях
            // extraResolve (Д1-Д6), а не в новий паралельний.
            for (const k of Object.keys(ctx)) { if (!(k in ctxSnapshotBefore)) delete ctx[k]; }
            Object.assign(ctx, ctxSnapshotBefore);
            ctx.pendingExtraCandidate = { sku: candidate.sku, name: candidate.customerName || candidate.name, decision: decision.action };
            if (decision.action === 'ADD_EXTRA') ctx.extraProductMention = candidate.sku;
            status = beforeProduct && beforeProduct.sku ? 'kept' : 'none';
        } else if (decision.action === 'CONFIRM') {
            // Той самий товар — лишаємо щойно оновлені (свіжі з CRM) дані, нічого зайвого не робимо.
        }
        // REPLACE_MAIN / SET_MAIN: matchProduct() уже виставив ctx.product — нічого додатково не треба.
    }

    // Головний товар визначено не зі списку — старий список підказок більше не актуальний (інакше
    // «першу» пізніше мапиться на застарілий перелік).
    if (status === 'found' && !signal.catalogListPick) ctx.catalogHintSkus = '';
    const keptOnPurpose = decision.action === 'ADD_EXTRA' || decision.action === 'ASK_REPLACE_OR_ADD';
    // ADD_EXTRA/ASK_REPLACE_OR_ADD: кандидата вже знайдено й свідомо не зроблено головним — повторно
    // шукати підказку за тим самим текстом не можна (FunnelTest 2: «так, першу» → куртка D0005).
    if (status !== 'found' && !keptOnPurpose) {
        // 2026-09-23 (жива знахідка через FunnelTest, тест "критичний фікс категорії"): раніше
        // цей блок узагалі не виконувався, коли товар вже підтверджено (hadProduct) — категорійне
        // слово про ГЕНУЇННО іншу, неоднозначну категорію (напр. "костюми?", а в каталозі їх 8)
        // просто тихо лишало старий товар, замість показати клієнту короткий список варіантів.
        // computeCatalogHint() має власний ранній guard "є ctx.product → нічого не робити"
        // (успадкований з n_catalog_hint, де це мало сенс лише для "товар ще не визначено") —
        // тимчасово ховаємо ctx.product на час цього виклику й відновлюємо, якщо підказка
        // нічого корисного не знайшла (щоб не втратити вже підтверджений товар).
        const productBeforeHint = ctx.product;
        if (hadProduct) delete ctx.product;
        delete ctx.catalogHintPick;
        ctx.catalogHintCategoriesRaw = await loadCategories(A.botId, keys);
        Object.assign(ctx, await computeCatalogHint(ctx, keys, text));
        if (ctx.catalogHintPick) {
            delete ctx.productUnknown;
            Object.assign(ctx, await matchProduct(ctx, keys, text));
            if (ctx.product && ctx.product.sku && !ctx.productUnknown) status = 'found';
        }
        if (status !== 'found' && ctx.catalogHint) {
            // 2026-09-23 (FunnelTest 2: «і ще футболку» показувало список і СТИРАЛО головний товар —
            // далі бот питав «що вас цікавить» на дані доставки). Список показано, але вже
            // підтверджений товар лишається активним; вибір зі списку далі піде через reconcile
            // (а якщо клієнт просив «і ще…» — як додатковий, а не заміна).
            status = 'hint';
            if (productBeforeHint) { ctx.product = productBeforeHint; ctx.hintAddsExtra = signal.connective === 'add'; }
        } else if (status !== 'found') {
            // Підказка теж нічого не дала — повертаємо раніше підтверджений товар, не втрачаємо його.
            if (productBeforeHint) ctx.product = productBeforeHint;
            status = productBeforeHint && productBeforeHint.sku ? 'kept' : 'unknown';
        }
    }

    delete ctx.lookupProductsRaw; delete ctx.lookupAdsRaw; delete ctx.lookupCategoriesRaw; delete ctx.catalogHintProductsRaw; delete ctx.catalogHintCategoriesRaw;
    return { status, skipPresentation: !!ctx.skipPresentation, signal, action: decision.action };
}

module.exports = { resolveShoppingIntent };
