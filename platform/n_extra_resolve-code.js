// n_extra_resolve — складні кошики (2026-09-09, власник п.5): інші речі з каталогу, які клієнт назвав
// («ще джинси сірі 32 і лофери 43»), перетворюємо на структуровані позиції ДО n_order_intent:
// пошук у каталозі CRM за артикулом або словом-категорією, колір зі списку кольорів товару, розмір зі списку
// розмірів, кількість. Те, що не знайшли, лишається текстом для менеджера (extraUnresolved → extraProducts).
// Джерела тексту: context.alsoWants (перше повідомлення / крок розміру-кольору), context.extraProductMention
// (двигун, lockProduct), orderIntent.extraProducts (клієнт назвав на кроці «Оформляємо?» — тоді повертаємось
// сюди через n_extra_after_cond і n_order_intent дає новий підсумок).
var intentText = String((context.orderIntent && context.orderIntent.extraProducts) || '').trim();
var fromIntent = !!intentText && context.extraIntentResolved !== intentText;
var text = fromIntent ? intentText : [String(context.alsoWants || '').trim(), String(context.extraProductMention || '').trim()].filter(Boolean).join('; ').trim();
var prevItems = Array.isArray(context.extraItems) ? context.extraItems : [];
if (!text) return { extraFromIntent: false, extraJustResolved: false, extraItems: prevItems, extraItemsText: prevItems.length ? prevItems.map(function (it) { return lineOf(it); }).join('\n') : '', extraUnresolved: String(context.extraUnresolved || '') };
if (!fromIntent && context.extraResolvedFor === text) return { extraFromIntent: false, extraJustResolved: false };
var prod = context.product || {};
var mainSku = String(prod.sku || '').toUpperCase();
var upSkus = ((prod.upsellItems) || []).map(function (u) { return String(u.sku || '').toUpperCase(); }).filter(Boolean);
var upWords = ((prod.upsellItems) || []).map(function (u) { return String(u.name || '').toLowerCase(); }).join(' ');

