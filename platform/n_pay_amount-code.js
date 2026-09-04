// n_pay_amount — джерело істини (goverla/covercar CRM-клони, патч patch-goverla-crm-audit-2026-09-04.js).
var method=(context.paymentInfo&&context.paymentInfo.method)||'cod';
var qty=Number((context.orderIntent&&context.orderIntent.qty)||1); if(!(qty>=1)) qty=1;
var qp=(context.product&&context.product.qtyPrices)||{}; var tierPrice=qp[String(qty)];
var unit=(context.product&&context.product.price)||0;
var full=tierPrice!=null?Number(tierPrice):(unit*qty);
// Аудит 2026-09-04 (живий кейс власника, сесія 7944d0c6): клієнт погодився на допродаж, бот
// підсумував 2177 грн, а інвойс створився на 1279 — допродаж не входив у суму. Додаємо ціну
// погодженого допродажу (та сама позиція, яку n_crm_order кладе другим item-ом).
var upsellSum=0, upsellQty=0;
if(context.orderIntent&&context.orderIntent.addUpsell){
  var up=(context.product&&context.product.upsellItems)||[];
  if(up[0]&&Number(up[0].price)){
    upsellQty=Number(context.orderIntent.upsellQty)||1; if(!(upsellQty>=1)) upsellQty=1;
    var uqp=(up[0].qtyPrices||{})[String(upsellQty)];
    upsellSum = uqp!=null ? Number(uqp) : Number(up[0].price)*upsellQty;   // v3: "Біла-1 Чорна-1" = 2 шт за акційною 799
  }
}
full=full+upsellSum;
// orderRef — короткий код у призначенні платежу: префікс із SHOP_TAG (клон = шаблон + конфіг),
// id з psid/igUsername (для Instagram telegramId нема — раніше виходило "GOVNAN…"), orderRefAt —
// момент видачі коду (n_reconcile дивиться у виписці лише платежі ПІСЛЯ нього).
var ref=String(context.orderRef||'').trim();
var refAt=Number(context.orderRefAt)||0;
if(!ref){
  var prefix=String(keys.SHOP_TAG||'').replace(/[^a-z0-9]/gi,'').slice(0,3).toUpperCase()||'ORD';
  var idSrc=String((user&&user.telegramId)||context.psid||context.igUsername||'');
  var hsh=0; for(var i=0;i<idSrc.length;i++){ hsh=(hsh*31+idSrc.charCodeAt(i))>>>0; }
  ref=(prefix+hsh.toString(36).slice(-4).toUpperCase().padStart(4,'0')+Date.now().toString(36).slice(-4).toUpperCase());
  refAt=Date.now();
}
// Реквізити АКТИВНОГО ФОП з нової СРМ (Fop.isActive) — для ручних реквізитів (n_req_*_v) і
// звірки квитанцій (n_reconcile). Раніше бралися лише зі статичних funnelKey FOP_* (застарілий
// ФОП). Фолбек на funnelKey, якщо CRM недоступна. Двигун для ibanoplata робить те саме.
var fop={ name:String(keys.FOP_NAME||''), code:String(keys.FOP_CODE||''), iban:String(keys.FOP_IBAN||''), source:'funnelKey' };
if(true){ // read-only, працює і в testMode
  try{
    var base=(keys.CRM_API_BASE||'http://127.0.0.1:4700/api').replace(/\/$/,''); var apiKey=(keys.CRM_API_KEY||'').trim();
    if(apiKey){
      var ac=new AbortController(); var to=setTimeout(function(){ try{ac.abort();}catch(e){} },3000);
      try{
        var r=await fetch(base+'/fops',{headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'},signal:ac.signal});
        if(r.ok){ var j=await r.json().catch(function(){return {};}); var list=Array.isArray(j.data)?j.data:[]; var act=list.filter(function(f){ return f&&f.isActive===true&&f.iban; })[0];
          if(act){ fop={ name:String(act.name||fop.name), code:String(act.taxId||act.code||fop.code), iban:String(act.iban), source:'crm' }; } }
      } finally { clearTimeout(to); }
    }
  }catch(e){ /* best-effort — фолбек на funnelKey вище */ }
}
var out={ orderRef:ref, orderRefAt:refAt, orderQty:qty, fop:fop, upsellSum:upsellSum, upsellQty:upsellQty };
if(method==='cod_trust'){ out.payAmount=0; out.payLabel='без передоплати (виняток за домовленістю, накладений платіж повністю)'; return out; }
out.payAmount = method==='cod'?200:full;
out.payLabel = method==='cod'?('передоплата 200 грн, решта '+(full-200)+' грн при отриманні'):('повна оплата, '+full+' грн');
out.orderTotal = full;
return out;
