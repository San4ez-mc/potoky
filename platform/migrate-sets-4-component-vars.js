/* n_set_apply: при виборі окремої позиції з набору підтягуємо ВЛАСНІ кольори/розміри
   компонента з KeyCRM (інакше товар успадковував кольори набору й бот питав неіснуючий колір). */
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);

const CODE = [
  "var ch=context.setPick||{}; var p=context.product||{};",
  "if(String(ch.setChoice)!=='item' || !ch.article) return { setMode:'set' };",
  "var it=(p.setItems||[]).filter(function(x){ return String(x.article).toUpperCase()===String(ch.article).toUpperCase(); })[0];",
  "if(!it) return { setMode:'set' };",
  "// власні варіації компонента (кольори/розміри/фото) — не успадковуємо від набору",
  "var token=(keys.KEYCRM_API_TOKEN||'').trim();",
  "var base=(keys.KEYCRM_API_BASE||'https://openapi.keycrm.app/v1').replace(/\\/$/,'');",
  "var colors=[], sizes=[], offers=[], img='', imgs=[];",
  "if(token){",
  "  try{",
  "    var ro=await fetch(base+'/offers?filter[product_id]='+encodeURIComponent(it.id)+'&limit=50',{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});",
  "    if(ro.ok){ var od=await ro.json(); var os=(od&&od.data)||[];",
  "      for(var i=0;i<os.length;i++){ var pr=os[i].properties||[]; offers.push({sku:os[i].sku,price:os[i].price,quantity:os[i].quantity,properties:pr});",
  "        for(var j=0;j<pr.length;j++){ var nm=String(pr[j].name||'').toLowerCase();",
  "          if(nm.indexOf('колір')>=0 && colors.indexOf(pr[j].value)<0) colors.push(pr[j].value);",
  "          if(nm.indexOf('розмір')>=0 && sizes.indexOf(pr[j].value)<0) sizes.push(pr[j].value); } }",
  "    }",
  "  }catch(e){}",
  "  try{",
  "    var rp=await fetch(base+'/products/'+encodeURIComponent(it.id),{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});",
  "    if(rp.ok){ var pd=await rp.json(); if(pd){ if(pd.thumbnail_url) imgs.push(pd.thumbnail_url);",
  "      var att=pd.attachments_data||[]; for(var a=0;a<att.length;a++){ var uu=(typeof att[a]==='string')?att[a]:(att[a]&&(att[a].url||att[a].src)); if(uu&&imgs.indexOf(uu)<0) imgs.push(uu); }",
  "      img=imgs[0]||''; } }",
  "  }catch(e){}",
  "}",
  "return { setMode:'item', setParent:{ id:p.id, name:p.name, price:p.price },",
  "  supplier: it.supplier||context.supplier,",
  "  colorChoice: null,",
  "  product: Object.assign({}, p, { id:it.id, name:it.name, price:it.price, sku:it.article, article:it.article,",
  "    supplier:it.supplier||'', isSet:false, setComponents:'', setItems:[], setList:'',",
  "    colors:colors.join(', '), colorsList:colors, sizes:sizes, offers:offers,",
  "    isClothing:sizes.length>0, photoUrl:img, imageUrls:imgs.slice(0,5), preColor:'', upsell:'' }) };",
].join(NL);

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const n = nodes.find(x => x.id === 'n_set_apply');
  if (!n) { console.log('❌ n_set_apply не знайдено'); process.exit(1); }
  try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){' + CODE + NL + '})();'); }
  catch (e) { console.log('❌ не компілюється:', e.message); process.exit(1); }
  n.data.code = CODE;
  console.log('✅ n_set_apply: компонент отримує власні кольори/розміри/фото з CRM');
  if (!APPLY) { console.log('DRY-RUN'); process.exit(0); }
  require('fs').writeFileSync('_backup_sets4_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
