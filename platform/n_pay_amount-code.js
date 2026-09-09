// n_pay_amount — джерело істини (goverla/covercar CRM-клони, патч patch-goverla-crm-audit-2026-09-04.js).
var method=(context.paymentInfo&&context.paymentInfo.method)||'cod';
// v8: позиції замовлення — кілька штук одного товару (кольори/розміри). Джерела за пріоритетом:
// orderIntent.units (клієнт додав/змінив на кроці «Оформляємо?») → context.orderUnits (з n_avail за
// colors з кроку кольору) → одна позиція з colorChoice/recommendedSize. qty з orderIntent — множник.
var oi=context.orderIntent||{};
var baseUnits=(Array.isArray(context.orderUnits)&&context.orderUnits.length)?context.orderUnits:[{ color:String((context.colorChoice&&context.colorChoice.color)||'').trim(), size:String(context.recommendedSize||'').trim() }];
var units=(Array.isArray(oi.units)&&oi.units.length)
  ? oi.units.map(function(u){ return { color:String((u&&u.color)||'').trim(), size:String((u&&u.size)||context.recommendedSize||'').trim() }; })
  : baseUnits.map(function(u){ return { color:String((u&&u.color)||'').trim(), size:String((u&&u.size)||context.recommendedSize||'').trim() }; });
var qty=Number(oi.qty)||units.length; if(!(qty>=1)) qty=units.length||1;
if(qty>units.length&&units.length===1){ while(units.length<qty) units.push({ color:units[0].color, size:units[0].size }); }
if(qty<units.length) qty=units.length;
var orderUnitsText=qty+' шт: '+units.map(function(u){ return [u.color,u.size].filter(Boolean).join(' ')||'—'; }).join(', ');
// Ціна за N шт: набори за акцією (найбільший підходящий tier повторно) + решта поштучно (3 шт при «2 — 799» = 799+449).
function tierTotal(qp,unit,n){ qp=qp||{}; var tiers=Object.keys(qp).map(Number).filter(function(t){ return t>1&&Number(qp[t])>0; }).sort(function(a,b){ return b-a; }); var left=n,total=0; for(var i=0;i<tiers.length;i++){ while(left>=tiers[i]){ total+=Number(qp[tiers[i]]); left-=tiers[i]; } } return total+left*unit; }
var unit=Number(context.product&&context.product.price)||0;
var full=tierTotal(context.product&&context.product.qtyPrices, unit, qty);
var mainTotal=full;
// Аудит 2026-09-04 (живий кейс власника, сесія 7944d0c6): клієнт погодився на допродаж, бот
// підсумував 2177 грн, а інвойс створився на 1279 — допродаж не входив у суму. Додаємо ціну
// погодженого допродажу (та сама позиція, яку n_crm_order кладе другим item-ом).
var upsellSum=0, upsellQty=0;
if(context.orderIntent&&context.orderIntent.addUpsell){
  var up=(context.product&&context.product.upsellItems)||[];
  if(up[0]&&Number(up[0].price)){
    upsellQty=Number(context.orderIntent.upsellQty)||1; if(!(upsellQty>=1)) upsellQty=1;
    upsellSum = tierTotal(up[0].qtyPrices, Number(up[0].price)||0, upsellQty);   // 2 шт → 799; 3 шт → 799+449 (v10)
  }
}
full=full+upsellSum;
// 2026-09-09 (п.5, складні кошики): додаткові товари з каталогу — orderIntent.extras (фінальний вибір кольору/розміру
// на кроці «Оформляємо?») поверх context.extraItems (n_extra_resolve). Ціна за кількість — за акцією товару.
var extrasSum=0; var orderExtras=[];
try{
  var __ei=Array.isArray(context.extraItems)?context.extraItems:[];
  var __oe=Array.isArray(oi.extras)?oi.extras:[];
  // база — extraItems (усе, що знайшов резолвер); orderIntent.extras лише УТОЧНЮЄ колір/розмір/кількість за sku
  // (модель може не перелічити всі позиції — вони не губляться; v12.17: лофери випали, бо extras мали лише джинси).
  var __list=__ei.map(function(b){ var e=__oe.filter(function(x){ return String(x.sku||'').toUpperCase()===String(b.sku).toUpperCase(); })[0]||{}; return { id:b.id||null, sku:String(b.sku||''), name:b.name||'Товар', price:Number(b.price)||0, qtyPrices:b.qtyPrices||{}, color:String(e.color||b.color||'').trim(), size:String(e.size||b.size||'').trim(), qty:Number(e.qty)||Number(b.qty)||1, supplier:b.supplier||'', supplierArticle:b.supplierArticle||'', offers:b.offers||[] }; });
  // позиція з extras, якої резолвер не бачив (модель обрала варіант зі списку «є кілька» без json extraProducts) — шукаємо в каталозі CRM за sku
  var __missOe=__oe.filter(function(e){ return e&&e.sku&&!__list.some(function(x){ return x.sku.toUpperCase()===String(e.sku).toUpperCase(); }); });
  if(__missOe.length){
    var __cat=[]; try{ var __cb=(keys.CRM_API_BASE||'http://127.0.0.1:4700/api').replace(/\/$/,''); var __ck=(keys.CRM_API_KEY||'').trim(); if(__ck){ var __cr=await fetch(__cb+'/products?take=300',{headers:{Authorization:'Bearer '+__ck,Accept:'application/json'}}); if(__cr.ok){ var __cj=await __cr.json().catch(function(){return {};}); __cat=Array.isArray(__cj.data)?__cj.data:[]; } } }catch(e){ __cat=[]; }
    __missOe.forEach(function(e){ var A=String(e.sku).toUpperCase(); var p=__cat.filter(function(x){ return String(x.sku||'').toUpperCase()===A||String(x.supplierArticle||'').toUpperCase()===A; })[0];
      if(p&&Number(p.price)>0&&!p.isSet){ var qp={}; (Array.isArray(p.bulkPricing)?p.bulkPricing:[]).forEach(function(b){ if(b&&b.quantity&&b.price) qp[String(b.quantity)]=Number(b.price); });
        __list.push({ id:p.id, sku:String(p.sku||A), name:(p.customerName||p.name||'Товар'), price:Number(p.price), qtyPrices:qp, color:String(e.color||'').trim(), size:String(e.size||'').trim(), qty:Number(e.qty)||1, supplier:(p.supplier&&p.supplier.name)||'', supplierArticle:p.supplierArticle||'', offers:(p.offers||[]).map(function(o){ return { id:o.id, sku:o.sku||'', properties:(o.properties||[]).map(function(q){ return { name:q.name, value:q.value }; }) }; }) }); }
      else if(Number(e.price)>0) __list.push({ id:null, sku:String(e.sku), name:e.name||'Товар', price:Number(e.price), qtyPrices:{}, color:String(e.color||'').trim(), size:String(e.size||'').trim(), qty:Number(e.qty)||1, supplier:'', supplierArticle:'', offers:[] }); });
  }
  __list=__list.filter(function(x){ return x.sku && x.price>0; });
  __list.forEach(function(x){ x.sum=tierTotal(x.qtyPrices, x.price, x.qty); extrasSum+=x.sum; });
  orderExtras=__list;
}catch(e){ orderExtras=[]; extrasSum=0; }
full=full+extrasSum;
var extrasLine=orderExtras.length?('\n➕ Додатково: '+orderExtras.map(function(x){ return x.name+' '+[x.color,x.size].filter(Boolean).join(' ')+(x.qty>1?' ×'+x.qty:'')+' ('+x.sum+' грн)'; }).join('; ')):'';
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
var od0=context.orderData||{};
var haveAddr = !!(context.recalledDeliveryReady || (od0.fullName && od0.phone && od0.city && od0.branch));
var addressAskLine = haveAddr
  ? '📦 Дані для відправки у нас уже є ✅ ('+(od0.city||'')+(od0.branch?(', '+od0.branch):'')+') — якщо щось змінилось, напишіть.'
  : '📦 Дані для відправки (ПІБ, телефон, місто, № відділення або поштомата Нової Пошти) можна написати прямо зараз одним повідомленням 🙂';
