'use strict';
// Тести класу «відповідь на підсумок, що питає і "Оформляємо?", і про допродаж» (15.10, FunnelTest 99): коротке «Ні» = без допродажу,
// а пряма відмова від замовлення лишається відмовою. Основа — кроки тесту 99, змінюється лише остання відповідь клієнта.
//   node scripts/qa/tests-upsell-decline-2026-10-15.js   → створює/оновлює тести й друкує їхні id
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const API = path.join(__dirname, '..', '..', 'apps', 'api', 'src', 'services');
const { db } = require(path.join(API, 'shopAgent/lib'));
const FT = require(path.join(API, 'funnelTests'));
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';

async function ensureTest(name, steps, expectedOutcome) {
    const ex = await db.funnelTest.findFirst({ where: { botId: BOT, name } });
    if (ex) { await db.funnelTest.update({ where: { id: ex.id }, data: { steps, expectedOutcome } }); return ex.id; }
    return (await FT.createTest({ botId: BOT, name, steps, expectedOutcome, createdBy: 'claude' })).id;
}

(async () => {
    const base = await db.funnelTest.findFirst({ where: { botId: BOT, id: { startsWith: 'f67b0f34' } } });
    if (!base) throw new Error('тест 99 не знайдено');
    const steps = (t) => base.steps.slice(0, -1).concat([{ ...base.steps[base.steps.length - 1], text: t }]);
    const ids = [];
    ids.push(await ensureTest('15.10 Д1. Підсумок з допродажем → «Ні, не буду замовляти» — це відмова від замовлення',
        steps('Ні, не буду замовляти'),
        'Клієнт прямо відмовився від замовлення. Бот коректно приймає відмову (без тиску, «якщо передумаєте — пишіть»), НЕ пропонує способи оплати, НЕ оформлює замовлення і не переходить до реквізитів.'));
    ids.push(await ensureTest('15.10 Д2. Підсумок з допродажем → «Передумав, нічого не треба» — це відмова від замовлення',
        steps('Передумав, нічого не треба'),
        'Клієнт прямо відмовився від усього замовлення. Бот приймає відмову (без тиску), НЕ пропонує способи оплати і не оформлює замовлення.'));
    ids.push(await ensureTest('15.10 Д3. Підсумок з допродажем → «Не треба» — без футболки, далі до оплати',
        steps('Не треба'),
        '«Не треба» — відповідь на останнє питання підсумку (додати футболку чи лише основний товар). Бот оформлює лише основний товар (кофта A0187) і переходить до вибору способу оплати. НЕ каже «без тиску / якщо передумаєте» і не вважає це відмовою від замовлення.'));
    console.log(ids.join(' '));
    process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
