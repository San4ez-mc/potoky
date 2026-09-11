// Тетяна Коробова. Нерухомість — MVP (модулі 1-2 з listing_operations_process.docx):
// Property Capture (голос/фото/текст → жива картка обʼєкта) + Listing Quality
// (Listing Readiness Score, % готовності + чого бракує). Ринок — Іспанія (€).
//
// Модулі 0a, 3-10 з документа — СВІДОМО поза цим MVP (за рішенням користувача).
//
// Запуск:
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fineko_flows?schema=public" \
//   node build-korobova-realty-funnel.js
//
// Telegram-конектор навмисно НЕ створюється тут — токен від @BotFather ще не заведено.
// Коли зʼявиться: додати SavedConnector(type:'telegram_bot') і funnelKey TELEGRAM_CONNECTOR_ID
// через UI /connectors, або перезапустити цей скрипт з env KOROBOVA_TELEGRAM_TOKEN.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_SLUG = 'korobova-realty';
const BOT_SLUG = 'korobova-property-capture';
// Claude Sonnet для воронок (збережений конектор, instance UUID — CLAUDE.md §16).
const CLAUDE_CONNECTOR = '2ec53ba5-144e-463b-9758-c217c4a69b0e';

const PROPERTY_FIELDS_SCHEMA = {
  type: 'object',
  properties: {
    tipo: { type: 'string', description: 'Тип обʼєкта: piso, casa, chalet, ático, local тощо' },
    ubicacion: { type: 'string', description: 'Населений пункт/район, вулиця якщо названо' },
    precio: { type: 'number', description: 'Ціна, €' },
    superficie_m2: { type: 'number', description: 'Площа, м²' },
    habitaciones: { type: 'number', description: 'Кількість кімнат' },
    banos: { type: 'number', description: 'Кількість санвузлів' },
    planta: { type: 'string', description: 'Поверх (для piso)' },
    total_plantas: { type: 'string', description: 'Поверховість будинку (для piso)' },
    estado: { type: 'string', description: 'Стан обʼєкта: nuevo / reformado / a reformar' },
    ano_construccion: { type: 'number', description: 'Рік побудови' },
    caracteristicas: { type: 'array', items: { type: 'string' }, description: 'Особливості: ascensor, terraza, piscina, garaje, aire_acondicionado, orientación тощо' },
    descripcion: { type: 'string', description: 'Вільний опис обʼєкта' },
    contacto_propietario: { type: 'string', description: 'Контакт власника, якщо назвали' },
  },
  required: [],
};

