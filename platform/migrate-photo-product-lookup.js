// Розпізнавання товару зі СКРІНШОТА (клієнт кидає фото сторінки/поста замість
// того, щоб поділитись реальним постом/рілс з Instagram). Додає ПРІОРІТЕТ 2.9
// у n_lookup: коли ad_id/артикул не знайшли товар І є вхідне фото (не квитанція —
// на цьому кроці ще нема orderRef) — ШІ-візія (Gemini) описує фото й підбирає
// найближчий товар з каталогу KeyCRM (передає список "індекс: назва", просить
// повернути bestMatchIndex).
//
// ВАЖЛИВО: n_lookup-code.js мав розбіжність із живим кодом (пізніші sets-міграції
// оновлювали ноду напряму в БД, без синхронізації файлу) — цей скрипт читає
// АКТУАЛЬНИЙ файл (вже синхронізований 2026-08-20) і лише перевіряє, що
// застосовує саме його, не старішу версію.
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const CODE = fs.readFileSync(__dirname + '/n_lookup-code.js', 'utf8');

function compiles(code) {
  try { new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto', 'return (async function(){' + code + '\n})();'); return true; }
  catch (e) { return e.message; }
}

(async () => {
  const c = compiles(CODE);
  if (c !== true) { console.log('❌ не компілюється:', c); process.exit(1); }
  if (!CODE.includes('ПРІОРІТЕТ 2.9')) { console.log('❌ у файлі немає блоку фото-розпізнавання — перевір n_lookup-code.js'); process.exit(1); }
  console.log('✅ компілюється, довжина', CODE.length);

  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const lk = nodes.find(n => n.id === 'n_lookup');
  if (!lk) { console.log('❌ n_lookup не знайдено'); process.exit(1); }
  if (String(lk.data.code) === CODE) { console.log('✓ вже застосовано (код ідентичний)'); process.exit(0); }
  lk.data.code = CODE;

  if (!APPLY) { console.log('DRY-RUN — запусти з --apply'); process.exit(0); }
  fs.writeFileSync('_backup_photolookup_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('✅ n_lookup оновлено — фото-розпізнавання товару активне');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
