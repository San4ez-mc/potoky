// #262 — Воронка найму кандидата на посаду маркетолога (з нуля).
// Сценарій: розповісти про вакансію + матеріали → база знань → інтервʼю (claude dialog,
// збір відповідей у JSON) → AI-оцінка за критеріями → запис у Google Sheet (Apps Script)
// → подяка. Матеріали/URL таблиці параметризовані funnel-ключами (заповнити при деплої).
//
// Запуск (локально):
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fineko_flows?schema=public" \
//   node platform/build-hiring-funnel.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_SLUG = 'fineko-hr';
const BOT_SLUG = 'hiring-marketer';

// ── Промпт інтервʼю: агент веде діалог і на виході дає JSON з відповідями ──
const INTERVIEW_SYSTEM = [
  'Ти — HR-асистент компанії FINEKO. Проводиш співбесіду з кандидатом на посаду МАРКЕТОЛОГА.',
  'Спілкуйся українською, тепло і по-діловому. Задавай питання ПО ОДНОМУ, чекай відповідь, став уточнення за потреби.',
  'Обовʼязково збери: 1) ПІБ; 2) контакт (телефон/telegram); 3) досвід у маркетингу (роки, ніші);',
  '4) з якими каналами працював (Meta Ads, Google Ads, SMM, email, SEO тощо); 5) 1-2 кейси з цифрами (бюджет→результат);',
  '6) інструменти/аналітика; 7) очікувана вилка з/п; 8) готовність до тестового; 9) чому саме FINEKO.',
  'Коли зібрав усе — подякуй і поверни РІВНО один JSON-обʼєкт (без тексту навколо) у полі json_output з ключами:',
  'fullName, contact, yearsExperience, channels, cases, tools, salaryExpectation, readyForTest, motivation, rawSummary.',
].join(' ');

// ── Промпт AI-оцінки кандидата за критеріями ──
const SCORING_SYSTEM = [
  'Ти — оцінювач кандидатів. На вході JSON з відповідями кандидата (context.answers).',
  'Оціни кандидата на посаду маркетолога за критеріями (0-10 кожен):',
  'relevance (релевантність досвіду), impact (доведена користь/результати з цифр),',
  'channels (широта каналів), communication (якість комунікації), fit (відповідність цінностям FINEKO).',
  'Поверни РІВНО один JSON: {relevance, impact, channels, communication, fit, total (сума/50 у %), verdict (коротко: рекомендувати/під сумнівом/відмова), comment}.',
].join(' ');

// Claude Sonnet — збережений конектор воронок (CLAUDE.md §16, instance UUID)
const CLAUDE_SONNET = '2ec53ba5-144e-463b-9758-c217c4a69b0e';

const nodes = [
  { id: 'start_1', type: 'start', position: { x: 80, y: 80 },
    data: { label: 'Старт (Telegram)', trigger: 'telegram' } },

  { id: 'n_intro', type: 'message', position: { x: 80, y: 240 },
    data: {
      label: 'Про вакансію',
      parseMode: 'HTML',
      text: '👋 Вітаємо! Це бот найму <b>FINEKO</b>.\n\nВідкрита позиція: <b>Маркетолог</b>.\nЗараз коротко розкажемо про роль, покажемо матеріали, а потім поставимо кілька запитань. Це займе ~10 хвилин.',
    } },

  // Матеріали — кнопками-посиланнями (keys рендеряться у шаблоні кнопок).
  { id: 'n_materials', type: 'message', position: { x: 80, y: 400 },
    data: {
      label: 'Матеріали',
      parseMode: 'HTML',
      text: 'Ознайомтесь із матеріалами про роль 👇',
      buttons: [
        [{ text: '📹 Відео про компанію', url: '{{keys.HIRING_VIDEO_URL}}' }],
        [{ text: '🌐 Опис ролі', url: '{{keys.HIRING_JD_URL}}' }],
        [{ text: '📊 Приклади кампаній', url: '{{keys.HIRING_CASES_URL}}' }],
        [{ text: '🖼️ Приклад результатів', url: '{{keys.HIRING_SCREENSHOT_URL}}' }],
      ],
    } },

  { id: 'n_kb', type: 'knowledgeBase', position: { x: 80, y: 560 },
    data: {
      label: 'База знань вакансії',
      contextKey: 'vacancyKb',
      blocks: [
        { id: 'kb1', title: 'Посада', content: 'Маркетолог FINEKO: performance + бренд. Планування, запуск і оптимізація кампаній, аналітика, робота з контент-командою.' },
        { id: 'kb2', title: 'Вимоги', content: 'Досвід від 2 років, робота з платним трафіком (Meta/Google), розуміння воронок, аналітика (GA4, звіти), кейси з цифрами.' },
        { id: 'kb3', title: 'Умови', content: 'Віддалено/гібрид, ставка + бонус за KPI, навчання, зростання в екосистемі FINEKO.' },
      ],
    } },

  { id: 'n_interview', type: 'claude', position: { x: 80, y: 720 },
    data: {
      label: 'Інтервʼю (діалог)',
      mode: 'dialog',
      connectorId: CLAUDE_SONNET,
      systemPrompt: INTERVIEW_SYSTEM,
      exitCondition: 'json_output',
      outputVar: 'answers',
      temperature: 0.5,
    } },

  // 15.11: обʼєкт answers → чистий рядок для наступного промпту.
  { id: 'n_answers_text', type: 'js', position: { x: 80, y: 880 },
    data: {
      label: 'answers → текст',
      code: 'return { answersText: JSON.stringify(context.answers || {}) };',
    } },

  { id: 'n_score', type: 'claude', position: { x: 80, y: 1040 },
    data: {
      label: 'AI-оцінка кандидата',
      mode: 'single',
      connectorId: CLAUDE_SONNET,
      systemPrompt: SCORING_SYSTEM,
      messagesTemplate: 'Відповіді кандидата (JSON):\n{{context.answersText}}',
      exitCondition: 'json_output',
      outputVar: 'evaluation',
      temperature: 0.2,
    } },

  // Збираємо повний payload у js — уникаємо ламання JSON у body-шаблоні.
  { id: 'n_payload', type: 'js', position: { x: 80, y: 1200 },
    data: {
      label: 'Збірка payload',
      code: 'return { hiringPayloadJson: JSON.stringify({ type: "candidate", telegram: (user && user.username) || null, userId: (user && user.id) || null, answers: context.answers || {}, evaluation: context.evaluation || {}, receivedAt: new Date().toISOString() }) };',
    } },

  { id: 'n_save', type: 'httpRequest', position: { x: 80, y: 1360 },
    data: {
      label: 'Запис у Google Sheet',
      method: 'POST',
      url: '{{keys.HIRING_SHEET_WEBHOOK}}',
      headers: { 'Content-Type': 'application/json' },
      body: '{{context.hiringPayloadJson}}',
      outputVar: 'saveResult',
      description: 'Apps Script Web App: appendRow у таблицю кандидатів на Drive. URL — у funnel-ключі HIRING_SHEET_WEBHOOK. Payload зібрано у js-ноді n_payload.',
    } },

  { id: 'n_thanks', type: 'message', position: { x: 80, y: 1520 },
    data: {
      label: 'Подяка',
      parseMode: 'HTML',
      text: '✅ Дякуємо! Ваші відповіді збережено. HR-команда FINEKO звʼяжеться з вами найближчим часом.',
    } },
];

