'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...),
 * нода n_lookup (js) — розслідування "не той товар" (2026-08-30).
 *
 * Перевірено сьогоднішні фолбеки (Priority 2.5 keyword-matching + price
 * tie-break, застосовані раніше сьогодні) — вони вже обережні: мінімум 2
 * значущих слова-збіги, і явний "не вгадуємо" при рівному рахунку, коли обидва
 * кандидати мають ціну. Конкретних дір там НЕ знайдено.
 *
 * Знайдено ДВІ реальні дірки:
 *
 * 1) DEFAULT_AD_ID ("ОСТАННІЙ РЕЗЕРВ") — класичний демо-фолбек (антипатерн A1
 *    зі скіла: "Бомбер Мілітарі" замість накидок). Ключ зараз порожній у ключах
 *    ОБОХ ботів (перевірено), тож сьогодні неактивний — але сам МЕХАНІЗМ
 *    лишається міною: досить комусь колись випадково заповнити DEFAULT_AD_ID в
 *    UI воронки, і БУДЬ-ЯКИЙ незіставлений клієнт почне отримувати один і той
 *    самий чужий товар. Видаляємо механізм повністю — чесний "не визначив"
 *    безпечніший за прихований демо-фолбек, що чекає своєї миті.
 *
 * 2) Vision-фолбек (Gemini, Priority 2.9) просив "НАЙБЛИЖЧИЙ відповідник" —
 *    формулювання, що заохочує модель ЗАВЖДИ щось повернути (найближче за
 *    категорією/кольором), а не лише коли це дійсно ТОЙ САМИЙ товар. Додано
 *    явне поле "confident" — bestMatchIndex приймається двигуном ЛИШЕ якщо
 *    confident===true, і промпт прямо каже: не 100% впевнений — null, це
 *    нормально.
 *
 * ЗАПУСК:  node patch-lookup-remove-default-and-vision-confidence.js            (dry-run)
 *          node patch-lookup-remove-default-and-vision-confidence.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const OLD_DEFAULT_BLOCK = "  // ОСТАННІЙ РЕЗЕРВ: DEFAULT_AD_ID (зараз порожній)\n"
    + "  if(!found){ var dk=(keys.DEFAULT_AD_ID||'').trim(); if(dk){ found=matchCT(all,dk); if(found){ via='default'; mk='def_'+dk; } } }\n";

const NEW_DEFAULT_BLOCK = "  // ОСТАННІЙ РЕЗЕРВ ВИДАЛЕНО (аудит 2026-08-30, розслідування \"не той товар\"):\n"
    + "  // DEFAULT_AD_ID підставляв БУДЬ-ЯКИЙ фіксований товар, коли нічого не збіглось —\n"
    + "  // класичний демо-фолбек (антипатерн A1: \"Бомбер Мілітарі\" замість накидок). Ключ\n"
    + "  // і без того був порожній, але сам механізм лишався міною на майбутнє. Чесний\n"
    + "  // \"не визначив\" (fallback() нижче) — безпечніший за прихований демо-фолбек.\n";

const OLD_VISION_PROMPT = "Потім знайди НАЙБЛИЖЧИЙ відповідник у каталозі нижче (формат: індекс: назва). Якщо жодного релевантного немає — bestMatchIndex null. Поверни ЛИШЕ JSON {\"description\":\"...\",\"bestMatchIndex\":число_або_null}.";
const NEW_VISION_PROMPT = "Потім перевір, чи Є в каталозі нижче (формат: індекс: назва) ТОЧНО ЦЕЙ САМИЙ товар — не просто схожий за категорією чи кольором, а саме він. Якщо не впевнений на 100%, що це той самий товар — bestMatchIndex ОБОВ'ЯЗКОВО null, це нормальний очікуваний результат, краще чесно \"не визначив\", ніж вгадати найближчий. Поверни ЛИШЕ JSON {\"description\":\"...\",\"confident\":true_або_false,\"bestMatchIndex\":число_або_null}.";

const OLD_VISION_CONSUME = "if(mmp){ var fp=JSON.parse(mmp[0]); if(fp.bestMatchIndex!=null && all[fp.bestMatchIndex]){ found=all[fp.bestMatchIndex]; via='photo'; mk='photo_'+fp.bestMatchIndex; } }";
const NEW_VISION_CONSUME = "if(mmp){ var fp=JSON.parse(mmp[0]); if(fp.confident===true && fp.bestMatchIndex!=null && all[fp.bestMatchIndex]){ found=all[fp.bestMatchIndex]; via='photo'; mk='photo_'+fp.bestMatchIndex; } }";

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }
    const n = flow.nodes.find((x) => x.id === 'n_lookup');
    if (!n) { console.log(name, 'ERROR: n_lookup not found'); return; }
    const code = n.data.code || '';

    const hasOldDefault = code.includes(OLD_DEFAULT_BLOCK);
    const hasNewDefault = code.includes('ОСТАННІЙ РЕЗЕРВ ВИДАЛЕНО');
    const hasOldVisionPrompt = code.includes(OLD_VISION_PROMPT);
    const hasNewVisionPrompt = code.includes('"confident":true_або_false');
    const hasOldVisionConsume = code.includes(OLD_VISION_CONSUME);
    const hasNewVisionConsume = code.includes('fp.confident===true');

    if (hasNewDefault && hasNewVisionPrompt && hasNewVisionConsume) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!hasOldDefault && !hasNewDefault) console.log(name, 'WARNING: OLD_DEFAULT_BLOCK не знайдено — код міг змінитись, пропускаю цю частину.');
    if (!hasOldVisionPrompt && !hasNewVisionPrompt) console.log(name, 'WARNING: OLD_VISION_PROMPT не знайдено — пропускаю цю частину.');
    if (!hasOldVisionConsume && !hasNewVisionConsume) console.log(name, 'WARNING: OLD_VISION_CONSUME не знайдено — пропускаю цю частину.');

    console.log(name,
        'DEFAULT_AD_ID видалити =', hasOldDefault && !hasNewDefault,
        '| vision prompt посилити =', hasOldVisionPrompt && !hasNewVisionPrompt,
        '| vision consume посилити =', hasOldVisionConsume && !hasNewVisionConsume);
    if (!APPLY) return;

    let newCode = code;
    if (hasOldDefault && !hasNewDefault) newCode = newCode.split(OLD_DEFAULT_BLOCK).join(NEW_DEFAULT_BLOCK);
    if (hasOldVisionPrompt && !hasNewVisionPrompt) newCode = newCode.split(OLD_VISION_PROMPT).join(NEW_VISION_PROMPT);
    if (hasOldVisionConsume && !hasNewVisionConsume) newCode = newCode.split(OLD_VISION_CONSUME).join(NEW_VISION_CONSUME);

    const nodes = flow.nodes.map((x) => (x.id === 'n_lookup' ? { ...x, data: { ...x.data, code: newCode } } : x));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
