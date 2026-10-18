'use strict';
// n_calc: розміри як ДАНІ (CRM, 18.10). Сітка підбору за зростом/вагою (fitChart) і межі від експерта (sizeRules) беруться з товару
// (productMatch уже підставляє туди категорію, якщо в товарі порожньо), у комплекті — з кожної позиції; запасно — загальні з ключів
// воронки SIZE_CHART / SIZE_RULES. Одна функція правил для окремого товару й комплекту (у комплекті була скорочена копія алгоритму —
// урок 15.25); у копію комплекту — і вирівнювання ваги/зросту за межею сітки (патч 16.10 стосувався лише окремого товару).
// Правило: { size, wMin?, wMax?, hMin?, hMax? } — перше, що збіглося, перекриває розрахунок за сіткою.
//   node scripts/patch-goverla-ncalc-size-rules-2026-10-18.js [--in=<код після патча 16.10>] [--out=<файл>] [--apply]
// --apply: потребує застосованого патча 16.10 (oversize-monotonic) у БД; пише лише код вузла (дані розмірів — у CRM).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { db } = require(path.join(__dirname, '..', 'apps', 'api', 'src', 'services', 'shopAgent', 'lib'));
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const MARK0 = '/*oversize-monotonic-2026-10-16*/';
const MARK = '/*size-rules-2026-10-18*/';
const HELPER = MARK + "\n" +
    "function __chartFor(o) { if (o && o.fitChart && typeof o.fitChart === 'object' && !Array.isArray(o.fitChart) && Object.keys(o.fitChart).length) return o.fitChart; try { return JSON.parse(keys.SIZE_CHART || '{}'); } catch (e) { return {}; } }\n" +
    "function __rulesFor(o) { if (o && Array.isArray(o.sizeRules) && o.sizeRules.length) return o.sizeRules; try { var g = JSON.parse(keys.SIZE_RULES || '[]'); return Array.isArray(g) ? g : []; } catch (e) { return []; } }\n" +
    "function __sizeRule(h, w, rr) { rr = rr || []; for (var i = 0; i < rr.length; i++) { var r = rr[i] || {}; if (h > 0 && w > 0 && r.size && (r.wMin == null || w >= Number(r.wMin)) && (r.wMax == null || w <= Number(r.wMax)) && (r.hMin == null || h >= Number(r.hMin)) && (r.hMax == null || h <= Number(r.hMax))) return String(r.size).toUpperCase().replace(/^2XL$/, 'XXL').replace(/^3XL$/, 'XXXL'); } return null; }\n";
// комплект: сітка/межі позиції + вирівнювання + правило
const S0 = "  var __setChart = {}; try { __setChart = JSON.parse(keys.SIZE_CHART || '{}'); } catch (e) {}";
const S0b = S0 + "\n  var __curRules = []; // межі поточної позиції (виставляються в циклі по позиціях)";
const S1 = '  function __setCalcOne(avail) {\n';
const S1b = '  function __setCalcOne(avail) {\n    var __sw0 = __setW, __sh0 = __setH, __swMin = 1e9, __swMax = -1e9, __shMin = 1e9, __shMax = -1e9; for (var __sk in __setChart) { var __sc = __setChart[__sk] || {}; if (__sc.weight) { __swMin = Math.min(__swMin, Number(__sc.weight[0])); __swMax = Math.max(__swMax, Number(__sc.weight[1])); } if (__sc.height) { __shMin = Math.min(__shMin, Number(__sc.height[0])); __shMax = Math.max(__shMax, Number(__sc.height[1])); } }\n    if (__setW > __swMax) __setW = __swMax; if (__setW > 0 && __setW < __swMin) __setW = __swMin; if (__setH > __shMax) __setH = __shMax; if (__setH > 0 && __setH < __shMin) __setH = __shMin;\n';
const S2 = "    if (!size) return { oor: 'не визначено за зростом/вагою' };";
const S2b = "    __setW = __sw0; __setH = __sh0; var __srule = __sizeRule(__setH, __setW, __curRules); if (__srule) size = __srule;\n" + S2;
const S3 = '    var __it = context.product.setItems[__si];\n';
const S3b = S3 + '    __setChart = __chartFor(__it); __curRules = __rulesFor(__it); // своя сітка/межі позиції (або її категорії), інакше загальні\n';
// окремий товар: сітка товару/категорії + правило після вибору (після відновлення справжніх зросту/ваги з патча 16.10)
const M0 = "var chart = {};\ntry { chart = JSON.parse(keys.SIZE_CHART || '{}'); } catch (e) {}";
const M0b = "var chart = __chartFor(context.product); // сітка товару → категорії (CRM) → загальна SIZE_CHART";
const M1 = 'w = __w0; h = __h0; // справжні параметри — для текстів нижче';
const M1b = M1 + '\nvar __mrule = __sizeRule(h, w, __rulesFor(context.product)); if (__mrule) size = __mrule;';
(async () => {
    const apply = process.argv.includes('--apply');
    const inF = (process.argv.find((a) => a.startsWith('--in=')) || '').slice(5);
    const out = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
    const f = await db.flowDefinition.findFirst({ where: { botId: BOT } });
    const nodes = f.nodes; const n = nodes.find((x) => x.id === 'n_calc');
    let code = inF ? fs.readFileSync(inF, 'utf8') : String((n.data || {}).code || '');
    if (code.includes(MARK)) { console.log('вже застосовано'); if (out) fs.writeFileSync(out, code); process.exit(0); }
    if (!code.includes(MARK0)) { console.log('спершу патч 16.10 (oversize-monotonic)'); process.exit(1); }
    for (const a of [S0, S1, S2, S3, M0, M1]) if (code.split(a).length - 1 !== 1) { console.log('якір не однозначний:', a.slice(0, 60)); process.exit(1); }
    code = HELPER + code.replace(S0, S0b).replace(S1, S1b).replace(S2, S2b).replace(S3, S3b).replace(M0, M0b).replace(M1, M1b);
    if (out) fs.writeFileSync(out, code);
    if (apply) {
        n.data = { ...(n.data || {}), code };
        await db.flowDefinition.update({ where: { id: f.id }, data: { nodes } });
        console.log('застосовано: вузол n_calc');
    } else console.log('перевірка (без --apply нічого не записано)');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
