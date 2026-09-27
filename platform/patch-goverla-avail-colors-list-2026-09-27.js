'use strict';
/*
 * 2026-09-27: n_avail_no ("Ой, саме цей варіант зараз розібрали... напишіть, який ще колір") ніколи не казало,
 * ЯКІ кольори РЕАЛЬНО є в наявності — клієнт мусив вгадувати. Тепер n_avail рахує availableColorsNow (ті самі
 * offerOk/sizeOk перевірки, що й для "missing"), а policy.js (color_unavailable) додає їх у відповідь.
 * Ідемпотентно (перевірка по 'availableColorsNow'). Запуск: node patch-goverla-avail-colors-list-2026-09-27.js
 * (з каталогу platform, DATABASE_URL у оточенні)
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();
const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];
const newCode = fs.readFileSync(__dirname + '/n_avail-code.js', 'utf8');
(async () => {
  for (const botId of BOT_IDS) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) continue;
    let changed = false;
    const nodes = (flow.nodes || []).map((n) => {
      if (n.id !== 'n_avail' || !n.data || typeof n.data.code !== 'string') return n;
      if (n.data.code.includes('availableColorsNow')) { console.log(botId, 'n_avail: вже пропатчено'); return n; }
      changed = true;
      return { ...n, data: { ...n.data, code: newCode } };
    });
    if (changed) { await prisma.flowDefinition.update({ where: { botId }, data: { nodes } }); console.log(botId, 'n_avail: availableColorsNow застосовано'); }
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
