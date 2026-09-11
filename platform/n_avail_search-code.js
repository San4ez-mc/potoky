// n_avail_search — джерело істини (goverla CRM-клон fcdee415, патч patch-goverla-crm-audit-2026-09-04.js).
// 2026-09-11 (власник: "питання чи є 6 магазин на складі має відпрацьовуватись воронкою самою —
// система має отримувати доступ до каталогу і аналізувати чи є, що немає, і пропонувати клієнту,
// не чекаючи менеджера"): живий кейс — клієнт вже обговорював кофту C0043, запитав про наявність
// ІНШОГО товару (лофери 45-46 розміру) — це askManager замість прямої відповіді з каталогу.
// Детермінований крок ПЕРЕД будь-якою claude-нодою, що може отримати таке питання: розпізнає
// "чи є / наявність / залишилось" + категорію (+ опційно розмір/колір), шукає в CRM НЕЗАЛЕЖНО
// від того, який товар вже "визначено" — і готує context.availAnswer з прямою відповіддю.
// 2026-09-11: lastUserMessage свідомо СКИДАЄТЬСЯ попередньою claude-нодою (n_color/n_size) в
// цьому ж ході — беремо СТАБІЛЬНИЙ знімок lastCustomerMessage (той самий урок, що й у
// UNKNOWN_DEBUG_CODE раніше цієї сесії), інакше на цьому кроці msg завжди порожній.
var msg = String(context.lastCustomerMessage || context.lastUserMessage || input || '').toLowerCase();
function out(ans) { return { availAnswer: ans || '' }; }
var isAvailQ = /(чи\s*є\b|є\s+в\s+наявнос|наявніст|наявність|залиш(и|ил)ось|маєте\s+ще|є\s+ще\s+так|є\s+ще\b)/i.test(msg);
if (!isAvailQ) return out('');
var STEMS = [
  ['кофт', 'кофт'], ['светр', 'кофт'], ['худ', 'худ'], ['бомбер', 'бомбер'], ['куртк', 'куртк'],
  ['вітровк', 'вітровк'], ['джинс', 'джинс'], ['штан', 'штан'], ['футболк', 'футболк'],
  ['лофер', 'лофер'], ['взутт', 'взутт'], ['кросів', 'кросів'], ['черевик', 'черевик'],
  ['костюм', 'костюм'], ['комплект', 'комплект'], ['накидк', 'накидк'],
];
var stem = null;
for (var i = 0; i < STEMS.length; i++) { if (msg.indexOf(STEMS[i][0]) >= 0) { stem = STEMS[i][1]; break; } }
// Без категорії в самому питанні — беремо категорію ПОТОЧНОГО товару (напр. "а розмір S є?" про вже обраний товар).
var curCatName = '';
if (!stem && context.product && context.product.categoryId) { /* категорія відома лише за назвою нижче, окремим запитом */ }
var sizeM = msg.match(/\b(\d{2}(?:[-\/]\d{2})?)\b/); // "45", "45-46", "45/46"
var sizeWanted = sizeM ? sizeM[1].split(/[-\/]/)[0] : '';
var colorM = msg.match(/(чорн\w*|сір\w*|біл\w*|син\w*|графіт\w*|бордов\w*|беж\w*|коричнев\w*|зелен\w*|червон\w*|хакі|олив\w*|молочн\w*|блакитн\w*)/i);
var colorWanted = colorM ? colorM[1] : '';
if (!stem && !sizeWanted && !colorWanted) return out('');
var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var apiKey = (keys.CRM_API_KEY || '').trim();
if (!apiKey) return out('');
var hdr = { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' };
var all = [];
try {
  var ac = new AbortController(); var to = setTimeout(function () { try { ac.abort(); } catch (e) {} }, 4000);
  try { var r = await fetch(base + '/products?take=300', { headers: hdr, signal: ac.signal }); var j = await r.json().catch(function () { return {}; }); all = Array.isArray(j.data) ? j.data : []; }
  finally { clearTimeout(to); }
} catch (e) { return out(''); }
function hay(p) { return (String(p.name || '') + ' ' + String(p.customerName || '')).toLowerCase(); }
// 2026-09-11: сети (артикул set...) мають слова категорій у СКЛАДІ назви ("Комплект 4 в 1 (...,
// лофери)") — без винятку вони забивали всі 4 слоти кандидатів раніше реальних окремих товарів.
var pool = all.filter(function (p) { return p.isActive !== false && !p.archived && !/^set/i.test(String(p.sku || '')); });
// Категорія з питання — інакше, якщо є розмір/колір без категорії, звужуємо до поточного товару (якщо є).
var candidates = stem ? pool.filter(function (p) { return hay(p).indexOf(stem) >= 0; }) : (context.product && context.product.sku ? pool.filter(function (p) { return String(p.sku || '').toUpperCase() === String(context.product.sku).toUpperCase(); }) : []);
if (!candidates.length) return out('');
// 2026-09-11 (живий тест, лофери 5932-5935): ці товари НЕ мають offers-варіантів взагалі
// (offersCount:0, p.sizes:[]) — реальний перелік розмірів лежить лише в sizeChartData.sizes
// (той самий блок, що рендерить розмірну сітку клієнту); колір — лише текстом у
// presentationText/aiNotes ("Колір: чорний"). Без цих fallback усі товари цього типу завжди
// виглядали "розміру/кольору немає" — false negative, бот брехав "немає в наявності".
function sizesOf(p) { var s = []; (p.offers || []).forEach(function (o) { (o.properties || []).forEach(function (pr) { var n = String(pr.name || '').toLowerCase(); if (n.indexOf('розмір') >= 0 || n.indexOf('размер') >= 0) { var v = String(pr.value || '').trim(); if (v && s.indexOf(v) < 0) s.push(v); } }); }); if (!s.length && Array.isArray(p.sizes) && p.sizes.length) s = p.sizes.slice(); if (!s.length && p.sizeChartData && Array.isArray(p.sizeChartData.sizes) && p.sizeChartData.sizes.length) s = p.sizeChartData.sizes.slice(); return s; }
function colorsOf(p) { var c = []; (p.offers || []).forEach(function (o) { (o.properties || []).forEach(function (pr) { var n = String(pr.name || '').toLowerCase(); if (n.indexOf('колір') >= 0 || n.indexOf('цвет') >= 0) { var v = String(pr.value || '').trim(); if (v && c.indexOf(v) < 0) c.push(v); } }); }); if (!c.length) { var src = String(p.presentationText || p.aiNotes || ''); var m = src.match(/колір[:\s]+([^\n,.;]+)/i); if (m) c.push(m[1].trim()); } return c; }
var lines = [];
for (var ci = 0; ci < candidates.length && lines.length < 4; ci++) {
  var p = candidates[ci]; var sizes = sizesOf(p); var colors = colorsOf(p);
  var sizeOk = !sizeWanted || sizes.some(function (s) { return s.replace(/\D/g, '') === sizeWanted; });
  var colorOk = !colorWanted || colors.some(function (c) { return c.toLowerCase().indexOf(colorWanted.slice(0, 4)) >= 0; });
  var status = (sizeOk && colorOk) ? 'Є в наявності ✅' : 'Немає саме такого варіанту ❌ (є: ' + (sizes.length ? 'розміри ' + sizes.join(', ') : '') + (sizes.length && colors.length ? '; ' : '') + (colors.length ? 'кольори ' + colors.join(', ') : '') + ')';
  lines.push((p.sku ? ('Артикул ' + p.sku + ' — ') : '') + String(p.name || p.customerName || '').trim() + (Number(p.price) ? (' — ' + Number(p.price) + ' грн') : '') + ': ' + status);
}
if (!lines.length) return out('');
return out('ДОВІДКА ПО НАЯВНОСТІ (система перевірила каталог щойно, дані точні — відповідай ЦИМИ фактами, не вигадуй): \n' + lines.join('\n'));
