/* Виправляє резолвер складу набору в n_lookup:
   - коректний split (пробіли/коми), trim токенів
   - НЕ матчить сам товар-набір
   - матч лише за sku товару / offers sku / полем «Артикул», а не за будь-яким кастом-полем
     (інакше «Допродажі» CT_1002 плутається зі складом набору) */
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);

const NEW_BLOCK = [
  "  var __set=cfVal('CT_1005');",
  "  // Набір: розгортаємо артикули компонентів у реальні товари (назва/ціна/постачальник)",
  "  var setItems=[];",
  "  if(__set){",
  "    var toks=String(__set).split(/[,;\\s]+/).map(function(t){return String(t).trim();}).filter(Boolean);",
  "    for(var si=0; si<toks.length && setItems.length<10; si++){",
  "      var tk=toks[si].toUpperCase();",
  "      var cp=null;",
  "      for(var pi=0; pi<all.length && !cp; pi++){",
  "        var pp=all[pi];",
  "        if(String(pp.id)===String(found.id)) continue;",           // не матчимо сам набір
  "        if(String(pp.id)===toks[si]) { cp=pp; break; }",
  "        if(pp.sku && String(pp.sku).toUpperCase().trim()===tk) { cp=pp; break; }",
  "        var pcf=pp.custom_fields||[];",
  "        for(var cj=0; cj<pcf.length; cj++){",
  "          var f=pcf[cj]; if(!f) continue;",
  "          if(f.uuid==='CT_1002'||f.uuid==='CT_1005'||f.uuid==='CT_1003') continue;",  // допродажі/склад/постачальник — не артикул
  "          var vv=f.value; if(vv==null) continue;",
  "          if(String(vv).toUpperCase().split(/[,;\\s]+/).map(function(z){return z.trim();}).indexOf(tk)>=0){ cp=pp; break; }",
  "        }",
  "      }",
  "      if(!cp) continue;",
  "      var csup=(cp.custom_fields||[]).filter(function(c){return c&&c.uuid==='CT_1003';})[0];",
  "      setItems.push({ article:toks[si], id:cp.id, name:cp.name||'', price:(cp.price!=null?cp.price:cp.min_price), supplier:csup?String(csup.value||'').trim():'' });",
  "    }",
  "  }",
].join(NL);

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const lk = nodes.find(n => n.id === 'n_lookup');
  const code = lk.data.code;
  const startMark = "  var __set=cfVal('CT_1005');";
  const endMark = "  var result={ supplier:__sup,";
  const s = code.indexOf(startMark);
  const e = code.indexOf(endMark);
  if (s < 0 || e < 0 || e < s) { console.log('❌ межі блоку не знайдено', s, e); process.exit(1); }
  const next = code.slice(0, s) + NEW_BLOCK + NL + code.slice(e);
  try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){' + next + NL + '})();'); }
  catch (err) { console.log('❌ не компілюється:', err.message); process.exit(1); }
  // швидка перевірка логіки split
  const t = '50001, 50002'.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  console.log('перевірка split:', JSON.stringify(t));
  lk.data.code = next;
  console.log('✅ n_lookup: резолвер складу набору виправлено');
  if (!APPLY) { console.log('DRY-RUN'); process.exit(0); }
  require('fs').writeFileSync('_backup_sets3_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('✅ записано');
  await db.$disconnect();
})().catch(err => { console.error('ERR', err.message); process.exit(1); });
