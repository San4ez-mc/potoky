'use strict';
// Patch (source of truth): goverla — вузол n_supplier_order (brewdrop), 05.10, Edit fe2c9063.
// У малих селах Нова Пошта має одну точку — «Пункт приймання-видачі» без номера (Червоне, Вінницька обл.). Клієнт пише «НП 1» —
// вузол шукав «№1» і не знаходив. Тепер: клієнт назвав №1, а в населеному пункті рівно одна точка видачі — беремо її.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-brewdrop-single-point-2026-10-05.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_supplier_order';
const MARK = '__singlePoint';
const OLD = "if(!brObj) return fail('відділення №'+bnum+' у місті «'+(cityObj.name_ua||cityObj.name)+'» не знайдено');";
const NEW = "if(!brObj && bnum==='1'){ var __singlePoint=await bd('/api/branches?city_id='+cityObj.id+'&per_page=50'); var __sp=(__singlePoint.json&&__singlePoint.json.data)||[]; if(__sp.length===1) brObj=__sp[0]; }\n" + OLD;

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === NODE);
    if (i < 0) throw new Error('немає ноди ' + NODE);
    let code = String(nodes[i].data.code || '');
    if (code.includes(MARK)) { console.log('already patched'); return; }
    const cnt = code.split(OLD).length - 1;
    if (cnt !== 1) throw new Error('фрагмент зустрівся ' + cnt + ' раз(и), очікувалось 1 — код ноди змінився, оновіть патч');
    code = code.replace(OLD, () => NEW);
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
