'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *
 * ПРОБЛЕМА 1 (живий кейс, скрін власника, 2026-09-01): товар "Чоловіча вʼязана
 * кофта, артикул A0187" — бот шле повну презентацію товару (n_welcome), яка вже
 * САМА закінчується коротким "Вкажіть, будь ласка, зріст і вагу — підберемо
 * найкращий розмір 😊" (це context.product.followUpQuestion з n_lookup) — і
 * ОДРАЗУ ЖЕ, в тому самому ході (без відповіді клієнта!), n_size (claude-нода,
 * наступна в ланцюжку) ЗНОВУ питає те саме, розгорнуто: "Чудове питання! 😊 Для
 * того щоб точно підібрати розмір, мені потрібно знати: 📏 Ваш зріст (см)
 * ⚖️ Вашу вагу (кг) ...".
 *
 * ЦЕ НЕ D0005 (own-account echo) І НЕ вже виправлений productJustPresented-кейс
 * (той забороняє ПОВТОР ФАКТІВ товару — назва/матеріал/кольори/розміри/ціна, а
 * не повтор САМОГО ПИТАННЯ). Справжній корінь — ІНШИЙ шлях до того самого класу
 * "дубль-питання": двигун (testSession.js) навмисно НЕ чистить
 * runtime.lastUserMessage між message/condition/js-нодами того самого ходу (це
 * чистять лише claude-ноди, ПІСЛЯ споживання, — щоб наступна нода того ж ходу
 * не обробила його ЩЕ РАЗ). Ланцюжок n_welcome → n_is_set → n_recall_cond →
 * n_is_clothing → n_size — усі проміжні НЕ claude, тому те саме вхідне
 * повідомлення клієнта (напр. голий артикул "A0187"), яким n_lookup визначив
 * товар, долітає до n_size як "щойно сказане" — і n_size, за своїм системним
 * промптом (ціль кроку: зібрати зріст/вагу), чесно намагається відповісти на
 * НЬОГО, знову формулюючи прохання зросту й ваги. productJustPresented-прапорець
 * забороняє лише повтор ХАРАКТЕРИСТИК товару, не сам факт "питання вже
 * поставлено".
 *
 * ФІКС (систематичний, не ще один prompt-патч на n_size): прибираємо ДЖЕРЕЛО
 * дублю — followUpQuestion для товарів одягу (isClothing) більше НЕ формулює
 * питання про зріст/вагу дослівно (це відтепер ЄДИНОРАЗОВО робить n_size на
 * своєму першому ході), а лише завершує презентацію нейтральним переходом —
 * "кожне повідомлення закінчується наступним кроком" (п.3.4 стандарту) без
 * дублювання ЗМІСТУ питання. Взуття (category_id 7) і non-clothing — БЕЗ змін
 * (ті гілки НЕ ведуть у n_size одразу, дублю там нема).
 *
 * ЗАПУСК:  node patch-size-followup-dedup.js            (dry-run)
 *          node patch-size-followup-dedup.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = {
    goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee',
    // Клони "→ Fineko CRM" (2026-09-01) — станом на застосування ЩЕ на KeyCRM (готується
    // міграція, не почата в коді нод), тому ті самі анкори чинні. Якщо колись зʼявиться
    // WARNING "анкор не знайдено" саме для цих двох — це означає, що n_lookup/n_calc/тощо
    // вже переписали під нову CRM, патч треба пропустити для них і НЕ форсувати.
    goverlaCrmClone: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', covercarCrmClone: 'a2d5ba79-f87b-48f2-8301-56292cdf3972',
};
const APPLY = process.argv.includes('--apply');

const OLD = "'👉 Вкажіть, будь ласка, зріст і вагу — підберемо найкращий розмір? 😊'";
const NEW = "'👉 Зараз підберемо для вас ідеальний розмір 😊'";

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    if (!nLookup) { console.log(name, 'ERROR: n_lookup not found'); return; }

    const code = nLookup.data.code || '';
    if (code.includes(NEW)) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!code.includes(OLD)) { console.log(name, 'WARNING: анкор не знайдено — n_lookup.code міг змінитись з часу написання патча. Пропускаю (перевір вручну).'); return; }

    console.log(name, 'n_lookup.code: followUpQuestion (isClothing) буде замінено на нейтральний перехід (без дублю питання зріст/вага).');
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => (n.id === 'n_lookup' ? { ...n, data: { ...n.data, code: n.data.code.split(OLD).join(NEW) } } : n));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
