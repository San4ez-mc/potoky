'use strict';
/**
 * Регресійний набір для goverla_shop (shopAgent v2) — 2026-09-15.
 *
 * НАВІЩО: кожен фікс цієї сесії (аудит живих розмов + скарги власника) перевірявся окремо через
 * реплей чи ізольований скрипт — і працював. Але точкова перевірка «цей конкретний фікс працює»
 * не гарантує, що НАСТУПНА зміна коду його не зламає знову. Цей файл — постійний, закомічений у
 * репо тест: один прогін одразу перевіряє ВСІ знайдені сьогодні регресії. Запускати:
 *   node apps/api/src/services/shopAgent/__regression__/goverla-regression.js
 * (потребує підключення до бойової БД — запускати на сервері або з відповідним DATABASE_URL).
 *
 * Тести НЕ викликають LLM (understand/compose) — вони підставляють готовий обʼєкт розуміння `u`
 * напряму в runPolicy(), як і policy.js очікує. Це робить прогін швидким (секунди, не хвилини),
 * безкоштовним і на 100% детермінованим — жодної залежності від того, що цього разу відповість
 * модель. Перед КОЖНИМ деплоєм змін у policy.js/tools.js/compose.js/lib.js цієї воронки — прогнати
 * цей файл; усі тести мають бути PASS.
 *
 * Файл запускається як самостійний скрипт (не через звичайний entrypoint платформи), тому сам
 * налаштовує резолюцію workspace-пакетів (@platform/db тощо) — без цього монорепо-пакети не
 * резолвляться і процес мовчки зависає на першому ж require.
 */
if (require.main === module && !process.env.NODE_PATH) {
    // Той самий шлях, яким на сервері живе платформа (див. CLAUDE.md, §1) — скрипт запускається
    // як самостійний процес, не через звичайний entrypoint, тож монорепо-пакети інакше не знайти.
    process.env.NODE_PATH = '/var/www/flows.fineko.space/platform/node_modules';
    require('module').Module._initPaths();
}
const { loadAssets } = require('../lib');
const { runPolicy, matchColor, enforceInsistLimit, breakLoop } = require('../policy');

const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
let assets;
const results = [];

function check(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail || '' });
    console.log((cond ? '✅ PASS' : '❌ FAIL') + ' — ' + name + (detail ? '  (' + detail + ')' : ''));
}

function freshA(overrides = {}) {
    return {
        botId: BOT,
        session: { id: 'regress-' + Math.random().toString(36).slice(2), state: 'inbox' },
        ctx: { testMode: true, agent: {} },
        keys: assets.keys,
        assets,
        user: {},
        trace: [],
        out: [],
        turnText: '',
        turnImage: null,
        history: [],
        botSpokeBefore: true,
        ...overrides,
    };
}
function freshU(overrides = {}) {
    return { intent: 'other', questions: [], productHint: {}, ...overrides };
}