// v8.1: інший товар, який клієнт попросив додати посеред оформлення — рядок для сповіщень менеджеру (n_create/n_supplier_hold) і коментаря в CRM.
var upsellLine = upsellSum>0 ? (' + допродаж: '+String(((context.product&&context.product.upsellItems)||[])[0]&&((context.product.upsellItems)[0].name)||'допродаж')+' ×'+upsellQty+' ('+upsellSum+' грн)') : '';
// нерозпізнані речі (n_extra_resolve не знайшов у каталозі) — як і раніше, менеджеру вручну
var extraProducts=[String(context.extraUnresolved||'').trim(), (orderExtras.length?'':String((oi.extraProducts)||'').trim())].filter(Boolean).join('; ');
var extraProductsLine=extraProducts?('➕ ДОДАТКОВО просить (додати в цю ж посилку вручну, ціну/розмір узгодити): '+extraProducts+'\n'):'';
var adLinkMismatchLine=String(context.adLinkMismatch||'').trim()?('⚠️ '+String(context.adLinkMismatch).trim()):'';
var out={ orderRef:ref, orderRefAt:refAt, orderQty:qty, orderUnits:units, orderUnitsText:orderUnitsText, orderUnitsTotal:mainTotal, extraProducts:extraProducts, extraProductsLine:extraProductsLine, orderExtras:orderExtras, extrasSum:extrasSum, extrasLine:extrasLine, upsellLine:upsellLine+extrasLine, adLinkMismatchLine:adLinkMismatchLine, orderChangeNote:'', fop:fop, upsellSum:upsellSum, upsellQty:upsellQty, addressAskLine:addressAskLine };
// 2026-09-09 (r.ruslin.l: brewdrop «orderTotal=0» при cod_trust): загальна сума потрібна і без передоплати.
out.orderTotal = full;
if(method==='cod_trust'){ out.payAmount=0; out.payLabel='без передоплати (виняток за домовленістю, накладений платіж повністю)'; return out; }
out.payAmount = method==='cod'?200:full;
out.payLabel = method==='cod'?('передоплата 200 грн, решта '+(full-200)+' грн при отриманні'):('повна оплата, '+full+' грн');
out.orderTotal = full;
return out;
