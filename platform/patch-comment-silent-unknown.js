'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Ф1.8  Запит користувача: коментарі, по яких не визначено товар, продовжують
 *   надсилати клієнту DM "⚙️ Воронка перезапущена (тестовий режим) — можете
 *   почати заново" — щоразу, коли клієнт лишає ЩЕ один нерозпізнаний коментар.
 *   Це виглядає як спам роботизованих DM у відповідь на звичайні emoji-реакції.
 *
 *   Корінь: n_have_product[false] → n_unknown_msg (шле повний DM-текст
 *   "скиньте пост/артикул") → ... → n_unknown_stop (testRestartAfter шле ЩЕ
 *   один DM "Воронка перезапущена"). Цей ланцюжок писався для DM, де клієнт
 *   РЕАЛЬНО ставить питання. Для коментаря клієнт нічого не питав у директ —
 *   він лишив коментар, і n_comment_entry вже відповів ЙОМУ САМЕ під коментарем
 *   (публічно). Жодного DM після цього надсилати НЕ треба.
 *
 *   Фікс: нова нода n_have_product_gate (condition, !context.commentId) ПЕРЕД
 *   n_unknown_msg. TRUE (звичайний DM) → n_unknown_msg як і раніше (без змін).
 *   FALSE (прийшло з коментаря) → n_comment_unknown_silent (новий, js): тихо
 *   ставить adminEngaged/handoffKind, НЕ шле жодного DM-повідомлення. Тестовий
 *   рестарт ТЕЖ не спрацьовує тут (нема testRestartAfter) — і не треба: клієнт
 *   не почав DM-розмову, нема що "рестартити" з його погляду.
 *
 * ЗАПУСК:  node patch-comment-silent-unknown.js            (dry-run)
 *          node patch-comment-silent-unknown.js --apply    (записує у БД)
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

    const already = flow.nodes.some((n) => n.id === 'n_have_product_gate');
    if (already) { console.log(name, 'ALREADY_APPLIED'); return; }

    const oldEdge = flow.edges.find((e) => e.source === 'n_have_product' && e.target === 'n_unknown_msg');
    if (!oldEdge) { console.log(name, 'ERROR: n_have_product->n_unknown_msg ребро не знайдено'); return; }

    console.log(name, 'буде додано n_have_product_gate + n_comment_unknown_silent.');
    if (!APPLY) return;

    let nodes = flow.nodes.map((n) => ({ ...n }));
    let edges = flow.edges.map((e) => ({ ...e }));

    nodes.push({
        id: 'n_have_product_gate', type: 'condition', position: { x: 0, y: 0 },
        data: {
            label: '1.5 Товар не визначено — це DM чи коментар?',
            condition: '!context.commentId',
            description: 'TRUE (звичайний DM) → n_unknown_msg, просимо пост/артикул. FALSE (прийшло з коментаря) → тихо, без DM — коментар уже отримав власну відповідь.',
        },
    });
    nodes.push({
        id: 'n_comment_unknown_silent', type: 'js', position: { x: 0, y: 0 },
        data: {
            label: '1.6 Тиша (коментар без товару)',
            code: "return { adminEngaged: true, handoffKind: 'product_unknown' };",
            description: 'Коментар не визначив товар — жодного DM клієнту не шлемо (публічна відповідь уже пішла через n_comment_entry). Сесія паузиться так само, як і DM-гілка — відновиться, якщо клієнт сам пришле артикул/пост.',
        },
    });

    edges = edges.filter((e) => !(e.source === 'n_have_product' && e.target === 'n_unknown_msg'));
    edges.push({ ...oldEdge, id: 'e_have_product_gate', target: 'n_have_product_gate' });
    edges.push({ id: 'e_have_product_gate_true', source: 'n_have_product_gate', target: 'n_unknown_msg', sourceHandle: 'true' });
    edges.push({ id: 'e_have_product_gate_false', source: 'n_have_product_gate', target: 'n_comment_unknown_silent', sourceHandle: 'false' });

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
