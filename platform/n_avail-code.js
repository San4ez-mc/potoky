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
function sizeOk(o){
  var pr=o.properties||[];
  var hasSizeProp = pr.some(function(x){ return /розмір|размер/i.test(String(x.name||'')); });
  if(!hasSizeProp || !chosenSize) return true;
  return pr.some(function(x){ return /розмір|размер/i.test(String(x.name||'')) && String(x.value).toUpperCase()===String(chosenSize).toUpperCase(); });
}
function hasQty(o){ return o && o.quantity!==undefined && o.quantity!==null && o.quantity!==''; }
if(chosenColor){
  var candidates=offers.filter(function(o){ var pr=o.properties||[]; return pr.some(function(x){ return String(x.value)===String(chosenColor); }); });
  if(candidates.length){
    var withSize = candidates.filter(sizeOk);
    var pool = withSize.length ? withSize : candidates;
    avail = pool.some(function(o){ return Number(o.quantity) > 0; });
  }
  if (!avail) {
    var _unavail = Array.isArray(context.unavailableColors) ? context.unavailableColors.slice() : [];
    if (_unavail.indexOf(chosenColor) < 0) _unavail.push(chosenColor);
    return { available: false, availReason: 'color', colorChoice: null, unavailableColors: _unavail };
  }
  var okOut={ available: true, availReason: '' };
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
return { available: avail, availReason: avail ? '' : 'no_stock' };
