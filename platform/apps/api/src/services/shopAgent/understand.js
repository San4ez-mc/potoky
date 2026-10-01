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
 "ready": "yes|no"|null, "addUpsell": true|false|null, "upsellQty": number|null, "upsellNote": "<колір/розмір допродажу — вільним текстом, для менеджера>"|null,
 "upsellUnits": [{"color":"...","size":"..."}]|null,
 "extraProducts": "<інші товари, які хоче додати: назва/артикул, колір, розмір, кількість>"|null, "alsoWants": "<те саме, якщо згадано мимохідь>"|null,
 "removeItem": "<хоче ПРИБРАТИ конкретну позицію з комплекту/замовлення — назви її словами клієнта: категорія/назва/артикул, напр. 'взуття', 'лофери', 'джинси'>"|null,
 "addItem": "<хоче ДОДАТИ позицію (повернути прибрану зі складу комплекту, або зовсім новий товар) — назва/артикул, колір, розмір, кількість>"|null,
 "itemColors": [{"item":"<позиція словами клієнта: кофта/джинси/футболка/лофери чи артикул>","color":"<колір словами клієнта>"}]|null,
 "changeRequest": "<хоче ЗМІНИТИ колір/розмір/кількість УЖЕ обраної позиції комплекту чи товару (не додати, не прибрати) — що саме і якої позиції, словами клієнта>"|null,
 "payMethod": "cod|full"|null, "country": "<країна доставки за кордон>"|null, "prepaymentObjection": true|false, "trustPromise": true|false|null,
 "fullName": "<ПІБ>"|null, "phone": "<10 цифр з 0>"|null, "city": "<місто>"|null, "region": "<область>"|null, "branch": "<№ відділення або 'поштомат N'>"|null, "homeAddress": true|false,
 "wantsManualReq": true|false, "wantsCard": true|false, "paymentMethodChange": "cod|full"|null, "claimsPaid": true|false, "receiptLink": "<url>"|null,
 "refersToStory": true|false, "replaceOrAdd": "replace|add|keep"|null, "wantsOrderSummary": true|false, "compare": true|false,
 "wantsSizeChart": true|false, "wantsPhoto": true|false, "wantsUpsellPhoto": true|false, "wantsHuman": true|false, "isComplaint": true|false, "annoyedAtBot": true|false, "returnRequest": true|false, "statusQuestion": true|false,
 "productHint": {"article": "<A0187 тощо>"|null, "category": "<кофта|костюм|куртка|бомбер|футболка|джинси|лофери|...>"|null, "fromList": "<назва/артикул зі списку, який бот щойно показав>"|null},
 "questions": ["<питання клієнта, на які треба відповісти фактами>"],
 "sentiment": "neutral|positive|annoyed|angry",
 "summary": "<одне речення: що клієнт зробив цим повідомленням>"
}`;

const RULES = `ПРАВИЛА РОЗБОРУ:
- refersToStory=true — клієнт ПО СУТІ дає зрозуміти, що його цікавить товар із історії/сторіз/відео магазину, на яку він відповідав (будь-якими словами: «я ж на вашу історію відповів», «те, що в сторіс», «з розповіді» тощо). Інакше false.
- replaceOrAdd — ЛИШЕ якщо бот щойно спитав «замінити, додати окремою позицією чи залишаємо як було?»: replace — хоче новий товар замість попереднього; add — хоче обидва; keep — лишає як було. Інакше null.
- compare=true — клієнт ПИТАЄ, ЧИМ ВІДРІЗНЯЮТЬСЯ товари / яка різниця / який кращий (питання, навіть якщо назвав артикул іншого). Вибір кількох номерів чи назв зі списку («2,4», «беру перший і третій») — це НЕ порівняння (compare=false, це вибір). Приклади compare=true: «А чим вона відрізняється від кофти D0050?», «яка різниця між A0187 і C0043?», «а що краще — ця чи Мажор?». Це питання, а НЕ вибір іншого товару: productHint.article тоді null, а питання — у questions.
- wantsOrderSummary=true — хоче ще раз побачити/перевірити, що саме в його замовленні (склад, розмір, колір, сума), будь-якими словами.
- «Реквізити» (навіть з назвою банку: «скиньте реквізити в монобанку/приват») = wantsManualReq=true, wantsCard=false — назва банку лише означає, звідки клієнт платитиме. wantsCard=true ЛИШЕ коли прямо просить номер картки.
- Розбираєш ЛИШЕ ОСТАННЄ повідомлення клієнта (може бути кілька рядків/повідомлень підряд); історія — тільки контекст для розуміння посилань («вище», «та сама», «перша»).
- 2026-09-15 (живий кейс: «Черный и графитовый» → бот сказав «нема такого кольору», хоча обидва в наявності): клієнт МОЖЕ писати українською, суржиком або РОСІЙСЬКОЮ — розумієш зміст незалежно від мови повідомлення. Усі "довідникові" поля (colorMatched і т.п.) ЗАВЖДИ зводь до українських назв з каталогу/схеми, як і при україномовному повідомленні — мова клієнта не привід повернути null там, де переклад однозначний.
- Зріст 140–220 см (1,78 м = 178), вага 35–200 кг; якщо переплутано місцями — виправ. Діапазон («90-95») → більше значення. Підписані рядки («Вага 78», «Зріст 182») — теж параметри.
- Розміри: хс/с/м/л/хл/ххл/хххл → XS/S/M/L/XL/XXL/XXXL; «розмір 31/42» → clothingSize "31"/"42".
- color: як сказав клієнт (мовою оригіналу); colorMatched — ЛИШЕ назва зі СПИСКУ КОЛЬОРІВ, українською, незалежно від мови клієнта (сірий/серый → «Сірий» або «Світло-сірий» лише якщо такий один; темно-сірий/темно-серый → «Графітовий», якщо він є у списку; відтінок «темно-»/«світло-» НІКОЛИ не міняй на протилежний (темно-сірий ≠ «Світло-сірий»); графіт/графит → «Графітовий»; чорн/черн(ый) → «Чорний»; синь/син(ий) → «Синій/Темно-синій» лише якщо один; білий/белый→«Білий»; червоний/красный→«Червоний»; зелений/зелёный→«Зелений»; жовтий/жёлтый→«Жовтий»; коричневий/коричневый→«Коричневий»; рожевий/розовый→«Рожевий»; фіолетовий/фиолетовый→«Фіолетовий»; блакитний/голубой→«Блакитний»; бежевий/бежевый→«Бежевий»; бордовий/бордовый→«Бордовий»; хакі/хаки→«Хакі»). Хоче ОБИДВА кольори одразу («черный и графитовый», «2 шт — чорний і графітовий») — це НЕ один colorMatched, а units: [{"color":"Чорний"},{"color":"Графітовий"}]. units[].color — теж назва зі СПИСКУ КОЛЬОРІВ за тими самими правилами. «Темний»/«світлий»/«якийсь темніший» без назви кольору — це побажання, не вибір: colorMatched null (бот перепитає, запропонувавши темні варіанти). Нема однозначного збігу → null.
- wantsManualReq=true: просить реквізити/рахунок/«на карту», АБО скаржиться, що посилання на оплату не відкривається / не працює / банк не підтягується / «не можу оплатити за посиланням» (тоді бот одразу шле ручні реквізити, а не перепитує «яке посилання»).
- payMethod: «1», «часткова», «наложка/накладений/при отриманні», «200» → cod; «2», «повна», «повністю», «зараз всю суму», «вся сума» → full. Просто «передоплата»/«предоплата»/«по передоплаті» БЕЗ цифри чи слів «повна/вся сума/200» — НЕОДНОЗНАЧНО (може бути і 200 грн, і повна): payMethod null (бот перепитає 1 чи 2). Згода без вибору («+», «так», «ок», «давайте», «👍») у відповідь на «1 чи 2?» — це НЕ вибір способу: payMethod null (ready можна yes), спосіб за клієнта НЕ обирай. Питання «а можна накладеним?» без вибору → payMethod null + questions.
- prepaymentObjection: клієнт відмовляється платити 200 грн наперед / не довіряє / «тільки при отриманні, без передоплати» / «звідки я знаю, що не обманете». trustPromise: після питання «обіцяєте прийти на пошту?» — так/обіцяю → true, ні → false.
- Відмова лише від ДОПРОДАЖУ («футболка не потрібна», «без футболки», «тільки бомбер») → addUpsell=false, ready НЕ "no" (це не відмова від замовлення; якщо при цьому є згода — ready "yes").
- 2026-09-21 (живий баг: "Футболки він вміє оформляти тільки чорні і тільки С розміру" — колір/розмір допродажу йшли ЛИШЕ вільним текстом у upsellNote, система постачальника не мала структурованих даних і мовчки бралась перший варіант з каталогу): коли клієнт називає конкретний колір/розмір допродажу («чорну», «білу M», «одна біла і одна чорна») — ОБОВ'ЯЗКОВО заповнюй ще й upsellUnits, той самий формат, що й units для основного товару: одна одиниця допродажу → [{"color":"Чорний"}], дві РІЗНІ → [{"color":"Білий"},{"color":"Чорний"}]. upsellNote лишається як є (текст для менеджера), upsellUnits — для автоматичного оформлення постачальнику. Колір/розмір допродажу НЕ названо (просто «додайте», «так») → upsellUnits не заповнюй.
- itemColors: коли клієнт в ОДНОМУ повідомленні називає кольори для РІЗНИХ позицій («кофта чорна джинси темно сині», «светр графіт, штани сині») — кожна пара окремо, дослівно. Один колір без позиції → лише color. Навіть без ком і сполучників: колір належить найближчій до нього позиції.
- setChoice / setArticle (дивись РЕЖИМ у стані): "set" — клієнт хоче ВЕСЬ комплект/набір/образ будь-якими словами («весь комплект», «мне это набор все», «все що на фото», «увесь образ», перелічує ВСІ позиції комплекту) — і тоді, коли зараз у розмові лише одна річ із нього (setArticle = артикул комплекту з РЕЖИМУ). "item" — хоче ЛИШЕ ОДНУ позицію комплекту («тільки кофту», «лише джинси окремо») — setArticle = ТОЧНИЙ артикул цієї позиції зі складу комплекту. Кілька, але не всі позиції — setChoice null (це склад: removeItem/addItem). Питання про ціну/колір/розмір однієї позиції або фото того самого образу без слів — це НЕ вибір: setChoice null.
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
- annoyedAtBot=true — ЛИШЕ явне обурення самою розмовою, образа чи насмішка над нами: «ви знущаєтесь?», «ви на приколі?», «ви мене дістали», лайка на адресу магазину. НЕ annoyedAtBot: нетерплячка («?», «Ау», «???», «ви тут?»), уточнення чи повтор свого вибору («я ж написав один», «я відповів на вашу історію», «я вже казав розмір») — це звичайні повідомлення зі змістом, на них відповідаємо по суті.
- wantsHuman: явно просить людину/менеджера, «ви бот?», «дайте живу людину». isComplaint: претензія (не той товар, брак, не прийшло). returnRequest: хоче повернути/обміняти ВЖЕ ОТРИМАНИЙ товар (є замовлення/посилка на руках). Загальне запитання про політику («чи можна обміняти/повернути, якщо не підійде?», «які умови повернення?») ДО покупки — це НЕ returnRequest, а звичайне питання в questions (відповідь є в базі знань).
- statusQuestion: питає, де посилка/коли відправлять/ТТН уже оформленого замовлення.
- productHint.category — лише коли клієнт хоче ІНШИЙ товар цієї категорії («а джинси є?», «покажіть куртки»). Якщо він говорить про ЧАСТИНУ товару в розмові (штани чи верх костюма, рукав кофти: «штани подобаються, а верх ні», «штани звужені?») — category = null, це розмова про поточний товар.
- belly=true — клієнт згадує живіт/животик/пузо/«повний у талії» (навіть окремим коротким повідомленням після підбору розміру) — це параметр для підбору (розмір більше), а не питання.
- clothingSize: розмір, як назвав клієнт, без «округлення» вниз: 2XL = XXL; 2XXL, 3XL, XXXL = XXXL; 4XL = 4XL. У questions теж пиши саме цей розмір.
- questions: усі питання не про слоти (ціна, склад, доставка за кордон, чи є в наявності інший розмір/колір, гарантія…). Питання «яка ціна?» коли товар ЩЕ не показано — це product_query, не question. «Як замовити?», «хочу замовити», «як оформити?» — це НАМІР замовити (intent product_query/order_yes), НЕ questions: відповідь на нього — наступний крок оформлення (параметри/колір), а не окреме пояснення. Кожне питання — словами клієнта; НЕ приписуй його товару в розмові, якщо клієнт питає про іншу річ (у розмові кофта, а клієнт питає «штани будуть звужені?» — питання про штани, не про кофту; артикул додавай лише той, що клієнт сам назвав або що очевидно стосується саме цієї речі).
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
        // Режим «комплект чи одна річ» — аналізатор має його бачити, інакше «весь набір»/«тільки кофта» читає наосліп (01.10).
        const og = ctx.agent && ctx.agent.originSet;
        if (p.isSet) lines.push('РЕЖИМ: ' + (ctx.setMode === 'set' ? 'клієнт бере ВЕСЬ комплект' + (Array.isArray(ctx.setSelection) && ctx.setSelection.length ? ' (позиції: ' + ctx.setSelection.map((it) => it.article).join(', ') + ')' : '') : 'ще не вибрано — весь комплект чи окремі речі з нього'));
        else if (og && og.sku && Array.isArray(og.items) && og.items.includes(String(p.sku).toUpperCase())) lines.push('РЕЖИМ: зараз ОДНА річ (арт. ' + p.sku + ') з комплекту ' + og.sku + ' (у ньому: ' + og.items.join(', ') + '). Якщо клієнт хоче весь комплект/весь образ/все з фото — setChoice "set", setArticle "' + og.sku + '".');
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
    let failed = null; let noCredit = false;
    try {
        raw = await callClaude({ sessionId: A.session.id, systemPrompt, messages: [{ role: 'user', content: user }], options: { model, maxTokens: 900, extra: { temperature: 0 }, noFallbackOnBilling: true } });
    } catch (e) {
        logger.warn('[shopAgent] understand failed: ' + e.message, { sessionId: A.session.id });
        failed = e.message;
        if (e && e.code === 'CLAUDE_NO_CREDIT') noCredit = true;
    }
    // Навіть якщо модель не відповіла — повертаємо ПОВНИЙ обʼєкт (усі поля, productHint), а не урізаний:
    // з 24.09 урізаний обʼєкт валив увесь хід («reading 'article'», 254 рази) → клієнт бачив «Секунду, перевіряю…».
    const u = (!failed && extractJson(raw)) || { intent: 'other' };
    if (failed) {
        u._error = failed;
        // Закінчились кредити Claude — рішення власника: бот нічого не відповідає й кличе менеджера (без розбору навіть чисел).
        if (noCredit) { u._noCredit = true; return u; }
        // ШІ недоступний (30.09 20:21–20:24: Claude без кредитів, OpenAI 429, Gemini 402) — бот не бачив «Зріст 169 Вага 101»
        // і перепитував зріст і вагу знову й знову. Числа (ДАНІ, не зміст) витягуємо детерміновано, щоб підбір розміру працював.
        const hw = extractHeightWeight(String(A.turnText || ''));
        if (hw) { u.height = hw.height; u.weight = hw.weight; u.intent = 'give_params'; u._offlineParse = true; }
    }
    for (const k of ['height', 'weight', 'clothingSize', 'chest', 'footLength', 'waist', 'color', 'colorMatched', 'qty', 'units', 'setChoice', 'setArticle', 'ready', 'addUpsell', 'upsellQty', 'upsellNote', 'upsellUnits', 'extraProducts', 'alsoWants', 'removeItem', 'addItem', 'itemColors', 'changeRequest', 'payMethod', 'country', 'trustPromise', 'fullName', 'phone', 'city', 'region', 'branch', 'paymentMethodChange', 'receiptLink']) if (u[k] === undefined) u[k] = null;
    for (const k of ['belly', 'refersToStory', 'wantsOrderSummary', 'compare', 'prepaymentObjection', 'homeAddress', 'wantsManualReq', 'wantsCard', 'claimsPaid', 'wantsSizeChart', 'wantsPhoto', 'wantsUpsellPhoto', 'wantsHuman', 'isComplaint', 'annoyedAtBot', 'returnRequest', 'statusQuestion']) u[k] = !!u[k];
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

