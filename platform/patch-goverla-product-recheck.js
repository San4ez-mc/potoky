'use strict';
/*
 * Патч воронки «goverla_shop — основний магазин (Zernio)» (bot 5bdb3e38-1936-416f-b1f0-8f1125583193)
 *   Ф0.7  Мітка productUnknownAsk на ноді n_unknown_msg — щоб рушій (testSession.js)
 *         re-check'ав товар у повідомленні ОДРАЗУ, коли клієнт відповідає на "скиньте
 *         пост чи артикул", а не тільки після того, як бот вже формально замовк.
 *
 * ЗАПУСК:  node patch-goverla-product-recheck.js            (dry-run)
 *          node patch-goverla-product-recheck.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOT_ID = '5bdb3e38-1936-416f-b1f0-8f1125583193';
const APPLY = process.argv.includes('--apply');

async function main() {
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }

    const node = flow.nodes.find((n) => n.id === 'n_unknown_msg');
    if (!node) { console.log('ERROR: n_unknown_msg not found'); process.exit(1); }
    if (node.data.productUnknownAsk === true) { console.log('ALREADY_APPLIED'); process.exit(0); }

    const nodes = flow.nodes.map((n) => n.id === 'n_unknown_msg' ? { ...n, data: { ...n.data, productUnknownAsk: true } } : n);
    console.log('Буде позначено n_unknown_msg міткою productUnknownAsk=true.');
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
