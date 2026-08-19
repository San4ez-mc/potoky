// КРИТИЧНИЙ ФІКС: gemini-1.5-flash — deprecated модель (404 not found), а
// GEMINI_API_KEY (ключ воронки) був НЕВАЛІДНИЙ (окремий ключ, не збережений
// конектор). Це ламало ОБИДВА vision-механізми мовчки (try/catch ковтав помилку):
// (1) n_reconcile крок 3 — розпізнавання скріна квитанції (резерв, коли Mono
//     не знайшов), (2) n_lookup — розпізнавання товару зі скріна (нова фіча).
// Фікс: модель → gemini-2.5-flash (стабільна, підтверджено ListModels), ключ
// GEMINI_API_KEY → валідне значення зі збереженого конектора «Gemini для
// воронок» (e94f5f54-b19b-4d9c-b8aa-e88bcc4194d1), бо js-ноди не мають доступу
// до savedConnector напряму — тільки funnelKey.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

(async () => {
  // 1) модель у n_reconcile
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const rec = nodes.find(n => n.id === 'n_reconcile');
  let changed = false;
  if (rec && String(rec.data.code || '').includes('gemini-1.5-flash')) {
    rec.data.code = rec.data.code.replace(/gemini-1\.5-flash/g, 'gemini-2.5-flash');
    changed = true;
    console.log('✅ n_reconcile: модель gemini-1.5-flash → gemini-2.5-flash');
  } else {
    console.log('✓ n_reconcile: модель вже актуальна або нода не знайдена');
  }

  // 2) валідний ключ з конектора
  const connector = await db.savedConnector.findUnique({ where: { id: 'e94f5f54-b19b-4d9c-b8aa-e88bcc4194d1' } });
  const validKey = connector && connector.config && connector.config.api_key;
  if (!validKey) { console.log('❌ не знайшов ключ у конекторі'); process.exit(1); }
  const before = await db.funnelKey.findUnique({ where: { botId_key: { botId: BOT, key: 'GEMINI_API_KEY' } } });
  console.log('GEMINI_API_KEY було:', before ? '(len ' + (before.value || '').length + ')' : '(нема)');

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }
  if (changed) {
    require('fs').writeFileSync('_backup_geminifix_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
    await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  }
  await db.funnelKey.upsert({
    where: { botId_key: { botId: BOT, key: 'GEMINI_API_KEY' } },
    update: { value: validKey },
    create: { botId: BOT, key: 'GEMINI_API_KEY', value: validKey, label: 'Gemini API key (vision)', isSecret: true },
  });
  console.log('✅ GEMINI_API_KEY оновлено на валідне значення з конектора');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
