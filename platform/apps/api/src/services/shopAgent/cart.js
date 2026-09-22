'use strict';
/**
 * cart.js — ctx.cart bookkeeping and the two decisions that used to not exist anywhere in
 * the codebase in explicit form:
 *   1) reconcile(): given a freshly-matched candidate product and the item already in
 *      play, decide REPLACE_MAIN / ADD_EXTRA / CONFIRM / ASK_REPLACE_OR_ADD / SET_MAIN,
 *      instead of the old n_lookup silently overwriting `found` with no memory of why.
 *      (A "candidate that turns out to be a component of the currently active set" is
 *      deliberately NOT special-cased here — policy.js's existing swappedToOwnSetComponent
 *      check, runPolicyInner ~line 596-602, already reverts that correctly; duplicating it
 *      here would just be a second, competing implementation of the same guard.)
 *   2) resolveColorMention(): a color/size word that didn't resolve to a *new item* on its
 *      own — check it against every palette we actually know about (main item, upsell,
 *      each set component) in priority order, instead of either silently ignoring it
 *      (the old "colorResolved → skip whole section" gate) or overwriting unconditionally
 *      regardless of relevance (the old availability-check side door).
 *
 * ctx.cart itself is additive — nothing else in the codebase reads it (verified by
 * grepping "ctx.cart" before adding this), so introducing it cannot regress anything that
 * already worked. ctx.product keeps its exact existing shape; every one of the 40+ places
 * that read it (compose.js prompts, presentation code) needs no changes.
 */

function ensureCart(ctx) {
    if (!ctx.cart || typeof ctx.cart !== 'object') {
        ctx.cart = { main: null, upsell: null, extraItems: [], lastSignal: null };
    }
    if (!Array.isArray(ctx.cart.extraItems)) ctx.cart.extraItems = [];
    return ctx.cart;
}

function orderAlreadyStarted(ctx) {
    return !!(
        ctx.crmOrderId
        || (ctx.orderData && (ctx.orderData.phone || ctx.orderData.fullName || ctx.orderData.city || ctx.orderData.branch))
        || (ctx.paymentInfo && ctx.paymentInfo.method)
    );
}

/**
 * Pure decision — does not mutate ctx. `current` is the product snapshot from BEFORE this
 * turn's matching ran; `candidate` is what matchProduct() just found.
 */
function reconcile(current, candidate, signal, ctx) {
    if (!current || !current.sku) return { action: 'SET_MAIN' };
    if (String(candidate.sku).toUpperCase() === String(current.sku).toUpperCase()) return { action: 'CONFIRM' };

    // Явний артикул — найвища довіра, завжди перемагає будь-яку евристику (А7).
    if (signal.article) return { action: 'REPLACE_MAIN' };
    if (signal.connective === 'replace') return { action: 'REPLACE_MAIN' };   // "замість", "натомість" (А8а)
    if (signal.connective === 'add') return { action: 'ADD_EXTRA' };          // "і ще", "також" (А8б)

    // Голе фото/назва без слів-звʼязок (А8в): низька ціна помилки, поки збір замовлення
    // ще не почався — безпечно замінити. Якщо клієнт уже дав адресу/оплату — не мовчати.
    if (!orderAlreadyStarted(ctx)) return { action: 'REPLACE_MAIN' };
    return { action: 'ASK_REPLACE_OR_ADD' };
}

function colorStem(s) {
    return String(s || '').toLowerCase().replace(/ий$|я$|а$|у$|ого$|ому$/, '').slice(0, 6);
}

function findInPalette(list, stem) {
    return (Array.isArray(list) ? list : []).find((c) => colorStem(c) === stem) || null;
}

/**
 * Б2/Б4/Б5 — a color word that policy.js's "5. Колір" section couldn't place because a
 * color was already resolved (the old code just skipped the whole section in that case).
 * Returns null when the word matches NOTHING we know about — the caller should ask for
 * clarification rather than guess (Б4: "Уточніть, це колір для [X] чи ви питаєте про щось інше?").
 */
function resolveColorMention(ctx, colorWord) {
    if (!colorWord) return null;
    const stem = colorStem(colorWord);
    if (!stem) return null;
    const p = ctx.product;
    if (!p) return null;

    const mainHit = findInPalette(p.colorsList, stem);
    if (mainHit) {
        const already = ctx.colorChoice && ctx.colorChoice.color;
        return { target: 'main', color: mainHit, isCorrection: !!(already && already !== mainHit) };
    }

    const upsellColorsStr = (p.upsellItems && p.upsellItems[0] && p.upsellItems[0].colors) || '';
    const upsellHit = findInPalette(upsellColorsStr.split(',').map((s) => s.trim()).filter(Boolean), stem);
    if (upsellHit) return { target: 'upsell', color: upsellHit };

    if (p.isSet && Array.isArray(p.setItems)) {
        for (const item of p.setItems) {
            const hit = findInPalette(item.colors, stem);
            if (hit) return { target: 'setComponent', article: item.article, color: hit };
        }
    }
    return null;
}

module.exports = { ensureCart, orderAlreadyStarted, reconcile, resolveColorMention };
