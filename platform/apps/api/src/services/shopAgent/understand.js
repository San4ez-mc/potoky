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
 "removeItem": "<хоче ПРИБРАТИ конкретну позицію з комплекту/замовлення — назви її словами клієнта: категорія/назва/артикул, напр. 'взуття', 'лофери', 'джинси'>"|null,
 "addItem": "<хоче ДОДАТИ позицію (повернути прибрану зі складу комплекту, або зовсім новий товар) — назва/артикул, колір, розмір, кількість>"|null,
 "changeRequest": "<хоче ЗМІНИТИ колір/розмір/кількість УЖЕ обраної позиції комплекту чи товару (не додати, не прибрати) — що саме і якої позиції, словами клієнта>"|null,
 "payMethod": "cod|full"|null, "country": "<країна доставки за кордон>"|null, "prepaymentObjection": true|false, "trustPromise": true|false|null,
 "fullName": "<ПІБ>"|null, "phone": "<10 цифр з 0>"|null, "city": "<місто>"|null, "region": "<область>"|null, "branch": "<№ відділення або 'поштомат N'>"|null, "homeAddress": true|false,
 "wantsManualReq": true|false, "wantsCard": true|false, "paymentMethodChange": "cod|full"|null, "claimsPaid": true|false, "receiptLink": "<url>"|null,
 "wantsSizeChart": true|false, "wantsPhoto": true|false, "wantsUpsellPhoto": true|false, "wantsHuman": true|false, "isComplaint": true|false, "returnRequest": true|false, "statusQuestion": true|false,
 "productHint": {"article": "<A0187 тощо>"|null, "category": "<кофта|костюм|куртка|бомбер|футболка|джинси|лофери|...>"|null, "fromList": "<назва/артикул зі списку, який бот щойно показав>"|null},
 "questions": ["<питання клієнта, на які треба відповісти фактами>"],
 "sentiment": "neutral|positive|annoyed|angry",
 "summary": "<одне речення: що клієнт зробив цим повідомленням>"
}`;

const RULES = `ПРАВИЛА РОЗБОРУ:
- Розбираєш ЛИШЕ ОСТАННЄ повідомлення клієнта (може бути кілька рядків/повідомлень підряд); історія — тільки контекст для розуміння посилань («вище», «та сама», «перша»).
- 2026-09-15 (живий кейс: «Черный и графитовый» → бот сказав «нема такого кольору», хоча обидва в наявності): клієнт МОЖЕ писати українською, суржиком або РОСІЙСЬКОЮ — розумієш зміст незалежно від мови повідомлення. Усі "довідникові" поля (colorMatched і т.п.) ЗАВЖДИ зводь до українських назв з каталогу/схеми, як і при україномовному повідомленні — мова клієнта не привід повернути null там, де переклад однозначний.
- Зріст 140–220 см (1,78 м = 178), вага 35–200 кг; якщо переплутано місцями — виправ. Діапазон («90-95») → більше значення. Підписані рядки («Вага 78», «Зріст 182») — теж параметри.
- Розміри: хс/с/м/л/хл/ххл/хххл → XS/S/M/L/XL/XXL/XXXL; «розмір 31/42» → clothingSize "31"/"42".
- color: як сказав клієнт (мовою оригіналу); colorMatched — ЛИШЕ назва зі СПИСКУ КОЛЬОРІВ, українською, незалежно від мови клієнта (сірий/серый → «Сірий» або «Світло-сірий» лише якщо такий один; графіт/графит → «Графітовий»; чорн/черн(ый) → «Чорний»; синь/син(ий) → «Синій/Темно-синій» лише якщо один; білий/белый→«Білий»; червоний/красный→«Червоний»; зелений/зелёный→«Зелений»; жовтий/жёлтый→«Жовтий»; коричневий/коричневый→«Коричневий»; рожевий/розовый→«Рожевий»; фіолетовий/фиолетовый→«Фіолетовий»; блакитний/голубой→«Блакитний»; бежевий/бежевый→«Бежевий»; бордовий/бордовый→«Бордовий»; хакі/хаки→«Хакі»). Хоче ОБИДВА кольори одразу («черный и графитовый», «2 шт — чорний і графітовий») — це НЕ один colorMatched, а units: [{"color":"Чорний"},{"color":"Графітовий"}]. Нема однозначного збігу → null.
- payMethod: «1», «часткова», «наложка/накладений/при отриманні», «200» → cod; «2», «повна», «повністю», «передоплата», «по передоплаті», «зараз всю суму» → full. Питання «а можна накладеним?» без вибору → payMethod null + questions.
- prepaymentObjection: клієнт відмовляється платити 200 грн наперед / не довіряє / «тільки при отриманні, без передоплати» / «звідки я знаю, що не обманете». trustPromise: після питання «обіцяєте прийти на пошту?» — так/обіцяю → true, ні → false.
- Відмова лише від ДОПРОДАЖУ («футболка не потрібна», «без футболки», «тільки бомбер») → addUpsell=false, ready НЕ "no" (це не відмова від замовлення; якщо при цьому є згода — ready "yes").
- Склад КОМПЛЕКТУ, коли товар у розмові — комплект: «без взуття/лоферів», «джинси не треба», «приберіть Х» → removeItem="X". «Додайте ще джинси», «а поверніть взуття», «і лофери теж» → addItem="X". «Джинси хочу чорні замість синіх», «дві футболки» → changeRequest з назвою позиції. Це НЕ те саме, що addUpsell/alsoWants (ті — для допродажу/товарів ПОЗА комплектом, коли товар НЕ комплект).
- ready "yes": явна згода оформити («так», «давайте», «оформляйте», «беру», «+», «ок» у відповідь на «Оформляємо?»); також якщо клієнт одразу шле дані доставки. "no" — явна відмова. Вагання («подумаю», «пізніше») → intent hesitate/postpone, ready null.
- Дані доставки: phone — 10 цифр з 0 (прибери +38, пробіли, дефіси); fullName — 2–3 слова прізвище/імʼя; branch — число (1–3 цифри = відділення, 4+ = поштомат: пиши «поштомат 12345»).
- 2026-09-15 (живий кейс: "Львівська обл. Рудне. Вул Яворницького 95 відділення 1" — номер
  "відділення 1" ПРОІГНОРУВАЛИ, бо повідомлення ТЕЖ містило вулицю): номер відділення/поштомата
  трапляється в БУДЬ-ЯКІЙ з цих форм — «відділення 1», «відділення №1», «відділення номер 1»,
  «НП1», «НП 1», «Нп1» (будь-який регістр), «нова пошта 1», «нова пошта №2», «Нової пошти 1»,
  «пункт №1», «пункт видачі 1», словом-числівником («перше відділення» = 1, «друге» = 2 тощо),
  з друкарськими помилками («віділеня», «новой почта» рос.). Якщо ЗНАЙШЛА число з будь-якого з
  цих варіантів — це branch, ЗАВЖДИ, навіть якщо в ТОМУ Ж повідомленні є вулиця/будинок
  (люди часто пишуть повну адресу відділення словами: «вулиця X, буд Y, відділення N» — це НЕ
  прохання доставки додому, а просто опис, де стоїть відділення).
