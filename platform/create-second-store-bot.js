// Створює 2-й бот (клон флоу covercar) — новий Zernio-акаунт + новий Instagram
// для того самого типу товару (накидки/GOVERLA), як просив користувач 2026-08-21.
// Ключі: спільні (CRM/ФОП/банк/постачальники/KB) копіюються з covercar; ключі, що
// прив'язані до КОНКРЕТНОГО Instagram/Zernio-акаунта — порожні плейсхолдери, юзер
// заповнить сам через панель ключів воронки.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const SOURCE_BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

// Ключі, унікальні для КОЖНОГО Instagram/Zernio-акаунта — не копіюємо значення.
const PER_ACCOUNT_KEYS = new Set([
  'INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_BUSINESS_ID', 'INSTAGRAM_USERNAME',
  'ZERNIO_ACCOUNT_ID', 'ZERNIO_API_TOKEN',
  'SHOP_TAG', // хай і той самий бренд — окремий тег критичний для розрізнення сповіщень
]);

(async () => {
  const srcBot = await db.bot.findUnique({ where: { id: SOURCE_BOT } });
  const srcFlow = await db.flowDefinition.findUnique({ where: { botId: SOURCE_BOT } });
  const srcKeys = await db.funnelKey.findMany({ where: { botId: SOURCE_BOT } });
  if (!srcBot || !srcFlow) { console.log('❌ джерело не знайдено'); process.exit(1); }

  const newBotId = require('crypto').randomUUID();
  const newSlug = 'insta-ads-zernio-2';

  console.log('=== НОВИЙ БОТ ===');
  console.log('id:', newBotId);
  console.log('slug:', newSlug, '(на канвасі можна перейменувати назву/опис через "✏️ Редагувати" — slug лишається технічним)');
  console.log('projectId:', srcBot.projectId, '(той самий проєкт «Олексій — одяг»)');
  console.log('\n=== КЛЮЧІ, ЩО СКОПІЮЮТЬСЯ (спільні — CRM, ФОП, банк, постачальники, KB) ===');
  console.log('=== КЛЮЧІ-ПЛЕЙСХОЛДЕРИ (заповнити самому — нові Instagram/Zernio) ===');
  const keyRows = [];
  for (const k of srcKeys) {
    if (k.key === '_CONSUMED_MONO_TX') continue; // рантайм-стан, не конфіг
    if (PER_ACCOUNT_KEYS.has(k.key)) {
      const placeholder = k.key === 'SHOP_TAG' ? 'GOVERLA-2' : 'REPLACE_ME';
      keyRows.push({ botId: newBotId, key: k.key, value: placeholder, isSecret: k.isSecret });
      console.log('  🆕 ' + k.key + ' = "' + placeholder + '"  <- ЗАПОВНИ');
    } else {
      keyRows.push({ botId: newBotId, key: k.key, value: k.value, isSecret: k.isSecret });
    }
  }
  console.log('\n(спільних ключів скопійовано: ' + keyRows.filter((r) => !PER_ACCOUNT_KEYS.has(r.key)).length + ')');

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }

  await db.bot.create({
    data: {
      id: newBotId,
      projectId: srcBot.projectId,
      name: 'Instagram — реклама (Zernio, GOVERLA #2)',
      slug: newSlug,
      description: 'Другий Instagram/Zernio-акаунт для тієї ж товарної лінійки (накидки, GOVERLA) — клон covercar-воронки. Заповни SHOP_TAG/INSTAGRAM_*/ZERNIO_* під новий акаунт.',
      goal: srcBot.goal || null,
      isActive: true,
    },
  });
  await db.flowDefinition.create({
    data: { botId: newBotId, nodes: srcFlow.nodes, edges: srcFlow.edges, viewport: srcFlow.viewport },
  });
  for (const row of keyRows) {
    await db.funnelKey.create({ data: row }).catch((e) => console.log('  ⚠️ ключ ' + row.key + ': ' + e.message));
  }
  console.log('\n✅ бот створено: ' + newBotId + ' (slug: ' + newSlug + ')');
  await db.$disconnect();
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
