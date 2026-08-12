// Олексій — одяг: новий проєкт + порожня воронка під вхідні повідомлення з Instagram-реклами.
// Поки що воронка порожня (лише start-нода). Реєструє вебхук Instagram через funnel-ключ
// INSTAGRAM_VERIFY_TOKEN — Meta-верифікація (GET /webhook/instagram/:botId) починає проходити
// одразу після створення. Логіка діалогу/відповідей додається окремим кроком пізніше.
//
// Callback URL (для Meta App → Webhooks → Instagram):
//   https://flows.fineko.space/webhook/instagram/<botId>
//   (реальний botId друкується в кінці скрипта)
// Verify Token: значення ключа INSTAGRAM_VERIFY_TOKEN (нижче).
//
// Запуск на сервері (DB локальна):
//   cd /var/www/flows.fineko.space/platform && node build-insta-clothing-funnel.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_SLUG = 'oleksii-clothing';
const BOT_SLUG = 'insta-ads-clothing';

// СКЕЛЕТ sales-воронки (плейсхолдери). 14 кроків ТЗ. Тексти/дані — чернетка, редагується
// на канвасі. Claude-ноди (dialog) збирають і парсять відповіді користувача; js — детермінована
// логіка (лукап товару, розмірна сітка); condition — гілки; notifyAdmin — сигнали оператору
// (заглушка EasyDrop/ручна перевірка оплати). НЕ тестовано наживо — чекає App Review.
const CLAUDE = '2ec53ba5-144e-463b-9758-c217c4a69b0e'; // Claude Sonnet (instance)
let _y = 40; const Y = () => (_y += 140);

