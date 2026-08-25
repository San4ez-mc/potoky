var offers=(context.product&&context.product.offers)||[];
var chosenColor=(context.colorChoice&&context.colorChoice.color)||null;
var chosenSize=context.recommendedSize||null;
var avail=true;
if(chosenColor){
  var candidates=offers.filter(function(o){ var pr=o.properties||[]; return pr.some(function(x){ return String(x.value)===String(chosenColor); }); });
  if(candidates.length){
    // Якщо серед offer-властивостей кольору Є ще й "розмір" — звужуємо і по розміру (коли
    // він вже відомий). Якщо в offers розміру взагалі нема (частий кейс — див. аудит) —
    // не блокуємо на відсутніх даних.
    var withSize = chosenSize ? candidates.filter(function(o){
      var pr=o.properties||[];
      var hasSizeProp = pr.some(function(x){ return String(x.name||'').toLowerCase().indexOf('розмір')>=0; });
      if(!hasSizeProp) return true;
      return pr.some(function(x){ return String(x.name||'').toLowerCase().indexOf('розмір')>=0 && String(x.value)===String(chosenSize); });
    }) : candidates;
    var pool = withSize.length ? withSize : candidates;
    avail = pool.some(function(o){ return Number(o.quantity) > 0; });
  }
}
return { available: avail };
