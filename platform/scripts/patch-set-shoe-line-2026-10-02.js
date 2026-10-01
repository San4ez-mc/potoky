'use strict';
// Patch (source of truth): goverla — n_calc, рядок розміру позиції комплекту з числовими розмірами (лофери). Тести 160/161, 02.10:
// «Розмір оберіть самі: 41…45» — і коли клієнт назвав розмір, якого нема (47), бот не казав, що його нема. Тепер:
// названого нема → «Розміру 47 немає — є 41, 42, 43, 44, 45. Напишіть, будь ласка, який підійде»;
// не названо → «Розмір: напишіть, будь ласка, ваш (є 41, 42, 43, 44, 45)».
//
// Idempotent. Запуск на сервері (після git pull, після patch-set-shoe-oor-2026-10-01.js):  node scripts/patch-set-shoe-line-2026-10-02.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const FROM = "else __itSizeLine = 'Розмір оберіть самі: ' + __itAvail.join(', ');";
const TO = "else __itSizeLine = __shoeEU ? ('Розміру ' + __shoeEU + ' немає — є ' + __itAvail.join(', ') + '. Напишіть, будь ласка, який підійде') : ('Розмір: напишіть, будь ласка, ваш (є ' + __itAvail.join(', ') + ')');";

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === NODE);
    if (i < 0) throw new Error('немає ноди ' + NODE);
    let code = String(nodes[i].data.code || '');
    if (code.includes(TO)) { console.log('already patched'); return; }
    if (!code.includes(FROM)) throw new Error('не знайдено фрагмент — спершу patch-set-shoe-oor-2026-10-01.js');
    code = code.replace(FROM, TO);
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