const nodes = [
  { id: 'start_1', type: 'start', position: { x: 80, y: Y() },
    data: { label: 'Старт (Instagram)', trigger: 'instagram' } },

  // (0) Визначаємо рекламу-джерело (ад-id уже в context з вебхука)
  { id: 'n_route', type: 'js', position: { x: 80, y: Y() },
    data: { label: '0. Джерело (ад-id)', code: "return { entryAd: context.entryAdId || (context.lastReferral && context.lastReferral.ref) || 'default' };" } },

  // (1) Лукап товару по ад-id зі stub-каталогу PRODUCT_CATALOG (ключ воронки)
  { id: 'n_lookup', type: 'js', position: { x: 80, y: Y() },
    data: { label: '1. Товар по ад-id (заглушка)', code: "var cat={}; try{cat=JSON.parse(keys.PRODUCT_CATALOG||'{}')}catch(e){} var p=cat[context.entryAd]||cat.default||{name:'Товар',desc:'Опис — заповнити',photoUrl:'',colors:['чорний'],upsell:''}; return { product: p };" } },

  // (1) Презентація: фото + текст
  { id: 'n_photo', type: 'sendPhoto', position: { x: 80, y: Y() },
    data: { label: '1. Фото товару', photoVar: 'product.photoUrl', caption: '{{context.product.name}}' } },
  { id: 'n_welcome', type: 'message', position: { x: 80, y: Y() },
    data: { label: '1. Вітання + презентація', text: 'Дякуємо за звернення! 🙌\nОсь {{context.product.name}}.\n{{context.product.desc}}' } },

  // (2-3) Збір розмір/зріст/вага + визначення розміру
  { id: 'n_size', type: 'claude', position: { x: 80, y: Y() },
    data: { label: '2. Питаємо розмір/зріст/вагу', mode: 'dialog', connectorId: CLAUDE, temperature: 0.3,
      systemPrompt: 'Ти асистент магазину. Дружньо українською збери: звичний розмір одягу/взуття (якщо знає), зріст (см) і вагу (кг). Питай по одному. Коли зібрав — поверни РІВНО один JSON у json_output: {clothingSize, shoeSize, height, weight}.',
      exitCondition: 'json_output', outputVar: 'sizeInput' } },
  { id: 'n_calc', type: 'js', position: { x: 80, y: Y() },
    data: { label: '3. Розмір за сіткою (ПЛЕЙСХОЛДЕР)', code: "var s=context.sizeInput||{}; var w=Number(s.weight)||0,h=Number(s.height)||0; var size='M'; if(w){ if(w<60)size='S'; else if(w<75)size='M'; else if(w<90)size='L'; else size='XL'; } if(s.clothingSize)size=s.clothingSize; return { recommendedSize: size };" } },
  { id: 'n_size_reply', type: 'message', position: { x: 80, y: Y() },
    data: { label: '4. Рекомендований розмір', text: 'За вашими параметрами рекомендуємо розмір: {{context.recommendedSize}} 👍' } },

  // (5) Колір
  { id: 'n_color', type: 'claude', position: { x: 80, y: Y() },
    data: { label: '5. Питаємо колір', mode: 'dialog', connectorId: CLAUDE, temperature: 0.3,
      systemPrompt: 'Запитай українською, який колір цікавить. Доступні кольори: {{context.product.colors}}. Коли клієнт назве — поверни JSON у json_output: {color}.',
      exitCondition: 'json_output', outputVar: 'colorChoice' } },

  // (6-7) Наявність (заглушка = у наявності)
  { id: 'n_avail', type: 'js', position: { x: 80, y: Y() },
    data: { label: '6. Наявність (заглушка CRM)', code: "return { available: true };" } },
  { id: 'n_avail_reply', type: 'message', position: { x: 80, y: Y() },
    data: { label: '7. Повідомити наявність', text: 'Цей товар у наявності ✅' } },

  // (8) Допродаж (гілка)
  { id: 'n_upsell_cond', type: 'condition', position: { x: 80, y: Y() },
    data: { label: '8. Є допродаж?', condition: "context.product && context.product.upsell" } },
  { id: 'n_upsell_msg', type: 'message', position: { x: 320, y: _y },
    data: { label: '8. Пропозиція допродажу', text: 'До цього товару часто беруть: {{context.product.upsell}}. Додати до замовлення? 😊' } },

  // (9) Готові замовити?
  { id: 'n_order_intent', type: 'claude', position: { x: 80, y: Y() },
    data: { label: '9. Готові замовити?', mode: 'dialog', connectorId: CLAUDE, temperature: 0.2,
      systemPrompt: 'Ввічливо спитай, чи готові оформити замовлення. Визнач намір і поверни JSON у json_output: {ready: "yes" | "no"}.',
      exitCondition: 'json_output', outputVar: 'orderIntent' } },
  { id: 'n_order_cond', type: 'condition', position: { x: 80, y: Y() },
    data: { label: '9. Розгалуження намір', condition: "context.orderIntent && String(context.orderIntent.ready).toLowerCase().indexOf('y')===0" } },

  // (10) Спосіб оплати (quick-replies)
  { id: 'n_pay', type: 'message', position: { x: 80, y: Y() },
    data: { label: '10. Вибір оплати', text: 'Оберіть спосіб оплати:',
      buttons: [[{ text: 'Накладений + 200 грн передоплата', callback_data: 'pay_cod' }], [{ text: 'Повна передоплата', callback_data: 'pay_full' }]] } },
  { id: 'n_pay_collect', type: 'claude', position: { x: 80, y: Y() },
    data: { label: '10. Фіксуємо спосіб оплати', mode: 'dialog', connectorId: CLAUDE, temperature: 0.1,
      systemPrompt: 'Визнач обраний спосіб оплати з відповіді користувача. Поверни JSON у json_output: {method: "cod" (накладений+200) | "full" (повна передоплата)}.',
      exitCondition: 'json_output', outputVar: 'paymentInfo' } },

  // (11) Реквізити + прохання квитанції
  { id: 'n_requisites', type: 'message', position: { x: 80, y: Y() },
    data: { label: '11. Реквізити оплати (ПЛЕЙСХОЛДЕР)', text: 'Реквізити для оплати: [ВСТАВИТИ КАРТУ/РЕКВІЗИТИ].\nПісля оплати надішліть, будь ласка, квитанцію або скріншот і напишіть, куди відправляти (місто, відділення НП, ПІБ, телефон) 📦' } },

  // (12) Квитанція + адреса
  { id: 'n_collect', type: 'claude', position: { x: 80, y: Y() },
    data: { label: '12. Збір адреси (+квитанція)', mode: 'dialog', connectorId: CLAUDE, temperature: 0.2,
      systemPrompt: 'Збери дані доставки: місто, відділення Нової Пошти, ПІБ, телефон. Якщо клієнт надіслав фото квитанції — подякуй. Коли все є — поверни JSON у json_output: {fullName, phone, city, np, receiptReceived}.',
      exitCondition: 'json_output', outputVar: 'orderData' } },
  { id: 'n_pay_cond', type: 'condition', position: { x: 80, y: Y() },
    data: { label: '12. Повна передоплата?', condition: "context.paymentInfo && context.paymentInfo.method === 'full'" } },
  { id: 'n_verify', type: 'notifyAdmin', position: { x: 320, y: _y },
    data: { label: '12. Ручна перевірка оплати', targetKey: 'ADMIN_TELEGRAM_ID',
      message: '❗Повна передоплата — перевір надходження вручну.\nКлієнт: {{user.username}}\nТовар: {{context.product.name}} / розмір {{context.recommendedSize}} / {{context.colorChoice.color}}' } },

  // (13) Створення замовлення (заглушка EasyDrop → сигнал оператору)
  { id: 'n_create', type: 'notifyAdmin', position: { x: 80, y: Y() },
    data: { label: '13. Замовлення → оператор (EasyDrop заглушка)', targetKey: 'ADMIN_TELEGRAM_ID',
      message: '🆕 НОВЕ ЗАМОВЛЕННЯ (EasyDrop — заглушка, оформити вручну)\nТовар: {{context.product.name}}\nРозмір: {{context.recommendedSize}} | Колір: {{context.colorChoice.color}}\nОплата: {{context.paymentInfo.method}}\nОтримувач: {{context.orderData.fullName}}, {{context.orderData.phone}}\nАдреса: {{context.orderData.city}}, НП {{context.orderData.np}}' } },
  { id: 'n_confirm', type: 'message', position: { x: 80, y: Y() },
    data: { label: '13. Підтвердження клієнту', text: 'Дякуємо! Замовлення прийнято 🎉 Найближчим часом відправимо і надішлемо ТТН 🚚' } },

  // (14) Нагадування, якщо клієнт замовкнув (гілка від наміру "no")
  { id: 'n_followup_wait', type: 'wait', position: { x: 560, y: 1980 },
    data: { label: '14. Пауза перед нагадуванням', duration: 1, unit: 'days' } },
  { id: 'n_followup_msg', type: 'message', position: { x: 560, y: 2120 },
    data: { label: '14. Ненавʼязливе нагадування', text: 'Доброго дня! 😊 Ви цікавились {{context.product.name}}. Якщо ще актуально — я поруч, допоможу з розміром і оформленням. Гарного дня!' } },
];

