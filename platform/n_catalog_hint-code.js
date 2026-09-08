// n_catalog_hint — джерело істини (CRM-клони, патч patch-goverla-crm-audit-2026-09-04.js, v5).
// Діалог не завжди починається з поста/реклами (2026-09-04, рішення власника): клієнт може написати
// «Добрий вечір», «яка ціна кофти?», «є лофери?», «яка доставка?». Тут детерміновано готуємо для
// n_unknown_msg: catalogCategories — категорії магазину з CRM з кількістю товарів (для привітання),
// catalogHint — до 4 товарів названої категорії (артикул, назва, ціна). Best-effort: помилка → порожньо.
var msg = String(context.lastUserMessage || input || '').toLowerCase();
var unknownTurns = (Number(context.unknownTurns) || 0) + 1;
function out(hint, cnt, cats) { return { catalogHint: hint || '', catalogHintCount: cnt || 0, catalogHintSkus: '', catalogHintPick: '', catalogCategories: cats || '', unknownTurns: unknownTurns }; }
if (context.product) return out('', 0, '');
var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var apiKey = (keys.CRM_API_KEY || '').trim();
if (!apiKey) return out('', 0, '');
var hdr = { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' };
var all = [], cats = {};
try {
  var ac = new AbortController(); var to = setTimeout(function () { try { ac.abort(); } catch (e) {} }, 4000);
  try {
    var r = await fetch(base + '/products?take=300', { headers: hdr, signal: ac.signal });
    var j = await r.json().catch(function () { return {}; }); all = Array.isArray(j.data) ? j.data : [];
    var rc = await fetch(base + '/categories', { headers: hdr, signal: ac.signal });
    var jc = await rc.json().catch(function () { return {}; }); (Array.isArray(jc.data) ? jc.data : []).forEach(function (c) { cats[c.id] = String(c.name || '').trim(); });
  } finally { clearTimeout(to); }
} catch (e) { return out('', 0, ''); }
var active = all.filter(function (p) { return p.isActive !== false && !p.archived && !/^set/i.test(String(p.sku || '')); });
// Категорії з кількістю товарів — для привітання («що цікавить: кофти (6), бомбери (4)…»)
var counts = {};
active.forEach(function (p) { var n = cats[p.categoryId]; if (n) counts[n] = (counts[n] || 0) + 1; });
var catList = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (n) { return n.toLowerCase() + ' (' + counts[n] + ')'; }).join(', ');
// Підказка від n_lookup: реклама комплекту, клієнт назвав категорію, у наборах кілька таких компонентів — питаємо, який.
if (context.setComponentHint) { var __scn = String(context.setComponentHint).split('\n').length; return { catalogHint: context.setComponentHint, catalogHintCount: __scn, catalogHintTotal: __scn, catalogCategories: catList, unknownTurns: unknownTurns }; }
if (!msg) return out('', 0, catList);
// 2026-09-08 (_grigoriy_: «надішліть зображення костюму (мажор)» після списку): повідомлення без артикула йде сюди в обхід
// n_lookup (n_signal_cond=false). Якщо слово з повідомлення називає РІВНО один товар — спершу зі щойно показаного списку
// (catalogHintSkus), потім з усього каталогу (кілька збігів звужуємо словом-категорією) — віддаємо його як catalogHintPick:
// n_hint_pick_cond веде на звичайний шлях n_lookup → презентація з фото.
try {
  var __STOP = { 'надіслати': 1, 'надішліть': 1, 'зображення': 1, 'могли': 1, 'можете': 1, 'будь': 1, 'ласка': 1, 'дякую': 1, 'ціна': 1, 'ціну': 1, 'розмір': 1, 'колір': 1, 'фото': 1, 'скиньте': 1, 'скинути': 1, 'підберіть': 1, 'зріст': 1, 'вага': 1, 'чорний': 1, 'чорну': 1, 'сірий': 1, 'білий': 1, 'синій': 1, 'хочу': 1, 'цікавить': 1, 'артикул': 1, 'товар': 1, 'товару': 1, 'пост': 1, 'який': 1, 'яка': 1, 'можна': 1, 'вітаю': 1, 'привіт': 1, 'добрий': 1, 'день': 1, 'вечір': 1, 'ранок': 1, 'наявності': 1, 'наявність': 1, 'замовити': 1, 'замовлення': 1, 'доставка': 1, 'оплата': 1 };
  var __stemM = msg.match(/(кофт|футболк|джинс|бомбер|куртк|вітровк|костюм|штан|лофер|кросівк|худі|светр|черевик|накидк)/i); var __stem = __stemM ? __stemM[1] : '';
  var __uw = msg.replace(/[^a-zа-яіїєґ0-9\s]/gi, ' ').split(/\s+/).filter(function (w) { return w.length >= 4 && !__STOP[w] && !(__stem && w.indexOf(__stem) === 0); });
  if (__uw.length) {
    var __nameOf = function (p) { return (String(p.name || '') + ' ' + String(p.customerName || '')).toLowerCase(); };
    var __hitsBy = function (list) { return list.filter(function (p) { var h = __nameOf(p); return __uw.some(function (w) { return h.indexOf(w) >= 0; }); }); };
    var __prev = String(context.catalogHintSkus || '').toUpperCase().split(',').filter(Boolean);
    var __pick = null;
    var __nh = __hitsBy(active.filter(function (p) { return __prev.indexOf(String(p.sku || '').toUpperCase()) >= 0; }));
    if (__nh.length === 1) __pick = __nh[0];
    else if (!__nh.length) { var __na = __hitsBy(active); if (__na.length > 1 && __stem) __na = __na.filter(function (p) { return __nameOf(p).indexOf(__stem) >= 0 || String(cats[p.categoryId] || '').toLowerCase().indexOf(__stem) >= 0; }); if (__na.length === 1) __pick = __na[0]; }
    if (__pick && __pick.sku) return { catalogHint: '', catalogHintCount: 0, catalogHintSkus: '', catalogHintPick: String(__pick.sku), hasProductSignal: true, catalogCategories: catList, unknownTurns: unknownTurns - 1 };
  }
} catch (e) { /* best-effort */ }
// стем → корені для пошуку в назві товару/категорії
var STEMS = [
  ['кофт', ['кофт']], ['светр', ['светр', 'кофт']], ['худ', ['худ']], ['бомбер', ['бомбер']], ['куртк', ['куртк', 'бомбер', 'вітровк']],
  ['вітровк', ['вітровк', 'куртк']], ['джинс', ['джинс']], ['штан', ['штан', 'джинс']], ['футболк', ['футболк']],
  ['лофер', ['лофер']], ['взутт', ['лофер', 'кросів', 'черевик', 'взутт']], ['кросів', ['кросів']], ['черевик', ['черевик']],
  ['костюм', ['костюм']], ['комплект', ['комплект']], ['накидк', ['накидк']], ['подушк', ['подушк']], ['органайзер', ['органайзер']],
  ['підголівник', ['підголівник']], ['шкірян', ['шкір', 'кожан']], ['кожан', ['кожан', 'шкір']],
];
var wants = [];
for (var i = 0; i < STEMS.length; i++) { if (msg.indexOf(STEMS[i][0]) >= 0) { for (var j2 = 0; j2 < STEMS[i][1].length; j2++) { if (wants.indexOf(STEMS[i][1][j2]) < 0) wants.push(STEMS[i][1][j2]); } } }
if (!wants.length) return out('', 0, catList);
function hay(p) { return (String(p.name || '') + ' ' + String(p.customerName || '') + ' ' + (cats[p.categoryId] || '')).toLowerCase(); }
var pool = wants.indexOf('комплект') >= 0 ? all : active;
var hits = pool.filter(function (p) { var h = hay(p); return wants.some(function (w) { return h.indexOf(w) >= 0; }); });
if (!hits.length) return out('', 0, catList);
// 2026-09-08 (_grigoriy_: «чорний замшевий костюм» → у списку з 4 не було замшевого): спершу товари, чиї назви
// перетинаються з іншими словами повідомлення (замшев, плюш, мажор…), далі — за ціною.
var __mw = msg.replace(/[^a-zа-яіїєґ0-9\s]/gi, ' ').split(/\s+/).filter(function (w) { return w.length >= 4; }).map(function (w) { return w.slice(0, 5); });
function __ov(p) { var h = hay(p); var n = 0; __mw.forEach(function (w) { if (h.indexOf(w) >= 0 && !wants.some(function (s) { return w.indexOf(s.slice(0, 4)) === 0; })) n++; }); return n; }
hits.sort(function (a, b) { return (__ov(b) - __ov(a)) || ((Number(a.price) || 0) - (Number(b.price) || 0)); });
var top = hits.slice(0, 4);
var lines = top.map(function (p) { return (p.sku ? ('Артикул ' + p.sku + ' — ') : '') + String(p.name || '').trim() + (Number(p.price) ? (' — ' + Number(p.price) + ' грн') : ''); });
return { catalogHint: lines.join('\n'), catalogHintCount: top.length, catalogHintTotal: hits.length, catalogHintSkus: top.map(function (p) { return String(p.sku || ''); }).filter(Boolean).join(','), catalogCategories: catList, unknownTurns: unknownTurns };
