'use strict';
/*
 * Патч воронки «goverla_shop — основний магазин (Zernio)» (bot 5bdb3e38-1936-416f-b1f0-8f1125583193)
 *   Ф1.1  "Зависання" воронки, коли клієнт кидає НОВИЙ товар без явного артикулу
 *         (питання користувача 2026-08-27: "якщо людина не якийсь час, а потім
 *         кидає товар, або сьогодні про одне, а завтра — новий, чи воронка спочатку
 *         зависна?").
 *
 *   Підтверджено живим прогоном: сесія БЕЗ TTL завжди підхоплюється повторно (навіть
 *   через дні), і якщо клієнт застряг на кроці типу n_collect (адреса ВЧОРАШНЬОГО
 *   товару), а СЬОГОДНІ пересилає НОВИЙ пост/рілс БЕЗ артикулу в тексті ("хочу такий
 *   бомбер 🔥") — раніше зроблена перевірка перемикання товару (testSession.js) ловила
 *   ЛИШЕ явний артикул у тексті. Новий sharedPost вона ігнорувала, тож нода n_collect
 *   намагалась "консультувати" по новому товару, тримаючи в контексті СТАРИЙ product і
 *   currentNode — відповідь виглядала правдоподібно, але воронка фактично стояла.
 *
 *   n_lookup тепер стемпить у product._matchedSharedPostId / _matchedEntryAd, ЯКИЙ
 *   саме sharedPost/ad діяв на момент визначення товару. Генерична перевірка в
 *   testSession.js (двигун, без патчу — спільний код) звіряє це з АКТУАЛЬНИМ
 *   ctx.sharedPost/entryAd на кожному наступному повідомленні незалежно від артикулу в
 *   тексті — якщо з'явився НОВИЙ пост/ad, скидає на старт так само, як явний артикул.
 *
 * Перевірено live-тестом (2026-08-27): сесія застигла на n_collect з товаром "Лофери
 * 5931", клієнт пересилає рілс з бомбером БЕЗ артикулу в підписі → сесія коректно
 * скидається на старт, n_lookup підхоплює НОВИЙ товар (замість того, щоб n_collect
 * плутано "консультував" про бомбер, тримаючи контекст лоферів).
 *
 * ЗАПУСК:  node patch-goverla-product-switch-signal.js            (dry-run)
 *          node patch-goverla-product-switch-signal.js --apply    (записує у БД)
 *
 * Ідемпотентний. Потребує testSession.js з відповідним engine-фіксом (спільний код,
 * задеплоєний окремо через git, без патч-файлу).
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOT_ID = '5bdb3e38-1936-416f-b1f0-8f1125583193';
const APPLY = process.argv.includes('--apply');

const NEW_CODE = fs.readFileSync(path.join(__dirname, 'n_lookup-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

async function main() {
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + NEW_CODE + '\n})();');

    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }
    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    if (!nLookup) { console.log('ERROR: n_lookup not found'); process.exit(1); }

    const done = nLookup.data.code.includes('_matchedSharedPostId');
    if (done) { console.log('ALREADY_APPLIED'); process.exit(0); }

    console.log('Буде оновлено n_lookup (додано _matchedSharedPostId/_matchedEntryAd).');
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    const nodes = flow.nodes.map((n) => n.id === 'n_lookup' ? { ...n, data: { ...n.data, code: NEW_CODE } } : n);
    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