- homeAddress=true СТАВ ЛИШЕ коли номера відділення/поштомата НЕМА В ЖОДНІЙ формі вище — саме
  вулиця/будинок/квартира/«додому»/«таксі» БЕЗ жодного посилання на Нову Пошту чи номера.
- wantsPhoto/wantsSizeChart: ЛИШЕ коли клієнт явно просить надіслати фото/сітку («скиньте фото», «є розмірна сітка?»); прикріплене клієнтом фото — це НЕ прохання фото.
- wantsHuman: явно просить людину/менеджера, «ви бот?», «дайте живу людину». isComplaint: претензія (не той товар, брак, не прийшло). returnRequest: хоче повернути/обміняти вже отриманий товар.
- statusQuestion: питає, де посилка/коли відправлять/ТТН уже оформленого замовлення.
- questions: усі питання не про слоти (ціна, склад, доставка за кордон, чи є в наявності інший розмір/колір, гарантія…). Питання «яка ціна?» коли товар ЩЕ не показано — це product_query, не question.
- 2026-09-18 (живий кейс, Kolya Kolya: «Зі змійкою не під шию треба» — це ВИМОГА до товару, не граматичне питання, тож questions лишився порожнім, і бот жодного разу не відповів на неї — картка мала б чесно сказати "лише один варіант виконання", ця відповідь ВЖЕ була в CRM, просто ніхто не спитав): questions — це НЕ лише речення зі знаком питання. Якщо клієнт СТВЕРДЖУЄ вимогу, побажання чи заперечення щодо конкретної характеристики товару (фасон, деталь, матеріал, комплектація тощо — НЕ розмір/колір/кількість, для них є свої слоти), яку неможливо визначити з наявних дій бота — теж додай це до questions, сформулювавши як питання-факт («Зі змійкою не під шию треба» → «Чи є варіант без високої змійки на комірі?»). Порожнє нарікання без конкретики («не подобається», «якесь дивне») сюди НЕ йде.
- productHint.fromList: якщо бот щойно показував список товарів, а клієнт відповів словом/кольором/номером, що вказує на один із них — назви його артикул зі списку.
- Порожнє/тільки емодзі/«[фото]» без тексту → intent other, усе null; «[фото]» разом із «є така?» → product_query.
- Ніколи не вигадуй слоти, яких немає в повідомленні. Поверни ЛИШЕ JSON, без пояснень.
- ЕКОНОМНО: включай у JSON лише intent, summary, questions (може бути []) і ті ключі, що мають НЕ-null/НЕ-false значення. Ключі зі значенням null/false пропускай.`;

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
    const model = process.env.AGENT_UNDERSTAND_MODEL || keys.AGENT_UNDERSTAND_MODEL || 'claude-sonnet-4-6';
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
    for (const k of ['height', 'weight', 'clothingSize', 'chest', 'footLength', 'waist', 'color', 'colorMatched', 'qty', 'units', 'setChoice', 'setArticle', 'ready', 'addUpsell', 'upsellQty', 'upsellNote', 'extraProducts', 'alsoWants', 'removeItem', 'addItem', 'changeRequest', 'payMethod', 'country', 'trustPromise', 'fullName', 'phone', 'city', 'region', 'branch', 'paymentMethodChange', 'receiptLink']) if (u[k] === undefined) u[k] = null;
    for (const k of ['belly', 'prepaymentObjection', 'homeAddress', 'wantsManualReq', 'wantsCard', 'claimsPaid', 'wantsSizeChart', 'wantsPhoto', 'wantsUpsellPhoto', 'wantsHuman', 'isComplaint', 'returnRequest', 'statusQuestion']) u[k] = !!u[k];
    u.intent = u.intent || 'other';
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
