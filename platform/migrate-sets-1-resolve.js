const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const ANCHOR = "  var __set=cfVal('CT_1005');";
const INJECT = `  var __set=cfVal('CT_1005');
  // Набір: розгортаємо артикули компонентів у реальні товари (назва/ціна/постачальник)
  var setItems=[];
  if(__set){
    var toks=String(__set).split(/[\s,;]+/).filter(Boolean);
    for(var si=0; si<toks.length && setItems.length<10; si++){
      var tk=String(toks[si]).toUpperCase();
      var cp=null;
      for(var pi=0; pi<all.length && !cp; pi++){
        var pp=all[pi];
        if(String(pp.id)===toks[si]) { cp=pp; break; }
        if(pp.sku && String(pp.sku).toUpperCase()===tk) { cp=pp; break; }
        var pcf=pp.custom_fields||[];
        for(var cj=0; cj<pcf.length; cj++){ var vv=pcf[cj]&&pcf[cj].value; if(vv!=null && String(vv).toUpperCase().split(/[\s,;]+/).indexOf(tk)>=0){ cp=pp; break; } }
      }
      if(!cp) continue;
      var csup=(cp.custom_fields||[]).find(function(c){return c&&c.uuid==='CT_1003';});
      setItems.push({ article:toks[si], id:cp.id, name:cp.name||'', price:(cp.price!=null?cp.price:cp.min_price), supplier:csup?String(csup.value||'').trim():'' });
    }
  }`;
(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const lk = nodes.find(n => n.id === 'n_lookup');
  let code = lk.data.code;
  if (code.includes('setItems')) { console.log('• n_lookup вже розгортає набір'); }
  else {
    if (!code.includes(ANCHOR)) { console.log('❌ anchor не знайдено'); process.exit(1); }
    code = code.replace(ANCHOR, INJECT);
    code = code.replace('setComponents:__set, isSet:!!__set,', 'setComponents:__set, isSet:!!__set, setItems:setItems, setList:setItems.map(function(x){return x.name+(x.price?(" — "+x.price+" грн"):"")+" [арт. "+x.article+"]";}).join("; "),');
    try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){'+code+'\n})();'); }
    catch (e) { console.log('❌ не компілюється:', e.message); process.exit(1); }
    lk.data.code = code;
    console.log('✅ n_lookup: набір розгортається у product.setItems + setList');
  }
  if (!APPLY) { console.log('DRY-RUN'); process.exit(0); }
  require('fs').writeFileSync('_backup_sets1_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
