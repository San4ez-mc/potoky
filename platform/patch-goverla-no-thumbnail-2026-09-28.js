'use strict';
/*
 * 2026-09-28 (власник): мініатюра товару (thumbnailUrl) у CRM — лише для списку товарів, клієнту її не надсилаємо ніколи.
 * n_set_apply (вибір окремої позиції комплекту) додавав її першим фото. Точкова заміна рядка в коді ноди, ідемпотентно.
 * Запуск: node patch-goverla-no-thumbnail-2026-09-28.js (з каталогу platform, DATABASE_URL у оточенні)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];
const OLD = 'if (found.thumbnailUrl) { var tu = resolveUrl(found.thumbnailUrl); if (tu) imgs.push(tu); }';
const NEW = '// мініатюра (thumbnailUrl) — лише для списку товарів у CRM, клієнту не надсилається';
(async () => {
  for (const botId of BOT_IDS) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) continue;
    let changed = false;
    const nodes = (flow.nodes || []).map((n) => {
      if (!n.data || typeof n.data.code !== 'string' || !n.data.code.includes(OLD)) return n;
      changed = true; console.log(botId, n.id, ': мініатюру прибрано');
      return { ...n, data: { ...n.data, code: n.data.code.split(OLD).join(NEW) } };
    });
    if (changed) await prisma.flowDefinition.update({ where: { botId }, data: { nodes } });
    else console.log(botId, 'нічого міняти (вже пропатчено)');
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
