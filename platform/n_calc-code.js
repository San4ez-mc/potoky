// n_calc — джерело істини (goverla CRM-клон fcdee415, патч patch-goverla-crm-audit-2026-09-04.js).
// Аудит 2026-09-03 (__hwSwapFix, живий кейс власника — "180 100" при переплутаному
// порядку): ДЕТЕРМІНОВАНИЙ пост-фікс ПІСЛЯ json_output моделі (n_size, outputVar
// sizeInput) — САМА логіка розпізнавання моделі НЕ переписується. Для дорослої людини
// зріст (140-220см) практично завжди >= вага (30-200кг) — якщо модель повернула
// height < weight, і обмін місцями дає ОБИДВА значення в реалістичних межах — міняємо.
if (context.sizeInput && typeof context.sizeInput === 'object') {
    var __hwH = Number(context.sizeInput.height), __hwW = Number(context.sizeInput.weight);
    if (isFinite(__hwH) && isFinite(__hwW) && __hwH > 0 && __hwW > 0 && __hwH < __hwW) {
        var __hwSwappedH = __hwW, __hwSwappedW = __hwH;
        if (__hwSwappedH >= 140 && __hwSwappedH <= 220 && __hwSwappedW >= 30 && __hwSwappedW <= 200) {
            context.sizeInput = Object.assign({}, context.sizeInput, { height: __hwSwappedH, weight: __hwSwappedW });
        }
    }
}

// 2026-09-11 (власник: "розмір має рахуватись для кожного товару в комплекті окремо" — для
// "весь комплект" раніше рахувався ОДИН спільний розмір на весь набір, хоча кофта/джинси/лофери
// мають РІЗНІ системи розмірів). Якщо товар — сет і клієнт щойно дав зріст/вагу — рахуємо розмір
// ОКРЕМО для кожної позиції зі своєї сітки/структурованих розмірів, і повертаємось РАНІШЕ за
// звичайну одно-товарну логіку нижче (яка для сета не застосовна — у сета немає власної сітки).
if (context.product && context.product.isSet && Array.isArray(context.product.setItems) && context.product.setItems.length
    && context.sizeInput && Number(context.sizeInput.height) > 0 && Number(context.sizeInput.weight) > 0) {
  var __setH = Number(context.sizeInput.height), __setW = Number(context.sizeInput.weight);
  var __setOrder = ['XS','S','M','L','XL','XXL','XXXL','4XL'];
  var __setChart = {}; try { __setChart = JSON.parse(keys.SIZE_CHART || '{}'); } catch (e) {}
  function __setNorm(x) { return String(x || '').toUpperCase().trim().replace(/^2XL$/, 'XXL').replace(/^3XL$/, 'XXXL'); }
  function __setInRange(v, r) { return r && v >= Number(r[0]) && v <= Number(r[1]); }
  // Компактна версія основного алгоритму (вага — головний критерій, зріст — поправка; той самий
  // допуск на суміжних межах, що й у головній логіці нижче) — лише для letter-розмірів (S..XXXL).
  function __setCalcOne(avail) {
    var wMatches = []; for (var wk in __setChart) { if (__setInRange(__setW, __setChart[wk] && __setChart[wk].weight)) wMatches.push(wk); }
    wMatches.sort(function (a, b) { return __setOrder.indexOf(a) - __setOrder.indexOf(b); });
    var size = null;
    if (wMatches.length) {
      var hOk = wMatches.filter(function (k) { return __setInRange(__setH, __setChart[k] && __setChart[k].height); });
      if (hOk.length) size = hOk[0];
      else {
        var hMaxOfW = Math.max.apply(null, wMatches.map(function (k) { return Number((__setChart[k].height || [0, 0])[1]); }));
        if (__setH > hMaxOfW) {
          var bumpCands = wMatches.slice();
          for (var bwk in __setChart) { if (bumpCands.indexOf(bwk) >= 0) continue; var bwr = __setChart[bwk] && __setChart[bwk].weight; if (bwr && __setW > Number(bwr[1]) && __setW <= Number(bwr[1]) + 3) bumpCands.push(bwk); }
          bumpCands.sort(function (a, b) { return __setOrder.indexOf(a) - __setOrder.indexOf(b); });
          var baseW = bumpCands[0]; var nx = __setOrder[__setOrder.indexOf(baseW) + 1]; size = (nx && __setChart[nx]) ? nx : baseW;
        } else size = wMatches[0];
      }
    }
    if (!size) return { oor: 'не визначено за зростом/вагою' };
    if (avail.length) {
      var letterAvail = avail.filter(function (a) { return __setOrder.indexOf(a) >= 0; });
      if (letterAvail.length && avail.indexOf(size) < 0) {
        var maxIdx = Math.max.apply(null, letterAvail.map(function (a) { return __setOrder.indexOf(a); }));
        if (__setOrder.indexOf(size) > maxIdx) return { oor: 'найбільший наявний ' + __setOrder[maxIdx] + ' (буде малий)' };
        var idx = __setOrder.indexOf(size), best = letterAvail[0], bestd = 999;
        for (var i = 0; i < letterAvail.length; i++) { var dd = Math.abs(__setOrder.indexOf(letterAvail[i]) - idx); if (dd < bestd) { bestd = dd; best = letterAvail[i]; } }
        size = best;
      }
    }
    return { size: size };
  }
  var __setLines = [];
  for (var __si = 0; __si < context.product.setItems.length; __si++) {
    var __it = context.product.setItems[__si];
    var __itAvail = (Array.isArray(__it.structuredSizes) && __it.structuredSizes.length ? __it.structuredSizes : (__it.sizeChartData && Array.isArray(__it.sizeChartData.sizes) ? __it.sizeChartData.sizes : [])).map(__setNorm);
    var __itLetter = __itAvail.some(function (a) { return __setOrder.indexOf(a) >= 0; });
    if (__itLetter) {
      var __r = __setCalcOne(__itAvail);
      __setLines.push(__it.name + ': ' + (__r.size ? ('розмір ' + __r.size) : ('уточнимо окремо — ' + __r.oor)));
    } else if (__itAvail.length) {
      __setLines.push(__it.name + ': розмір оберіть самі (' + __itAvail.join(', ') + ')');
    } else {
      __setLines.push(__it.name + ': розмір уточнимо окремо в чаті');
    }
  }
  return {
    isSetSizeCalc: true,
    setSizesText: __setLines.join('\n'),
    sizeReplyText: 'Дякую! 🙌 За зростом ' + __setH + ' см і вагою ' + __setW + ' кг підібрала розмір для кожної позиції:\n' + __setLines.join('\n'),
    sizeOutOfRange: false,
    knownMeasurementsToSave: null
  };
}

