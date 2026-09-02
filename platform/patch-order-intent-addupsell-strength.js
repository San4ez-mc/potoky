'use strict';
/*
 * Регресійний прогін 2026-09-03 (фінальна перевірка перед свапом трафіку на нову CRM)
 * знайшов дві прогалини у "структурованому допродажі" (n_order_intent addUpsell),
 * доданому вчора (commit 9460285/946029584, patch-clone-crm-integration.js):
 *
 *   1) covercar_ua (a2d5ba79-...) НІКОЛИ не отримав інструкцію addUpsell взагалі —
 *      patch-clone-crm-integration.js шукав анкор "Це НЕ фото основного товару —
 *      не плутай з ready/color." у n_order_intent, якого в covercar_ua просто нема
 *      (текст ноди на цьому боті вже відрізнявся від goverla_shop на момент патчу) —
 *      .split(anchor).join(...) тихо нічого не зробив (антипатерн A10/A9: "успіх
 *      патча визначався на око", а не перевіркою реального застосування на КОЖНОМУ
 *      боті окремо). Наслідок: на covercar_ua клієнт міг явно погодитись на допродаж
 *      ("так, додайте") — а n_crm_order все одно створював замовлення з ОДНІЄЮ
 *      позицією, без допродажу.
 *   2) Навіть на goverla_shop (де інструкція БУЛА) — живий 10-сценарний прогін
 *      показав: рівно та сама фраза-приклад із промпту, "так, додайте", у 2 з 2
 *      живих спроб НЕ проставляла addUpsell:true (модель зрозуміла "так" як згоду на
 *      ОФОРМЛЕННЯ (ready:yes), проігнорувавши частину "додайте"). Довші фрази
 *      ("беру і футболку теж", "давайте обидва") спрацьовували стабільно 2/2.
 *      Підсилюємо інструкцію: явно кажемо, що БУДЬ-ЯКЕ коротке підтвердження
 *      (навіть одне слово "так"/"да"/"ок"/"добре"/"+") ОДРАЗУ після пропозиції
 *      допродажу — це згода на допродаж, не лише розгорнуті фрази.
 *
 * Анкор для ОБОХ ботів — рядок про handoff/поза даними, який є в n_order_intent
 * БЕЗ ВАРІАЦІЙ на обох клонах (звірено напряму з БД перед написанням патча):
 *   'ЯКЩО клієнт ЯВНО просить живу людину/менеджера, або питання СПРАВДІ поза даними
 *   (гарантія, міжнародна доставка, знижки, претензія, скарга) — одразу поверни
 *   json_output {"handoff":true} (без ready).'
 *
 * Ідемпотентний (точна рівність фінального тексту — не .includes(маркер), урок
 * "Ідемпоінтність, батч-reject" 2026-08). ЗАПУСК:
 *   node patch-order-intent-addupsell-strength.js            (dry-run)
 *   node patch-order-intent-addupsell-strength.js --apply    (записує у БД)
 */
const { db } = require('@platform/db');

const APPLY = process.argv.includes('--apply');

const BOTS = {
    goverlaClone: 'fcdee415-bef2-4a74-a650-e6e4b5a12322',
    covercarClone: 'a2d5ba79-f87b-48f2-8301-56292cdf3972',
};

const HANDOFF_ANCHOR = 'ЯКЩО клієнт ЯВНО просить живу людину/менеджера, або питання СПРАВДІ поза даними (гарантія, міжнародна доставка, знижки, претензія, скарга) — одразу поверни json_output {"handoff":true} (без ready).';

// Стара (слабка) версія — вже застосована на goverla_shop учора, замінюємо на сильнішу.
const OLD_ADDUPSELL = 'ЯКЩО клієнт ЯВНО погодився ДОДАТИ запропонований допродаж до замовлення ("так, додайте", "беру і футболку", "давайте обидва", "додайте це теж") — до того самого json_output (разом з ready:yes, якщо згода на оформлення теж вже прозвучала) додай ще поле "addUpsell":true. Якщо клієнт НЕ погоджувався на допродаж, ще не відповів на пропозицію, або відмовився — НЕ додавай це поле.';

// Нова (сильніша) версія — явно охоплює короткі однослівні підтвердження одразу
// після пропозиції допродажу (живий тест: "так, додайте" 2/2 не спрацювало зі
// старим текстом, "давайте обидва"/"беру і футболку теж" — 2/2 спрацювало).
const NEW_ADDUPSELL = 'ЯКЩО В ОДНОМУ З ПОПЕРЕДНІХ ХОДІВ ти (бот) пропонував допродаж ("До цього товару часто беруть...", "Додати до замовлення?", "Додамо?") і клієнт відповідає ЩО-БУДЬ схоже на згоду — НАВІТЬ ОДНИМ КОРОТКИМ СЛОВОМ ("так", "да", "ок", "добре", "+", "давай", "додайте") одразу після цієї пропозиції — це ЗАВЖДИ згода на допродаж: додай до json_output поле "addUpsell":true (разом з ready:yes, якщо згода на саме оформлення теж вже прозвучала десь у діалозі). Приклади згоди: "так, додайте", "беру і футболку теж", "давайте обидва", "додайте це теж", і просто "так"/"добре"/"+", сказане одразу після пропозиції допродажу. Якщо клієнт НЕ погоджувався на допродаж, ще не відповів на пропозицію, або явно відмовився — НЕ додавай це поле.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }
    const node = flow.nodes.find((n) => n.id === 'n_order_intent');
    if (!node) { console.log(name, 'ERROR: n_order_intent not found'); return; }
    const prompt = node.data.systemPrompt || '';

    const alreadyNew = prompt.includes(NEW_ADDUPSELL);
    const hasOld = prompt.includes(OLD_ADDUPSELL);
    const hasAnchor = prompt.includes(HANDOFF_ANCHOR);

    let action = 'NOOP (already applied)';
    let newPrompt = prompt;
    if (!alreadyNew && hasOld) {
        action = 'REPLACE (weak addUpsell -> strong)';
        newPrompt = prompt.split(OLD_ADDUPSELL).join(NEW_ADDUPSELL);
    } else if (!alreadyNew && !hasOld && hasAnchor) {
        action = 'INSERT (after handoff anchor)';
        newPrompt = prompt.split(HANDOFF_ANCHOR).join(HANDOFF_ANCHOR + ' ' + NEW_ADDUPSELL);
    } else if (!alreadyNew) {
        action = 'WARNING: no anchor found, manual fix needed';
    }
    console.log(name, botId, action);
    if (!APPLY) return;
    if (action.startsWith('REPLACE') || action.startsWith('INSERT')) {
        const nodes = flow.nodes.map((n) => n.id === 'n_order_intent' ? { ...n, data: { ...n.data, systemPrompt: newPrompt } } : n);
        await db.flowDefinition.update({ where: { botId }, data: { nodes } });
        console.log(name, 'APPLIED.');
    }
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
