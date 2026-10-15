'use strict';
// Тести 76/80/95 писались до правила власника 03.10 «на межі двох розмірів — більший» (n_calc, patch-size-boundary-avail-2026-10-03.js):
// 180/85 — рівно межа L/XL → XL; 194/100 — межа XL/XXL → XXL. Оновлюємо очікування під чинне правило.
//   node scripts/qa/update-size-boundary-tests-2026-10-15.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'src', 'services', 'shopAgent/lib'));
const FIX = [
    ['fd3d01bd', /розмір L/g, 'розмір XL (180/85 — рівно межа L/XL; за правилом власника 03.10 на межі — більший)'],
    ['8498837b', /рекомендує розмір L/g, 'рекомендує розмір XL (180/85 — межа L/XL, на межі — більший, правило власника 03.10)'],
    ['6b4c5fba', /за правилом власника \(за зростом розмір піднімається лише до XL: 194\/100 → XL\)/g, 'за сіткою (194/100: вага 100 — рівно межа XL/XXL, за правилом власника 03.10 на межі — більший → XXL; XL теж прийнятний)'],
];
(async () => {
    for (const [p, re, to] of FIX) {
        const t = await db.funnelTest.findFirst({ where: { id: { startsWith: p } } });
        if (!t) { console.log('нема', p); continue; }
        const nx = String(t.expectedOutcome).replace(re, to);
        if (nx === t.expectedOutcome) { console.log('без змін (шаблон не знайдено)', p); continue; }
        await db.funnelTest.update({ where: { id: t.id }, data: { expectedOutcome: nx } });
        console.log('оновлено', p);
    }
    process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
