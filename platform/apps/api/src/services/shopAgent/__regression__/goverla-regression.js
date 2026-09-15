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

    // ── 10. Колір позицій комплекту — живий кейс 15.09 (власник: "якого кольору джинси ми
    // оформимо?"): однокольорові позиції підтягуються самі, багатоколірні — питаються окремо.
    {
        const A = freshA({ turnText: 'Синя' });
        A.ctx.product = { sku: 'set1113', isSet: true, price: 5290 };
        A.ctx.setMode = 'set';
        A.ctx.agent.setOriginal = [
            { article: 'D0050', name: 'Кофта', price: 1190, colors: ['Чорний'], sizes: [], qty: 1, color: '' },
            { article: 'j0032', name: 'Джинси', price: 1590, colors: ['Синій', 'Чорний', 'Графітовий'], sizes: [], qty: 1, color: '' },
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
    }

    console.log('');
    const failed = results.filter((r) => !r.ok);
    console.log(results.length + ' тестів, ' + failed.length + ' провалено.');
    if (failed.length) { console.log('ПРОВАЛЕНІ:', failed.map((f) => f.name).join(' | ')); process.exitCode = 1; }
    else console.log('УСІ ТЕСТИ ПРОЙШЛИ.');
}

main().catch((e) => { console.error('РЕГРЕСІЯ ВПАЛА З ПОМИЛКОЮ:', e.stack || e.message); process.exit(1); });
