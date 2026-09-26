'use strict';
/*
 * 2026-09-26 (новий тест «оплата 100 грн замість 200»): n_reconcile підтверджував оплату за збігом orderRef у призначенні
 * БЕЗ перевірки суми — клієнт, що переказав 100 грн із правильним референсом, отримував «замовлення оформлене» і йшов
 * постачальнику. Тепер: збіг за референсом з сумою МЕНШЕ очікуваної → payStatus 'partial' (payPaidAmount/payShortAmount),
 * підтвердження лише при сумі ≥ очікуваної; payPaidAmount повертається й при 'confirmed' (для позначки про переплату).
 * Ідемпотентно. Запуск: node patch-goverla-reconcile-amount-2026-09-26.js (з каталогу platform, DATABASE_URL у оточенні)
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();
const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];
const R = [
  ["var via = found ? 'mono:ref' : '';",
   "var via = found ? 'mono:ref' : '';\nvar partialTx = null; if(found && expected && Number(found.amountUah)+0.01 < expected){ partialTx = found; found = null; via = ''; }"],
  ["payVia:via, payTxId:found.id,", "payVia:via, payPaidAmount:Number(found.amountUah)||0, payTxId:found.id,"],
  ["return { payStatus:'not_found', payStatusText:'ще не скинуто', payVia:'none', payConfirmedLine:'' };",
   "if(partialTx){ return { payStatus:'partial', payStatusText:'часткова оплата', payVia:'mono:ref', payPaidAmount:Number(partialTx.amountUah), payShortAmount:Math.round((expected-Number(partialTx.amountUah))*100)/100, payConfirmedLine:'' }; }\nreturn { payStatus:'not_found', payStatusText:'ще не скинуто', payVia:'none', payConfirmedLine:'' };"],
];
function apply(code) {
  if (code.includes('partialTx')) return null;
  let c = code;
  for (const [a, b] of R) { if (!c.includes(a)) throw new Error('fragment not found: ' + a.slice(0, 50)); c = c.replace(a, b); }
  return c;
}
(async () => {
  try { const f = 'n_reconcile-code.js'; const c = fs.readFileSync(f, 'utf8'); const n = apply(c); if (n) { fs.writeFileSync(f, n); console.log('n_reconcile-code.js оновлено'); } } catch (e) { console.log('файл n_reconcile-code.js:', e.message); }
  for (const botId of BOT_IDS) {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
    if (!flow) continue;
    let changed = false;
    const nodes = (flow.nodes || []).map((n) => {
      if (n.id !== 'n_reconcile' || !n.data || typeof n.data.code !== 'string') return n;
      const nc = apply(n.data.code);
      if (!nc) { console.log(botId, 'n_reconcile: вже пропатчено'); return n; }
      changed = true; return { ...n, data: { ...n.data, code: nc } };
    });
    if (changed) { await prisma.flowDefinition.update({ where: { botId }, data: { nodes } }); console.log(botId, 'n_reconcile: суму перевіряємо'); }
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
