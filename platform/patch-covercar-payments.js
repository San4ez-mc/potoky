'use strict';
/*
 * Патч воронки «Instagram — реклама (Zernio, covercar)» (bot cc03657f-…)
 *   Ф0  Біла нода: n_create notifyTg → notifyAdmin
 *   Ф1  Памʼять: messagesTemplate '{{conversationHistory}}' на діалог-нодах + петля нагадування
 *   Ф2  Гілка оплати: ibanoplata-лінк → реквізити → збір → виписка Mono → звірка → гілки
 *   Ф5  Прибрати осиротілі ноди реквізитів (зведені в одне повідомлення)
 *
 * ЗАПУСК:  node patch-covercar-payments.js            (dry-run: лише показує зміни)
 *          node patch-covercar-payments.js --apply    (записує у БД + бекап flowDefinition)
 *
 * Ідемпотентний: повторний запуск нічого не ламає.
 * Потрібні збережені конектори (створити в /connectors, тип має збігатись):
 *   type=ibanoplata  (api_key, organization_name, identification_code, iban)
 *   type=monobank    (token, account_id)
 */
const { db } = require('@platform/db');

const BOT_ID = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

const FOP_IBAN = 'UA703220010000026002310097579';
const FOP_CODE = '3560005875';
const FOP_NAME = 'ФОП Сіразетдінов Олексій Олександрович';
const GEMINI_CONNECTOR_ID = 'e94f5f54-b19b-4d9c-b8aa-e88bcc4194d1'; // для ШІ-візії (fallback скрінів)

// ── js-код ноди звірки оплати (Mono → лінк → ШІ-візія → людина) ────────────────
const RECONCILE_CODE = `
var EXPECTED_IBAN = (keys.FOP_IBAN||'').replace(/\\s/g,'');
var EXPECTED_CODE = (keys.FOP_CODE||'').replace(/\\D/g,'');
var orderRef = String(context.orderRef||'').toUpperCase();
var expected = Number(context.payAmount)||0;
var stmt = Array.isArray(context.monoStatement)?context.monoStatement:[];
var consumed = Array.isArray(context.consumedTxIds)?context.consumedTxIds:[];
function isC(id){ return consumed.indexOf(id)>=0; }
function parseAmount(txt){ if(!txt)return null; var m=String(txt).match(/(\\d[\\d\\s]*[.,]?\\d{0,2})\\s*(?:грн|uah|₴)?/i); if(!m)return null; var n=parseFloat(m[1].replace(/\\s/g,'').replace(',','.')); return isFinite(n)?Math.round(n*100)/100:null; }
function normName(s){ return String(s||'').toLowerCase().replace(/[^0-9a-zа-яіїєґ]+/gi,' ').trim(); }
function nameOverlap(a,b){ var aa=normName(a).split(' ').filter(function(x){return x.length>2;}); var bb=normName(b).split(' ').filter(function(x){return x.length>1;}); if(!aa.length||!bb.length)return false; for(var i=0;i<aa.length;i++){ if(bb.indexOf(aa[i])>=0) return true; } return false; }
// 1) унікальний збіг за orderRef у призначенні
function matchByRef(){ if(!orderRef)return null; for(var i=0;i<stmt.length;i++){ var t=stmt[i]; if(!isC(t.id) && String(t.comment||'').toUpperCase().indexOf(orderRef)>=0) return t; } return null; }
// 2) за сумою + розрізнення за ПЛАТНИКОМ/ЧАСОМ (щоб однакові суми не плутались)
function matchByAmount(amount, hints){ hints=hints||{}; if(!amount)return null; var cands=[]; for(var i=0;i<stmt.length;i++){ var t=stmt[i]; if(!isC(t.id) && Math.abs(Number(t.amountUah)-amount)<0.01) cands.push(t); } if(!cands.length)return null;
  if(hints.payerName){ for(var j=0;j<cands.length;j++){ if(nameOverlap(hints.payerName,(cands[j].counterName||'')+' '+(cands[j].description||''))) return cands[j]; } }
  if(hints.timeSec){ var best=null,bd=1e18; for(var k=0;k<cands.length;k++){ var d=Math.abs(Number(cands[k].time)-Number(hints.timeSec)); if(d<bd){bd=d;best=cands[k];} } if(best&&bd<=5400) return best; }
  cands.sort(function(a,b){return Number(b.time)-Number(a.time);}); return cands[0]; }
var found = matchByRef();
var via = found ? 'mono:ref' : '';
// Крок 2: лінк-квитанція у тексті (check.monobank.ua / pb.ua/check тощо) — парсимо кодом
if(!found){
  var link=(String(context.lastUserMessage||input||'').match(/https?:\\/\\/[^\\s]+/)||[])[0];
  function linkOk(u){ try{ var h=new URL(u).hostname.toLowerCase(); return ['check.monobank.ua','send.monobank.ua','pay.mono.ua','pb.ua','privatbank.ua','next.privat24.ua','portmone.com.ua','check.gov.ua'].some(function(d){return h===d||h.endsWith('.'+d);}); }catch(e){return false;} }
  if(link && linkOk(link)){ var ac=new AbortController(); var to=setTimeout(function(){try{ac.abort();}catch(e){}},8000);
    try{ var r=await fetch(link,{redirect:'follow',signal:ac.signal}); var html=(await r.text()).slice(0,300000); var txt=html.replace(/<[^>]+>/g,' ');
      var okRec = txt.replace(/\\s/g,'').indexOf(EXPECTED_IBAN)>=0 || txt.replace(/\\D/g,'').indexOf(EXPECTED_CODE)>=0;
      var amt = parseAmount((txt.match(/(?:Сума|Сумма|Amount)[^\\d]{0,20}(\\d[\\d\\s]*[.,]?\\d{0,2})/i)||[])[1]);
      var payer=(txt.match(/Платник[^A-Za-zА-Яа-яІЇЄҐіїєґ]{0,15}([A-Za-zА-Яа-яІЇЄҐіїєґ'\\-]{2,}\\s+[A-Za-zА-Яа-яІЇЄҐіїєґ'\\-]{2,}(?:\\s+[A-Za-zА-Яа-яІЇЄҐіїєґ'\\-]{2,})?)/)||[])[1]||'';
      if(okRec){ found = matchByAmount(amt||expected, { payerName:payer }); if(found) via='mono:link'; }
    }catch(e){}finally{clearTimeout(to);} }
}
// Крок 3: скрін — ШІ-візія (лише коли Mono не знайшов). Останній резерв.
function imgOk(u){ try{ var h=new URL(u).hostname.toLowerCase(); if(h==='api.telegram.org') return true; return ['cdninstagram.com','fbcdn.net','fbsbx.com'].some(function(d){return h===d||h.endsWith('.'+d);}); }catch(e){return false;} }
if(!found && context.lastReceiptImageUrl && keys.GEMINI_API_KEY && imgOk(context.lastReceiptImageUrl)){
  var ac2=new AbortController(); var to2=setTimeout(function(){try{ac2.abort();}catch(e){}},10000);
  try{
    var ir=await fetch(context.lastReceiptImageUrl,{signal:ac2.signal}); var ab=await ir.arrayBuffer(); if(ab.byteLength>8000000) throw new Error('img too large'); var b64=Buffer.from(ab).toString('base64');
    var mime=(ir.headers.get('content-type')||'image/jpeg').split(';')[0];
    var gr=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key='+encodeURIComponent(keys.GEMINI_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'Це банківська квитанція про переказ. Поверни ЛИШЕ JSON {"amount":число,"recipientCode":"код одержувача","iban":"IBAN одержувача","payerName":"ПІБ платника","purpose":"призначення"}'},{inline_data:{mime_type:mime,data:b64}}]}]})});
    var gj=await gr.json(); var t=((((gj.candidates||[])[0]||{}).content||{}).parts||[{}])[0].text||''; var mm=t.match(/\\{[\\s\\S]*\\}/);
    if(mm){ var f=JSON.parse(mm[0]); var okRec2=String(f.iban||'').replace(/\\s/g,'').indexOf(EXPECTED_IBAN)>=0 || String(f.recipientCode||'').replace(/\\D/g,'').indexOf(EXPECTED_CODE)>=0; var amt2=Number(f.amount)||parseAmount(f.amount); if(okRec2){ found=matchByAmount(amt2||expected, { payerName:f.payerName }); if(found) via='mono:ai'; } }
  }catch(e){}finally{clearTimeout(to2);}
}
// Крок 4: клієнт написав «оплатив» без квитанції → слабкий збіг за сумою (глоб. реєстр не дасть зарахувати двічі)
if(!found && expected){ found = matchByAmount(expected, {}); if(found) via='mono:amount'; }
if(found){ consumed.push(found.id); return { payStatus:'confirmed', payVia:via, payTxId:found.id, consumedTxIds:consumed }; }
return { payStatus:'not_found', payVia:'none' };
`.trim();

