'use strict';
// Прогін FunnelTest «заміни / додавання товарів» на коді з робочої копії (запит власника 15.10).
// Створює (один раз) 5 нових тестів і ганяє їх разом із наявними тестами замін/додавань. Звіт — у stdout.
// Запуск на сервері з робочої копії гілки:  cd platform/apps/api && node ../../scripts/qa/run-swap-tests-2026-10-15.js
process.env.name = process.env.name || 'swap-tests';
if (!process.env.NODE_PATH) { process.env.NODE_PATH = '/var/www/flows.fineko.space/platform/node_modules'; require('module').Module._initPaths(); }
const path = require('path');
const API = path.join(__dirname, '../../apps/api/src/services');
const { db, loadCatalog } = require(path.join(API, 'shopAgent/lib'));
const FT = require(path.join(API, 'funnelTests'));
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const EXISTING = ['4122769d', '6d1d8b5d', 'a3155165', '46bd8097', '80e54cde', '1061c2ab', 'de318c87', '9c12aae3', '0c4318fb', '30fdb6da', '503eec52', '4afa1b99', 'e265c306'];

async function ensureTest(name, steps, expectedOutcome) {
    const ex = await db.funnelTest.findFirst({ where: { botId: BOT, name } });
    if (ex) { await db.funnelTest.update({ where: { id: ex.id }, data: { steps, expectedOutcome } }); return ex.id; }
    const t = await FT.createTest({ botId: BOT, name, steps, expectedOutcome, createdBy: 'claude' });
    return t.id;
}

