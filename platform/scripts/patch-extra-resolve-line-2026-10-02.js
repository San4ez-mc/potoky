'use strict';
// Patch (source of truth): goverla — n_extra_resolve, рядок додаткового товару в підсумку (тест 162, 02.10):
// (1) розмір показується й тоді, коли в товару нема списку розмірів у CRM (лофери) — раніше «лофери 44» йшли в підсумок без розміру;
// (2) «(арт. 5934)» не дописується, якщо артикул уже в назві («Чоловічі замшеві лофери. Артикул 5934 (арт. 5934)»).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-extra-resolve-line-2026-10-02.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_extra_resolve';
const MARK = 'артикул уже в назві';

const EDITS = [
    ["var parts = [it.name + ' (арт. ' + it.sku + ') — ' + it.price + ' грн' + (it.qty > 1 ? ' ×' + it.qty : '')];",
        "var parts = [it.name + (it.sku && String(it.name).indexOf(it.sku) < 0 ? ' (арт. ' + it.sku + ')' : '') + ' — ' + it.price + ' грн' + (it.qty > 1 ? ' ×' + it.qty : '')]; // артикул уже в назві — не дублюємо"],
    ["if (it.sizes.length) parts.push(it.size ? 'розмір: ' + it.size : 'РОЗМІР НЕ ОБРАНО (є: ' + it.sizes.join(', ') + ')');",
        "if (it.sizes.length) parts.push(it.size ? 'розмір: ' + it.size : 'РОЗМІР НЕ ОБРАНО (є: ' + it.sizes.join(', ') + ')'); else if (it.size) parts.push('розмір: ' + it.size);"],
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