// ── js-код ноди розміщення замовлення у brewdrop (REST API, dry-run за замовч.) ──
const BREWDROP_ORDER_CODE = `
if(context.testMode) return { supplierOrderResult:'(testMode: brewdrop пропущено)' };
var base=(keys.BREWDROP_API_BASE||'https://api.brewdrop.in.ua').replace(/\\/+$/,'');
var tok=(keys.BREWDROP_TOKEN||'').trim();
var dryRun=String(keys.BREWDROP_DRY_RUN||'1')!=='0';
if(!tok) return { supplierOrderResult:'❌ BREWDROP_TOKEN не заповнено' };
var HDR={ 'Authorization':'Bearer '+tok, 'crossdomain':'true', 'Accept':'application/json', 'Content-Type':'application/json', 'Origin':'https://brewdrop.in.ua' };
async function bd(path,opts){ var r=await fetch(base+path,Object.assign({headers:HDR},opts||{})); var j=null; try{ j=await r.json(); }catch(e){} return {status:r.status,json:j}; }
function norm(x){ return String(x||'').toLowerCase().trim(); }
var prod=context.product||{}; var od=context.orderData||{};
var map={}; try{ map=JSON.parse(keys.BREWDROP_ARTICLE_MAP||'{}'); }catch(e){}
var m=map[String(prod.id)]||{};
var article=(m.article||prod.supplierArticle||prod.article||prod.vendor_code||prod.sku||context.orderSku||((prod.offers&&prod.offers[0]&&prod.offers[0].sku))||'').trim();
var color=(m.color||(context.colorChoice&&context.colorChoice.color)||'').trim();
var size=(context.recommendedSize||'').trim();
if(!article) return { supplierOrderResult:'❌ Немає артикулу brewdrop для товару '+(prod.name||prod.id)+' — заповни BREWDROP_ARTICLE_MAP' };
var s=await bd('/api/guest/products/?search='+encodeURIComponent(article)+'&per_page=20');
var sd=(s.json&&s.json.data)||[];
var found=sd.find(function(p){return norm(p.vendor_code)===norm(article);})||sd[0];
if(!found) return { supplierOrderResult:'❌ brewdrop: артикул '+article+' не знайдено' };
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
var parts=String(od.fullName||'').split(/\\s+/); var last=parts[0]||'',first=parts[1]||'',middle=parts[2]||null;
var payload={ sender_id:Number(keys.BREWDROP_SENDER_ID)||undefined,
  client_data:{ first_name:first,last_name:last,middle_name:middle,phone:od.phone||'',delivery_id:1,city_id:cityObj&&cityObj.id,branch_id:brObj&&brObj.id },
  delivery_data:{ delivery_id:1,delivery_pay_person:1 }, pay_type:1, pay_person:1, discount:{type:'%',value:0},
  sell_price:Number(context.payAmount)||prod.price||undefined, comment:'Замовлення '+(context.orderRef||'') };
var summary='🧾 brewdrop '+(dryRun?'(DRY-RUN)':'СТВОРЕНО')+':\\nТовар: '+article+' / '+(chosen&&chosen.color)+' / '+(chosen&&chosen.size)+' (pcsId '+pcsId+', залишок '+(chosen&&chosen.remains)+')\\nОтримувач: '+last+' '+first+' '+(od.phone||'')+'\\nНП: '+((cityObj&&cityObj.name)||od.city)+' / '+((brObj&&brObj.name)||od.branch)+'\\nЦіна продажу: '+payload.sell_price+' | sender_id: '+(payload.sender_id||'—');
if(dryRun) return { supplierOrderResult:summary+'\\n\\n⚠️ DRY-RUN: НЕ відправлено (BREWDROP_DRY_RUN=1).', supplierOrderPayload:JSON.stringify(payload) };
var o=await bd('/api/orders',{method:'POST',body:JSON.stringify(payload)});
if(o.status>=400) return { supplierOrderResult:'❌ brewdrop orders: '+JSON.stringify(o.json).slice(0,300), supplierOrderPayload:JSON.stringify(payload) };
var od2=(o.json&&o.json.data)||{};
return { supplierOrderResult:summary+'\\n✅ ID: '+(od2.id||'?')+(od2.ttn?(' | ТТН: '+od2.ttn):''), supplierOrderId:od2.id||null, supplierTtn:od2.ttn||'' };
`.trim();

