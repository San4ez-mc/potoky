'use strict';
// Patch (source of truth): goverla — n_calc, база «бампа» за зростом. Для бампа (зріст вищий за сітку → на розмір більше) у кандидати
// додається сусідній МЕНШИЙ розмір, якщо вага лише трохи (≤3 кг) вища за його межу (187/86 → XL, як підтвердив власник). Але від XL
// бамп не застосовується («від XL і більше зріст розмір не піднімає») — і тоді лишався саме цей менший сусід: 192/102 → XL, хоча
// вага 102 за сіткою — XXL (100–110). Правка e5caaa72/6878c5c9, сесія a241dccd (Igor Gokh, A0188), 01.10. Тепер без бампа береться
// розмір, у який реально влучає вага. Обидві копії алгоритму (окремий товар і комплект).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-size-bump-base-2026-10-01.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const MARK = 'без бампа — розмір за вагою';

const EDITS = [
    ["size = (nx && chart[nx] && order.indexOf(baseW) < order.indexOf('XL')) ? nx : baseW;",
        "size = (nx && chart[nx] && order.indexOf(baseW) < order.indexOf('XL')) ? nx : wMatches[0]; // без бампа — розмір за вагою (192/102 → XXL, не нижчий сусід XL)"],
    ["size = (nx && __setChart[nx] && __setOrder.indexOf(baseW) < __setOrder.indexOf('XL')) ? nx : baseW;",
        "size = (nx && __setChart[nx] && __setOrder.indexOf(baseW) < __setOrder.indexOf('XL')) ? nx : wMatches[0]; // без бампа — розмір за вагою"],
];

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === NODE);
    if (i < 0) throw new Error('немає ноди ' + NODE);
    let code = String(nodes[i].data.code || '');
    if (code.includes(MARK)) { console.log('already patched'); return; }
    for (const [from, to] of EDITS) {
        if (!code.includes(from)) throw new Error('не знайдено фрагмент: ' + from.slice(0, 70) + ' — код ноди змінився, патч треба оновити');
        code = code.replace(from, to);
    }
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
