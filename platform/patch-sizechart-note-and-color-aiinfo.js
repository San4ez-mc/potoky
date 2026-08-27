'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Ф1.3  Заповнення розмірних сіток продовжується (Костюм Мажор A0114 + лофери
 *   5931-5935 через КeyCRM API) виявило дві прогалини:
 *
 *   1) n_lookup: sizeChartNote дивився ЛИШЕ на CT_1010 (картинка). Лофери мають
 *      CT_1012 (точні см з опису постачальника) БЕЗ CT_1010 (фото сітки нема) —
 *      консультант помилково казав "сітки нема взагалі", хоча точні цифри БУЛИ.
 *      Тепер три стани: є картинка → покажемо; нема картинки але є CT_1012 →
 *      назвемо цифри словами; нема нічого → чесно "нема" (як і раніше).
 *   2) n_color: єдина консультант-нода, яку РЕАЛЬНО проходить взуття (не одяг за
 *      CLOTHING_CATEGORY_IDS → пропускає n_size/n_calc, де сітка й показувалась) —
 *      не мала {{context.product.aiInfo}} в промпті взагалі. CT_1011 (де тепер
 *      лежить "43 розмір = 27,5 см" для лоферів) був недосяжний для клієнта, що
 *      питає про взуття, — модель або мовчала про це, або кликала менеджера через
 *      "питання поза даними". Додано рядок з нюансами (як у n_size/n_order_intent).
 *
 * ЗАПУСК:  node patch-sizechart-note-and-color-aiinfo.js            (dry-run)
 *          node patch-sizechart-note-and-color-aiinfo.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOTS = {
    goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193',
    covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee',
};
const APPLY = process.argv.includes('--apply');

// GOVERLA: n_lookup-code.js Є ЖИВИМ джерелом істини (1:1 з нодою) — повна перезапись.
const NEW_LOOKUP_CODE_GOVERLA = fs.readFileSync(path.join(__dirname, 'n_lookup-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

// COVERCAR: структура n_lookup НЕ 1:1 з goverla (інший порядок вставок від
// попередніх патчів) — цільова заміна того самого блоку, а не повна перезапись.
const CC_NOTE_OLD = `var __sizeChartUrl=cfVal('CT_1010');
  var __aiInfo=cfVal('CT_1011');
  var __sizeChartDataRaw=cfVal('CT_1012'); var __sizeChartData=null; if(__sizeChartDataRaw){ try{ __sizeChartData=JSON.parse(__sizeChartDataRaw); }catch(e){ __sizeChartData=null; } }
  var __sizeChartNote=__sizeChartUrl
    ? 'Розмірна сітка для цього товару Є — якщо клієнт попросить, скажи що зараз покажеш.'
    : 'Розмірної сітки для цього товару ПОКИ НЕМА в системі — якщо клієнт попросить, чесно скажи, що зараз немає під рукою, і запропонуй підібрати розмір за зростом і вагою.';`;
const CC_NOTE_NEW = `var __sizeChartUrl=cfVal('CT_1010');
  var __aiInfo=cfVal('CT_1011');
  var __sizeChartDataRaw=cfVal('CT_1012'); var __sizeChartData=null; if(__sizeChartDataRaw){ try{ __sizeChartData=JSON.parse(__sizeChartDataRaw); }catch(e){ __sizeChartData=null; } }
  // Аудит 2026-08-27 (лофери 5931-5935, спільний каталог з goverla_shop): CT_1012
  // буває заповнене БЕЗ CT_1010-картинки (взуття — розмір/см з опису, фото сітки нема).
  var __sizeChartNote=__sizeChartUrl
    ? 'Розмірна сітка для цього товару Є — якщо клієнт попросить, скажи що зараз покажеш.'
    : (__sizeChartData
      ? 'Картинки розмірної сітки НЕМА, але є точні цифри по кожному розміру (нижче, поле 7) — якщо клієнт попросить сітку, НЕ обіцяй фото, а назви ці цифри словами.'
      : 'Розмірної сітки для цього товару ПОКИ НЕМА в системі — якщо клієнт попросить, чесно скажи, що зараз немає під рукою, і запропонуй підібрати розмір за зростом і вагою.');`;

const N_COLOR_ANCHOR = 'Товар: {{context.product.name}} ({{context.product.desc}}), ціна {{context.product.price}} грн.\nВеди діалог САМЕ про цей товар — НЕ вигадуй іншу категорію/характеристики, яких немає в даних вище.';
const N_COLOR_NEW = 'Товар: {{context.product.name}} ({{context.product.desc}}), ціна {{context.product.price}} грн.\nВАЖЛИВІ НЮАНСИ ЦЬОГО ТОВАРУ (лише для тебе, НІКОЛИ не цитуй клієнту дослівно як список — вплети природно, якщо доречно, напр. точні розміри у см для взуття): {{context.product.aiInfo}}\nВеди діалог САМЕ про цей товар — НЕ вигадуй іншу категорію/характеристики, яких немає в даних вище.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    const nColor = flow.nodes.find((n) => n.id === 'n_color');
    if (!nLookup || !nColor) { console.log(name, 'ERROR: n_lookup/n_color not found'); return; }

    const lookupDone = nLookup.data.code.includes('Картинки розмірної сітки НЕМА');
    const colorDone = nColor.data.systemPrompt.includes('ВАЖЛИВІ НЮАНСИ ЦЬОГО ТОВАРУ');

    if (lookupDone && colorDone) { console.log(name, 'ALREADY_APPLIED'); return; }

    console.log(name, 'n_lookup sizeChartNote fix =', !lookupDone, '| n_color aiInfo =', !colorDone);
    if (!APPLY) return;

    if (!colorDone && !nColor.data.systemPrompt.includes(N_COLOR_ANCHOR)) {
        console.log(name, 'WARNING: n_color анкор не знайдено — лишаю без змін, перевір вручну.');
    }
    if (name === 'covercar' && !lookupDone && !nLookup.data.code.includes(CC_NOTE_OLD)) {
        console.log(name, 'WARNING: n_lookup анкор не знайдено — лишаю без змін, перевір вручну.');
    }

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_lookup' && !lookupDone) {
            if (name === 'goverla') return { ...n, data: { ...n.data, code: NEW_LOOKUP_CODE_GOVERLA } };
            if (name === 'covercar' && n.data.code.includes(CC_NOTE_OLD)) {
                return { ...n, data: { ...n.data, code: n.data.code.split(CC_NOTE_OLD).join(CC_NOTE_NEW) } };
            }
            return n;
        }
        if (n.id === 'n_color' && !colorDone && n.data.systemPrompt.includes(N_COLOR_ANCHOR)) {
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.replace(N_COLOR_ANCHOR, N_COLOR_NEW) } };
        }
        return n;
    });
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + NEW_LOOKUP_CODE_GOVERLA + '\n})();');
    for (const [name, botId] of Object.entries(BOTS)) {
        await patchBot(name, botId);
    }
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