var apiKey = (keys.CRM_API_KEY || '').trim();
var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var all = [];
try { var pr = await fetch(base + '/products?take=300', { headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' } }); var pj = pr.ok ? await pr.json() : {}; all = (pj && pj.data) || []; } catch (e) { all = []; }
if (!all.length) return { extraItems: [], extraItemsText: '', extraUnresolved: text, extraResolvedFor: text };

function norm(s) { return String(s || '').toLowerCase().replace(/[’'`ʼ]/g, '').trim(); }
var ITEM_RE = /(кофт\w*|футболк\w*|джинс\w*|бомбер\w*|куртк\w*|костюм\w*|штан\w*|лофер\w*|кросівк\w*|кросовк\w*|худі|светр\w*|вітровк\w*|шапк\w*|туфл\w*|черевик\w*|кед\w*|накидк\w*|підголівник\w*|піджак\w*|сороч\w*|жилет\w*|пальт\w*|плащ\w*|шорт\w*|сумк\w*|ремін\w*|рюкзак\w*|окуляр\w*|кепк\w*|панам\w*|носк\w*|шкарпет\w*)/i;
function stemOf(w) { return norm(w).replace(/[^а-яіїєґa-z]/g, '').slice(0, 5); }
function prodWords(p) { return norm([p.customerName, p.displayName, p.name, (p.category && p.category.name) || ''].join(' ')); }
function colorsOf(p) { var cs = []; (p.offers || []).forEach(function (o) { (o.properties || []).forEach(function (q) { if (/кол|цвет/i.test(q.name || '') && q.value && cs.indexOf(q.value) < 0) cs.push(q.value); }); }); return cs; }
function sizesOf(p) { var ss = []; (p.offers || []).forEach(function (o) { (o.properties || []).forEach(function (q) { if (/розмір|размер/i.test(q.name || '') && q.value && ss.indexOf(String(q.value)) < 0) ss.push(String(q.value)); }); }); return ss; }
function qtyPricesOf(p) { var q = {}; (Array.isArray(p.bulkPricing) ? p.bulkPricing : []).forEach(function (b) { if (b && b.quantity && b.price) q[String(b.quantity)] = Number(b.price); }); return q; }
function latin(x) { var M = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y' }; return String(x || '').toUpperCase().replace(/[АВСЕНІКМОРТХУ](?=\d)/g, function (c) { return M[c] || c; }); }
function findByArticle(seg) { var m = seg.match(/(?:артикул|арт\.?|art|код|sku|#|№)?\s*[:#№.\-]?\s*\b([A-Za-zА-ЯІЇЄҐ]{0,4}\d{3,8})\b/i); if (!m) return null; var A = latin(m[1]); return all.filter(function (p) { return String(p.sku || '').toUpperCase() === A || String(p.supplierArticle || '').toUpperCase() === A || (p.offers || []).some(function (o) { return String(o.sku || '').toUpperCase() === A; }); })[0] || null; }
var SIZE_RE = /\b(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|хс|с|м|л|хл|ххл|\d{2})\b(?![.,]\d)/i;
var SIZE_MAP = { 'хс': 'XS', 'с': 'S', 'м': 'M', 'л': 'L', 'хл': 'XL', 'ххл': 'XXL' };
var QTY_WORDS = { 'дві': 2, 'два': 2, 'двоє': 2, 'пару': 2, 'три': 3, 'чотири': 4, 'пʼять': 5, 'пять': 5 };

var segs = text.split(/\s*[;,]\s*|\s+(?:і|та|и|а також|також|плюс|ще)\s+/i).map(function (s) { return s.trim(); }).filter(Boolean);
var items = [], unresolved = [];
for (var si = 0; si < segs.length; si++) {
  var seg = segs[si]; var low = norm(seg);
  var im = seg.match(ITEM_RE); var stem = im ? stemOf(im[1]) : '';
  // допродаж (футболка) і сам основний товар — не сюди (їх ведуть units/addUpsell)
  if (stem && upWords.indexOf(stem) >= 0) continue;
  if (stem && prodWords(prod).indexOf(stem) >= 0 && !findByArticle(seg)) continue;
  var p = findByArticle(seg);
  var cands = [];
  if (!p && stem) {
    // комплекти (isSet / ціна 0) — не кандидати: «джинси» = окремий товар, а не «Комплект 4 в 1 (…джинси…)»
    cands = all.filter(function (x) { return prodWords(x).indexOf(stem) >= 0 && String(x.sku || '').toUpperCase() !== mainSku && upSkus.indexOf(String(x.sku || '').toUpperCase()) < 0 && x.isActive !== false && !x.isSet && Number(x.price) > 0; });
    // звужуємо словами сегмента (колір/назва): «джинси сірі» → серед джинсів ті, що мають сірий
    if (cands.length > 1) { var narrowed = cands.filter(function (x) { var cs = colorsOf(x).map(norm); return cs.some(function (c) { var st = c.replace(/ий$|а$|у$|ого$|ому$/, '').slice(0, 5); return st.length >= 4 && low.indexOf(st) >= 0; }); }); if (narrowed.length >= 1 && narrowed.length < cands.length) cands = narrowed; }
    if (cands.length > 1) { var byName = cands.filter(function (x) { var w = prodWords(x).split(/\s+/).filter(function (t) { return t.length >= 5 && t.slice(0, 5) !== stem; }); return w.some(function (t) { return low.indexOf(t.slice(0, 5)) >= 0; }); }); if (byName.length === 1) cands = byName; }
    if (cands.length === 1) p = cands[0];
  }
  if (!p) { unresolved.push(seg + (cands.length > 1 ? ' (є кілька: ' + cands.slice(0, 5).map(function (x) { return (x.customerName || x.name) + ' — арт. ' + x.sku + ' — ' + (Number(x.price) || 0) + ' грн'; }).join('; ') + ')' : '')); continue; }
  if (String(p.sku || '').toUpperCase() === mainSku) continue;
  var colors = colorsOf(p), sizes = sizesOf(p);
  var color = ''; colors.forEach(function (c) { var st = norm(c).replace(/ий$|а$|у$|ого$|ому$/, '').slice(0, 5); if (!color && st.length >= 4 && low.indexOf(st) >= 0) color = c; });
  var size = ''; var sm = seg.replace(/\d{3,}/g, ' ').match(SIZE_RE); if (sm) { var sv = sm[1].toLowerCase(); sv = SIZE_MAP[sv] || sv.toUpperCase(); if (!sizes.length || sizes.map(function (x) { return x.toUpperCase(); }).indexOf(sv) >= 0) size = sv; }
  var qty = 1; var qm = seg.match(/(\d+)\s*(шт|штук|пар)/i) || seg.match(/[x×]\s*(\d+)/i); if (qm) qty = Number(qm[1]) || 1; else { for (var qw in QTY_WORDS) { if (low.indexOf(qw + ' ') === 0 || low.indexOf(' ' + qw + ' ') >= 0) qty = QTY_WORDS[qw]; } }
  var ex = items.filter(function (it) { return it.sku === (p.sku || '') && it.color === color && it.size === size; })[0];
  if (ex) { ex.qty += qty; continue; }
  items.push({ id: p.id, sku: p.sku || '', name: (p.customerName || p.name || 'Товар'), price: Number(p.price) || 0, qtyPrices: qtyPricesOf(p), color: color, size: size, qty: qty, colorsList: colors, sizes: sizes, supplier: (p.supplier && p.supplier.name) || '', supplierArticle: p.supplierArticle || '', offers: (p.offers || []).map(function (o) { return { id: o.id, sku: o.sku || '', properties: (o.properties || []).map(function (q) { return { name: q.name, value: q.value }; }) }; }), raw: seg });
}
function lineOf(it) {
  var parts = [it.name + ' (арт. ' + it.sku + ') — ' + it.price + ' грн' + (it.qty > 1 ? ' ×' + it.qty : '')];
  if (it.colorsList.length) parts.push(it.color ? 'колір: ' + it.color : 'КОЛІР НЕ ОБРАНО (є: ' + it.colorsList.join(', ') + ')');
  if (it.sizes.length) parts.push(it.size ? 'розмір: ' + it.size : 'РОЗМІР НЕ ОБРАНО (є: ' + it.sizes.join(', ') + ')');
  return '• ' + parts.join('; ');
}
// злиття з уже розпізнаними раніше (повернення з кроку «Оформляємо?» додає, а не замінює)
var merged = prevItems.slice(); var newCount = 0;
items.forEach(function (it) {
  var same = merged.filter(function (m) { return m.sku === it.sku; })[0];
  if (same) { if (it.color) same.color = it.color; if (it.size) same.size = it.size; if (it.qty > 1) same.qty = it.qty; if (it.color || it.size) newCount++; }
  else { merged.push(it); newCount++; }
});
var needChoice = unresolved.some(function (u) { return u.indexOf('є кілька:') >= 0; });
var out = { extraItems: merged, extraItemsText: merged.map(lineOf).join('\n'), extraUnresolved: unresolved.join('; '), extraResolvedFor: fromIntent ? String(context.extraResolvedFor || '') : text, alsoWants: '', extraProductMention: '', extraFromIntent: fromIntent, extraJustResolved: fromIntent ? (newCount > 0 || needChoice) : true };
if (fromIntent) {
  out.extraIntentResolved = intentText;
  if (newCount > 0 || needChoice) {
    // повернення з кроку «Оформляємо?»: клієнт назвав інші товари → новий підсумок із ними (як зміна замовлення)
    out.orderChangeNote = 'клієнт додає до замовлення: ' + (items.length ? items.map(function (it) { return it.name + (it.color ? ' ' + it.color : '') + (it.size ? ' ' + it.size : '') + (it.qty > 1 ? ' ×' + it.qty : ''); }).join(', ') : '') + (unresolved.length ? ((items.length ? '; ' : '') + (needChoice ? 'треба уточнити, який саме: ' : 'не знайдено в каталозі: ') + unresolved.join('; ')) : '');
    out.orderIntent = null;
  }
}
return out;
