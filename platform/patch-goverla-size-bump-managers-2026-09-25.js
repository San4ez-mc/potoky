'use strict';
/*
 * Рішення власника 2026-09-25: підбір розміру «як менеджери» — високий зріст піднімає розмір лише для легких/середніх
 * (база L і менше). Якщо за вагою вже XL і більше, зріст розмір не піднімає (188/89 → XL, 193/87 → XL, а не XXL).
 * Правка коду вузла n_calc (основний шлях зріст+вага). Ідемпотентно.
 * Запуск: node patch-goverla-size-bump-managers-2026-09-25.js (з каталогу platform, DATABASE_URL у оточенні)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];
const OLD = 'var baseW = bumpCands[0]; var nx = order[order.indexOf(baseW) + 1]; size = (nx && chart[nx]) ? nx : baseW;';
const NEW = "var baseW = bumpCands[0]; var nx = order[order.indexOf(baseW) + 1]; size = (nx && chart[nx] && order.indexOf(baseW) < order.indexOf('XL')) ? nx : baseW; // від XL і більше зріст розмір не піднімає (як менеджери)";
(async () => {
  for (const botId of BOT_IDS) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) continue;
    let changed = false;
    const nodes = (flow.nodes || []).map((n) => {
      if (n.id !== 'n_calc' || !n.data || typeof n.data.code !== 'string') return n;
      if (n.data.code.includes('як менеджери')) { console.log(botId, 'n_calc: вже пропатчено'); return n; }
      if (!n.data.code.includes(OLD)) { console.log(botId, 'n_calc: фрагмент не знайдено'); return n; }
      changed = true; return { ...n, data: { ...n.data, code: n.data.code.replace(OLD, NEW) } };
    });
    if (changed) { await prisma.flowDefinition.update({ where: { botId }, data: { nodes } }); console.log(botId, 'n_calc: правило зросту оновлено'); }
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
