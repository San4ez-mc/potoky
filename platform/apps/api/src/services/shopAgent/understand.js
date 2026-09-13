'use strict';
/**
 * shopAgent/understand.js — крок «розуміння»: один LLM-виклик зі строгою JSON-схемою.
 * Не пише клієнту. Отримує стан розмови + останні репліки (включно з менеджером) і повертає
 * наміри та слоти в ТИХ САМИХ формах, які очікують інструменти (height/weight/clothingSize,
 * color, method cod|full, fullName/phone/city/branch, ready yes|no, setChoice, extras…).
 */
const { callClaude } = require('@platform/claude');
const { logger, stripLoneSurrogates } = require('./lib');

const SCHEMA = `{
 "intent": "greeting|product_query|give_params|give_color|choose_set|order_yes|order_no|hesitate|pay_method|give_address|paid|wants_requisites|question|wants_human|complaint|return_exchange|postpone|thanks|other",
 "height": number|null, "weight": number|null, "clothingSize": "S|M|L|XL|XXL|XXXL|<число>"|null, "chest": number|null, "footLength": number|null, "waist": number|null, "belly": true|false,
 "color": "<колір словами клієнта>"|null, "colorMatched": "<точна назва зі СПИСКУ КОЛЬОРІВ товару або null>", "qty": number|null,
 "units": [{"color":"...","size":"..."}]|null,
 "setChoice": "set|item"|null, "setArticle": "<артикул компонента зі списку>"|null,
 "ready": "yes|no"|null, "addUpsell": true|false|null, "upsellQty": number|null, "upsellNote": "<колір/розмір допродажу>"|null,
 "extraProducts": "<інші товари, які хоче додати: назва/артикул, колір, розмір, кількість>"|null, "alsoWants": "<те саме, якщо згадано мимохідь>"|null,
 "changeRequest": "<хоче змінити колір/розмір/кількість уже узгодженого — що саме>"|null,
 "payMethod": "cod|full"|null, "country": "<країна доставки за кордон>"|null, "prepaymentObjection": true|false, "trustPromise": true|false|null,
 "fullName": "<ПІБ>"|null, "phone": "<10 цифр з 0>"|null, "city": "<місто>"|null, "region": "<область>"|null, "branch": "<№ відділення або 'поштомат N'>"|null, "homeAddress": true|false,
 "wantsManualReq": true|false, "paymentMethodChange": "cod|full"|null, "claimsPaid": true|false, "receiptLink": "<url>"|null,
 "wantsSizeChart": true|false, "wantsPhoto": true|false, "wantsUpsellPhoto": true|false, "wantsHuman": true|false, "isComplaint": true|false, "returnRequest": true|false, "statusQuestion": true|false,
 "productHint": {"article": "<A0187 тощо>"|null, "category": "<кофта|костюм|куртка|бомбер|футболка|джинси|лофери|...>"|null, "fromList": "<назва/артикул зі списку, який бот щойно показав>"|null},
 "questions": ["<питання клієнта, на які треба відповісти фактами>"],
 "sentiment": "neutral|positive|annoyed|angry",
 "summary": "<одне речення: що клієнт зробив цим повідомленням>"
}`;

