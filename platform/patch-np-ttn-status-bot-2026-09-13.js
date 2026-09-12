// Патч: створює крон-бота "NP — статус посилок (goverla)" — власник: "статус відправлено,
// відповідно воронку отримання статусу посилки по ТТН теж додай в проект флоус і зроби її
// по крону". Той самий патерн, що вже є на сервері для meta-ads-sync-* (crontab → POST
// /webhook/bot/:slug), просто ця воронка РЕАЛЬНО має логіку (на відміну від порожнього стабу
// meta-ads-sync-goverla, знайденого при розслідуванні).
//
// Ідемпотентно: якщо бот зі SLUG вже існує — оновлює лише funnelKeys/код ноди, не дублює бота.

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SOURCE_BOT_ID = 'fcdee415-bef2-4a74-a650-e6e4b5a12322'; // goverla_shop — звідки копіюємо ключі
const SLUG = 'np-ttn-status-goverla';
const BOT_NAME = 'NP — статус посилок (goverla, крон)';
const JS_CODE = fs.readFileSync(path.join(__dirname, 'np-ttn-status-goverla-code.js'), 'utf8');
const KEYS_TO_COPY = ['CRM_API_BASE', 'CRM_API_KEY', 'NOVAPOSHTA_API_KEY', 'ADMIN_TELEGRAM_ID', 'TELEGRAM_BOT_TOKEN'];

(async () => {
  const sourceBot = await prisma.bot.findUnique({ where: { id: SOURCE_BOT_ID }, select: { projectId: true } });
  let bot = await prisma.bot.findFirst({ where: { slug: SLUG } });
  if (!bot) {
    bot = await prisma.bot.create({
      data: {
        projectId: sourceBot?.projectId || null,
        name: BOT_NAME,
        slug: SLUG,
        description: 'Раз на годину перевіряє статус усіх активних ТТН клієнтських відправлень goverla_shop через API Нової Пошти (TrackingDocument.getStatusDocuments) і переводить картку замовлення в CRM на відповідну стадію: "Відправлено" (в дорозі), "Не забрав на пошті" (прибуло, чекає забору), "Клієнт забрав на пошті" (отримано).',
        goal: 'Тримати CRM-стадію замовлення синхронною з реальним статусом посилки в Новій Пошті, без ручного відстеження менеджером.',
        trigger: '(немає — викликається POST /webhook/bot/' + SLUG + ' через crontab сервера)',
        isActive: true,
      },
    });
    console.log('+ створено бота', bot.id, bot.slug);
  } else {
    console.log('= бот вже існує', bot.id, bot.slug);
  }

  for (const key of KEYS_TO_COPY) {
    const src = await prisma.funnelKey.findFirst({ where: { botId: SOURCE_BOT_ID, key } });
    if (!src) { console.log('  ⚠️ джерело не має ключа', key, '— пропускаю'); continue; }
    await prisma.funnelKey.upsert({
      where: { botId_key: { botId: bot.id, key } },
      update: { value: src.value, isSecret: src.isSecret },
      create: { botId: bot.id, key, value: src.value, isSecret: src.isSecret, label: src.label },
    });
    console.log('  ~ ключ скопійовано:', key);
  }

  const NODES = [
    { id: 'start_1', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Старт (webhook cron)', trigger: '/start ' + SLUG } },
    { id: 'n_np_sync', type: 'js', position: { x: 320, y: 0 }, data: { label: '1. Перевірити статуси ТТН у НП', code: JS_CODE, description: 'Best-effort, один прохід = одна перевірка. Викликається крон-запитом (webhook), не діалогом.' } },
  ];
  const EDGES = [{ id: 'edge_1', source: 'start_1', target: 'n_np_sync' }];

  await prisma.flowDefinition.upsert({
    where: { botId: bot.id },
    update: { nodes: NODES, edges: EDGES },
    create: { botId: bot.id, nodes: NODES, edges: EDGES },
  });
  console.log('✅ flow застосовано:', bot.id);
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());
