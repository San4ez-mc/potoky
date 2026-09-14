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
 */
const path = require('path');
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
    // 14.09: виклик на неіснуючий id n_catalog_hint_process мовчки не працював УЗАГАЛІ.
    {
        const A = freshA({ turnText: 'Штани є в наявності?' });
        const u = freshU({ intent: 'product_query' });
        await runPolicy(A, u);
        const hintFired = A.out.some((o) => o.step === 'hint') || A.trace.some((t) => t.tool === 'n_catalog_hint' && t.ok);
        check('Підказка каталогу (n_catalog_hint) реально викликається на слово-категорію', hintFired, 'out steps: ' + A.out.map((o) => o.step).join(','));
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

    console.log('');
    const failed = results.filter((r) => !r.ok);
    console.log(results.length + ' тестів, ' + failed.length + ' провалено.');
    if (failed.length) { console.log('ПРОВАЛЕНІ:', failed.map((f) => f.name).join(' | ')); process.exitCode = 1; }
    else console.log('УСІ ТЕСТИ ПРОЙШЛИ.');
}

main().catch((e) => { console.error('РЕГРЕСІЯ ВПАЛА З ПОМИЛКОЮ:', e.stack || e.message); process.exit(1); });
