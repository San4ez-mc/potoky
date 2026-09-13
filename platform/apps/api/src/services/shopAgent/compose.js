'use strict';
/**
 * shopAgent/compose.js — формулювання відповіді. LLM отримує ЛИШЕ факти від політики і
 * завдання «відповісти на питання X і підвести до кроку Y»; вигадувати нема з чого.
 * Для фіксованих кроків (картка товару, реквізити, підсумок) політика шле шаблони напряму.
 */
const { callClaude } = require('@platform/claude');
const { logger, stripLoneSurrogates } = require('./lib');

function productFacts(ctx) {
    const p = ctx.product; if (!p || !p.sku) return '';
    const f = [];
    f.push('Товар: ' + (p.customerName || p.name) + ' (арт. ' + p.sku + '), ціна ' + p.price + ' грн.');
    if (p.desc) f.push('Опис: ' + String(p.desc).replace(/\s+/g, ' ').slice(0, 700));
    if (p.colors) f.push('Кольори: ' + p.colors + '.');
    if (Array.isArray(p.sizes) && p.sizes.length) f.push('Розміри: ' + p.sizes.join(', ') + '.');
    if (p.sizeChartText) f.push('Таблиця замірів: ' + String(p.sizeChartText).replace(/\s+/g, ' ').slice(0, 600));
    if (p.aiInfo) f.push('Нюанси (для тебе, не цитуй списком): ' + String(p.aiInfo).slice(0, 500));
    if (p.qtyPromoText) f.push('Акція за кількість: ' + p.qtyPromoText);
    if (p.upsell) f.push('Допродаж: ' + p.upsell);
    if (p.isSet && p.setList) f.push('Склад комплекту: ' + p.setList);
    if (ctx.recommendedSize) f.push('ПІДІБРАНИЙ СИСТЕМОЮ РОЗМІР: ' + ctx.recommendedSize + ' — називай лише його, НІКОЛИ не рахуй розмір сам за сіткою/зростом/вагою і не пропонуй інший.');
    else if (ctx.sizeInput && (ctx.sizeInput.height || ctx.sizeInput.weight)) f.push('Розмір ще НЕ підібрано (рахує система) — не називай жодного розміру.');
    if (ctx.colorChoice && ctx.colorChoice.color) f.push('Обраний колір: ' + ctx.colorChoice.color + '.');
    if (ctx.orderUnitsText) f.push('Позиції замовлення: ' + ctx.orderUnitsText + (ctx.orderUnitsTotal ? ' — ' + ctx.orderUnitsTotal + ' грн' : '') + '.');
    if (ctx.payAmount != null && ctx.paymentInfo && ctx.paymentInfo.method) f.push('Оплата: ' + ctx.payLabel + ' — до сплати зараз ' + ctx.payAmount + ' грн.');
    return f.join('\n');
}
function shopFacts(ctx) {
    const s = ctx.shop || {}; const f = [];
    if (s.faq) f.push('Довідка магазину: ' + s.faq);
    if (s.terms) f.push('Умови: ' + s.terms);
    f.push('Оплата: часткова передоплата 200 грн + решта накладним платежем (комісія пошти 20 грн + 2%), або повна передоплата. Доставка лише Новою Поштою (відділення/поштомат), до 5 робочих днів зі складу в Харкові; конкретний день відправки не називаємо. Обмін/повернення 14 днів.');
    return f.join('\n');
}

/**
 * Скласти одну відповідь: (відповіді на питання з фактів) + (наступний крок).
 * @param A агентний контекст
 * @param o { questions:[], nextStep:'<що спитати/сказати далі, дослівно або суть>', extraFacts:'', kb:[{q,a}], availAnswer:'', tone:'', noGreeting:true, maxSentences }
 */
async function compose(A, o = {}) {
    const { ctx, keys } = A;
    const model = keys.AGENT_COMPOSE_MODEL || 'claude-sonnet-4-6';
    const persona = keys.PERSONA_NAME || 'Оля'; const shop = keys.SHOP_TAG || 'магазин';
    const facts = [productFacts(ctx), shopFacts(ctx), o.extraFacts || '', (o.kb || []).length ? 'БАЗА ЗНАНЬ (факти саме про цей магазин, точніші за будь-які припущення):\n' + o.kb.map((h) => '• ' + (h.q ? 'Питання: ' + h.q + ' → ' : '') + 'Відповідь: ' + h.a).join('\n') : '', o.availAnswer ? 'НАЯВНІСТЬ (система щойно перевірила каталог):\n' + o.availAnswer : ''].filter(Boolean).join('\n\n');
    const systemPrompt = 'Ти — ' + persona + ', жива тепла консультантка ' + shop + ' в Instagram. Українською, на «ви», коротко (до ' + (o.maxSentences || 4) + ' речень), доречні емодзі без перебору. ' + (o.noGreeting === false ? '' : 'НЕ вітайся — клієнта вже привітали. ') + 'НЕ вигадуй фактів: відповідай ЛИШЕ з блоку ФАКТИ; якщо відповіді там нема — скажи «уточню в менеджера і напишу сюди». Ніколи не називай реквізити, номери карток, посилання, суми, розміри чи кольори, яких нема у ФАКТАХ. Не називай конкретний день відправки. Не повторюй картку товару. БЕЗ markdown: жодних зірочок, «---», заголовків, нумерованих списків — звичайний текст як у месенджері. Розмір НІКОЛИ не підбирай сам (це робить система за сіткою).\n\nФАКТИ:\n' + facts;
    const task = [
        o.questions && o.questions.length ? 'Спершу коротко відповідай на питання клієнта: ' + o.questions.map((q) => '«' + q + '»').join(', ') + '.' : '',
        o.ack ? 'Підтверди коротко: ' + o.ack : '',
        o.nextStep ? 'Потім ' + o.nextStep : '',
        o.tone ? 'Тон: ' + o.tone : '',
        'Одне цілісне повідомлення. Без JSON.',
    ].filter(Boolean).join(' ');
    const lastClient = stripLoneSurrogates(String(A.turnText || '[фото]')).slice(0, 800);
    const t0 = Date.now();
    try {
        const txt = await callClaude({ sessionId: A.session.id, systemPrompt, messages: [{ role: 'user', content: 'Останнє повідомлення клієнта: «' + lastClient + '»\n\nЗАВДАННЯ: ' + task }], options: { model, maxTokens: 500, extra: { temperature: 0.3 } } });
        A.trace.push({ llm: 'compose', model, ms: Date.now() - t0 });
        return String(txt || '').replace(/```[a-z]*\n?|```/g, '').trim();
    } catch (e) {
        logger.warn('[shopAgent] compose failed: ' + e.message, { sessionId: A.session.id });
        return o.fallback || '';
    }
}

module.exports = { compose, productFacts, shopFacts };
