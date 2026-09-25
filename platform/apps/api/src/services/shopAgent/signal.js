'use strict';
/**
 * signal.js — a single, explicit description of "what kind of product-signal did the
 * customer's message carry this turn", replacing the four-flag maze this used to be
 * (n_signal_check's hasProductSignal, policy.js's local freshSignal, resolveProduct's
 * forceSignal, and the flow node's own hasFreshSignalThisTurn).
 *
 * 2026-09-22 architecture review (goverla_shop live incidents, 10 screenshots): the old
 * forceSignal only recognized an explicit article or a catalog-list pick — a customer's
 * photo or category-word mention, while a product was already confirmed in the
 * conversation, satisfied the OUTER gate (policy.js's freshSignal) but never reached real
 * re-matching inside n_lookup, because the INNER gate (forceSignal) silently dropped it.
 * Photo and category-word are now first-class signals with their own confidence tier —
 * resolveShoppingIntent.js decides what to do with a low-confidence signal (ask/narrow
 * instead of silently switching), but the signal itself is never swallowed at this layer.
 */

const CATEGORY_STEM_RE = /(кофт|светр|худі?|бомбер|куртк|вітровк|джинс|штан|футболк|лофер|взутт|кросів|черевик|костюм|комплект|накидк|шапк|туфл|кед|підголівник)/i;
const RECEIPT_HOSTS = ['check.monobank.ua', 'send.monobank.ua', 'pay.mono.ua', 'pb.ua', 'privatbank.ua', 'next.privat24.ua', 'portmone.com.ua', 'check.gov.ua', 'ibanoplata.com'];
// "замість/натомість/не той а" → клієнт явно хоче ЗАМІНИТИ обговорюваний товар (А8а).
// 2026-09-22: \b НЕ працює після кириличного символу в звичайних JS-регулярках (\w — лише
// ASCII, кирилиця в нього не входить, тож межа слова "не бачиться") — виявлено юніт-тестом,
// де "і ще джинси" не матчилось. Межа перевіряється лукагедом на пробіл/кінець рядка замість \b.
const REPLACE_WORDS_RE = /(замість|натомість|не\s+(?:той|ту|те|цей|цю|це)\s*,?\s*а(?=\s))/i;
// "і ще/також/плюс/а ще" → клієнт явно хоче ДОДАТИ окремим товаром, не замінити (А8б).
const ADD_WORDS_RE = /(і\s+ще(?=\s)|також|плюс|до\s*того\s*ж|а\s+ще(?=\s))/i;
const ARTICLE_RE = /(?:артикул|арт\.?|art|код|sku|#|№)\s*[:#№.\-]?\s*[A-Za-zА-Яа-яІЇЄҐіїєґ]{0,5}\d{2,8}|\b[A-Za-z]\d{3,6}\b/i;

function looksLikeReceiptLink(text) {
    const m = String(text || '').match(/https?:\/\/[^\s]+/);
    if (!m) return false;
    try {
        const host = new URL(m[0]).hostname.toLowerCase();
        return RECEIPT_HOSTS.some((d) => host === d || host.endsWith('.' + d));
    } catch (e) { return false; }
}

/**
 * @param {object} A - the turn context (A.turnText, A.turnImage, A.turnSharedPost, A.newEntryAd)
 * @param {object} u - understand.js's parsed intent for this turn
 * @param {object} ctx - session context (ctx.lastUserMessage, ctx.entryAd, ctx.sharedPost as fallbacks)
 */
function classifySignal(A, u, ctx) {
    const text = String((ctx && ctx.lastUserMessage) || A.turnText || '').trim();
    const cleanText = text.replace(/\[переслав[^\]]*\][^\n]*/gi, ' ');
    const isReceiptLike = !!(u.receiptLink || u.claimsPaid || looksLikeReceiptLink(text));

    const photoUrl = !isReceiptLike ? (A.turnImage || (ctx && ctx.lastUserImageUrl) || null) : null;
    const articleFromLLM = (u.productHint && u.productHint.article) || null;
    const articleFromText = ARTICLE_RE.test(cleanText) ? cleanText.match(ARTICLE_RE)[0] : null;
    const article = articleFromLLM || articleFromText || null;
    const catalogListPick = (u.productHint && u.productHint.fromList) || null;
    const adReferral = A.newEntryAd || null;
    const forwardedPost = A.turnSharedPost || null;
    const catMatch = cleanText.match(CATEGORY_STEM_RE);
    const categoryWord = catMatch ? catMatch[1].toLowerCase() : null;
    const connective = REPLACE_WORDS_RE.test(cleanText) ? 'replace' : (ADD_WORDS_RE.test(cleanText) ? 'add' : null);

    return { article, photoUrl, adReferral, forwardedPost, catalogListPick, categoryWord, connective, isReceiptLike, raw: text };
}

