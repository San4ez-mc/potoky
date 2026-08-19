// КРИТИЧНИЙ ФІКС: n_upsell2_wait (і будь-яка нода після оплати) НЕ має права
// підтверджувати статус оплати — вона не бачить реального payStatus. Живий тест
// показав: клієнт скинув квитанцію ПІСЛЯ того, як звірка вже пройшла (payStatus
// лишився not_found через MONO_ACCOUNT_ID-баг), а бот на цій ноді радісно написав
// "Платіж підтверджено!" — чиста галюцинація, що вводить клієнта в оману про
// реальний стан замовлення. Див. migrate-mono-account-fix.js (та сама сесія-тест).
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

const GUARD = ' ЗАБОРОНЕНО стверджувати щось про статус оплати ("підтверджено", "оплата пройшла", "зарахували") — ти цього НЕ бачиш. Якщо клієнт пише про оплату/квитанцію/чек — тепло подякуй і скажи, що команда звірить і напише окремо, без слова "підтверджено".';

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes || []));
  const n = nodes.find(x => x.id === 'n_upsell2_wait');
  if (!n) { console.log('❌ n_upsell2_wait NOT FOUND'); process.exit(1); }
  const sp = String(n.data.systemPrompt || '');
  if (sp.includes('ЗАБОРОНЕНО стверджувати щось про статус оплати')) { console.log('✓ вже застосовано'); process.exit(0); }
  n.data.systemPrompt = sp + '\n' + GUARD;
  console.log('✅ n_upsell2_wait: додано guard проти фейкового підтвердження оплати');

  if (!APPLY) { console.log('\nDRY-RUN'); process.exit(0); }
  require('fs').writeFileSync('_backup_payhalluc_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
