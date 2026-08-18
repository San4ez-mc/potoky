const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const TEST = process.argv.includes('--test');
const CODE = fs.readFileSync(__dirname + '/nlookup_new.js', 'utf8');
function makeFn(code) { return new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto', 'return (async function(){' + code + '\n})();'); }
(async () => {
  const rows = await db.funnelKey.findMany({ where: { botId: BOT }, select: { key: true, value: true } });
  const keys = Object.fromEntries(rows.map(r => [r.key, r.value || '']));
  const fn = makeFn(CODE);
  console.log('COMPILE OK, len', CODE.length);
  if (TEST) {
    const scenarios = [
      { name: 'артикул 40003 в описі', context: { sharedPost: { caption: 'Преміальні накидки. Артикул: 40003' } } },
      { name: 'offer-sku 10001 текстом', context: { lastUserMessage: 'хочу код 10001' } },
      { name: 'ad_id клік', context: { entryAd: '120248791125170372' } },
      { name: 'без артикула (unknown)', context: { sharedPost: { caption: 'Просто гарні накидки, хочу замовити' } } },
    ];
    for (const sc of scenarios) {
      try {
        const res = await makeFn(CODE)(sc.context, {}, {}, '', keys, fetch, Buffer, FormData, Blob, console, crypto);
        const p = res && res.product;
        console.log('\n▶', sc.name, '→', p ? ('#' + p.id + ' «' + p.name + '» via=' + p._via + ' colors=[' + (p.colors || '') + '] preColor=' + (p.preColor || '—') + ' set=' + (p.setComponents || '—')) : (res && res.productUnknown ? 'НЕ ЗНАЙДЕНО (productUnknown)' : JSON.stringify(res)));
        if (res && res.colorChoice) console.log('   передвибір кольору:', JSON.stringify(res.colorChoice));
      } catch (e) { console.log('▶', sc.name, 'ERR', e.message); }
    }
    process.exit(0);
  }
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const lk = nodes.find(n => n.id === 'n_lookup');
  lk.data.code = CODE;
  if (!APPLY) { console.log('DRY-RUN. --test щоб прогнати, --apply щоб записати'); process.exit(0); }
  fs.writeFileSync('_backup_matcher_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('✅ n_lookup оновлено');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
