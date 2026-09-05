// n_avail — джерело істини (goverla CRM-клон, патч patch-goverla-crm-audit-2026-09-04.js).
// Перевіряє наявність обраного кольору/розміру по offers товару з CRM.
// Аудит 2026-09-04: для товару БЕЗ кольорів раніше наявність не перевірялась узагалі
// (avail=true завжди) — розпроданий товар ішов у "Оформляємо?". Тепер: якщо в offers є
// quantity — перевіряємо; availReason:'no_stock' веде на окрему гілку (менеджер), а не в
// n_avail_no (той просить "інший колір", якого в такого товару нема → була б петля).
var offers=(context.product&&context.product.offers)||[];
var chosenColor=(context.colorChoice&&context.colorChoice.color)||null;
// Аудит 2026-09-04 (живий кейс власника, сесія 7944d0c6): на кроці кольору клієнт написав
// "розмір я L ношу", модель підтвердила L, а в контексті лишався рекомендований XL — замовлення
// пішло б з XL. Якщо n_color повернула "size" — це явне рішення клієнта, переписуємо.
var sizeOverride=null;
if(context.colorChoice&&context.colorChoice.size){
  var so=String(context.colorChoice.size).toUpperCase().trim();
  var known=(context.product&&Array.isArray(context.product.sizes))?context.product.sizes.map(function(x){return String(x).toUpperCase().trim();}):[];
  if(so&&(!known.length||known.indexOf(so)>=0)) sizeOverride=so;
}
var chosenSize=sizeOverride||context.recommendedSize||null;
var avail=true;
// v8 (тест Олексія 2026-09-05 16:43, «Сірий і Синій» → бот змусив обрати один, потім «ще синій хочу» пішло
// до менеджера): кілька штук одного товару в різних кольорах — штатний сценарій. n_color повертає
// colors:[...] (+qty); тут будуємо позиції замовлення orderUnits [{color,size}] і текст для підсумку/CRM.
var colorsList=(context.colorChoice&&Array.isArray(context.colorChoice.colors)&&context.colorChoice.colors.length)
  ? context.colorChoice.colors.map(function(c){ return String(c||'').trim(); }).filter(Boolean)
  : (chosenColor?[String(chosenColor)]:[]);
var wantQty=Number(context.colorChoice&&context.colorChoice.qty)||0;
if(wantQty>1&&colorsList.length===1){ while(colorsList.length<wantQty) colorsList.push(colorsList[0]); }
var units=(colorsList.length?colorsList:['']).map(function(c){ return { color:c, size:chosenSize||'' }; });
function unitsText(us){ return us.length+' шт: '+us.map(function(u){ return [u.color,u.size].filter(Boolean).join(' ')||'—'; }).join(', '); }
function unitsTotal(n){ var qp=(context.product&&context.product.qtyPrices)||{}; var t=qp[String(n)]; return t!=null?Number(t):(Number(context.product&&context.product.price)||0)*n; }
var unitsOut={ orderUnits:units, orderQty:units.length, orderUnitsText:unitsText(units), orderUnitsTotal:unitsTotal(units.length) };
function sizeOk(o){
  var pr=o.properties||[];
  var hasSizeProp = pr.some(function(x){ return /розмір|размер/i.test(String(x.name||'')); });
  if(!hasSizeProp || !chosenSize) return true;
  return pr.some(function(x){ return /розмір|размер/i.test(String(x.name||'')) && String(x.value).toUpperCase()===String(chosenSize).toUpperCase(); });
}
function hasQty(o){ return o && o.quantity!==undefined && o.quantity!==null && o.quantity!==''; }
// Живий прогін 2026-09-04: у новій CRM залишки по offers НЕ ведуться (43/43 offers quantity=0) —
// перевірка "quantity>0" блокувала КОЖЕН колір ("варіант закінчився"). Тому наявність по
// залишках перевіряємо ЛИШЕ якщо товар реально веде облік: хоча б один offer із quantity>0.
// Інакше вважаємо, що товар є (як і старий бот без даних про залишки).
var stockTracked = offers.some(function(o){ return Number(o.quantity) > 0; });
if(!stockTracked){
  var okNoStock=Object.assign({ available: true, availReason: '' }, unitsOut);
  if(sizeOverride && sizeOverride!==context.recommendedSize){ okNoStock.recommendedSize=sizeOverride; okNoStock.sizeSource='client'; }
  return okNoStock;
}
if(colorsList.length){
  // Перевіряємо КОЖЕН обраний колір; перший відсутній → та сама гілка «варіант розібрали» (n_avail_no).
  var distinct=colorsList.filter(function(c,i){ return colorsList.indexOf(c)===i; });
  var missing=null;
  for(var ci=0; ci<distinct.length && !missing; ci++){
    var cc=distinct[ci];
    var candidates=offers.filter(function(o){ var pr=o.properties||[]; return pr.some(function(x){ return String(x.value)===String(cc); }); });
    if(!candidates.length) continue;
    var withSize = candidates.filter(sizeOk);
    var pool = withSize.length ? withSize : candidates;
    if(!pool.some(function(o){ return Number(o.quantity) > 0; })) missing=cc;
  }
  if (missing) {
    var _unavail = Array.isArray(context.unavailableColors) ? context.unavailableColors.slice() : [];
    if (_unavail.indexOf(missing) < 0) _unavail.push(missing);
    return { available: false, availReason: 'color', colorChoice: null, unavailableColors: _unavail, orderUnits: null, orderQty: 0, orderUnitsText: '' };
  }
  var okOut=Object.assign({ available: true, availReason: '' }, unitsOut);
  if(sizeOverride && sizeOverride!==context.recommendedSize){ okOut.recommendedSize=sizeOverride; okOut.sizeSource='client'; }
  return okOut;
}
// Без кольору: перевіряємо залишок лише якщо offers взагалі несуть quantity.
var qtyOffers = offers.filter(hasQty);
if (qtyOffers.length) {
  var pool2 = qtyOffers.filter(sizeOk);
  if (!pool2.length) pool2 = qtyOffers;
  avail = pool2.some(function(o){ return Number(o.quantity) > 0; });
}
return Object.assign({ available: avail, availReason: avail ? '' : 'no_stock' }, avail ? unitsOut : {});
