'use strict';
/*
 * Патч ОБОХ клонів (goverla_shop fcdee415-..., covercar_ua a2d5ba79-...):
 *   Живий кейс (запит власника): клієнт пише "180 100" (зріст/вага) — коли клієнт
 *   плутає звичну черговість, модель ІНКОЛИ повертає {height,weight} переплутаними
 *   місцями. Для дорослої людини зріст (140-220см) майже завжди >= вага (30-200кг) —
 *   додаємо ДЕТЕРМІНОВАНИЙ (не LLM-угадайка) пост-фікс одразу ПІСЛЯ json_output
 *   моделі (context.sizeInput, outputVar ноди n_size), у n_calc — ПЕРШИМ рядком коду,
 *   до будь-якого читання цих полів нижче (chest-exact-match, categoryParams-памʼять,
 *   SIZE_CHART підбір).
 *
 *   Правило: якщо height < weight (модель явно наплутала) І обмін МІСЦЯМИ дає ОБИДВА
 *   значення в реалістичних межах дорослої людини (зріст 140-220, вага 30-200) —
 *   міняємо місцями. Інакше не чіпаємо (напр. "зріст 180/вага 45" — height>=weight,
 *   плутанини нема; чи екстремальні значення, де обмін теж не дав би реалістичну
 *   пару — нехай n_size_oor нижче чесно ескалює на менеджера, а не вгадує).
 *
 * ЗАПУСК:  node patch-height-weight-swap.js            (dry-run)
 *          node patch-height-weight-swap.js --apply    (записує у БД)
 *
 * Ідемпотентний (маркер __hwSwapFix у коді n_calc).
 */
const { db } = require('@platform/db');

const BOTS = { goverla: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', covercar: 'a2d5ba79-f87b-48f2-8301-56292cdf3972' };
const APPLY = process.argv.includes('--apply');

const MARKER = '__hwSwapFix';
const SNIPPET = `// Аудит 2026-09-03 (${MARKER}, живий кейс власника — "180 100" при переплутаному
// порядку): ДЕТЕРМІНОВАНИЙ пост-фікс ПІСЛЯ json_output моделі (n_size, outputVar
// sizeInput) — САМА логіка розпізнавання моделі НЕ переписується (вона вже непогано
// визначає з контексту типу "мій зріст 180, вага 100кг"), це лише safety-net на
// неоднозначний "голий" ввід типу "180 100" без підказок, коли модель могла
// переплутати місцями. Для дорослої людини зріст (140-220см) практично завжди >=
// вага (30-200кг) — якщо модель повернула height < weight, і обмін місцями дає ОБИДВА
// значення в цих реалістичних межах — міняємо місцями. Явно різнопорядкові пари
// (напр. зріст 180/вага 45 — height вже >= weight) і пари, де обмін НЕ дав би
// реалістичну пару (екстремальні виміри) — не чіпаємо, нехай n_size_oor нижче
// чесно ескалює на менеджера замість вгадування.
if (context.sizeInput && typeof context.sizeInput === 'object') {
    var __hwH = Number(context.sizeInput.height), __hwW = Number(context.sizeInput.weight);
    if (isFinite(__hwH) && isFinite(__hwW) && __hwH > 0 && __hwW > 0 && __hwH < __hwW) {
        var __hwSwappedH = __hwW, __hwSwappedW = __hwH;
        if (__hwSwappedH >= 140 && __hwSwappedH <= 220 && __hwSwappedW >= 30 && __hwSwappedW <= 200) {
            context.sizeInput = Object.assign({}, context.sizeInput, { height: __hwSwappedH, weight: __hwSwappedW });
        }
    }
}

`;

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nodes = flow.nodes.map((n) => ({ ...n }));
    const nCalc = nodes.find((n) => n.id === 'n_calc');
    if (!nCalc) { console.log(name, 'ERROR: n_calc not found'); return; }
    if (String(nCalc.data.code || '').includes(MARKER)) { console.log(name, 'ALREADY_APPLIED'); return; }

    console.log(name, 'буде вставлено height/weight swap safety-net на початок n_calc.');
    if (!APPLY) return;

    nCalc.data = { ...nCalc.data, code: SNIPPET + nCalc.data.code };
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    // Синтаксична самоперевірка сніпету (як у попередніх патчах).
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + SNIPPET + '\n})();');

    await patchBot('goverla', BOTS.goverla);
    await patchBot('covercar', BOTS.covercar);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
