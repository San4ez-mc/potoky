'use strict';
// Patch (source of truth): goverla — тексти уточнень для повернення/обміну (власник 03.10: «нехай збирає»). Бот зʼясовує тип,
// причину і (для обміну) на що міняти — питає лише те, чого клієнт ще не сказав. Ноди редагуються у Flows; policy.js бере їх за id.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-return-collect-nodes-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const BASE = 'n_agent_return_wait_ask';
const NODES = [
    ['n_agent_return_ask_type_reason', 'Повернення: тип і причина', 'Звісно, допоможемо 🤗 Підкажіть, будь ласка: ви хочете повернути товар чи обміняти його? І що саме не підійшло — розмір, колір чи щось інше?'],
    ['n_agent_return_ask_type', 'Повернення: тип', 'Підкажіть, будь ласка: ви хочете повернути товар (повернемо кошти) чи обміняти його на інший розмір або колір? 🙂'],
    ['n_agent_return_ask_reason', 'Повернення: причина', 'Підкажіть, будь ласка, що саме не підійшло — розмір, колір чи щось інше? Так ми швидше все оформимо 🙏'],
    ['n_agent_return_ask_exchange', 'Обмін: на що міняти', 'На який розмір або колір обміняти? 🙂'],
];

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const base = nodes.find((n) => n.id === BASE);
    if (!base) throw new Error('немає базової ноди ' + BASE);
    const field = base.data.message !== undefined ? 'message' : 'text';
    let added = 0;
    NODES.forEach(([id, label, text], i) => {
        if (nodes.some((n) => n.id === id)) { console.log(id, 'already exists'); return; }
        nodes.push({ ...base, id, position: { x: ((base.position && base.position.x) || 0) + 260, y: ((base.position && base.position.y) || 0) + 100 * i }, data: { ...base.data, label, [field]: text, variants: undefined } });
        added++; console.log('added', id);
    });
    if (added) await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
