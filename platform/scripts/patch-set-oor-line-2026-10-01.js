'use strict';
// Patch (source of truth): goverla — n_calc, рядок розміру позиції комплекту, коли клієнт більший за сітку цієї позиції.
// Було: «Розмір: найбільший наявний XXL (буде малий) — напишіть, будь ласка, який розмір вам потрібен» — клієнта просили самому
// назвати розмір, якого нема (тест cfddd671, 120 кг у комплекті). Тепер чесно: «на ваші параметри буде замалий (найбільший — XXL)»,
// без прохання; прохання назвати розмір лишається лише там, де розмір просто не визначено.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-set-oor-line-2026-10-01.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const MARK = 'на ваші параметри буде замалий';

const FROM = "__itSizeLine = __r.size ? ('Розмір: ' + __r.size) : ('Розмір: ' + __r.oor + ' — напишіть, будь ласка, який розмір вам потрібен');";
const TO = "__itSizeLine = __r.size ? ('Розмір: ' + __r.size) : (/буде малий/.test(__r.oor) ? ('Розмір: на ваші параметри буде замалий (найбільший — ' + String(__r.oor).replace(/^.*найбільший наявний\\s*/, '').replace(/\\s*\\(буде малий\\)\\s*$/, '') + ')') : ('Розмір: ' + __r.oor + ' — напишіть, будь ласка, який розмір вам потрібен'));";

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === NODE);
    if (i < 0) throw new Error('немає ноди ' + NODE);
    let code = String(nodes[i].data.code || '');
    if (code.includes(MARK)) { console.log('already patched'); return; }
    if (!code.includes(FROM)) throw new Error('не знайдено фрагмент — код ноди змінився, патч треба оновити');
    code = code.replace(FROM, TO);
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
