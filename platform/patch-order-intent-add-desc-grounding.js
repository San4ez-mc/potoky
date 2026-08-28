'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Продовження QA-розслідування (2026-08-28): навіть після trust-інструкції +
 *   зняття хибного твердження про колір, n_order_intent ДЛЯ ТОВАРІВ, що
 *   стрибають одразу з n_welcome в n_order_intent (без n_color/n_set_choice
 *   між ними — короткий шлях для товарів без offer-кольорів), досі іноді
 *   каже "не знаходжу артикул". Гіпотеза: на відміну від n_color/n_set_choice
 *   (де ВЖЕ є {{context.product.desc}} у промпті), n_order_intent отримує
 *   лише customerName+price — недостатньо "заземлення", щоб модель впевнено
 *   повʼязала відповідь із конкретним товаром, коли клієнт написав голий код.
 *   Товари, що проходять довший шлях (n_color тощо), мають цю прив'язку вже
 *   встановленою в попередньому ході — короткий шлях її не отримує взагалі.
 *
 *   Фікс: додати {{context.product.desc}} в анкор n_order_intent — той самий
 *   рівень контексту, що вже є в n_color/n_set_choice.
 *
 * ЗАПУСК:  node patch-order-intent-add-desc-grounding.js            (dry-run)
 *          node patch-order-intent-add-desc-grounding.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const OLD = 'Товар: {{context.product.customerName}} — {{context.product.price}} грн (колір, ЯКЩО вже узгоджено раніше в діалозі: {{context.colorChoice.color}} — а якщо це поле порожнє, значить колір НЕ узгоджували, просто не згадуй колір узагалі, це нормально для товарів без варіантів кольору). Клієнт готовий переходити до оформлення. НЕ вигадуй розміри/характеристики/колір, яких не було в діалозі.';
const NEW = 'Товар: {{context.product.customerName}} — {{context.product.price}} грн. Опис товару (для твого контексту, не цитуй дослівно як список): {{context.product.desc}}\n(колір, ЯКЩО вже узгоджено раніше в діалозі: {{context.colorChoice.color}} — а якщо це поле порожнє, значить колір НЕ узгоджували, просто не згадуй колір узагалі, це нормально для товарів без варіантів кольору). Клієнт готовий переходити до оформлення. НЕ вигадуй розміри/характеристики/колір, яких не було в діалозі.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const n = flow.nodes.find((x) => x.id === 'n_order_intent');
    if (!n) { console.log(name, 'ERROR: n_order_intent not found'); return; }

    const sp = n.data.systemPrompt || '';
    if (sp.includes(NEW)) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!sp.includes(OLD)) { console.log(name, 'WARNING: анкор не знайдено — перевір вручну.'); return; }

    console.log(name, 'буде додано product.desc у n_order_intent.');
    if (!APPLY) return;

    const nodes = flow.nodes.map((x) => (x.id === 'n_order_intent' ? { ...x, data: { ...x.data, systemPrompt: sp.replace(OLD, NEW) } } : x));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
