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

// Стартовий флоу: Instagram → нода-вітання (авто-підтвердження, що ми прийняли звернення).
// Текст живе в НОДІ n_welcome — редагується на канвасі. Далі діалог веде оператор вручну
// (або майбутня логіка воронки). Instagram показує текст як є — без HTML-тегів.
const nodes = [
  {
    id: 'start_1',
    type: 'start',
    position: { x: 80, y: 80 },
    data: { label: 'Старт (Instagram)', trigger: 'instagram' },
  },
  {
    id: 'n_welcome',
    type: 'message',
    position: { x: 80, y: 260 },
    data: {
      label: 'Вітання / прийняли звернення',
      text: 'Дякуємо, що написали! 🙌\nОтримали ваше повідомлення. Підкажіть, будь ласка, яка модель вас цікавить — і ми одразу надішлемо фото, ціну та наявність 📸',
    },
  },
];
const edges = [
  { id: 'e_start_welcome', source: 'start_1', target: 'n_welcome' },
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
  ['IG_BUSINESS_ID', 'REPLACE_ME',
    'ID Instagram Business акаунта (для звірки відправника подій). Заповнити при підключенні.', false],
  ['FUNNEL_CHANNELS', 'instagram',
    'Активні канали воронки (channelSync). Тут лише instagram — Telegram цій воронці не потрібен.', false],
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
