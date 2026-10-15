// Патч: наповнює РЕАЛЬНОЮ логікою бота "meta-ads-sync-goverla", який раніше існував лише як
// порожній стаб (0 нод) — crontab б'є щодня, webhook.js бачить порожній flow і мовчки нічого
// не робить (знайдено при розслідуванні 2026-09-13, живий баг реклами: ID/фото/дублі).
// Ідемпотентно. 2026-10-15: раніше замінював flowDefinition ЦІЛКОМ — перезапуск 06.10 (postId) стер вузол n_meta_spend
// (scripts/patch-meta-sync-insights-2026-10-03.js), і витрати з Ads Manager тиждень не надходили в CRM (Edits 07546f09).
// Тепер оновлює лише код n_meta_sync (або створює start+n_meta_sync у порожньому flow); інші вузли й звʼязки не чіпає.

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

  const flow = await prisma.flowDefinition.findUnique({ where: { botId: bot.id } });
  if (!flow) {
    await prisma.flowDefinition.create({ data: { botId: bot.id, nodes: NODES, edges: EDGES } });
    console.log('✅ flow створено:', bot.id);
    return;
  }
  const nodes = (flow.nodes || []).slice(); const edges = (flow.edges || []).slice();
  for (const n of NODES) {
    const i = nodes.findIndex((x) => x.id === n.id);
    if (i < 0) nodes.push(n);
    else if (n.id === 'n_meta_sync') nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code: JS_CODE } };
  }
  for (const e of EDGES) if (!edges.some((x) => x.source === e.source && x.target === e.target)) edges.push(e);
  await prisma.flowDefinition.update({ where: { botId: bot.id }, data: { nodes, edges } });
  console.log('✅ n_meta_sync оновлено (інші вузли збережено):', nodes.map((n) => n.id).join(', '));
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());
