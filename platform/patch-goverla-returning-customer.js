'use strict';
/*
 * Патч воронки «goverla_shop — основний магазин (Zernio)» (bot 5bdb3e38-1936-416f-b1f0-8f1125583193)
 *   Ф1.2  Повторний клієнт: підтягувати зріст/вагу + дані доставки з ОСТАННЬОГО
 *         завершеного замовлення, пропускати обидва питання і показувати одразу
 *         одне повідомлення "оформляємо як минулого разу, підтвердіть чи
 *         скоригуйте" (ідея користувача 2026-08-27, обраний варіант "пропускати
 *         обидва питання").
 *
 *   Lookup (звідки беруться дані) — engine-рівень, testSession.js (спільний код,
 *   без патчу): якщо в потоці є нода n_recall_cond, одноразово за сесію шукає
 *   ОСТАННЮ сесію ЦЬОГО Ж клієнта в ЦІЙ ЖЕ воронці з context.crmOrderId (тобто
 *   реально завершене замовлення) і кладе її orderData/sizeInput у
 *   context.returningCustomerData.
 *
 *   НОВІ ноди (гілка "0.5"):
 *   - n_recall_cond (condition) — чи є returningCustomerData? Вставлена ПЕРЕД
 *     n_is_clothing (перехоплює обидва входи: n_is_set[false], n_set_apply).
 *     FALSE → n_is_clothing як і раніше (новий/невідомий клієнт — без змін).
 *   - n_recall_confirm (claude) — показує зріст/вагу + ПІБ/телефон/місто/відділення
 *     з минулого разу, питає підтвердити чи скоригувати.
 *   - n_recall_apply (js) — зливає підтверджені/скориговані дані в
 *     context.sizeInput і context.orderData, ставить recalledDeliveryReady.
 *   - n_recall_isclothing_cond (condition) — той самий тест isClothing, що і
 *     n_is_clothing, але TRUE веде ОДРАЗУ в n_calc (пропускаючи n_size — зріст/вага
 *     вже є), FALSE — в n_has_colors (колір все одно товаро-специфічний, питаємо
 *     як завжди).
 *   - n_collect_skip_cond (condition) — чи recalledDeliveryReady? Вставлена ПЕРЕД
 *     n_collect (перехоплює всі 4 входи: n_req_sum, n_np_ask, n_requisites,
 *     n_trust_confirm_msg). TRUE → n_np_check напряму (той самий шлях, що й
 *     n_collect_route у гілці "false", тобто "адреса вже є, ідемо перевіряти Нову
 *     Пошту"). FALSE → n_collect як і раніше.
 *
 * ЗАПУСК:  node patch-goverla-returning-customer.js            (dry-run)
 *          node patch-goverla-returning-customer.js --apply    (записує у БД)
 *
 * Ідемпотентний. Потребує testSession.js з recall-lookup (спільний код,
 * задеплоєний окремо через git, без патчу).
 */
const { db } = require('@platform/db');
const { computeAutoLayout } = require('@platform/flow-layout');

const BOT_ID = '5bdb3e38-1936-416f-b1f0-8f1125583193';
const APPLY = process.argv.includes('--apply');

const IS_CLOTHING_COND = 'context.product && context.product.isClothing';

const N_RECALL_CONFIRM_PROMPT = `Клієнт УЖЕ замовляв у нас раніше в цій воронці. Радо привітай поверненню (коротко, тепло, доречний емодзі) і одразу покажи, що ми пам'ятаємо його дані:
Зріст/вага: {{context.returningCustomerData.height}} см / {{context.returningCustomerData.weight}} кг.
Доставка: {{context.returningCustomerData.fullName}}, {{context.returningCustomerData.phone}}, {{context.returningCustomerData.city}}, відділення {{context.returningCustomerData.branch}}.
(Якщо якогось поля тут порожньо — просто не згадуй його, не вигадуй.)
Запитай: «Оформляємо як минулого разу, чи щось потрібно поправити?»
ПРАВИЛА:
1. Якщо клієнт підтверджує (так/вірно/як завжди/все ок/погоджуюсь/+) — поверни РІВНО json_output {"confirmed":true} без жодного тексту.
2. Якщо клієнт хоче ЩОСЬ ПОПРАВИТИ і одразу називає нові дані (нову адресу, зріст/вагу тощо) — розпізнай, які САМЕ поля змінились, і поверни json_output з ЛИШЕ зміненими полями серед {"height":<см>,"weight":<кг>,"fullName":"...","phone":"...","city":"...","branch":"..."} ПЛЮС "confirmed":true, якщо після змін достатньо даних для продовження.
3. Якщо клієнт сказав ЩО хоче поправити, але не дав нових даних (напр. «адресу треба іншу») — тепло уточни, що саме змінилось, ЗВИЧАЙНИМ ТЕКСТОМ (без JSON), і чекай відповіді.
4. Якщо клієнт ставить ІНШЕ питання — коротко тепло відповідай з наявних даних, тоді знову запитай «Оформляємо як минулого разу?»
5. Якщо клієнт ЯВНО хоче живу людину/менеджера — поверни json_output {"handoff":true}.
Не вигадуй товар/колір — про них іде мова окремо, тут лише розмір і доставка.`;