// Підтвердження розміру й питання про колір мають йти РАЗОМ, одним повідомленням
// (n_size_reply) — інакше клієнт лишається з голою похвалою без наступного кроку.
var __needsColorAsk = !!(context.product && String(context.product.colors||'').trim().length > 0 && !(context.colorChoice && context.colorChoice.color));
var __sizeColorFollowup = __needsColorAsk ? ('\n\n🎨 Тепер оберіть колір: ' + context.product.colors + ' — який вам більше до душі? 😊') : '';

var s0 = context.sizeInput || {};
// «Памʼять вимірів клієнта»: {[paramName]: value} для збереження на Buyer — ключі СУВОРО
// ті самі, що categoryParams[].name.
var __kmCatParams = (context.product && context.product.categoryParams) || [];
var __kmIsHW = !!(context.product && context.product.categoryParamsIsHeightWeight);
var __kmSave = null;
if (__kmCatParams.length) {
  var __kmNameH = null, __kmNameW = null;
  for (var __kmi = 0; __kmi < __kmCatParams.length; __kmi++) {
    var __kmLn = String(__kmCatParams[__kmi].name || '').toLowerCase();
    if (/зріст|height|ріст/.test(__kmLn)) __kmNameH = __kmCatParams[__kmi].name;
    if (/вага|weight/.test(__kmLn)) __kmNameW = __kmCatParams[__kmi].name;
  }
  if (__kmIsHW && __kmNameH && __kmNameW && (s0.height || s0.weight)) {
    __kmSave = {};
    if (s0.height) __kmSave[__kmNameH] = String(s0.height);
    if (s0.weight) __kmSave[__kmNameW] = String(s0.weight);
  } else if (!__kmIsHW && s0.clothingSize) {
    __kmSave = {};
    if (__kmCatParams.length === 1) {
      __kmSave[__kmCatParams[0].name] = String(s0.clothingSize).trim();
    } else {
      var __kmParts = String(s0.clothingSize).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      for (var __kmj = 0; __kmj < __kmCatParams.length && __kmj < __kmParts.length; __kmj++) { __kmSave[__kmCatParams[__kmj].name] = __kmParts[__kmj]; }
    }
  }
}
if (__kmSave && context.crmClientId && !context.testMode) {
  try {
    var __kmBase = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
    var __kmKey = (keys.CRM_API_KEY || '').trim();
    if (__kmKey) {
      await fetch(__kmBase + '/buyers/' + context.crmClientId, { method: 'PATCH', headers: { Authorization: 'Bearer ' + __kmKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ knownMeasurements: __kmSave }) });
    }
  } catch (e) { /* best-effort */ }
}

