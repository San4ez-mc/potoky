'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *
 * БАГ (живий кейс oleksii_sirazetdinov, 2026-08-29, товар C0043 — підтверджено
 * реальним трейсом сесії): клієнт пише ГОЛИЙ артикул/код товару ("C0043") →
 * n_welcome шле verbatim-опис товару (назва/матеріал/кольори/розміри/ціна) →
 * ОДРАЗУ ЗА НИМ у тому ж ході n_size (claude-нода) ЗНОВУ переказує ті самі
 * характеристики ("Ось! Чоловіча вʼязана кофта (артикул C0043) — це саме те!
 * Матеріал: ..., Кольори: ..., Розміри: ...") замість одразу спитати зріст/
 * вагу. Стара заборона в промпті ("не дублюй презентацію товару") була лише
 * СЛОВЕСНОЮ порадою без жодного підтвердження в даних, які реально бачить
 * модель: conversationWindow для n_size будується ДО того, як n_welcome
 * встигає записати своє повідомлення в БД (testSession.js) — тобто модель не
 * має ЖОДНОГО доказу в історії діалогу, що презентація щойно була, і працює
 * лише "на слово". Коли клієнт пише голий код — це виглядає як "новий запит
 * про товар", і модель ігнорує словесну заборону.
 *
 * ФІКС (детермінований прапорець, а не довіра моделі — testSession.js вже
 * підтримує generic data.setContext на БУДЬ-ЯКій ноді, живе рівно 1 наступну
 * ноду, автоскидання):
 *   1) n_welcome: data.setContext = { productJustPresented: true } —
 *      виставляється КОДОМ щоразу, коли рендериться картка товару.
 *   2) n_size: systemPrompt тепер явно звіряє {{context.productJustPresented}}
 *      і жорстко забороняє повтор характеристик САМЕ коли прапорець true —
 *      з прикладом ПОГАНО/ДОБРЕ, а не загальною порадою.
 *
 * ЗАПУСК:  node patch-size-productjustpresented.js            (dry-run)
 *          node patch-size-productjustpresented.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const OLD_LINE = '❌ КЛІЄНТА ВЖЕ ПРИВІТАЛИ секунду тому — НІКОЛИ не пиши "Привіт"/"Вітаю"/"Доброго дня" знову і не дублюй презентацію товару. Одразу по суті, без привітання.';

const NEW_BLOCK = '❌ КЛІЄНТА ВЖЕ ПРИВІТАЛИ секунду тому — НІКОЛИ не пиши "Привіт"/"Вітаю"/"Доброго дня" знову.\n'
    + '🚫 ПРАПОРЕЦЬ ТОВАР_ЩОЙНО_ПОКАЗАНО (виставляє КОД, не вгадуй сам): "{{context.productJustPresented}}". Якщо тут "true" — секунду тому, В ЦЬОМУ Ж ХОДІ, клієнту ВЖЕ показали ПОВНУ картку товару (назва, матеріал, кольори, розміри, ціна). ЦЕ СТОСУЄТЬСЯ І ТОГО ВИПАДКУ, коли клієнт написав лише ГОЛИЙ артикул/код товару (напр. "C0043") — це НЕ "новий запит", товар ЩОЙНО показано, тому в своєму повідомленні НЕ повторюй ЖОДНОГО з цих фактів (ні назву, ні матеріал, ні кольори, ні розміри, ні ціну) — одразу переходь до збору зросту й ваги або дай пряму відповідь на конкретне питання клієнта.\n'
    + 'ПРИКЛАД ПОГАНО (заборонено, коли прапорець "true"): «Ось! 🎯 Чоловіча вʼязана кофта (артикул C0043) — це саме те! 🧶 Матеріал: ангора 🎨 Кольори: чорний, графітовий, світло-сірий 📏 Розміри: S, M, L, XL, XXL» — це ДУБЛЬ картки товару, заборонено.\n'
    + 'ПРИКЛАД ДОБРЕ (коли прапорець "true"): «Супер, записала цей варіант! 😊 Підкажіть, будь ласка, зріст і вагу 📏» — без жодного повтору характеристик.\n'
    + 'Коли прапорець НЕ "true" (порожньо) — презентації щойно не було, працюй за рештою правил нижче як завжди.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nWelcome = flow.nodes.find((n) => n.id === 'n_welcome');
    const nSize = flow.nodes.find((n) => n.id === 'n_size');
    if (!nWelcome) { console.log(name, 'ERROR: n_welcome not found'); return; }
    if (!nSize) { console.log(name, 'ERROR: n_size not found'); return; }

    const welcomeDone = nWelcome.data.setContext && nWelcome.data.setContext.productJustPresented === true;
    const sizeDone = typeof nSize.data.systemPrompt === 'string' && nSize.data.systemPrompt.includes('ПРАПОРЕЦЬ ТОВАР_ЩОЙНО_ПОКАЗАНО');
    const sizeHasOldLine = typeof nSize.data.systemPrompt === 'string' && nSize.data.systemPrompt.includes(OLD_LINE);

    if (welcomeDone && sizeDone) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!sizeDone && !sizeHasOldLine) {
        console.log(name, 'WARNING: n_size.systemPrompt не містить очікуваного OLD_LINE — промпт міг змінитись з часу написання патча. Пропускаю n_size (перевір вручну).');
    }

    console.log(name, 'n_welcome.setContext додати =', !welcomeDone, '| n_size.systemPrompt переписати =', !sizeDone && sizeHasOldLine);
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_welcome' && !welcomeDone) {
            return { ...n, data: { ...n.data, setContext: { ...(n.data.setContext || {}), productJustPresented: true } } };
        }
        if (n.id === 'n_size' && !sizeDone && sizeHasOldLine) {
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.split(OLD_LINE).join(NEW_BLOCK) } };
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
