const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const MATCH_ARTICLE = "function matchArticle(all,art){ if(!art)return null; var A=String(art).toUpperCase().trim(); for(var i=0;i<all.length;i++){ var p=all[i]; if(p.sku&&String(p.sku).toUpperCase().trim()===A)return p; var cf=p.custom_fields||[]; for(var j=0;j<cf.length;j++){ var v=cf[j]&&cf[j].value; if(v==null)continue; if(String(v).toUpperCase().split(/[\\s,;]+/).indexOf(A)>=0)return p; } } return null; }\n";
(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const n = nodes.find(x => x.id === 'n_lookup');
  if (!n) { console.log('n_lookup НЕМА'); process.exit(1); }
  let code = n.data.code;
  if (code.includes('matchArticle')) { console.log('вже містить matchArticle — пропуск'); process.exit(0); }
  const before = code;
  // вставити визначення matchArticle перед головним try{ var all=[]
  code = code.replace(/try\{\s*\n\s*var all=\[\];/, (m) => MATCH_ARTICLE + m);
  // артикул-матч: matchCT -> matchArticle (ad_id та DEFAULT лишаються на matchCT)
  code = code.replace('found=matchCT(all,article)', 'found=matchArticle(all,article)');
  if (code === before) { console.log('❌ анкери не знайдено — нічого не змінено'); process.exit(1); }
  const changedDef = code.includes('function matchArticle');
  const changedUse = code.includes('found=matchArticle(all,article)');
  console.log('вставлено визначення:', changedDef, '| замінено виклик:', changedUse);
  // компіляція
  try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){' + code + '\n})();'); console.log('compile OK'); }
  catch (e) { console.log('❌ compile FAIL:', e.message); process.exit(1); }
  if (!APPLY) { console.log('\nDRY-RUN. --apply щоб записати'); process.exit(0); }
  n.data.code = code;
  const fs = require('fs');
  fs.writeFileSync('_backup_nlookup_' + Date.now() + '.json', JSON.stringify({ code: before }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('✅ записано (бекап збережено)');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
