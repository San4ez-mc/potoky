'use strict';
/*
 * Патч goverla_shop (5bdb3e38-...) — covercar_ua не має n_signal_cond взагалі,
 *   не стосується.
 *
 *   Виявлено тест-прогоном одразу після patch-stale-product-welcome-back.js:
 *   n_signal_cond ("чи є сигнал товару в цьому ході?") — якщо FALSE, веде
 *   ОДРАЗУ в n_unknown_msg ("товар ще не визначено"), МИНАЮЧИ n_lookup і,
 *   відповідно, нові n_prev_match_snapshot/n_returning_check/n_welcome_back
 *   взагалі. Це коректно для СПРАВДІ нового клієнта (товару взагалі нема) —
 *   але для клієнта, який товар УЖЕ визначив раніше (context.product існує),
 *   просте "Вітаб" без сигналу теж падало в n_unknown_msg ("товар ще не
 *   визначено") — так само неправильно, як і стара повна презентація,
 *   просто інша хибна відповідь.
 *
 *   Фікс: n_signal_cond тепер ТАКОЖ веде в n_lookup (а звідти — в новий
 *   n_returning_check), якщо товар УЖЕ відомий, навіть без свіжого сигналу.
 *   Далі n_returning_check сам коректно розведе "є щось нове" від "просто
 *   привітався" (див. patch-stale-product-welcome-back.js).
 *
 * ЗАЛЕЖНІСТЬ: після patch-stale-product-welcome-back.js.
 *
 * ЗАПУСК:  node patch-signal-cond-known-product.js            (dry-run)
 *          node patch-signal-cond-known-product.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOT_ID = '5bdb3e38-1936-416f-b1f0-8f1125583193';
const APPLY = process.argv.includes('--apply');

const OLD_COND = 'context.hasProductSignal === true';
const NEW_COND = "context.hasProductSignal === true || (context.product && context.product.name && String(context.product.name).length > 0)";

async function main() {
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }

    const n = flow.nodes.find((x) => x.id === 'n_signal_cond');
    if (!n) { console.log('ERROR: n_signal_cond not found'); process.exit(1); }

    if (n.data.condition === NEW_COND) { console.log('ALREADY_APPLIED'); process.exit(0); }
    if (n.data.condition !== OLD_COND) { console.log('WARNING: умова відрізняється від очікуваної — перевір вручну:', n.data.condition); process.exit(0); }

    console.log('буде замінено умову n_signal_cond:', OLD_COND, '->', NEW_COND);
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    const nodes = flow.nodes.map((x) => (x.id === 'n_signal_cond' ? { ...x, data: { ...x.data, condition: NEW_COND } } : x));
    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
