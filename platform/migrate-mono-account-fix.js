// КРИТИЧНИЙ ФІКС: MONO_ACCOUNT_ID='0' (дефолтний акаунт) НЕ відповідав FOP_IBAN
// (UA703220010000026002310097579) — виписка перевіряла не той рахунок, тому
// звірка РЕАЛЬНИХ платежів клієнтів НІКОЛИ б не спрацювала (завжди not_found).
// Знайдено 2026-08-20 живим тестом 1 грн через реальний ланцюжок n_mono_fetch→
// n_reconcile (не ad-hoc скрипт) — після фіксу payStatus:confirmed, payVia:mono:ref.
// Правильний account id визначено через client-info API (акаунт типу 'fop',
// currencyCode 980, той самий IBAN, що й FOP_IBAN).
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const CORRECT_ACCOUNT_ID = 'cCZrhyBm-DTKzeuHKIlR_g';

(async () => {
  const before = await db.funnelKey.findUnique({ where: { botId_key: { botId: BOT, key: 'MONO_ACCOUNT_ID' } } });
  console.log('було:', before ? before.value : '(нема)');
  await db.funnelKey.upsert({
    where: { botId_key: { botId: BOT, key: 'MONO_ACCOUNT_ID' } },
    update: { value: CORRECT_ACCOUNT_ID },
    create: { botId: BOT, key: 'MONO_ACCOUNT_ID', value: CORRECT_ACCOUNT_ID, label: 'Monobank account id (ФОП)', isSecret: false },
  });
  console.log('стало:', CORRECT_ACCOUNT_ID);
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
