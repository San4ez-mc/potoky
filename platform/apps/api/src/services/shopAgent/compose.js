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
    // 2026-09-14 (власник): розмірна сітка йде клієнту ЛИШЕ картинкою (n_agent_size_chart_caption,
    // за u.wantsSizeChart) АБО через питання параметрів категорії (isHW/paramsPrompt) — ніколи
    // текстом. Раніше сюди підмішувалась p.sizeChartText як «факт» для LLM — вона могла проговорити
    // сітку словами в чаті, що дублює/суперечить картинці. Прибрано повністю.
    if (p.aiInfo) f.push('Нюанси (для тебе, не цитуй списком): ' + String(p.aiInfo).slice(0, 500));
    if (p.qtyPromoText) f.push('Акція за кількість: ' + p.qtyPromoText);
    if (p.upsell) f.push('Допродаж: ' + p.upsell);
    if (p.isSet && p.setList) f.push('Склад комплекту: ' + p.setList);
    if (ctx.setSizesText) f.push('ПІДІБРАНІ СИСТЕМОЮ РОЗМІРИ ПО ПОЗИЦІЯХ КОМПЛЕКТУ: ' + String(ctx.setSizesText).replace(/\s+/g, ' ') + ' — називай лише їх, не перераховуй.');
    else if (ctx.recommendedSize) f.push('ПІДІБРАНИЙ СИСТЕМОЮ РОЗМІР: ' + ctx.recommendedSize + ' — називай лише його, НІКОЛИ не рахуй розмір сам за сіткою/зростом/вагою і не пропонуй інший.');
    else if (ctx.sizeInput && (ctx.sizeInput.height || ctx.sizeInput.weight)) f.push('Розмір ще НЕ підібрано (рахує система) — не називай жодного розміру.');
    if (ctx.colorChoice && ctx.colorChoice.color) f.push('Обраний колір: ' + ctx.colorChoice.color + '.');
    if (ctx.orderUnitsText) f.push('Позиції замовлення: ' + ctx.orderUnitsText + (ctx.orderUnitsTotal ? ' — ' + ctx.orderUnitsTotal + ' грн' : '') + '.');
    if (ctx.payAmount != null && ctx.paymentInfo && ctx.paymentInfo.method) f.push('Оплата: ' + ctx.payLabel + ' — до сплати зараз ' + ctx.payAmount + ' грн.');
    return f.join('\n');
}
// 2026-09-14 (власник): тут БУВ хардкоджений абзац із сумою передоплати/комісією пошти/термінами
// доставки й обміну — дублював (і міг розійтися з) ctx.shop.faq/.terms, які вже приходять
// динамічно з бази знань CRM (n_shop_profile, GET /knowledge/profile). Прибрано повністю:
// джерело істини — ЛИШЕ CRM. Якщо профіль магазину в CRM ще не заповнений (faq/terms порожні),
// LLM чесно скаже "уточню в менеджера" (правило в system-промпті нижче), а не назве вигадані
// чи застарілі цифри.
function shopFacts(ctx) {
    const s = ctx.shop || {}; const f = [];
    if (s.faq) f.push('Довідка магазину: ' + s.faq);
    if (s.terms) f.push('Умови: ' + s.terms);
    return f.join('\n');
}

/**
 * Скласти одну відповідь: (відповіді на питання з фактів) + (наступний крок).
 * @param A агентний контекст
 * @param o { questions:[], nextStep:'<що спитати/сказати далі, дослівно або суть>', extraFacts:'', kb:[{q,a}], availAnswer:'', tone:'', noGreeting:true, maxSentences }
 */
// 2026-09-15 (живий кейс, власник: "не розумію для чого пише 'уточнимо окремо в чаті'" + 3
// незалежні скарги "не надіслало фото розмірної сітки" / "бот обіцяє скинути [а нема]") —
// системний промпт БЕЗУМОВНО казав "сітка йде окремою картинкою", хоча реальне надсилання фото
// гейтиться наявністю pp.sizeChartUrl (policy.js) — коли файлу нема в CRM, LLM все одно впевнено
// обіцяла картинку, якої ніколи не буде. Та сама категорія бага, що вже виправлена для
// "уточнимо окремо в чаті": обіцянка тексту й реальна дія мають бути СИНХРОНІЗОВАНІ. Винесено в
// окрему функцію — детермінована, без звернення до LLM, тому легко покривається регрес-тестом.
function sizeChartRuleFor(ctx) {
    const hasSizeChart = !!(ctx && ctx.product && ctx.product.sizeChartUrl);
    return hasSizeChart
        ? 'Розмірну сітку/таблицю замірів НІКОЛИ не переказуй текстом — вона йде клієнту лише окремою картинкою (можеш сказати, що надсилаєш її окремим фото).'
        : 'Точної розмірної сітки/картинки з замірами для ЦЬОГО товару в системі НЕМА — НІКОЛИ не обіцяй надіслати картинку чи "розмірну сітку окремим фото" (це порожня обіцянка, якої нічим виконати). Якщо просять сітку/заміри — чесно скажи, що точної сітки саме для цього товару нема, і попроси зріст/вагу (чи інший наявний параметр) для підбору системою.';
}

async function compose(A, o = {}) {
    const { ctx, keys } = A;
    const model = keys.AGENT_COMPOSE_MODEL || 'claude-sonnet-4-6';
    const persona = keys.PERSONA_NAME || 'Оля'; const shop = keys.SHOP_TAG || 'магазин';
    const facts = [productFacts(ctx), shopFacts(ctx), o.extraFacts || '', (o.kb || []).length ? 'БАЗА ЗНАНЬ (факти саме про цей магазин, точніші за будь-які припущення):\n' + o.kb.map((h) => '• ' + (h.q ? 'Питання: ' + h.q + ' → ' : '') + 'Відповідь: ' + h.a).join('\n') : '', o.availAnswer ? 'НАЯВНІСТЬ (система щойно перевірила каталог):\n' + o.availAnswer : ''].filter(Boolean).join('\n\n');
    const sizeChartRule = sizeChartRuleFor(ctx);
    const systemPrompt = 'Ти — ' + persona + ', жива тепла консультантка ' + shop + ' в Instagram. Українською, на «ви», коротко (до ' + (o.maxSentences || 4) + ' речень), доречні емодзі без перебору. ' + (o.noGreeting === false ? '' : 'НЕ вітайся — клієнта вже привітали. ') + 'НЕ вигадуй фактів: відповідай ЛИШЕ з блоку ФАКТИ; якщо відповіді там нема — скажи «уточню в менеджера і напишу сюди». Ніколи не називай реквізити, номери карток, посилання, суми, розміри чи кольори, яких нема у ФАКТАХ. Не називай конкретний день відправки. Не повторюй картку товару: якщо назва товару й ціна вже прозвучали в цьому діалозі (є в ФАКТАХ як вже показані) — НЕ називай їх знову окремим реченням-нагадуванням («Х зараз за акційною ціною Y грн» тощо), навіть коротко чи іншими словами — клієнт це щойно бачив. БЕЗ markdown: жодних зірочок, «---», заголовків, нумерованих списків — звичайний текст як у месенджері. Розмір НІКОЛИ не підбирай сам (це робить система за сіткою). ' + sizeChartRule + '\n\nФАКТИ:\n' + facts;
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

module.exports = { compose, productFacts, shopFacts, sizeChartRuleFor };
