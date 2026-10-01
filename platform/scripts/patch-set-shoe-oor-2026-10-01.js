'use strict';
// Patch (source of truth): goverla — n_calc, розрахунок розмірів КОМПЛЕКТУ (тест cfddd671, 01.10):
// (1) Розмір взуття, який клієнт уже назвав («44 розмір взуття»), застосовується до позиції з числовими розмірами (лофери), а не
//     «Розмір оберіть самі: 41…45». Аналізатор кладе EU-розмір у footLength; довжина стопи — 22–32 см, тож 35–50 — це розмір взуття.
// (2) Позиції, для яких на ці параметри розміру немає, повертаються списком setSizeOor — policy не просить для них «оберіть розмір».
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-set-shoe-oor-2026-10-01.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const MARK = '__setOorArts';

const EDITS = [
    ["var __setLines = []; var __setSizeMap = {};",
        "var __setLines = []; var __setSizeMap = {}; var __setOorArts = [];\n  var __shoeEU = (function () { var si = context.sizeInput || {}; var f = Number(si.footLength) || 0; if (f >= 35 && f <= 50) return String(Math.round(f)); var c = String(si.clothingSize || ''); return /^\\d{2}$/.test(c) ? c : ''; })();"],
    ["__itSizeLine = __r.size ? ('Розмір: ' + __r.size) :",
        "if (!__r.size && /буде малий/.test(String(__r.oor || '')) && __it.article) __setOorArts.push(__it.article);\n      __itSizeLine = __r.size ? ('Розмір: ' + __r.size) :"],
    ["__itSizeLine = 'Розмір оберіть самі: ' + __itAvail.join(', ');",
        "if (__shoeEU && __itAvail.indexOf(__shoeEU) >= 0) { __itSizeLine = 'Розмір: ' + __shoeEU; if (__it.article) __setSizeMap[__it.article] = __shoeEU; }\n      else __itSizeLine = 'Розмір оберіть самі: ' + __itAvail.join(', ');"],
    ["isSetSizeCalc: true, setSizeMap: __setSizeMap,",
        "isSetSizeCalc: true, setSizeMap: __setSizeMap, setSizeOor: __setOorArts,"],
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
