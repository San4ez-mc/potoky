// КРИТИЧНИЙ ФІКС (живий баг, зловлено власником): клієнт запитав про "чорні
// класичні накидки" посеред оформлення ІНШОГО (тестового) товару — n_order_intent
// мав інструкцію "відповідай з наявних даних", але даних про запитаний товар не
// було, і модель ЗАМІСТЬ чесної відповіді ЗАЯВИЛА "немає каталогу під рукою" —
// хоча каталог KeyCRM насправді доступний, просто engine його туди не підмішував.
// Вмикаємо useCatalog (новий engine-механізм, testSession.js) на нодах, де вже
// є інструкція "відповідай з даних" для позаштатних питань — тепер справжні
// товари з KeyCRM підмішуються в промпт замість вигадки чи відмовки.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const NODES = ['n_order_intent', 'n_pay_collect', 'n_collect', 'n_upsell2_wait'];

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  let changed = 0;
  for (const id of NODES) {
    const n = nodes.find((x) => x.id === id);
    if (!n) { console.log('❌ ' + id + ' NOT FOUND'); continue; }
    if (n.data.useCatalog === true) { console.log('✓ ' + id + ': вже увімкнено'); continue; }
    n.data.useCatalog = true;
    changed++;
    console.log('✅ ' + id + ': useCatalog увімкнено');
  }
  if (!changed) { console.log('\nнічого змінювати'); process.exit(0); }
  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }
  require('fs').writeFileSync('_backup_catalog_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
