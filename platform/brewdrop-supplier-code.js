// Дропшип-замовлення brewdrop.in.ua. ДЖЕРЕЛО ІСТИНИ для n_supplier_order (goverla CRM-клон,
// патч patch-goverla-crm-audit-2026-09-04.js).
// Аудит 2026-09-04: прибрано ВСІ фолбеки "перший результат" (sd[0] по артикулу, перше місто,
// ba[0] по відділенню) — вони давали реальні відправки не того товару не туди (антипатерн
// A1/A8). Тепер: немає точного збігу → ❌ + supplierNeedsManual, менеджер оформлює вручну.
// Місто/відділення резолвимо ДО додавання в кошик, щоб помилка не лишала позицію в кошику.
//
// v2 (2026-09-08, перший бойовий день — 6 замовлень впали з 403 «Admin only»): кабінет ПРОДАВЦЯ створює
// замовлення через POST /api/marketplace/orders (реверс SPA brewdrop.in.ua, CheckoutPage), а /api/orders —
// адмінський. Схема звірена з 8 замовленнями, які менеджер оформив вручну 08.09 11:44–12:00:
// pay_type=1 (накладений платіж), pay_person=1, delivery_pay_person=1, total_final = сума до отримання
// («решта при отриманні»), total_check = 1590 (оголошена вартість, у менеджера завжди 1590 → ключ
// BREWDROP_TOTAL_CHECK), products = позиції кошика (кілька штук/розмірів — одним замовленням).
// Повна передоплата (method=full) — менеджеру вручну (тип оплати «з балансу» не перевірений).
if(context.testMode) return { supplierOrderResult:'(testMode: brewdrop пропущено)' };
var base=(keys.BREWDROP_API_BASE||'https://api.brewdrop.in.ua').replace(/\/+$/,'');
var tok=(keys.BREWDROP_TOKEN||'').trim();
var dryRun=String(keys.BREWDROP_DRY_RUN||'1')!=='0';
if(!tok) return { supplierOrderResult:'❌ BREWDROP_TOKEN не заповнено', supplierOrderStatus:'error', supplierNeedsManual:true };
var HDR={ 'Authorization':'Bearer '+tok, 'crossdomain':'true', 'Accept':'application/json', 'Content-Type':'application/json', 'Origin':'https://brewdrop.in.ua' };
async function bd(path,opts){ var r=await fetch(base+path,Object.assign({headers:HDR},opts||{})); var j=null; try{ j=await r.json(); }catch(e){} return {status:r.status,json:j}; }
function norm(x){ return String(x||'').toLowerCase().replace(/[’'`ʼ]/g,'').replace(/\s+/g,' ').trim(); }
// «Берестин (Харківська обл)» у BrewDrop vs «Берестин» у клієнта (11:03): порівнюємо без дужок.
function normCity(x){ return norm(String(x||'').split('(')[0]); }
function fail(msg){ return { supplierOrderResult:'❌ brewdrop: '+msg, supplierOrderStatus:'error', supplierNeedsManual:true }; }
var prod=context.product||{}; var od=context.orderData||{}; var np=context.np||{};
var map={}; try{ map=JSON.parse(keys.BREWDROP_ARTICLE_MAP||'{}'); }catch(e){}
var COLOR_SYN={ 'чорний':['чорний','черный','чёрный','black'], 'графітовий':['графітовий','графит','графитовый','графіт'], 'темно-синій':['темно-синій','темно-синий','синий','синій','navy'], 'синій':['синій','синий','темно-синий','темно-синій'], 'світло-сірий':['світло-сірий','светло-серый','світло сірий','светло серый'], 'сірий':['сірий','серый','grey','gray'], 'хакі':['хакі','хаки','khaki'], 'бордовий':['бордовий','бордовый','бордо'], 'білий':['білий','белый','white'], 'бежевий':['бежевий','бежевый','беж'], 'коричневий':['коричневий','коричневый','brown'], 'темно-коричневий':['темно-коричневий','темно-коричневый'], 'зелений':['зелений','зеленый','green'], 'темно-зелений':['темно-зелений','темно-зеленый'], 'оливковий':['оливковий','оливковый','олива'], 'молочний':['молочний','молочный'], 'червоний':['червоний','красный','red'], 'блакитний':['блакитний','голубой'], 'світло-синій':['світло-синій','светло-синий'] };
function colorMatches(supplierColor, wanted){ var sc=norm(supplierColor), w=norm(wanted); if(!w) return true; if(sc===w||sc.indexOf(w)>=0||w.indexOf(sc)>=0) return true; var syn=COLOR_SYN[w]||[]; for(var i=0;i<syn.length;i++){ var s=norm(syn[i]); if(sc===s||sc.indexOf(s)>=0) return true; } return false; }
// 2026-09-08 (Ковальчук A0182 «Сірий» ×2: у brewdrop лише «чёрный/графит», менеджер оформив як графіт): другий, м'якший
// прохід — сусідні відтінки тієї ж гами, лише якщо точного/синонімічного збігу немає.
var COLOR_LOOSE={ 'сірий':['графит','светло-серый','серый'], 'світло-сірий':['серый','графит'], 'графітовий':['серый','темно-серый'], 'темно-синій':['синий','джинс','голубо-синий'], 'синій':['темно-синий','голубо-синий','джинс'], 'блакитний':['голубо-синий','голубой'], 'коричневий':['темно-коричневый','кэмел'], 'темно-коричневий':['коричневый'], 'зелений':['темно-зеленый','хаки','олива'], 'темно-зелений':['зеленый','хаки'] };
function colorMatchesLoose(supplierColor, wanted){ var sc=norm(supplierColor), w=norm(wanted); var syn=COLOR_LOOSE[w]||[]; for(var i=0;i<syn.length;i++){ var s=norm(syn[i]); if(sc===s||sc.indexOf(s)>=0) return true; } return false; }
// Артикул → товар brewdrop (точний збіг vendor_code). Кандидати: ручний override → артикул постачальника з CRM → CRM-артикул (і без суфікса кольору).
async function findBdProduct(p){
  var m=map[String(p.id)]||{};
  var cands=[]; var mapArticle=String(m.article||'').trim(); var explicitArticle=String(p.supplierArticle||'').trim();
  var crmArticle=String(p.article||p.vendor_code||p.sku||'').trim();
  if(mapArticle) cands=[mapArticle]; else if(explicitArticle) cands=[explicitArticle]; else { cands=[crmArticle]; if(/-\d+$/.test(crmArticle)) cands.push(crmArticle.replace(/-\d+$/,'')); }
  cands=cands.filter(Boolean);
  if(!cands.length) return { error:'немає артикулу для товару '+(p.name||p.id)+' — заповни артикул постачальника в CRM' };
  for(var i=0;i<cands.length;i++){ var s=await bd('/api/guest/products/?search='+encodeURIComponent(cands[i])+'&per_page=20'); var sd=(s.json&&s.json.data)||[]; var f=sd.find(function(x){return norm(x.vendor_code)===norm(cands[i]);}); if(f) return { found:f, article:cands[i], mapColor:String(m.color||'').trim() }; }
  return { error:'артикул '+cands.join(' / ')+' не знайдено (точного збігу vendor_code нема)' };
}
// Колір+розмір → product_color_size_id із залишком > 0.
var __bdDetail={};
async function resolvePcs(bdp, color, size){
  if(!__bdDetail[bdp.product_id]){ var d=await bd('/api/guest/products/'+bdp.product_id); __bdDetail[bdp.product_id]=(((d.json&&(d.json.data||d.json))||{}).remains)||[]; }
  var colors=__bdDetail[bdp.product_id];
  var passes=[colorMatches, colorMatchesLoose];
  for(var pi=0;pi<passes.length;pi++){
    for(var ci=0;ci<colors.length;ci++){ var c=colors[ci]; var cn=norm(c.color&&c.color.name);
      if(color && !passes[pi](cn,color)) continue;
      var sizes=c.sizes||[];
      for(var si=0;si<sizes.length;si++){ var sv=sizes[si];
        if(size && norm(sv.size&&sv.size.name)!==norm(size)) continue;
        if(Number(sv.remains)>0) return { pcsId:sv.product_color_size_id, color:cn+(pi>0?' (≈ '+color+')':''), size:(sv.size&&sv.size.name), remains:sv.remains }; } }
    if(!color) break;
  }
  return null;
}
// ── 1) спосіб оплати: накладений платіж на решту; повна передоплата — вручну ──
var payMethod=String((context.paymentInfo&&context.paymentInfo.method)||'cod');
var orderTotal=Number(context.orderTotal)||0; var prepaid=Number(context.payAmount)||0;
if(payMethod==='full') return fail('повна передоплата ('+orderTotal+' грн) — тип оплати «з балансу» для API ще не підтверджено, оформіть вручну');
var codAmount=payMethod==='cod_trust'?orderTotal:Math.max(0,orderTotal-prepaid);
if(!(codAmount>0)) return fail('не визначено суму накладеного платежу (orderTotal='+orderTotal+', передоплата='+prepaid+')');
// ── 2) позиції: усі одиниці основного товару (кілька штук/розмірів/кольорів — одним замовленням) ──
var units=(Array.isArray(context.orderUnits)&&context.orderUnits.length)?context.orderUnits:[{ color:String((context.colorChoice&&context.colorChoice.color)||'').trim(), size:String(context.recommendedSize||'').trim() }];
var fp=await findBdProduct(prod); if(fp.error) return fail(fp.error);
var article=fp.article; var lines=[]; var missing=[];
for(var ui=0;ui<units.length;ui++){ var u=units[ui]||{}; var uc=String(fp.mapColor||u.color||'').trim(); var us=String(u.size||context.recommendedSize||'').trim();
  var r=await resolvePcs(fp.found, uc, us);
  if(!r) return fail('нема в наявності '+article+' / '+(uc||'будь-який колір')+' / '+(us||'будь-який розмір'));
  var ex=lines.find(function(l){return l.pcsId===r.pcsId;}); if(ex) ex.qty+=1; else lines.push({ pcsId:r.pcsId, qty:1, label:article+' / '+r.color+' / '+r.size+' (залишок '+r.remains+')' }); }
// ── 2b) допродаж (футболка): артикул постачальника з CRM, колір із upsellNote, розмір — з upsellNote або як в основного ──
var oi=context.orderIntent||{}; var up=((prod.upsellItems)||[])[0]||null; var upQty=Number(oi.upsellQty)||1;
if(oi.addUpsell && up){
  var note=String(oi.upsellNote||''); var upColors=[]; var lowNote=note.toLowerCase();
  for(var k in COLOR_SYN){ if(COLOR_SYN[k].some(function(s){return lowNote.indexOf(s)>=0;})) upColors.push(k); }
  var upSizeM=note.match(/\b(xs|s|m|l|xl|xxl|xxxl|2xl|3xl)\b/i); var upSize=upSizeM?upSizeM[1].toUpperCase():String(context.recommendedSize||'').trim();
  var fu=await findBdProduct(Object.assign({}, up, { sku: up.sku, supplierArticle: up.supplierArticle }));
  if(fu.error){ missing.push('допродаж «'+up.name+'» ×'+upQty+' ('+(note||'колір не вказано')+'): '+fu.error); }
  else {
    var want=upColors.length?upColors:['']; var per=Math.max(1,Math.round(upQty/want.length));
    for(var wi=0;wi<want.length;wi++){ var ru=await resolvePcs(fu.found, want[wi], upSize);
      if(!ru){ missing.push('допродаж «'+up.name+'» '+(want[wi]||'')+' '+upSize+' — нема в наявності у brewdrop'); continue; }
      var exu=lines.find(function(l){return l.pcsId===ru.pcsId;}); if(exu) exu.qty+=per; else lines.push({ pcsId:ru.pcsId, qty:per, label:fu.article+' / '+ru.color+' / '+ru.size+' ×'+per+' (допродаж, залишок '+ru.remains+')' }); }
  }
}
// ── 3) місто/відділення (до кошика) ──
var cityRaw=String(np.city||od.city||'');
var cityQ=cityRaw.replace(/^(м|с|смт|сел|селище|місто|село)\.?\s+/i,'').split(',')[0].split('(')[0].trim();
if(!cityQ) return fail('не вказано місто доставки');
var cy=await bd('/api/cities?name='+encodeURIComponent(cityQ)+'&per_page=10');
var cyList=(cy.json&&cy.json.data)||[];
var cityObj=cyList.find(function(c){ return norm(c.name)===norm(cityQ) || norm(c.name_ua)===norm(cityQ); })||null;
if(!cityObj){ var byBase=cyList.filter(function(c){ return normCity(c.name)===normCity(cityQ) || normCity(c.name_ua)===normCity(cityQ); }); if(byBase.length===1) cityObj=byBase[0];
  // 2026-09-08 (Пашковський: «Біла Криниця» — Рівненська/Херсонська): звужуємо областю/районом з адреси клієнта.
  if(!cityObj && byBase.length>1){ var regSrc=norm([od.region, np.region, od.branch, od.city, cityRaw].filter(Boolean).join(' ')); var regStems=(regSrc.match(/[а-яіїєґ]{5,}/g)||[]).map(function(w){return w.slice(0,5);}).filter(function(w){return !/^(облас|район|відді|поштом|нова|пошта|село|селищ)/.test(w);});
    var byReg=byBase.filter(function(c){ var paren=norm(String(c.name_ua||c.name||'').split('(')[1]||''); return regStems.some(function(st){ return paren.indexOf(st)>=0; }); }); if(byReg.length===1) cityObj=byReg[0]; } }
if(!cityObj) return fail('місто «'+cityQ+'» не знайдено точним збігом (варіанти: '+(cyList.map(function(c){return c.name_ua||c.name;}).slice(0,5).join(', ')||'—')+')');
var bnum=(String(np.warehouse||od.branch||'').match(/№\s*(\d+)/)||String(od.branch||'').match(/(\d+)/)||[])[1]||'';
if(!bnum) return fail('не вказано номер відділення/поштомата');
var brs=await bd('/api/branches?city_id='+cityObj.id+'&search='+encodeURIComponent(bnum)+'&per_page=50');
var ba=(brs.json&&brs.json.data)||[];
var bnRe=new RegExp('№\\s*'+bnum+'(?!\\d)');
var brObj=ba.find(function(b){return bnRe.test(String(b.name||'')+' '+String(b.name_ua||''));})||null;
if(!brObj) return fail('відділення №'+bnum+' у місті «'+(cityObj.name_ua||cityObj.name)+'» не знайдено');
// ── 4) отримувач, dropshipper_id ──
var parts=String(od.fullName||'').split(/\s+/); var last=parts[0]||'',first=parts[1]||'',middle=parts[2]||null;
// 2026-09-08 13:16 (перший реальний POST, Микитан): «client_data.phone має бути 18 символів» — формат кабінету «+38(0XX) XXX-XX-XX».
var digits=String(od.phone||'').replace(/\D/g,''); if(digits.length===12&&digits.indexOf('380')===0) digits=digits.slice(2); if(digits.length===11&&digits.charAt(0)==='8') digits=digits.slice(1);
if(digits.length!==10||digits.charAt(0)!=='0') return fail('телефон «'+(od.phone||'')+'» не схожий на український мобільний (потрібно 10 цифр 0XXXXXXXXX)');
var phoneFmt='+38('+digits.slice(0,3)+') '+digits.slice(3,6)+'-'+digits.slice(6,8)+'-'+digits.slice(8,10);
var me=await bd('/api/users/auth'); var meId=Number((me.json&&me.json.data&&me.json.data.id)||0)||undefined;
var senderId=Number(keys.BREWDROP_SENDER_ID)||0;
var totalCheck=Number(keys.BREWDROP_TOTAL_CHECK)||1590;
var payload=Object.assign(senderId?{ sender_id:senderId }:{}, {
  dropshipper_id:meId,
  client_data:{ first_name:first,last_name:last,middle_name:middle,phone:phoneFmt,delivery_id:1,city_id:cityObj.id,branch_id:brObj.id },
  delivery_data:{ delivery_id:1,delivery_pay_person:1 }, delivery_method_id:1, pay_type:1, pay_person:1,
  seller_comment:'Замовлення '+(context.orderRef||''), products:lines.map(function(l){return { product_color_size_id:l.pcsId, qty:l.qty };}),
  total_final:codAmount, total_check:totalCheck, ttn:null });
var summary='🧾 brewdrop '+(dryRun?'(DRY-RUN)':'СТВОРЕНО')+':\n'+lines.map(function(l){return '• '+l.label+(l.qty>1?' ×'+l.qty:'');}).join('\n')+'\nОтримувач: '+last+' '+first+' '+(od.phone||'')+'\nНП: '+(cityObj.name_ua||cityObj.name)+' / '+(brObj.name_ua||brObj.name)+'\nНакладений платіж: '+codAmount+' грн (оголошена '+totalCheck+')'+(missing.length?('\n⚠️ Додайте вручну: '+missing.join('; ')):'');
if(dryRun) return { supplierOrderResult:summary+'\n\n⚠️ DRY-RUN: НЕ відправлено (BREWDROP_DRY_RUN=1).', supplierOrderStatus:'dry_run', supplierOrderPayload:JSON.stringify(payload), supplierNeedsManual:missing.length>0 };
// ── 5) кошик (серверний, per-user): очистити хвости попередніх спроб, додати позиції, створити замовлення ──
var cur=await bd('/api/carts'); var curItems=(cur.json&&(cur.json.items||cur.json.data))||[];
for(var di=0;di<curItems.length;di++){ var cid=curItems[di]&&(curItems[di].id||curItems[di].cart_id); if(cid) await bd('/api/carts/'+cid,{method:'DELETE'}); }
for(var li=0;li<lines.length;li++){ var cart=await bd('/api/carts',{method:'POST',body:JSON.stringify({product_color_size_id:lines[li].pcsId,qty:lines[li].qty})}); if(cart.status>=400) return fail('кошик: '+JSON.stringify(cart.json).slice(0,200)); }
var o=await bd('/api/marketplace/orders',{method:'POST',body:JSON.stringify(payload)});
if(o.status>=400) return { supplierOrderResult:'❌ brewdrop marketplace/orders: '+JSON.stringify(o.json).slice(0,300), supplierOrderStatus:'error', supplierNeedsManual:true, supplierOrderPayload:JSON.stringify(payload) };
var od2=(o.json&&o.json.data)||o.json||{};
return { supplierOrderResult:summary+'\n✅ ID: '+(od2.id||'?')+(od2.ttn?(' | ТТН: '+od2.ttn):''), supplierOrderStatus:'created', supplierOrderId:od2.id||null, supplierTtn:od2.ttn||'', supplierNeedsManual:missing.length>0 };
