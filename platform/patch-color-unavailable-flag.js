'use strict';
/*
 * Патч goverla_shop (5bdb3e38-...) — ЗАВДАННЯ 2 (запит власника, "розумні нагадування"):
 *   Виняток №2 з 4-х — "нема потрібного кольору" НЕ мав жодного структурного
 *   прапорця (на відміну від sizeOutOfRange, який вже виставляє n_calc/n_size_oor
 *   ланцюжок). context.colorChoice лише зберігав ОБРАНИЙ колір — жодної ознаки
 *   "клієнт хотів колір, якого нема в наявності" не існувало, тож
 *   checkZernioReminders (worker) не міг це врахувати й продовжував слати
 *   нагадування клієнту, якому просто нема чого запропонувати.
 *
 *   Фікс у двох частинах:
 *   1) ЦЕЙ патч — n_color (claude, dialog) системний промпт: явна інструкція —
 *      якщо клієнт називає колір ПОЗА списком доступних, НЕ підтверджувати його
 *      як "color", а повернути {"colorUnavailable":true} і чесно назвати РЕАЛЬНІ
 *      кольори з каталогу як альтернативу.
 *   2) apps/api/src/services/testSession.js (окремий коміт) — движок
 *      УНІВЕРСАЛЬНО (не лише для n_color — будь-яка claude dialog-нода) читає
 *      exit.parsed.colorUnavailable/exit.parsed.color і промотує в
 *      context.colorUnavailable (root-рівень, той самий патерн, що вже є для
 *      exit.parsed.handoff) — так worker бачить прапорець без прив'язки до
 *      outputVar конкретної ноди.
 *
 * ЗАПУСК:  node patch-color-unavailable-flag.js            (dry-run)
 *          node patch-color-unavailable-flag.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOT_ID = '5bdb3e38-1936-416f-b1f0-8f1125583193'; // goverla_shop
const APPLY = process.argv.includes('--apply');

const OLD_LINE = 'КЛІЄНТ ОБИРАЄ КОЛІР. Доступні кольори: {{context.product.colors}}.';
const NEW_BLOCK = `КЛІЄНТ ОБИРАЄ КОЛІР. Доступні кольори: {{context.product.colors}}.
ЯКЩО клієнт називає колір, якого НЕМАЄ у списку доступних кольорів вище (напр. просить "зелений", а в списку лише чорний/сірий) — НЕ підтверджуй цей колір і НЕ додавай "color" у json_output. Чесно скажи, що саме цього кольору немає в наявності, і одразу назви РЕАЛЬНІ доступні кольори зі списку вище як альтернативу — можливо, клієнту підійде один з них. Додай у json_output РІВНО {"colorUnavailable":true} (без color). Якщо клієнт після цього обирає колір ІЗ наявних — далі як завжди: підтверди й поверни {"color":"<колір>"}.`;

async function main() {
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }
    const node = flow.nodes.find((n) => n.id === 'n_color');
    if (!node) { console.log('ERROR: n_color not found'); process.exit(1); }

    const prompt = String(node.data.systemPrompt || '');
    if (prompt.indexOf('colorUnavailable') >= 0) { console.log('ALREADY_APPLIED'); process.exit(0); }
    if (prompt.indexOf(OLD_LINE) < 0) { console.log('ERROR: anchor line not found — промпт міг змінитись, патч застарів'); process.exit(1); }

    const newPrompt = prompt.replace(OLD_LINE, NEW_BLOCK);
    console.log('Буде оновлено n_color.systemPrompt (+', newPrompt.length - prompt.length, 'символів).');
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    const newNodes = flow.nodes.map((n) => n.id === 'n_color' ? { ...n, data: { ...n.data, systemPrompt: newPrompt } } : n);
    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes: newNodes } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