// Текст підтвердження розміру — залежить від того, ЗВІДКИ взявся розмір (аудит 2026-09-04):
// chart — порахували за сіткою; client — клієнт сам назвав/наполіг; exact — точний вимір
// (обхват грудей) по сітці ЦІЄЇ моделі. Раніше n_size_reply завжди писав "ідеально підійде,
// перевірено" — навіть для розміру, який клієнт назвав сам.
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function replyFor(source, size) {
  var S = String(size);
  if (source === 'client') return pickOne([
    'Записала ваш розмір ' + S + ' 📏',
    'Добре, беремо розмір ' + S + ' 📏',
    'Зафіксувала розмір ' + S + ' 📏'
  ]);
  if (source === 'exact') {
    var m = (typeof __exactMeasure === 'string' && __exactMeasure) ? __exactMeasure : 'обхватом грудей';
    return pickOne([
      'За ' + m + ' підійде розмір ' + S + ' 📏 — звірила з сіткою саме цієї моделі 👌',
      'За ' + m + ' ваш розмір — ' + S + ' 📏, це точно за сіткою цієї моделі 👌'
    ]);
  }
  return pickOne([
    'Дякую! 🙌 За вашими параметрами ідеально підійде розмір ' + S + ' 📏 — сяде якраз, перевірено 👌',
    'Супер, дякую! 🙌 Вам ідеально підійде розмір ' + S + ' 📏 — перевірено, сяде як треба 👌',
    'Дякую за параметри! За ними найкраще підійде розмір ' + S + ' 📏 — сяде чудово 👌',
    'Записала! 🙌 Ваш розмір — ' + S + ' 📏, за такими параметрами сяде ідеально 👌',
    'Дякую 🙌 За вашими даними рекомендую розмір ' + S + ' 📏 — впевнена, сяде як влитий 👌'
  ]);
}
var __askedFor = (context.product && context.product.categoryId) || true;
// v3 (реальні кейси 2026-09-04: "Чорний колір Параметри 182/100", "Потрібен розмір S в графітному"):
// колір, названий разом із параметрами, n_size кладе в sizeInput.color — фіксуємо його як colorChoice,
// щоб не перепитувати на наступному кроці (лише якщо він є у списку кольорів товару).
var __colorPick = null;
if (s0.color && context.product && String(context.product.colors || '').trim()) {
  var __want = String(s0.color).toLowerCase().replace(/[^a-zа-яіїєґ0-9\- ]/gi, '').trim();
  var __list = String(context.product.colors).split(',').map(function (c) { return c.trim(); }).filter(Boolean);
  __colorPick = __list.filter(function (c) { var l = c.toLowerCase(); return l === __want || l.indexOf(__want) === 0 || __want.indexOf(l) === 0; })[0] || null;
}
if (__colorPick) { __needsColorAsk = false; __sizeColorFollowup = '\n\n🎨 Колір: ' + __colorPick + ' — зафіксувала 👍'; }
// 2026-09-08 (evgensiskz: клієнт надіслав фото джинсів і кофти, потім параметри — бот перепитав колір списком,
// хоча на фото він видно): якщо є свіже фото клієнта (≤30 хв) і колір ще не обрано — Gemini визначає колір ЦЬОГО
// товару на фото зі списку кольорів; n_size_reply пропонує саме його («На фото — сірий, беремо його?»), n_color
// бачить context.photoColor. Best-effort: без ключа/фото/відповіді — звичайне питання зі списком.
var __photoColor = '';
try {
  var __imgUrl = context.lastUserImageUrl || ((Date.now() - (Number(context.recentUserImageAt) || 0)) < 30 * 60 * 1000 ? String(context.recentUserImageUrl || '') : '');
  var __colorsArr = String((context.product && context.product.colors) || '').split(',').map(function (c) { return c.trim(); }).filter(Boolean);
  if (__needsColorAsk && __imgUrl && /^https?:/.test(__imgUrl) && __colorsArr.length >= 2 && keys.GEMINI_API_KEY) {
    var __acc = new AbortController(); var __tmr = setTimeout(function () { try { __acc.abort(); } catch (e) { } }, 9000);
    try {
      // 2026-09-12: __imgUrl може бути Zernio-проксі refreshUrl (домен zernio.com, замінює 403-нуче
      // підписане Meta-посилання) — такі запити потребують Bearer ZERNIO_API_TOKEN.
      var __ihdr = {}; try { if (new URL(__imgUrl).hostname.toLowerCase() === 'zernio.com' && keys.ZERNIO_API_TOKEN) __ihdr.Authorization = 'Bearer ' + keys.ZERNIO_API_TOKEN; } catch (e) { }
      var __ir = await fetch(__imgUrl, { signal: __acc.signal, headers: __ihdr }); var __ab = await __ir.arrayBuffer();
      if (__ab.byteLength <= 8000000) {
        var __mime = ((__ir.headers.get('content-type') || '').split(';')[0]) || 'image/jpeg'; if (__mime === 'application/octet-stream') __mime = 'image/jpeg';
        var __pp = 'На фото клієнта може бути товар «' + String(context.product.customerName || context.product.name || '') + '» (можливо разом з іншими речами). Доступні кольори цього товару: ' + __colorsArr.join(', ') + '. Який із цих кольорів має САМЕ цей товар на фото? Відповідай лише JSON: {"color":"<точна назва зі списку або порожній рядок, якщо товару на фото нема або колір не зі списку>","confidence":0..1}';
        // 2026-09-13 (КРИТИЧНО): gemini-2.5-flash ретайрнута (404) з 2026-09-10 — gemini-flash-latest.
        var __gr = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + encodeURIComponent(keys.GEMINI_API_KEY), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: __pp }, { inline_data: { mime_type: __mime, data: Buffer.from(__ab).toString('base64') } }] }] }), signal: __acc.signal });
        var __gj = await __gr.json(); var __gt = ((((__gj.candidates || [])[0] || {}).content || {}).parts || [{}])[0].text || '';
        var __gm = __gt.match(/\{[\s\S]*\}/);
        if (__gm) { var __gp = JSON.parse(__gm[0]); var __gc = String(__gp.color || '').trim().toLowerCase(); var __hit = __colorsArr.filter(function (c) { return c.toLowerCase() === __gc; })[0]; if (__hit && Number(__gp.confidence) >= 0.6) __photoColor = __hit; }
      }
    } catch (e) { } finally { clearTimeout(__tmr); }
  }
} catch (e) { __photoColor = ''; }
if (__photoColor) { __sizeColorFollowup = '\n\n🎨 На фото — ' + __photoColor.toLowerCase() + ' колір. Беремо його чи інший (' + __colorsArr.filter(function (c) { return c !== __photoColor; }).join(', ') + ')? 😊'; }
// «також хоче» (інші речі, названі на кроці розміру) — зливаємо з тим, що вже було з першого повідомлення
var __alsoMerged = [String(context.alsoWants || '').trim(), String(s0.alsoWants || '').trim()].filter(Boolean).join('; ');
function done(size, source) {
  var out = { recommendedSize: size, sizeSource: source, sizeReplyText: replyFor(source, size), sizeOutOfRange: false, sizeColorFollowup: __sizeColorFollowup, sizeAskedFor: __askedFor, knownMeasurementsToSave: __kmSave, photoColor: __photoColor };
  if (__colorPick) out.colorChoice = { color: __colorPick, _fromSizeStep: true };
  if (__alsoMerged) out.alsoWants = __alsoMerged;
  return out;
}
function oor(reason, size) {
  var o = { sizeOutOfRange: true, sizeOorReason: reason, recommendedSize: size || '', sizeAskedFor: __askedFor, knownMeasurementsToSave: __kmSave };
  if (__alsoMerged) o.alsoWants = __alsoMerged;
  return o;
}