(async () => {
    const keys = {}; for (const k of await db.funnelKey.findMany({ where: { botId: BOT }, select: { key: true, value: true } })) keys[k.key] = k.value;
    const cat = await loadCatalog(BOT, keys, { force: true });
    const base = (keys.CRM_PUBLIC_BASE || 'https://pcrm.fineko.space').replace(/\/$/, '');
    const img = (sku) => { const p = cat.products.find((x) => String(x.sku).toLowerCase() === sku.toLowerCase()); const u = p && (p.images || [])[0]; return u ? (/^https?:/.test(u) ? u : base + (u.startsWith('/') ? u : '/' + u)) : null; };
    const setImg = img('set1120');
    const created = [];
    created.push(await ensureTest('15.10 Н1. Пост пуховика → фото комплекту set1120 «Ціна?» → комплект, а не пуховик (_mishko.prvt_)',
        // Дослівно як наживо (сесія 9ac54980): коментар під постом пуховика → відповідь на сторіз-відео комплекту з написом «Артикул: set1120»
        // (кадри витягнуто з самої сторіз) → «Та не пуховик скільки коштує» → «Той що у історії у вас скільки коштує ?».
        [{ type: 'comment', text: 'Ціна ?)', sharedPost: { kind: 'post', mediaId: 'test-d0043', caption: 'Чоловічий зимовий пуховик. Артикул: D0043' } },
         { type: 'photo', text: 'Цінаааааа?', story: { id: 'test-story-set1120', imageUrls: ['https://flows.fineko.space/bot-files/test-stories/mishko-set1120-1.jpg', 'https://flows.fineko.space/bot-files/test-stories/mishko-set1120-2.jpg'] } },
         { type: 'text', text: 'Та не пуховик скільки коштує' },
         { type: 'text', text: 'Той що у історії у вас скільки коштує ?' }],
        'Перша відповідь — про зимовий пуховик D0043 (коментар під його постом). Далі клієнт відповідає на сторіз з комплектом set1120 (светр + джинси, на кадрі напис «Артикул: set1120») — бот переходить на ЦЕЙ комплект: показує його і його ціну. На «Та не пуховик» і «Той що у історії» бот говорить про комплект set1120, а НЕ повторює ціну пуховика 2479 грн і не просить зріст і вагу «для пуховика».'));
    created.push(await ensureTest('15.10 Н2. Пост пуховика → «Та не пуховик, светр скільки коштує?» → светри, а не пуховик',
        [{ type: 'forward_post', text: 'Ціна?', sharedPost: { kind: 'post', mediaId: 'test-d0043', caption: 'Чоловічий зимовий пуховик. Артикул: D0043' } }, { type: 'text', text: 'Та не пуховик, светр скільки коштує?' }],
        'Після картки пуховика клієнт прямо каже, що питає НЕ про пуховик, а про светр. Бот показує светр(и)/ціну светра (або список светрів/кофт), а не повторює ціну пуховика і не просить зріст і вагу для пуховика.'));
    created.push(await ensureTest('15.10 Н3. Заміна однієї речі на ДВІ однакові інші: A0187 → «замість неї дві кофти C0043 — чорну і світло-сіру»',
        [{ type: 'text', text: 'Хочу кофту A0187' }, { type: 'text', text: 'Зріст 180, вага 80' }, { type: 'text', text: 'Ні, давайте замість неї дві кофти C0043 — чорну і світло-сіру' }],
        'Після останнього повідомлення в замовленні — НЕ A0187, а кофта C0043 у кількості 2 шт: одна чорна, одна світло-сіра, розмір за зростом 180 / вагою 80 (L або як підбере сітка, однаковий для обох). Ціна — акційна за 2 шт (якщо є «2 шт: …») або 2 × ціна. Зріст і вагу вдруге не питає. A0187 у підсумку немає.'));
    created.push(await ensureTest('15.10 Н4. Додати кілька товарів: кофта A0187 → «і ще джинси і футболку білу»',
        [{ type: 'text', text: 'Хочу кофту A0187' }, { type: 'text', text: '180 80, чорна' }, { type: 'text', text: 'і ще джинси і футболку білу' }, { type: 'text', text: 'Джинси сині' }],
        'Кофта A0187 (чорна, розмір за 180/80) лишається в замовленні. Джинси й біла футболка ДОДАЮТЬСЯ, а не замінюють кофту: бот по черзі підбирає джинси (колір — клієнт каже «сині»; розмір — за 180/80, вдруге зріст і вагу не питає) і футболку (біла; розмір за 180/80). Після цього — підсумок з УСІМА трьома позиціями (кофта чорна, джинси сині, футболка біла — кожна зі своїм розміром і ціною) і загальною сумою. Нічого з названого не губиться і не підміняється. (Поки бот веде інший товар, головний лежить у basket.anchor — це НЕ втрата.)'));
    created.push(await ensureTest('15.10 Н5. Заміна речі в комплекті: set1112 весь → «замість лоферів ще одну футболку чорну»',
        [{ type: 'text', text: 'Комплект set1112 цікавить' }, { type: 'text', text: 'Весь комплект' }, { type: 'text', text: 'Зріст 185, вага 85' }, { type: 'text', text: 'Замість лоферів додайте ще одну футболку, чорну' }],
        'Лофери прибрано зі складу комплекту (їх і так немає в наявності — бот не каже «не знайшла»), футболок стає 2 (нова — чорна; колір першої бот може уточнити), сума перерахована як сума реальних позицій без лоферів: кофта 1279 + джинси 1590 + ДВІ футболки за акцією товару «2 шт — 799» = 3668 грн (2 × 449 = 898 теж допустимо, якщо акції не застосовано). Колір кофти бот НЕ ставить сам («чорну» стосується нової футболки). Бот підтверджує, що змінено, і не губить кофту й джинси. Розміри одягу — за 185/85, вдруге зріст і вагу не питає.'));

    const all = await db.funnelTest.findMany({ where: { botId: BOT }, select: { id: true, name: true } });
    // Аргументи — префікси id тестів, які прогнати (без аргументів — усі). 'new' — лише 5 нових.
    const ONLY = process.argv.slice(2);
    let ids = EXISTING.map((p) => all.find((t) => t.id.startsWith(p))).filter(Boolean).map((t) => t.id).concat(created);
    if (ONLY.length) ids = ids.filter((id) => ONLY.some((p) => (p === 'new' ? created.includes(id) : id.startsWith(p))));
    const results = [];
    for (const id of ids) {
        const t = all.find((x) => x.id === id) || { name: id };
        const t0 = Date.now();
        let r; try { r = await FT.runTest(id); } catch (e) { r = { status: 'error', verdict: { passed: false, reasoning: e.message } }; }
        const v = r.verdict || {};
        results.push({ id: id.slice(0, 8), name: (t.name || '').slice(0, 110), passed: !!v.passed, status: r.status, sec: Math.round((Date.now() - t0) / 1000), why: String(v.reasoning || '').replace(/\s+/g, ' ').slice(0, 600), session: r.sessionId });
        console.log((v.passed ? 'PASS ' : 'FAIL ') + id.slice(0, 8) + ' | ' + (t.name || '').slice(0, 90) + (v.passed ? '' : '\n      ' + String(v.reasoning || '').replace(/\s+/g, ' ').slice(0, 500)) + '\n      сесія: ' + (r.sessionId || '—'));
    }
    console.log('\nПІДСУМОК: ' + results.filter((r) => r.passed).length + ' з ' + results.length);
    process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
