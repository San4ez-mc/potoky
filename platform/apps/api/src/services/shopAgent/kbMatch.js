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
        const p = A.ctx.product;
        let prodLine = 'немає';
        let prodId = null;
        if (p && p.sku) {
            let catName = '';
            try { const cat = await loadCatalog(A.botId, A.keys); const raw = cat.products.find((x) => String(x.sku) === String(p.sku)); catName = (raw && raw.category && raw.category.name) || ''; prodId = raw && raw.id; } catch (e) { /* best-effort */ }
            prodLine = String(p.customerName || p.name || '').split('\n')[0] + (catName ? ' (категорія ' + catName + ')' : '');
        }
        // Запис про ІНШИЙ конкретний товар — не кандидат (2026-09-30: «чи звужені джинси?» → запис про замшевий костюм 234286 «стандартний»).
        const items = (await loadKbAll(A)).filter((e) => e.scope !== 'product' || !e.productId || (prodId && e.productId === prodId)).slice(0, 220);
        const list = items.map((e, i) => (i + 1) + '. [' + scopeLabel(e) + '] ' + e.q + (e.a ? '' : ' (ще без відповіді)')).join('\n');
        const prompt = 'Питання клієнта інтернет-магазину одягу: «' + q.slice(0, 400) + '»\nТовар у розмові: ' + prodLine
            + '\n\nЗаписи бази знань:\n' + (list || '(порожньо)')
            + '\n\nЗАВДАННЯ:\n1) match — номер запису, що відповідає на ТЕ САМЕ питання по суті (перефразування, синоніми, інший порядок слів — так; схожа, але інша тема — ні: «термін обміну» ≠ «як оформити обмін»). Предмет питання має збігатися: ЗВІДКИ відправляєте (місто) ≠ КОЛИ відправка (термін) ≠ СКІЛЬКИ коштує доставка (ціна) ≠ ЯКОЮ службою; «блискавка металева?» ≠ «яка кофта має блискавку на всю довжину?». Сумніваєшся — null (краще без запису, ніж чужа відповідь).'
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

/**
 * Чи це питання — те саме по суті, що одне з уже переданих менеджеру в цій розмові (2026-09-30, тест 0b3c3b12:
 * «Штани будуть звужені донизу?» і «Уточніть покрій, чи звужений» — два алерти менеджеру, бо за коренями слів різні).
 * null — ШІ недоступний (тоді працює словниковий kbSimilar).
 */
async function sameAsEscalated(A, question, prev) {
    const q = String(question || '').trim(); const list = (prev || []).filter(Boolean).slice(-8);
    if (!q || !list.length) return false;
    try {
        const prompt = 'Нове питання клієнта: «' + q.slice(0, 300) + '»\nПитання, які вже передано менеджеру в цій розмові:\n' + list.map((x, i) => (i + 1) + '. ' + String(x).slice(0, 200)).join('\n')
            + '\n\nЧи нове питання — те саме по суті, що одне з переданих (клієнт перепитує/наполягає іншими словами, уточнює те саме: «уточніть покрій», «мені треба знати» після питання про крій)? Орієнтуйся на дослівні слова клієнта, а не на переформулювання. Відповідь ЛИШЕ JSON: {"same": true|false}';
        const raw = await callClaude({ sessionId: A.session.id, systemPrompt: 'Ти порівнюєш питання клієнтів за змістом. Відповідаєш лише JSON.', messages: [{ role: 'user', content: prompt }], options: { model: A.keys.KB_MATCH_MODEL || 'claude-haiku-4-5', maxTokens: 20, extra: { temperature: 0 } } });
        const m = String(raw || '').match(/\{[\s\S]*\}/);
        return m ? JSON.parse(m[0]).same === true : null;
    } catch (e) { return null; }
}

module.exports = { kbMatch, loadKbAll, sameAsEscalated };
