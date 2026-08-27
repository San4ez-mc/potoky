'use strict';
/*
 * Патч воронки «goverla_shop — основний магазин (Zernio)» (bot 5bdb3e38-1936-416f-b1f0-8f1125583193)
 *   Ф1.4  Автовідповіді на коментарі під постами Instagram (запит користувача 2026-08-27).
 *
 *   Реальний адаптер (zernioHandler.js, спільний код, задеплоєний окремо через git):
 *   comment.received тепер повноцінно опрацьовується — resolve user/сесія → сесія
 *   скеровується на n_comment_entry (не на звичайний start_1) → після відпрацювання
 *   ноди адаптер (1) намагається приватну відповідь у директ (Meta Private Reply API
 *   через Zernio — ⚠️ ендпоінт РЕКОНСТРУЙОВАНО з фрагментів документації, потребує
 *   підтвердження ЖИВИМ тестовим коментарем), (2) постить публічну відповідь ПІД
 *   коментарем (з іменем — той самий текст з різним іменем НЕ рахується Instagram
 *   дублем/спамом).
 *
 *   ⚠️ Лайк коментаря — НЕ реалізовано. Instagram прибрав цю можливість з офіційного
 *   API ще в 2018 (підтверджено документацією Zernio) — жодного способу обійти немає,
 *   ані через Zernio, ані напряму через Graph API.
 *
 *   Нова нода n_comment_entry (js):
 *   - Бере ім'я коментатора (context.senderName) і текст коментаря (context.commentText).
 *   - Детерміновано (regex, не ШІ — критичне рішення) класифікує в одну з 5 категорій:
 *     замовлення / розмір-заміри / оплата / ціна / інше-реакція.
 *   - Випадково обирає ОДИН з 10 варіантів відповіді для цієї категорії (антиспам —
 *     Instagram рахує однаковий текст під різними коментарями як спам; той самий
 *     варіант + РІЗНЕ ім'я теж не рахується дублем), підставляє ім'я.
 *   - Кладе готовий текст у context.commentReplyText (публічна відповідь — постить
 *     адаптер) і йде далі в n_route — ТОЙ САМИЙ ланцюжок n_lookup/n_welcome, що й
 *     звичайний DM (mediaId коментаря → context.entryAd → CT_1001, як і клік з реклами).
 *     Це і є "DM" з боку користувача: 100% логіки товару/розміру/оплати НЕ дублюється.
 *
 * ЗАПУСК:  node patch-goverla-comment-autoreply.js            (dry-run)
 *          node patch-goverla-comment-autoreply.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const { computeAutoLayout } = require('@platform/flow-layout');

const BOT_ID = '5bdb3e38-1936-416f-b1f0-8f1125583193';
const APPLY = process.argv.includes('--apply');

const N_COMMENT_ENTRY_CODE = `// Автовідповіді на коментарі (аудит 2026-08-27, запит користувача).
// Детерміновано (regex) — не ШІ: категорія коментаря вирішує гілку/оплату/розмір,
// це критичне бізнес-рішення, а не creative-текст (правило "критичні рішення —
// детерміновані"). Порядок перевірки важливий: "хочу замовити кофту в чорному,
// розмір L" — це передусім НАМІР ЗАМОВИТИ, а не питання про розмір.
var name = String(context.senderName || (user && user.firstName) || '').trim().split(/\\s+/)[0] || 'друже';
var text = String(context.commentText || input || '').toLowerCase();

var V_ORDER = [
  '{NAME}, супер вибір! 🔥 Оформимо в директі — вже пишу',
  'Дякую, {NAME}! Продовжимо оформлення в приватних 💛',
  '{NAME}, вже з вами в директі — оформимо швидко 😊',
  'Клас, {NAME}! Деталі замовлення — в директ 🛍️',
  '{NAME}, готові допомогти з замовленням — дивіться директ 💙',
  'Супер, {NAME}! Всі кроки замовлення — в приватних 😊',
  '{NAME}, з радістю оформимо — перевірте директ 🔥',
  'Дякую за довіру, {NAME}! Продовжуємо в директі 💛',
  '{NAME}, вже готую замовлення — дивіться приватні 😊',
  'Клас вибір, {NAME}! Пишу деталі в директ 💌',
];
var V_SIZE = [
  '{NAME}, розмірну сітку вже надсилаю в директ 📏',
  'Дякую, {NAME}! Заміри — дивіться в приватних повідомленнях 😊',
  '{NAME}, все по розмірах написала в директ 💛',
  'Секунду, {NAME} — сітка розмірів вже летить у директ 📐',
  '{NAME}, підберемо розмір разом — перевірте директ 💙',
  'Дякую за питання, {NAME}! Заміри в приватних 😊',
  '{NAME}, розміри вже чекають на вас у директі 📏',
  'З радістю, {NAME}! Написала точні заміри в директ 💛',
  '{NAME}, гляньте директ — там усі розміри 😊',
  'Секунду, {NAME} — сітку розмірів вже надіслала 📐',
];
var V_PAYMENT = [
  '{NAME}, про оплату все розписала в директ 💳',
  'Дякую за питання, {NAME}! Варіанти оплати — в приватних 😊',
  '{NAME}, деталі оплати вже в директі 💛',
  'Секунду, {NAME} — про накладений платіж написала в директ 📦',
  '{NAME}, всі варіанти оплати — дивіться приватні 💙',
  'З радістю поясню, {NAME}! Дивіться директ 😊',
  '{NAME}, оплату можна гнучко — деталі в директі 💛',
  'Дякую, {NAME}! Про оплату — в приватних повідомленнях 😊',
  '{NAME}, все розписала щодо оплати в директ 📬',
  'Секунду, {NAME} — деталі оплати вже надсилаю 💳',
];
var V_PRICE = [
  '{NAME}, дякую за інтерес 💛 Ціну і всі деталі вже надсилаю в директ!',
  '{NAME}, з радістю підкажу вартість — дивіться повідомлення в директ 😊',
  'Привіт, {NAME}! Ціну написала вам у директ, гляньте 💙',
  '{NAME}, вже лечу з відповіддю в директ 🏃',
  'Дякую за питання, {NAME}! Всі цифри — в директі 😊',
  '{NAME}, ціна вже чекає на вас у приватних повідомленнях 💌',
  'Секунду, {NAME} — надсилаю вартість у директ 🔥',
  '{NAME}, перевірте директ — там і ціна, і деталі 💛',
  'З задоволенням, {NAME}! Написала в директ 😊',
  '{NAME}, все розписала в приватних — дивіться 💙',
];
var V_OTHER = [
  'Дякую, {NAME}! 🔥 Раді, що подобається — деталі в директ, якщо цікавить',
  '{NAME}, дякуємо за підтримку 💛 Якщо є питання — пишіть у директ',
  'Раді бачити вас тут, {NAME}! 😊 Все за деталями — в приватних',
  '{NAME}, дякую! Якщо цікавить якийсь товар — пишіть у директ 💙',
  'Дуже приємно, {NAME}! 🙌 Деталі по товарах — в директі',
  '{NAME}, дякую за коментар! Все найцікавіше — в приватних 😊',
  'Раді вам, {NAME}! 💛 Пишіть у директ, якщо потрібна консультація',
  '{NAME}, дякуємо! 🔥 Директ відкритий для всіх питань',
  'Дякую за увагу, {NAME}! Деталі товару — в директі 😊',
  '{NAME}, приємно це чути! 💙 Пишіть у директ, підкажемо все',
];

var category = 'other';
var variants = V_OTHER;
if (/замовит|оформит|купит|хочу\\s+(це|цей|такий|таку|таке)/i.test(text)) { category = 'order'; variants = V_ORDER; }
else if (/замір|розмір|обхват|\\bсм\\b/i.test(text)) { category = 'size'; variants = V_SIZE; }
else if (/наклад|післяплат|передоплат|оплат|ложным\\s*платеж|нал[ои]жк/i.test(text)) { category = 'payment'; variants = V_PAYMENT; }
else if (/цін|вартіст|скільки\\s*кошту|сколько\\s*стоит|почем/i.test(text)) { category = 'price'; variants = V_PRICE; }

var idx = Math.floor(Math.random() * variants.length);
var replyText = variants[idx].split('{NAME}').join(name);
return { commentReplyText: replyText, commentCategory: category };`;

async function main() {
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + N_COMMENT_ENTRY_CODE + '\n})();');

    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }

    const already = flow.nodes.some((n) => n.id === 'n_comment_entry');
    if (already) { console.log('ALREADY_APPLIED'); process.exit(0); }

    console.log('Буде додано ноду n_comment_entry -> n_route.');
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    let nodes = flow.nodes.map((n) => ({ ...n }));
    let edges = flow.edges.map((e) => ({ ...e }));

    nodes.push({
        id: 'n_comment_entry', type: 'js', position: { x: 0, y: 0 },
        data: {
            label: '0.1 Коментар: класифікація + відповідь',
            code: N_COMMENT_ENTRY_CODE,
            description: 'Вхід із comment.received (не з /start). Класифікує коментар (замовлення/розмір/оплата/ціна/інше), обирає 1 з 10 варіантів публічної відповіді з іменем, кладе в context.commentReplyText. Далі йде в n_route — той самий ланцюжок товару, що й DM.',
        },
    });
    edges.push({ id: 'e_comment_entry_route', source: 'n_comment_entry', target: 'n_route' });

    nodes = computeAutoLayout(nodes, edges);
    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes, edges } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
