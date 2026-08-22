// Застосовує оновлений n_lookup-code.js (supplierArticle/qtyPrices з CT_1006-1009)
// + easydrop-cart-code.js (фолбек без суфіксу кольору) + brewdrop-supplier-code.js
// (той самий фолбек) до covercar_ua і goverla_shop.
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const db = new PrismaClient();
const BOTS = ['cc03657f-9e72-46e5-a16d-88826e70c2ee', '5bdb3e38-1936-416f-b1f0-8f1125583193'];
const APPLY = process.argv.includes('--apply');

const NLOOKUP_CODE = fs.readFileSync(__dirname + '/n_lookup-code.js', 'utf8');
const EASYDROP_CODE = fs.readFileSync(__dirname + '/easydrop-cart-code.js', 'utf8');
const BREWDROP_CODE = fs.readFileSync(__dirname + '/brewdrop-supplier-code.js', 'utf8');

function compiles(code) { try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){' + code + '\n})();'); return true; } catch (e) { return e.message; } }

(async () => {
  for (const c of [['n_lookup-code.js', NLOOKUP_CODE], ['easydrop-cart-code.js', EASYDROP_CODE], ['brewdrop-supplier-code.js', BREWDROP_CODE]]) {
    const r = compiles(c[1]);
    if (r !== true) { console.log('❌', c[0], 'FAIL:', r); process.exit(1); }
  }

  for (const BOT of BOTS) {
    const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!fd) { console.log('❌ бот не знайдено:', BOT); continue; }
    const nodes = JSON.parse(JSON.stringify(fd.nodes));
    const nLookup = nodes.find((x) => x.id === 'n_lookup');
    const nEasydrop = nodes.find((x) => x.id === 'n_supplier_order_ed');
    const nBrewdrop = nodes.find((x) => x.id === 'n_supplier_order');

    console.log(`\n--- ${BOT} ---`);
    if (nLookup) { nLookup.data.code = NLOOKUP_CODE; console.log('✅ n_lookup оновлено'); }
    else console.log('⚠️ n_lookup не знайдено');
    if (nEasydrop) { nEasydrop.data.code = EASYDROP_CODE; console.log('✅ n_supplier_order_ed (easydrop) оновлено'); }
    else console.log('⚠️ n_supplier_order_ed не знайдено');
    if (nBrewdrop) { nBrewdrop.data.code = BREWDROP_CODE; console.log('✅ n_supplier_order (brewdrop) оновлено'); }
    else console.log('⚠️ n_supplier_order не знайдено');

    if (!APPLY) continue;
    fs.writeFileSync('_backup_supplierfallback_' + BOT.slice(0, 8) + '_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
    await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  }

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
