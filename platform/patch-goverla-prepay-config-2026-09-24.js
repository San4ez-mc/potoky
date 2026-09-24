'use strict';
/*
 * Аудит постачальників 2026-09-24 (баг 9): n_pay_amount мав зашиту передоплату 200 грн. Для замовлень ≤ 200 грн brewdrop падав
 * (передоплата = сума). Тепер сума передоплати береться з ключа воронки PREPAY_AMOUNT (за замовчуванням 200), а якщо сума
 * замовлення не більша за передоплату — це повна оплата. Ідемпотентно.
 * Запуск: node patch-goverla-prepay-config-2026-09-24.js (з каталогу platform, DATABASE_URL у оточенні)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];
const OLD1 = "out.payAmount = method==='cod'?200:full;";
const NEW1 = "var __pre=Number(keys&&keys.PREPAY_AMOUNT)||200; var __cod=(method==='cod'&&full>__pre); out.payAmount = __cod?__pre:full;";
const OLD2 = "out.payLabel = method==='cod'?('передоплата 200 грн, решта '+(full-200)+' грн при отриманні'):('повна оплата, '+full+' грн');";
const NEW2 = "out.payLabel = __cod?('передоплата '+__pre+' грн, решта '+(full-__pre)+' грн при отриманні'):('повна оплата, '+full+' грн');";
(async () => {
  for (const botId of BOT_IDS) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) continue;
    let changed = false;
    const nodes = (flow.nodes || []).map((n) => {
      if (n.id !== 'n_pay_amount' || !n.data || typeof n.data.code !== 'string') return n;
      if (n.data.code.includes('PREPAY_AMOUNT')) { console.log(botId, 'n_pay_amount: вже пропатчено'); return n; }
      if (!n.data.code.includes(OLD1) || !n.data.code.includes(OLD2)) { console.log(botId, 'n_pay_amount: фрагменти не знайдено'); return n; }
      changed = true;
      return { ...n, data: { ...n.data, code: n.data.code.replace(OLD1, NEW1).replace(OLD2, NEW2) } };
    });
    if (changed) { await prisma.flowDefinition.update({ where: { botId }, data: { nodes } }); console.log(botId, 'n_pay_amount: PREPAY_AMOUNT застосовано'); }
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
