'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Живий кейс (covercar_ua, mashadelrey, 2026-08-29): Telegram-сигнал "БОТ НЕ
 *   ВИЗНАЧИВ ТОВАР" знову прийшов з порожнім "Останнє:", хоча раніший патч
 *   (patch-fix-lastusermessage-template.js) вже виправив ШЛЯХ шаблону
 *   ({{context.lastUserMessage}} -> {{context.flowRuntime.lastUserMessage}}).
 *
 *   Справжня причина — НЕ шлях, а ЖИТТЄВИЙ ЦИКЛ: n_unknown_admin (notifyTg) у
 *   каскаді йде ПІСЛЯ n_unknown_msg (claude) в ТОМУ Ж ході. Claude-ноди
 *   СВІДОМО чистять runtime.lastUserMessage='' одразу після споживання
 *   повідомлення (щоб наступна нода того ж ходу не обробила його ще раз) —
 *   тож до notifyTg, що рендериться ТРЕТІМ у каскаді, уже нічого не лишалось.
 *
 *   Фікс (двигун, testSession.js, окремий комміт): ctx.lastCustomerMessage —
 *   стабільний знімок на початку ходу, який жодна нода каскаду не чистить.
 *   Цей патч — друга половина: переключає САМ ШАБЛОН нод на цей новий,
 *   стабільний шлях.
 *
 * ЗАЛЕЖНІСТЬ: разом з testSession.js (ctx.lastCustomerMessage) — без нього
 *             поле буде порожнім за іншою причиною (не існує).
 *
 * ЗАПУСК:  node patch-fix-lastusermessage-lifecycle.js            (dry-run)
 *          node patch-fix-lastusermessage-lifecycle.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const OLD = '{{context.flowRuntime.lastUserMessage}}';
const NEW = '{{context.lastCustomerMessage}}';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const n = flow.nodes.find((x) => x.id === 'n_unknown_admin');
    if (!n) { console.log(name, 'ERROR: n_unknown_admin not found'); return; }

    if (n.data.message.includes(NEW)) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!n.data.message.includes(OLD)) { console.log(name, 'WARNING: анкор не знайдено — перевір вручну.'); return; }

    console.log(name, 'буде замінено', OLD, '->', NEW, 'у n_unknown_admin.message.');
    if (!APPLY) return;

    const nodes = flow.nodes.map((x) => (x.id === 'n_unknown_admin' ? { ...x, data: { ...x.data, message: x.data.message.split(OLD).join(NEW) } } : x));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
