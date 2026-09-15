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
const { runPolicy, matchColor } = require('../policy');

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
        const r = await resolveProduct(A, { forceSignal: true });
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

    console.log('');
    const failed = results.filter((r) => !r.ok);
    console.log(results.length + ' тестів, ' + failed.length + ' провалено.');
    if (failed.length) { console.log('ПРОВАЛЕНІ:', failed.map((f) => f.name).join(' | ')); process.exitCode = 1; }
    else console.log('УСІ ТЕСТИ ПРОЙШЛИ.');
}

main().catch((e) => { console.error('РЕГРЕСІЯ ВПАЛА З ПОМИЛКОЮ:', e.stack || e.message); process.exit(1); });
