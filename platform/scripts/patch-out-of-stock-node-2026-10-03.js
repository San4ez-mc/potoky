'use strict';
// Patch (source of truth): goverla — текст «товару немає в наявності» (CRM Product.outOfStock, 03.10: лофери позначені відсутніми,
// а бот їх продавав). policy.js бере ноду n_agent_out_of_stock за id; редагується у Flows.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-out-of-stock-node-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const BASE = 'n_agent_return_wait_ask';
const ID = 'n_agent_out_of_stock';
const TEXT = 'На жаль, цього товару зараз немає в наявності 😔 Можу підібрати щось схоже — напишіть, що шукаєте 🙂';

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    if (nodes.some((n) => n.id === ID)) { console.log(ID, 'already exists'); return; }
    const base = nodes.find((n) => n.id === BASE);
    if (!base) throw new Error('немає базової ноди ' + BASE);
    const field = base.data.message !== undefined ? 'message' : 'text';
    nodes.push({ ...base, id: ID, position: { x: ((base.position && base.position.x) || 0) + 520, y: (base.position && base.position.y) || 0 }, data: { ...base.data, label: 'Товару немає в наявності', [field]: TEXT, variants: undefined } });
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('added', ID);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
