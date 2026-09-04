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
function done(size, source) {
  var out = { recommendedSize: size, sizeSource: source, sizeReplyText: replyFor(source, size), sizeOutOfRange: false, sizeColorFollowup: __sizeColorFollowup, sizeAskedFor: __askedFor, knownMeasurementsToSave: __kmSave };
  if (__colorPick) out.colorChoice = { color: __colorPick, _fromSizeStep: true };
  return out;
}
function oor(reason, size) {
  return { sizeOutOfRange: true, sizeOorReason: reason, recommendedSize: size || '', sizeAskedFor: __askedFor, knownMeasurementsToSave: __kmSave };
}

// Реальні розміри товару з offers (порожньо = у CRM розмірів по офферах нема — тоді НЕ
// валідуємо, приймаємо як є; раніше тут був дефолт S/M/L/XL, через який взуття
// 42 перетворювалось на "розмір S").
var avail = (context.product && Array.isArray(context.product.sizes) && context.product.sizes.length) ? context.product.sizes.map(function (x) { return String(x).toUpperCase().trim(); }) : [];
var order = ['XS','S','M','L','XL','XXL','XXXL','2XL','3XL','4XL'];

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
var ex = exactBy(chestVal, /груд/i, false);
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
var byW = pick(w, 'weight'), byH = pick(h, 'height');
var size = null;
if (byW && byH) { size = order.indexOf(byW) >= order.indexOf(byH) ? byW : byH; }
else { size = byW || byH; }
if (!size && clientSize) {
  if (avail.length && avail.indexOf(clientSize) < 0) return oor('клієнт просить розмір ' + clientSize + ', а в товарі є лише: ' + avail.join(', '), clientSize);
  return done(clientSize, 'client');
}
if (!size) return oor('не вдалося визначити розмір за зростом ' + h + ' / вагою ' + w + ' (SIZE_CHART не покриває)', '');
size = String(size).toUpperCase();
if (avail.length && avail.indexOf(size) < 0) {
  // Сітка товару літерна — беремо найближчий наявний. Числова (46/48, 40/41) — універсальна
  // SIZE_CHART до неї не застосовна, чесно ескалюємо (раніше мовчки брався перший розмір).
  var letterAvail = avail.filter(function (a) { return order.indexOf(a) >= 0; });
  if (!letterAvail.length) return oor('за сіткою виходить ' + size + ', але у товару числова/нестандартна сітка: ' + avail.join(', '), size);
  var idx = order.indexOf(size), best = letterAvail[0], bestd = 999;
  for (var i = 0; i < letterAvail.length; i++){ var dd = Math.abs(order.indexOf(letterAvail[i]) - idx); if (dd < bestd){ bestd = dd; best = letterAvail[i]; } }
  size = best;
}
return done(size, 'chart');
