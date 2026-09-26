'use strict';
/**
 * shopAgent/compose.js — формулювання відповіді. LLM отримує ЛИШЕ факти від політики і
 * завдання «відповісти на питання X і підвести до кроку Y»; вигадувати нема з чого.
 * Для фіксованих кроків (картка товару, реквізити, підсумок) політика шле шаблони напряму.
 */
const { callClaude } = require('@platform/claude');
const { logger, stripLoneSurrogates, loadCatalog } = require('./lib');

function productFacts(ctx) {
    const p = ctx.product; if (!p || !p.sku) return '';
    const f = [];
    f.push('Товар: ' + (p.customerName || p.name) + ' (арт. ' + p.sku + '), ціна ' + p.price + ' грн.');
    if (p.desc) f.push('Опис: ' + String(p.desc).replace(/\s+/g, ' ').slice(0, 700));
    if (p.colors) f.push('Кольори: ' + p.colors + '.');
    if (Array.isArray(p.sizes) && p.sizes.length) f.push('Розміри: ' + p.sizes.join(', ') + '.');
    else if (p.sizeChartData && Array.isArray(p.sizeChartData.sizes) && p.sizeChartData.sizes.length) f.push('Розміри в наявності (за розмірною сіткою товару): ' + p.sizeChartData.sizes.join(', ') + '. Інших розмірів немає.'); // лофери: розміри лише в sizeChartData (41–45), у p.sizes порожньо
    // 2026-09-14 (власник): розмірна сітка йде клієнту ЛИШЕ картинкою (n_agent_size_chart_caption,
    // за u.wantsSizeChart) АБО через питання параметрів категорії (isHW/paramsPrompt) — ніколи
    // текстом. Раніше сюди підмішувалась p.sizeChartText як «факт» для LLM — вона могла проговорити
    // сітку словами в чаті, що дублює/суперечить картинці. Прибрано повністю.
    if (p.aiInfo) f.push('Нюанси (для тебе, не цитуй списком): ' + String(p.aiInfo).slice(0, 500));
    if (p.qtyPromoText) f.push('Акція за кількість: ' + p.qtyPromoText);
    if (p.upsell) f.push('Допродаж: ' + p.upsell);
    if (p.isSet && p.setList) f.push('Склад комплекту: ' + p.setList);
    // 2026-09-18 (живий кейс, Artem Dzhelema/set1111: "Яка ціна за комплект без взуття (кофта +
    // джинси + футболка)?" — бот не знав відповіді й ескалював менеджеру, хоча ціна кожної позиції
    // комплекту вже є в даних (той самий pp.setItems, з якого humanSetList() будує список для
    // "весь комплект чи окремі речі?"). Питання "скільки за комплект без X" чи "скільки за тільки
    // Y і Z" — це просто сума потрібних позицій, яку LLM може порахувати сама з готових цін, без
    // звернення до менеджера.
    if (p.isSet && Array.isArray(p.setItems) && p.setItems.length) {
        const itemsLine = p.setItems.map((it) => it.name + ' — ' + (Number(it.price) || 0) + ' грн').join('; ');
        f.push('Ціни позицій комплекту окремо: ' + itemsLine + '. Якщо клієнт питає ціну комплекту БЕЗ якоїсь позиції, або лише за декілька позицій — сам порахуй суму потрібних позицій за цими цінами (не кажи "уточню окремо" і не клич менеджера — це проста арифметика).');
    }
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
        ? 'Розмірну сітку/таблицю замірів НІКОЛИ не переказуй текстом — вона йде клієнту лише окремою картинкою (можеш сказати, що надсилаєш її окремим фото). Сітка стосується ЛИШЕ основного товару: якщо питають сітку для допродажу/іншого товару (напр. футболки) — НЕ обіцяй її окремим фото, скажи що розмір підберемо за зростом і вагою.'
        : 'Точної розмірної сітки/картинки з замірами для ЦЬОГО товару в системі НЕМА — НІКОЛИ не обіцяй надіслати картинку чи "розмірну сітку окремим фото" (це порожня обіцянка, якої нічим виконати). Якщо просять сітку/заміри — чесно скажи, що точної сітки саме для цього товару нема, і попроси зріст/вагу (чи інший наявний параметр) для підбору системою.';
}

// 2026-09-17 (власник: універсальний фолбек для питань "не по скрипту" — щоб надійно відрізняти
// "відповів з фактів" від "чесно не знає", а не гадати за текстом відповіді, compose() тепер
// повертає структурований {text, resolved}. resolved:false — хоч ОДНЕ з o.questions залишилось
// без чесної відповіді з ФАКТІВ/KB (LLM сама про це каже: не вигадала, а зізналась) — цей сигнал
// веде до ескалації в Telegram і чернетки в KB (policy.js), без жодного regex/ключових слів.
function extractJsonLoose(raw) {
    const s = String(raw || '').replace(/```[a-z]*\n?|```/gi, '').trim();
    try { return JSON.parse(s); } catch (e) { /* спробуємо витягти перший {...} блок нижче */ }
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) { /* здаємось */ } }
    return null;
}

