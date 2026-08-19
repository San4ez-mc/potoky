// Живий режим для внутрішніх систем (за проханням власника 2026-08-20):
// збереження замовлення в KeyCRM + easydrop-офлайн + brewdrop — вже 0 (live)
// з попередньої сесії. EASYDROP_CART_DRY_RUN (дропшип-кошик, лофери/Zaxid_drop)
// СВІДОМО лишаємо dry-run=1 — EASYDROP_SUPPLIER_ID/NAME для цього постачальника
// ще не заповнені (autocomplete по назві не знаходив), і власник явно попросив
// "крім лоферів". Mono-виписка тепер live за замовчуванням (без testMode-гейту
// на реальних сесіях) + Redis-координація (packages/monoStatement) проти
// одночасних запитів.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

const WANT = {
  BREWDROP_DRY_RUN: '0',
  EASYDROP_DRY_RUN: '0',
  EASYDROP_CART_DRY_RUN: '1', // лофери/Zaxid_drop — свідомо лишаємо dry-run
};

(async () => {
  for (const [key, value] of Object.entries(WANT)) {
    const cur = await db.funnelKey.findUnique({ where: { botId_key: { botId: BOT, key } } });
    console.log(key, ': було', cur ? cur.value : '(нема)', '→ треба', value);
    if (APPLY) {
      await db.funnelKey.upsert({
        where: { botId_key: { botId: BOT, key } },
        update: { value },
        create: { botId: BOT, key, value, isSecret: false },
      });
    }
  }
  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }
  console.log('\n✅ застосовано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