// Реальні розміри товару з offers (порожньо = у CRM розмірів по офферах нема — тоді НЕ
// валідуємо, приймаємо як є; раніше тут був дефолт S/M/L/XL, через який взуття
// 42 перетворювалось на "розмір S").
function normSize(x) { return String(x || '').toUpperCase().trim().replace(/^2XL$/, 'XXL').replace(/^3XL$/, 'XXXL').replace(/^4XL$/, '4XL'); }
var avail = (context.product && Array.isArray(context.product.sizes) && context.product.sizes.length) ? context.product.sizes.map(normSize) : [];
// 2026-09-11 (Russo 187/115кг → XXL без застереження "буде малий", хоча в товару максимум XXL):
// Product.sizes (структуроване поле) у CRM ПОРОЖНЄ практично для всього каталогу — власник ввів
// розміри лише текстом у описі. Але sizeChartData.sizes (розмірна сітка) ЧАСТО заповнена — це
// той самий список реальних розмірів товару, тому використовуємо як фолбек, коли avail порожній.
if (!avail.length && context.product && context.product.sizeChartData && Array.isArray(context.product.sizeChartData.sizes) && context.product.sizeChartData.sizes.length) {
  avail = context.product.sizeChartData.sizes.map(normSize);
}
var order = ['XS','S','M','L','XL','XXL','XXXL','4XL'];