const RULES = `ПРАВИЛА РОЗБОРУ:
- Розбираєш ЛИШЕ ОСТАННЄ повідомлення клієнта (може бути кілька рядків/повідомлень підряд); історія — тільки контекст для розуміння посилань («вище», «та сама», «перша»).
- Зріст 140–220 см (1,78 м = 178), вага 35–200 кг; якщо переплутано місцями — виправ. Діапазон («90-95») → більше значення. Підписані рядки («Вага 78», «Зріст 182») — теж параметри.
- Розміри: хс/с/м/л/хл/ххл/хххл → XS/S/M/L/XL/XXL/XXXL; «розмір 31/42» → clothingSize "31"/"42".
- color: як сказав клієнт; colorMatched — ЛИШЕ назва зі СПИСКУ КОЛЬОРІВ (сірий → «Сірий» або «Світло-сірий» лише якщо такий один; графіт → «Графітовий»; чорн → «Чорний»; синь → «Синій/Темно-синій» лише якщо один). Нема однозначного збігу → null.
- payMethod: «1», «часткова», «наложка/накладений/при отриманні», «200» → cod; «2», «повна», «повністю», «передоплата», «по передоплаті», «зараз всю суму» → full. Питання «а можна накладеним?» без вибору → payMethod null + questions.
- prepaymentObjection: клієнт відмовляється платити 200 грн наперед / не довіряє / «тільки при отриманні, без передоплати» / «звідки я знаю, що не обманете». trustPromise: після питання «обіцяєте прийти на пошту?» — так/обіцяю → true, ні → false.
- ready "yes": явна згода оформити («так», «давайте», «оформляйте», «беру», «+», «ок» у відповідь на «Оформляємо?»); також якщо клієнт одразу шле дані доставки. "no" — явна відмова. Вагання («подумаю», «пізніше») → intent hesitate/postpone, ready null.
- Дані доставки: phone — 10 цифр з 0 (прибери +38, пробіли, дефіси); fullName — 2–3 слова прізвище/імʼя; branch — число (1–3 цифри = відділення, 4+ = поштомат: пиши «поштомат 12345»); homeAddress=true якщо вулиця/будинок/квартира/«додому»/«таксі» замість відділення.
- wantsHuman: явно просить людину/менеджера, «ви бот?», «дайте живу людину». isComplaint: претензія (не той товар, брак, не прийшло). returnRequest: хоче повернути/обміняти вже отриманий товар.
- statusQuestion: питає, де посилка/коли відправлять/ТТН уже оформленого замовлення.
- questions: усі питання не про слоти (ціна, склад, доставка за кордон, чи є в наявності інший розмір/колір, гарантія…). Питання «яка ціна?» коли товар ЩЕ не показано — це product_query, не question.
- productHint.fromList: якщо бот щойно показував список товарів, а клієнт відповів словом/кольором/номером, що вказує на один із них — назви його артикул зі списку.
- Порожнє/тільки емодзі/«[фото]» без тексту → intent other, усе null; «[фото]» разом із «є така?» → product_query.
- Ніколи не вигадуй слоти, яких немає в повідомленні. Поверни ЛИШЕ JSON, без пояснень.`;

function summarizeState(ctx) {
    const p = ctx.product || null;
    const lines = [];
    if (p && p.sku) {
        lines.push('ТОВАР У РОЗМОВІ: ' + (p.customerName || p.name) + ' (арт. ' + p.sku + '), ціна ' + p.price + ' грн' + (p.isSet ? '; це КОМПЛЕКТ: ' + (p.setList || p.setComponents || '') : ''));
        lines.push('СПИСОК КОЛЬОРІВ ТОВАРУ: ' + (p.colors || '—') + '. Розміри: ' + ((p.sizes || []).join(', ') || '—') + '. Потрібні параметри: ' + (p.categoryParamsPrompt || (p.isClothing ? 'зріст і вага' : '—')));
        if (p.upsell) lines.push('ДОПРОДАЖ (можна додати): ' + p.upsell);
    } else lines.push('ТОВАР У РОЗМОВІ: ще не визначено.');
    const st = [];
    if (ctx.sizeInput && (ctx.sizeInput.height || ctx.sizeInput.clothingSize)) st.push('параметри: ' + JSON.stringify(ctx.sizeInput));
    if (ctx.recommendedSize) st.push('розмір: ' + ctx.recommendedSize);
    if (ctx.colorChoice && ctx.colorChoice.color) st.push('колір: ' + ctx.colorChoice.color);
    if (ctx.orderIntent && ctx.orderIntent.ready) st.push('згода оформити: ' + ctx.orderIntent.ready);
    if (ctx.paymentInfo && ctx.paymentInfo.method) st.push('оплата: ' + ctx.paymentInfo.method + (ctx.payAmount != null ? ' (' + ctx.payAmount + ' грн)' : ''));
    if (ctx.orderData) st.push('доставка: ' + ['fullName', 'phone', 'city', 'branch'].map((k) => k + '=' + (ctx.orderData[k] || '—')).join(', '));
    if (ctx.payStatus) st.push('статус оплати: ' + ctx.payStatus);
    if (ctx.crmOrderId) st.push('ЗАМОВЛЕННЯ ВЖЕ ОФОРМЛЕНО (№' + (ctx.orderRef || ctx.crmOrderId) + ')');
    if (ctx.agent && ctx.agent.lastAsk) st.push('останнє питання бота: «' + String(ctx.agent.lastAsk).slice(0, 160) + '»');
    if (ctx.catalogHint && !(p && p.sku)) st.push('бот щойно показав список: ' + String(ctx.catalogHint).replace(/\n/g, ' | ').slice(0, 400));
    if (ctx.trustScriptStep) st.push('скрипт довіри до передоплати: крок ' + ctx.trustScriptStep);
    lines.push('СТАН: ' + (st.join('; ') || 'початок розмови'));
    return lines.join('\n');
}

