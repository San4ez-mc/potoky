// Патч: наповнює РЕАЛЬНОЮ логікою бота "meta-ads-sync-goverla", який раніше існував лише як
// порожній стаб (0 нод) — crontab б'є щодня, webhook.js бачить порожній flow і мовчки нічого
// не робить (знайдено при розслідуванні 2026-09-13, живий баг реклами: ID/фото/дублі).
// Ідемпотентно — replace flowDefinition повністю (той самий підхід, що для нового np-бота).

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SLUG = 'meta-ads-sync-goverla';
const JS_CODE = fs.readFileSync(path.join(__dirname, 'meta-ads-sync-goverla-code.js'), 'utf8');

(async () => {
  const bot = await prisma.bot.findFirst({ where: { slug: SLUG } });
  if (!bot) { console.log('НЕМАЄ бота зі slug', SLUG, '— пропускаю'); return; }
  console.log('бот знайдено:', bot.id, bot.name);

  const NODES = [
    { id: 'start_1', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Старт (webhook cron)', trigger: '/start ' + SLUG } },
    { id: 'n_meta_sync', type: 'js', position: { x: 320, y: 0 }, data: { label: '1. Синхронізувати оголошення з Meta Graph API', code: JS_CODE, description: 'Тягне ВСІ ads рекламного кабінету (id/campaign/adset/creative), пише в CRM /ads (findFirst-or-update — не дублює).' } },
  ];
  const EDGES = [{ id: 'edge_1', source: 'start_1', target: 'n_meta_sync' }];

  await prisma.flowDefinition.upsert({
    where: { botId: bot.id },
    update: { nodes: NODES, edges: EDGES },
    create: { botId: bot.id, nodes: NODES, edges: EDGES },
  });
  console.log('✅ flow застосовано:', bot.id);
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());
