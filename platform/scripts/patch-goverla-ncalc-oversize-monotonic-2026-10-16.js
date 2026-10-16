'use strict';
// n_calc: вага/зріст ЗА межею сітки, але в допуску (TOL_W=8, TOL_H=5) — рахуємо як крайній розмір сітки, а не «вага ні в який
// діапазон не влучила → розмір лише за зростом». Було немонотонно (16.10, Edits fab0ab64, Igor Ovcharchin): кофта A0187 до XXL,
// 187/112 → «XXXL, найбільший XXL — буде малий» (правильно), а 187/122 і 187/128 → «XXL сяде ідеально» (вигадка).
// Повідомлення далі бачать справжні зріст/вагу (відновлюємо після вибору розміру).
//   node scripts/patch-goverla-ncalc-oversize-monotonic-2026-10-16.js [--apply] [--out=/tmp/n_calc.patched.js]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { db } = require(path.join(__dirname, '..', 'apps', 'api', 'src', 'services', 'shopAgent', 'lib'));
const BOTS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];
const MARK = '/*oversize-monotonic-2026-10-16*/';
const A1 = "var byW = pick(w, 'weight'), byH = pick(h, 'height');";
const B1 = MARK + " var __w0 = w, __h0 = h; if (w > wMax) w = wMax; if (w > 0 && w < wMin) w = wMin; if (h > hMax) h = hMax; if (h > 0 && h < hMin) h = hMin;\n" + A1;
const A2 = "else { size = byW || byH; }";
const B2 = A2 + "\nw = __w0; h = __h0; // справжні параметри — для текстів нижче";
(async () => {
    const apply = process.argv.includes('--apply');
    const out = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
    for (const botId of BOTS) {
        const f = await db.flowDefinition.findFirst({ where: { botId } });
        const nodes = f.nodes; const n = nodes.find((x) => x.id === 'n_calc');
        let code = String((n.data || {}).code || '');
        if (code.includes(MARK)) { console.log(botId, 'вже застосовано'); if (out) require('fs').writeFileSync(out, code); continue; }
        const c1 = code.split(A1).length - 1, c2 = code.split(A2).length - 1;
        if (c1 !== 1 || c2 !== 1) { console.log(botId, 'якорі не знайдено однозначно', c1, c2); process.exit(1); }
        code = code.replace(A1, B1).replace(A2, B2);
        if (out) require('fs').writeFileSync(out, code);
        if (apply) {
            n.data = { ...(n.data || {}), code };
            await db.flowDefinition.update({ where: { id: f.id }, data: { nodes } });
            console.log(botId, 'застосовано');
        } else console.log(botId, 'перевірка: якорі на місці (запустіть з --apply)');
    }
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
