'use strict';
// Patch (source of truth): goverla — підпис до номера картки береться з CRM (ФОП → «Коментар до картки»; порожній — «(назва ФОП)»).
// {{context.fop.cardHolder}} ставить policy.sendCard щоразу свіжим з CRM. Власник 14.10: замість назви ФОП — «Отримувач / Банк».
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-req-card-holder-2026-10-14.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const ID = 'n_req_card';
const OLD = '{{context.fop.cardNumber}} ({{context.fop.name}})';
const NEW = '{{context.fop.cardNumber}}{{context.fop.cardHolder}}';

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === ID);
    if (i < 0) throw new Error('немає ноди ' + ID);
    const text = String(nodes[i].data.text || '');
    if (text.includes(NEW)) { console.log(ID, 'already patched'); return; }
    if (!text.includes(OLD)) throw new Error('текст ноди змінено вручну, не чіпаю: ' + text.slice(0, 120));
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, text: text.replace(OLD, NEW) } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', ID);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