// ── js-код ноди замовлення в easydrop (Django: login cookie-jar + CSRF + form-POST) ──
const EASYDROP_ORDER_CODE = `
if(context.testMode) return { supplierOrderResult:'(testMode: easydrop пропущено)' };
var base=(keys.EASYDROP_BASE||'https://easydrop.one').replace(/\\/+$/,'');
var login=(keys.EASYDROP_LOGIN||'').trim(), pass=(keys.EASYDROP_PASS||'').trim();
var dryRun=String(keys.EASYDROP_DRY_RUN||'1')!=='0';
if(!login||!pass) return { supplierOrderResult:'❌ EASYDROP_LOGIN/PASS не заповнено' };
var cookies={};
function setCk(res){ try{ var sc=res.headers.getSetCookie?res.headers.getSetCookie():[]; for(var i=0;i<sc.length;i++){ var p=sc[i].split(';')[0]; var idx=p.indexOf('='); if(idx>0) cookies[p.slice(0,idx)]=p.slice(idx+1); } }catch(e){} }
function ck(){ return Object.keys(cookies).map(function(k){return k+'='+cookies[k];}).join('; '); }
function tok(html){ var m=String(html||'').match(/name="csrfmiddlewaretoken" value="([^"]+)"/); return m?m[1]:(cookies['csrftoken']||''); }
async function get(p){ return fetch(base+p,{headers:{'Cookie':ck(),'X-Requested-With':'XMLHttpRequest','Referer':base+'/offline-supplier-order'}}); }
// 1) логін
var r1=await fetch(base+'/login'); setCk(r1); var t1=tok(await r1.text());
var r2=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':ck(),'Referer':base+'/login','Origin':base},body:'csrfmiddlewaretoken='+encodeURIComponent(t1)+'&username='+encodeURIComponent(login)+'&password='+encodeURIComponent(pass)}); setCk(r2);
var loc=r2.headers.get('location')||''; var hash=(loc.match(/hash=(\\d+)/)||[])[1];
if(hash){ cookies['manager_hash']=hash; cookies['uid']='u-'+hash; }
if(!cookies['sessionid']) return { supplierOrderResult:'❌ easydrop: логін не вдався' };
// 2) постачальник
var prod=context.product||{}, od=context.orderData||{};
var map={}; try{ map=JSON.parse(keys.BREWDROP_ARTICLE_MAP||'{}'); }catch(e){}
var mm=map[String(prod.id)]||{}; var article=(mm.article||prod.supplierArticle||prod.article||prod.vendor_code||prod.sku||context.orderSku||((prod.offers&&prod.offers[0]&&prod.offers[0].sku))||'').trim();
var supId=(keys.EASYDROP_SUPPLIER_ID||'').trim();
if(!supId && keys.EASYDROP_SUPPLIER_NAME){ var rs=await get('/autocomplete/offline-supplier/?q='+encodeURIComponent(keys.EASYDROP_SUPPLIER_NAME)); var sj=await rs.json().catch(function(){return[];}); if(sj[0])supId=String(sj[0].value); }
if(!supId) return { supplierOrderResult:'❌ easydrop: не задано EASYDROP_SUPPLIER_ID або NAME' };
// 3) товар за артикулом (ярус: 1шт = не «2 шт»)
var ri=await get('/autocomplete/offline-supplier-item/?q='+encodeURIComponent(article||prod.name||'')+'&pk='+encodeURIComponent(supId));
var items=await ri.json().catch(function(){return[];});
var pick=items.find(function(it){ return !/2\\s*шт/i.test(it.text||''); })||items[0];
if(!pick) return { supplierOrderResult:'❌ easydrop: товар «'+(article||prod.name)+'» не знайдено у постачальника '+supId };
// 4) csrf форми
var r3=await fetch(base+'/offline-supplier-order',{headers:{'Cookie':ck()}}); setCk(r3); var otok=tok(await r3.text());
// 5) форма
// Розумний розбір ПІБ: по-батькові як якір + суфікси прізвищ (щоб не плутати «Ім'я Прізвище» ↔ «Прізвище Ім'я»)
var _t=String(od.fullName||'').split(/\\s+/).filter(Boolean); var _patr='',_rest=[];
for(var _i=0;_i<_t.length;_i++){ if(!_patr && _t.length>=2 && /(ович|евич|йович|івна|ївна|инична|ічна)$/i.test(_t[_i])) _patr=_t[_i]; else _rest.push(_t[_i]); }
function _isSur(w){ return /(енко|ко|ук|юк|чук|ський|цький|ська|цька|ишин|ів|ова|єва|ов|ев|ін)$/i.test(w); }
var last='',first='';
if(_rest.length>=2){ if(_isSur(_rest[1])&&!_isSur(_rest[0])){ first=_rest[0]; last=_rest[1]; } else { last=_rest[0]; first=_rest[1]; } }
else if(_rest.length===1){ last=_rest[0]; }
if(_patr) first=(first?first+' ':'')+_patr;
var payType=((context.paymentInfo&&context.paymentInfo.method)==='full')?'2':'1';
var prepay=payType==='1'?'200':'0';
// send_data: пріоритет — валідована адреса НП (місто+відділення), інакше сирий ввід
var _np=context.np||{};
var send_data=_np.warehouse?((_np.city||od.city||'')+', '+_np.warehouse):((od.city||'')+', НП '+(od.branch||''));
var form='date='+new Date().toISOString().slice(0,10)+'&send_data='+encodeURIComponent(send_data)+'&offline_supplier_select='+encodeURIComponent(supId)+'&payment_type='+payType+'&person_first_name='+encodeURIComponent(first)+'&person_last_name='+encodeURIComponent(last)+'&person_phone='+encodeURIComponent(od.phone||'')+'&ttn=&comment='+encodeURIComponent('Замовлення '+(context.orderRef||''))+'&partial_prepayment='+prepay+'&sell='+(Number(prod.price)||0)+'&cost=0&item_select='+encodeURIComponent(pick.value)+'&is_permanent_client=on&csrfmiddlewaretoken='+encodeURIComponent(otok);
var summary='🧾 easydrop '+(dryRun?'(DRY-RUN)':'СТВОРЕНО')+':\\nПостачальник:'+supId+' | Товар: '+String(pick.text||'').slice(0,60)+'\\nОтримувач: '+last+' '+first+' '+(od.phone||'')+'\\nНП: '+send_data+' | оплата:'+(payType==='1'?'часткова 200':'повна');
if(dryRun) return { supplierOrderResult:summary+'\\n⚠️ DRY-RUN: НЕ відправлено (EASYDROP_DRY_RUN=1).', supplierOrderPayload:form };
var r4=await fetch(base+'/offline-supplier-order',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':ck(),'Referer':base+'/offline-supplier-order','Origin':base},body:form});
var okDone=(r4.status>=300&&r4.status<400&&/accepted/.test(r4.headers.get('location')||''));
return { supplierOrderResult:summary+(okDone?'\\n✅ Прийнято easydrop':'\\n❌ статус '+r4.status), supplierOrderStatus:okDone?'created':'error' };
`.trim();

