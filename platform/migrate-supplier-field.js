const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
function compiles(code) { try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){' + code + '\n})();'); return true; } catch (e) { return e.message; } }
(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const lk = nodes.find(n => n.id === 'n_lookup');
  const cr = nodes.find(n => n.id === 'n_crm_order');
  let changed = 0;

  // 1) n_lookup: витягти CT_1003 → product.supplier + context.supplier
  let lc = lk.data.code;
  if (!lc.includes('CT_1003')) {
    const anchor = "return { product:{ _source:'keycrm',";
    const inject = "var __sup=(found.custom_fields||[]).find(function(c){return c&&c.uuid==='CT_1003';}); __sup=__sup?String(__sup.value||'').trim():'';\n  return { supplier:__sup, product:{ _source:'keycrm', supplier:__sup,";
    if (lc.indexOf(anchor) < 0) { console.log('❌ n_lookup: anchor не знайдено'); process.exit(1); }
    lc = lc.replace(anchor, inject);
    const c = compiles(lc); if (c !== true) { console.log('❌ n_lookup не компілюється:', c); process.exit(1); }
    lk.data.code = lc; changed++;
    console.log('✅ n_lookup: додано CT_1003 → supplier');
  } else console.log('• n_lookup вже має CT_1003');

  // 2) n_crm_order: пріоритет product.supplier над SUPPLIER_MAP
  let cc = cr.data.code;
  const old = "var supplier=smap[String(p.id)]";
  if (cc.includes(old) && !cc.includes('(p.supplier||')) {
    cc = cc.replace(old, "var supplier=(p.supplier||'').trim()||(context.supplier||'').trim()||smap[String(p.id)]");
    const c = compiles(cc); if (c !== true) { console.log('❌ n_crm_order не компілюється:', c); process.exit(1); }
    cr.data.code = cc; changed++;
    console.log('✅ n_crm_order: пріоритет product.supplier');
  } else console.log('• n_crm_order вже оновлено або anchor інший');

  if (!APPLY) { console.log('\nDRY-RUN (' + changed + ' змін). --apply щоб записати'); process.exit(0); }
  const fs = require('fs');
  fs.writeFileSync('_backup_supplier_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('\n✅ записано (' + changed + ' змін, бекап збережено)');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
