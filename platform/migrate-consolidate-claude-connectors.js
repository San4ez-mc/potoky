// Об'єднання 3 Claude-конекторів (haiku/sonnet/opus - усі мали ІДЕНТИЧНИЙ ключ,
// модель обирається на рівні ноди data.model, не конектора) в ОДИН + окремий
// ключ для проєкту "Олексій — одяг" (covercar_ua/goverla_shop), який раніше
// зберігався НАПРЯМУ як funnelKey CLAUDE_API_KEY (не через конектор) і, за словами
// власника, губився при спробі зберегти як конектор через UI (той самий клас
// багу, що ми знайшли й полагодили — null-поле у формі).
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const SURVIVOR_ID = '2ec53ba5-144e-463b-9758-c217c4a69b0e'; // "Claude Sonnet для воронок" -> перейменовуємо
const HAIKU_ID = '4a8000aa-837f-4a73-bf5c-224949ebaf9a';
const OPUS_ID = '6a438f34-40b4-4b86-9aac-84a8f060a806';
const STALE_TYPE_ID = '30edf58a-113e-459e-85c3-e2af1890e639'; // урок §16 CLAUDE.md — type-id замість instance-id

const OLEKSII_BOTS = ['cc03657f-9e72-46e5-a16d-88826e70c2ee', '5bdb3e38-1936-416f-b1f0-8f1125583193'];

(async () => {
  const survivor = await db.savedConnector.findUnique({ where: { id: SURVIVOR_ID } });
  if (!survivor) { console.log('❌ survivor connector не знайдено'); process.exit(1); }

  // Ключ беремо з ЖИВОЇ БД (сирий CLAUDE_API_KEY у covercar), а не хардкодимо в
  // файлі — GitHub push protection слушно блокує коміт із реальним API-ключем.
  const rawKeyRow = await db.funnelKey.findUnique({ where: { botId_key: { botId: OLEKSII_BOTS[0], key: 'CLAUDE_API_KEY' } } });
  const OLEKSII_KEY = (rawKeyRow && rawKeyRow.value) || '';
  if (!OLEKSII_KEY) { console.log('❌ не знайдено CLAUDE_API_KEY у', OLEKSII_BOTS[0]); process.exit(1); }

  const affectedHaiku = await db.funnelKey.findMany({ where: { key: 'CLAUDE_CONNECTOR_ID', value: HAIKU_ID } });
  const affectedStale = await db.funnelKey.findMany({ where: { key: 'CLAUDE_CONNECTOR_ID', value: STALE_TYPE_ID } });

  console.log('План:');
  console.log(`  1) ${SURVIVOR_ID} (${survivor.name}) -> type='claude', name='Claude для воронок' (виживає)`);
  console.log(`  2) ${affectedHaiku.length} ботів з CLAUDE_CONNECTOR_ID=${HAIKU_ID} -> перевести на ${SURVIVOR_ID}`);
  console.log(`  3) ${affectedStale.length} ботів з CLAUDE_CONNECTOR_ID=${STALE_TYPE_ID} (застарілий баг type-id) -> перевести на ${SURVIVOR_ID}`);
  console.log(`  4) видалити (isActive:false) конектори Haiku (${HAIKU_ID}) і Opus (${OPUS_ID})`);
  console.log(`  5) створити НОВИЙ конектор "Claude — Олексій (covercar/goverla)" з окремим ключем`);
  console.log(`  6) ${OLEKSII_BOTS.length} ботів Олексія: CLAUDE_CONNECTOR_ID -> новий конектор, видалити сирий CLAUDE_API_KEY`);

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }

  await db.savedConnector.update({ where: { id: SURVIVOR_ID }, data: { type: 'claude', name: 'Claude для воронок' } });

  for (const row of affectedHaiku) {
    await db.funnelKey.update({ where: { id: row.id }, data: { value: SURVIVOR_ID } });
  }
  for (const row of affectedStale) {
    await db.funnelKey.update({ where: { id: row.id }, data: { value: SURVIVOR_ID } });
  }

  await db.savedConnector.update({ where: { id: HAIKU_ID }, data: { isActive: false } });
  await db.savedConnector.update({ where: { id: OPUS_ID }, data: { isActive: false } });

  const oleksiiConn = await db.savedConnector.create({
    data: {
      name: 'Claude — Олексій (covercar/goverla)',
      type: 'claude',
      description: 'Окремий ключ Anthropic для проєкту "Олексій — одяг" — щоб бачити витрати окремо від решти воронок.',
      config: { api_key: OLEKSII_KEY },
      isActive: true,
    },
  });
  console.log('✅ створено конектор Олексія:', oleksiiConn.id);

  for (const botId of OLEKSII_BOTS) {
    await db.funnelKey.upsert({
      where: { botId_key: { botId, key: 'CLAUDE_CONNECTOR_ID' } },
      update: { value: oleksiiConn.id },
      create: { botId, key: 'CLAUDE_CONNECTOR_ID', value: oleksiiConn.id, label: 'Claude Connector ID', isSecret: false },
    });
    await db.funnelKey.deleteMany({ where: { botId, key: 'CLAUDE_API_KEY' } });
  }

  console.log('\n✅ готово');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
