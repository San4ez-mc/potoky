'use strict';
/*
 * Рішення власника 2026-09-24: чистого накладеного платежу (без передоплати) в магазині немає, виняток бот сам не пропонує.
 * n_agent_trust2 раніше питав «Якщо зробимо виняток і відправимо без передплати — обіцяєте?» — тепер чесно повторює
 * умови й пропонує варіант 2 (повна оплата) або передачу менеджеру. Ідемпотентно.
 * Запуск: node patch-goverla-trust2-no-exception-2026-09-24.js (з каталогу platform, DATABASE_URL у оточенні)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];
const NEW_TEXT = 'Розумію вас 🙏 Але без передоплати ми, на жаль, не відправляємо — мінімальна передплата 200 грн (решта накладним платежем при отриманні). Якщо зараз незручно — можна оплатити повну суму (варіант 2). Або напишіть «менеджер», і колега підключиться та розгляне ваш випадок 💛';
(async () => {
  for (const botId of BOT_IDS) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) continue;
    let changed = false;
    const nodes = (flow.nodes || []).map((n) => {
      if (n.id !== 'n_agent_trust2' || !n.data) return n;
      if (n.data.text === NEW_TEXT) return n;
      changed = true; return { ...n, data: { ...n.data, text: NEW_TEXT } };
    });
    console.log(botId, changed ? 'n_agent_trust2 оновлено' : 'без змін');
    if (changed) await prisma.flowDefinition.update({ where: { botId }, data: { nodes } });
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
