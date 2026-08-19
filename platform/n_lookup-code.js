if (context.product && context.product._source === 'keycrm' && String(context.product._matchKey) === String(context.entryAd||context.__lk||'')) return {};
function fallback(){ var cat={}; try{cat=JSON.parse(keys.PRODUCT_CATALOG||'{}')}catch(e){} var p=cat[context.entryAd]; return p ? { product: p } : { product: null, productUnknown: true }; }
var token=(keys.KEYCRM_API_TOKEN||'').trim();
var base=(keys.KEYCRM_API_BASE||'https://openapi.keycrm.app/v1').replace(/\/$/,'');
var adField=(keys.KEYCRM_AD_FIELD||'CT_1001');
if(!token||token==='REPLACE_ME') return fallback();
function hdr(){ return {Authorization:'Bearer '+token,Accept:'application/json'}; }
// Кандидати-артикули: з префіксом (в т.ч. числові), буквено-цифрові (A0188), чисті числові (SKU 10001)
function extractArticles(txt){ if(!txt) return []; var s=String(txt); var out=[]; var m;
  var re1=/(?:артикул|арт\.?|art|код|sku|#|№)\s*[:#№.\-]?\s*([A-Za-zА-Яа-яІЇЄҐіїєґ]{0,5}\d{2,8})/gi; while((m=re1.exec(s))){ out.push(m[1].toUpperCase()); }
  var re2=/\b([A-Za-z]\d{3,6})\b/g; while((m=re2.exec(s))){ out.push(m[1].toUpperCase()); }
  var re3=/\b(\d{4,8})\b/g; while((m=re3.exec(s))){ out.push(m[1]); }
  var seen={},res=[]; for(var i=0;i<out.length;i++){ if(!seen[out[i]]){seen[out[i]]=1;res.push(out[i]);} } return res;
}
function matchCT(all,k){ if(!k)return null; for(var i=0;i<all.length;i++){ var cf=all[i].custom_fields||[]; var adv=null; for(var j=0;j<cf.length;j++){ if(cf[j]&&cf[j].uuid===adField)adv=cf[j].value; } if(adv!=null && String(adv).split(/[\s,;]+/).indexOf(String(k))>=0) return all[i]; } return null; }
function matchArticle(all,art){ if(!art)return null; var A=String(art).toUpperCase().trim(); for(var i=0;i<all.length;i++){ var p=all[i]; if(p.sku&&String(p.sku).toUpperCase().trim()===A)return p; var cf=p.custom_fields||[]; for(var j=0;j<cf.length;j++){ var v=cf[j]&&cf[j].value; if(v==null)continue; if(String(v).toUpperCase().split(/[\s,;]+/).indexOf(A)>=0)return p; } } return null; }
try{
  var all=[];
  for(var page=1;page<=10;page++){ var r=await fetch(base+'/products?include=customFields&limit=50&page='+page,{headers:hdr()}); if(!r.ok)break; var d=await r.json(); var items=(d&&d.data)||[]; for(var i=0;i<items.length;i++)all.push(items[i]); if(items.length<50)break; }
  var found=null, via='', mk='', preColor='', preSize='', preFromUser=false;

  // ПРІОРИТЕТ 1: ad_id / post_id (клік із реклами)
  if(context.entryAd){ found=matchCT(all,String(context.entryAd)); if(found){ via='ad_id'; mk=String(context.entryAd); } }

  // ПРІОРИТЕТ 2: АРТИКУЛ (з опису поста + з тексту клієнта + adTitle)
  if(!found){
    var fromUser=extractArticles(context.lastUserMessage||input||'');
    var cands=fromUser.concat(extractArticles((context.sharedPost&&context.sharedPost.caption)||'')).concat(extractArticles(context.adTitle||''));
    var seen={},cc=[]; for(var ci=0;ci<cands.length;ci++){ if(!seen[cands[ci]]){seen[cands[ci]]=1;cc.push(cands[ci]);} } cc=cc.slice(0,8);
    // 2a) offer-SKU → товар + колір/розмір
    for(var a=0;a<cc.length&&!found;a++){
      try{ var orq=await fetch(base+'/offers?filter[sku]='+encodeURIComponent(cc[a])+'&limit=1',{headers:hdr()});
        if(orq.ok){ var oj=await orq.json(); var of=(oj.data||[])[0];
          if(of&&of.product_id){ var pr=null; for(var pi=0;pi<all.length;pi++){ if(String(all[pi].id)===String(of.product_id)){pr=all[pi];break;} }
            if(pr){ found=pr; via='offer:'+cc[a]; mk='art_'+cc[a]; preFromUser=(fromUser.indexOf(cc[a])>=0); preFromUser=(fromUser.indexOf(cc[a])>=0); preFromUser=(fromUser.indexOf(cc[a])>=0); preFromUser=(fromUser.indexOf(cc[a])>=0); preFromUser=(fromUser.indexOf(cc[a])>=0); preFromUser=(fromUser.indexOf(cc[a])>=0); preFromUser=(fromUser.indexOf(cc[a])>=0); preFromUser=(fromUser.indexOf(cc[a])>=0);
              var ops=of.properties||[]; for(var oi=0;oi<ops.length;oi++){ var onm=String(ops[oi].name||'').toLowerCase(); if(onm.indexOf('колір')>=0)preColor=ops[oi].value; if(onm.indexOf('розмір')>=0)preSize=ops[oi].value; } } } } }catch(e){}
    }
    // 2b) артикул на рівні товару (sku / CT_1001 / будь-яке кастом-поле)
    if(!found){ for(var b=0;b<cc.length&&!found;b++){ var pm=matchArticle(all,cc[b]); if(pm){ found=pm; via='article:'+cc[b]; mk='art_'+cc[b]; } } }
  }

  // ПРІОРИТЕТ 3: media_id рілса — опційно (поле в CRM); наразі пропускаємо

  // ПРІОРІТЕТ 2.9: клієнт кинув СКРІН товару замість поста/рілс — ШІ-візія (Gemini)
  // проти каталогу KeyCRM. На цьому кроці ще немає orderRef/оплати, тож будь-яке
  // вхідне фото тут — майже напевно спроба показати товар, не квитанція.
  if(!found && context.lastUserImageUrl && keys.GEMINI_API_KEY){
    function imgOk(u){ try{ var h=new URL(u).hostname.toLowerCase(); if(h==='api.telegram.org') return true; return ['cdninstagram.com','fbcdn.net','fbsbx.com','lookaside.fbsbx.com'].some(function(d){return h===d||h.endsWith('.'+d);}); }catch(e){return false;} }
    if(imgOk(context.lastUserImageUrl)){
      var acp=new AbortController(); var top=setTimeout(function(){try{acp.abort();}catch(e){}},10000);
      try{
        var irp=await fetch(context.lastUserImageUrl,{signal:acp.signal});
        var abp=await irp.arrayBuffer();
        if(abp.byteLength<=8000000){
          var b64p=Buffer.from(abp).toString('base64');
          var mimep=(irp.headers.get('content-type')||'image/jpeg').split(';')[0];
          var catList=all.map(function(p,i){return i+': '+(p.name||'');}).join('\n').slice(0,6000);
          var promptp='Це скріншот, який клієнт надіслав замість посту/рілс — ймовірно, товар з нашого магазину. Опиши коротко, що на фото (тип товару, колір, помітний текст/бренд). Потім знайди НАЙБЛИЖЧИЙ відповідник у каталозі нижче (формат: індекс: назва). Якщо жодного релевантного немає — bestMatchIndex null. Поверни ЛИШЕ JSON {"description":"...","bestMatchIndex":число_або_null}.\nКаталог:\n'+catList;
          var grp=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key='+encodeURIComponent(keys.GEMINI_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:promptp},{inline_data:{mime_type:mimep,data:b64p}}]}]})});
          var gjp=await grp.json();
          var tp=((((gjp.candidates||[])[0]||{}).content||{}).parts||[{}])[0].text||'';
          var mmp=tp.match(/\{[\s\S]*\}/);
          if(mmp){ var fp=JSON.parse(mmp[0]); if(fp.bestMatchIndex!=null && all[fp.bestMatchIndex]){ found=all[fp.bestMatchIndex]; via='photo'; mk='photo_'+fp.bestMatchIndex; } }
        }
      }catch(e){} finally{ clearTimeout(top); }
    }
  }

  // ОСТАННІЙ РЕЗЕРВ: DEFAULT_AD_ID (зараз порожній)
  if(!found){ var dk=(keys.DEFAULT_AD_ID||'').trim(); if(dk){ found=matchCT(all,dk); if(found){ via='default'; mk='def_'+dk; } } }

  if(!found) return fallback();

  var sizes=[],colors=[],offers=[];
  var ro=await fetch(base+'/offers?filter[product_id]='+found.id+'&limit=50',{headers:hdr()});
  if(ro.ok){ var od2=await ro.json(); var os=(od2&&od2.data)||[]; for(var k=0;k<os.length;k++){ var pr2=os[k].properties||[]; offers.push({sku:os[k].sku,price:os[k].price,quantity:os[k].quantity,properties:pr2}); for(var mm=0;mm<pr2.length;mm++){ var nm=String(pr2[mm].name||'').toLowerCase(); if(nm.indexOf('розмір')>=0&&sizes.indexOf(pr2[mm].value)<0)sizes.push(pr2[mm].value); if(nm.indexOf('колір')>=0&&colors.indexOf(pr2[mm].value)<0)colors.push(pr2[mm].value); } } }
  var upsell=[]; function upname(prod){ var up=(prod.price!=null?prod.price:prod.min_price); return prod.name+(up?(' — '+up+' грн'):''); } function findByToken(tok){ tok=String(tok).trim(); if(!tok)return null; for(var i=0;i<all.length;i++){ var pp=all[i]; if(String(pp.id)===tok) return pp; var cf=pp.custom_fields||[]; for(var j=0;j<cf.length;j++){ if(cf[j]&&cf[j].uuid==='CT_1001'&&String(cf[j].value||'').split(/[\s,;]+/).indexOf(tok)>=0) return pp; } } return null; } var scf=(found.custom_fields||[]).find(function(c){return c&&/супутн|допродаж/i.test(c.name||'');}); if(scf&&scf.value){ var stoks=String(scf.value).split(/[\s,;]+/); for(var t=0;t<stoks.length&&upsell.length<3;t++){ var pp2=findByToken(stoks[t]); if(pp2&&pp2.id!==found.id) upsell.push(upname(pp2)); } }
  var imgs=[]; if(found.thumbnail_url)imgs.push(found.thumbnail_url); var adx=found.attachments_data||[]; for(var x=0;x<adx.length;x++){ var uu=(typeof adx[x]==='string')?adx[x]:(adx[x]&&(adx[x].url||adx[x].src)); if(uu&&imgs.indexOf(uu)<0)imgs.push(uu); } var img=imgs[0]||'';
  var price=(found.price!=null?found.price:found.min_price);
  function cfVal(u){ var f=(found.custom_fields||[]).find(function(c){return c&&c.uuid===u;}); return f?String(f.value||'').trim():''; }
  var __sup=cfVal('CT_1003');
  var __set=cfVal('CT_1005');
  // Набір: розгортаємо артикули компонентів у реальні товари (назва/ціна/постачальник)
  var setItems=[];
  if(__set){
    var toks=String(__set).split(/[,;\s]+/).map(function(t){return String(t).trim();}).filter(Boolean);
    for(var si=0; si<toks.length && setItems.length<10; si++){
      var tk=toks[si].toUpperCase();
      var cp=null;
      for(var pi=0; pi<all.length && !cp; pi++){
        var pp=all[pi];
        if(String(pp.id)===String(found.id)) continue;
        if(String(pp.id)===toks[si]) { cp=pp; break; }
        if(pp.sku && String(pp.sku).toUpperCase().trim()===tk) { cp=pp; break; }
        var pcf=pp.custom_fields||[];
        for(var cj=0; cj<pcf.length; cj++){
          var f=pcf[cj]; if(!f) continue;
          if(f.uuid==='CT_1002'||f.uuid==='CT_1005'||f.uuid==='CT_1003') continue;
          var vv=f.value; if(vv==null) continue;
          if(String(vv).toUpperCase().split(/[,;\s]+/).map(function(z){return z.trim();}).indexOf(tk)>=0){ cp=pp; break; }
        }
      }
      if(!cp) continue;
      var csup=(cp.custom_fields||[]).filter(function(c){return c&&c.uuid==='CT_1003';})[0];
      setItems.push({ article:toks[si], id:cp.id, name:cp.name||'', price:(cp.price!=null?cp.price:cp.min_price), supplier:csup?String(csup.value||'').trim():'' });
    }
  }
  var result={ supplier:__sup, product:{ _source:'keycrm', supplier:__sup, setComponents:__set, isSet:!!__set, setItems:setItems, setList:setItems.map(function(x){return x.name+(x.price?(" — "+x.price+" грн"):"")+" [арт. "+x.article+"]";}).join("; "), _matchKey:mk, _via:via, id:found.id, category_id:found.category_id, name:found.name||'Товар', desc:found.description||'', price:price, currency:found.currency_code||'UAH', photoUrl:img||'', imageUrls:imgs.slice(0,5), colors:colors.join(', '), colorsList:colors, sizes:sizes, offers:offers, upsell:upsell.join('; '), isClothing:sizes.length>0 } };
  // Колір автопідставляємо ТІЛЬКИ якщо клієнт САМ написав артикул (а не з опису поста):
  if(preColor && preFromUser){ result.colorChoice={color:preColor,_pre:true}; }
  if(preColor) result.product.preColor=preColor;
  if(preSize){ result.product.preSize=preSize; }
  return result;
}catch(e){ return fallback(); }