function extractJson(text) {
    const s = String(text || '');
    const i = s.indexOf('{'); const j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { /* try to fix trailing commas */ }
    try { return JSON.parse(s.slice(i, j + 1).replace(/,\s*([}\]])/g, '$1')); } catch (e) { return null; }
}

/**
 * @param A агентний контекст {ctx, keys, session, history:[{who,text}], turnText}
 * @returns розібраний обʼєкт (усі поля присутні; null де нема)
 */
async function understand(A) {
    const { ctx, keys } = A;
    const model = keys.AGENT_UNDERSTAND_MODEL || 'claude-sonnet-4-6';
    const hist = (A.history || []).slice(-14).map((m) => (m.who === 'client' ? 'КЛІЄНТ' : m.who === 'manager' ? 'МЕНЕДЖЕР' : 'БОТ') + ': ' + stripLoneSurrogates(String(m.text || '')).replace(/\s+/g, ' ').slice(0, 400)).join('\n');
    const systemPrompt = 'Ти — модуль розуміння повідомлень клієнта Instagram-магазину чоловічого одягу. Не відповідаєш клієнту. Витягуєш наміри й дані у JSON.\n\nСХЕМА ВІДПОВІДІ (усі ключі обовʼязкові, null де даних нема):\n' + SCHEMA + '\n\n' + RULES;
    const user = summarizeState(ctx) + '\n\nІСТОРІЯ (старіше → новіше):\n' + (hist || '(порожньо)') + '\n\nОСТАННЄ ПОВІДОМЛЕННЯ КЛІЄНТА (розбирай саме його):\n' + stripLoneSurrogates(String(A.turnText || '[фото]')).slice(0, 1500) + (A.turnImage ? '\n[до повідомлення прикріплено фото]' : '') + (A.turnSharedPost ? '\n[клієнт переслав пост/рілс магазину' + (A.turnSharedPost.caption ? ': «' + String(A.turnSharedPost.caption).slice(0, 200) + '»' : '') + ']' : '');
    const t0 = Date.now();
    let raw = '';
    try {
        raw = await callClaude({ sessionId: A.session.id, systemPrompt, messages: [{ role: 'user', content: user }], options: { model, maxTokens: 900, extra: { temperature: 0 } } });
    } catch (e) {
        logger.warn('[shopAgent] understand failed: ' + e.message, { sessionId: A.session.id });
        return { intent: 'other', questions: [], _error: e.message };
    }
    const u = extractJson(raw) || { intent: 'other' };
    u.questions = Array.isArray(u.questions) ? u.questions.filter((q) => q && String(q).trim()).map(String) : [];
    u.productHint = u.productHint && typeof u.productHint === 'object' ? u.productHint : { article: null, category: null, fromList: null };
    for (const k of ['height', 'weight', 'chest', 'footLength', 'waist', 'qty', 'upsellQty']) { const v = Number(u[k]); u[k] = Number.isFinite(v) && v > 0 ? v : null; }
    if (u.height && u.weight && u.height < u.weight && u.weight >= 140 && u.height <= 200) { const t = u.height; u.height = u.weight; u.weight = t; }
    if (u.clothingSize) u.clothingSize = String(u.clothingSize).toUpperCase().replace(/ХС/g, 'XS').replace(/ХХХЛ/g, 'XXXL').replace(/ХХЛ/g, 'XXL').replace(/ХЛ/g, 'XL').replace(/^Л$/, 'L').replace(/^М$/, 'M').replace(/^С$/, 'S').trim();
    if (u.phone) u.phone = String(u.phone).replace(/\D/g, '').replace(/^38/, '').replace(/^8(?=0\d{9})/, ''); if (u.phone && !/^0\d{9}$/.test(u.phone)) u.phone = null;
    A.trace.push({ llm: 'understand', model, ms: Date.now() - t0, intent: u.intent, summary: u.summary });
    return u;
}

module.exports = { understand, summarizeState, extractJson };
