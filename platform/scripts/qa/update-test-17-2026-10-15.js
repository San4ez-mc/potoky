'use strict';
// Тест 17: «200 грн передоплата, решта при отриманні» — умова магазину з бази знань, її назвати можна; заборонено — «До сплати: 200
// (решта …)» для несформованого замовлення, кошик без вибору і обіцянка оплати «на картку» (оплата на рахунок ФОП).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'src', 'services', 'shopAgent/lib'));
(async () => {
    const t = await db.funnelTest.findFirst({ where: { id: { startsWith: 'd31285ee' } } });
    await db.funnelTest.update({ where: { id: t.id }, data: { expectedOutcome: String(t.expectedOutcome) + ' | УТОЧНЕННЯ (15.10): назвати умову магазину з бази знань («передоплата 200 грн, решта при отриманні») — МОЖНА, це не вигадана сума. Заборонено: «До сплати: 200 (решта …)» чи будь-який розрахунок для несформованого замовлення, а також погоджуватись, що платити «на картку» (оплата — на рахунок ФОП).' } });
    console.log('оновлено 17'); process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
