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
const { classifyKbQuestion } = require('./kbRules');

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

    // Слова категорій магазину (CRM) — до розбору сигналу: каталог кешований на 60 с, тож зазвичай це без запиту.
    try { await loadCatalog(A.botId, keys); } catch (e) { /* лишаються базові слова */ }
    const signal = classifySignal(A, u, ctx);
    const hadProduct = !!(ctx.product && ctx.product.sku);
    const beforeProduct = ctx.product;
    const text = String(ctx.lastUserMessage || A.turnText || '');
    // «234286 мені цей потрібен» — голе число без слова «артикул» (правка 8577bd2d): якщо воно ТОЧНО збігається з артикулом
    // у CRM — це артикул. Ціни/зріст/телефони не зачіпаємо: лише 4–8 цифр і лише точний збіг зі SKU.
    if (!signal.article) {
        const nums = String(A.turnText || text).match(/(?<![\d+])\d{4,8}(?![\d])/g) || [];
        if (nums.length) {
            try {
                const catN = await loadCatalog(A.botId, keys);
                const skuSet = new Set(); for (const pr of catN.products) { if (pr.sku) skuSet.add(String(pr.sku).toUpperCase()); if (pr.supplierArticle) skuSet.add(String(pr.supplierArticle).toUpperCase()); }
                const hitN = nums.find((n) => skuSet.has(n));
                if (hitN) { signal.article = hitN; if (!/артикул/i.test(text)) ctx.lastUserMessage = text + ' артикул ' + hitN; }
            } catch (e) { /* best-effort */ }
        }
    }
    // Повторне розпізнавання сторіз (клієнт посилається на «вашу історію») — це свіжий сигнал «ось цей товар», як фото.
    if (ctx.storyRetry && !signal.photoUrl) { signal.photoUrl = 'story'; if (!signal.connective) signal.connective = 'replace'; }
    // Вибір зі списку, який бот показав у відповідь на «і ще лофери 44» (недавня згадка додаткового товару), — це ДОДАТИ, а не
    // «замінити чи додати?»: клієнт уже сказав «і ще» (тест 162, 02.10).
    const _lx = ctx.agent && ctx.agent.lastExtraAsk;
    if (!signal.connective && hadProduct && (signal.catalogListPick || ctx.catalogHintPick) && _lx && Date.now() - Number(_lx.at || 0) < 30 * 60 * 1000 && _lx.text !== String(A.turnText || text)) signal.connective = 'add';
    ctx.cart.lastSignal = Object.assign({}, signal, { turnAt: Date.now() });

    // Товару ще нема, клієнт пише коротку назву («Гельсінкі», «мажор петля») — пробуємо знайти за назвою в каталозі (тест 95).
    // Але не коли бот щойно показав список, а клієнт ПИТАЄ (аналізатор: intent=question) — це питання про показані товари
    // («Это же не кожа» після списку бомберів → пошук за назвою знаходив куртку D0005 за словом «кожа»; Edit e7457632, 03.10).
    const listOnScreen = !!String(ctx.catalogHintSkus || '').trim();
    const nameTry = !hadProduct && /[a-zа-яіїєґ]{4,}/i.test(text) && text.trim().split(/\s+/).length <= 4 && !/\d{2,}/.test(text) && !(listOnScreen && u && u.intent === 'question');
    // Товару ще нема, жодного сигналу (реклама від Zernio не прийшла — ≈1/4 розмов), а клієнт питає про товар («Яка ціна товарів?»,
    // «Які кольори доступні?», «Як оформити замовлення?») — кандидати з активних реклам (catalogHint, Edits 3d2614c8/22fd060e),
    // а не «що вас цікавить — костюми, куртки…». Зміст питання — від аналізатора (intent / вид питання), не ключові слова.
    const productAsk = !hadProduct && u && (u.intent === 'product_query' || u.intent === 'order_yes' || (Array.isArray(u.questions) && u.questions.some((q) => classifyKbQuestion(q).kind === 'catalog')));
    async function advertisedFallback() {
        // Нерозпізнане фото клієнта — теж сигнал («ось ця річ»), не «сигналу нема»: рекламовані товари тут — чужа відповідь (aze111274).
        if (!productAsk || ctx.entryAdId || String(ctx.catalogHintSkus || '') || (ctx.agent && ctx.agent.unknownPhotoAt && Date.now() - ctx.agent.unknownPhotoAt < 2 * 3600 * 1000)) return null;
        const cat0 = await loadCatalog(A.botId, keys);
        ctx.lookupProductsRaw = cat0.products; ctx.lookupAdsRaw = cat0.ads; ctx.lookupCategoriesRaw = cat0.categories || [];
        ctx.catalogHintCategoriesRaw = await loadCategories(A.botId, keys);
        ctx._hintNoRef = true; delete ctx.catalogHintPick; ctx._hintSearch = !!(u && Array.isArray(u.searchFeatures) && u.searchFeatures.length);
        ctx._needSize = (ctx.agent && ctx.agent.needSize) || ''; // розмір, якого клієнту бракувало в попередній моделі — список лише з ним
        Object.assign(ctx, await computeCatalogHint(ctx, keys, text));
        delete ctx._hintNoRef; delete ctx._hintSearch; delete ctx._needSize;
        let st = null;
        if (ctx.catalogHintPick) { Object.assign(ctx, await matchProduct(ctx, keys, text, { botId: A.botId })); if (ctx.product && ctx.product.sku && !ctx.productUnknown) st = 'found'; }
        else if (ctx.catalogHint) st = 'hint';
        delete ctx.lookupProductsRaw; delete ctx.lookupAdsRaw; delete ctx.lookupCategoriesRaw; delete ctx.catalogHintCategoriesRaw;
        return st ? { status: st, skipPresentation: !!ctx.skipPresentation, signal, action: 'SET_MAIN' } : null;
    }
    if (!hasAnySignal(signal) && !nameTry) {
        // А6 — немає жодного сигналу про товар цього ходу: не чіпаємо активний товар.
        const fb = await advertisedFallback(); if (fb) return fb;
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
    // Клієнт цим ходом показує товар (сторіз, фото, пересланий пост), а реклама, з якої він колись прийшов, — стара: у цьому пошуку
    // реклама не бере участі. Інакше привʼязка реклами перемагала свіжий сигнал щоразу (15.10, _mishko.prvt_: прийшов з реклами
    // пуховика, відповідав на сторіз комплекту set1120 — «Ціна?», «Та не пуховик скільки коштує» — бот 6 разів про пуховик).
    // Те саме для ВСІХ старих джерел артикула: товар з коментаря (72 год), з повідомлення менеджера, пересланий пост минулих ходів
    // (той самий _mishko.prvt_: розмова почалась з коментаря під пуховиком → commentProductArticle=D0043 перебивав сторіз
    // з написом «Артикул: set1120» навіть без реклами). Свіжий візуальний сигнал цього ходу — головний.
    const freshVisual = !A.newEntryAd && (signal.photoUrl || signal.forwardedPost);
    const staleKeys = freshVisual ? ['entryAd', 'entryAdId', 'adTitle', 'adCaption', 'lastReferral', 'commentProductArticle', 'managerArticleHint']
        .concat(A.turnSharedPost ? [] : ['sharedPost']).filter((k) => ctx[k] !== undefined && ctx[k] !== null && ctx[k] !== '') : [];
    const adBak = staleKeys.length ? Object.fromEntries(staleKeys.map((k) => [k, ctx[k]])) : null;
    if (adBak) for (const k of staleKeys) delete ctx[k];
    try { Object.assign(ctx, await matchProduct(ctx, keys, text, { botId: A.botId })); }
    finally { if (adBak) for (const [k, v] of Object.entries(adBak)) if (ctx[k] === undefined) ctx[k] = v; }
    if (adBak) A.trace.push({ step: 'match_without_old_sources', hidden: staleKeys, signal: signal.photoUrl ? 'photo/story' : 'post' });
    if (!hasAnySignal(signal) && nameTry && !(ctx.product && ctx.product.sku && /^user_name/.test(String(ctx.product._via || '')))) {
        // Пошук лише за назвою не дав точного збігу — нічого не підставляємо (жодних «найближчих» товарів на «Дякую» тощо).
        for (const k of Object.keys(ctx)) { if (!(k in ctxSnapshotBefore)) delete ctx[k]; }
        Object.assign(ctx, ctxSnapshotBefore);
        const fb = await advertisedFallback(); if (fb) return fb;
        return { status: 'none', skipPresentation: true, signal, action: 'NONE' };
    }
    let status = (ctx.product && ctx.product.sku && !ctx.productUnknown) ? 'found' : 'none';
    let decision = { action: 'SET_MAIN' };

    if (status === 'found') {
        const candidate = ctx.product;
        if (hadProduct) {
            decision = reconcile(beforeProduct, candidate, signal, ctx);
            if (ctx.hintAddsExtra && signal.catalogListPick && decision.action === 'REPLACE_MAIN') decision = { action: 'ADD_EXTRA' };
            if (signal.catalogListPick) delete ctx.hintAddsExtra;
        }
        // Товар, якого немає в наявності, не стає головним замість уже обраного й не додається до нього (15.10, тести 162/165:
        // «беру лофери замість кофти» — лоферів немає, а кофта зникала із замовлення). Policy чесно каже «немає» (oosText).
        if (hadProduct && candidate.outOfStock && !candidate.isSet && beforeProduct && beforeProduct.sku && !beforeProduct.outOfStock
            && String(beforeProduct.sku) !== String(candidate.sku) && decision.action !== 'CONFIRM') {
            const replace = signal.connective === 'replace'; // «замість/заміни» — сказав клієнт; інакше це додати чи питання
            for (const k of Object.keys(ctx)) { if (!(k in ctxSnapshotBefore)) delete ctx[k]; }
            Object.assign(ctx, ctxSnapshotBefore);
            ctx.oosMention = { product: candidate, replace };
            decision = { action: 'OOS_KEPT' }; status = 'kept';
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
        // Реклама не прийшла (≈22% розмов Zernio) — catalogHint бере найімовірніший товар серед активних реклам категорії.
        ctx._hintNoRef = !hadProduct && !signal.photoUrl && !signal.adReferral && !signal.forwardedPost && !ctx.entryAdId;
        ctx._hintSearch = !!(u && Array.isArray(u.searchFeatures) && u.searchFeatures.length); // шукає за ознаками («спортивний») — список, а не одна рекламована картка (тест 34)
        ctx._needSize = (ctx.agent && ctx.agent.needSize) || ''; // розмір, якого клієнту бракувало в попередній моделі — список лише з ним
        Object.assign(ctx, await computeCatalogHint(ctx, keys, text));
        delete ctx._hintNoRef; delete ctx._hintSearch; delete ctx._needSize;
        if (ctx.catalogHintPick) {
            delete ctx.productUnknown;
            Object.assign(ctx, await matchProduct(ctx, keys, text, { botId: A.botId }));
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

    // Той самий захист і для шляху через добірку категорії («і ще лофери 44» → список → перший зі списку ставав головним, кофта зникала;
    // 15.10, тест 162): відсутній товар не замінює вже обраний, хоч би яким шляхом його знайшло.
    if (hadProduct && !ctx.oosMention && ctx.product && ctx.product.outOfStock && !ctx.product.isSet && beforeProduct && beforeProduct.sku && !beforeProduct.outOfStock
        && String(beforeProduct.sku) !== String(ctx.product.sku)) {
        const cand = ctx.product;
        for (const k of Object.keys(ctx)) { if (!(k in ctxSnapshotBefore)) delete ctx[k]; }
        Object.assign(ctx, ctxSnapshotBefore);
        ctx.oosMention = { product: cand, replace: signal.connective === 'replace' };
        decision = { action: 'OOS_KEPT' }; status = 'kept';
    }
    delete ctx.lookupProductsRaw; delete ctx.lookupAdsRaw; delete ctx.lookupCategoriesRaw; delete ctx.catalogHintProductsRaw; delete ctx.catalogHintCategoriesRaw;
    return { status, skipPresentation: !!ctx.skipPresentation, signal, action: decision.action };
}

module.exports = { resolveShoppingIntent };