const N_RECALL_APPLY_CODE = `var rc = context.recallConfirm || {};
var rd = context.returningCustomerData || {};
var si = Object.assign({}, context.sizeInput || {});
if (rd.height != null && si.height == null) si.height = rd.height;
if (rd.weight != null && si.weight == null) si.weight = rd.weight;
if (rc.height != null) si.height = rc.height;
if (rc.weight != null) si.weight = rc.weight;
var od = Object.assign({}, context.orderData || {});
['fullName','phone','city','branch'].forEach(function(k){
  if (rd[k] != null && od[k] == null) od[k] = rd[k];
  if (rc[k] != null) od[k] = rc[k];
});
var ready = !!(od.fullName && od.phone && od.city && od.branch);
return { sizeInput: si, orderData: od, recalledDeliveryReady: ready };`;

async function main() {
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + N_RECALL_APPLY_CODE + '\n})();');

    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }

    const already = flow.nodes.some((n) => n.id === 'n_recall_cond');
    if (already) { console.log('ALREADY_APPLIED'); process.exit(0); }

    console.log('Буде додано 5 нод гілки "повторний клієнт" і перепідключено 6 вхідних/вихідних ребер.');
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    let nodes = flow.nodes.map((n) => ({ ...n }));
    let edges = flow.edges.map((e) => ({ ...e }));

    nodes.push({ id: 'n_recall_cond', type: 'condition', position: { x: 0, y: 0 }, data: { label: '0.5 Повторний клієнт — є дані з минулого замовлення?', condition: 'context.returningCustomerData && Object.keys(context.returningCustomerData).length > 0', description: 'TRUE → показуємо відомі розмір+доставку і питаємо підтвердити/скоригувати. FALSE → звичайний шлях (новий клієнт).' } });
    nodes.push({ id: 'n_recall_confirm', type: 'claude', position: { x: 0, y: 0 }, data: { label: '0.6 Повторний клієнт: підтвердити/скоригувати дані', mode: 'dialog', outputVar: 'recallConfirm', exitCondition: 'json_output', temperature: 0.3, connectorId: '2ec53ba5-144e-463b-9758-c217c4a69b0e', systemPrompt: N_RECALL_CONFIRM_PROMPT, description: "Показує зріст/вагу + ПІБ/телефон/місто/відділення з минулого завершеного замовлення, дає підтвердити або скоригувати окремі поля." } });
    nodes.push({ id: 'n_recall_apply', type: 'js', position: { x: 0, y: 0 }, data: { label: '0.7 Застосувати підтверджені/скориговані дані', code: N_RECALL_APPLY_CODE, description: 'Зливає returningCustomerData + recallConfirm у sizeInput/orderData, ставить recalledDeliveryReady.' } });
    nodes.push({ id: 'n_recall_isclothing_cond', type: 'condition', position: { x: 0, y: 0 }, data: { label: '0.8 Одяг? (для повторного клієнта — пропустити n_size)', condition: IS_CLOTHING_COND, description: 'TRUE → n_calc напряму (розмір вже відомий). FALSE → n_has_colors як зазвичай.' } });
    nodes.push({ id: 'n_collect_skip_cond', type: 'condition', position: { x: 0, y: 0 }, data: { label: '12.05 Доставка вже відома (повторний клієнт)?', condition: 'context.recalledDeliveryReady === true', description: 'TRUE → n_np_check напряму (адресу вже підтверджено на початку). FALSE → n_collect як зазвичай.' } });

    // Перехопити ОБИДВА входи в n_is_clothing → тепер вони йдуть у n_recall_cond.
    edges = edges.map((e) => (e.target === 'n_is_clothing') ? { ...e, target: 'n_recall_cond' } : e);
    edges.push({ id: 'e_recall_true', source: 'n_recall_cond', target: 'n_recall_confirm', sourceHandle: 'true' });
    edges.push({ id: 'e_recall_false', source: 'n_recall_cond', target: 'n_is_clothing', sourceHandle: 'false' });
    edges.push({ id: 'e_recall_confirm_apply', source: 'n_recall_confirm', target: 'n_recall_apply' });
    edges.push({ id: 'e_recall_apply_cond', source: 'n_recall_apply', target: 'n_recall_isclothing_cond' });
    edges.push({ id: 'e_recall_iscloth_true', source: 'n_recall_isclothing_cond', target: 'n_calc', sourceHandle: 'true' });
    edges.push({ id: 'e_recall_iscloth_false', source: 'n_recall_isclothing_cond', target: 'n_has_colors', sourceHandle: 'false' });

    // Перехопити ВСІ 4 входи в n_collect → тепер вони йдуть у n_collect_skip_cond.
    edges = edges.map((e) => (e.target === 'n_collect') ? { ...e, target: 'n_collect_skip_cond' } : e);
    edges.push({ id: 'e_collect_skip_true', source: 'n_collect_skip_cond', target: 'n_np_check', sourceHandle: 'true' });
    edges.push({ id: 'e_collect_skip_false', source: 'n_collect_skip_cond', target: 'n_collect', sourceHandle: 'false' });

    nodes = computeAutoLayout(nodes, edges);
    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes, edges } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