// 1) Точний вимір проти реальних вимірів ЦЬОГО товару (sizeChartData.measurements).
//    Обхват грудей → ключ /груд/; довжина стопи/устілки (взуття, 2026-09-04) → /стоп|устілк|foot/.
//    Для стопи: якщо між двома розмірами — беремо БІЛЬШИЙ (взуття не має тиснути).
var sc = context.product && context.product.sizeChartData;
function exactBy(val, keyRe, preferLarger) {
  if (!(val > 0) || !sc || !Array.isArray(sc.sizes) || !sc.measurements) return null;
  var key = Object.keys(sc.measurements).find(function(k){ return keyRe.test(k); });
  if (!key || !Array.isArray(sc.measurements[key]) || sc.measurements[key].length !== sc.sizes.length) return null;
  var arr = sc.measurements[key].map(Number);
  var bestIdx = -1, bestDiff = Infinity;
  for (var ci = 0; ci < arr.length; ci++) { var d = Math.abs(arr[ci] - val); if (d < bestDiff) { bestDiff = d; bestIdx = ci; } }
  if (bestIdx < 0) return null;
  if (preferLarger && arr[bestIdx] < val && bestIdx + 1 < arr.length && (arr[bestIdx + 1] - val) <= 0.6) bestIdx = bestIdx + 1;
  var mn = Math.min.apply(null, arr), mx = Math.max.apply(null, arr);
  if (val < mn - 1 || val > mx + 1) return { outOfChart: true, min: mn, max: mx, key: key };
  var exactSize = String(sc.sizes[bestIdx] || '').toUpperCase().trim();
  if (!exactSize || (avail.length && avail.indexOf(exactSize) < 0)) return null;
  return { size: exactSize };
}
var chestVal = Number(s0.chest) || 0;
var footVal = Number(s0.footLength) || 0;
var __exactMeasure = '';
// 2026-09-09 (yarvolod: «182, 100 кг, обхват грудей 108» → бот покликав менеджера, бо 108 < мінімального обхвату ВИРОБУ 110):
// обхват грудей клієнта — це обхват тіла, а в сітці — виріб із запасом, тому при наявних зрості й вазі рахуємо за ними,
// а обхват беремо лише коли зросту/ваги нема.
var __hwGiven = (Number(s0.height) || 0) > 0 && (Number(s0.weight) || 0) > 0;
var ex = __hwGiven ? null : exactBy(chestVal, /груд/i, false);
if (ex) __exactMeasure = 'обхватом грудей ' + String(chestVal).replace('.', ',') + ' см';
if (!ex) { ex = exactBy(footVal, /стоп|устілк|foot|нога/i, true); if (ex) __exactMeasure = 'довжиною стопи ' + String(footVal).replace('.', ',') + ' см'; }
if (ex && ex.outOfChart) return oor('вимір ' + (footVal || chestVal) + ' см поза сіткою товару (' + ex.key + ': ' + ex.min + '–' + ex.max + ' см)', '');
if (ex && ex.size) { var r = done(ex.size, 'exact'); r.sizeMatchedBy = 'exact_measurement'; return r; }

