'use strict';
// Patch (source of truth): goverla — n_calc, вага рівно на межі двох розмірів → БІЛЬШИЙ (рішення власника 03.10).
// Живий кейс Edit 47d4aabf/b0058120: 195/100 → бот XL, Олексій: XXL. Таблиця: XL 85–100, XXL 100–110 — 100 кг входить в обидва,
// алгоритм брав менший (wMatches[0]/hOk[0]). Тепер у всіх трьох місцях вибору — найбільший із розмірів, куди влучає вага
// (і зріст, якщо влучає). Перевірено на всіх підтверджених Олексієм парах: 195/100 → XXL; 187/85, 187/86, 187/91 → XL; 192/102 → XXL.
// Обидві копії алгоритму (окремий товар і комплект).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-size-boundary-larger-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const MARK = 'на межі двох розмірів — більший';

// [фрагмент, заміна, скільки разів має зустрітись (обидві копії)]
const EDITS = [
    ['if (hOk.length) size = hOk[0];', 'if (hOk.length) size = hOk[hOk.length - 1]; // на межі двох розмірів — більший (власник 03.10)', 2],
    ['? nx : wMatches[0];', '? nx : wMatches[wMatches.length - 1];', 2],
    ['else size = wMatches[0];', 'else size = wMatches[wMatches.length - 1];', 2],
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
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
