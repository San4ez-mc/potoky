'use strict';
// n_calc: правила МЕЖ розмірів від експерта (Олексій, 17.10) — ДАНІ в ключі воронки SIZE_RULES, одна спільна функція для окремого
// товару і для комплекту (у комплекті була скорочена копія алгоритму — урок 15.25); у копію комплекту — і вирівнювання ваги/зросту за
// межею сітки (патч 16.10 стосувався лише окремого товару).
// Правило: { size, wMin?, wMax?, hMin?, hMax? } — перше, що збіглося, перекриває розрахунок за SIZE_CHART. Порожньо — як раніше.
//   node scripts/patch-goverla-ncalc-size-rules-2026-10-18.js [--in=<код після патча 16.10>] [--out=<файл>] [--apply]
// --apply: потребує застосованого патча 16.10 (oversize-monotonic) у БД; пише код вузла і ключ SIZE_RULES.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { db } = require(path.join(__dirname, '..', 'apps', 'api', 'src', 'services', 'shopAgent', 'lib'));
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const MARK0 = '/*oversize-monotonic-2026-10-16*/';
const MARK = '/*size-rules-2026-10-18*/';
// Олексій 17.10: S/M — 66 кг до 178 см і 67–68 кг до 174 см = S («M невисокому висітиме»); M/L — 75 кг до 174 см = M; XL/2XL — 96–99 кг = 2XL
// («обидва підійдуть, 2XL менш ризиковано»). L/XL — без правок.
const RULES = [
    { size: 'S', wMin: 50, wMax: 66, hMax: 178, note: 'Олексій 17.10: невисокому M висітиме' },
    { size: 'S', wMin: 50, wMax: 68, hMax: 174, note: 'Олексій 17.10' },
    { size: 'M', wMin: 75, wMax: 75, hMax: 174, note: 'Олексій 17.10: 75 кг невисокому — M' },
    { size: 'XXL', wMin: 96, wMax: 99, note: 'Олексій 17.10: 96–99 кг — 2XL менш ризиковано' },
];
const HELPER = MARK + "\nfunction __sizeRule(h, w) { var rr = []; try { rr = JSON.parse(keys.SIZE_RULES || '[]'); } catch (e) { rr = []; } for (var i = 0; i < rr.length; i++) { var r = rr[i] || {}; if (h > 0 && w > 0 && r.size && (r.wMin == null || w >= Number(r.wMin)) && (r.wMax == null || w <= Number(r.wMax)) && (r.hMin == null || h >= Number(r.hMin)) && (r.hMax == null || h <= Number(r.hMax))) return String(r.size).toUpperCase(); } return null; }\n";
// комплект: вирівнювання + правило
const S1 = '  function __setCalcOne(avail) {\n';
const S1b = '  function __setCalcOne(avail) {\n    var __sw0 = __setW, __sh0 = __setH, __swMin = 1e9, __swMax = -1e9, __shMin = 1e9, __shMax = -1e9; for (var __sk in __setChart) { var __sc = __setChart[__sk] || {}; if (__sc.weight) { __swMin = Math.min(__swMin, Number(__sc.weight[0])); __swMax = Math.max(__swMax, Number(__sc.weight[1])); } if (__sc.height) { __shMin = Math.min(__shMin, Number(__sc.height[0])); __shMax = Math.max(__shMax, Number(__sc.height[1])); } }\n    if (__setW > __swMax) __setW = __swMax; if (__setW > 0 && __setW < __swMin) __setW = __swMin; if (__setH > __shMax) __setH = __shMax; if (__setH > 0 && __setH < __shMin) __setH = __shMin;\n';
const S2 = "    if (!size) return { oor: 'не визначено за зростом/вагою' };";
const S2b = "    __setW = __sw0; __setH = __sh0; var __srule = __sizeRule(__setH, __setW); if (__srule) size = __srule;\n" + S2;
// окремий товар: правило після вибору за сіткою (після відновлення справжніх зросту/ваги з патча 16.10)
const M1 = 'w = __w0; h = __h0; // справжні параметри — для текстів нижче';
const M1b = M1 + '\nvar __mrule = __sizeRule(h, w); if (__mrule) size = __mrule;';
(async () => {
    const apply = process.argv.includes('--apply');
    const inF = (process.argv.find((a) => a.startsWith('--in=')) || '').slice(5);
    const out = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
    const f = await db.flowDefinition.findFirst({ where: { botId: BOT } });
    const nodes = f.nodes; const n = nodes.find((x) => x.id === 'n_calc');
    let code = inF ? fs.readFileSync(inF, 'utf8') : String((n.data || {}).code || '');
    if (code.includes(MARK)) { console.log('вже застосовано'); process.exit(0); }
    if (!code.includes(MARK0)) { console.log('спершу патч 16.10 (oversize-monotonic)'); process.exit(1); }
    for (const a of [S1, S2, M1]) if (code.split(a).length - 1 !== 1) { console.log('якір не однозначний:', a.slice(0, 60)); process.exit(1); }
    code = HELPER + code.replace(S1, S1b).replace(S2, S2b).replace(M1, M1b);
    if (out) fs.writeFileSync(out, code);
    console.log('правила:', JSON.stringify(RULES.map((r) => ({ size: r.size, wMin: r.wMin, wMax: r.wMax, hMax: r.hMax }))));
    if (apply) {
        n.data = { ...(n.data || {}), code };
        await db.flowDefinition.update({ where: { id: f.id }, data: { nodes } });
        await db.funnelKey.upsert({ where: { botId_key: { botId: BOT, key: 'SIZE_RULES' } }, update: { value: JSON.stringify(RULES) }, create: { botId: BOT, key: 'SIZE_RULES', value: JSON.stringify(RULES), label: 'Правила меж розмірів (експерт): [{size,wMin,wMax,hMin,hMax}] — перше, що збіглося, перекриває сітку' } });
        console.log('застосовано: вузол n_calc + ключ SIZE_RULES');
    } else console.log('перевірка (без --apply нічого не записано)');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
