'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Виявлено систематичним тест-прогоном усіх "бот зупиняється й кличе
 *   менеджера" гілок (запит власника, 2026-08-29): n_size мав чіткий рецепт
 *   "коли є зріст і вага — поверни РІВНО JSON {height,weight}, НЕ вгадуй
 *   розмір" — але коли клієнт назвав ЕКСТРЕМАЛЬНІ параметри (напр. 210см/250кг,
 *   явно поза сіткою будь-якого товару), модель САМА вирішила, що це очевидно
 *   не підійде, і замість JSON написала вільний текст ("На жаль, цей костюм...
 *   виходить за межі... Чи хочете, щоб я вас перенаправив до менеджера?").
 *
 *   Наслідок: детермінована гілка n_calc -> n_size_oor -> n_size_oor_stop
 *   (яка ставить adminEngaged=true і РЕАЛЬНО сповіщає менеджера) НІКОЛИ не
 *   запускається — модель сама "вирішила" викликати менеджера, але
 *   СПРАВЖНЬОГО сповіщення при цьому НЕ пішло. Якщо клієнт просто скаже
 *   "так" на пропозицію моделі — жоден Telegram-сигнал не прийде.
 *
 *   Це порушення правила "критичні рішення — детерміновані" (§4, funnel
 *   standard): порахувати "чи розмір підходить" має n_calc (JS, за реальними
 *   межами SIZE_CHART), а не модель "на око".
 *
 *   Фікс: явне правило 4b — ЗАВЖДИ повертати JSON, НАВІТЬ якщо цифри здаються
 *   екстремальними/нереальними — рішення "чи це поза сіткою" ухвалює СИСТЕМА
 *   (n_calc) далі, а не модель. Моделі заборонено самій писати "не підійде"/
 *   "виходить за межі"/пропонувати менеджера ДО того, як система це визначить.
 *
 * ЗАПУСК:  node patch-size-always-json-no-selfjudge.js            (dry-run)
 *          node patch-size-always-json-no-selfjudge.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const ANCHOR = '4. КОЛИ Є І ЗРІСТ, І ВАГА — поверни РІВНО один JSON у json_output: {"height": <см>, "weight": <кг>} і БІЛЬШЕ НІЧОГО (жодного тексту, НЕ називай і НЕ вгадуй розмір — його порахує система далі). Якщо клієнт сам наполіг на конкретному розмірі — додай "clothingSize".';
const ADDITION = '\n4b. ЦЕ СТОСУЄТЬСЯ І "НЕЗВИЧНИХ" ЦИФР: навіть якщо зріст/вага здаються тобі екстремальними чи нереальними (напр. дуже великий/малий) — ВСЕ ОДНО поверни РІВНО той самий JSON {"height":<см>,"weight":<кг>}, БЕЗ жодного тексту від себе. НІКОЛИ сам не пиши "не підійде за розміром", "виходить за межі сітки" чи не пропонуй менеджера — чи це поза сіткою, вирішує СИСТЕМА (наступний крок), не ти. Твоя єдина задача на цьому кроці — зчитати цифри й віддати JSON.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const n = flow.nodes.find((x) => x.id === 'n_size');
    if (!n) { console.log(name, 'ERROR: n_size not found'); return; }

    const sp = n.data.systemPrompt || '';
    if (sp.includes(ADDITION)) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!sp.includes(ANCHOR)) { console.log(name, 'WARNING: анкор не знайдено — перевір вручну.'); return; }

    console.log(name, 'буде додано правило 4b (завжди JSON, навіть для екстремальних цифр) у n_size.');
    if (!APPLY) return;

    const nodes = flow.nodes.map((x) => (x.id === 'n_size' ? { ...x, data: { ...x.data, systemPrompt: sp.replace(ANCHOR, ANCHOR + ADDITION) } } : x));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
