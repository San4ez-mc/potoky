// Фікс: CLAUDE_CONNECTOR_ID (funnelKey) вказував на СПІЛЬНИЙ Haiku-конектор
// (4a8000aa, "Claude Haiku для воронок") і мав пріоритет над власним
// CLAUDE_API_KEY власника в resolveFunnelClaudeKey() (packages/claude/src/wrapper.js)
// — тому воронка тихо використовувала спільний ключ замість виділеного,
// власник не міг відстежити токени саме цієї воронки окремо.
// Прибираємо CLAUDE_CONNECTOR_ID — резолвер впаде на CLAUDE_API_KEY (вже є).
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

(async () => {
  const before = await db.funnelKey.findUnique({ where: { botId_key: { botId: BOT, key: 'CLAUDE_CONNECTOR_ID' } } });
  const directKey = await db.funnelKey.findUnique({ where: { botId_key: { botId: BOT, key: 'CLAUDE_API_KEY' } } });
  console.log('CLAUDE_CONNECTOR_ID було:', before ? before.value : '(нема)');
  console.log('CLAUDE_API_KEY (виділений, лишиться):', directKey ? '(len ' + (directKey.value || '').length + ')' : '❌ НЕМАЄ — тоді нема на що падати, спершу заповни ключі!');
  if (!directKey || !directKey.value) { console.log('\n⚠️ Зупинено: без CLAUDE_API_KEY воронка лишиться без Claude-ключа взагалі.'); process.exit(1); }

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }
  if (before) await db.funnelKey.delete({ where: { botId_key: { botId: BOT, key: 'CLAUDE_CONNECTOR_ID' } } });
  console.log('✅ CLAUDE_CONNECTOR_ID видалено — тепер резолвиться CLAUDE_API_KEY (виділений ключ)');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
