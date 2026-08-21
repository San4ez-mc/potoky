// Продовження migrate-payment-flow-fixes.js: живий тест (P1) показав, що не лише
// n_order_intent може продублювати нумероване меню оплати 1️⃣/2️⃣ на побічне питання —
// n_set_choice і n_color ТЕЖ мають useKb:true (той самий FAQ з деталями комісії),
// тож та сама проблема може статись на БУДЬ-ЯКОМУ з цих кроків, не лише на
// n_order_intent. Додаємо ту саму заборону їм обом.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);

const ADDITION = NL + 'Якщо клієнт питає про СПОСІБ оплати (передоплата/накладений/скільки зараз платити) — відповідай КОРОТКО одним реченням (напр. "можна частково зараз, решту при отриманні, або повністю одразу — на наступному кроці зручно оберете"). НІКОЛИ не показуй нумероване меню 1️⃣/2️⃣ з цифрами — це окремий наступний крок (n_pay), він формально запитає раз; якщо ти покажеш те саме меню зараз, клієнту доведеться відповідати двічі.';

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const marker = 'НІКОЛИ не показуй нумероване меню';
  for (const id of ['n_set_choice', 'n_color']) {
    const n = nodes.find((x) => x.id === id);
    if (!n) { console.log('❌ ' + id + ' NOT FOUND'); continue; }
    const sp = String(n.data.systemPrompt || '');
    if (sp.includes(marker)) { console.log('✓ ' + id + ' вже виправлено'); continue; }
    n.data.systemPrompt = sp + ADDITION;
    console.log('✅ ' + id + ': заборона дублювати меню оплати');
  }

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }
  require('fs').writeFileSync('_backup_paymenu2_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
