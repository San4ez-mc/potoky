// Дропшип-замовлення easydrop (каталог → кошик → адреса). Постачальники типу Zaxid_drop.
// Ланцюг (реверс 2026-08-19): login → /catalog-view/<sup>/<cat>/?search=<артикул>
//   → POST /change-api action=cart&item&size&qty → /select-address?type=warehouse (форма order-address-form).
// DRY-RUN за замовчуванням: доходить до кошика, показує дані й прибирає позицію; адресу НЕ відправляє.
if(context.testMode) return { supplierOrderResult:'(testMode: easydrop-кошик пропущено)' };
var base=(keys.EASYDROP_BASE||'https://easydrop.one').replace(/\/+$/,'');
var login=(keys.EASYDROP_LOGIN||'').trim(), pass=(keys.EASYDROP_PASS||'').trim();
var dryRun=String(keys.EASYDROP_CART_DRY_RUN||'1')!=='0';
if(!login||!pass) return { supplierOrderResult:'❌ EASYDROP_LOGIN/PASS не заповнено' };
var cfg=context.supplierCfg||{};
var supId=String(cfg.catalogId||keys.EASYDROP_CATALOG_ID||'').trim();
if(!supId) return { supplierOrderResult:'❌ не задано catalogId постачальника у SUPPLIER_CONFIG' };
var cats=(cfg.categories||String(keys.EASYDROP_CATEGORIES||'').split(',')).map(function(x){return String(x).trim();}).filter(Boolean);
if(!cats.length) return { supplierOrderResult:'❌ не задано categories постачальника у SUPPLIER_CONFIG' };
var cookies={};
function setCk(res){ try{ var sc=res.headers.getSetCookie?res.headers.getSetCookie():[]; for(var i=0;i<sc.length;i++){ var p=sc[i].split(';')[0]; var q=p.indexOf('='); if(q>0) cookies[p.slice(0,q)]=p.slice(q+1); } }catch(e){} }
function ck(){ return Object.keys(cookies).map(function(k){return k+'='+cookies[k];}).join('; '); }
function tok(h){ var m=String(h||'').match(/name="csrfmiddlewaretoken" value="([^"]+)"/); return m?m[1]:(cookies['csrftoken']||''); }
async function get(p){ return fetch(base+p,{headers:{'Cookie':ck(),'Referer':base+'/'}}); }
async function api(body,ref){ return fetch(base+'/change-api',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':ck(),'Referer':base+(ref||'/'),'Origin':base,'X-Requested-With':'XMLHttpRequest'},body:body}); }
// 1) логін
var r1=await fetch(base+'/login'); setCk(r1); var t1=tok(await r1.text());
var r2=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':ck(),'Referer':base+'/login','Origin':base},body:'csrfmiddlewaretoken='+encodeURIComponent(t1)+'&username='+encodeURIComponent(login)+'&password='+encodeURIComponent(pass)});
setCk(r2); var hash=((r2.headers.get('location')||'').match(/hash=(\d+)/)||[])[1];
if(hash){ cookies['manager_hash']=hash; cookies['uid']='u-'+hash; }
if(!cookies['sessionid']) return { supplierOrderResult:'❌ easydrop: логін не вдався', supplierOrderStatus:'error' };
// 2) знайти товар за артикулом у категоріях постачальника
var prod=context.product||{}, od=context.orderData||{};
var article=String(prod.supplierArticle||prod.article||prod.sku||context.orderSku||'').trim();
if(!article) return { supplierOrderResult:'❌ easydrop-кошик: немає артикулу товару', supplierOrderStatus:'error' };
var wantSize=String(context.recommendedSize||(context.sizeInput&&context.sizeInput.clothingSize)||'').replace(/[^0-9A-Za-zXL]/g,'');
var itemId=null, sizeId=null, sizeLabel='', foundCat='';
for(var ci=0; ci<cats.length && !itemId; ci++){
  var page=await (await get('/catalog-view/'+encodeURIComponent(supId)+'/'+encodeURIComponent(cats[ci])+'/?search='+encodeURIComponent(article)+'&item-text=&tags=')).text();
  var ai=page.indexOf("copyText('"+article+"')");
  if(ai<0) continue;
  foundCat=cats[ci];
  var head=page.slice(Math.max(0,ai-6000), ai);
  var gm=head.match(/showItemImageGallery\((\d+)\)(?![\s\S]*showItemImageGallery\()/);
  if(!gm) continue;
  itemId=gm[1];
  var tail=page.slice(ai, ai+9000), opts=[], m2;
  var re=new RegExp("setSize\\('"+itemId+"',\\s*'(\\d+)',\\s*'(True|False)'\\)[^>]*>\\s*([0-9A-Za-zXL.,]+)","g");
  while((m2=re.exec(tail))) opts.push({ id:m2[1], avail:m2[2]==='True', label:String(m2[3]).trim() });
  if(!opts.length){ var re2=new RegExp("setSize\\('"+itemId+"',\\s*'(\\d+)',\\s*'(True|False)'\\)","g"); while((m2=re2.exec(tail))) opts.push({ id:m2[1], avail:m2[2]==='True', label:'' }); }
  var hit=null;
  if(wantSize) hit=opts.filter(function(o){ return o.avail && String(o.label).replace(/[^0-9A-Za-zXL]/g,'')===wantSize; })[0];
  if(!hit) hit=opts.filter(function(o){ return o.avail; })[0];
  if(hit){ sizeId=hit.id; sizeLabel=hit.label; }
}
if(!itemId||!sizeId) return { supplierOrderResult:'❌ easydrop-кошик: товар «'+article+'»'+(wantSize?(' розмір '+wantSize):'')+' не знайдено у постачальника '+supId, supplierOrderStatus:'error' };
// 3) у кошик
var csrf=cookies['csrftoken']||'';
var addRes=await api('action=cart&item='+encodeURIComponent(itemId)+'&size='+encodeURIComponent(sizeId)+'&qty=1&csrfmiddlewaretoken='+encodeURIComponent(csrf), '/catalog-view/'+supId+'/'+foundCat+'/');
var addTxt=(await addRes.text()).trim();
if(addTxt!=='OK') return { supplierOrderResult:'❌ easydrop-кошик: не додалось у кошик ('+addRes.status+' '+addTxt.slice(0,80)+')', supplierOrderStatus:'error' };
// 4) підсумок + адреса
var parts=String(od.fullName||'').split(/\s+/).filter(Boolean);
var last=parts[0]||'', first=parts[1]||'';
var np=context.np||{};
var addrCity=np.city||od.city||'';
var addrWh=np.warehouse||('Відділення №'+(od.branch||''));
var summary='🧾 easydrop-кошик '+(dryRun?'(DRY-RUN)':'ОФОРМЛЕНО')+':\nПостачальник '+supId+' | артикул '+article+' (item '+itemId+') | розмір '+(sizeLabel||wantSize||'—')+'\nОтримувач: '+last+' '+first+' '+(od.phone||'')+'\nНП: '+addrCity+', '+addrWh;
if(dryRun){
  var cartPage=await (await get('/cart')).text();
  var lineIds=[], rl=/removeFromCart\('(\d+)'\)/g, mm;
  while((mm=rl.exec(cartPage))) if(lineIds.indexOf(mm[1])<0) lineIds.push(mm[1]);
  for(var li=0; li<lineIds.length; li++){ await api('action=cart-remove&item='+lineIds[li]+'&csrfmiddlewaretoken='+encodeURIComponent(csrf), '/cart').catch(function(){}); }
  return { supplierOrderResult:summary+'\n⚠️ DRY-RUN: додано в кошик і прибрано; адресу НЕ відправлено (EASYDROP_CART_DRY_RUN=1).', supplierOrderStatus:'dry_run' };
}
// Адресні поля мають бути ДОСЛІВНО з автокомпліту easydrop, інакше форма відбивається.
async function ac(url){ try{ var r=await get(url); var t=await r.text(); var j=JSON.parse(t); return Array.isArray(j)?j:[]; }catch(e){ return []; } }
var cityQ=String(addrCity).replace(/^[мсмт]+\.\s*/i,'').split(',')[0].split('|')[0].trim();
var cityOpts=await ac('/autocomplete/city/?q='+encodeURIComponent(cityQ));
var cityPick=cityOpts.filter(function(x){ return String(x).toLowerCase().indexOf(cityQ.toLowerCase())===0 || /^м\./i.test(String(x)); })[0]||cityOpts[0]||'';
var bnum2=(String(od.branch||'').match(/\d+/)||[])[0]||'';
var whOpts=await ac("/autocomplete/department/?q="+encodeURIComponent(cityQ+(bnum2?(" Відділення №"+bnum2):"")));
if(!whOpts.length) whOpts=await ac("/autocomplete/department/?q="+encodeURIComponent(cityQ));
var whPick=(bnum2?whOpts.filter(function(x){ return new RegExp('№\\s*'+bnum2+'(?!\\d)').test(String(x)); })[0]:null)||whOpts[0]||'';
if(!cityPick||!whPick) return { supplierOrderResult:summary+'\n❌ easydrop: не підібрав місто/відділення в автокомпліті (місто «'+cityQ+'», відділення №'+bnum2+')', supplierOrderStatus:'error', supplierNeedsManual:true };
var addrPage=await (await get('/select-address?type=warehouse')).text();
var atok=tok(addrPage);
var form='csrfmiddlewaretoken='+encodeURIComponent(atok)
  +'&template_pk=&edit='
  +'&person_first_name='+encodeURIComponent(first)
  +'&person_last_name='+encodeURIComponent(last)
  +'&person_phone='+encodeURIComponent(od.phone||'')
  +'&settlement_select='+encodeURIComponent(cityPick)
  +'&settlement_text='+encodeURIComponent(cityPick)
  +'&warehouse_select='+encodeURIComponent(whPick)
  +'&warehouse_text='+encodeURIComponent(whPick)
  +'&is_permanent_client=on';
summary+='\nАдреса easydrop: '+cityPick.trim()+' | '+whPick;
// Крок 5: адресу передають GET-ом на /order-data (prepareAddress у select_address.js), тоді
// фінальний POST multipart форми create-order-form з action=create (orderRequest у main.js).
var odUrl='/order-data?type=warehouse&'+form;
var odRes=await fetch(base+odUrl,{headers:{'Cookie':ck(),'Referer':base+'/select-address?type=warehouse'}});
setCk(odRes);
var odHtml=await odRes.text();
if(odRes.status>=400) return { supplierOrderResult:summary+'\n❌ /order-data HTTP '+odRes.status, supplierOrderStatus:'error', supplierNeedsManual:true };
var fm=odHtml.match(/<form[^>]*id="order-data-form"[\s\S]*?<\/form>/i);
var fhtml=fm?fm[0]:odHtml;
// збираємо поля форми як їх віддає сторінка
var fd=new FormData();
var seen={}, mi;
var ire=/<input[^>]*>/g;
while((mi=ire.exec(fhtml))){
  var tag=mi[0];
  var nm=(tag.match(/name="([^"]+)"/)||[])[1]; if(!nm||seen[nm]) continue;
  var ty=((tag.match(/type="([^"]+)"/)||[])[1]||'text').toLowerCase();
  if((ty==='checkbox'||ty==='radio') && !/checked/i.test(tag)) continue;
  var vl=(tag.match(/value="([^"]*)"/)||[])[1]||'';
  fd.append(nm, vl); seen[nm]=1;
}
var sre=/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/g, ms;
while((ms=sre.exec(fhtml))){
  if(seen[ms[1]]) continue;
  var sel=(ms[0].match(/<option[^>]*selected[^>]*value="([^"]*)"/)||ms[0].match(/<option[^>]*value="([^"]*)"/)||[])[1]||'';
  fd.append(ms[1], sel); seen[ms[1]]=1;
}
var tre=/<textarea[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g, mt;
while((mt=tre.exec(fhtml))){ if(seen[mt[1]]) continue; fd.append(mt[1], mt[2]||''); seen[mt[1]]=1; }
if(!seen['csrfmiddlewaretoken']) fd.append('csrfmiddlewaretoken', tok(odHtml)||cookies['csrftoken']||'');
// наші дані замовлення
fd.set('comment', 'Замовлення '+(context.orderRef||'')+' (бот)');
if(Number(prod.price)) fd.set('cost', String(Number(prod.price)));
// форма order-data-form сабмітиться як звичайний multipart-POST (кнопка «Підтвердити»)
var fin=await fetch(base+odUrl,{method:'POST',redirect:'manual',headers:{'Cookie':ck(),'Referer':base+odUrl,'Origin':base},body:fd});
var floc=fin.headers.get('location')||'';
var ftxt=(fin.status>=300&&fin.status<400)?'':(await fin.text()).slice(0,400);
// Успіх = 302 на список замовлень (звичайний submit форми) або 'orders_redirect' в AJAX-відповіді.
var ok=(fin.status>=300&&fin.status<400&&/order/i.test(floc))||/orders_redirect/i.test(ftxt);
return { supplierOrderResult:summary+(ok?('\n✅ Замовлення СТВОРЕНО в easydrop'+(floc?(' ('+floc+')'):'')):('\n❌ не створилось (HTTP '+fin.status+' '+floc+'): '+ftxt.replace(/\s+/g,' ').slice(0,150))), supplierOrderStatus:ok?'created':'error', supplierNeedsManual:!ok, supplierCartItem:itemId };
