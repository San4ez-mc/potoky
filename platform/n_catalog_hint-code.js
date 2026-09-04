// n_catalog_hint — джерело істини (CRM-клони, патч patch-goverla-crm-audit-2026-09-04.js, v5).
// Діалог не завжди починається з поста/реклами (2026-09-04, рішення власника): клієнт може написати
// «Добрий вечір», «яка ціна кофти?», «є лофери?», «яка доставка?». Тут детерміновано готуємо для
// n_unknown_msg: catalogCategories — категорії магазину з CRM з кількістю товарів (для привітання),
// catalogHint — до 4 товарів названої категорії (артикул, назва, ціна). Best-effort: помилка → порожньо.
var msg = String(context.lastUserMessage || input || '').toLowerCase();
function out(hint, cnt, cats) { return { catalogHint: hint || '', catalogHintCount: cnt || 0, catalogCategories: cats || '' }; }
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
if (!msg) return out('', 0, catList);
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
hits.sort(function (a, b) { return (Number(a.price) || 0) - (Number(b.price) || 0); });
var top = hits.slice(0, 4);
var lines = top.map(function (p) { return (p.sku ? ('Артикул ' + p.sku + ' — ') : '') + String(p.name || '').trim() + (Number(p.price) ? (' — ' + Number(p.price) + ' грн') : ''); });
return { catalogHint: lines.join('\n'), catalogHintCount: top.length, catalogHintTotal: hits.length, catalogCategories: catList };
