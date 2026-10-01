'use strict';
// Patch (source of truth): goverla — n_calc, розрахунок розміру для КОМПЛЕКТУ. Скорочена копія основного алгоритму не мала двох
// правил, які є для окремого товару: (1) «від XL і більше зріст розмір не піднімає» (як менеджери) — 187/91 для кофти в комплекті
// давало XXL, а окремо — XL (знайдено 01.10 при перевірці правки 89b80358, сесія c0fd10a4); (2) живіт/талія ≥105 → на розмір більше
// (правка 9412b11f). Тепер комплект рахує за тими самими правилами.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-set-size-calc-2026-10-01.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const MARK = '__setBellyNx';

const EDITS = [
    ["var baseW = bumpCands[0]; var nx = __setOrder[__setOrder.indexOf(baseW) + 1]; size = (nx && __setChart[nx]) ? nx : baseW;",
        "var baseW = bumpCands[0]; var nx = __setOrder[__setOrder.indexOf(baseW) + 1]; size = (nx && __setChart[nx] && __setOrder.indexOf(baseW) < __setOrder.indexOf('XL')) ? nx : baseW; // від XL і більше зріст розмір не піднімає — як для окремого товару"],
    ["    if (!size) return { oor: 'не визначено за зростом/вагою' };",
        "    if (!size) return { oor: 'не визначено за зростом/вагою' };\n    // Живіт або талія ≥105 см → на розмір більше — те саме правило, що й для окремого товару (правка 9412b11f).\n    if ((context.sizeInput.belly === true || Number(context.sizeInput.waist) >= 105) && __setOrder.indexOf(size) >= 0) { var __setBellyNx = __setOrder[__setOrder.indexOf(size) + 1]; if (__setBellyNx && (!avail.length || avail.indexOf(__setBellyNx) >= 0)) size = __setBellyNx; }"],
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
        if (!code.includes(from)) throw new Error('не знайдено фрагмент: ' + from.slice(0, 60) + ' — код ноди змінився, патч треба оновити');
        code = code.replace(from, to);
    }
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
