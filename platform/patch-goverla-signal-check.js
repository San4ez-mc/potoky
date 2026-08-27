'use strict';
/*
 * Патч воронки «goverla_shop — основний магазин (Zernio)» (bot 5bdb3e38-1936-416f-b1f0-8f1125583193)
 *   Ф0.5  Легкий regex-чек товару ПЕРЕД важким n_lookup (KeyCRM, до 10 сторінок каталогу).
 *         Аудит 2026-08-26: n_lookup бив по KeyCRM на КОЖНЕ повідомлення, навіть на голе
 *         "Привіт" без жодного шансу знайти товар. Додано n_signal_check (js, дешевий
 *         regex по context.lastUserMessage||input: пересланий пост/рілс, артикул, фото) +
 *         n_signal_cond (condition): TRUE (є ознака) → n_lookup як і раніше;
 *         FALSE (смолток/привітання) → одразу n_unknown_msg, без зайвого проходу по каталогу.
 *
 * ЗАПУСК:  node patch-goverla-signal-check.js            (dry-run: лише показує зміни)
 *          node patch-goverla-signal-check.js --apply    (записує у БД, перераховує layout)
 *
 * Ідемпотентний: якщо n_signal_check вже є в графі — нічого не робить.
 */
const { db } = require('@platform/db');
const { computeAutoLayout } = require('@platform/flow-layout');

const BOT_ID = '5bdb3e38-1936-416f-b1f0-8f1125583193';
const APPLY = process.argv.includes('--apply');

const SIGNAL_CHECK_CODE = `var msg = String(context.lastUserMessage || input || '');
var hasPost = !!(context.sharedPost || context.entryAd);
var hasPhoto = !!context.lastUserImageUrl;
// Аудит 2026-08-27: прибрано голий /\\b\\d{4,8}\\b/ — хибно спрацьовував на поштовий
// індекс/ціну/номер відділення (будь-яке окреме 4-8-значне число), спричиняючи
// нескінченний цикл reset->ask на звичайних повідомленнях з адресою чи ціною.
var hasArticleLike = /(?:артикул|арт\\.?|art|код|sku|#|№)\\s*[:#№.\\-]?\\s*[A-Za-zА-Яа-яІЇЄҐіїєґ]{0,5}\\d{2,8}/i.test(msg)
  || /\\b[A-Za-z]\\d{3,6}\\b/.test(msg);
return { hasProductSignal: hasPost || hasPhoto || hasArticleLike };`;

async function main() {
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow for bot', BOT_ID); process.exit(1); }

    if (flow.nodes.some((n) => n.id === 'n_signal_check' || n.id === 'n_signal_cond')) {
        console.log('ALREADY_APPLIED — n_signal_check/n_signal_cond вже в графі, нічого не роблю.');
        process.exit(0);
    }

    let nodes = flow.nodes.map((n) => ({ ...n }));
    let edges = flow.edges.map((e) => ({ ...e }));

    const routeToLookup = edges.find((e) => e.source === 'n_route' && e.target === 'n_lookup');
    if (!routeToLookup) { console.log('ERROR: edge n_route->n_lookup not found — граф змінився, перевір вручну.'); process.exit(1); }

    nodes.push({
        id: 'n_signal_check',
        type: 'js',
        data: {
            label: '0.5 Є ознака товару? (легкий чек)',
            code: SIGNAL_CHECK_CODE,
            description: 'Дешевий regex-чек БЕЗ звернення до KeyCRM: чи є в повідомленні ознака товару (пересланий пост/рілс, артикул, фото). Якщо ознаки нема — пропускаємо важкий n_lookup і одразу йдемо у гілку "товар невідомий" (аудит 2026-08-26).',
        },
        position: { x: 0, y: 0 },
    });
    nodes.push({
        id: 'n_signal_cond',
        type: 'condition',
        data: {
            label: '0.6 Є ознака товару?',
            condition: 'context.hasProductSignal === true',
            description: 'TRUE (є пост/артикул/фото) → важкий n_lookup по KeyCRM як і раніше. FALSE (просте привітання/смолток) → одразу у гілку "товар невідомий" (n_unknown_msg), без зайвого проходу по каталогу.',
        },
        position: { x: 0, y: 0 },
    });

    routeToLookup.target = 'n_signal_check';
    edges.push({ id: 'e_signal_check_cond', source: 'n_signal_check', target: 'n_signal_cond' });
    edges.push({ id: 'e_signal_cond_lookup', source: 'n_signal_cond', target: 'n_lookup', sourceHandle: 'true' });
    edges.push({ id: 'e_signal_cond_unknown', source: 'n_signal_cond', target: 'n_unknown_msg', sourceHandle: 'false' });

    nodes = computeAutoLayout(nodes, edges);

    console.log(`Буде додано 2 ноди (n_signal_check, n_signal_cond) і 3 ребра. Разом: ${nodes.length} нод, ${edges.length} ребер.`);
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply, щоб записати.'); process.exit(0); }

    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes, edges } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
