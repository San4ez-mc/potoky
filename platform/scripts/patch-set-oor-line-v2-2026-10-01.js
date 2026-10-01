'use strict';
// Patch (source of truth): goverla — n_calc, рядок позиції комплекту, коли клієнт більший за сітку цієї позиції. Рішення власника 01.10:
// постачальник більших розмірів не шиє, нічого замість не пропонуємо — просто чесно «такого розміру нема». Було (v1): «на ваші
// параметри буде замалий (найбільший — XXL)». Тепер: «на ваші параметри розміру немає (найбільший — XXL)».
//
// Idempotent. Запуск на сервері (після git pull, після patch-set-oor-line-2026-10-01.js):  node scripts/patch-set-oor-line-v2-2026-10-01.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_calc';
const FROM = "'Розмір: на ваші параметри буде замалий (найбільший — '";
const TO = "'Розмір: на ваші параметри розміру немає (найбільший — '";

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === NODE);
    if (i < 0) throw new Error('немає ноди ' + NODE);
    let code = String(nodes[i].data.code || '');
    if (code.includes(TO)) { console.log('already patched'); return; }
    if (!code.includes(FROM)) throw new Error('не знайдено фрагмент — спершу patch-set-oor-line-2026-10-01.js');
    code = code.replace(FROM, TO);
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
