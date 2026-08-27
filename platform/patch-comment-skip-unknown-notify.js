'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Ф1.7  Запит користувача: коментарі, по яких не визначено товар (типово —
 *   emoji-реакції, загальні коментарі без конкретики), НЕ повинні слати
 *   Telegram-сигнал "БОТ НЕ ВИЗНАЧИВ ТОВАР — опрацюйте вручну" — це для DM,
 *   де клієнт РЕАЛЬНО хоче конкретний товар. Для коментарів це просто шум:
 *   бот вже й так відповість на сам коментар (n_comment_entry), додаткове
 *   втручання менеджера не потрібне щоразу.
 *
 *   Нова нода n_unknown_notify_gate (condition) вставлена МІЖ n_unknown_msg і
 *   n_unknown_admin: TRUE (!context.commentId, тобто звичайний DM) → сповіщення
 *   як і раніше; FALSE (є commentId, тобто прийшли з коментаря) → одразу на
 *   n_unknown_stop, без сигналу в Telegram.
 *
 * ЗАПУСК:  node patch-comment-skip-unknown-notify.js            (dry-run)
 *          node patch-comment-skip-unknown-notify.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const { computeAutoLayout } = require('@platform/flow-layout');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const already = flow.nodes.some((n) => n.id === 'n_unknown_notify_gate');
    if (already) { console.log(name, 'ALREADY_APPLIED'); return; }
    console.log(name, 'буде додано n_unknown_notify_gate.');
    if (!APPLY) return;

    let nodes = flow.nodes.map((n) => ({ ...n }));
    let edges = flow.edges.map((e) => ({ ...e }));

    nodes.push({
        id: 'n_unknown_notify_gate', type: 'condition', position: { x: 0, y: 0 },
        data: {
            label: '1c.5 Це коментар (не DM)?',
            condition: '!context.commentId',
            description: 'TRUE (звичайний DM) → сигнал менеджеру як завжди. FALSE (прийшло з коментаря) → пропустити сигнал, коментар уже отримав власну відповідь (n_comment_entry).',
        },
    });
    edges = edges.filter((e) => !(e.source === 'n_unknown_msg' && e.target === 'n_unknown_admin'));
    edges.push({ id: 'e_unknown_gate_in', source: 'n_unknown_msg', target: 'n_unknown_notify_gate' });
    edges.push({ id: 'e_unknown_gate_true', source: 'n_unknown_notify_gate', target: 'n_unknown_admin', sourceHandle: 'true' });
    edges.push({ id: 'e_unknown_gate_false', source: 'n_unknown_notify_gate', target: 'n_unknown_stop', sourceHandle: 'false' });

    nodes = computeAutoLayout(nodes, edges);
    await db.flowDefinition.update({ where: { botId }, data: { nodes, edges } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
