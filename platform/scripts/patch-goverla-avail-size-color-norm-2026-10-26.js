'use strict';
// Patch (source of truth): goverla — n_avail: розміри й кольори порівнюються в нормальній формі, а не буквально (26.10).
//
// Що сталось (_mikhail.k, Edits ba3d8adf/bc8ff48d): у CRM джинси j0032 мали розмір «3XL», бот порахував «XXXL» — n_avail
// порівнював рядки дослівно, не знайшов офера й сказав «саме цей варіант зараз розібрали», хоча темно-сині 3XL є.
// Тепер: 3XL = XXXL = ХХХЛ (2XL = XXL, 4XL = XXXXL, кирилиця → латиниця), «Темно сині» = «Темно-синій» (без дефісів/пробілів
// і закінчень).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-goverla-avail-size-color-norm-2026-10-26.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const MARK = 'function __sk(';
const HELPERS = '// 26.10 (_mikhail.k): розмір/колір — у нормальній формі (3XL = XXXL = ХХХЛ; «Темно сині» = «Темно-синій»).\n'
    + 'function __sk(s){ var t=String(s||\'\').toUpperCase().trim().replace(/Х/g,\'X\').replace(/Л/g,\'L\').replace(/М/g,\'M\').replace(/С/g,\'S\'); return t.replace(/^2XL$/,\'XXL\').replace(/^3XL$/,\'XXXL\').replace(/^4XL$/,\'XXXXL\'); }\n'
    + 'function __ck(s){ return String(s||\'\').toLowerCase().replace(/ё/g,\'е\').replace(/[\\s\\-‐–—]+/g,\'\').replace(/[аяеєиіїйоуюьы]+$/,\'\'); }\n';
const REPL = [
    ['var so=String(context.colorChoice.size).toUpperCase().trim();', 'var so=__sk(context.colorChoice.size);'],
    ['context.product.sizes.map(function(x){return String(x).toUpperCase().trim();}):[];', 'context.product.sizes.map(function(x){return __sk(x);}):[];'],
    ['return o.effectiveSizes.some(function(s){ return String(s).toUpperCase()===String(chosenSize).toUpperCase(); });', 'return o.effectiveSizes.some(function(s){ return __sk(s)===__sk(chosenSize); });'],
    ["String(x.value).toUpperCase()===String(chosenSize).toUpperCase(); });", "__sk(x.value)===__sk(chosenSize); });"],
    ['return String(x.value).toLowerCase()===String(cc).toLowerCase(); });', 'return __ck(x.value)===__ck(cc); });'],
    ['return String(x.value).toLowerCase() === String(cc2).toLowerCase(); });', 'return __ck(x.value) === __ck(cc2); });'],
];

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === 'n_avail');
    if (i < 0) throw new Error('немає n_avail');
    let code = String(nodes[i].data.code || '');
    if (code.includes(MARK)) { console.log('n_avail already patched'); return; }
    for (const [a] of REPL) if (!code.includes(a)) throw new Error('n_avail змінено вручну, не чіпаю: ' + a.slice(0, 60));
    for (const [a, b] of REPL) code = code.split(a).join(b);
    code = HELPERS + code;
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    if (process.argv.includes('--dry')) { console.log(code.slice(0, 600)); return; }
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched n_avail');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