const edges = [
  { id: 'e1', source: 'start_1', target: 'n_route' },
  { id: 'e2', source: 'n_route', target: 'n_lookup' },
  { id: 'e3', source: 'n_lookup', target: 'n_photo' },
  { id: 'e4', source: 'n_photo', target: 'n_welcome' },
  { id: 'e5', source: 'n_welcome', target: 'n_size' },
  { id: 'e6', source: 'n_size', target: 'n_calc' },
  { id: 'e7', source: 'n_calc', target: 'n_size_reply' },
  { id: 'e8', source: 'n_size_reply', target: 'n_color' },
  { id: 'e9', source: 'n_color', target: 'n_avail' },
  { id: 'e10', source: 'n_avail', target: 'n_avail_reply' },
  { id: 'e11', source: 'n_avail_reply', target: 'n_upsell_cond' },
  { id: 'e12', source: 'n_upsell_cond', target: 'n_upsell_msg', sourceHandle: 'true' },
  { id: 'e13', source: 'n_upsell_cond', target: 'n_order_intent', sourceHandle: 'false' },
  { id: 'e14', source: 'n_upsell_msg', target: 'n_order_intent' },
  { id: 'e15', source: 'n_order_intent', target: 'n_order_cond' },
  { id: 'e16', source: 'n_order_cond', target: 'n_pay', sourceHandle: 'true' },
  { id: 'e17', source: 'n_order_cond', target: 'n_followup_wait', sourceHandle: 'false' },
  { id: 'e18', source: 'n_pay', target: 'n_pay_collect' },
  { id: 'e19', source: 'n_pay_collect', target: 'n_requisites' },
  { id: 'e20', source: 'n_requisites', target: 'n_collect' },
  { id: 'e21', source: 'n_collect', target: 'n_pay_cond' },
  { id: 'e22', source: 'n_pay_cond', target: 'n_verify', sourceHandle: 'true' },
  { id: 'e23', source: 'n_pay_cond', target: 'n_create', sourceHandle: 'false' },
  { id: 'e24', source: 'n_verify', target: 'n_create' },
  { id: 'e25', source: 'n_create', target: 'n_confirm' },
  { id: 'e26', source: 'n_followup_wait', target: 'n_followup_msg' },
];

