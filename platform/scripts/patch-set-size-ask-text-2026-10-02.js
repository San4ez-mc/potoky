'use strict';
// Patch (source of truth): goverla — текст прохання параметрів розміру (власник, 02.10). Після «весь комплект» бот писав
// «Підкажіть, будь ласка: Зріст (см), Вага (кг), Розмір взуття (EU) 🙂» — сирі назви параметрів категорій CRM через кому, як
// анкета. Тепер policy.js складає людську фразу з тих самих параметрів CRM (зріст і вага — один раз, хоч їх і вимагають кофти,
// джинси й футболка: дедуплікація вже є), а текст навколо — у нодах, редагованих у Flows:
//   n_agent_ask_size_set    (НОВА) — комплект: «Чудово, тоді підберу розмір для кожної речі 🙌 Напишіть, будь ласка, ваш зріст і вагу, а також розмір взуття (EU) 🙂»
//   n_agent_ask_size_custom (оновлена) — окремий товар із власним параметром: «Підкажіть, будь ласка, ваш розмір взуття (EU) 🙂»
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-set-size-ask-text-2026-10-02.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const SET_ID = 'n_agent_ask_size_set';
const SET_TEXT = 'Чудово, тоді підберу розмір для кожної речі комплекту 🙌 Напишіть, будь ласка, {{context.agent.paramsPromptText}} 🙂';
const CUSTOM_OLD = 'Підкажіть, будь ласка: {{context.agent.paramsPromptText}} 🙂';
const CUSTOM_NEW = 'Підкажіть, будь ласка, {{context.agent.paramsPromptText}} 🙂';

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const ci = nodes.findIndex((n) => n.id === 'n_agent_ask_size_custom');
    if (ci < 0) throw new Error('немає ноди n_agent_ask_size_custom');
    let changed = false;
    const cur = nodes[ci].data.message ?? nodes[ci].data.text;
    if (cur === CUSTOM_OLD) {
        const field = nodes[ci].data.message !== undefined ? 'message' : 'text';
        nodes[ci] = { ...nodes[ci], data: { ...nodes[ci].data, [field]: CUSTOM_NEW } };
        changed = true; console.log('updated n_agent_ask_size_custom');
    } else console.log('n_agent_ask_size_custom: текст уже інший — не чіпаю:', JSON.stringify(cur));
    if (!nodes.some((n) => n.id === SET_ID)) {
        const base = nodes[ci];
        const field = base.data.message !== undefined ? 'message' : 'text';
        nodes.push({ ...base, id: SET_ID, position: { x: (base.position && base.position.x || 0) + 40, y: (base.position && base.position.y || 0) + 120 }, data: { ...base.data, label: 'Комплект: прохання параметрів розміру', [field]: SET_TEXT, variants: undefined } });
        changed = true; console.log('added', SET_ID);
    } else console.log(SET_ID, 'already exists');
    if (changed) await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
