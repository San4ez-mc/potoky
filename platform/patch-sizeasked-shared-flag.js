'use strict';
/*
 * Патч ЧОТИРЬОХ ботів (goverla_shop, covercar_ua + 2 CRM-клони).
 *
 * ДОПОВНЕННЯ ПОВЕРХ Проблеми 1 (запит власника, 2026-09-02): попередній фікс
 * прибрав дубль-питання, ЗАРАЗ ЖЕ прибравши сам АСК із 2 з 3 шляхів (n_lookup
 * followUpQuestion і Zernio-автоматизація коментарів стали нейтральними,
 * n_size лишився ЄДИНИМ місцем, що питає). Це працює, але власник хоче
 * СПРАВЖНІЙ системний фікс — ОДИН прапорець у context (той самий патерн, що
 * вже є для productJustPresented), який ставить ПЕРШИЙ шлях, що поставив
 * питання, і який перевіряють УСІ шляхи перед тим, як питати знову — а не
 * хардкод "лише n_size питає".
 *
 * ФІКС:
 *   1) n_lookup: followUpQuestion (isClothing) знову ЛІТЕРАЛЬНО питає зріст/
 *      вагу (як і було спочатку) — n_welcome ЗНОВУ стає тим, хто питає.
 *   2) n_welcome: setContext доповнено {"sizeAsked": true} — той самий
 *      механізм, що й productJustPresented (двигун, testSession.js: прапорці
 *      переживають "тихі" condition/js-ноди між n_welcome і n_size, лишаються
 *      видимими для n_size на ЙОГО першому вході, автоматично чистяться
 *      одразу після — новий live-тест підтверджує: це САМЕ дає ефект "скинь,
 *      коли клієнт реально відповів АБО коли минув перший хід n_size", без
 *      ризику намертво заблокувати повторне питання при помилці вводу).
 *   3) n_size: systemPrompt тепер перевіряє sizeAsked ЯВНО — якщо true і в
 *      повідомленні клієнта НЕМАЄ реальної відповіді (тільки той самий
 *      тригер, яким показали товар) — питання НЕ повторюється, видимий текст
 *      не додається (порожній хід, чекаємо реальну відповідь наступним
 *      повідомленням клієнта). Якщо відповідь Є в цьому ж повідомленні —
 *      обробляється як завжди (json_output), sizeAsked цьому не заважає.
 *
 * Zernio-автоматизація коментарів (buildAutomationPresentation,
 * zernioHandler.js) СВІДОМО залишена нейтральною (НЕ повертається до
 * літерального питання) — вона працює ПОЗА сесією (Zernio власна конфігурація
 * на пост, спрацьовує ще ДО того, як у нас є session.context), тому фізично
 * не може ні прочитати, ні виставити context.sizeAsked. Якби вона теж питала
 * буквально — це створило б ІНШИЙ дубль (автоматизація Zernio + наш власний
 * n_welcome незалежно один від одного), який прапорець-у-сесії принципово не
 * може вирішити. Нейтральний текст там — правильне, а не тимчасове рішення.
 *
 * ЗАПУСК:  node patch-sizeasked-shared-flag.js            (dry-run)
 *          node patch-sizeasked-shared-flag.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = {
    goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee',
    goverlaCrmClone: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', covercarCrmClone: 'a2d5ba79-f87b-48f2-8301-56292cdf3972',
};
const APPLY = process.argv.includes('--apply');

// 1) n_lookup: followUpQuestion (isClothing) — назад до літерального питання.
const LOOKUP_OLD = "'👉 Зараз підберемо для вас ідеальний розмір 😊'";
const LOOKUP_NEW = "'👉 Вкажіть, будь ласка, зріст і вагу — підберемо найкращий розмір? 😊'";

// 3) n_size: заміна старого блоку прапорця productJustPresented (з прикладами)
// на новий блок, що поєднує ОБИДВА прапорці (productJustPresented + sizeAsked).
const SIZE_OLD = '🚫 ПРАПОРЕЦЬ ТОВАР_ЩОЙНО_ПОКАЗАНО (виставляє КОД, не вгадуй сам): "{{context.productJustPresented}}". Якщо тут "true" — секунду тому, В ЦЬОМУ Ж ХОДІ, клієнту ВЖЕ показали ПОВНУ картку товару (назва, матеріал, кольори, розміри, ціна). ЦЕ СТОСУЄТЬСЯ І ТОГО ВИПАДКУ, коли клієнт написав лише ГОЛИЙ артикул/код товару (напр. "C0043") — це НЕ "новий запит", товар ЩОЙНО показано, тому в своєму повідомленні НЕ повторюй ЖОДНОГО з цих фактів (ні назву, ні матеріал, ні кольори, ні розміри, ні ціну) — одразу переходь до збору зросту й ваги або дай пряму відповідь на конкретне питання клієнта.\nПРИКЛАД ПОГАНО (заборонено, коли прапорець "true"): «Ось! 🎯 Чоловіча вʼязана кофта (артикул C0043) — це саме те! 🧶 Матеріал: ангора 🎨 Кольори: чорний, графітовий, світло-сірий 📏 Розміри: S, M, L, XL, XXL» — це ДУБЛЬ картки товару, заборонено.\nПРИКЛАД ДОБРЕ (коли прапорець "true"): «Супер, записала цей варіант! 😊 Підкажіть, будь ласка, зріст і вагу 📏» — без жодного повтору характеристик.\nКоли прапорець НЕ "true" (порожньо) — презентації щойно не було, працюй за рештою правил нижче як завжди.';

const SIZE_NEW = '🚫 ПРАПОРЕЦЬ ТОВАР_ЩОЙНО_ПОКАЗАНО (виставляє КОД, не вгадуй сам): "{{context.productJustPresented}}". Якщо тут "true" — секунду тому, В ЦЬОМУ Ж ХОДІ, клієнту ВЖЕ показали ПОВНУ картку товару (назва, матеріал, кольори, розміри, ціна). ЦЕ СТОСУЄТЬСЯ І ТОГО ВИПАДКУ, коли клієнт написав лише ГОЛИЙ артикул/код товару (напр. "C0043") — це НЕ "новий запит", товар ЩОЙНО показано, тому в своєму повідомленні НЕ повторюй ЖОДНОГО з цих фактів (ні назву, ні матеріал, ні кольори, ні розміри, ні ціну).\n'
    + '🚫 ПРАПОРЕЦЬ ПИТАННЯ_ПРО_РОЗМІР_ВЖЕ_ЗАДАНО (виставляє КОД, не вгадуй сам): "{{context.sizeAsked}}". Якщо тут "true" — питання "вкажіть зріст і вагу" ВЖЕ поставлено клієнту СЕКУНДУ ТОМУ, в тому самому повідомленні, де показали товар (ПРЯМО НАД твоїм ходом). Подивись на ПОТОЧНЕ повідомлення клієнта: (а) якщо в ньому Є реальна відповідь (цифри зросту і/або ваги, точний обхват грудей, або наполягання на конкретному розмірі) — обробляй ЯК ЗАВЖДИ за правилами нижче (json_output), прапорець тут не заважає; (б) якщо відповіді НЕМА (це просто той самий тригер, яким клієнт показав товар — голий артикул, "хочу", емодзі тощо, а НЕ нова відповідь) — питання ВЖЕ стоїть у повідомленні вище, ти НІЧОГО не додаєш: не пиши жодного тексту і не став json_output — просто чекай на РЕАЛЬНУ відповідь клієнта наступним повідомленням. Порожній хід — ЄДИНИЙ дозволений результат у випадку (б); НЕ пиши "Очікую", НЕ став питання ще раз, НЕ вигадуй проміжний коментар.\n'
    + 'ПРИКЛАД ПОГАНО (заборонено, коли productJustPresented="true"): «Ось! 🎯 Чоловіча вʼязана кофта (артикул C0043) — це саме те! 🧶 Матеріал: ангора 🎨 Кольори: чорний, графітовий, світло-сірий 📏 Розміри: S, M, L, XL, XXL» — це ДУБЛЬ картки товару, заборонено.\n'
    + 'ПРИКЛАД ПОГАНО (заборонено, коли sizeAsked="true" і в повідомленні клієнта НЕМАЄ відповіді): «Супер, записала цей варіант! 😊 Підкажіть, будь ласка, зріст і вагу 📏» — питання вже поставлено рядком вище, це ДУБЛЬ, заборонено. Правильно тут — НІЧОГО не писати.\n'
    + 'ПРИКЛАД ДОБРЕ (sizeAsked="true", але клієнт ОДРАЗУ дав відповідь у тому самому повідомленні, напр. "A0187, зріст 180 вага 75"): просто поверни json_output {"height":180,"weight":75} — без жодного тексту, як завжди за правилом 4 нижче.\n'
    + 'Коли ОБИДВА прапорці НЕ "true" (порожньо) — нічого щойно не було, працюй за рештою правил нижче як завжди (сам питай зріст/вагу, якщо їх бракує).';

const WELCOME_SETCONTEXT_OLD = { productJustPresented: true };

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    const nWelcome = flow.nodes.find((n) => n.id === 'n_welcome');
    const nSize = flow.nodes.find((n) => n.id === 'n_size');
    if (!nLookup) { console.log(name, 'ERROR: n_lookup not found'); return; }
    if (!nWelcome) { console.log(name, 'ERROR: n_welcome not found'); return; }
    if (!nSize) { console.log(name, 'ERROR: n_size not found'); return; }

    const lookupCode = nLookup.data.code || '';
    const lookupDone = lookupCode.includes(LOOKUP_NEW);
    const lookupHasOld = lookupCode.includes(LOOKUP_OLD);

    const welcomeDone = !!(nWelcome.data.setContext && nWelcome.data.setContext.sizeAsked === true);

    const sizePrompt = nSize.data.systemPrompt || '';
    const sizeDone = sizePrompt.includes('ПРАПОРЕЦЬ ПИТАННЯ_ПРО_РОЗМІР_ВЖЕ_ЗАДАНО');
    const sizeHasOld = sizePrompt.includes(SIZE_OLD);

    if (lookupDone && welcomeDone && sizeDone) { console.log(name, 'ALREADY_APPLIED'); return; }

    if (!lookupDone && !lookupHasOld) console.log(name, 'WARNING: n_lookup — анкор followUpQuestion не знайдено (можливо, CRM-міграція вже переписала n_lookup). Пропускаю n_lookup.');
    if (!sizeDone && !sizeHasOld) console.log(name, 'WARNING: n_size — анкор systemPrompt не знайдено. Пропускаю n_size.');

    console.log(name,
        'n_lookup revert-to-ask =', !lookupDone && lookupHasOld,
        '| n_welcome sizeAsked flag =', !welcomeDone,
        '| n_size shared-flag check =', !sizeDone && sizeHasOld);
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_lookup' && !lookupDone && lookupHasOld) {
            return { ...n, data: { ...n.data, code: n.data.code.split(LOOKUP_OLD).join(LOOKUP_NEW) } };
        }
        if (n.id === 'n_welcome' && !welcomeDone) {
            return { ...n, data: { ...n.data, setContext: { ...(n.data.setContext || {}), sizeAsked: true } } };
        }
        if (n.id === 'n_size' && !sizeDone && sizeHasOld) {
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.split(SIZE_OLD).join(SIZE_NEW) } };
        }
        return n;
    });
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
