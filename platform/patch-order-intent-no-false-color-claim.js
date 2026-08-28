'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Виявлено живим QA тест-прогоном (2026-08-28): 5 товарів (накидки/подушки/
 *   органайзер/комплект) мають кольори ЛИШЕ текстом в описі, без окремих
 *   offer-варіантів кольору в KeyCRM. n_has_colors (умова:
 *   String(product.colors||'').trim().length>0) для них FALSE — n_color
 *   ЗАКОНОМІРНО пропускається (нема з чого обирати структуровано). Але
 *   n_order_intent досі БЕЗУМОВНО стверджував "Клієнт визначився з товаром і
 *   кольором" + інтерполював {{context.colorChoice.color}} (порожній рядок,
 *   бо колір ніколи не питали) — модель отримувала ХИБНУ передумову, що могло
 *   підживлювати плутанину/хибні відмови для таких товарів.
 *
 *   Фікс: НЕ стверджуємо категорично, що колір узгоджено — даємо моделі явний
 *   дозвіл просто НЕ згадувати колір, якщо його не було в діалозі (шаблон-рушій
 *   не підтримує умовних {{#if}}, тому переформулювання, а не логіка).
 *
 * ЗАПУСК:  node patch-order-intent-no-false-color-claim.js            (dry-run)
 *          node patch-order-intent-no-false-color-claim.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const OLD = 'Товар: {{context.product.customerName}} — {{context.product.price}} грн, колір {{context.colorChoice.color}}. Клієнт визначився з товаром і кольором. НЕ вигадуй розміри/характеристики.';
const NEW = 'Товар: {{context.product.customerName}} — {{context.product.price}} грн (колір, ЯКЩО вже узгоджено раніше в діалозі: {{context.colorChoice.color}} — а якщо це поле порожнє, значить колір НЕ узгоджували, просто не згадуй колір узагалі, це нормально для товарів без варіантів кольору). Клієнт готовий переходити до оформлення. НЕ вигадуй розміри/характеристики/колір, яких не було в діалозі.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const n = flow.nodes.find((x) => x.id === 'n_order_intent');
    if (!n) { console.log(name, 'ERROR: n_order_intent not found'); return; }

    const sp = n.data.systemPrompt || '';
    if (sp.includes(NEW)) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!sp.includes(OLD)) { console.log(name, 'WARNING: анкор не знайдено — перевір вручну.'); return; }

    console.log(name, 'буде замінено твердження про колір у n_order_intent.');
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