// Нова Пошта: перевірка міста (+ дизамбіг області для «Шевченкове» тощо) і № відділення/поштомата.
// Без ключа NOVAPOSHTA_API_KEY — тихо пропускає (summary=''), воронка не ламається.
const NP_CHECK_CODE = `
var key=(keys.NOVAPOSHTA_API_KEY||'').trim();
var od=context.orderData||{};
var np=Object.assign({tries:0,summary:''}, context.np||{});
if(!key || !od.city){ np.checked=false; np.summary=''; return { np: np }; }
np.tries=(np.tries||0)+1;
async function npCall(model,method,props){ var r=await fetch('https://api.novaposhta.ua/v2.0/json/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:key,modelName:model,calledMethod:method,methodProperties:props})}); return await r.json().catch(function(){return{};}); }
function mkSummary(){ var s='📦 Доставка: '+(np.city||od.city)+(np.warehouse?(', '+np.warehouse):''); if(np.warn) s+='\\n⚠️ '+np.warn+' — напишіть, якщо треба поправити'; return s+'\\n'; }
try{
  var s=await npCall('Address','searchSettlements',{CityName:String(od.city),Limit:'20'});
  var addrs=(s.data&&s.data[0]&&s.data[0].Addresses)||[];
  if(!addrs.length){ np.checked=true; np.ask=(np.tries<2); np.city=od.city; np.warn='місто «'+od.city+'» не знайдено в Новій Пошті'; np.askMsg='Не знайшла населений пункт «'+od.city+'» у Новій Пошті 🤔 Підкажіть, будь ласка, точну назву міста/села (можна з областю).'; np.summary=mkSummary(); return { np: np }; }
  if(addrs.length>1){
    var reg=''; var mm=String((od.region||'')+' '+od.city).toLowerCase().match(/([а-яіїєґ']{4,})\\s*обл/i); if(mm) reg=mm[1];
    var narrow=reg?addrs.filter(function(a){return String(a.Present).toLowerCase().indexOf(reg)>=0;}):addrs;
    if(narrow.length===1){ addrs=narrow; }
    else {
      np.checked=true; np.ask=(np.tries<2); np.city=od.city;
      np.options=addrs.slice(0,6).map(function(a){return a.Present;});
      np.warn='кілька населених пунктів «'+od.city+'», уточніть область';
      np.askMsg='Щоб не помилитись із доставкою 🙂 у нас кілька населених пунктів «'+od.city+'». Підкажіть, будь ласка, область (або повну назву з районом).';
      np.summary=mkSummary(); return { np: np };
    }
  }
  var a=addrs[0]; np.checked=true; np.ask=false; np.city=a.Present; np.ref=a.DeliveryCity||a.Ref; np.warn=''; np.askMsg='';
  var bnum=(String(od.branch||'').match(/\\d+/)||[])[0];
  var wantP=/поштомат|термінал/i.test(String(od.branch||''));
  if(np.ref){
    var w=await npCall('Address','getWarehouses',{SettlementRef:np.ref,Limit:'1000'});
    var whs=(w.data)||[]; var hit=null;
    if(bnum){ hit=whs.filter(function(x){return String(x.Number)===String(bnum)&&(!wantP||x.CategoryOfWarehouse==='Postomat');})[0] || whs.filter(function(x){return String(x.Number)===String(bnum);})[0]; }
    if(hit){ np.warehouse=hit.Description; np.warehouseRef=hit.Ref; np.warehouseType=hit.CategoryOfWarehouse; }
    else if(bnum){ np.warehouse='№'+bnum; np.ask=(np.tries<2); np.warn=(wantP?'поштомат':'відділення')+' №'+bnum+' у місті «'+np.city+'» не знайдено'; np.askMsg='У місті «'+np.city+'» не знайшла '+(wantP?'поштомат':'відділення')+' №'+bnum+' 🤔 Перевірте, будь ласка, номер (можна написати «поштомат N» чи «відділення N»).'; }
    else { np.ask=(np.tries<2); np.warn='не вказано номер відділення/поштомата'; np.askMsg='Підкажіть, будь ласка, номер відділення або поштомата Нової Пошти 🙂'; }
  }
  np.summary=mkSummary(); return { np: np };
}catch(e){ np.checked=false; np.summary=''; np.warn='НП недоступна'; return { np: np }; }
`.trim();

