// Дропшип-замовлення brewdrop.in.ua. ДЖЕРЕЛО ІСТИНИ для n_supplier_order (нода була
// написана напряму в БД раніше, без локального файлу — синхронізовано 2026-08-22
// перед додаванням фолбек-пошуку артикулу постачальника (CT_1006, див. n_lookup-code.js).
if(context.testMode) return { supplierOrderResult:'(testMode: brewdrop пропущено)' };
var base=(keys.BREWDROP_API_BASE||'https://api.brewdrop.in.ua').replace(/\/+$/,'');
var tok=(keys.BREWDROP_TOKEN||'').trim();
var dryRun=String(keys.BREWDROP_DRY_RUN||'1')!=='0';
if(!tok) return { supplierOrderResult:'❌ BREWDROP_TOKEN не заповнено' };
var HDR={ 'Authorization':'Bearer '+tok, 'crossdomain':'true', 'Accept':'application/json', 'Content-Type':'application/json', 'Origin':'https://brewdrop.in.ua' };
async function bd(path,opts){ var r=await fetch(base+path,Object.assign({headers:HDR},opts||{})); var j=null; try{ j=await r.json(); }catch(e){} return {status:r.status,json:j}; }
function norm(x){ return String(x||'').toLowerCase().trim(); }
var prod=context.product||{}; var od=context.orderData||{};
var map={}; try{ map=JSON.parse(keys.BREWDROP_ARTICLE_MAP||'{}'); }catch(e){}
var m=map[String(prod.id)]||{};
// Пріоритет пошуку: 1) ручний override з BREWDROP_ARTICLE_MAP; 2) явний CT_1006
// (артикул постачальника з CRM, довіряємо напряму, без фолбеку); 3) звичайний
// CRM-артикул — а якщо НЕ знайдеться, той самий артикул БЕЗ суфіксу кольору
// (частина постачальників має один артикул на весь товар: «888888-1» → «888888»).
var mapArticle=String(m.article||'').trim();
var explicitArticle=String(prod.supplierArticle||'').trim();
var crmArticle=(prod.article||prod.vendor_code||prod.sku||context.orderSku||((prod.offers&&prod.offers[0]&&prod.offers[0].sku))||'').trim();
var articleCandidates;
if(mapArticle) articleCandidates=[mapArticle];
else if(explicitArticle) articleCandidates=[explicitArticle];
else { articleCandidates=[crmArticle]; if(/-\d+$/.test(crmArticle)) articleCandidates.push(crmArticle.replace(/-\d+$/,'')); }
var color=(m.color||(context.colorChoice&&context.colorChoice.color)||'').trim();
var size=(context.recommendedSize||'').trim();
if(!articleCandidates[0]) return { supplierOrderResult:'❌ Немає артикулу brewdrop для товару '+(prod.name||prod.id)+' — заповни BREWDROP_ARTICLE_MAP' };
var article='', found=null;
for(var aci=0; aci<articleCandidates.length && !found; aci++){
  article=articleCandidates[aci];
  var s=await bd('/api/guest/products/?search='+encodeURIComponent(article)+'&per_page=20');
  var sd=(s.json&&s.json.data)||[];
  found=sd.find(function(p){return norm(p.vendor_code)===norm(article);})||sd[0];
}
if(!found) return { supplierOrderResult:'❌ brewdrop: артикул '+articleCandidates.join(' / ')+' не знайдено' };
var d=await bd('/api/guest/products/'+found.product_id);
var colors=(((d.json&&(d.json.data||d.json))||{}).remains)||[];
var pcsId=null, chosen=null;
for(var ci=0;ci<colors.length;ci++){ var c=colors[ci]; var cn=norm(c.color&&c.color.name);
  if(color && cn!==norm(color) && cn.indexOf(norm(color))<0) continue;
  var sizes=c.sizes||[];
  for(var si=0;si<sizes.length;si++){ var sv=sizes[si];
    if(size && norm(sv.size&&sv.size.name)!==norm(size)) continue;
    if(Number(sv.remains)>0){ pcsId=sv.product_color_size_id; chosen={color:cn,size:(sv.size&&sv.size.name),remains:sv.remains}; break; } }
  if(pcsId) break; }
if(!pcsId) return { supplierOrderResult:'❌ brewdrop: нема в наявності '+article+' / '+color+' / '+size };
var cart=await bd('/api/carts',{method:'POST',body:JSON.stringify({product_color_size_id:pcsId,qty:1})});
if(cart.status>=400) return { supplierOrderResult:'❌ кошик brewdrop: '+JSON.stringify(cart.json).slice(0,200) };
var cy=await bd('/api/cities?search='+encodeURIComponent(od.city||'')+'&per_page=5');
var cityObj=((cy.json&&cy.json.data)||[])[0]; var brObj=null;
if(cityObj){ var brs=await bd('/api/branches?city_id='+cityObj.id+'&search='+encodeURIComponent(String(od.branch||''))+'&per_page=25'); var ba=(brs.json&&brs.json.data)||[]; brObj=ba.find(function(b){return String(b.name+' '+b.name_ua).indexOf(String(od.branch||''))>=0;})||ba[0]; }
var parts=String(od.fullName||'').split(/\s+/); var last=parts[0]||'',first=parts[1]||'',middle=parts[2]||null;
var payload={ sender_id:Number(keys.BREWDROP_SENDER_ID)||undefined,
  client_data:{ first_name:first,last_name:last,middle_name:middle,phone:od.phone||'',delivery_id:1,city_id:cityObj&&cityObj.id,branch_id:brObj&&brObj.id },
  delivery_data:{ delivery_id:1,delivery_pay_person:1 }, pay_type:1, pay_person:1, discount:{type:'%',value:0},
  sell_price:Number(context.payAmount)||prod.price||undefined, comment:'Замовлення '+(context.orderRef||'') };
var summary='🧾 brewdrop '+(dryRun?'(DRY-RUN)':'СТВОРЕНО')+':\nТовар: '+article+' / '+(chosen&&chosen.color)+' / '+(chosen&&chosen.size)+' (pcsId '+pcsId+', залишок '+(chosen&&chosen.remains)+')\nОтримувач: '+last+' '+first+' '+(od.phone||'')+'\nНП: '+((cityObj&&cityObj.name)||od.city)+' / '+((brObj&&brObj.name)||od.branch)+'\nЦіна продажу: '+payload.sell_price+' | sender_id: '+(payload.sender_id||'—');
if(dryRun) return { supplierOrderResult:summary+'\n\n⚠️ DRY-RUN: НЕ відправлено (BREWDROP_DRY_RUN=1).', supplierOrderPayload:JSON.stringify(payload) };
var o=await bd('/api/orders',{method:'POST',body:JSON.stringify(payload)});
if(o.status>=400) return { supplierOrderResult:'❌ brewdrop orders: '+JSON.stringify(o.json).slice(0,300), supplierOrderPayload:JSON.stringify(payload) };
var od2=(o.json&&o.json.data)||{};
return { supplierOrderResult:summary+'\n✅ ID: '+(od2.id||'?')+(od2.ttn?(' | ТТН: '+od2.ttn):''), supplierOrderId:od2.id||null, supplierTtn:od2.ttn||'' };
