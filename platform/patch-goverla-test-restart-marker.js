'use strict';
/*
 * Патч воронки «goverla_shop — основний магазин (Zernio)» (bot 5bdb3e38-1936-416f-b1f0-8f1125583193)
 *   Ф0.8  Мітка testRestartAfter на ноді n_unknown_stop — конкретна реалізація
 *         універсального прапорця тестового рестарту (запит користувача 2026-08-27).
 *         n_unknown_stop — єдина точка в цій воронці, де бот ЗАВЖДИ ставить
 *         adminEngaged=true (пауза, кличемо менеджера) ПІСЛЯ того, як клієнту вже
 *         пішло повідомлення (n_unknown_msg) і сповіщення в Telegram (n_unknown_admin).
 *         Коли bot.settings.testMode===true — рушій (testSession.js) після цієї ноди
 *         автоматично скидає сесію на старт і шле тестувальнику "воронка перезапущена".
 *
 *         НЕ покриває: keyword-хендоф ("менеджер"/"оператор" в тексті) і inline
 *         {"handoff":true} з n_color/n_order_intent — це логіка ВСЕРЕДИНІ діалог-нод,
 *         не окрема нода, тож мітку нема на що вішати без ширшої переробки.
 *
 * ЗАПУСК:  node patch-goverla-test-restart-marker.js            (dry-run)
 *          node patch-goverla-test-restart-marker.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOT_ID = '5bdb3e38-1936-416f-b1f0-8f1125583193';
const APPLY = process.argv.includes('--apply');

async function main() {
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }

    const node = flow.nodes.find((n) => n.id === 'n_unknown_stop');
    if (!node) { console.log('ERROR: n_unknown_stop not found'); process.exit(1); }
    if (node.data.testRestartAfter === true) { console.log('ALREADY_APPLIED'); process.exit(0); }

    const nodes = flow.nodes.map((n) => n.id === 'n_unknown_stop' ? { ...n, data: { ...n.data, testRestartAfter: true } } : n);
    console.log('Буде позначено n_unknown_stop міткою testRestartAfter=true.');
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
