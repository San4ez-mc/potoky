// Окрема службова воронка ЛИШЕ для одноразової верифікації Meta App webhook
// (hub.challenge-рукостискання на developers.facebook.com → Webhooks). Не бере
// участі в реальних повідомленнях — ті йдуть через Zernio в основних воронках
// (covercar_ua, goverla_shop). App-level webhook у Meta один на весь застосунок,
// не per-акаунт — тому одна службова воронка обслуговує ВСІ поточні й майбутні
// IG-акаунти під App ID 3843109942498932 назавжди.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const PROJECT_ID = 'e57c9fe3-79fd-4f69-8955-ca1be807f73f'; // Олексій — одяг
const APPLY = process.argv.includes('--apply');

(async () => {
  const existing = await db.bot.findFirst({ where: { slug: 'meta-webhook-verify' } });
  if (existing) { console.log('✓ вже існує:', existing.id); process.exit(0); }

  const nodes = [
    {
      id: 'start',
      type: 'start',
      position: { x: 0, y: 0 },
      data: {
        label: 'Meta webhook verify',
        trigger: 'webhook',
        description: 'Службова воронка: тут НІЧОГО не виконується по-справжньому. GET /webhook/instagram/:botId відповідає на hub.challenge Meta ще ДО того, як запит дійде до движка воронок (обробка на рівні роута apps/api/src/routes/webhook.js). Ключ INSTAGRAM_VERIFY_TOKEN тут — те саме значення, яке вписуєш у форму Meta.',
      },
    },
  ];

  console.log('DRY-RUN — створю бота:');
  console.log('  name: Meta Webhook Verify (Олексій — одяг)');
  console.log('  slug: meta-webhook-verify');
  console.log('  project:', PROJECT_ID);

  if (!APPLY) { console.log('\nзапусти з --apply'); process.exit(0); }

  const bot = await db.bot.create({
    data: {
      projectId: PROJECT_ID,
      name: 'Meta Webhook Verify (App 3843109942498932)',
      slug: 'meta-webhook-verify',
      description: 'Службова воронка — ТІЛЬКИ для одноразової верифікації webhook у Meta for Developers (App → Webhooks → Callback URL/Verify Token). Не обробляє реальні повідомлення — ті йдуть через Zernio в covercar_ua/goverla_shop. Один URL обслуговує весь застосунок, а не окремий магазин.',
      goal: 'Пройти верифікацію hub.challenge для Meta App webhook subscription. Нічого іншого не робить.',
      isActive: true,
      settings: {},
    },
  });

  await db.flowDefinition.create({
    data: { botId: bot.id, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  });

  await db.funnelKey.create({
    data: {
      botId: bot.id, key: 'INSTAGRAM_VERIFY_TOKEN', value: '', label: 'Verify Token для форми Meta App → Webhooks',
      isSecret: true,
    },
  });
  await db.funnelKey.create({
    data: { botId: bot.id, key: 'FUNNEL_CHANNELS', value: JSON.stringify(['instagram']), label: 'Канали запуску воронки', isSecret: false },
  });

  console.log('\n✅ створено:', bot.id);
  console.log('   Callback URL для Meta: https://flows.fineko.space/webhook/instagram/' + bot.id);
  console.log('   Verify Token: заповни ключ INSTAGRAM_VERIFY_TOKEN у панелі "Ключі" — те саме значення встав у форму Meta.');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
