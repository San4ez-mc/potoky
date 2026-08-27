'use strict';
/*
 * Патч воронки «covercar_ua — тестовий магазин (Zernio)» (bot cc03657f-9e72-46e5-a16d-88826e70c2ee)
 *   Дублювання фіксів, зроблених на «goverla_shop» (bot 5bdb3e38-...) — запит користувача
 *   2026-08-27 "всі зміни, які ми зробили на Говерлі продублюй на covercar".
 *
 *   covercar і goverla_shop сидять на ОДНОМУ акаунті KeyCRM (той самий KEYCRM_API_TOKEN,
 *   спільний каталог товарів) і мають структурно ІДЕНТИЧНІ ноди n_lookup/n_calc/n_size/
 *   n_pay, n_unknown, n_size_oor (covercar явно клонований з goverla_shop — навіть
 *   orderRef-префікс в n_pay_amount досі "GOV", хоча бот називається covercar; це НЕ
 *   зачіпаю цим патчем — окрема косметична дрібниця, не з переліку фіксів, які просили
 *   продублювати).
 *
 *   1) n_lookup:
 *      а) MIME-фікс для Gemini vision — Telegram завжди віддає content-type:
 *         application/octet-stream навіть для реальних jpeg, Gemini таке відхиляє (HTTP
 *         400). Було: `(header || 'image/jpeg')` — рятувало лише коли header ПОРОЖНІЙ,
 *         не коли header = 'application/octet-stream' (саме цей кейс і стається в проді).
 *      б) Дедуп допродажів — якщо CT_1002 містить кілька offer-sku одного товару
 *         (напр. "L0056-1, L0056-2"), у список допродажу товар потрапляв двічі.
 *      в) Читання CT_1012 (точні виміри товару по розмірах) → product.sizeChartData —
 *         передумова для exact-measurement підбору розміру (п.2).
 *      г) Захоплення фото ПЕРШОГО допродажного товару → product.upsellPhotoUrl/
 *         upsellPhotoNote (щоб консультант міг надіслати фото на прохання клієнта).
 *   2) n_calc / n_size — підбір розміру за РЕАЛЬНИМИ вимірами товару (CT_1012), якщо
 *      клієнт сам назвав точний обхват грудей; інакше — як і раніше, universal SIZE_CHART.
 *   3) n_unknown_msg — productUnknownAsk:true (миттєва перевірка нового товару замість
 *      очікування повної паузи).
 *   4) n_unknown_stop, n_size_oor_stop — testRestartAfter:true (неактивно, поки
 *      bot.settings.testMode !== true — безпечно додавати заздалегідь).
 *   5) n_upsell2_wait — промпт вміє wantsUpsellPhoto:true, якщо клієнт просить фото
 *      допродажного товару.
 *
 * Перевірено live-тестом (2026-08-27): фото з content-type application/octet-stream →
 * Gemini приймає (image/jpeg форсується); n_calc з CT_1012 обхватом → exact_measurement.
 *
 * ЗАПУСК:  node patch-covercar-goverla-parity.js            (dry-run)
 *          node patch-covercar-goverla-parity.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOT_ID = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

const MIME_OLD = `var mimep=(irp.headers.get('content-type')||'image/jpeg').split(';')[0];`;
const MIME_NEW = `var mimepRaw=(irp.headers.get('content-type')||'').split(';')[0]; var mimep=(!mimepRaw || mimepRaw==='application/octet-stream') ? 'image/jpeg' : mimepRaw;`;

const UPSELL_OLD = `if(scf&&scf.value){ var stoks=String(scf.value).split(/[\\s,;]+/); for(var t=0;t<stoks.length&&upsell.length<3;t++){ var pp2=await findByToken(stoks[t]); if(pp2&&pp2.id!==found.id) upsell.push(upname(pp2)); } }`;
const UPSELL_NEW = `var __seenUp={}; var __upsellPhoto='', __upsellPhotoNote='';
  if(scf&&scf.value){ var stoks=String(scf.value).split(/[\\s,;]+/); for(var t=0;t<stoks.length&&upsell.length<3;t++){ var pp2=await findByToken(stoks[t]); if(pp2&&pp2.id!==found.id && !__seenUp[pp2.id]){ __seenUp[pp2.id]=1; upsell.push(upname(pp2)); if(!__upsellPhoto){ var upImgs=[]; if(pp2.thumbnail_url)upImgs.push(pp2.thumbnail_url); var upAdx=pp2.attachments_data||[]; for(var ux=0;ux<upAdx.length;ux++){ var uuu=(typeof upAdx[ux]==='string')?upAdx[ux]:(upAdx[ux]&&(upAdx[ux].url||upAdx[ux].src)); if(uuu&&upImgs.indexOf(uuu)<0)upImgs.push(uuu); } __upsellPhoto=upImgs[0]||''; __upsellPhotoNote=pp2.name||''; } } } }`;

const CT1012_ANCHOR = `var __aiInfo=cfVal('CT_1011');`;
const CT1012_NEW = `var __aiInfo=cfVal('CT_1011');
  var __sizeChartDataRaw=cfVal('CT_1012'); var __sizeChartData=null; if(__sizeChartDataRaw){ try{ __sizeChartData=JSON.parse(__sizeChartDataRaw); }catch(e){ __sizeChartData=null; } }`;

const RESULT_OLD = `sizeChartNote:__sizeChartNote } };`;
const RESULT_NEW = `sizeChartNote:__sizeChartNote, sizeChartData:__sizeChartData, upsellPhotoUrl:__upsellPhoto, upsellPhotoNote:__upsellPhotoNote } };`;

const N_CALC_CODE = `// Аудит 2026-08-27 (продубльовано з goverla_shop): якщо клієнт САМ назвав точний обхват
// грудей (не зріст/вагу) — звіряємо НАПРЯМУ з реальними вимірами ЦЬОГО товару (CT_1012,
// sizeChartData), а не вгадуємо конверсію зріст/вага→обхват. Спрацьовує ЛИШЕ коли клієнт
// явно дав вимір — інакше (98% випадків) підбір іде як і раніше по SIZE_CHART нижче.
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
const N_SIZE_PROMPT_NEW = `6. Якщо клієнт просить розмірну сітку/таблицю розмірів ("скиньте сітку", "є розмірна таблиця?") — {{context.product.sizeChartNote}} Якщо сітка Є і ти обіцяєш показати — обов'язково додай у json_output поле "wantsSizeChart":true (можна разом з height/weight/clothingSize в тому самому json_output). Якщо сітки НЕМА — просто чесно скажи це текстом, wantsSizeChart НЕ додавай.
7. Точні виміри цього товару по розмірах (якщо є): {{context.product.sizeChartData}} — якщо клієнт питає конкретну цифру ("який обхват грудей у L?", "яка довжина рукава?") — відповідай РІВНО з цих даних, не вигадуй і не округлюй на око. Якщо тут порожньо/null — чесно скажи, що точних цифр по цій моделі поки нема, орієнтуйся на зріст/вагу.
8. Якщо клієнт замість зросту й ваги сам ДОБРОВІЛЬНО назвав ТОЧНИЙ обхват грудей ("обхват грудей 104", "груди 104 см") — це сильніший сигнал, ніж зріст/вага: додай у json_output поле "chest": <см> (можна разом з height/weight, якщо він і їх назвав). НЕ питай обхват грудей сам — тільки якщо клієнт озвучив його першим.
Не вигадуй товарів/кольорів, яких нема вище.`;

const UPSELL2_ADDENDUM = `
ЯКЩО клієнт цікавиться допродажним товаром і просить показати фото — додай у ТОЙ САМИЙ json_output ще й поле "wantsUpsellPhoto":true (разом з done:true).`;

async function main() {
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + N_CALC_CODE + '\n})();');

    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    const nCalc = flow.nodes.find((n) => n.id === 'n_calc');
    const nSize = flow.nodes.find((n) => n.id === 'n_size');
    const nUnknownMsg = flow.nodes.find((n) => n.id === 'n_unknown_msg');
    const nUnknownStop = flow.nodes.find((n) => n.id === 'n_unknown_stop');
    const nSizeOorStop = flow.nodes.find((n) => n.id === 'n_size_oor_stop');
    const nUpsell2 = flow.nodes.find((n) => n.id === 'n_upsell2_wait');
    if (!nLookup || !nCalc || !nSize || !nUnknownMsg || !nUnknownStop || !nSizeOorStop || !nUpsell2) {
        console.log('ERROR: очікувані ноди не знайдено — перевір структуру covercar вручну.');
        process.exit(1);
    }

    const lookupDone = nLookup.data.code.includes('mimepRaw');
    const calcDone = nCalc.data.code.includes('sizeMatchedBy');
    const sizeDone = nSize.data.systemPrompt.includes('"chest"');
    const unknownAskDone = nUnknownMsg.data.productUnknownAsk === true;
    const restartFlagsDone = nUnknownStop.data.testRestartAfter === true && nSizeOorStop.data.testRestartAfter === true;
    const upsell2Done = nUpsell2.data.systemPrompt.includes('wantsUpsellPhoto');

    if (lookupDone && calcDone && sizeDone && unknownAskDone && restartFlagsDone && upsell2Done) {
        console.log('ALREADY_APPLIED'); process.exit(0);
    }

    console.log('n_lookup MIME/dedup/CT1012 =', !lookupDone, '| n_calc =', !calcDone, '| n_size prompt =', !sizeDone,
        '| productUnknownAsk =', !unknownAskDone, '| testRestartAfter x2 =', !restartFlagsDone, '| n_upsell2 photo =', !upsell2Done);
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_lookup' && !lookupDone) {
            let code = n.data.code;
            if (!code.includes(MIME_OLD) || !code.includes(UPSELL_OLD) || !code.includes(CT1012_ANCHOR) || !code.includes(RESULT_OLD)) {
                console.log('WARNING: n_lookup анкори не збіглись — код руками не змінено, перевір вручну.');
                return n;
            }
            code = code.split(MIME_OLD).join(MIME_NEW);
            code = code.split(UPSELL_OLD).join(UPSELL_NEW);
            code = code.split(CT1012_ANCHOR).join(CT1012_NEW);
            code = code.split(RESULT_OLD).join(RESULT_NEW);
            return { ...n, data: { ...n.data, code } };
        }
        if (n.id === 'n_calc' && !calcDone) return { ...n, data: { ...n.data, code: N_CALC_CODE } };
        if (n.id === 'n_size' && !sizeDone) {
            if (!n.data.systemPrompt.includes(N_SIZE_PROMPT_OLD)) {
                console.log('WARNING: n_size анкор не знайдено, лишаю без змін.');
                return n;
            }
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.replace(N_SIZE_PROMPT_OLD, N_SIZE_PROMPT_NEW) } };
        }
        if (n.id === 'n_unknown_msg' && !unknownAskDone) return { ...n, data: { ...n.data, productUnknownAsk: true } };
        if (n.id === 'n_unknown_stop' && !nUnknownStop.data.testRestartAfter) return { ...n, data: { ...n.data, testRestartAfter: true } };
        if (n.id === 'n_size_oor_stop' && !nSizeOorStop.data.testRestartAfter) return { ...n, data: { ...n.data, testRestartAfter: true } };
        if (n.id === 'n_upsell2_wait' && !upsell2Done) return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt + UPSELL2_ADDENDUM } };
        return n;
    });

    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
