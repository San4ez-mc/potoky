'use strict';
// Patch (source of truth): goverla — n_pay_amount: акція «N шт» додаткових позицій рахується на ТОВАР (sku), а не на рядок (15.10).
//
// Що сталось (FunnelTest Н5): у зміненому комплекті «замість лоферів ще одну футболку, чорну» — дві футболки L0056 різних кольорів
// = два рядки по 1 шт → 449 + 449 = 898 грн, хоча картка обіцяє «Футболка: 449 ₴ (2 шт: 799 ₴)». Те саме для будь-яких
// додаткових товарів двох кольорів. Тепер сума групи рядків одного sku = tierTotal(акція, ціна, усього штук), розкладена по рядках.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-goverla-pay-amount-tier-by-sku-2026-10-15.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const OLD = '__list.forEach(function(x){ x.sum=tierTotal(x.qtyPrices, x.price, x.qty); extrasSum+=x.sum; });';
const NEW = '// Акція «N шт» — на товар, а не на рядок: два кольори одного sku = одна група (15.10, Н5: 2 футболки = 799, а не 898).\n'
    + '__list.forEach(function(x){ x.sum=tierTotal(x.qtyPrices, x.price, x.qty); });\n'
    + 'var __grp={}; __list.forEach(function(x){ var k=String(x.sku).toUpperCase(); (__grp[k]=__grp[k]||[]).push(x); });\n'
    + 'Object.keys(__grp).forEach(function(k){ var g=__grp[k]; if(g.length<2) return; var n=g.reduce(function(s,x){ return s+x.qty; },0); var tot=tierTotal(g[0].qtyPrices, g[0].price, n); var left=tot; g.forEach(function(x,i){ x.sum=(i===g.length-1)?left:Math.round(tot*x.qty/n); left-=x.sum; }); });\n'
    + '__list.forEach(function(x){ extrasSum+=x.sum; });';

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === 'n_pay_amount');
    if (i < 0) throw new Error('немає n_pay_amount');
    const code = String(nodes[i].data.code || '');
    if (code.includes('var __grp={};')) { console.log('n_pay_amount already patched'); return; }
    if (!code.includes(OLD)) throw new Error('n_pay_amount змінено вручну, не чіпаю');
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code: code.replace(OLD, NEW) } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched n_pay_amount');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
