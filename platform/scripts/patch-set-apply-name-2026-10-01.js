'use strict';
// Patch (source of truth): goverla — n_set_apply. Клієнт обирає з комплекту ОКРЕМУ позицію («лише кофта») — товар-позиція
// будувався як Object.assign({}, комплект, {...}) і успадковував customerName/desc КОМПЛЕКТУ. У підсумку замовлення
// виходило «Комплект 4 в 1. Артикул: set1112 — 1 шт: Графітовий XL — 1279 грн» (правка 89b80358, сесія c0fd10a4, 01.10).
// Тепер позиція отримує власні назву й опис з CRM (customerName/presentationText), запасний варіант — назва зі складу комплекту.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-set-apply-name-2026-10-01.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_set_apply';
const MARK = 'itemCustName';

const EDITS = [
    ["var colors = [], sizes = [], offers = [], imgs = [], img = '';",
        "var colors = [], sizes = [], offers = [], imgs = [], img = '';\nvar itemCustName = '', itemDesc = ''; // власні назва/опис позиції (не комплекту) — правка 89b80358"],
    ['offers = found.offers || [];',
        "offers = found.offers || [];\n        itemCustName = String(found.customerName || '').trim();\n        itemDesc = String(found.presentationText || '').split('\\n').filter(function (ln) { return !/^\\s*ℹ️/.test(ln); }).join('\\n').trim();"],
    ["isSet: false, setComponents: '',",
        "isSet: false, customerName: itemCustName || (String(it.name || '') + (/артикул/i.test(String(it.name || '')) ? '' : '. Артикул: ' + it.article)), desc: itemDesc || '', setComponents: '',"],
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
        if (!code.includes(from)) throw new Error('не знайдено фрагмент: ' + from.slice(0, 60) + ' — код ноди змінився, патч треба оновити');
        code = code.replace(from, to);
    }
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
