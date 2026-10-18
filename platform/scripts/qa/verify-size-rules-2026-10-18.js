// Розміри, погоджені з Олексієм 17.10 (83 приклади: перший список 40 + другий 43, з його правками) — пропатчений n_calc має давати
// саме їх; плюс та сама кофта в КОМПЛЕКТІ — той самий розмір, що окремо (урок 15.25), і сітка: де змінилось проти попереднього коду.
//   CODE_OLD=/tmp/n_calc.patched.js CODE_NEW=/tmp/n_calc.patched2.js node scripts/qa/verify-size-rules-2026-10-18.js
process.chdir(require('path').join(__dirname, '..', '..'));
const path = require('path');
const { loadCatalog, loadAssets, runNodeCode } = require(path.join(__dirname, '../../apps/api/src/services/shopAgent/lib'));
const RULES = [{ size: 'S', wMin: 50, wMax: 66, hMax: 178 }, { size: 'S', wMin: 50, wMax: 68, hMax: 174 }, { size: 'M', wMin: 75, wMax: 75, hMax: 174 }, { size: 'XXL', wMin: 96, wMax: 99 }];
// [зріст, вага, очікуваний розмір] — погоджено Олексієм (правки) або не заперечено
const EXPECT = [
    [166, 56, 'S'], [170, 58, 'S'], [168, 62, 'S'], [190, 63, 'M'], [180, 65, 'M'], [172, 66, 'S'], [164, 74, 'M'], [176, 74, 'M'], [169, 75, 'M'], [181, 75, 'L'],
    [186, 76, 'L'], [176, 78, 'L'], [174, 80, 'L'], [177, 80, 'L'], [174, 83, 'L'], [181, 83, 'L'], [179, 84, 'L'], [187, 84, 'XL'], [174, 85, 'XL'], [175, 85, 'XL'],
    [182, 85, 'XL'], [187, 85, 'XL'], [174, 86, 'XL'], [180, 86, 'XL'], [187, 86, 'XL'], [175, 90, 'XL'], [187, 91, 'XL'], [180, 95, 'XL'], [180, 96, 'XXL'], [178, 99, 'XXL'],
    [176, 101, 'XXL'], [188, 101, 'XXL'], [172, 105, 'XXL'], [183, 108, 'XXL'], [178, 109, 'XXL'], [184, 110, 'XXXL'], [182, 111, 'XXXL'], [176, 120, 'XXXL'], [187, 122, 'XXXL'], [196, 87, 'OOR'],
    [165, 66, 'S'], [168, 66, 'S'], [170, 66, 'S'], [175, 66, 'S'], [178, 66, 'S'], [172, 67, 'S'], [172, 68, 'S'], [168, 68, 'S'], [175, 68, 'M'],
    [165, 75, 'M'], [172, 75, 'M'], [174, 75, 'M'], [176, 75, 'L'], [178, 75, 'L'], [169, 77, 'L'], [172, 78, 'L'], [174, 77, 'L'],
    [175, 93, 'XL'], [180, 93, 'XL'], [185, 93, 'XL'], [190, 93, 'XL'], [175, 94, 'XL'], [178, 94, 'XL'], [180, 94, 'XL'], [183, 94, 'XL'], [185, 94, 'XL'], [190, 94, 'XL'],
    [170, 95, 'XL'], [175, 95, 'XL'], [178, 95, 'XL'], [180, 95, 'XL'], [185, 95, 'XL'], [190, 95, 'XXL'], [175, 96, 'XXL'], [178, 96, 'XXL'], [180, 96, 'XXL'], [185, 96, 'XXL'],
    [190, 96, 'XXL'], [172, 97, 'XXL'], [180, 97, 'XXL'], [188, 98, 'XXL'], [172, 99, 'XXL'], [185, 99, 'XXL'],
];
(async () => {
    const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
    const assets = await loadAssets(BOT); const cat = await loadCatalog(BOT, assets.keys);
    const fs = require('fs');
    const oldC = fs.readFileSync(process.env.CODE_OLD, 'utf8'); const newC = fs.readFileSync(process.env.CODE_NEW, 'utf8');
    const keysNew = { ...assets.keys, SIZE_RULES: JSON.stringify(RULES) };
    const base = cat.products.find((x) => String(x.sku).toUpperCase() === 'A0187');
    const full = { ...base, sizes: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'], offers: [], sizeChartData: null };
    const run = async (code, keys, p, h, w) => { const ctx = { product: p, sizeInput: { height: h, weight: w }, agent: {} }; await runNodeCode(code, { ctx, keys, user: {}, session: { id: 'v' }, input: '', label: 'n_calc' }); return ctx; };
    const norm = (ctx) => (ctx.sizeOutOfRange && !ctx.recommendedSize ? 'OOR' : String(ctx.recommendedSize || '?').toUpperCase());
    let fail = 0;
    for (const [h, w, want] of EXPECT) {
        const got = norm(await run(newC, keysNew, full, h, w));
        if (got !== want) { fail++; console.log('❌ ' + h + '/' + w + ': бот ' + got + ', Олексій ' + want); }
    }
    console.log((fail ? '❌ ' : '✅ ') + 'погоджені приклади: ' + (EXPECT.length - fail) + ' з ' + EXPECT.length);
    // комплект: кофта A0187 у set1112 — той самий розмір, що окремо (для наявних у кофти розмірів S–2XL)
    const set = cat.products.find((x) => String(x.sku).toUpperCase() === 'SET1112');
    let sf = 0, sc = 0;
    for (const [h, w] of EXPECT) {
        const single = norm(await run(newC, keysNew, base, h, w));
        const cs = await run(newC, keysNew, set, h, w);
        const m = String(cs.setSizesText || '').match(/A0187[^\n]*\n?[^\n]*?Розмір:\s*([A-Z0-9]+)/i) || String(cs.setSizesText || '').match(/кофта[^\n]*?Розмір:\s*([A-Z0-9]+)/i);
        if (!m) continue; sc++;
        const inSet = String(m[1]).toUpperCase().replace(/^2XL$/, 'XXL');
        if (single !== 'OOR' && inSet !== single) { sf++; if (sf <= 10) console.log('❌ комплект ' + h + '/' + w + ': кофта окремо ' + single + ', у комплекті ' + inSet); }
    }
    console.log((sf ? '❌ ' : '✅ ') + 'кофта в комплекті = окремо: ' + (sc - sf) + ' з ' + sc);
    // сітка: де змінилось проти коду до правил
    let diff = 0; const changes = [];
    for (let h = 155; h <= 195; h += 1) for (let w = 50; w <= 125; w += 1) {
        const a = norm(await run(oldC, assets.keys, full, h, w)); const b = norm(await run(newC, keysNew, full, h, w));
        if (a !== b) { diff++; const k = a + '→' + b; const g = changes.find((x) => x.k === k); if (g) { g.n++; g.ex.length < 4 && g.ex.push(h + '/' + w); } else changes.push({ k, n: 1, ex: [h + '/' + w] }); }
    }
    console.log('сітка 155–195 см × 50–125 кг: змінилось ' + diff + ' комбінацій');
    changes.forEach((c) => console.log('   ' + c.k + ': ' + c.n + ' (напр. ' + c.ex.join(', ') + ')'));
    process.exit(fail || sf ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
