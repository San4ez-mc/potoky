'use strict';
// Patch (source of truth): goverla — n_pay_amount: товар із нульовою ціною не множиться на акційну ціну за кількість (14.10).
//
// Що сталось (_yaroslav01__, set1112 без лоферів): склад комплекту змінено → ціна самого комплекту 0, речі — додатковими позиціями
// (3318 грн). На «Оформляємо» аналізатор поклав кольори трьох речей у orderIntent.units → qty 3 → tierTotal({"2":2199}, 0, 3) = 2199
// → «решта 5317 грн при отриманні» замість 3118. Акційна ціна «2 шт» діє лише для товару з ціною; ціна 0 = товар рахується позиціями.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-goverla-pay-amount-set-2026-10-14.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const OLD = 'var full=tierTotal(context.product&&context.product.qtyPrices, unit, qty);';
const NEW = '// Ціна 0 (комплект зі зміненим складом — рахується позиціями): без акції «N шт» (14.10, _yaroslav01__: 0×3 → 2199 грн).\nvar full=unit>0?tierTotal(context.product&&context.product.qtyPrices, unit, qty):0;';

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === 'n_pay_amount');
    if (i < 0) throw new Error('немає n_pay_amount');
    const code = String(nodes[i].data.code || '');
    if (code.includes('var full=unit>0?')) { console.log('n_pay_amount already patched'); return; }
    if (!code.includes(OLD)) throw new Error('n_pay_amount змінено вручну, не чіпаю');
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code: code.replace(OLD, NEW) } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched n_pay_amount');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