const SYSTEM_PROMPT = [
  'РОЛЬ',
  'Ти — асистент прийому обʼєктів нерухомості для агентки Тетяни Коробової.',
  'Вона працює з нерухомістю в Іспанії (ціни в €, терміни piso/casa/chalet/ático).',
  'Спілкуєшся з нею в Telegram українською, по-діловому, коротко.',
  '',
  'ЩО РОБИШ',
  'Приймаєш голосові нотатки (приходять тобі вже текстом), вільний текст і фото обʼєкта.',
  'З цього ведеш картку ОДНОГО обʼєкта за схемою:',
  '- tipo — тип (piso/casa/chalet/ático/local тощо)',
  '- ubicacion — населений пункт/район, вулиця якщо назвала',
  '- precio — ціна, €',
  '- superficie_m2 — площа, м²',
  '- habitaciones — кількість кімнат',
  '- banos — кількість санвузлів',
  '- planta / total_plantas — поверх і поверховість (для piso, необовʼязково)',
  '- estado — стан: nuevo / reformado / a reformar',
  '- ano_construccion — рік побудови (необовʼязково)',
  '- caracteristicas — список особливостей (ascensor, terraza, piscina, garaje, aire_acondicionado, orientación тощо)',
  '- descripcion — короткий вільний опис обʼєкта',
  '- contacto_propietario — контакт власника (якщо назвала)',
  '',
  'АЛГОРИТМ',
  '1. Після КОЖНОГО її повідомлення онови картку тими даними, які реально прозвучали.',
  '   Нічого не вигадуй і не додумуй — чого не було сказано, того нема. Це стосується й',
  '   caracteristicas: додавай ЛИШЕ те, що вона явно назвала. Не дописуй "типові для такого',
  '   опису" деталі (вид з вікна, стан кухні, тип підлоги тощо), яких вона не казала.',
  '1a. Коли вона дає вільний опис-враження (атмосфера, переваги, чому варто купити) —',
  '    збережи його майже дослівно в descripcion. Не розкладай ПОВНІСТЮ на caracteristicas',
  '    замість цього: descripcion і caracteristicas заповнюються ОБИДВА, не одне замість іншого.',
  '2. Одразу покажи компактний блок «📋 Картка обʼєкта»: списком що вже відомо (✅) і чого',
  '   бракує (❌ з назвою поля). Згадай і кількість отриманих фото рядком «Фото: N».',
  '3. Далі постав ОДНЕ конкретне питання — тільки про перше поле, якого бракує.',
  '   Не питай кілька полів одночасно.',
  '4. Коли обовʼязкові поля (tipo, ubicacion, precio, superficie_m2, habitaciones) заповнені',
  '   і вона надіслала хоча б кілька фото — спитай, чи можна завершувати приймання.',
  '5. Отримавши явну згоду («так», «завершуй», «досить», «стоп», «готово») —',
  '   виклич complete_capture з усіма зібраними полями (порожні поля просто не передавай).',
  '',
  'ПОТОЧНИЙ СТАН',
  'Картка (JSON, може бути порожня): {{context.propertyCard}}',
  'Фото вже отримано: {{context.propertyPhotos.length}}',
  '',
  'ЗАБОРОНИ',
  '- Не вигадуй ціну, площу чи адресу, якщо їх не називали.',
  '- Не вигадуй вид з вікна, тип підлоги, стан кухні чи інші "типові" деталі — лише те, що назвали.',
  '- Не підміняй те, що вона сказала (напр. "вид на парк" → "вид на море").',
  '- Не став два питання в одному повідомленні.',
  '- Не викликай complete_capture, поки вона явно не підтвердила завершення.',
  '',
  'МОВА: українська.',
].join('\n');

const START_TRIGGER = [
  'isResuming = {{context.isResuming}}.',
  'Якщо isResuming = false — це перше повідомлення розмови: коротко привітайся,',
  'поясни, що приймаєш обʼєкт нерухомості голосом/текстом/фото і картка збиратиметься',
  'на очах, і запитай, з якого обʼєкта починаємо (адреса/район).',
  'Якщо isResuming = true — НЕ вітайся заново: подивись на поточний стан картки в',
  'системному промпті й одразу постав наступне питання про перше поле, якого бракує.',
].join('\n');

const TOOLS = [
  {
    name: 'complete_capture',
    description: 'Завершити приймання обʼєкта: зберегти зібрану картку. Викликати лише після явного підтвердження від агентки.',
    inputSchema: PROPERTY_FIELDS_SCHEMA,
  },
];

// js_score: рахує Listing Readiness Score. Ваги: 5 обовʼязкових полів по 10% (50%),
// 3 бажаних по 5% (15%), опис ≥40 симв. — 10%, ≥2 особливості — 10%, фото — до 15%
// (лінійно до 6 фото). Поріг готовності — funnelKey READY_THRESHOLD (дефолт 75).
const JS_SCORE_CODE = `
const card = context.propertyCard || {};
const photos = Array.isArray(context.propertyPhotos) ? context.propertyPhotos : [];
let score = 0;
const missing = [];

const required = [
  ['tipo', 'тип обʼєкта'],
  ['ubicacion', 'локація'],
  ['precio', 'ціна'],
  ['superficie_m2', 'площа'],
  ['habitaciones', 'кількість кімнат'],
];
for (const [key, label] of required) {
  const v = card[key];
  if (v !== undefined && v !== null && v !== '') score += 10;
  else missing.push(label);
}

const desired = [
  ['banos', 'санвузли'],
  ['planta', 'поверх'],
  ['estado', 'стан обʼєкта'],
];
for (const [key, label] of desired) {
  const v = card[key];
  if (v !== undefined && v !== null && v !== '') score += 5;
  else missing.push(label);
}

const desc = String(card.descripcion || '');
if (desc.length >= 40) score += 10;
else missing.push('опис (мінімум 40 символів)');

const feats = Array.isArray(card.caracteristicas) ? card.caracteristicas : [];
if (feats.length >= 2) score += 10;
else missing.push('особливості обʼєкта (мінімум 2)');

const photoScore = Math.min(photos.length / 6, 1) * 15;
score += photoScore;
if (photos.length < 6) missing.push('фото (є ' + photos.length + ', бажано ≥6)');

const listingScore = Math.round(score);
const missingItemsText = missing.length ? missing.join(', ') : 'нічого — картка повна';
const readyThreshold = parseInt(keys.READY_THRESHOLD, 10) || 75;

return { listingScore, missingItemsText, readyThreshold };
`.trim();

