'use strict';
// Patch (source of truth): goverla — n_calc, уточнення правила «на межі двох розмірів — більший» (patch-size-boundary-larger-2026-10-03).
// Власник 03.10: «правило вірне, просто не для найбільшого розміру». FunnelTest 37: 176/110 — вага на межі XXL (100–110) і XXXL
// (110–120); правило брало XXXL, а в кофти A0187 / футболки L0056 найбільший XXL → «на ваші параметри розміру немає», хоча кофта до 110 кг.
// Тепер на межі береться НАЙБІЛЬШИЙ із межових розмірів, ЯКИЙ Є В ТОВАРУ (avail); у товару без структурованих розмірів — як було.
// Обидві копії алгоритму (окремий товар і позиції комплекту).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-size-boundary-avail-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const MARK = '__largestAvail';
const HELPER = '// На межі двох розмірів — більший, але лише з тих, що є в товару (власник 03.10, patch-size-boundary-avail-2026-10-03.js).\n'
    + 'function __largestAvail(list, av) { var la = (av || []).map(function (a) { return String(a).toUpperCase().trim().replace(/^2XL$/, \'XXL\').replace(/^3XL$/, \'XXXL\'); }); for (var i = list.length - 1; i >= 0; i--) { if (!la.length || la.indexOf(String(list[i]).toUpperCase()) >= 0) return list[i]; } return list[list.length - 1]; }\n';

// [фрагмент, заміна, скільки разів має зустрітись]
const EDITS = [
    ['if (hOk.length) size = hOk[hOk.length - 1];', 'if (hOk.length) size = __largestAvail(hOk, avail);', 2],
    ['? nx : wMatches[wMatches.length - 1];', '? nx : __largestAvail(wMatches, avail);', 2],
    ['else size = wMatches[wMatches.length - 1];', 'else size = __largestAvail(wMatches, avail);', 2],
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