async function main() {
    assets = await loadAssets(BOT, { force: true });

    // ── 1. matchColor: клієнт називає ОДРАЗУ два кольори одним реченням ("Чорний та коричневий") —
    // живий кейс Вячеслав Радецький, 14.09. Раніше стем усієї фрази давав 2 кандидати → null →
    // бот брехав "нема", хоча колір є.
    {
        const colors = ['Графітовий', 'Темно-синій', 'Білий', 'Коричневий', 'Темно-зелений', 'Бордовий', 'Чорний'];
        const r = matchColor({ colors: colors.join(', ') }, 'Чорний та коричневий');
        check('matchColor: "Чорний та коричневий" знаходить наявний колір', r === 'Чорний', 'отримано: ' + r);
    }
    {
        // Одинарний колір (без сполучника) досі має працювати за старою логікою — не зламати.
        const colors = ['Графітовий', 'Темно-синій', 'Білий'];
        const r = matchColor({ colors: colors.join(', ') }, 'синій');
        check('matchColor: одинарний нечіткий колір ("синій"→"Темно-синій") досі працює', r === 'Темно-синій', 'отримано: ' + r);
    }
    {
        // Живий кейс 15.09: "джинси сині" — "сині" узгоджена форма з "джинси" (множина), а не
        // "синій" каталогу; підрядковий пошук раніше знаходив 3 кандидати (Синій/Світло-синій/
        // Темно-синій) і здавався. Базовий колір без дефіса має вигравати неоднозначність.
        const colors = ['Світло-синій', 'Синій', 'Графітовий', 'Чорний', 'Блакитний', 'Темно-синій'];
        const r1 = matchColor({ colors: colors.join(', ') }, 'джинси сині');
        check('matchColor: "джинси сині" знаходить саме "Синій", не здається через 3 кандидати', r1 === 'Синій', 'отримано: ' + r1);
        const r2 = matchColor({ colors: colors.join(', ') }, 'темно-сині');
        check('matchColor: явно назване "темно-сині" все ще матчить складений варіант', r2 === 'Темно-синій', 'отримано: ' + r2);
    }
    {
        // Живий кейс 15.09 (Edits): "Черный и графитовый" — клієнт пише РОСІЙСЬКОЮ, обидва кольори
        // реально в наявності, а бот сказав "нема такого кольору". Корінь відрізняється від
        // українського каталогу (черный≠чорний, графит≠графіт) — самого стемінгу замало.
        const colors = ['Графітовий', 'Чорний', 'Світло-сірий'];
        const r1 = matchColor({ colors: colors.join(', ') }, 'Черный и графитовый');
        check('matchColor: "Черный" (рос.) знаходить "Чорний"', r1 === 'Чорний', 'отримано: ' + r1);
        const r2 = matchColor({ colors: colors.join(', ') }, 'графитовый');
        check('matchColor: "графитовый" (рос.) знаходить "Графітовий"', r2 === 'Графітовий', 'отримано: ' + r2);
        const r3 = matchColor({ colors: ['Білий', 'Сірий', 'Синій'].join(', ') }, 'серый');
        check('matchColor: "серый" (рос.) знаходить "Сірий"', r3 === 'Сірий', 'отримано: ' + r3);
        const r4 = matchColor({ colors: ['Червоний', 'Синій'].join(', ') }, 'красный');
        check('matchColor: "красный" (рос., зовсім інший корінь) знаходить "Червоний"', r4 === 'Червоний', 'отримано: ' + r4);
        const r5 = matchColor({ colors: ['Блакитний', 'Рожевий'].join(', ') }, 'розовый');
        check('matchColor: "розовый" (рос.) знаходить "Рожевий"', r5 === 'Рожевий', 'отримано: ' + r5);
    }

    // ── 1в. Живий кейс 17.09 (Oleksii Oleksii, 28000137) — КРИТИЧНИЙ: "2 кофти по акції" + клієнт
    // ЧІТКО назвав ОБИДВА кольори ("Графітовий і світло сірий" тощо) — бот перепитував колір
    // 7 РАЗІВ поспіль. Корінь: understand() правильно кладе це в u.units (не colorMatched/color за
    // власним правилом), але секція "5. Колір" перевіряла ЛИШЕ colorMatched/color — u.units там
    // ніколи не читався, тож гейт "колір не обрано" не знімався попри чіткий units-сигнал.
    {
        const A = freshA({ turnText: 'Графітовий і світло сірий' });
        A.ctx.product = { sku: 'A0187', customerName: 'Кофта', name: 'Кофта', price: 1279, colors: 'Чорний, Графітовий, Світло-сірий', isClothing: false };
        A.ctx.recommendedSize = 'L';
        const u = freshU({ intent: 'give_color', units: [{ color: 'Графітовий' }, { color: 'Світло-сірий' }], qty: 2 });
        await runPolicy(A, u);
        check('u.units з 2 кольорами вирішує ctx.colorChoice.colors одразу (не перепитує)', Array.isArray(A.ctx.colorChoice && A.ctx.colorChoice.colors) && A.ctx.colorChoice.colors.length === 2, JSON.stringify(A.ctx.colorChoice));
        check('НЕ повторює generic "ask_color" питання, коли u.units уже дав 2 кольори', !A.out.some((o) => o.step === 'ask_color'), 'steps: ' + A.out.map((o) => o.step).join(','));
    }

    // ── 1б. Живий кейс 15.09 (cca4a961) — КРИТИЧНИЙ: інконклюзивний повторний сигнал (порожнє
    // вкладення "template", не фото товару) НЕ має права стирати ВЖЕ підтверджений товар.
    // n_lookup.fallback() безумовно обнуляв ctx.product — жива позиція (кофта, адреса, розмір,
    // колір) зникала посеред оформлення замовлення, бот забував усе й відмовлявся дати IBAN.
    {
        const { tool } = require('../tools');
        const A = freshA({ turnText: 'zzzzzzz нісенітниця без сигналу товару' });
        A.ctx.product = { sku: 'A0187', name: 'Кофта тест', customerName: 'Кофта тест. Артикул: A0187', price: 1279 };
        A.ctx.lastUserMessage = 'zzzzzzz нісенітниця без сигналу товару';
        const r = await tool(A, 'n_lookup');
        check('n_lookup: інконклюзивний сигнал НЕ стирає вже підтверджений товар', r.ok && A.ctx.product && A.ctx.product.sku === 'A0187', JSON.stringify({ ok: r.ok, product: A.ctx.product }));
        check('n_lookup: productUnknown все одно фіксується для діагностики', A.ctx.productUnknown === true, 'productUnknown: ' + A.ctx.productUnknown);
    }

    // ── 2. Каталог-підказка за словами (n_catalog_hint) — живий кейс df4ca683/e8be59a9/1b1edc15,
    // 14.09: виклик на неіснуючий id n_catalog_hint_process мовчки не працював УЗАГАЛІ (tool()
    // повертав {ok:false, error:'no code'}). Живий реплей цих сесій уже підтвердив поведінкову
    // картину (список товарів замість «перешліть пост») — тут перевіряємо саме те, що безпосередньо
    // зламалось: чи існує нода під ІМЕНЕМ, яке реально викликає tools.js, без відтворення всього
    // ланцюжка сигналів (signal_check/understand), що зробило б тест крихким і непрямим.
    {
        const { tool } = require('../tools');
        const A = freshA({ turnText: 'штани' });
        A.ctx.catalogHintMsg = 'штани'; A.ctx.catalogHintWants = ['штан', 'джинс']; A.ctx.catalogHintColorWords = []; A.ctx.catalogHintStem = 'джинс';
        const { loadCatalog, loadCategories } = require('../lib');
        const cat = await loadCatalog(BOT, assets.keys);
        A.ctx.catalogHintProductsRaw = cat.products;
        A.ctx.catalogHintCategoriesRaw = await loadCategories(BOT, assets.keys);
        const r = await tool(A, 'n_catalog_hint');
        check('Нода n_catalog_hint існує і виконується (не neexist. n_catalog_hint_process)', r.ok === true, JSON.stringify(r));
    }

    // ── 3. Ослаблення прапора "схоже на квитанцію" — живий кейс ustym_m4, 14.09: прапор ніколи не
    // гасився, тому один чек на початку розмови змушував бота повторювати той самий текст на будь-
    // яке наступне повідомлення.
    {
        const A = freshA({ turnText: 'Дякую' });
        A.ctx.looksLikeReceipt = true;
        A.ctx.hasProductSignal = false;
        const u = freshU({ intent: 'thanks' });
        await runPolicy(A, u);
        check('ctx.looksLikeReceipt гаситься одразу після використання', A.ctx.looksLikeReceipt === false, 'lишилось: ' + A.ctx.looksLikeReceipt);
    }

    // ── 3б. Живий кейс 17.09 (Юрій Карталєв, GOV3ES6KVVR): "Дякую." ПІСЛЯ оформлення замовлення —
    // Zernio позначив розмову "бот не веде далі, відповідайте в чаті". understand() вже класифікує
    // це як intent:'thanks', але policy.js ніде це не перевіряв — хід або мовчав (< 30 хв від
    // n_post_order_msg), або за 30+ хв повторно вивалював важкий "Ваше замовлення в роботі" ще раз.
    // Тепер: коротка тепла відповідь, і ГОЛОВНЕ — без сповіщення менеджеру (нема чого ескалювати).
    {
        const A = freshA({ turnText: 'Дякую' });
        A.ctx.crmOrderId = 'CRM-TEST-1'; A.ctx.postOrderMsgAt = Date.now() - 5 * 60 * 1000; // 5 хв тому — в межах 30-хв вікна
        const u = freshU({ intent: 'thanks' });
        await runPolicy(A, u);
        const step = A.out.map((o) => o.step).join(',');
        check('"Дякую" після оформлення отримує теплу відповідь, не мовчання', A.out.some((o) => o.step === 'post_order_thanks' && o.text), 'steps: ' + step);
        const alerted = A.trace.some((t) => t.alert === 'n_post_order_admin');
        check('"Дякую" після оформлення НЕ шле сповіщення менеджеру (нема чого ескалювати)', !alerted, JSON.stringify(A.trace.filter((t) => t.alert)));
    }

    // ── 4. Повторний показ способів оплати — живий кейс Владус, 14.09: другий хід без нового
    // способу оплати показував ПОВНИЙ список 1/2 ще раз, а не коротке нагадування.
    {
        const A = freshA({
            turnText: 'Нова пошта woodmall ТРЦ Хмельницький',
            ctx: {
                testMode: true, agent: { lastAsk: 'спосіб оплати 1 чи 2' },
                product: { sku: 'D0050', customerName: 'Кофта', price: 1190 },
                orderData: { fullName: 'Владус', phone: '0683031897' },
            },
        });
        const u = freshU({ intent: 'give_address', city: 'Хмельницький', branch: 'woodmall ТРЦ' });
        await runPolicy(A, u);
        const fullListShown = A.out.some((o) => /Часткова передплата 200 грн/.test(o.text || ''));
        const step = A.out.map((o) => o.step).join(',');
        check('Повторний хід без способу оплати НЕ повторює повний список 1/2', !fullListShown, 'steps: ' + step);
    }

    // ── 4б. Живий кейс 17.09 (Oleksii, bf149a35 + повторні скарги в Edits): картка йшла КОЖНОМУ
    // клієнту разом з посиланням на оплату — {{context.cardLine}} сидів прямо в дефолтному
    // n_requisites. Власник: "спочатку посилання IBAN, потім реквізити ФОП, і тільки якщо людина
    // і тут відмовляється — тоді карта" (3 рівні, не 2). Перевіряємо і новий шлях (wantsCard →
    // n_req_card), і що дефолтний n_requisites більше НЕ містить картку автоматично.
    {
        const { messageTextMultiline } = require('../lib');
        const fakeCtx = { payAmount: 200, payLabel: 'передоплата 200 грн', ibanPayUrl: 'https://ibanoplata.com/x', addressAskLine: '', cardLine: '💳 Або карткою: 1111222233334444 (ФОП Тест)' };
        const rendered = messageTextMultiline(assets, 'n_requisites', fakeCtx, 'regress-req-test');
        check('Дефолтний n_requisites БІЛЬШЕ НЕ показує картку автоматично', !/1111222233334444/.test(rendered) && !/Або карткою/.test(rendered), rendered);
    }
    {
        const A = freshA({
            turnText: 'Дайте картку',
            ctx: {
                testMode: true, agent: {},
                product: { sku: 'A0187', customerName: 'Кофта', price: 1279 },
                orderData: { fullName: 'Тест Тестович', phone: '0671234567', city: 'Київ', branch: '5' },
                orderIntent: { ready: 'yes' },
                paymentInfo: { method: 'cod' },
                fop: { name: 'ФОП Тест', cardNumber: '1111222233334444' },
            },
        });
        const u = freshU({ intent: 'wants_requisites', wantsCard: true });
        await runPolicy(A, u);
        const step = A.out.map((o) => o.step).join(',');
        check('wantsCard шле номер картки окремим повідомленням (крок req_card)', A.out.some((o) => o.step === 'req_card' && /1111222233334444/.test(o.text || '')), 'steps: ' + step);
    }

    // ── 5. hideLinks — сире посилання клієнта (напр. чек банку) ніколи не йде як видимий текст у
    // сповіщення менеджеру. Перевіряємо саму функцію (центральна точка застосування — tools.js:alert()).
    {
        const { hideLinks } = require('../lib');
        const out = hideLinks('чек: https://check.monobank.ua/p/abc123XYZ');
        const hidden = out.includes('<a href="https://check.monobank.ua/p/abc123XYZ">') && !/[^"]https:\/\//.test(out.replace(/<a href="[^"]+"/, ''));
        check('hideLinks() ховає сире посилання за текстом', hidden, out);
        // Ідемпотентність: подвійне застосування НЕ повинно ламати вже приховане посилання.
        const twice = hideLinks(out);
        check('hideLinks() застосований двічі не ламає розмітку', twice.includes('<a href="https://check.monobank.ua/p/abc123XYZ">'), twice);
    }

    // ── 6. n_receipt_alert більше не містить сирого (непрацездатного без авторизації) Zernio-URL
    // текстом у деталях сповіщення — живий кейс Владос, 15.09.
    {
        const { nodeData } = require('../lib');
        const d = nodeData(assets, 'n_receipt_alert');
        const hasRawUrlPlaceholder = /\{\{context\.lastReceiptImageUrl\}\}/.test(d.alertDetails || '');
        check('n_receipt_alert не показує сире посилання на квитанцію текстом', !hasRawUrlPlaceholder, d.alertDetails);
    }

    // ── 7. Комплект: категорійний матчинг (CRM), не хардкод-синоніми — живий кейс set1112, 13-14.09.
    {
        const A = freshA({ turnText: 'Давайте без взуття' });
        A.ctx.product = { sku: 'set1112', isSet: true, price: 5290 };
        A.ctx.setMode = 'set';
        A.ctx.recommendedSize = 'M'; // проходимо секцію «4. Розмір» — тут перевіряємо лише 5b, не весь ланцюжок.
        A.ctx.agent.setOriginal = [
            { article: 'A0187', name: 'Кофта', price: 1279, colors: [], sizes: [], qty: 1 },
            { article: '5934', name: 'Чоловічі замшеві лофери', price: 1990, colors: [], sizes: [], qty: 1 },
        ];
        A.ctx.setSelection = A.ctx.agent.setOriginal.map((x) => ({ ...x }));
        A.ctx.agent.setParams = { categoryNames: { A0187: 'Кофти', '5934': 'Взуття' } };
        const u = freshU({ intent: 'give_params', removeItem: 'взуття' });
        await runPolicy(A, u);
        const removed = Array.isArray(A.ctx.setSelection) && !A.ctx.setSelection.some((x) => x.article === '5934');
        check('«без взуття» видаляє позицію за категорією з CRM (не хардкод-словник)', removed, JSON.stringify((A.ctx.setSelection || []).map((x) => x.article)));
    }

    // ── 8. Дубль питання «весь комплект чи окремі речі» одразу після картки товару — живий кейс
    // 15.09, set1113: n_welcome для set-товару САМ уже закінчується цим питанням (з опису в CRM),
    // а секція «3. Комплект» перепитувала його ще раз окремим повідомленням.
    {
        const A = freshA({ turnText: 'Кофта Мажор петля' });
        A.justPresented = true;
        A.ctx.product = { sku: 'set1113', isSet: true, price: 5290 };
        const u = freshU({ intent: 'product_query' });
        await runPolicy(A, u);
        const askedAgain = A.out.some((o) => o.step === 'set_ask');
        check('Після щойно показаної картки set-товару питання "весь комплект?" не дублюється', !askedAgain, 'steps: ' + A.out.map((o) => o.step).join(','));
    }

    // ── 9. Універсальне злиття поспіль ідучих текстових повідомлень одного ходу (архітектурне
    // рішення 15.09) — фото завжди лишається окремим, текст-до-тексту зливається в один.
    {
        const { mergeConsecutiveTextOutputs } = require('../lib');
        const out = [
            { text: 'Перше', step: 'a' },
            { text: 'Друге', step: 'b' },
            { photoUrls: ['http://x'], step: 'photo' },
            { text: 'Третє', step: 'c' },
        ];
        const merged = mergeConsecutiveTextOutputs(out);
        const ok = merged.length === 3 && merged[0].text === 'Перше\n\nДруге' && merged[1].photoUrls && merged[2].text === 'Третє';
        check('mergeConsecutiveTextOutputs зливає текст-до-тексту, не чіпає фото', ok, JSON.stringify(merged.map((m) => m.text || 'photo')));
    }

    // ── 9в. Живий кейс 15.09 (власник: "айбан треба скидати окремим повідомленням... воно точно
    // було у воронці, а тепер пропало") — РЕГРЕСІЯ від самого мерджу (9): sendManualRequisites()
    // навмисно шле кожне поле реквізитів (IBAN/ЄДРПОУ/назва/призначення) ОКРЕМИМ повідомленням для
    // зручного копіювання — noMerge:true захищає їх від загального склеювання тексту-до-тексту.
    {
        const { mergeConsecutiveTextOutputs } = require('../lib');
        const out = [
            { text: 'Хочете оплатити вручну?', step: 'req_manual' },
            { text: '🏦 Номер IBAN:', step: 'n_req_iban_l', noMerge: true },
            { text: 'UA053220010000026003380060450', step: 'n_req_iban_v', noMerge: true },
            { text: '📝 Код ЄДРПОУ:', step: 'n_req_code_l', noMerge: true },
            { text: '3717807661', step: 'n_req_code_v', noMerge: true },
        ];
        const merged = mergeConsecutiveTextOutputs(out);
        const ok = merged.length === 5 && merged[1].text === '🏦 Номер IBAN:' && merged[2].text === 'UA053220010000026003380060450';
        check('mergeConsecutiveTextOutputs НЕ чіпає поля реквізитів (noMerge) — кожне лишається окремим повідомленням для копіювання', ok, JSON.stringify(merged.map((m) => m.text)));
    }

    // ── 9б. Живий кейс 15.09 (власник: "2 рази дякую чомусь в одному повідомленні") — при злитті
    // двох текстів другий не повторює вступну подяку першого.
    {
        const { mergeConsecutiveTextOutputs } = require('../lib');
        const out = [
            { text: 'Дякуємо! 🎉 Дані отримали, замовлення в системі.', step: 'a' },
            { text: 'Дякую! 🙌 Оплату поки не бачу у виписці — щойно надійде, підтверджу.', step: 'b' },
        ];
        const merged = mergeConsecutiveTextOutputs(out);
        const ok = merged.length === 1 && merged[0].text === 'Дякуємо! 🎉 Дані отримали, замовлення в системі.\n\nОплату поки не бачу у виписці — щойно надійде, підтверджу.';
        check('mergeConsecutiveTextOutputs не дублює вступну подяку', ok, merged[0] && merged[0].text);
    }

    // ── 10. Колір позицій комплекту — живий кейс 15.09 (власник: "якого кольору джинси ми
    // оформимо?"): однокольорові позиції підтягуються самі, багатоколірні — питаються окремо.
    {
        const A = freshA({ turnText: 'Синя' });
        A.ctx.product = { sku: 'set1113', isSet: true, price: 5290 };
        A.ctx.setMode = 'set';
        A.ctx.recommendedSize = 'M'; // проходимо повз секцію «4. Розмір» — тут перевіряємо лише 5b.
        A.ctx.agent.setOriginal = [
            { article: 'D0050', name: 'Кофта', price: 1190, colors: ['Чорний'], sizes: [], qty: 1, color: '' },
            { article: 'j0032', name: 'Джинси', price: 1590, colors: ['Синій', 'Чорний', 'Графітовий'], colorPhotos: { 'Синій': 'https://x/sinii.jpg', 'Чорний': 'https://x/chornii.jpg', 'Графітовий': 'https://x/grafit.jpg' }, sizes: [], qty: 1, color: '' },
        ];
        A.ctx.setSelection = A.ctx.agent.setOriginal.map((x) => ({ ...x }));
        const u = freshU({ intent: 'give_params' });
        await runPolicy(A, u);
        const kofta = A.ctx.setSelection.find((x) => x.article === 'D0050');
        const jeans = A.ctx.setSelection.find((x) => x.article === 'j0032');
        check('Однокольорова позиція комплекту (Кофта) підтягується автоматично', kofta && kofta.color === 'Чорний', 'колір: ' + (kofta && kofta.color));
        // Джинси мають 3 кольори і клієнт не назвав жодного явно щодо них — має запитати.
        const asked = A.out.some((o) => o.step && o.step.includes('set_color_ask'));
        check('Багатоколірна позиція без явної вказівки — бот питає', asked, 'steps: ' + A.out.map((o) => o.step).join(','));
        // 2026-09-15 (власник: "де 'виберіть колір' треба обов'язково скидати фото цих кольорів")
        const photoStep = A.out.find((o) => o.step === 'set_color_ask_photos');
        const photosOk = photoStep && Array.isArray(photoStep.photoUrls) && photoStep.photoUrls.length === 3;
        check('Питання про колір комплекту — з альбомом фото по кожному кольору', photosOk, JSON.stringify(photoStep));
    }

    // ── 11. Підсумок замовлення для комплекту — живий кейс 15.09 (власник: "форматування не
    // застосувалось"): список позицій ішов через кому в один рядок замість буллетів з переносами.
    {
        const A = freshA({ turnText: 'Так' });
        A.ctx.product = { sku: 'set1113', isSet: true, price: 5290, customerName: 'Комплект 4 в 1' };
        A.ctx.setMode = 'set';
        A.ctx.recommendedSize = 'M';
        A.ctx.setSelection = [
            { article: 'D0050', name: 'Кофта', price: 1190, qty: 1, color: 'Чорний' },
            { article: 'j0032', name: 'Джинси', price: 1590, qty: 1, color: 'Синій' },
        ];
        A.ctx.agent.setPricing = { total: 2780, edited: true };
        const u = freshU({ intent: 'order_yes' });
        await runPolicy(A, u);
        const txt = (A.out.find((o) => o.step === 'order_intent') || {}).text || '';
        const hasBullets = txt.includes('• Кофта') && txt.includes('• Джинси') && !txt.includes('Кофта (Чорний), Джинси');
        check('Підсумок замовлення для комплекту — позиції буллетами з переносами, не комою в рядок', hasBullets, JSON.stringify(txt));
    }

    // ── 12. Живий кейс 15.09 (власник: "бот про то забув і продав тільки джинси") — згадка
    // товару-компонента комплекту ("чорні джинси") НЕ повинна перемикати ctx.product на окремий
    // товар і стирати весь прогрес комплекту (setSelection/sizeInput). productHint.article
    // імітує понял()-сигнал, який на проді й спричинив підміну.
    {
        const A = freshA({ turnText: 'Чорні джинси' });
        A.ctx.product = { sku: 'set1113', isSet: true, price: 5290, customerName: 'Комплект 4 в 1' };
        A.ctx.setMode = 'set';
        A.ctx.recommendedSize = 'M';
        A.ctx.sizeInput = { height: 171, weight: 92 };
        A.ctx.agent.presentedSku = 'set1113';
        A.ctx.agent.setOriginal = [
            { article: 'D0050', name: 'Кофта', price: 1190, colors: ['Чорний'], sizes: [], qty: 1, color: '' },
            { article: 'j0032', name: 'Джинси', price: 1590, colors: ['Синій', 'Чорний', 'Графітовий'], sizes: [], qty: 1, color: '' },
        ];
        A.ctx.setSelection = A.ctx.agent.setOriginal.map((x) => ({ ...x }));
        A.ctx.agent.setPricing = { total: 5290, edited: false }; // норм. заповнюється при першій презентації комплекту — тут ставимо вручну, як і було б насправді
        const u = freshU({ intent: 'give_params', productHint: { article: 'j0032' } });
        await runPolicy(A, u);
        check('Згадка компонента комплекту не перемикає ctx.product на окремий товар', A.ctx.product && A.ctx.product.sku === 'set1113', 'product.sku: ' + (A.ctx.product && A.ctx.product.sku));
        check('Згадка компонента комплекту не стирає sizeInput (не питає зріст/вагу вдруге)', A.ctx.sizeInput && A.ctx.sizeInput.height === 171, JSON.stringify(A.ctx.sizeInput));
        check('Згадка компонента комплекту не стирає setSelection', Array.isArray(A.ctx.setSelection) && A.ctx.setSelection.length === 2, 'setSelection: ' + JSON.stringify(A.ctx.setSelection));
    }

    // ── 13. Живий кейс 15.09 (власник: "як я чорний написав... а воно не поняло, це баг") —
    // ГОЛА відповідь кольором (без назви товару) на щойно задане питання про ЄДИНУ багатоколірну
    // позицію має застосуватись саме до неї.
    {
        const A = freshA({ turnText: 'Чорні' });
        A.ctx.product = { sku: 'set1113', isSet: true, price: 5290 };
        A.ctx.setMode = 'set';
        A.ctx.recommendedSize = 'M';
        A.ctx.agent.setOriginal = [
            { article: 'D0050', name: 'Кофта', price: 1190, colors: ['Чорний'], sizes: [], qty: 1, color: 'Чорний' },
            { article: 'j0032', name: 'Джинси', price: 1590, colors: ['Світло-синій', 'Синій', 'Графітовий', 'Чорний', 'Блакитний', 'Темно-синій'], sizes: [], qty: 1, color: '' },
        ];
        A.ctx.setSelection = A.ctx.agent.setOriginal.map((x) => ({ ...x }));
        A.ctx.agent.setPricing = { total: 5290, edited: false };
        A.ctx.agent.setColorAskingArticle = 'j0032'; // бот уже питав про джинси попереднім ходом
        const u = freshU({ intent: 'give_params' });
        await runPolicy(A, u);
        const jeans = A.ctx.setSelection.find((x) => x.article === 'j0032');
        check('Гола відповідь кольором ("Чорні") без назви товару застосовується до єдиної позиції, що чекає', jeans && jeans.color === 'Чорний', 'колір: ' + (jeans && jeans.color));
    }

    // ── 14. Живий кейс 15.09 (власник: "додай нумерування... щоб людина могла цифру написати") —
    // відповідь номером (цифрою чи словом) на нумерований список кольорів.
    {
        const A = freshA({ turnText: '2' });
        A.ctx.product = { sku: 'set1113', isSet: true, price: 5290 };
        A.ctx.setMode = 'set';
        A.ctx.recommendedSize = 'M';
        A.ctx.agent.setOriginal = [
            { article: 'j0032', name: 'Джинси', price: 1590, colors: ['Світло-синій', 'Синій', 'Графітовий'], sizes: [], qty: 1, color: '' },
        ];
        A.ctx.setSelection = A.ctx.agent.setOriginal.map((x) => ({ ...x }));
        A.ctx.agent.setPricing = { total: 5290, edited: false };
        A.ctx.agent.setColorAskingArticle = 'j0032';
        const u = freshU({ intent: 'give_params' });
        await runPolicy(A, u);
        const jeans = A.ctx.setSelection.find((x) => x.article === 'j0032');
        check('Відповідь номером ("2") обирає другий колір у нумерованому списку', jeans && jeans.color === 'Синій', 'колір: ' + (jeans && jeans.color));
    }

    // ── 14б. Живий кейс 15.09 (власник: "1, 2" на ДВІ позиції одразу — не пропрацював варіант,
    // що товарів 2; або парсити, або питати окремими повідомленнями") — коли одночасно чекають
    // відповіді ДВІ багатоколірні позиції, питаємо про них ПО ОДНІЙ, не одним списком з номерами
    // "хто є хто".
    {
        const A = freshA({ turnText: '' });
        A.ctx.product = { sku: 'set1115', isSet: true, price: 5490 };
        A.ctx.setMode = 'set';
        A.ctx.recommendedSize = 'M';
        A.ctx.agent.setOriginal = [
            { article: 'j0032', name: 'Джинси', price: 1590, colors: ['Світло-синій', 'Синій', 'Графітовий'], sizes: [], qty: 1, color: '' },
            { article: 'L0056', name: 'Футболка', price: 449, colors: ['Білий', 'Чорний'], sizes: [], qty: 1, color: '' },
        ];
        A.ctx.setSelection = A.ctx.agent.setOriginal.map((x) => ({ ...x }));
        A.ctx.agent.setPricing = { total: 5490, edited: false };
        await runPolicy(A, freshU({ intent: 'give_params' }));
        const askedFirst = A.out.some((o) => o.step === 'set_color_ask');
        const askListFirst = A.ctx.agent.setColorAskList || '';
        check('14б.1 Дві неоднозначні позиції — питає лише про ПЕРШУ (Джинси), не про обидві разом', askedFirst && askListFirst.includes('Джинси') && !askListFirst.includes('Футболка'), askListFirst);
        // Клієнт відповідає на ПЕРШЕ питання (тепер це справді ЄДИНА ціль — "2" не двозначний).
        A.out.length = 0; A.turnText = '2';
        await runPolicy(A, freshU({ intent: 'give_params' }));
        const jeans = A.ctx.setSelection.find((x) => x.article === 'j0032');
        check('14б.2 Відповідь "2" на перше питання застосовується саме до Джинсів', jeans && jeans.color === 'Синій', 'колір: ' + (jeans && jeans.color));
        const askedSecond = A.out.some((o) => o.step === 'set_color_ask');
        const askListSecond = A.ctx.agent.setColorAskList || '';
        check('14б.3 Після Джинсів бот питає про ДРУГУ позицію (Футболка) окремим повідомленням', askedSecond && askListSecond.includes('Футболка'), askListSecond);
        // Клієнт відповідає на ДРУГЕ питання.
        A.out.length = 0; A.turnText = '2';
        await runPolicy(A, freshU({ intent: 'give_params' }));
        const shirt = A.ctx.setSelection.find((x) => x.article === 'L0056');
        check('14б.4 Відповідь "2" на друге питання застосовується до Футболки (Чорний), обидві позиції готові', shirt && shirt.color === 'Чорний' && A.ctx.agent.setColorsResolved === true, 'футболка: ' + (shirt && shirt.color) + ', setColorsResolved: ' + A.ctx.agent.setColorsResolved);
    }

    // ── 14в. Живий кейс 15.09 (власник: "бот не поняв, які я хочу футболки, це баг") — відповідь
    // на власне уточнення "з допродажем чи без" ГОЛИМ кольором+кількістю ("Чорні, 2"), без слова
    // "так", має прийматись як згода з допродажем, а не губитись по колу того самого підсумку.
    {
        const A = freshA({ turnText: 'Чорні, 2' });
        A.ctx.product = { sku: 'j0032', price: 1590, name: 'Джинси', customerName: 'Джинси', upsell: 'Футболка оверсайз база', upsellItems: [{ id: 'up1', name: 'Футболка оверсайз база', price: 449 }] };
        A.ctx.recommendedSize = 'M';
        A.ctx.colorChoice = { color: 'Чорний' };
        A.ctx.agent.availKey = 'Чорний|M|'; // уникаємо живого T.checkAvail — наявність уже "перевірена" цього ходу
        A.ctx.agent.upsellOffered = true;
        A.ctx.agent.lastAsk = 'з допродажем чи без';
        const u = freshU({ intent: 'other' }); // LLM НЕ впізнав addUpsell/upsellQty з голої відповіді — це і є баг
        await runPolicy(A, u);
        check('14в.1 Гола відповідь на "з допродажем чи без" — приймається як згода (addUpsell:true)', ctxOI(A) && ctxOI(A).addUpsell === true, JSON.stringify(ctxOI(A)));
        check('14в.2 Кількість "2" з тексту підхоплюється детерміновано (upsellQty)', ctxOI(A) && ctxOI(A).upsellQty === 2, JSON.stringify(ctxOI(A)));
        check('14в.3 Колір/примітка з відповіді лишається в upsellNote для менеджера', ctxOI(A) && ctxOI(A).upsellNote === 'Чорні, 2', JSON.stringify(ctxOI(A)));
    }
    function ctxOI(A) { return A.ctx.orderIntent; }

    // ── 15. Редагування складу комплекту (заміна/додавання/прибирання/зміна кольору) — власник:
    // "поженяй тести по зміні товару... прослідкуй, що щоразу записується у товар, який
    // оформиться в замовлення". ctx.orderExtras — те самe, що читають n_crm_order/supplierDispatch
    // (див. коментар над setSelectionToExtraItems) — саме його й перевіряємо на кожному кроці.
    {
        const A = freshA({ turnText: '' });
        A.ctx.product = { sku: 'set9999', isSet: true, price: 3000, customerName: 'Тестовий комплект' };
        A.ctx.setMode = 'set';
        A.ctx.recommendedSize = 'M';
        A.ctx.agent.setColorsResolved = true; // не заважаємо color-ask блоку в цьому тесті
        A.ctx.agent.setOriginal = [
            { article: 'K001', name: 'Кофта', price: 1000, colors: ['Чорний', 'Сірий'], sizes: [], qty: 1, color: 'Чорний' },
            { article: 'J001', name: 'Джинси', price: 1200, colors: ['Синій', 'Чорний'], sizes: [], qty: 1, color: 'Синій' },
            { article: 'F001', name: 'Футболка', price: 500, colors: ['Білий'], sizes: [], qty: 1, color: 'Білий' },
            { article: 'L001', name: 'Лофери', price: 800, colors: ['Коричневий'], sizes: [], qty: 1, color: 'Коричневий' },
        ];
        // Стартовий склад — без Лоферів (звичайна ситуація "3 з 4 позицій").
        A.ctx.setSelection = A.ctx.agent.setOriginal.filter((x) => x.article !== 'L001').map((x) => ({ ...x }));

        function extrasByArticle() { return Object.fromEntries((A.ctx.orderExtras || []).map((e) => [e.sku, e])); }

        // 15.1 — прибрати позицію.
        await runPolicy(A, freshU({ intent: 'set_edit', removeItem: 'Футболка' }));
        check('15.1 Прибрати позицію — зникає з setSelection', !A.ctx.setSelection.some((x) => x.article === 'F001'), JSON.stringify(A.ctx.setSelection.map((x) => x.article)));
        check('15.1 Прибрати позицію — зникає з orderExtras (те, що піде в замовлення)', !extrasByArticle()['F001'], JSON.stringify(Object.keys(extrasByArticle())));

        // 15.2 — додати ту саму позицію назад (з каталогу самого комплекту, не окремий резолв).
        await runPolicy(A, freshU({ intent: 'set_edit', addItem: 'Футболка' }));
        check('15.2 Додати позицію назад — з’являється в setSelection', A.ctx.setSelection.some((x) => x.article === 'F001'), JSON.stringify(A.ctx.setSelection.map((x) => x.article)));
        check('15.2 Додати позицію назад — з’являється в orderExtras з правильною ціною', extrasByArticle()['F001'] && extrasByArticle()['F001'].price === 500, JSON.stringify(extrasByArticle()['F001']));

        // 15.3 — додати позицію, якої не було на СТАРТІ взагалі (Лофери, 4й компонент комплекту).
        // Склад стає ІДЕНТИЧНИЙ original (4 з 4, по 1 шт) — це вмикає знижку пакета
        // (setMatchesOriginal у applySetPricing), яка НАВМИСНО очищає orderExtras/extraItems
        // (замовлення тоді йде як "весь комплект" за pp.price, а не позиційно) — тому тут
        // перевіряємо саме ЦЕ, а не наявність L001 в orderExtras.
        await runPolicy(A, freshU({ intent: 'set_edit', addItem: 'Лофери' }));
        check('15.3 Додати нову позицію комплекту — 4 позиції в setSelection', A.ctx.setSelection.length === 4 && A.ctx.setSelection.some((x) => x.article === 'L001'), 'setSelection: ' + JSON.stringify(A.ctx.setSelection.map((x) => x.article)));
        check('15.3б Склад знову = оригінальний комплект — знижка пакета повертається (orderExtras порожній, edited=false)', A.ctx.agent.setPricing && A.ctx.agent.setPricing.edited === false && Array.isArray(A.ctx.orderExtras) && A.ctx.orderExtras.length === 0, JSON.stringify({ setPricing: A.ctx.agent.setPricing, orderExtras: A.ctx.orderExtras }));

        // 15.4 — прибрати щось знову, щоб перевірити зміну кольору на РЕАЛЬНО відредагованому складі.
        await runPolicy(A, freshU({ intent: 'set_edit', removeItem: 'Лофери' }));
        // 15.5 — зміна кольору позиції.
        await runPolicy(A, freshU({ intent: 'set_edit', changeRequest: 'джинси чорні', colorMatched: 'Чорний' }));
        const jeansSel = A.ctx.setSelection.find((x) => x.article === 'J001');
        check('15.5 Зміна кольору позиції — оновлюється в setSelection', jeansSel && jeansSel.color === 'Чорний', 'колір: ' + (jeansSel && jeansSel.color));
        check('15.5 Зміна кольору позиції — оновлюється в orderExtras (те, що йде в замовлення)', extrasByArticle()['J001'] && extrasByArticle()['J001'].color === 'Чорний', JSON.stringify(extrasByArticle()['J001']));

        // Підсумкова перевірка: КОЖНА позиція в orderExtras станом на кінець сценарію збігається
        // з setSelection 1:1 (sku/назва/ціна/колір/кількість) — саме цей перелік підуть у CRM/
        // постачальнику, тож розбіжність тут і є "неправильне замовлення".
        const finalMatch = A.ctx.setSelection.every((it) => {
            const e = extrasByArticle()[it.article];
            return e && e.name === it.name && e.price === it.price && e.color === it.color && e.qty === it.qty;
        }) && A.ctx.setSelection.length === (A.ctx.orderExtras || []).length;
        check('15.6 orderExtras на кінець сценарію 1:1 збігається з setSelection (що бачить клієнт = що піде в замовлення)', finalMatch, JSON.stringify({ setSelection: A.ctx.setSelection, orderExtras: A.ctx.orderExtras }));
    }

    // ── 15б. Живий кейс 15.09 (Edits, знову той самий set1112, вперше знайдено ще 08.09 і тоді
    // "виправлено" занадто вузьким guard-ом): "Комплект 4 в 1 (кофта...)" і одразу "Комплект 4 в
    // 1. Артикул: set1112" — назва двічі в першому ж повідомленні. Живий виклик n_lookup —
    // перевіряємо РЕАЛЬНИЙ desc, що піде в n_welcome.
    {
        const { resolveProduct } = require('../tools');
        const A = freshA({ turnText: 'set1112' });
        A.ctx.lastUserMessage = 'артикул set1112';
        const r = await resolveProduct(A, { productHint: { article: 'set1112' } });
        const desc = String((A.ctx.product && A.ctx.product.desc) || '');
        const lines = desc.split('\n').map((s) => s.trim()).filter(Boolean);
        const bothStartSame = lines.length > 1 && /^комплект/i.test(lines[0]) && /^комплект/i.test(lines[1]) && lines[0] !== lines[1];
        check('n_lookup (set1112): назва комплекту не дублюється двічі на початку desc', r.status === 'found' && A.ctx.product && A.ctx.product.sku === 'set1112' && !bothStartSame, JSON.stringify({ status: r.status, sku: A.ctx.product && A.ctx.product.sku, desc }));
    }

    // ── 16. Живий кейс 15.09 (3 незалежні скарги в Edits: "не надіслало фото розмірної сітки",
    // "На цей товар розмірної сітки нема. Бот обіцяє скинути") — LLM НЕ повинна обіцяти картинку,
    // якої немає в CRM (та сама категорія, що "уточнимо окремо в чаті" для розмірів комплекту).
    {
        const { sizeChartRuleFor } = require('../compose');
        const withChart = sizeChartRuleFor({ product: { sizeChartUrl: 'https://x/chart.jpg' } });
        const withoutChart = sizeChartRuleFor({ product: { sku: 'A0182' } });
        check('sizeChartRuleFor: є файл сітки — дозволяє обіцяти картинку', /йде клієнту лише окремою картинкою/.test(withChart), withChart);
        check('sizeChartRuleFor: НЕМА файлу сітки — забороняє порожню обіцянку', /НІКОЛИ не обіцяй надіслати картинку/.test(withoutChart) && !/йде клієнту лише окремою картинкою/.test(withoutChart), withoutChart);
    }

    // ── 17. Живий запит власника (2026-09-17, "фолбек для питань не по скрипту"): compose() тепер
    // повертає {text, resolved} через JSON — extractJsonLoose має надійно парсити реальну поведінку
    // LLM (чистий JSON, у markdown-огорожі, з "зайвим" текстом навколо) і НЕ падати на сміттєвому вводі.
    {
        const { extractJsonLoose } = require('../compose');
        const clean = extractJsonLoose('{"text":"Так, є кишені.","resolved":true}');
        check('extractJsonLoose: чистий JSON', clean && clean.text === 'Так, є кишені.' && clean.resolved === true, JSON.stringify(clean));
        const fenced = extractJsonLoose('```json\n{"text":"Уточню і повернусь.","resolved":false}\n```');
        check('extractJsonLoose: JSON у markdown-огорожі', fenced && fenced.resolved === false, JSON.stringify(fenced));
        const withProse = extractJsonLoose('Ось відповідь:\n{"text":"Добре","resolved":true}\nдякую');
        check('extractJsonLoose: JSON із зайвим текстом навколо', withProse && withProse.text === 'Добре', JSON.stringify(withProse));
        const garbage = extractJsonLoose('Вибачте, я не можу відповісти зараз.');
        check('extractJsonLoose: сміттєвий ввід повертає null, не падає', garbage === null, String(garbage));
    }

    // ── 18. Живий кейс 17.09 (e77af3b9, власник: "2 рази наполягає — тоді бота зупиняємо, бо люди
    // дратуються"): клієнт 7 разів різними словами наполягав "уточніть покрій штанів", бот щоразу
    // відповідав "уточню і повернусь" + повторював заклик дати адресу — до відкритого роздратування
    // клієнта. enforceInsistLimit рахує ПОСЛІДОВНІ ходи без чесної відповіді (A._unresolvedThisTurn)
    // незалежно від точного тексту питання (дедуп у escalateUnresolved тут не рятує).
    {
        const A1 = freshA({ ctx: { testMode: true, agent: {} } });
        A1._unresolvedThisTurn = true;
        await enforceInsistLimit(A1);
        check('1-ша ескалація поспіль НЕ зупиняє бота', !A1.ctx.funnelPaused && A1.ctx.agent.unresolvedStreak === 1, JSON.stringify({ paused: A1.ctx.funnelPaused, streak: A1.ctx.agent.unresolvedStreak }));

        const A2 = freshA({ ctx: { testMode: true, agent: { unresolvedStreak: 1 } } });
        A2._unresolvedThisTurn = true;
        await enforceInsistLimit(A2);
        check('2-га ескалація поспіль зупиняє бота (кличе менеджера)', A2.ctx.funnelPaused === true && A2.ctx.pausedBy === 'unresolved_insist', JSON.stringify({ paused: A2.ctx.funnelPaused, pausedBy: A2.ctx.pausedBy }));
        check('Текст заміняється на передачу менеджеру, а не черговий редирект', A2.out.length === 1 && A2.out[0].step === 'insist_handoff', JSON.stringify(A2.out));

        const A3 = freshA({ ctx: { testMode: true, agent: { unresolvedStreak: 1 } } });
        // A3._unresolvedThisTurn НЕ виставлено — клієнт цього ходу відповів на прохання скрипту, не наполягав.
        await enforceInsistLimit(A3);
        check('Хід без нової ескалації скидає лічильник ("продовжує діалог — то продовжуй")', A3.ctx.agent.unresolvedStreak === 0 && !A3.ctx.funnelPaused, JSON.stringify({ streak: A3.ctx.agent.unresolvedStreak, paused: A3.ctx.funnelPaused }));
    }

    // ── 19. Живий кейс 18.09 (Roman/tovstanovskiy_, 20af04a6, "Вы на приколе?"): клієнт одним
    // повідомленням назвав ОДРАЗУ ДВІ окремі позиції комплекту ("Кофта и лоферы") замість "весь
    // комплект" чи однієї речі — setChoice/setArticle розуміють лише ОДНУ позицію за раз, тож бот
    // тричі перепитував те саме "весь комплект чи окремі речі?", поки клієнт не пішов ("Самі з
    // ним спілкуйтеся" — та сама категорія бага в іншій сесії, f9effe55). Секція "3. Комплект"
    // тепер сама (незалежно від того, що зрозумів understand()) шукає в тексті 2+ різні позиції
    // комплекту і заводить часткову вибірку через той самий механізм, що й повний комплект.
    {
        const A = freshA({ turnText: 'Кофта и лоферы' });
        A.ctx.product = {
            sku: 'set9998', isSet: true, price: 4000, customerName: 'Тестовий комплект 2',
            setItems: [
                { article: 'K002', name: 'Кофта ангора', price: 1279, colors: ['Чорний'], sizes: [] },
                { article: 'J002', name: 'Джинси', price: 1590, colors: ['Синій'], sizes: [] },
                { article: 'F002', name: 'Футболка', price: 449, colors: ['Білий'], sizes: [] },
                { article: 'L002', name: 'Лофери', price: 1990, colors: ['Коричневий'], sizes: [] },
            ],
        };
        await runPolicy(A, freshU({ intent: 'other' })); // understand() НЕ впізнав setChoice/setArticle з голої назви двох речей — це і є баг
        const sel = (A.ctx.setSelection || []).map((x) => x.article).sort();
        check('19.1 Дві названі позиції розпізнаються без допомоги understand() (setChoice/setArticle)', A.ctx.setMode === 'set' && sel.length === 2, 'setMode: ' + A.ctx.setMode + ', setSelection: ' + JSON.stringify(sel));
        check('19.2 Саме ПОТРІБНІ позиції (Кофта + Лофери), решта не потрапила', JSON.stringify(sel) === JSON.stringify(['K002', 'L002']), JSON.stringify(sel));
        check('19.3 ctx.product.setItems звужено до вибраних — секція розміру не питатиме про Джинси/Футболку', Array.isArray(A.ctx.product.setItems) && A.ctx.product.setItems.length === 2, JSON.stringify((A.ctx.product.setItems || []).map((x) => x.article)));
        check('19.4 Повний оригінальний склад лишається збереженим (можна додати позицію назад)', Array.isArray(A.ctx.agent.setOriginal) && A.ctx.agent.setOriginal.length === 4, JSON.stringify((A.ctx.agent.setOriginal || []).map((x) => x.article)));
    }
    {
        // Одна названа позиція (не дві) — старий однопозиційний шлях МАЄ лишитись незайманим:
        // "item"/setArticle далі йде через T.setApply, а не через нову гілку.
        const A = freshA({ turnText: 'Кофта' });
        A.ctx.product = {
            sku: 'set9998', isSet: true, price: 4000, customerName: 'Тестовий комплект 2',
            setItems: [
                { article: 'K002', name: 'Кофта ангора', price: 1279, colors: ['Чорний'], sizes: [] },
                { article: 'J002', name: 'Джинси', price: 1590, colors: ['Синій'], sizes: [] },
            ],
        };
        await runPolicy(A, freshU({ intent: 'other' }));
        check('19.5 Одна названа позиція НЕ потрапляє в нову гілку мультивибору (нема хибних 2-позиційних вибірок)', !(A.ctx.setMode === 'set' && Array.isArray(A.ctx.setSelection) && A.ctx.setSelection.length > 1), 'setMode: ' + A.ctx.setMode + ', setSelection: ' + JSON.stringify(A.ctx.setSelection));
    }

    // ── 20. Аналіз 59 випадків «бот знову питає зріст і вагу» (01.10): параметри людини не губляться, а відомі — не просяться.
    {
        const { stripKnownHwAsk } = require('../index');
        const card = 'Чоловіча вʼязана кофта. Артикул: A0187\n💵 Ціна: 1279 ₴\n\n👉 Підкажіть, будь ласка, зріст і вага — підберу ідеальний розмір 😊';
        check('20.1 Картка без рядка-прохання, коли зріст і вага відомі', !/зріст/i.test(stripKnownHwAsk(card)) && stripKnownHwAsk(card).includes('1279'), JSON.stringify(stripKnownHwAsk(card)));
        const keep = 'Для вашого зросту та ваги система підібрала розмір XXL 👌 Скажіть, який колір вам до вподоби?';
        check('20.2 Відповідь із підібраним розміром не чіпається', stripKnownHwAsk(keep) === keep, JSON.stringify(stripKnownHwAsk(keep)));
        check('20.3 «Мені ще потрібні зріст і вага… Напишіть їх» прибирається повністю', stripKnownHwAsk('Мені ще потрібні зріст і вага для підбору розміру 📏 Напишіть їх, будь ласка 🙂') === '', '');
        // Зріст/вага, написані раніше (напр. менеджеру, поки бот мовчав), — беруться з історії розмови.
        const A = freshA({ turnText: 'Яка ціна кофти?' });
        A.history = [{ who: 'client', text: '190/115', at: new Date() }, { who: 'manager', text: 'ХХЛ буде малий', at: new Date() }];
        A.ctx.product = { sku: 'A0187', price: 1279, isClothing: true, customerName: 'Кофта' };
        A.ctx.agent.presentedSku = 'A0187';
        await runPolicy(A, freshU({ intent: 'question', questions: ['Яка ціна кофти?'] }));
        check('20.4 Зріст і вага з історії розмови потрапляють у sizeInput', A.ctx.sizeInput && A.ctx.sizeInput.height === 190 && A.ctx.sizeInput.weight === 115, JSON.stringify(A.ctx.sizeInput));
    }

    // ── 21. Підтвердження після оформлення містить строк відправки (власник 03.10: «чому люди все ще питають, коли відправка?»,
    // GOV76KRU0AV — було «після підтвердження оплати одразу відправляємо» без жодного слова про пошиття до 5 робочих днів).
    {
        const { shipTerms } = require('../policy');
        const T = require('../tools');
        const { messageTextMultiline } = require('../lib');
        for (const pay of ['not_found', 'confirmed']) {
            const A = freshA();
            Object.assign(A.ctx, { crmOrderId: 'TEST-1', orderRef: 'GOVTEST', payStatus: pay, payAmount: 200 });
            A.ctx.shipTermsText = shipTerms(A.ctx);
            await T.confirmPrep(A);
            const txt = messageTextMultiline(assets, 'n_confirm', A.ctx, A.session.id);
            check('21.' + (pay === 'confirmed' ? '2' : '1') + ' Підтвердження замовлення (оплата: ' + pay + ') містить строк відправки й не обіцяє «одразу відправляємо»', /робочих дн/i.test(txt) && !/одразу відправля/i.test(txt), JSON.stringify(txt.slice(0, 160)));
        }
    }

    // ── 22. Реклама від Zernio не прийшла (≈22% розмов; Edits fafba197/af603158/951031bf, 03.10): «Яка ціна кофти?» → товар
    // береться серед АКТИВНИХ реклам категорії (CRM /ads/active-summary), а не перші кофти каталогу за ціною. Тест не привʼязаний
    // до конкретних артикулів — реклами змінюються: перевіряємо, що вибір/список складається лише з рекламованих товарів.
    {
        const { computeCatalogHint, activeAdProductIds } = require('../catalogHint');
        const { loadCategories } = require('../lib');
        const adv = await activeAdProductIds(assets.keys);
        const { loadCatalog } = require('../lib');
        const cat = await loadCatalog(BOT, assets.keys);
        const advSkus = new Set(cat.products.filter((p) => adv[p.id] != null).map((p) => String(p.sku).toUpperCase()));
        check('22.0 CRM віддає активні реклами з товарами', advSkus.size > 0, 'рекламованих товарів: ' + advSkus.size);
        for (const msg of ['Яка ціна кофти?', 'Яка ціна костюму?', 'а скільки бомбер?']) {
            const ctx = { lastUserMessage: msg, _hintNoRef: true, catalogHintCategoriesRaw: await loadCategories(BOT, assets.keys) };
            const r = await computeCatalogHint(ctx, assets.keys, msg);
            const skus = r.catalogHintPick ? [r.catalogHintPick] : String(r.catalogHintSkus || '').split(',').filter(Boolean);
            // Картка — лише рекламованого; у списку рекламовані йдуть першими (жоден нерекламований не стоїть перед рекламованим).
            const isAdv = skus.map((s) => advSkus.has(String(s).toUpperCase()));
            const advFirst = skus.length > 0 && isAdv[0] && isAdv.every((v, i) => v || isAdv.slice(i).every((x) => !x));
            check('22.1 «' + msg + '» без реклами → картка рекламованого або список із рекламованими першими', !r.catalogHint && !r.catalogHintPick ? true : (r.catalogHintPick ? isAdv[0] : advFirst), (r.catalogHintPick ? 'картка ' : 'список ') + skus.join(','));
            if (r.catalogHint) check('22.2 «' + msg + '»: у рядках списку клієнтська назва без задвоєного «Артикул»', !/артикул[^\n]*артикул/i.test(r.catalogHint), r.catalogHint.split('\n')[0]);
        }
        const rS = await computeCatalogHint({ lastUserMessage: 'Добрий день, є костюми з полар-флісу?', _hintNoRef: true, catalogHintCategoriesRaw: await loadCategories(BOT, assets.keys) }, assets.keys, 'Добрий день, є костюми з полар-флісу?');
        check('22.4 Пошук з ознакою («костюми з полар-флісу») → список, не одна картка рекламованого (FunnelTest 138)', !rS.catalogHintPick && String(rS.catalogHintSkus || '').split(',').filter(Boolean).length > 1, 'pick ' + rS.catalogHintPick + ' | список ' + rS.catalogHintSkus);
        const r0 = await computeCatalogHint({ lastUserMessage: 'Яка ціна кофти?', _hintNoRef: false, catalogHintCategoriesRaw: await loadCategories(BOT, assets.keys) }, assets.keys, 'Яка ціна кофти?');
        check('22.3 Є реклама/фото/товар (_hintNoRef=false) → звичайний список, без вгадування за рекламою', !r0.catalogHintPick && !r0.catalogHintAdGuess, 'skus ' + r0.catalogHintSkus);
    }

    // ── 23. «Весь комплект чи окремі речі?» — лише раз (03.10: 30+ розмов, де бот питав це 2–3 рази поспіль; картка комплекту
    // сама закінчується цим питанням, а пачка повідомлень клієнта одразу після неї запускала ще хід із тим самим питанням).
    {
        const mkSet = () => ({ sku: 'set1112', isSet: true, price: 5290, customerName: 'Комплект 4 в 1', setItems: [{ article: 'A0187', name: 'Кофта', price: 1279 }, { article: 'j0032', name: 'Джинси', price: 1590 }] });
        const A = freshA({ turnText: '[фото]' });
        A.ctx.product = mkSet();
        A.ctx.agent.setAskedAt = { sku: 'set1112', at: Date.now() - 20 * 1000 };
        A.ctx.presentedAt = Date.now() - 20 * 1000; A.ctx.agent.presentedSku = 'set1112';
        await runPolicy(A, freshU({ intent: 'other' }));
        check('23.1 Картку комплекту показано 20 с тому, нового нема → питання не повторюється', !A.out.some((o) => /весь комплект/i.test(String(o.text || ''))), 'steps: ' + A.out.map((o) => o.step).join(','));
        const B = freshA({ turnText: 'Яка ціна товарів?' });
        B.ctx.product = mkSet();
        B.ctx.agent.setAskedAt = { sku: 'set1112', at: Date.now() - 20 * 1000 };
        B.ctx.presentedAt = Date.now() - 20 * 1000; B.ctx.agent.presentedSku = 'set1112';
        await runPolicy(B, freshU({ intent: 'question', questions: ['Яка ціна товарів?'] }));
        check('23.2 «Яка ціна товарів?» пачкою після картки (ціни вже в ній) → ні повторного питання, ні переказу цін', !B.out.some((o) => /весь комплект|1279|1590/i.test(String(o.text || ''))), 'steps: ' + B.out.map((o) => o.step + ':' + String(o.text || '').slice(0, 50)).join(' | '));
        const C = freshA({ turnText: 'Привіт' });
        C.ctx.product = mkSet();
        C.ctx.agent.setAskedAt = { sku: 'set1112', at: Date.now() - 40 * 60 * 1000 };
        await runPolicy(C, freshU({ intent: 'greeting' }));
        check('23.3 Питали 40 хв тому — нагадування дозволене', C.out.some((o) => o.step === 'set_ask'), 'steps: ' + C.out.map((o) => o.step).join(','));
    }

    // ── 24. Етап 2 комплектів (03.10): одна річ із комплекту — звичайний товар із CRM; звуження складу — одна функція.
    {
        const { matchProduct } = require('../productMatch');
        const { loadCatalog } = require('../lib');
        const cat = await loadCatalog(BOT, assets.keys);
        const load = async (sku) => { const tmp = { lookupProductsRaw: cat.products, lookupAdsRaw: cat.ads, lookupCategoriesRaw: cat.categories || [], agent: {} }; const r = await matchProduct(tmp, assets.keys, 'артикул ' + sku, { botId: BOT }); return (r && r.product) || tmp.product; };
        const set = await load('set1112');
        const kofta = await load('A0187');
        check('24.0 set1112 і A0187 завантажуються з CRM', set && set.isSet && kofta && kofta.sku === 'A0187', (set && set.sku) + ' / ' + (kofta && kofta.sku));
        if (set && set.isSet && kofta) {
            // 24.1 «Тільки кофта» → кофта з ВЛАСНИМИ полями (назва, ціни за кількість), а не копія комплекту.
            const A = freshA({ turnText: 'Тільки кофта' });
            A.ctx.product = JSON.parse(JSON.stringify(set));
            A.ctx.agent.setAskedAt = { sku: set.sku, at: Date.now() - 60 * 1000 };
            await runPolicy(A, freshU({ intent: 'choose_set', setChoice: 'item', setArticle: 'A0187' }));
            const p = A.ctx.product || {};
            check('24.1 «Тільки кофта» → товар A0187 зі своєю назвою, не назвою комплекту', p.sku === 'A0187' && !p.isSet && !/комплект|set11/i.test(String(p.customerName || '')), (p.sku || '') + ' «' + String(p.customerName || '').slice(0, 50) + '» via ' + p._via);
            check('24.2 …і зі своїми цінами за кількість та сіткою, як у картці A0187', JSON.stringify(p.qtyPrices || null) === JSON.stringify(kofta.qtyPrices || null) && String(p.sizeChartUrl || '') === String(kofta.sizeChartUrl || ''), 'qtyPrices ' + JSON.stringify(p.qtyPrices) + ' vs ' + JSON.stringify(kofta.qtyPrices));
            // 24.3 «кофта і джинси», потім «поверніть футболку» → футболка і у виборі, і в товарі (розмір їй рахується).
            const tee = (set.setItems || []).find((it) => /футбол/i.test(String(it.name)));
            const B = freshA({ turnText: 'Кофта і джинси' });
            B.ctx.product = JSON.parse(JSON.stringify(set));
            B.ctx.agent.setAskedAt = { sku: set.sku, at: Date.now() - 60 * 1000 };
            await runPolicy(B, freshU({ intent: 'choose_set', itemColors: [] }));
            const narrowed = (B.ctx.product.setItems || []).length;
            B.turnText = 'І футболку поверніть'; B.out = [];
            await runPolicy(B, freshU({ intent: 'change_set', addItem: 'футболку' }));
            const inProduct = tee && (B.ctx.product.setItems || []).some((it) => it.article === tee.article);
            const inSel = tee && (B.ctx.setSelection || []).some((it) => it.article === tee.article);
            check('24.3 «Кофта і джинси» → 2 речі; «поверніть футболку» → футболка і у виборі, і в товарі', narrowed === 2 && inProduct && inSel, 'після вибору: ' + narrowed + ' | у товарі: ' + (B.ctx.product.setItems || []).map((x) => x.article).join(',') + ' | у виборі: ' + (B.ctx.setSelection || []).map((x) => x.article).join(','));
        }
    }

    // ── 25. Етап 3 комплектів (03.10): що з комплекту купує клієнт, каже аналізатор (setItemsWanted); policy лише виконує.
    {
        const { matchProduct } = require('../productMatch');
        const { loadCatalog } = require('../lib');
        const cat = await loadCatalog(BOT, assets.keys);
        const tmp = { lookupProductsRaw: cat.products, lookupAdsRaw: cat.ads, lookupCategoriesRaw: cat.categories || [], agent: {} };
        const r = await matchProduct(tmp, assets.keys, 'артикул set1112', { botId: BOT });
        const set = (r && r.product) || tmp.product;
        if (set && set.isSet) {
            const arts = (set.setItems || []).map((it) => it.article);
            const mk = (turnText, extra = {}) => { const A = freshA({ turnText }); A.ctx.product = JSON.parse(JSON.stringify(set)); A.ctx.agent.setAskedAt = { sku: set.sku, at: Date.now() - 60 * 1000 }; Object.assign(A.ctx, extra); return A; };
            const A = mk('Кофта сірий колір');
            await runPolicy(A, freshU({ intent: 'give_color', color: 'сірий', setItemsWanted: { all: false, items: ['A0187'] } }));
            check('25.1 Аналізатор: лише кофта → товар A0187 (а не весь комплект за кольором)', A.ctx.product && A.ctx.product.sku === 'A0187', 'товар ' + (A.ctx.product && A.ctx.product.sku));
            const B = mk('Цікавить кофта та джинси');
            await runPolicy(B, freshU({ intent: 'choose_set', setItemsWanted: { all: false, items: ['кофта', 'джинси'] } }));
            const bArts = (B.ctx.product.setItems || []).map((it) => it.article);
            check('25.2 Аналізатор словами («кофта», «джинси») → комплект із двох речей', B.ctx.setMode === 'set' && bArts.length === 2, 'позиції ' + bArts.join(','));
            if (Array.isArray(set.setOutOfStock) && set.setOutOfStock.length) {
                const F = mk('Цікавить кофта та лофери');
                await runPolicy(F, freshU({ intent: 'choose_set', setItemsWanted: { all: false, items: ['кофта', 'лофери'] } }));
                check('25.6 Названа річ «немає в наявності» (лофери) → бот прямо каже про це, не відкидає мовчки', F.out.some((o) => o.step === 'set_item_missing' && /лофер/i.test(o.text)), 'steps: ' + F.out.map((o) => o.step).join(','));
            }
            const C = mk('Ні, мені лише кофту', { setMode: 'set' });
            await runPolicy(C, freshU({ intent: 'choose_set', setItemsWanted: { all: false, items: ['A0187'] } }));
            check('25.3 Уже весь комплект → «лише кофту» → товар A0187', C.ctx.product && C.ctx.product.sku === 'A0187', 'товар ' + (C.ctx.product && C.ctx.product.sku));
            const D = mk('Кофта і джинси');
            await runPolicy(D, freshU({ intent: 'choose_set', setItemsWanted: { all: false, items: [arts[0], arts[1]] } }));
            D.turnText = 'А давайте весь комплект'; D.out = [];
            await runPolicy(D, freshU({ intent: 'choose_set', setItemsWanted: { all: true, items: [] } }));
            check('25.4 Звужений до 2 речей → «весь комплект» → знову всі ' + arts.length, (D.ctx.product.setItems || []).length === arts.length, 'позиції ' + (D.ctx.product.setItems || []).map((it) => it.article).join(','));
            const E = mk('кофти в мене розмір s/m');
            E.ctx.agent.setGeneralQ = true; // раніше питав «Яка ціна товарів?» (тест 145)
            await runPolicy(E, freshU({ intent: 'give_params', clothingSize: 'M', setItemsWanted: null }));
            check('25.5 Аналізатор не впевнений (null) → поведінка як раніше (запас), товар лишається комплектом', E.ctx.product && E.ctx.product.isSet, 'товар ' + (E.ctx.product && E.ctx.product.sku));
        } else check('25.0 set1112 завантажується', false, '');
    }

    // ── 26. Допродаж без кольорів (Edit 91843fa8, 03.10): «Давайте тоже 2 футболки» → бот питає кольори до оплати; постачальнику
    // рядок без кольору/розміру не йде (раніше — дві чорні S замість білої й чорної XL).
    {
        const { matchProduct } = require('../productMatch');
        const { loadCatalog } = require('../lib');
        const { missingVariant } = require('../supplierDispatch');
        const cat = await loadCatalog(BOT, assets.keys);
        const tmp = { lookupProductsRaw: cat.products, lookupAdsRaw: cat.ads, lookupCategoriesRaw: cat.categories || [], agent: {} };
        const r = await matchProduct(tmp, assets.keys, 'артикул C0043', { botId: BOT });
        const kof = (r && r.product) || tmp.product;
        const up = kof && Array.isArray(kof.upsellItems) && kof.upsellItems[0];
        const upCat = up && cat.products.find((p) => String(p.sku).toUpperCase() === String(up.sku).toUpperCase());
        if (kof && up && upCat) {
            const miss = missingVariant({ sku: up.sku, color: '', size: '' }, upCat);
            check('26.1 Рядок допродажу без кольору → оформлення постачальнику його не пропускає', miss.includes('колір'), 'бракує: ' + miss.join(', '));
            const A = freshA({ turnText: 'Давайте тоже 2 футболки' });
            Object.assign(A.ctx, { product: JSON.parse(JSON.stringify(kof)), recommendedSize: 'XL', colorChoice: { qty: 2, colors: ['Чорний', 'Сірий'] }, orderUnits: [{ color: 'Чорний', size: 'XL' }, { color: 'Сірий', size: 'XL' }], orderUnitsTotal: 2199, sizeInput: { height: 192, weight: 96 } });
            A.ctx.agent.lastAsk = 'оформляємо?'; A.ctx.agent.upsellOffered = true; A.ctx.agent.presentedSku = kof.sku;
            await runPolicy(A, freshU({ intent: 'order_yes', ready: 'yes', addUpsell: true, upsellQty: 2 }));
            check('26.2 «Давайте тоже 2 футболки» без кольорів → бот питає кольори, а не переходить до оплати', A.out.some((o) => o.step === 'upsell_color_ask') && !A.out.some((o) => /спосіб оплати|1️⃣/i.test(String(o.text || ''))), 'steps: ' + A.out.map((o) => o.step).join(','));
            A.turnText = 'Одна біла, одна чорна'; A.out = [];
            await runPolicy(A, freshU({ intent: 'give_color', units: [{ color: 'Білий', size: '' }, { color: 'Чорний', size: '' }] }));
            const uu = (A.ctx.orderIntent && A.ctx.orderIntent.upsellUnits) || [];
            check('26.3 «Одна біла, одна чорна» → кольори допродажу записано, розмір = розмір кофти (XL)', uu.length === 2 && uu.every((x) => x.color && x.size === 'XL') && uu.some((x) => /біл/i.test(x.color)), JSON.stringify(uu));
        } else check('26.0 C0043 з допродажем завантажується', false, (kof && kof.sku) + ' upsell ' + (up && up.sku));
    }

    // ── 27. Збій постачальника ≠ «оформлено» (05.10: GOVTUXUZ2I9 / GOVM77QE028 — вузол brewdrop упав на «fetch failed», кнопка показала
    // «✅ оформлено»). Вузол постачальника підмінено: (а) кидає виняток, (б) повертає created без номера, (в) справжній успіх.
    {
        const { dispatchOrder } = require('../supplierDispatch');
        const withNode = (code) => { const nodes = new Map(assets.nodes); const base = nodes.get('n_supplier_order') || { id: 'n_supplier_order', data: {} }; nodes.set('n_supplier_order', { ...base, data: { ...base.data, code } }); const route = nodes.get('n_supplier_route') || { id: 'n_supplier_route', data: {} }; nodes.set('n_supplier_route', { ...route, data: { ...route.data, code: "return { supplierMechanism: 'brewdrop' };" } }); return { ...assets, nodes }; };
        const run = async (code) => { const A = freshA(); A.assets = withNode(code); Object.assign(A.ctx, { testMode: false, product: { sku: 'A0187', id: 'x', name: 'Кофта', supplier: 'brewdrop.in.ua', upsellItems: [] }, orderUnits: [{ color: 'Чорний', size: 'L' }], orderUnitsTotal: 1279, orderData: { fullName: 'Тест Тест', phone: '0671234567', city: 'Київ', branch: '1' } }); return dispatchOrder(A, { force: true, lines: [{ sku: 'A0187', id: 'x', name: 'Кофта', price: 1279, qty: 1, color: 'Чорний', size: 'L', supplierName: 'brewdrop.in.ua' }] }); };
        const g1 = (await run("throw new Error('fetch failed');")).groups[0] || {};
        check('27.1 Вузол постачальника впав винятком → needsManual і причина в тексті (не «оформлено»)', g1.needsManual === true && /fetch failed/.test(String(g1.result)), JSON.stringify({ s: g1.status, m: g1.needsManual, r: String(g1.result).slice(0, 80) }));
        const g2 = (await run("return { supplierOrderStatus: 'created', supplierOrderResult: 'ok' };")).groups[0] || {};
        check('27.2 «created» без номера й ТТН → не вважається оформленим', g2.needsManual === true, JSON.stringify({ s: g2.status, m: g2.needsManual }));
        const g3 = (await run("return { supplierOrderStatus: 'created', supplierOrderId: 555, supplierTtn: '20450000000000', supplierOrderResult: '✅ ID: 555' };")).groups[0] || {};
        check('27.3 Справжній успіх (номер + ТТН) → оформлено', g3.needsManual === false && g3.id === 555, JSON.stringify({ s: g3.status, m: g3.needsManual, id: g3.id }));
    }

    // ── 28–31. Кореневі інваріанти 05.10 (категорії Edits: каталог, памʼять діалогу, дублі, UX).
    {
        const { matchProduct } = require('../productMatch');
        const { loadCatalog } = require('../lib');
        const { missingVariant } = require('../supplierDispatch');
        const { stripAskSentences, ASK_KINDS, paragraphize } = require('../index');
        const cat = await loadCatalog(BOT, assets.keys);
        const load = async (sku) => { const tmp = { lookupProductsRaw: cat.products, lookupAdsRaw: cat.ads, lookupCategoriesRaw: cat.categories || [], agent: {} }; const r = await matchProduct(tmp, assets.keys, 'артикул ' + sku, { botId: BOT }); return (r && r.product) || tmp.product; };
        // 28. Колір × розмір (26658740): графітові джинси j0032 шиються лише XS/L.
        const jeans = await load('j0032');
        if (jeans && jeans.sku) {
            const A = freshA({ turnText: 'Графітовий' });
            Object.assign(A.ctx, { product: JSON.parse(JSON.stringify(jeans)), recommendedSize: 'XL', colorChoice: { color: 'Графітовий' }, sizeInput: { height: 185, weight: 90 } });
            A.ctx.agent.presentedSku = jeans.sku;
            await runPolicy(A, freshU({ intent: 'give_color' }));
            check('28.1 Колір, якого нема в підібраному розмірі (графітові XL) → знято й пояснено, палітра лише кольори XL', A.out.some((o) => o.step === 'color_size_unavailable') && !/Графіт/.test(String(A.ctx.product.colors)), 'steps ' + A.out.map((o) => o.step).join(',') + ' | colors ' + A.ctx.product.colors);
            const jCat = cat.products.find((p) => String(p.sku).toLowerCase() === 'j0032');
            check('28.2 Постачальнику рядок «графітові XL» не йде (missingVariant)', missingVariant({ sku: 'j0032', color: 'Графітовий', size: 'XL' }, jCat).length > 0, JSON.stringify(missingVariant({ sku: 'j0032', color: 'Графітовий', size: 'XL' }, jCat)));
        } else check('28.0 j0032 завантажується', false, '');
        // 29. Кольори, названі до розміру, не губляться (39dc3ff6, c83d677f).
        const kof = await load('C0043');
        if (kof && kof.sku) {
            const A = freshA({ turnText: 'Черную и серую' });
            A.ctx.product = JSON.parse(JSON.stringify(kof)); A.ctx.agent.presentedSku = kof.sku; A.ctx.presentedAt = Date.now() - 5 * 60 * 1000;
            await runPolicy(A, freshU({ intent: 'give_color', qty: 2, units: [{ color: 'Чорний', size: '' }, { color: 'Сірий', size: '' }] }));
            const cc = A.ctx.colorChoice || {};
            check('29.1 «Чорну і сіру» до розміру → кольори записано, бот питає лише зріст і вагу', Array.isArray(cc.colors) && cc.colors.length === 2 && A.out.some((o) => o.step === 'ask_params'), JSON.stringify(cc) + ' | ' + A.out.map((o) => o.step).join(','));
            A.turnText = '192см 96кг'; A.out = [];
            await runPolicy(A, freshU({ intent: 'give_params', height: 192, weight: 96 }));
            check('29.2 Після зросту й ваги колір удруге не питається', !A.out.some((o) => /оберіть колір|який колір/i.test(String(o.text || ''))), A.out.map((o) => o.step + ':' + String(o.text || '').slice(0, 40)).join(' | '));
        } else check('29.0 C0043 завантажується', false, '');
        // 30. Інваріант «не питати відоме / щойно поставлене» (ASK_KINDS).
        const hw = ASK_KINDS.find((k) => k.kind === 'hw'); const addr = ASK_KINDS.find((k) => k.kind === 'address');
        const t1 = stripAskSentences('Кофта з ангори 🧶 Підкажіть, будь ласка, ваш зріст і вагу — підберу розмір 📏', hw.isAsk);
        check('30.1 Прохання зросту/ваги прибирається, відповідь лишається', /ангори/.test(t1) && !/зріст/.test(t1), t1);
        const t2 = stripAskSentences('Номер накладної надішлемо сюди 📦 Дані для відправки (ПІБ, телефон, місто, № відділення або поштомата Нової Пошти) можна написати прямо зараз одним повідомленням 🙂', addr.isAsk);
        check('30.2 Прохання адреси прибирається (383a2e7c)', /накладної/.test(t2) && !/ПІБ/.test(t2), t2);
        // 31. Абзаци замість суцільного рядка.
        const p1 = paragraphize('Дякую за параметри 🙂 Ви називали M, але за вашим зростом і вагою краще підійде L 📏 Якщо все ж хочете M — напишіть, оформимо так. Тепер оберіть колір: Чорний, Графітовий — який вам більше до душі? 😊');
        check('31.1 Довгий текст одним рядком → абзаци', (p1.match(/\n\n/g) || []).length >= 2, JSON.stringify(p1).slice(0, 120));
        // 32. Запобіжник «зациклився» (05.10, скан 119 розмов): той самий крок 4 ходи поспіль → менеджер, а не 5-й повтор.
        {
            const A = freshA({ turnText: 'Pero para que te hace falta la dirección' });
            let broke = false;
            // клієнт щоразу пише ПІСЛЯ прохання бота (бачив його)
            for (let i = 0; i < 4; i++) { A.history = [{ who: 'client', text: 'x', at: new Date(Date.now() + 1000), sentAt: new Date(Date.now() + 1000) }]; A.out = [{ text: 'Напишіть, будь ласка, для відправки Новою Поштою: ПІБ, телефон, № відділення 📦', step: 'ask_address' }]; broke = await breakLoop(A); }
            check('32.1 4-те прохання адреси поспіль → передача менеджеру й пауза', broke && A.ctx.funnelPaused && A.ctx.pausedBy === 'loop' && A.out.length === 1 && A.out[0].step === 'loop_handoff', JSON.stringify(A.out).slice(0, 120));
            const B = freshA({ turnText: 'Дякую' });
            let b2 = false;
            for (const st of ['ask_address', 'order_intent', 'ask_address', 'order_intent']) { B.out = [{ text: 'x'.repeat(30), step: st }]; b2 = await breakLoop(B); }
            check('32.2 Різні кроки (рух уперед) — не петля', !b2 && !B.ctx.funnelPaused, JSON.stringify(B.ctx.agent.loopStreak));
            // 07.10 tatiananepota: 5 пересилань поста за 14 с — ходи пачки, клієнт ще не бачив відповіді → не петля.
            const C = freshA({ turnText: '' });
            const tClient = new Date(Date.now() - 5000);
            let b3 = false;
            for (let i = 0; i < 5; i++) { C.history = [{ who: 'client', text: '[переслав post]', at: tClient, sentAt: tClient }]; C.out = [{ text: 'Підкажіть, будь ласка, ваш зріст і вагу — підберу розмір 📏', step: 'ask_params' }]; b3 = await breakLoop(C) || b3; }
            check('32.3 Пачка повідомлень, написана до відповіді бота, — не петля', !b3 && !C.ctx.funnelPaused, JSON.stringify(C.ctx.agent.loopStreak));
        }
        // 33. Питання, поставлене ПІСЛЯ картки (кнопка Instagram «Яка вартість?»), не знімається як «відповіла картка» (FunnelTest 125).
        if (kof && kof.sku) {
            const A = freshA({ turnText: 'Яка ціна кофти?', history: [{ who: 'bot', text: 'картка', at: new Date(Date.now() - 20000) }, { who: 'client', text: 'Яка ціна кофти?', at: new Date(Date.now() - 3000), sentAt: new Date(Date.now() - 3000) }] });
            A.ctx.product = JSON.parse(JSON.stringify(kof)); A.ctx.agent.presentedSku = kof.sku; A.ctx.presentedAt = Date.now() - 20000;
            const u = freshU({ intent: 'question', questions: ['Яка ціна кофти?'] });
            await runPolicy(A, u);
            check('33.1 Питання після картки лишається для відповіді', u.questions.length === 1 || A.out.some((o) => /1279|ціна/i.test(String(o.text || ''))), JSON.stringify(A.out.map((o) => o.step)));
        }
        check('31.2 Текст із переносами не чіпається', paragraphize('Рядок один.\nРядок два, досить довгий, щоб перевищити межу в сто сорок символів, і ще трохи тексту, щоб точно перевищити.') === 'Рядок один.\nРядок два, досить довгий, щоб перевищити межу в сто сорок символів, і ще трохи тексту, щоб точно перевищити.', '');
    }

    console.log('');
    const failed = results.filter((r) => !r.ok);
    console.log(results.length + ' тестів, ' + failed.length + ' провалено.');
    if (failed.length) { console.log('ПРОВАЛЕНІ:', failed.map((f) => f.name).join(' | ')); process.exitCode = 1; }
    else console.log('УСІ ТЕСТИ ПРОЙШЛИ.');
}

main().catch((e) => { console.error('РЕГРЕСІЯ ВПАЛА З ПОМИЛКОЮ:', e.stack || e.message); process.exit(1); });