// _captureLoopCount — захист від теоретичного синхронного зациклення: якщо agent
// раптом викличе complete_capture кілька разів поспіль БЕЗ нового повідомлення від
// агентки (кожен цикл finishTool → score → cond_ready(false) → сюди знову в тому ж
// проході), після 5 циклів примусово йдемо на msg_done замість нескінченного циклу.
// У звичайному сценарії лічильник росте рідко (тільки на цикл "картку недозаповнено"),
// бо звичайні відповіді агентки НЕ проходять через цю ноду — сесія лишається на
// agent_capture і чекає наступне повідомлення напряму.
const JS_PREP_CODE = `
const loopCount = (context._captureLoopCount || 0) + 1;
return {
  isResuming: !!(context.propertyCard && Object.keys(context.propertyCard).length > 0),
  _captureLoopCount: loopCount,
};
`.trim();

const MSG_SCORE_TEXT = [
  '📋 Готовність оголошення: {{context.listingScore}}%',
  '',
  'Бракує: {{context.missingItemsText}}',
  '',
  'Можемо продовжити — просто напишіть, надиктуйте голосом або надішліть ще фото, я оновлю картку.',
].join('\n');

const MSG_DONE_TEXT = [
  '✅ Дякую! Картку обʼєкта прийнято.',
  '',
  'Наступні кроки — тексти для порталів і соцмереж, обробка фото, публікація — це вже',
  'наступна ітерація продукту, поки що не тут.',
].join('\n');

function buildGraph() {
  const nodes = [
    { id: 'start_1', type: 'start', position: { x: 80, y: 40 }, data: { label: 'Старт (Telegram)', trigger: 'telegram' } },
    { id: 'js_prep', type: 'js', position: { x: 80, y: 180 }, data: { label: 'Визначити: старт чи продовження', code: JS_PREP_CODE } },
    {
      id: 'agent_capture',
      type: 'agent',
      position: { x: 80, y: 320 },
      data: {
        label: 'Property Capture (agentic loop)',
        dialogMode: true,
        collectPhotos: true,
        model: 'claude-sonnet-4-6',
        connectorId: CLAUDE_CONNECTOR,
        maxTokens: 2048,
        maxIterations: 4,
        systemPrompt: SYSTEM_PROMPT,
        startTrigger: START_TRIGGER,
        outputVar: 'context.propertyCard',
        finishTool: 'complete_capture',
        tools: TOOLS,
      },
    },
    { id: 'js_score', type: 'js', position: { x: 80, y: 560 }, data: { label: 'Listing Readiness Score', code: JS_SCORE_CODE } },
    { id: 'msg_score', type: 'message', position: { x: 80, y: 700 }, data: { label: 'Показати score', text: MSG_SCORE_TEXT } },
    { id: 'cond_ready', type: 'condition', position: { x: 80, y: 840 }, data: { label: 'Score >= поріг?', condition: 'context.listingScore >= context.readyThreshold || context._captureLoopCount > 5' } },
    { id: 'msg_done', type: 'message', position: { x: 320, y: 980 }, data: { label: 'Завершено', text: MSG_DONE_TEXT } },
  ];
  const edges = [
    { id: 'e_start__prep', source: 'start_1', target: 'js_prep' },
    { id: 'e_prep__agent', source: 'js_prep', target: 'agent_capture' },
    { id: 'e_agent__score', source: 'agent_capture', target: 'js_score' },
    { id: 'e_score__msg', source: 'js_score', target: 'msg_score' },
    { id: 'e_msg__cond', source: 'msg_score', target: 'cond_ready' },
    { id: 'e_cond__done', source: 'cond_ready', target: 'msg_done', sourceHandle: 'true' },
    { id: 'e_cond__loop', source: 'cond_ready', target: 'js_prep', sourceHandle: 'false' },
  ];
  return { nodes, edges };
}

