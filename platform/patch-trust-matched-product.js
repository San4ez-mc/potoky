'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Виявлено живим тест-прогоном (QA після Ф-продукт-презентація, 2026-08-28):
 *   n_lookup ПРАВИЛЬНО знаходить товар (напр. "артикул set001", "артикул 50003"),
 *   context.product заповнюється коректно (customerName/desc/category_id/isSet —
 *   усе на місці) — АЛЕ наступна claude-нода (n_order_intent/n_set_choice, іноді
 *   й n_size/n_color) в ОДНОМУ Ж ходу іноді сама "перевіряє" артикул проти
 *   ВИДИМОГО тексту desc — і якщо desc НЕ повторює дослівно введений клієнтом
 *   код (типово для товарів, де опис НЕ починається з "Артикул XXXX", напр.
 *   комплекти/аксесуари з описом типу "В наявності 8 кольорів:") — модель
 *   ГАЛЮЦИНУЄ "вибачте, артикул не знаходжу" клієнту, хоча система ВЖЕ знайшла
 *   товар. Підтверджено: лофери (desc містить "Артикул 5931") — ОК; комплект
 *   set001 і подушка 50003 (desc НЕ містить код) — хибна відмова "не знаходжу".
 *   Це втрачені продажі — не помилка ЦІЄЇ сесії правок, а існуюча вразливість,
 *   яку систематичний тест-прогін щойно виявив.
 *
 *   Фікс: одне явне речення одразу після опису товару в 4 клієнтських нодах
 *   (n_size, n_color, n_order_intent, n_set_choice) — "товар уже підтверджено
 *   системою, ніколи не пиши що не знайдено". Не змінює жодної іншої логіки.
 *
 * ЗАПУСК:  node patch-trust-matched-product.js            (dry-run)
 *          node patch-trust-matched-product.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const TRUST_LINE = '⚠️ Товар вище вже ОДНОЗНАЧНО підтверджено системою за артикулом/кодом, який назвав клієнт — НІКОЛИ не пиши, що товар/артикул "не знайдено" чи "немає в каталозі", навіть якщо точний код не видно в описі нижче. Завжди довіряй даним про товар вище.';

const TARGETS = {
    n_size: {
        anchor: 'ТОВАР: {{context.product.customerName}} — {{context.product.price}} грн. {{context.product.desc}}. Кольори: {{context.product.colors}}.',
    },
    n_color: {
        anchor: 'Ти — {{env.PERSONA_NAME}}, жива тепла продавчиня-консультантка {{env.SHOP_TAG}}. Товар: {{context.product.customerName}} ({{context.product.desc}}), ціна {{context.product.price}} грн.',
    },
    n_order_intent: {
        anchor: 'Ти — тепла консультантка {{env.SHOP_TAG}}. Товар: {{context.product.customerName}} — {{context.product.price}} грн, колір {{context.colorChoice.color}}. Клієнт визначився з товаром і кольором. НЕ вигадуй розміри/характеристики.',
    },
    n_set_choice: {
        anchor: 'Ти — {{env.PERSONA_NAME}}, тепла продавчиня {{env.SHOP_TAG}}. Клієнт цікавиться КОМПЛЕКТОМ: {{context.product.customerName}} — {{context.product.price}} грн (фіксована ціна за весь набір).',
    },
};

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    let anyChange = false;
    const report = [];
    const nodes = flow.nodes.map((n) => {
        const target = TARGETS[n.id];
        if (!target) return n;
        const sp = n.data.systemPrompt || '';
        if (sp.includes(TRUST_LINE)) { report.push(n.id + ':already'); return n; }
        if (!sp.includes(target.anchor)) { report.push(n.id + ':ANCHOR_NOT_FOUND'); return n; }
        anyChange = true;
        report.push(n.id + ':will_patch');
        return { ...n, data: { ...n.data, systemPrompt: sp.replace(target.anchor, target.anchor + '\n' + TRUST_LINE) } };
    });

    console.log(name, report.join(', '));
    if (!anyChange) { console.log(name, 'ALREADY_APPLIED / нічого змінювати.'); return; }
    if (!APPLY) return;

    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
