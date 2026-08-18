const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const MARK = 'ПРАВИЛО ВЕДЕННЯ ДІАЛОГУ';
const RULE = '\n\n' + MARK + ': кожне твоє повідомлення має вести клієнта далі — ЗАВЖДИ закінчуй конкретним питанням або чітким наступним кроком (що саме зробити/написати). НІКОЛИ не закінчуй просто похвалою чи констатацією («чудовий вибір!», «гарне питання!») — після них клієнт не знає, що робити, і діалог зупиняється.';
// Ноди, які мають бути ТИХИМИ (json-only) — правило не додаємо
const SILENT = ['n_pay_collect', 'n_collect', 'n_size'];
(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  let changed = 0;
  for (const n of nodes) {
    if (n.type !== 'claude') continue;
    const d = n.data || {};
    if (!d.systemPrompt) { console.log('  ⏭', n.id, '(без systemPrompt)'); continue; }
    if (SILENT.includes(n.id)) { console.log('  ⏭', n.id, '(тиха/json-only нода)'); continue; }
    if (String(d.systemPrompt).includes(MARK)) { console.log('  •', n.id, 'вже має правило'); continue; }
    d.systemPrompt = String(d.systemPrompt) + RULE;
    n.data = d; changed++;
    console.log('  ✅', n.id, '(' + (d.label || '') + ')');
  }
  console.log('\nзмінено нод:', changed);
  if (!APPLY) { console.log('DRY-RUN. --apply'); process.exit(0); }
  const fs = require('fs');
  fs.writeFileSync('_backup_askrule_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