// Funnel-ключі. INSTAGRAM_VERIFY_TOKEN — вже робочий (verify challenge від Meta).
// Решта — плейсхолдери, які клієнт віддасть при підключенні Meta-додатку.
const KEYS = [
  ['INSTAGRAM_VERIFY_TOKEN', '13e1feb5f31b844368dfc5fa854667b2923f4346df24a241',
    'Verify Token для Meta Webhook (GET-верифікація)', true],
  ['INSTAGRAM_ACCESS_TOKEN', 'REPLACE_ME',
    'Page/IG access token (Meta) — надсилання/отримання повідомлень. Заповнити при підключенні.', true],
  ['INSTAGRAM_APP_SECRET', 'REPLACE_ME',
    'App Secret Meta-додатку — перевірка підпису X-Hub-Signature. Заповнити при підключенні.', true],
  ['INSTAGRAM_APP_ID', 'REPLACE_ME',
    'App ID Meta-додатку — реєстрація вебхука (channelSync). Заповнити при підключенні.', false],
  ['INSTAGRAM_BUSINESS_ID', 'REPLACE_ME',
    'ID Instagram Business акаунта (covercar_ua). Заповнити при підключенні.', false],
  ['INSTAGRAM_USERNAME', 'REPLACE_ME',
    'Username Instagram-акаунту без @ (для ig.me-посилань).', false],
  ['FUNNEL_CHANNELS', '["instagram","webhook"]',
    'Активні канали воронки (channelSync). Instagram + generic webhook. Telegram цій воронці не потрібен.', false],
  ['PRODUCT_CATALOG', JSON.stringify({
    default: { name: 'Накидка на сидіння (універсальна)', desc: 'Опис товару — заповніть у каталозі.', photoUrl: '', colors: ['чорний', 'бежевий', 'сірий'], upsell: 'органайзер у багажник' },
    // '120200000000000123': { name: '...', desc: '...', photoUrl: 'https://...', colors: ['...'], upsell: '...' }
  }), 'Каталог товарів (заглушка). Ключі = ад-id реклами → товар. photoUrl має бути ПУБЛІЧНИМ http-URL для IG.', false],
  ['ADMIN_TELEGRAM_ID', 'REPLACE_ME',
    'Telegram ID оператора для сигналів (нове замовлення / перевір оплату). Потребує TG-конектора у воронці, щоб реально надсилати.', false],
];

async function main() {
  const project = await prisma.project.upsert({
    where: { slug: PROJECT_SLUG },
    update: {},
    create: {
      name: 'Олексій — одяг',
      slug: PROJECT_SLUG,
      description: 'Автоматизація відповідей у Instagram-магазині одягу: люди приходять з реклами прямо в Direct.',
    },
  });

  let bot = await prisma.bot.findFirst({ where: { slug: BOT_SLUG } });
  if (!bot) {
    bot = await prisma.bot.create({
      data: {
        projectId: project.id,
        name: 'Instagram — реклама (одяг)',
        slug: BOT_SLUG,
        description: 'Приймає вхідні повідомлення з Instagram-реклами (Direct) і веде діалог з клієнтом. Поки що порожня — лише вебхук.',
        goal: 'Автоматично відповідати на звернення з Instagram-реклами магазину одягу під конкретний товар/рекламу.',
        trigger: 'instagram',
        isActive: true,
      },
    });
  }

  await prisma.flowDefinition.upsert({
    where: { botId: bot.id },
    update: { nodes, edges },
    create: { botId: bot.id, nodes, edges },
  });

  for (const [key, value, label, isSecret] of KEYS) {
    await prisma.funnelKey.upsert({
      where: { botId_key: { botId: bot.id, key } },
      update: { label, isSecret }, // не перетираємо вже заповнене значення
      create: { botId: bot.id, key, value, label, isSecret },
    });
  }

  const verify = KEYS.find(([k]) => k === 'INSTAGRAM_VERIFY_TOKEN')[1];
  console.log('OK project:', project.id, '(' + PROJECT_SLUG + ')');
  console.log('OK bot:', bot.id, '(' + BOT_SLUG + ')');
  console.log('--- Meta Webhook налаштування ---');
  console.log('Callback URL: https://flows.fineko.space/webhook/instagram/' + bot.id);
  console.log('Verify Token:', verify);
}

main()
  .catch((e) => { console.error('ERR', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