async function compose(A, o = {}) {
    const { ctx, keys } = A;
    // Частина викликів (перед підсумком замовлення, оплата) не передавала базу знань — модель тоді вигадувала («відправка наступного дня»). Завжди підвантажуємо.
    if (o.kb === undefined && Array.isArray(o.questions) && o.questions.length) {
        try { o = { ...o, kb: await require('./tools').kbContext(A) }; } catch (e) { /* best-effort */ }
    }
    const model = keys.AGENT_COMPOSE_MODEL || 'claude-sonnet-4-6';
    const persona = keys.PERSONA_NAME || 'Оля'; const shop = keys.SHOP_TAG || 'магазин';
    // 2026-09-24 (FunnelTest 38): питання про допродаж («з чого футболка?») — факти про нього лежать у картці товару допродажу,
    // а не в ФАКТАХ основного товару; підтягуємо текстові поля товару допродажу з каталогу CRM.
    let upFacts = '';
    try {
        const up = ctx.product && Array.isArray(ctx.product.upsellItems) && ctx.product.upsellItems[0];
        if (up && up.id && o.questions && o.questions.length) {
            const cat = await loadCatalog(A.botId, keys);
            const pr = cat.products.find((x) => x.id === up.id);
            if (pr) upFacts = 'ІНФОРМАЦІЯ ПРО ТОВАР ДОПРОДАЖУ (' + (pr.customerName || pr.name) + '):\n' + Object.entries(pr).filter(([k, v]) => typeof v === 'string' && v.length > 12 && !/^https?:/.test(v) && !/^(id|sku|supplierArticle|createdAt|updatedAt)$/.test(k)).map(([k, v]) => v).join('\n').slice(0, 1200);
        }
    } catch (e) { logger.warn('[compose] upsell facts failed', { error: e.message }); }
    // 2026-09-24 (FunnelTest 39: «уточню» двічі на одну тему): якщо питання вже передавали менеджеру — не повторюємо фразу.
    const escalatedBefore = (ctx.agent && Array.isArray(ctx.agent.escalatedQuestions) && ctx.agent.escalatedQuestions.length)
        ? 'ПОПЕРЕДЖЕННЯ: у цій розмові питання клієнта вже передано менеджеру і бот уже казав «уточню». Якщо й зараз у ФАКТАХ немає відповіді — НЕ використовуй слова «уточню», «уточнимо», «уточнити», «перевірю» ні в якій формі; скажи коротко, що менеджер уже в курсі й відповість сюди, щойно зможе.' : '';
    const facts = [productFacts(ctx), shopFacts(ctx), o.extraFacts || '', upFacts, escalatedBefore, (o.kb || []).length ? 'БАЗА ЗНАНЬ (факти саме про цей магазин, точніші за будь-які припущення):\n' + o.kb.map((h) => '• ' + (h.q ? 'Питання: ' + h.q + ' → ' : '') + 'Відповідь: ' + h.a).join('\n') : '', o.availAnswer ? 'НАЯВНІСТЬ (система щойно перевірила каталог):\n' + o.availAnswer : ''].filter(Boolean).join('\n\n');
    const sizeChartRule = sizeChartRuleFor(ctx);
    const hasQuestions = !!(o.questions && o.questions.length);
    const systemPrompt = 'Ти — ' + persona + ', жива тепла консультантка ' + shop + ' в Instagram. Українською, на «ви», коротко (до ' + (o.maxSentences || 4) + ' речень), доречні емодзі без перебору. ' + (o.noGreeting === false ? '' : 'НЕ вітайся — клієнта вже привітали. ') + 'НЕ вигадуй фактів: відповідай ЛИШЕ з блоку ФАКТИ; якщо відповіді там нема — чесно скажи «уточню і повернусь із відповіддю» (саме цими чи подібними словами, без вигадування). Якщо клієнт питає розмір чи колір, якого в ФАКТАХ НЕМАЄ (напр. взуття 47, коли є 41–45) — не кажи «уточню», а прямо назви, які розміри/кольори є. Особливо: про доставку за кордон / в іншу країну, вартість доставки, терміни — НЕ стверджуй ні «так», ні «ні», ні «лише по Україні», доки цього прямо немає в ФАКТАХ/БАЗІ ЗНАНЬ; кажи, що уточниш у менеджера. Знижку військовим/УБД сама НЕ пропонуй і не згадуй, якщо клієнт не сказав, що він військовий чи питає саме про військову знижку. Ніколи не кажи «система підібрала/підбере/автоматично» — говори від себе («я підібрала за розмірною сіткою»); на сумнів «не замалий?» поясни логіку підбору за зростом і вагою коротко й запропонуй сітку. Про матеріали та властивості тканини (що таке ангора/акрил/бавовна, чи колеться, чи тягнеться, чи електризується, як сідає) — НІЯКИХ власних загальних знань і припущень («зазвичай», «як правило»): лише те, що прямо написано в ФАКТАХ/БАЗІ ЗНАНЬ, дослівно за змістом; якщо в БАЗІ ЗНАНЬ є пряма відповідь («не колеться» тощо) — скажи саме її. Температурні діапазони («до скількох градусів»), щільність, склад — називай ЛИШЕ якщо вони прямо є в ФАКТАХ/БАЗІ ЗНАНЬ; інакше чесно: точних даних немає, уточню в менеджера (не вигадуй числа). Ніколи не обіцяй «надішлю реквізити/картку в особисті» і не підтверджуй суму передоплати, поки немає обраного товару й способу оплати — реквізити видає система після вибору «1» або «2». Але якщо відповідь Є в БАЗІ ЗНАНЬ (обмін/повернення, терміни відправки й обміну, оплата, зберігання на пошті тощо) — ОБОВʼЯЗКОВО відповідай саме нею, без «уточню». Ніколи не називай реквізити, номери карток, посилання, суми, розміри чи кольори, яких нема у ФАКТАХ. Не називай конкретний день відправки. Не повторюй картку товару: якщо назва товару й ціна вже прозвучали в цьому діалозі (є в ФАКТАХ як вже показані) — НЕ називай їх знову окремим реченням-нагадуванням («Х зараз за акційною ціною Y грн» тощо), навіть коротко чи іншими словами — клієнт це щойно бачив. БЕЗ markdown: жодних зірочок, «---», заголовків, нумерованих списків — звичайний текст як у месенджері. Розмір НІКОЛИ не підбирай сам (це робить система за сіткою). ' + sizeChartRule + '\n\nФАКТИ:\n' + facts
        + (hasQuestions ? '\n\nФОРМАТ ВІДПОВІДІ — ЛИШЕ JSON, без markdown-обгортки: {"text": "<повідомлення клієнту>", "resolved": true|false}. resolved:false — якщо хоча б на ОДНЕ з питань клієнта в блоці ФАКТИ/БАЗА ЗНАНЬ немає чесної відповіді (тоді text каже "уточню і повернусь", БЕЗ вигадки). resolved:true — якщо на всі питання відповів з ФАКТІВ, або питань не було.' : '');
    const task = [
        hasQuestions ? 'Спершу коротко відповідай на питання клієнта: ' + o.questions.map((q) => '«' + q + '»').join(', ') + '.' : '',
        o.ack ? 'Підтверди коротко: ' + o.ack : '',
        o.nextStep ? 'Потім ' + o.nextStep : '',
        o.tone ? 'Тон: ' + o.tone : '',
        hasQuestions ? 'Одне цілісне повідомлення, як описано в ФОРМАТІ ВІДПОВІДІ.' : 'Одне цілісне повідомлення. Без JSON.',
    ].filter(Boolean).join(' ');
    const lastClient = stripLoneSurrogates(String(A.turnText || '[фото]')).slice(0, 800);
    const t0 = Date.now();
    try {
        const raw = await callClaude({ sessionId: A.session.id, systemPrompt, messages: [{ role: 'user', content: 'Останнє повідомлення клієнта: «' + lastClient + '»\n\nЗАВДАННЯ: ' + task }], options: { model, maxTokens: 500, extra: { temperature: 0.3 } } });
        A.trace.push({ llm: 'compose', model, ms: Date.now() - t0 });
        if (!hasQuestions) return { text: String(raw || '').replace(/```[a-z]*\n?|```/g, '').trim(), resolved: true };
        const parsed = extractJsonLoose(raw);
        if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) return { text: parsed.text.trim(), resolved: parsed.resolved !== false };
        // LLM не повернула валідний JSON (рідкісний збій формату) — не рвемо хід, беремо сирий текст
        // як відповідь, але resolved:false, щоб питання клієнта все одно пішло на ескалацію, а не загубилось.
        logger.warn('[shopAgent] compose: невалідний JSON, fallback на сирий текст', { sessionId: A.session.id });
        return { text: String(raw || '').replace(/```[a-z]*\n?|```/g, '').trim() || (o.fallback || ''), resolved: false };
    } catch (e) {
        logger.warn('[shopAgent] compose failed: ' + e.message, { sessionId: A.session.id });
        return { text: o.fallback || '', resolved: !hasQuestions };
    }
}

module.exports = { compose, productFacts, shopFacts, sizeChartRuleFor, extractJsonLoose };