/** Зріст і вага з тексту без ШІ: «Зріст 169 Вага 101», «176, 90кг», «183\nВага 84», «1.87 86», «рост 180 вес 85». null — не впевнені. */
function extractHeightWeight(text) {
    const t = String(text || '').toLowerCase().replace(/,(?=\d)/g, '.');
    const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => ({ v: Number(m[0]), i: m.index, raw: m[0] }));
    if (nums.length !== 2) return null; // без ШІ — лише однозначний випадок «зріст + вага»
    const before = (n) => t.slice(Math.max(0, n.i - 10), n.i); const after = (n) => t.slice(n.i + n.raw.length, n.i + n.raw.length + 3);
    const isW = (n) => /(вага|вес)\D*$/.test(before(n)) || /^\s?кг/.test(after(n));
    const isH = (n) => /(зріст|зрост|рост)\D*$/.test(before(n)) || /^\s?(см|cm)/.test(after(n));
    let height = null; let weight = null;
    for (const n of nums) {
        let v = n.v; if (v >= 1.4 && v <= 2.3 && /\./.test(n.raw)) v = Math.round(v * 100);
        if (!height && v >= 140 && v <= 220 && !isW(n)) { height = v; continue; }
        if (!weight && v >= 35 && v <= 200 && Number.isInteger(n.v) && !isH(n)) weight = v;
    }
    return height && weight && height !== weight ? { height, weight } : null;
}

module.exports = { understand, summarizeState, extractJson, extractHeightWeight };
