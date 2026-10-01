'use strict';
// Patch (source of truth): goverla — n_calc, розмір взуття (02.10, тест 162: «лофери 44» → бот казав «такого розміру немає»).
// Аналізатор тепер кладе EU-розмір у sizeInput.shoeSize (а не у footLength, де 44 читалось як 44 см стопи → поза сіткою).
// (1) Окремий товар з числовою сіткою (лофери): названий розмір взуття = розмір клієнта, і зріст/вага його не перебивають.
// (2) Комплект: позиція з числовою сіткою бере shoeSize.
//
// Idempotent. Запуск на сервері (після git pull, після patch-set-shoe-oor-2026-10-01.js):  node scripts/patch-shoe-size-calc-2026-10-02.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const MARK = '__numAvail';

const EDITS = [
    ["var clientSize = s.clothingSize ? String(s.clothingSize).toUpperCase().trim() : '';\nif (clientSize && !(w && h)) {",
        "var __numAvail = avail.length > 0 && avail.every(function (a) { return /^\\d/.test(String(a)); });\nvar clientSize = s.clothingSize ? String(s.clothingSize).toUpperCase().trim() : ((s.shoeSize && __numAvail) ? String(s.shoeSize) : '');\nif (clientSize && (!(w && h) || __numAvail)) {"],
    ["var si = context.sizeInput || {}; var f = Number(si.footLength) || 0;",
        "var si = context.sizeInput || {}; if (Number(si.shoeSize) >= 34 && Number(si.shoeSize) <= 50) return String(Math.round(Number(si.shoeSize))); var f = Number(si.footLength) || 0;"],
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
