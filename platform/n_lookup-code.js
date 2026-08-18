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
  var found=null, via='', mk='', preColor='', preSize='';

  // ПРІОРИТЕТ 1: ad_id / post_id (клік із реклами)
  if(context.entryAd){ found=matchCT(all,String(context.entryAd)); if(found){ via='ad_id'; mk=String(context.entryAd); } }

  // ПРІОРИТЕТ 2: АРТИКУЛ (з опису поста + з тексту клієнта + adTitle)
  if(!found){
    var cands=extractArticles((context.sharedPost&&context.sharedPost.caption)||'')
      .concat(extractArticles(context.lastUserMessage||input||''))
      .concat(extractArticles(context.adTitle||''));
    var seen={},cc=[]; for(var ci=0;ci<cands.length;ci++){ if(!seen[cands[ci]]){seen[cands[ci]]=1;cc.push(cands[ci]);} } cc=cc.slice(0,8);
    // 2a) offer-SKU → товар + колір/розмір
    for(var a=0;a<cc.length&&!found;a++){
      try{ var orq=await fetch(base+'/offers?filter[sku]='+encodeURIComponent(cc[a])+'&limit=1',{headers:hdr()});
        if(orq.ok){ var oj=await orq.json(); var of=(oj.data||[])[0];
          if(of&&of.product_id){ var pr=null; for(var pi=0;pi<all.length;pi++){ if(String(all[pi].id)===String(of.product_id)){pr=all[pi];break;} }
            if(pr){ found=pr; via='offer:'+cc[a]; mk='art_'+cc[a];
              var ops=of.properties||[]; for(var oi=0;oi<ops.length;oi++){ var onm=String(ops[oi].name||'').toLowerCase(); if(onm.indexOf('колір')>=0)preColor=ops[oi].value; if(onm.indexOf('розмір')>=0)preSize=ops[oi].value; } } } } }catch(e){}
    }
    // 2b) артикул на рівні товару (sku / CT_1001 / будь-яке кастом-поле)
    if(!found){ for(var b=0;b<cc.length&&!found;b++){ var pm=matchArticle(all,cc[b]); if(pm){ found=pm; via='article:'+cc[b]; mk='art_'+cc[b]; } } }
  }

  // ПРІОРИТЕТ 3: media_id рілса — опційно (поле в CRM); наразі пропускаємо

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
  var result={ supplier:__sup, product:{ _source:'keycrm', supplier:__sup, setComponents:__set, isSet:!!__set, _matchKey:mk, _via:via, id:found.id, category_id:found.category_id, name:found.name||'Товар', desc:found.description||'', price:price, currency:found.currency_code||'UAH', photoUrl:img||'', imageUrls:imgs.slice(0,5), colors:colors.join(', '), colorsList:colors, sizes:sizes, offers:offers, upsell:upsell.join('; '), isClothing:sizes.length>0 } };
  if(preColor){ result.colorChoice={color:preColor,_pre:true}; result.product.preColor=preColor; }
  if(preSize){ result.product.preSize=preSize; }
  return result;
}catch(e){ return fallback(); }