const KEYS = [
  ['READY_THRESHOLD', '75', 'Мінімальний % Listing Readiness Score, щоб оголошення вважалось готовим', false],
  // Двигун бере ключ Claude через resolveFunnelClaudeKey — ЛИШЕ з funnelKey
  // CLAUDE_CONNECTOR_ID (packages/claude/src/wrapper.js), а не з node.data.connectorId
  // (те поле суто для відображення в редакторі). Без цього ключа agent-нода мовчки
  // скіпається ("No API key, skipping").
  ['CLAUDE_CONNECTOR_ID', CLAUDE_CONNECTOR, 'Збережений конектор з ключем Claude (Sonnet для воронок)', false],
];

async function main() {
  const { nodes, edges } = buildGraph();

  const project = await prisma.project.upsert({
    where: { slug: PROJECT_SLUG },
    update: {},
    create: {
      name: 'Тетяна Коробова. Нерухомість',
      slug: PROJECT_SLUG,
      description: 'AI-асистент для приймання обʼєктів нерухомості (Іспанія): голос/фото/текст → структурована картка + Listing Readiness Score. MVP: модулі 1-2 з процесу Property Listing Operations.',
    },
  });

  let bot = await prisma.bot.findFirst({ where: { slug: BOT_SLUG } });
  if (!bot) {
    bot = await prisma.bot.create({
      data: {
        projectId: project.id,
        name: 'Тетяна Коробова — Прийом обʼєкта',
        slug: BOT_SLUG,
        description: 'Property Capture + Listing Quality: агент приймає голос/фото/текст про обʼєкт, веде живу картку і рахує % готовності оголошення (Listing Readiness Score), показуючи чого бракує.',
        goal: 'Агентка Тетяна швидко надиктовує дані обʼєкта в Telegram і отримує структуровану картку з оцінкою готовності до публікації.',
        trigger: 'telegram',
        isActive: true,
      },
    });
  } else {
    await prisma.bot.update({ where: { id: bot.id }, data: { projectId: project.id, isActive: true } });
  }

  await prisma.flowDefinition.upsert({
    where: { botId: bot.id },
    update: { nodes, edges },
    create: { botId: bot.id, nodes, edges },
  });

  // Telegram-конектор: додається пізніше, коли зʼявиться токен (див. коментар на початку файлу).
  const tgToken = process.env.KOROBOVA_TELEGRAM_TOKEN;
  let tgConnectorId = null;
  if (tgToken) {
    const existing = await prisma.savedConnector.findFirst({
      where: { type: 'telegram_bot', name: 'Тетяна Коробова. Нерухомість' },
    });
    const saved = existing
      ? await prisma.savedConnector.update({ where: { id: existing.id }, data: { config: { token: tgToken } } })
      : await prisma.savedConnector.create({
          data: {
            name: 'Тетяна Коробова. Нерухомість',
            type: 'telegram_bot',
            description: 'Бот прийому обʼєктів нерухомості',
            config: { token: tgToken },
          },
        });
    tgConnectorId = saved.id;
  }

  const keys = KEYS.slice();
  if (tgConnectorId) keys.push(['TELEGRAM_CONNECTOR_ID', tgConnectorId, 'UUID savedConnector бота', true]);

  for (const [key, value, label, isSecret] of keys) {
    const update = { label, isSecret };
    if (value) update.value = value;
    await prisma.funnelKey.upsert({
      where: { botId_key: { botId: bot.id, key } },
      update,
      create: { botId: bot.id, key, value: value || '', label, isSecret },
    });
  }

  console.log('OK project:', project.id, '| bot:', bot.id, '| nodes:', nodes.length, '| edges:', edges.length);
  if (!tgToken) {
    console.log('⚠️  Telegram-токен не задано — бот створено без TELEGRAM_CONNECTOR_ID.');
    console.log('   Додати пізніше: KOROBOVA_TELEGRAM_TOKEN=<токен> node build-korobova-realty-funnel.js');
    console.log('   або через адмінку /connectors + ключ TELEGRAM_CONNECTOR_ID у воронці.');
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
