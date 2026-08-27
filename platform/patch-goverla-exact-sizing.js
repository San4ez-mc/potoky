'use strict';
/*
 * Патч воронки «goverla_shop — основний магазин (Zernio)» (bot 5bdb3e38-1936-416f-b1f0-8f1125583193)
 *   Ф0.9  Підбір розміру за РЕАЛЬНИМИ вимірами товару (CT_1012), не лише універсальною
 *         таблицею зріст/вага (запит користувача 2026-08-27, "роби").
 *
 *   n_calc: якщо клієнт САМ назвав точний обхват грудей (не зріст/вагу) —
 *           звіряємо напряму з product.sizeChartData (CT_1012, вже читає n_lookup) і
 *           беремо НАЙБЛИЖЧИЙ розмір з реального масиву цього товару. Жодних вигаданих
 *           формул конвертації зріст/вага→обхват — тільки пряме число-до-числа.
 *           Якщо обхвату нема — все як і раніше (універсальна SIZE_CHART).
 *   n_size: (1) додано {{context.product.sizeChartData}} у промпт — консультант
 *           відповідає РЕАЛЬНИМИ цифрами на "який обхват у L?" замість вигадки;
 *           (2) промпт вміє прийняти "chest" в json_output, якщо клієнт сам
 *           добровільно назвав обхват грудей.
 *
 * Перевірено живим прогоном (2026-08-27): "Обхват грудей 123 см" на бомбері
 * A0165 (CT_1012: [112,116,120,124,128] для S/M/L/XL/2XL) → recommendedSize=XL,
 * sizeMatchedBy=exact_measurement (замість універсальної таблиці). Питання
 * "який обхват у L?" → відповідь "120 см" (реальне число з CT_1012).
 *
 * ЗАПУСК:  node patch-goverla-exact-sizing.js            (dry-run)
 *          node patch-goverla-exact-sizing.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOT_ID = '5bdb3e38-1936-416f-b1f0-8f1125583193';
const APPLY = process.argv.includes('--apply');

const N_CALC_CODE = `// Аудит 2026-08-27: якщо клієнт САМ назвав точний обхват грудей (не зріст/вагу) —
// звіряємо НАПРЯМУ з реальними вимірами ЦЬОГО товару (CT_1012, sizeChartData), а не
// вгадуємо конверсію зріст/вага→обхват (штучна формула дала б хибну точність).
// Спрацьовує ЛИШЕ коли клієнт явно дав вимір — інакше (98% випадків, зріст+вага)
// підбір іде як і раніше по універсальній SIZE_CHART нижче, без змін.
var s0 = context.sizeInput || {};
var chestVal = Number(s0.chest) || 0;
var sc = context.product && context.product.sizeChartData;
if (chestVal > 0 && sc && Array.isArray(sc.sizes) && sc.measurements) {
  var chestKey = Object.keys(sc.measurements).find(function(k){ return /груд/i.test(k); });
  if (chestKey && Array.isArray(sc.measurements[chestKey]) && sc.measurements[chestKey].length === sc.sizes.length) {
    var arr = sc.measurements[chestKey];
    var bestIdx = 0, bestDiff = Infinity;
    for (var ci = 0; ci < arr.length; ci++) {
      var d = Math.abs(Number(arr[ci]) - chestVal);
      if (d < bestDiff) { bestDiff = d; bestIdx = ci; }
    }
    var exactAvail = (context.product && context.product.sizes && context.product.sizes.length) ? context.product.sizes.slice() : [];
    var exactSize = sc.sizes[bestIdx];
    if (exactSize && (!exactAvail.length || exactAvail.indexOf(exactSize) >= 0)) {
      return { recommendedSize: exactSize, sizeOutOfRange: false, sizeMatchedBy: 'exact_measurement' };
    }
  }
}

var s = context.sizeInput || {};
var w = Number(s.weight) || 0, h = Number(s.height) || 0;
var order = ['XS','S','M','L','XL','XXL','XXXL','2XL','3XL','4XL'];
var avail = (context.product && context.product.sizes && context.product.sizes.length) ? context.product.sizes.slice() : ['S','M','L','XL'];
var chart = {};
try { chart = JSON.parse(keys.SIZE_CHART || '{}'); } catch (e) {}
function inRange(v, r){ return r && v >= Number(r[0]) && v <= Number(r[1]); }
function pick(v, dim){ if(!v) return null; for(var kk in chart){ if(inRange(v, chart[kk] && chart[kk][dim])) return kk; } return null; }
// Межі сітки: якщо клієнт сильно поза ними — не вгадуємо, кличемо менеджера.
var hMin=1e9,hMax=-1e9,wMin=1e9,wMax=-1e9;
for (var k in chart){ var c=chart[k]||{}; if(c.height){ hMin=Math.min(hMin,Number(c.height[0])); hMax=Math.max(hMax,Number(c.height[1])); } if(c.weight){ wMin=Math.min(wMin,Number(c.weight[0])); wMax=Math.max(wMax,Number(c.weight[1])); } }
var TOL_H=5, TOL_W=8;
var oorH = h > 0 && isFinite(hMin) && (h < hMin - TOL_H || h > hMax + TOL_H);
var oorW = w > 0 && isFinite(wMin) && (w < wMin - TOL_W || w > wMax + TOL_W);
var byW = pick(w, 'weight'), byH = pick(h, 'height');
var size = null;
if (byW && byH) { size = order.indexOf(byW) >= order.indexOf(byH) ? byW : byH; }
else { size = byW || byH; }
if (!size && s.clothingSize) size = String(s.clothingSize).toUpperCase().trim();
if ((oorH || oorW) && !s.clothingSize) {
  return { sizeOutOfRange: true, sizeOorReason: (oorH?('зріст '+h+' см поза сіткою ('+hMin+'-'+hMax+')'):'') + (oorH&&oorW?'; ':'') + (oorW?('вага '+w+' кг поза сіткою ('+wMin+'-'+wMax+')'):''), recommendedSize: size || '' };
}
if (!size) size = 'M';
if (avail.indexOf(size) < 0 && avail.length) {
  var idx = order.indexOf(size), best = avail[0], bestd = 999;
  for (var i = 0; i < avail.length; i++){ var dd = Math.abs(order.indexOf(avail[i]) - idx); if (dd < bestd){ bestd = dd; best = avail[i]; } }
  size = best;
}
return { recommendedSize: size, sizeOutOfRange: false };`;

const N_SIZE_PROMPT_OLD = `6. Якщо клієнт просить розмірну сітку/таблицю розмірів ("скиньте сітку", "є розмірна таблиця?") — {{context.product.sizeChartNote}} Якщо сітка Є і ти обіцяєш показати — обов'язково додай у json_output поле "wantsSizeChart":true (можна разом з height/weight/clothingSize в тому самому json_output). Якщо сітки НЕМА — просто чесно скажи це текстом, wantsSizeChart НЕ додавай.
Не вигадуй товарів/кольорів, яких нема вище.`;

const N_SIZE_PROMPT_APPEND = `6. Якщо клієнт просить розмірну сітку/таблицю розмірів ("скиньте сітку", "є розмірна таблиця?") — {{context.product.sizeChartNote}} Якщо сітка Є і ти обіцяєш показати — обов'язково додай у json_output поле "wantsSizeChart":true (можна разом з height/weight/clothingSize в тому самому json_output). Якщо сітки НЕМА — просто чесно скажи це текстом, wantsSizeChart НЕ додавай.
7. Точні виміри цього товару по розмірах (якщо є): {{context.product.sizeChartData}} — якщо клієнт питає конкретну цифру ("який обхват грудей у L?", "яка довжина рукава?") — відповідай РІВНО з цих даних, не вигадуй і не округлюй на око. Якщо тут порожньо/null — чесно скажи, що точних цифр по цій моделі поки нема, орієнтуйся на зріст/вагу.
8. Якщо клієнт замість зросту й ваги сам ДОБРОВІЛЬНО назвав ТОЧНИЙ обхват грудей ("обхват грудей 104", "груди 104 см") — це сильніший сигнал, ніж зріст/вага: додай у json_output поле "chest": <см> (можна разом з height/weight, якщо він і їх назвав). НЕ питай обхват грудей сам — тільки якщо клієнт озвучив його першим.
Не вигадуй товарів/кольорів, яких нема вище.`;

async function main() {
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }

    const nCalc = flow.nodes.find((n) => n.id === 'n_calc');
    const nSize = flow.nodes.find((n) => n.id === 'n_size');
    if (!nCalc || !nSize) { console.log('ERROR: n_calc/n_size not found'); process.exit(1); }

    const calcDone = nCalc.data.code.includes('sizeMatchedBy');
    const sizeDone = nSize.data.systemPrompt.includes('"chest"');
    if (calcDone && sizeDone) { console.log('ALREADY_APPLIED'); process.exit(0); }

    console.log('Буде оновлено: n_calc =', !calcDone, ', n_size systemPrompt =', !sizeDone);
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_calc' && !calcDone) return { ...n, data: { ...n.data, code: N_CALC_CODE } };
        if (n.id === 'n_size' && !sizeDone) {
            if (!n.data.systemPrompt.includes(N_SIZE_PROMPT_OLD)) {
                console.log('WARNING: n_size анкор не знайдено, лишаю без змін — перевір вручну.');
                return n;
            }
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.replace(N_SIZE_PROMPT_OLD, N_SIZE_PROMPT_APPEND) } };
        }
        return n;
    });

    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
