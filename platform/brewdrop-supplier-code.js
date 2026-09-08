// Дропшип-замовлення brewdrop.in.ua. ДЖЕРЕЛО ІСТИНИ для n_supplier_order (goverla CRM-клон,
// патч patch-goverla-crm-audit-2026-09-04.js).
// Аудит 2026-09-04: прибрано ВСІ фолбеки "перший результат" (sd[0] по артикулу, перше місто,
// ba[0] по відділенню) — вони давали реальні відправки не того товару не туди (антипатерн
// A1/A8). Тепер: немає точного збігу → ❌ + supplierNeedsManual, менеджер оформлює вручну.
// Місто/відділення резолвимо ДО додавання в кошик, щоб помилка не лишала позицію в кошику.
if(context.testMode) return { supplierOrderResult:'(testMode: brewdrop пропущено)' };
var base=(keys.BREWDROP_API_BASE||'https://api.brewdrop.in.ua').replace(/\/+$/,'');
var tok=(keys.BREWDROP_TOKEN||'').trim();
var dryRun=String(keys.BREWDROP_DRY_RUN||'1')!=='0';
if(!tok) return { supplierOrderResult:'❌ BREWDROP_TOKEN не заповнено', supplierOrderStatus:'error', supplierNeedsManual:true };
var HDR={ 'Authorization':'Bearer '+tok, 'crossdomain':'true', 'Accept':'application/json', 'Content-Type':'application/json', 'Origin':'https://brewdrop.in.ua' };
async function bd(path,opts){ var r=await fetch(base+path,Object.assign({headers:HDR},opts||{})); var j=null; try{ j=await r.json(); }catch(e){} return {status:r.status,json:j}; }
function norm(x){ return String(x||'').toLowerCase().replace(/[’'`]/g,'').replace(/\s+/g,' ').trim(); }
function fail(msg){ return { supplierOrderResult:'❌ brewdrop: '+msg, supplierOrderStatus:'error', supplierNeedsManual:true }; }
var prod=context.product||{}; var od=context.orderData||{}; var np=context.np||{};
var map={}; try{ map=JSON.parse(keys.BREWDROP_ARTICLE_MAP||'{}'); }catch(e){}
var m=map[String(prod.id)]||{};
// Пріоритет пошуку: 1) ручний override з BREWDROP_ARTICLE_MAP; 2) явний артикул
// постачальника з CRM; 3) звичайний CRM-артикул, а якщо НЕ знайдеться — той самий БЕЗ
// суфіксу кольору («888888-1» → «888888»).
var mapArticle=String(m.article||'').trim();
var explicitArticle=String(prod.supplierArticle||'').trim();
var crmArticle=(prod.article||prod.vendor_code||prod.sku||context.orderSku||((prod.offers&&prod.offers[0]&&prod.offers[0].sku))||'').trim();
var articleCandidates;
if(mapArticle) articleCandidates=[mapArticle];
else if(explicitArticle) articleCandidates=[explicitArticle];
else { articleCandidates=[crmArticle]; if(/-\d+$/.test(crmArticle)) articleCandidates.push(crmArticle.replace(/-\d+$/,'')); }
var color=(m.color||(context.colorChoice&&context.colorChoice.color)||'').trim();
var size=(context.recommendedSize||'').trim();
// 2026-09-07 (реальний прогін A0165): у brewdrop кольори російською («чёрный», «синий», «графит»), у CRM —
// українською («Чорний», «Темно-синій», «Графітовий») → раніше «нема в наявності» хибно. Синоніми UA→RU.
var COLOR_SYN={ 'чорний':['чорний','черный','чёрный','black'], 'графітовий':['графітовий','графит','графитовый','графіт'], 'темно-синій':['темно-синій','темно-синий','синий','синій','navy'], 'синій':['синій','синий','темно-синий','темно-синій'], 'світло-сірий':['світло-сірий','светло-серый','світло сірий','светло серый'], 'сірий':['сірий','серый','grey','gray'], 'хакі':['хакі','хаки','khaki'], 'бордовий':['бордовий','бордовый','бордо'], 'білий':['білий','белый','white'], 'бежевий':['бежевий','бежевый','беж'], 'коричневий':['коричневий','коричневый','brown'], 'темно-коричневий':['темно-коричневий','темно-коричневый'], 'зелений':['зелений','зеленый','green'], 'оливковий':['оливковий','оливковый','олива'], 'молочний':['молочний','молочный'], 'червоний':['червоний','красный','red'] };
function colorMatches(supplierColor, wanted){ var sc=norm(supplierColor), w=norm(wanted); if(!w) return true; if(sc===w||sc.indexOf(w)>=0||w.indexOf(sc)>=0) return true; var syn=COLOR_SYN[w]||[]; for(var i=0;i<syn.length;i++){ var s=norm(syn[i]); if(sc===s||sc.indexOf(s)>=0) return true; } return false; }
if(!articleCandidates[0]) return fail('немає артикулу для товару '+(prod.name||prod.id)+' — заповни BREWDROP_ARTICLE_MAP або артикул постачальника в CRM');
var article='', found=null;
for(var aci=0; aci<articleCandidates.length && !found; aci++){
  article=articleCandidates[aci];
  var s=await bd('/api/guest/products/?search='+encodeURIComponent(article)+'&per_page=20');
  var sd=(s.json&&s.json.data)||[];
  found=sd.find(function(p){return norm(p.vendor_code)===norm(article);})||null;
}
if(!found) return fail('артикул '+articleCandidates.join(' / ')+' не знайдено (точного збігу vendor_code нема)');
var d=await bd('/api/guest/products/'+found.product_id);
var colors=(((d.json&&(d.json.data||d.json))||{}).remains)||[];
var pcsId=null, chosen=null;
for(var ci=0;ci<colors.length;ci++){ var c=colors[ci]; var cn=norm(c.color&&c.color.name);
  if(color && !colorMatches(cn,color)) continue;
  var sizes=c.sizes||[];
  for(var si=0;si<sizes.length;si++){ var sv=sizes[si];
    if(size && norm(sv.size&&sv.size.name)!==norm(size)) continue;
    if(Number(sv.remains)>0){ pcsId=sv.product_color_size_id; chosen={color:cn,size:(sv.size&&sv.size.name),remains:sv.remains}; break; } }
  if(pcsId) break; }
if(!pcsId) return fail('нема в наявності '+article+' / '+(color||'будь-який колір')+' / '+(size||'будь-який розмір'));
// Місто: точний збіг назви (нормалізованої), беремо назву з перевірки Нової Пошти, якщо була.
var cityRaw=String(np.city||od.city||'');
var cityQ=cityRaw.replace(/^(м|с|смт|сел|селище)\.?\s+/i,'').split(',')[0].split('(')[0].trim();
if(!cityQ) return fail('не вказано місто доставки');
// 2026-09-07 (реальний прогін): /api/cities ігнорує search= (віддає алфавітний список), фільтрує лише name= (укр. назва).
var cy=await bd('/api/cities?name='+encodeURIComponent(cityQ)+'&per_page=10');
var cyList=(cy.json&&cy.json.data)||[];
var cityObj=cyList.find(function(c){ return norm(c.name)===norm(cityQ) || norm(c.name_ua)===norm(cityQ); })||null;
if(!cityObj) return fail('місто «'+cityQ+'» не знайдено точним збігом (варіанти: '+(cyList.map(function(c){return c.name_ua||c.name;}).slice(0,5).join(', ')||'—')+')');
var bnum=(String(np.warehouse||od.branch||'').match(/№\s*(\d+)/)||String(od.branch||'').match(/(\d+)/)||[])[1]||'';
if(!bnum) return fail('не вказано номер відділення/поштомата');
var brs=await bd('/api/branches?city_id='+cityObj.id+'&search='+encodeURIComponent(bnum)+'&per_page=50');
var ba=(brs.json&&brs.json.data)||[];
var bnRe=new RegExp('№\\s*'+bnum+'(?!\\d)');
var brObj=ba.find(function(b){return bnRe.test(String(b.name||'')+' '+String(b.name_ua||''));})||null;
if(!brObj) return fail('відділення №'+bnum+' у місті «'+(cityObj.name_ua||cityObj.name)+'» не знайдено');
var cart=await bd('/api/carts',{method:'POST',body:JSON.stringify({product_color_size_id:pcsId,qty:1})});
if(cart.status>=400) return fail('кошик: '+JSON.stringify(cart.json).slice(0,200));
var parts=String(od.fullName||'').split(/\s+/); var last=parts[0]||'',first=parts[1]||'',middle=parts[2]||null;
// sender_id: ключ BREWDROP_SENDER_ID, інакше — єдиний відправник з кабінету (/api/senders); кілька → менеджер.
// 2026-09-08 (питання власника «де ти заповнюєш відправника — вручну такого нема»): /api/senders для продавця
// повертає 403 «Admin only» (список із 15 прізвищ 07.09 був чужими профілями). Продавець відправника не обирає —
// кабінет бере його з акаунта. sender_id шлемо ЛИШЕ якщо явно заданий ключ BREWDROP_SENDER_ID; інакше без нього.
var senderId=Number(keys.BREWDROP_SENDER_ID)||0;
var payload=Object.assign(senderId?{ sender_id:senderId }:{}, {
  client_data:{ first_name:first,last_name:last,middle_name:middle,phone:od.phone||'',delivery_id:1,city_id:cityObj.id,branch_id:brObj.id },
  delivery_data:{ delivery_id:1,delivery_pay_person:1 }, pay_type:1, pay_person:1, discount:{type:'%',value:0},
  sell_price:Number(context.payAmount)||prod.price||undefined, comment:'Замовлення '+(context.orderRef||'') });
var summary='🧾 brewdrop '+(dryRun?'(DRY-RUN)':'СТВОРЕНО')+':\nТовар: '+article+' / '+(chosen&&chosen.color)+' / '+(chosen&&chosen.size)+' (pcsId '+pcsId+', залишок '+(chosen&&chosen.remains)+')\nОтримувач: '+last+' '+first+' '+(od.phone||'')+'\nНП: '+(cityObj.name_ua||cityObj.name)+' / '+(brObj.name_ua||brObj.name)+'\nЦіна продажу: '+payload.sell_price+' | sender_id: '+(payload.sender_id||'—');
if(dryRun) return { supplierOrderResult:summary+'\n\n⚠️ DRY-RUN: НЕ відправлено (BREWDROP_DRY_RUN=1).', supplierOrderStatus:'dry_run', supplierOrderPayload:JSON.stringify(payload) };
var o=await bd('/api/orders',{method:'POST',body:JSON.stringify(payload)});
if(o.status>=400) return { supplierOrderResult:'❌ brewdrop orders: '+JSON.stringify(o.json).slice(0,300), supplierOrderStatus:'error', supplierNeedsManual:true, supplierOrderPayload:JSON.stringify(payload) };
var od2=(o.json&&o.json.data)||{};
return { supplierOrderResult:summary+'\n✅ ID: '+(od2.id||'?')+(od2.ttn?(' | ТТН: '+od2.ttn):''), supplierOrderStatus:'created', supplierOrderId:od2.id||null, supplierTtn:od2.ttn||'' };
