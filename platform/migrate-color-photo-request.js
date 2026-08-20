// Додає можливість "фото на вимогу" (wantsPhoto у json_output) до n_color —
// саме тут стався C1-сценарій ("покажіть фото в салоні"), бот чесно сказав
// "не можу надіслати", хоча платформа технічно вміє (той самий engine-механізм,
// що й для n_set_choice, див. migrate-set-choice-improvements.js).
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const n = nodes.find((x) => x.id === 'n_color');
  if (!n) { console.log('❌ n_color NOT FOUND'); process.exit(1); }
  const sp = String(n.data.systemPrompt || '');
  const marker = 'ЯКЩО клієнт просить фото товару';
  if (sp.includes(marker)) { console.log('✓ вже застосовано'); process.exit(0); }
  const anchor = 'ЯКЩО КЛІЄНТ ПРОСИТЬ ЖИВУ ЛЮДИНУ/МЕНЕДЖЕРА';
  if (!sp.includes(anchor)) { console.log('❌ опорний текст не знайдено — перевір промпт вручну'); process.exit(1); }
  n.data.systemPrompt = sp.replace(anchor, marker + ' ("покажіть фото", "скиньте фото", "як виглядає наживо") — у json_output ДОДАЙ поле "wantsPhoto":true (окремо або разом з іншими полями), і в тексті напиши, що зараз надішлеш фото.\n' + anchor);
  console.log('✅ n_color: додано wantsPhoto');

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }
  require('fs').writeFileSync('_backup_colorphoto_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
