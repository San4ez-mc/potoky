'use strict';
// Patch (source of truth): goverla — n_calc, правило «XL + верх ваги + високий → XXL» (рішення власника 06.10, Edit be349f47).
// Олексій: «187/96 — краще ХХЛ, ХЛ буде впритик». Було: від XL зріст розмір не піднімає (187/96 → XL).
// Тепер: якщо за вагою виходить XL, вага у верхніх 5 кг діапазону XL (за SIZE_CHART — 95–100) і зріст вищий за сітку XL —
// XXL (якщо він є в товару). Нижче XL бамп за зростом був і раніше; вище XXL правило не поширюється (не погоджено).
// Обидві копії алгоритму (окремий товар і позиції комплекту) — урок 15.25.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-size-xl-top-2026-10-07.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const MARK = '__xlTop';
const HELPER = '// XL + вага у верхніх 5 кг діапазону XL + зріст вище сітки → XXL, якщо є в товару (власник 06.10, patch-size-xl-top-2026-10-07.js).\n'
    + 'function __xlTop(base, w, ch, nx, av) { if (base !== \'XL\' || !nx || !ch || !ch[nx] || !ch.XL || !ch.XL.weight) return false; if (Number(w) < Number(ch.XL.weight[1]) - 5) return false; var la = (av || []).map(function (a) { return String(a).toUpperCase().trim().replace(/^2XL$/, \'XXL\').replace(/^3XL$/, \'XXXL\'); }); return !la.length || la.indexOf(nx) >= 0; }\n';

// [фрагмент, заміна, скільки разів має зустрітись]
const EDITS = [
    ["size = (nx && chart[nx] && order.indexOf(baseW) < order.indexOf('XL')) ? nx", "size = (nx && chart[nx] && (order.indexOf(baseW) < order.indexOf('XL') || __xlTop(baseW, w, chart, nx, avail))) ? nx", 1],
    ["size = (nx && __setChart[nx] && __setOrder.indexOf(baseW) < __setOrder.indexOf('XL')) ? nx", "size = (nx && __setChart[nx] && (__setOrder.indexOf(baseW) < __setOrder.indexOf('XL') || __xlTop(baseW, __setW, __setChart, nx, avail))) ? nx", 1],
];

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === NODE);
    if (i < 0) throw new Error('немає ноди ' + NODE);
    let code = String(nodes[i].data.code || '');
    if (code.includes(MARK)) { console.log('already patched'); return; }
    for (const [from, to, n] of EDITS) {
        const cnt = code.split(from).length - 1;
        if (cnt !== n) throw new Error('фрагмент «' + from + '» зустрівся ' + cnt + ' раз(и), очікувалось ' + n + ' — код ноди змінився, патч треба оновити');
        code = code.split(from).join(to);
    }
    code = HELPER + code;
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
