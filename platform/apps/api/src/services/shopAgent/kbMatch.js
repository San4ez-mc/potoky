'use strict';
/**
 * kbMatch.js — ШІ-зіставлення питання клієнта з базою знань CRM (замість словника синонімів).
 *
 * 2026-09-29 (власник: «не думаю, що ти зможеш прописати всі синоніми… може краще, щоб ШІ читав»; «система погано
 * визначає, де питання стосується всіх товарів, а де конкретного»). Одним коротким викликом Haiku:
 *   match — номер запису бази, що відповідає на ТЕ САМЕ питання по суті (перефразування/синоніми рахуються);
 *   scope — чого стосується НОВЕ питання: shop (будь-якого товару), category (категорії загалом), product (цього товару).
 * Результат: є відповідь → бот відповідає нею; запис без відповіді → лише лічильник +1 (без нового дубля);
 * немає → новий запис із правильним scope. Якщо ШІ недоступний — повертає null, працює словниковий критерій kbSimilarity.
 */
const { callClaude } = require('@platform/claude');
const { crmFetch, logger, loadCatalog } = require('./lib');

const _cache = new Map(); // botId -> { at, items }
const TTL_MS = 60 * 1000;

async function loadKbAll(A) {
    const c = _cache.get(A.botId);
    if (c && Date.now() - c.at < TTL_MS) return c.items;
    const r = await crmFetch(A.keys, '/knowledge?take=500', {}, 5000);
    const items = (Array.isArray(r.data) ? r.data : []).filter((e) => e.question).map((e) => ({
        id: e.id, q: String(e.question).split('|')[0].trim().slice(0, 200), a: String(e.answer || '').trim(), active: !!e.isActive,
        scope: e.scope, productId: e.productId, productName: e.product && e.product.name, categoryName: e.category && e.category.name,
    }))
        // вимкнені записи З відповіддю — це прибрані дублі; їх не показуємо (інакше ШІ «знайде» мертвий запис)
        .filter((e) => e.active || !e.a);
    if (r.ok) _cache.set(A.botId, { at: Date.now(), items });
    return items;
}

function scopeLabel(e) {
    if (e.scope === 'shop') return 'весь магазин';
    if (e.scope === 'category') return 'категорія ' + (e.categoryName || '?');
    if (e.scope === 'product') return 'товар ' + (e.productName || '?');
    return e.scope || '?';
}

async function kbMatch(A, question) {
    const q = String(question || '').trim();
    if (!q) return null;
    A._kbm = A._kbm || {};
    if (A._kbm[q] !== undefined) return A._kbm[q];
    let res = null;
    try {
        const items = (await loadKbAll(A)).slice(0, 220);
        const p = A.ctx.product;
        let prodLine = 'немає';
        if (p && p.sku) {
            let catName = '';
            try { const cat = await loadCatalog(A.botId, A.keys); const raw = cat.products.find((x) => String(x.sku) === String(p.sku)); catName = (raw && raw.category && raw.category.name) || ''; } catch (e) { /* best-effort */ }
            prodLine = String(p.customerName || p.name || '').split('\n')[0] + (catName ? ' (категорія ' + catName + ')' : '');
        }
        const list = items.map((e, i) => (i + 1) + '. [' + scopeLabel(e) + '] ' + e.q + (e.a ? '' : ' (ще без відповіді)')).join('\n');
        const prompt = 'Питання клієнта інтернет-магазину одягу: «' + q.slice(0, 400) + '»\nТовар у розмові: ' + prodLine
            + '\n\nЗаписи бази знань:\n' + (list || '(порожньо)')
            + '\n\nЗАВДАННЯ:\n1) match — номер запису, що відповідає на ТЕ САМЕ питання по суті (перефразування, синоніми, інший порядок слів — так; схожа, але інша тема — ні: «термін обміну» ≠ «як оформити обмін»). Запис про ІНШИЙ конкретний товар підходить лише тоді, коли відповідь не залежить від товару. Нема такого — null.'
            + '\n2) scope — чого стосується САМЕ ЦЕ питання: "shop" — однаково для будь-якого товару (оплата, доставка, знижки, обмін/повернення, гарантія, терміни, примірка, магазин); "category" — категорії загалом (напр. «як сідають джинси»); "product" — конкретного товару (його посадка, деталі, крій, тканина).'
            + '\n3) kind — вид питання: "size" — підбір розміру/посадка під параметри («як підібрати розмір», «чи підійде на 200 см», «M повномірний?»); "feature" — властивість/деталь товару, яку видно з опису чи фото (капюшон, блискавка, кишені, матеріал, утеплення); "compare" — чим відрізняються кілька товарів; "policy" — умови магазину (оплата, доставка, обмін, знижки); "other" — інше.'
            + '\nВідповідь ЛИШЕ JSON: {"match": число або null, "scope": "shop"|"category"|"product", "kind": "size"|"feature"|"compare"|"policy"|"other"}';
        const raw = await callClaude({ sessionId: A.session.id, systemPrompt: 'Ти точно зіставляєш питання клієнтів з базою знань магазину. Відповідаєш лише JSON.', messages: [{ role: 'user', content: prompt }], options: { model: A.keys.KB_MATCH_MODEL || 'claude-haiku-4-5', maxTokens: 80, extra: { temperature: 0 } } });
        const m = String(raw || '').match(/\{[\s\S]*\}/);
        if (m) {
            const j = JSON.parse(m[0]);
            const idx = Number(j.match);
            const entry = Number.isInteger(idx) && idx >= 1 && idx <= items.length ? items[idx - 1] : null;
            const scope = ['shop', 'category', 'product'].includes(j.scope) ? j.scope : 'product';
            const kind = ['size', 'feature', 'compare', 'policy', 'other'].includes(j.kind) ? j.kind : 'other';
            res = { entry, scope, kind };
        }
    } catch (e) { logger.warn('[shopAgent] kbMatch failed: ' + e.message, { sessionId: A.session && A.session.id }); res = null; }
    A._kbm[q] = res;
    return res;
}

module.exports = { kbMatch, loadKbAll };