const edges = [
  { id: 'e1', source: 'start_1', target: 'n_intro' },
  { id: 'e2', source: 'n_intro', target: 'n_materials' },
  { id: 'e3', source: 'n_materials', target: 'n_kb' },
  { id: 'e4', source: 'n_kb', target: 'n_interview' },
  { id: 'e5', source: 'n_interview', target: 'n_answers_text' },
  { id: 'e6', source: 'n_answers_text', target: 'n_score' },
  { id: 'e7', source: 'n_score', target: 'n_payload' },
  { id: 'e8', source: 'n_payload', target: 'n_save' },
  { id: 'e9', source: 'n_save', target: 'n_thanks' },
];

// Funnel-ключі (placeholder — заповнити реальними при деплої)
const KEYS = [
  ['HIRING_VIDEO_URL', 'https://REPLACE_ME/video', 'Відео про компанію', false],
  ['HIRING_JD_URL', 'https://REPLACE_ME/job-description', 'Опис ролі', false],
  ['HIRING_CASES_URL', 'https://REPLACE_ME/cases', 'Приклади кампаній', false],
  ['HIRING_SCREENSHOT_URL', 'https://REPLACE_ME/screenshot.png', 'Скріншот-приклад', false],
  ['HIRING_SHEET_WEBHOOK', 'https://script.google.com/macros/s/REPLACE_ME/exec', 'Apps Script Web App для запису кандидатів', true],
  ['CLAUDE_CONNECTOR_ID', '2ec53ba5-144e-463b-9758-c217c4a69b0e', 'Claude Sonnet конектор для воронок', false],
  ['TELEGRAM_CONNECTOR_ID', 'REPLACE_ME', 'UUID savedConnector Telegram-бота найму (створити при деплої)', true],
];

async function main() {
  const project = await prisma.project.upsert({
    where: { slug: PROJECT_SLUG },
    update: {},
    create: { name: 'FINEKO — HR / Найм', slug: PROJECT_SLUG, description: 'Воронки найму та онбордингу' },
  });

  let bot = await prisma.bot.findFirst({ where: { slug: BOT_SLUG } });
  if (!bot) {
    bot = await prisma.bot.create({
      data: {
        projectId: project.id,
        name: 'Найм: Маркетолог',
        slug: BOT_SLUG,
        description: 'Розповідає про вакансію, показує матеріали, проводить інтервʼю, оцінює кандидата AI і пише в таблицю.',
        goal: 'Зібрати й оцінити кандидатів на посаду маркетолога.',
        trigger: 'telegram',
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
      update: { label, isSecret },
      create: { botId: bot.id, key, value, label, isSecret },
    });
  }

  console.log('OK hiring-marketer bot:', bot.id, '| nodes:', nodes.length, '| keys:', KEYS.length);
}

main()
  .catch((e) => { console.error('ERR', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