function hasAnySignal(signal) {
    return !!(signal.article || signal.photoUrl || signal.adReferral || signal.forwardedPost || signal.catalogListPick || signal.categoryWord);
}

/** Used by policy.js to widen the "should we re-enter product resolution" gate beyond the
 * old article/photo-only freshSignal — a bare category word ("а є джинси?") is now enough
 * to attempt a real re-match too (see module docblock for why this used to be swallowed). */
function hasCategoryWord(text) {
    return CATEGORY_STEM_RE.test(String(text || '').replace(/\[переслав[^\]]*\][^\n]*/gi, ' '));
}

/**
 * 2026-09-23 (FunnelTest на справжньому shopAgent-шляху): після пропозиції допродажу («додати ще
 * Футболка…») відповідь клієнта «так, 2 футболки, одна біла одна чорна» чи «а для футболки є
 * сітка?» містить слово-категорію, і categorySignal відкривав повторний матчинг → категорія
 * футболок ПІДМІНЯЛА головний товар (кофту) замість того, щоб піти в допродаж. Слово-категорія,
 * що називає саме запропонований допродаж (а не головний товар), — це відповідь про допродаж,
 * не новий товар.
 */
function categoryWordIsUpsell(text, ctx) {
    const p = ctx && ctx.product;
    const up = p && Array.isArray(p.upsellItems) && p.upsellItems[0];
    // Допродаж міг ще не пропонуватись («З якої тканини футболка?» на першій картці) — слово-категорія допродажу все одно не підміняє головний товар.
    if (!up || !(p && p.sku)) return false;
    const clean = String(text || '').replace(/\[переслав[^\]]*\][^\n]*/gi, ' ');
    const stems = clean.toLowerCase().match(new RegExp(CATEGORY_STEM_RE.source, 'gi')) || [];
    if (!stems.length) return false;
    const upName = String(up.name || '').toLowerCase();
    const mainName = String(p.customerName || p.name || '').toLowerCase();
    return stems.every((st) => upName.includes(st) && !mainName.includes(st));
}

/**
 * 2026-09-23 (FunnelTest 4): «цікавить лише кофта і джинси» у відповідь на картку КОМПЛЕКТУ —
 * слова-категорії — це назви ПОЗИЦІЙ активного комплекту, а не новий товар; categorySignal
 * підміняв комплект на окрему позицію (джинси) і губив вибір.
 */
function categoryWordIsSetComponent(text, ctx) {
    const p = ctx && ctx.product;
    if (!p || !p.isSet || !Array.isArray(p.setItems) || !p.setItems.length) return false;
    const clean = String(text || '').replace(/\[переслав[^\]]*\][^\n]*/gi, ' ');
    const stems = clean.toLowerCase().match(new RegExp(CATEGORY_STEM_RE.source, 'gi')) || [];
    if (!stems.length) return false;
    const names = p.setItems.map((it) => String(it.name || '').toLowerCase());
    return stems.every((st) => st === 'комплект' || names.some((n) => n.includes(st)));
}

/**
 * 2026-09-24 (FunnelTest «Лише кофту» у відповідь на «додати футболку чи лише основний товар?»): слово-категорія
 * збігалось із категорією ПОТОЧНОГО головного товару і відкривало список «інших кофт», хоча клієнт лише підтвердив
 * свій товар. Слово, що називає категорію активного товару, — не новий пошук, якщо клієнт не просить інші/ще варіанти.
 */
function categoryWordIsMain(text, ctx) {
    const p = ctx && ctx.product;
    if (!p || p.isSet) return false;
    const clean = String(text || '').replace(/\[переслав[^\]]*\][^\n]*/gi, ' ');
    if (/(інш|ще\s|є\s|які\s|другі|різн|покажіть|варіант|подібн)/i.test(clean)) return false;
    const stems = clean.toLowerCase().match(new RegExp(CATEGORY_STEM_RE.source, 'gi')) || [];
    if (!stems.length) return false;
    const mainName = String(p.customerName || p.name || '').toLowerCase();
    return stems.every((st) => mainName.includes(st));
}

module.exports = { classifySignal, hasAnySignal, hasCategoryWord, categoryWordIsUpsell, categoryWordIsSetComponent, categoryWordIsMain };