// 2) Розмір, який клієнт назвав сам (S/M/L або будь-який параметр категорії без зросту/ваги).
var s = s0;
var w = Number(s.weight) || 0, h = Number(s.height) || 0;
var clientSize = s.clothingSize ? String(s.clothingSize).toUpperCase().trim() : '';
if (clientSize && !(w && h)) {
  if (avail.length && avail.indexOf(clientSize) < 0) {
    return oor('клієнт просить розмір ' + clientSize + ', а в товарі є лише: ' + avail.join(', '), clientSize);
  }
  return done(clientSize, 'client');
}

// 3) Зріст/вага за універсальною SIZE_CHART.
var chart = {};
try { chart = JSON.parse(keys.SIZE_CHART || '{}'); } catch (e) {}
function inRange(v, r){ return r && v >= Number(r[0]) && v <= Number(r[1]); }
function pick(v, dim){ if(!v) return null; for(var kk in chart){ if(inRange(v, chart[kk] && chart[kk][dim])) return kk; } return null; }
var hMin=1e9,hMax=-1e9,wMin=1e9,wMax=-1e9;
for (var k in chart){ var c=chart[k]||{}; if(c.height){ hMin=Math.min(hMin,Number(c.height[0])); hMax=Math.max(hMax,Number(c.height[1])); } if(c.weight){ wMin=Math.min(wMin,Number(c.weight[0])); wMax=Math.max(wMax,Number(c.weight[1])); } }
var TOL_H=5, TOL_W=8;
var oorH = h > 0 && isFinite(hMin) && (h < hMin - TOL_H || h > hMax + TOL_H);
var oorW = w > 0 && isFinite(wMin) && (w < wMin - TOL_W || w > wMax + TOL_W);
if (oorH || oorW) {
  return oor((oorH?('зріст '+h+' см поза сіткою ('+hMin+'-'+hMax+')'):'') + (oorH&&oorW?'; ':'') + (oorW?('вага '+w+' кг поза сіткою ('+wMin+'-'+wMax+')'):''), '');
}
// v10 (фідбек власника 2026-09-07: 190/63 бот дав XXL, 180/65 — L; правильно M і M): ВАГА — головний
// критерій, зріст — поправка. Серед розмірів, куди влучає вага, беремо той, чий діапазон зросту містить
// зріст; якщо зріст вищий за всі такі — на розмір більше (високий і худий → M, не XXL за зростом);
// якщо нижчий — лишаємо найменший за вагою. Без збігу за вагою — старий фолбек.
var byW = pick(w, 'weight'), byH = pick(h, 'height');
var size = null;
var wMatches = []; for (var wk in chart) { if (inRange(w, chart[wk] && chart[wk].weight)) wMatches.push(wk); }
wMatches.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
if (w && h && wMatches.length) {
  var hOk = wMatches.filter(function (k) { return inRange(h, chart[k] && chart[k].height); });
  if (hOk.length) size = hOk[0];
  else {
    var hMaxOfW = Math.max.apply(null, wMatches.map(function (k) { return Number((chart[k].height || [0, 0])[1]); }));
    // 187/85 (Олена, 09-07): вага на межі L/XL, зріст вищий за обидва → бамп від МЕНШОГО (L→XL), а не від XL→XXL (менеджер: XL).
    // 2026-09-11 (власник: 187/86 → бот дав XXL, має бути XL, так само як підтверджене 187/85 → XL):
    // пороги суміжні (L 75-85, XL 85-100) — рівно НА межі (85 кг) L теж матчиться і бамп іде від
    // НЬОГО (L→XL, коректно), а вже за 1 кг вище (86 кг) L випадає зі списку взагалі — лишається
    // тільки XL, бамп іде вже від XL→XXL — стрибок на цілий розмір через 1 кг. Для вибору БАЗИ
    // бампа (не для прямого hOk-збігу вище) додатково пускаємо в кандидати сусідній НИЖЧИЙ бренд,
    // якщо вага лише трохи (≤3 кг) вище його межі — база бампа лишається тією ж, що й на самій межі.
    if (h > hMaxOfW) {
      var bumpCands = wMatches.slice();
      for (var bwk in chart) {
        if (bumpCands.indexOf(bwk) >= 0) continue;
        var bwr = chart[bwk] && chart[bwk].weight;
        if (bwr && w > Number(bwr[1]) && w <= Number(bwr[1]) + 3) bumpCands.push(bwk);
      }
      bumpCands.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      var baseW = bumpCands[0]; var nx = order[order.indexOf(baseW) + 1]; size = (nx && chart[nx]) ? nx : baseW;
    }
    else size = wMatches[0];
  }
} else if (byW && byH) { size = order.indexOf(byW) >= order.indexOf(byH) ? byW : byH; }
else { size = byW || byH; }
if (!size && clientSize) {
  if (avail.length && avail.indexOf(clientSize) < 0) return oor('клієнт просить розмір ' + clientSize + ', а в товарі є лише: ' + avail.join(', '), clientSize);
  return done(clientSize, 'client');
}
if (!size) return oor('не вдалося визначити розмір за зростом ' + h + ' / вагою ' + w + ' (SIZE_CHART не покриває)', '');
size = String(size).toUpperCase();
// 2026-09-08 (Мирошниченко: «в чоловіка обхват талії 113 см, є животик» — бот проігнорував, взяв L): талія ≥ 105 см або
// згадка про живіт → на розмір більше за сіткою (якщо він є у товару), і кажемо про це клієнту.
var __waist = Number(s0.waist) || 0; var __bellyNote = '';
if ((s0.belly === true || __waist >= 105) && order.indexOf(size) >= 0) {
  var __nx = order[order.indexOf(size) + 1];
  if (__nx && (!avail.length || avail.indexOf(__nx) >= 0)) { size = __nx; __bellyNote = ' (з урахуванням ' + (__waist ? 'талії ' + __waist + ' см' : 'животика') + ' взяла на розмір більше)'; }
}
if (avail.length && avail.indexOf(size) < 0) {
  // Сітка товару літерна — беремо найближчий наявний. Числова (46/48, 40/41) — універсальна
  // SIZE_CHART до неї не застосовна, чесно ескалюємо (раніше мовчки брався перший розмір).
  var letterAvail = avail.filter(function (a) { return order.indexOf(a) >= 0; });
  if (!letterAvail.length) return oor('за сіткою виходить ' + size + ', але у товару числова/нестандартна сітка: ' + avail.join(', '), size);
  // 2026-09-07 (Олена, 185/120, куртка S–XXL): за сіткою XXXL, найбільший наявний XXL — раніше мовчки брали XXL
  // («буде точно мала», менеджер). Більший за наявні → ескалація до менеджера, а не менший розмір.
  var __maxIdx = Math.max.apply(null, letterAvail.map(function (a) { return order.indexOf(a); }));
  if (order.indexOf(size) > __maxIdx) return oor('за параметрами (' + h + ' см / ' + w + ' кг) виходить ' + size + ', а найбільший наявний розмір — ' + order[__maxIdx] + ' (буде малий)', size);
  var idx = order.indexOf(size), best = letterAvail[0], bestd = 999;
  for (var i = 0; i < letterAvail.length; i++){ var dd = Math.abs(order.indexOf(letterAvail[i]) - idx); if (dd < bestd){ bestd = dd; best = letterAvail[i]; } }
  size = best;
}
// 2026-09-08 (власник, ganusiako: «потрібно розмір хл, вага 81, ріст 174» — бот дав L і не згадав прохання клієнта):
// клієнт назвав розмір РАЗОМ із параметрами → називаємо свою рекомендацію за сіткою, але ФІКСУЄМО розмір клієнта
// (якщо він є у товару). Немає такого розміру — лишаємо рекомендацію і кажемо про це.
if (clientSize && clientSize !== size) {
  var __clientOk = !avail.length || avail.indexOf(clientSize) >= 0;
  if (__clientOk) {
    var __ov = done(clientSize, 'client_override');
    __ov.recommendedByChart = size;
    __ov.sizeReplyText = 'За вашими параметрами (' + h + ' см / ' + w + ' кг) я б порадила ' + size + __bellyNote + ', але фіксую ' + clientSize + ', як ви просите 📏 Якщо захочете — можна змінити до оформлення 🙂';
    return __ov;
  }
  var __resNo = done(size, 'chart');
  __resNo.sizeReplyText = String(__resNo.sizeReplyText || '').replace(/\s*📏/, __bellyNote + ' 📏') + ' Розміру ' + clientSize + ' у цієї моделі немає (є: ' + avail.join(', ') + ').';
  return __resNo;
}
var __resChart = done(size, 'chart');
if (typeof __bellyNote === 'string' && __bellyNote) __resChart.sizeReplyText = String(__resChart.sizeReplyText || '').replace(/\s*📏/, __bellyNote + ' 📏');
return __resChart;