function upsertNode(nodes, id, patch) {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) { nodes[i] = { ...nodes[i], ...patch, data: { ...(nodes[i].data || {}), ...(patch.data || {}) } }; return false; }
    nodes.push({ id, position: { x: 320, y: 3400 }, measured: { width: 260, height: 92 }, ...patch }); return true;
}
function removeNode(nodes, edges, id) {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) nodes.splice(i, 1);
    for (let k = edges.length - 1; k >= 0; k--) if (edges[k].source === id || edges[k].target === id) edges.splice(k, 1);
}
function setEdge(edges, source, target, sourceHandle) {
    // прибрати наявні ребра з цим source(+handle), тоді додати нове
    for (let k = edges.length - 1; k >= 0; k--) {
        if (edges[k].source === source && (sourceHandle ? edges[k].sourceHandle === sourceHandle : !edges[k].sourceHandle)) edges.splice(k, 1);
    }
    const id = 'e_' + source + '_' + target + (sourceHandle ? '_' + sourceHandle : '');
    if (!edges.find((e) => e.id === id)) edges.push({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
}

(async () => {
    const fd = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!fd) { console.error('flowDefinition не знайдено для', BOT_ID); process.exit(1); }
    const nodes = JSON.parse(JSON.stringify(fd.nodes));
    const edges = JSON.parse(JSON.stringify(fd.edges));
    const before = JSON.stringify({ nodes, edges });

    // ── Ф0 біла нода ──
    upsertNode(nodes, 'n_create', { type: 'notifyAdmin' });

    // ── Ф1 памʼять ──
    upsertNode(nodes, 'n_order_intent', { data: {
        messagesTemplate: '',
        systemPrompt: 'Товар: {{context.product.name}} — {{context.product.price}} грн. Клієнт уже визначився з товаром і кольором. НЕ вигадуй розміри, кількість, категорію чи характеристики, яких немає в даних вище (це НЕ взуття/одяг з розмірами, якщо цього нема в назві). Єдина задача — зрозуміти, чи готовий оформити замовлення.\nВідповідай МАКСИМУМ одним коротким реченням українською, без службових токенів.\nВАЖЛИВО: коротка відповідь на попереднє питання/нагадування («так», «да», «хочу», «оформляй», «+», «ок», «давайте») — це ГОТОВНІСТЬ, НЕ жарт. Дивись історію листування вище.\nЗАВЖДИ додай у json_output рівно один JSON: {"ready":"yes"} — якщо погоджується/підтверджує; {"ready":"no"} — якщо вагається чи відмовляється.\nНе згадуй сайтів, кошиків, посилань — оформлення веде цей чат.',
    } });
    upsertNode(nodes, 'n_size', { data: {
        systemPrompt: 'Ти — Оля, жива тепла продавчиня-консультантка GOVERLA. Українською, з турботою, доречні емодзі.\nТОВАР: {{context.product.name}} — {{context.product.price}} грн. {{context.product.desc}}. Кольори: {{context.product.colors}}.\nВАЖЛИВО: клієнта вже привітали і презентували товар — НЕ вітайся повторно і не дублюй презентацію. Одразу по суті.\nЦІЛЬ кроку: отримати ЗРІСТ (см) і ВАГУ (кг), щоб підібрати розмір.\nПРАВИЛА:\n1. Клієнт може написати як завгодно: «181 71», «зріст 181 вага 71», «мій ріст 181, 71 кг», «71кг 181см», «180/70». САМ визнач де зріст (150–210 см), де вага (40–160 кг).\n2. Якщо чогось бракує — тепло попроси саме це (напр.: «Підкажіть, будь ласка, ще вагу 🙂»). Пиши живо, не сухо.\n3. На питання про матеріал/ціну/доставку/колір — коротко відповідай з даних вище, тоді м’яко повертай до зросту/ваги.\n4. КОЛИ Є І ЗРІСТ, І ВАГА — поверни РІВНО один JSON у json_output: {"height": <см>, "weight": <кг>} і БІЛЬШЕ НІЧОГО (жодного тексту, НЕ називай і НЕ вгадуй розмір — його порахує система далі). Якщо клієнт сам наполіг на конкретному розмірі — додай "clothingSize".\n5b. Якщо клієнт ОДРАЗУ назвав готовий розмір (S/M/L/XL/XXL) без зросту/ваги — поверни РІВНО {"clothingSize":"<РОЗМІР>"} і більше нічого.\nНе вигадуй товарів/кольорів, яких нема вище.',
    } });
    // ack+контент дублі: n_pay_collect і n_collect працюють ТИХО (json-only), видиме — наступна нода
    upsertNode(nodes, 'n_pay_collect', { data: {
        systemPrompt: 'Клієнту показали 2 способи оплати (1 — часткова передоплата 200 грн, 2 — повна). Визнач вибір.\n«1»/«часткова»/«післяплата»/«наложка»/«200» → cod. «2»/«повна»/«передоплата»/«зараз»/«повністю» → full.\nПоверни ТІЛЬКИ json_output {"method":"cod"} або {"method":"full"} — БЕЗ видимого тексту (клієнту напише наступний крок). Інших способів не вигадуй.' } });
    upsertNode(nodes, 'n_collect', { data: {
        systemPrompt: 'Збери дані доставки Новою Поштою: ПІБ, ТЕЛЕФОН, МІСТО, № ВІДДІЛЕННЯ.\nЯкщо чогось бракує — тепло попроси саме це (коротко, з турботою).\nКоли у повідомленні є ВСІ 4 поля — НЕ перепитуй підтвердження, НЕ пиши видимого тексту, одразу поверни ТІЛЬКИ json_output {"fullName":"...","phone":"...","city":"...","branch":"..."} (подяку напише наступний крок). Не згадуй сайтів.' } });
    upsertNode(nodes, 'n_color', { data: {
        systemPrompt: 'Ти — жива продавчиня-консультантка GOVERLA. Товар: {{context.product.name}} ({{context.product.desc}}), ціна {{context.product.price}} грн. Веди діалог САМЕ про цей товар — НЕ вигадуй іншу категорію, розміри чи характеристики, яких немає в даних вище.\nКлієнт обирає КОЛІР. Доступні кольори: {{context.product.colors}}.\nВідповідай ОДНИМ завершеним коротким дружнім реченням (НЕ пиши обірваних вступів типу «Оформлюю...» — оформленням займуться наступні кроки). Пропонуй лише наявні кольори; якщо просять інший — скажи, які є. На питання про матеріал/ціну/доставку — коротко з даних вище, тоді повертай до вибору кольору.\nКоли клієнт назвав колір із наявних — підтверди колір і ЗАВЖДИ додай у json_output рівно один JSON: {"color":"<колір>"}. Жодних службових токенів.',
    } });
    upsertNode(nodes, 'n_pay_collect', { data: { messagesTemplate: '' } });
    // петля нагадування: після ненавʼязливого нагадування чекаємо відповідь у order_intent
    setEdge(edges, 'n_followup_msg', 'n_order_intent');

    // ── Ф2 orderRef у n_pay_amount ──
    upsertNode(nodes, 'n_pay_amount', { data: {
        code: "var method=(context.paymentInfo&&context.paymentInfo.method)||'cod'; var full=(context.product&&context.product.price)||0; var ref=String(context.orderRef||'').trim(); if(!ref){ ref=('GOV'+((Number((user&&user.telegramId)||0)).toString(36).slice(-4)+Date.now().toString(36).slice(-4))).toUpperCase(); } return { payAmount: method==='cod'?200:full, payLabel: method==='cod'?'передоплата 200 грн, решта при отриманні':'повна оплата', orderRef: ref };",
    } });

    // ── Ф2 ibanoplata create link ──
    upsertNode(nodes, 'n_iban_invoice', { type: 'connector', position: { x: 320, y: 3300 }, data: {
        label: '11. Створити посилання (ibanoplata)', connectorType: 'ibanoplata', action: 'create_invoice',
        amount: '{{context.payAmount}}', paymentPurpose: 'Оплата за товар {{context.orderRef}}', outputVar: 'context.ibanPayUrl',
    } });

    // ── Ф2 повідомлення з посиланням + реквізитами (замість заглушки, зводить осиротілі ноди) ──
    upsertNode(nodes, 'n_requisites', { type: 'message', data: {
        label: '11. Оплата: посилання + реквізити', variants: [], buttons: [[{ text: '💳 Оплатити онлайн', url: '{{context.ibanPayUrl}}' }]],
        text: 'Готово! 🎉 Оплатити можна двома способами:\n\n1️⃣ Кнопкою нижче — посилання на оплату за IBAN 👇\n\n2️⃣ Або вручну за реквізитами:\n' + FOP_NAME + '\nIBAN: ' + FOP_IBAN + '\nЄДРПОУ/ІПН: ' + FOP_CODE + '\n📌 У коментарі до платежу вкажіть: {{context.orderRef}}\n\nСума до оплати: {{context.payAmount}} грн ({{context.payLabel}}).\nПісля оплати надішліть, будь ласка, чек/скріншот або посилання на квитанцію 🙏',
    } });

    // ── Ф2 виписка Mono + звірка + гілки ──
    upsertNode(nodes, 'n_mono_fetch', { type: 'connector', position: { x: 320, y: 3760 }, data: {
        label: '12.7 Виписка Mono', connectorType: 'monobank', action: 'get_statement', windowHours: '48', outputVar: 'context.monoStatement',
    } });
    upsertNode(nodes, 'n_reconcile', { type: 'js', position: { x: 320, y: 3860 }, data: { label: '12.8 Звірка оплати', code: RECONCILE_CODE } });
    upsertNode(nodes, 'n_pay_status_cond', { type: 'condition', position: { x: 320, y: 3960 }, data: {
        label: '12.9 Оплату знайдено?', condition: "context.payStatus === 'confirmed'",
    } });
    upsertNode(nodes, 'n_mark_consumed', { type: 'connector', position: { x: 120, y: 4030 }, data: {
        label: '12.94 Зарахувати транзакцію (антидубль)', connectorType: 'monobank', action: 'mark_consumed', txId: '{{context.payTxId}}',
    } });
    upsertNode(nodes, 'n_del_invoice', { type: 'connector', position: { x: 120, y: 4130 }, data: {
        label: '12.95 Видалити посилання', connectorType: 'ibanoplata', action: 'delete_invoice', invoiceUid: '{{context.ibanInvoiceUid}}',
    } });
    upsertNode(nodes, 'n_pay_notfound_admin', { type: 'notifyAdmin', position: { x: 640, y: 4080 }, data: {
        label: '12.96 Не знайдено — сигнал', targetKey: 'ADMIN_TELEGRAM_ID',
        message: '⚠️ Клієнт каже, що оплатив, але оплату НЕ знайдено у виписці.\nКлієнт: {{user.username}} ({{context.senderName}})\nЗамовлення: {{context.orderRef}} | сума {{context.payAmount}} грн\nТовар: {{context.product.name}} / {{context.recommendedSize}} / {{context.colorChoice.color}}\nПеревір вручну.',
    } });
    upsertNode(nodes, 'n_pay_notfound_msg', { type: 'message', position: { x: 640, y: 4180 }, data: {
        label: '12.97 Клієнту: перевіряємо', text: 'Дякуємо! Перевіряємо оплату вручну — це може зайняти трохи часу. Щойно підтвердимо, одразу напишемо і оформимо відправку 🙏',
    } });

    // ── Постачальник: brewdrop (REST API, dry-run) ──
    upsertNode(nodes, 'n_supplier_cond', { type: 'condition', position: { x: 320, y: 4380 }, data: {
        label: '13.5 Постачальник brewdrop?', condition: "context.supplier && String(context.supplier).toLowerCase().indexOf('brewdrop') >= 0",
    } });
    upsertNode(nodes, 'n_supplier_order', { type: 'js', position: { x: 120, y: 4500 }, data: {
        label: '13.6 Замовлення постачальнику (brewdrop)', code: BREWDROP_ORDER_CODE,
    } });
    upsertNode(nodes, 'n_supplier_cond_ed', { type: 'condition', position: { x: 640, y: 4500 }, data: {
        label: '13.6b Постачальник easydrop/zahid?', condition: "context.supplier && /easydrop|zahid/i.test(String(context.supplier))",
    } });
    upsertNode(nodes, 'n_supplier_order_ed', { type: 'js', position: { x: 640, y: 4600 }, data: {
        label: '13.6c Замовлення постачальнику (easydrop)', code: EASYDROP_ORDER_CODE,
    } });
    upsertNode(nodes, 'n_supplier_notify', { type: 'notifyAdmin', position: { x: 120, y: 4650 }, data: {
        label: '13.7 Результат постачальнику → Telegram', targetKey: 'ADMIN_TELEGRAM_ID',
        message: '🏭 Постачальник (замовлення {{context.orderRef}}):\n{{context.supplierOrderResult}}',
    } });
    // ТТН клієнту (коли постачальник повернув накладну — бойовий режим)
    upsertNode(nodes, 'n_ttn_cond', { type: 'condition', position: { x: 120, y: 4700 }, data: {
        label: '13.8 Є ТТН?', condition: 'context.supplierTtn && String(context.supplierTtn).length > 3',
    } });
    upsertNode(nodes, 'n_ttn_client', { type: 'message', position: { x: 120, y: 4800 }, data: {
        label: '13.9 ТТН клієнту', variants: [], text:
        'Ваша посилка вже їде! 🚚 Номер накладної (ТТН): {{context.supplierTtn}}\nЗа ним зможете відстежити доставку на Новій Пошті 📦 Дякуємо за замовлення 💛' } });

    // ── ребра гілки оплати ──
    setEdge(edges, 'n_pay_amount', 'n_iban_invoice');
    setEdge(edges, 'n_iban_invoice', 'n_requisites');
    setEdge(edges, 'n_requisites', 'n_collect');
    // ── Нова Пошта: перевірка адреси між збором адреси і звіркою оплати ──
    upsertNode(nodes, 'n_np_check', { type: 'js', position: { x: 320, y: 3640 }, data: { label: '12.6 Нова Пошта: перевірка адреси', code: NP_CHECK_CODE } });
    upsertNode(nodes, 'n_np_gate', { type: 'condition', position: { x: 320, y: 3690 }, data: { label: '12.62 Уточнити область?', condition: 'context.np && context.np.ask === true' } });
    upsertNode(nodes, 'n_np_ask', { type: 'message', position: { x: 620, y: 3690 }, data: { label: '12.63 Уточнити адресу',
        variants: [], text: '{{context.np.askMsg}}' } });
    setEdge(edges, 'n_collect', 'n_np_check');
    setEdge(edges, 'n_np_check', 'n_np_gate');
    setEdge(edges, 'n_np_gate', 'n_np_ask', 'true');
    setEdge(edges, 'n_np_gate', 'n_mono_fetch', 'false');
    setEdge(edges, 'n_np_ask', 'n_collect');
    setEdge(edges, 'n_mono_fetch', 'n_reconcile');
    setEdge(edges, 'n_reconcile', 'n_pay_status_cond');
    setEdge(edges, 'n_pay_status_cond', 'n_mark_consumed', 'true');
    setEdge(edges, 'n_mark_consumed', 'n_del_invoice');
    setEdge(edges, 'n_del_invoice', 'n_crm_order');
    setEdge(edges, 'n_pay_status_cond', 'n_pay_notfound_admin', 'false');
    setEdge(edges, 'n_pay_notfound_admin', 'n_pay_notfound_msg');
    setEdge(edges, 'n_pay_notfound_msg', 'n_crm_order');
    // n_crm_order → n_create лишається; далі — гілка постачальника перед підтвердженням клієнту
    setEdge(edges, 'n_create', 'n_supplier_cond');
    setEdge(edges, 'n_supplier_cond', 'n_supplier_order', 'true');
    setEdge(edges, 'n_supplier_order', 'n_supplier_notify');
    setEdge(edges, 'n_supplier_notify', 'n_ttn_cond');
    setEdge(edges, 'n_ttn_cond', 'n_ttn_client', 'true');
    setEdge(edges, 'n_ttn_client', 'n_confirm');
    setEdge(edges, 'n_ttn_cond', 'n_confirm', 'false');
    // brewdrop? ні → easydrop? ні → одразу підтвердження
    setEdge(edges, 'n_supplier_cond', 'n_supplier_cond_ed', 'false');
    setEdge(edges, 'n_supplier_cond_ed', 'n_supplier_order_ed', 'true');
    setEdge(edges, 'n_supplier_order_ed', 'n_supplier_notify');
    setEdge(edges, 'n_supplier_cond_ed', 'n_confirm', 'false');
    // Прибрати дубль «Цей товар у наявності» з щасливого шляху (менше повідомлень підряд)
    setEdge(edges, 'n_avail_cond', 'n_upsell_cond', 'true');
    // Другий допродаж: n_confirm → чекаємо відповідь → фінал → нагадування (як було)
    setEdge(edges, 'n_confirm', 'n_upsell2_wait');
    setEdge(edges, 'n_upsell2_wait', 'n_final');
    setEdge(edges, 'n_final', 'n_followup_wait');

    // ── Оплата: додати текст про комісію пошти (побажання клієнта) ──
    upsertNode(nodes, 'n_pay', { data: { variants: [], text:
        'Клас, оформлюємо! 🎉 Оберіть спосіб оплати:\n\n1️⃣ Часткова передплата 200 грн, решта — накладним платежем (комісія пошти: 20 грн + 2% від суми).\n2️⃣ Повна передплата — оплата всієї суми зараз.\n\nНапишіть 1 або 2 👇' } });

    // ── Другий допродаж після оформлення (кроки 15-17 клієнта) ──
    upsertNode(nodes, 'n_confirm', { data: { variants: [], text:
        'Дякуємо за замовлення! 🎉 Номер накладної надішлемо в цей чат 📩\nПоки посилку не відправили — можете додати товар за спеціальною ціною. Акційні ціни діють лише зараз 🔥 Щось сподобалось — напишіть 😊' } });
    upsertNode(nodes, 'n_upsell2_wait', { type: 'claude', position: { x: 320, y: 4900 }, data: {
        label: '15. Другий допродаж — відповідь', mode: 'dialog', connectorId: '2ec53ba5-144e-463b-9758-c217c4a69b0e',
        temperature: 0.3, exitCondition: 'json_output', outputVar: 'context.upsell2',
        systemPrompt: 'Клієнт щойно оформив замовлення, і ти запропонував додати ще товар за акційною ціною. Це ОДНА відповідь — не веди довгий діалог.\nЯкщо цікавиться товаром — коротко тепло допоможи; якщо відмова — щиро подякуй за замовлення й побажай гарного дня.\nВідповідай ОДНИМ теплим реченням українською. ЗАВЖДИ додай у json_output рівно один JSON: {"done": true}. Жодних службових токенів.',
    } });
    upsertNode(nodes, 'n_final', { type: 'message', position: { x: 320, y: 5000 }, data: {
        label: '16. Замовлення прийняте', variants: [], text: 'Чудово, замовлення прийняте ✔️\nДякуємо, що обрали GOVERLA 🙌 Ми вже беремося за вашу посилку і триматимемо в курсі — номер накладної надішлемо сюди, щойно відправимо 📦\nГарного вам дня та чудового настрою! 🌟' } });

    // ── Тепліші, «дбайливіші» тексти + прибрати дубль «у наявності» ──
    upsertNode(nodes, 'n_welcome', { data: { variants: [], text:
        'Вітаємо у GOVERLA! 🙌 Дуже раді, що завітали 💛\nОсь ваш товар: {{context.product.name}} — лише {{context.product.price}} грн 🔥\n{{context.product.desc}}' } });
    upsertNode(nodes, 'n_size_reply', { data: { variants: [], text:
        'Дякую! 🙌 За вашими параметрами ідеально підійде розмір {{context.recommendedSize}} 📏 — сяде якраз, перевірено 👌' } });
    upsertNode(nodes, 'n_avail_no', { data: { variants: [], text:
        'Ой, саме цей варіант зараз розібрали 😔 Але не засмучуйтесь — підберемо не гірше! Напишіть, будь ласка, який ще колір розглядаєте, і я одразу перевірю наявність ✨' } });
    upsertNode(nodes, 'n_confirm', { data: { variants: [], text:
        'Дякуємо за замовлення — ви супер! 🎉 Ми вже його оформили 💛\n\n{{context.np.summary}}Номер накладної (ТТН) надішлемо прямо сюди, щойно передамо посилку Новій Пошті 📦\nА поки її не відправили — можна додати ще щось за акційною ціною (діє лише зараз 🔥). Якщо щось сподобалось — просто напишіть, залюбки допоможу 😊' } });

    // ── FAQ/RAG: консультант-ноди тягнуть відповіді з вектор-бази + low-confidence handoff ──
    upsertNode(nodes, 'n_size', { data: { useKb: true } });
    upsertNode(nodes, 'n_color', { data: { useKb: true } });
    upsertNode(nodes, 'n_order_intent', { data: { useKb: true } });

    // ── testMode-гард у KeyCRM-ноді: тестові прогони не створюють реальних замовлень ──
    const crm = nodes.find((n) => n.id === 'n_crm_order');
    if (crm && crm.data && crm.data.code && crm.data.code.indexOf('context.testMode') < 0) {
        crm.data.code = "if(context.testMode) return { crmOrderId:('TEST-'+Date.now()), orderSku:'', supplier:'' };\n" + crm.data.code;
    }

    // ── Ф5 прибрати осиротілі ноди реквізитів ──
    ['n_iban', 'n_edrpou', 'n_company', 'n_pay_instr'].forEach((id) => removeNode(nodes, edges, id));

    const after = JSON.stringify({ nodes, edges });
    console.log('nodes:', nodes.length, '| edges:', edges.length, '| змінено:', before !== after);
    console.log('payment branch:', edges.filter((e) => /n_pay_amount|n_iban_invoice|n_requisites|n_collect|n_mono_fetch|n_reconcile|n_pay_status_cond|n_del_invoice|n_pay_notfound/.test(e.source + e.target)).map((e) => `${e.source}-${e.sourceHandle || ''}->${e.target}`).join('\n  '));

    if (!APPLY) { console.log('\nDRY-RUN. Для запису: node patch-covercar-payments.js --apply'); process.exit(0); }

    // бекап + запис + ключі
    const fs = require('fs');
    fs.writeFileSync(`_backup_flow_${BOT_ID}_${Date.now()}.json`, JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes, edges } });
    const upKey = async (key, value, label, opts = {}) => {
        const ex = await db.funnelKey.findFirst({ where: { botId: BOT_ID, key } });
        if (ex) {
            // не затираємо вже заповнене значення (напр. токен, який ввів користувач)
            const data = {};
            if (!opts.keepValue || !ex.value) data.value = value;
            if (label != null) data.label = label;
            if (Object.keys(data).length) await db.funnelKey.update({ where: { id: ex.id }, data });
        } else {
            await db.funnelKey.create({ data: { botId: BOT_ID, key, value, label: label || null, isSecret: !!opts.isSecret } });
        }
    };
    await upKey('FOP_IBAN', FOP_IBAN, 'IBAN одержувача (ibanoplata/реквізити)');
    await upKey('FOP_CODE', FOP_CODE, 'ЄДРПОУ/ІПН одержувача');
    await upKey('FOP_NAME', FOP_NAME, 'Юр. назва / ФОП одержувача');
    await upKey('GEMINI_CONNECTOR_ID', GEMINI_CONNECTOR_ID, 'Gemini конектор (ШІ-візія для скрінів)');
    // Токени конекторів — заповнить користувач у ключах воронки (порожні плейсхолдери, не затираємо якщо вже є)
    await upKey('IBANOPLATA_API_KEY', '', 'IbanOplata API Key (X-Api-Key) — заповнити', { isSecret: true, keepValue: true });
    await upKey('MONO_TOKEN', '', 'Monobank ФОП X-Token — заповнити', { isSecret: true, keepValue: true });
    await upKey('MONO_ACCOUNT_ID', '0', 'ID рахунку Mono (дефолт 0)', { keepValue: true });
    // Прибрати instagram з каналів — бот працює через Zernio (прибирає хибну вимогу IG App-ключів)
    await upKey('FUNNEL_CHANNELS', '["zernio"]', 'Канали запуску воронки');
    await upKey('BREWDROP_DRY_RUN', '1', 'brewdrop: 1=тест (не відправляє замовлення), 0=бойовий', { keepValue: true });
    await upKey('EASYDROP_DRY_RUN', '1', 'easydrop: 1=тест, 0=бойовий', { keepValue: true });
    await upKey('EASYDROP_SUPPLIER_NAME', '', 'easydrop: назва постачальника лоферів (напр. zahid_drop) — для пошуку id', { keepValue: true });
    await upKey('NOVAPOSHTA_API_KEY', '', 'Нова Пошта: API-ключ (кабінет НП → Налаштування → Безпека → Ключі API). Порожній — перевірка адреси пропускається', { isSecret: true, keepValue: true });
    await upKey('VECTOR_URL', 'http://127.0.0.1:4500', 'Вектор-база (FAQ/скрипти)', { keepValue: true });
    await upKey('VECTOR_TOKEN', 'vec_ee2079ec29fedd3498ad1dc15684e84fbc10be413bfad4a1', 'Токен проєкту covercar FAQ у вектор-базі', { isSecret: true });
    console.log('✅ Записано + бекап збережено + ключі оновлено (канали: zernio).');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
