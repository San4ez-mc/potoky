// n_catalog_hint_process — джерело істини (CRM-клони, патч patch-goverla-crm-audit-2026-09-04.js).
// 2026-09-12: друга половина колишньої n_catalog_hint — HTTP-запити (products/categories) уже
// зроблені окремими httpRequest-нодами (n_catalog_hint_fetch_products/_categories), сирі відповіді
// лежать у context.catalogHintProductsRaw/catalogHintCategoriesRaw. Тут — лише обробка: фільтрація,
// збіг за категорією/кольором, сортування, формування підказки+фото. Жодного зовнішнього виклику.
var msg = String(context.catalogHintMsg || '');
var wants = Array.isArray(context.catalogHintWants) ? context.catalogHintWants : [];
var __hintColorWords = Array.isArray(context.catalogHintColorWords) ? context.catalogHintColorWords : [];
var __stem = String(context.catalogHintStem || '');
var unknownTurns = Number(context.unknownTurns) || 0;
var all = Array.isArray(context.catalogHintProductsRaw) ? context.catalogHintProductsRaw : [];
var catsRaw = Array.isArray(context.catalogHintCategoriesRaw) ? context.catalogHintCategoriesRaw : [];
var cats = {};
catsRaw.forEach(function (c) { cats[c.id] = String(c.name || '').trim(); });
function out(hint, cnt, catList) { return { catalogHint: hint || '', catalogHintCount: cnt || 0, catalogHintSkus: '', catalogHintPick: '', catalogCategories: catList || '', unknownTurns: unknownTurns }; }
// 2026-09-12 (живий тест: "а є чорні лофери?" показав УСІ лофери, включно з коричневими) — лофери
// 5932-5935 (дропшип) не мають offers-варіантів взагалі (offersCount:0), колір є ЛИШЕ в назві
// товару ("Чорні класичні замшеві лофери"). Той самий факт уже виявлено й виправлено раніше цієї
// сесії в n_avail_search-code.js — тут той самий fallback: offers, а якщо порожньо — назва/customerName.
function colorsOf(p) {
  var c = [];
  (p.offers || []).forEach(function (o) { (o.properties || []).forEach(function (pr) { var n = String(pr.name || '').toLowerCase(); if (n.indexOf('колір') >= 0 || n.indexOf('цвет') >= 0) { var v = String(pr.value || '').trim(); if (v && c.indexOf(v) < 0) c.push(v); } }); });
  if (!c.length) {
    var src = (String(p.name || '') + ' ' + String(p.customerName || '')).toLowerCase();
    var m = src.match(/(чорн\w*|сір\w*|біл\w*|син\w*|графіт\w*|бордов\w*|беж\w*|коричнев\w*|зелен\w*|червон\w*|хакі|олив\w*|молочн\w*|блакитн\w*)/);
    if (m) c.push(m[1]);
  }
  return c;
}
var active = all.filter(function (p) { return p.isActive !== false && !p.archived && !/^set/i.test(String(p.sku || '')); });
// Категорії з кількістю товарів — для привітання («що цікавить: кофти (6), бомбери (4)…»)
var counts = {};
active.forEach(function (p) { var n = cats[p.categoryId]; if (n) counts[n] = (counts[n] || 0) + 1; });
var catList = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (n) { return n.toLowerCase() + ' (' + counts[n] + ')'; }).join(', ');
if (!msg) return out('', 0, catList);
// 2026-09-08 (_grigoriy_: «надішліть зображення костюму (мажор)» після списку): повідомлення без артикула йде сюди в обхід
// n_lookup. Якщо слово з повідомлення називає РІВНО один товар — спершу зі щойно показаного списку
// (catalogHintSkus), потім з усього каталогу — віддаємо його як catalogHintPick.
try {
  var __STOP = { 'надіслати': 1, 'надішліть': 1, 'зображення': 1, 'могли': 1, 'можете': 1, 'будь': 1, 'ласка': 1, 'дякую': 1, 'ціна': 1, 'ціну': 1, 'розмір': 1, 'колір': 1, 'фото': 1, 'скиньте': 1, 'скинути': 1, 'підберіть': 1, 'зріст': 1, 'вага': 1, 'чорний': 1, 'чорну': 1, 'сірий': 1, 'білий': 1, 'синій': 1, 'хочу': 1, 'цікавить': 1, 'артикул': 1, 'товар': 1, 'товару': 1, 'пост': 1, 'який': 1, 'яка': 1, 'можна': 1, 'вітаю': 1, 'привіт': 1, 'добрий': 1, 'день': 1, 'вечір': 1, 'ранок': 1, 'наявності': 1, 'наявність': 1, 'замовити': 1, 'замовлення': 1, 'доставка': 1, 'оплата': 1 };
  var __uw = msg.replace(/[^a-zа-яіїєґ0-9\s]/gi, ' ').split(/\s+/).filter(function (w) { return w.length >= 4 && !__STOP[w] && !(__stem && w.indexOf(__stem) === 0); });
  if (__uw.length) {
    var __nameOf = function (p) { return (String(p.name || '') + ' ' + String(p.customerName || '')).toLowerCase(); };
    // 2026-09-09 (latifzada_0): рахуємо, скільки слів клієнта є в назві; якщо є єдиний лідер — беремо його.
    var __hitsBy = function (list) { var scored = list.map(function (p) { var h = __nameOf(p); return { p: p, n: __uw.filter(function (w) { return h.indexOf(w) >= 0; }).length }; }).filter(function (x) { return x.n > 0; }); if (!scored.length) return []; var top = Math.max.apply(null, scored.map(function (x) { return x.n; })); var best = scored.filter(function (x) { return x.n === top; }).map(function (x) { return x.p; }); return best; };
    var __prev = String(context.catalogHintSkus || '').toUpperCase().split(',').filter(Boolean);
    var __pick = null;
    // 2026-09-11 (Олексій: колір-слова в __STOP не годяться для збігу з НАЗВОЮ) — окремий прохід
    // за КОЛЬОРОМ саме серед щойно показаних у ПІДКАЗЦІ товарів (їхні offers[].properties).
    if (__prev.length && __hintColorWords.length) {
      var __prevProducts = active.filter(function (p) { return __prev.indexOf(String(p.sku || '').toUpperCase()) >= 0; });
      var __colorHits = __prevProducts.filter(function (p) {
        var pc = colorsOf(p).map(function (c) { return c.toLowerCase(); });
        return __hintColorWords.some(function (cw) { return pc.some(function (c) { return c.indexOf(cw.toLowerCase().slice(0, 4)) >= 0; }); });
      });
      if (__colorHits.length === 1) __pick = __colorHits[0];
    }
    if (!__pick) {
      var __nh = __hitsBy(active.filter(function (p) { return __prev.indexOf(String(p.sku || '').toUpperCase()) >= 0; }));
      if (__nh.length === 1) __pick = __nh[0];
      else if (!__nh.length) { var __na = __hitsBy(active); if (__na.length > 1 && __stem) __na = __na.filter(function (p) { return __nameOf(p).indexOf(__stem) >= 0 || String(cats[p.categoryId] || '').toLowerCase().indexOf(__stem) >= 0; }); if (__na.length === 1) __pick = __na[0]; }
    }
    // hasFreshSignalThisTurn: інакше n_returning_check веде у n_welcome_back замість презентації.
    if (__pick && __pick.sku) return { catalogHint: '', catalogHintCount: 0, catalogHintSkus: '', catalogHintPick: String(__pick.sku), hasProductSignal: true, hasFreshSignalThisTurn: true, catalogCategories: catList, unknownTurns: unknownTurns - 1 };
  }
} catch (e) { /* best-effort */ }
if (!wants.length) return out('', 0, catList);
function hay(p) { return (String(p.name || '') + ' ' + String(p.customerName || '') + ' ' + (cats[p.categoryId] || '')).toLowerCase(); }
var pool = wants.indexOf('комплект') >= 0 ? all : active;
var hits = pool.filter(function (p) { var h = hay(p); return wants.some(function (w) { return h.indexOf(w) >= 0; }); });
if (!hits.length) return out('', 0, catList);
// 2026-09-12 (власник: "а є чорні лофери?" — колір і категорія в ОДНОМУ, ПЕРШОМУ повідомленні):
// фільтр за кольором одразу на повному hits; fallback на неотфільтрований список, якщо звуження дало 0.
if (__hintColorWords.length) {
  var __hitsByColor = hits.filter(function (p) {
    var pc = colorsOf(p).map(function (c) { return c.toLowerCase(); });
    return __hintColorWords.some(function (cw) { return pc.some(function (c) { return c.indexOf(cw.toLowerCase().slice(0, 4)) >= 0; }); });
  });
  if (__hitsByColor.length) hits = __hitsByColor;
}
// 2026-09-08 (_grigoriy_: «чорний замшевий костюм»): спершу товари, чиї назви перетинаються з іншими
// словами повідомлення (замшев, плюш, мажор…), далі — за ціною.
var __mw = msg.replace(/[^a-zа-яіїєґ0-9\s]/gi, ' ').split(/\s+/).filter(function (w) { return w.length >= 4; }).map(function (w) { return w.slice(0, 5); });
function __ov(p) { var h = hay(p); var n = 0; __mw.forEach(function (w) { if (h.indexOf(w) >= 0 && !wants.some(function (s) { return w.indexOf(s.slice(0, 4)) === 0; })) n++; }); return n; }
hits.sort(function (a, b) { return (__ov(b) - __ov(a)) || ((Number(a.price) || 0) - (Number(b.price) || 0)); });
var top = hits.slice(0, 4);
var lines = top.map(function (p) { return (p.sku ? ('Артикул ' + p.sku + ' — ') : '') + String(p.name || '').trim() + (Number(p.price) ? (' — ' + Number(p.price) + ' грн') : ''); });
// 2026-09-11 (Олексій: клієнт бачить фото одразу, не питає артикул).
var __publicBase = (keys.CRM_PUBLIC_BASE || 'https://pcrm.fineko.space').replace(/\/$/, '');
function __resolveUrl(u) { if (!u) return ''; return /^https?:\/\//i.test(u) ? u : (__publicBase + (u.charAt(0) === '/' ? u : '/' + u)); }
var catalogHintPhotos = top.map(function (p) { return __resolveUrl(p.thumbnailUrl || (Array.isArray(p.images) && p.images[0]) || ''); }).filter(Boolean);
return { catalogHint: lines.join('\n'), catalogHintCount: top.length, catalogHintTotal: hits.length, catalogHintSkus: top.map(function (p) { return String(p.sku || ''); }).filter(Boolean).join(','), catalogHintPhotos: catalogHintPhotos, catalogCategories: catList, unknownTurns: unknownTurns };
