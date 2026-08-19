const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);

const SET_PROMPT = [
  'Ти — {{env.PERSONA_NAME}}, тепла продавчиня {{env.SHOP_TAG}}. Клієнт цікавиться КОМПЛЕКТОМ: {{context.product.name}} — {{context.product.price}} грн (фіксована ціна за весь набір).',
  'Склад комплекту: {{context.product.setList}}',
  'Кольори, доступні для цього комплекту: {{context.product.colors}}.',
  '',
  'ЗАДАЧА: зʼясувати, клієнт бере ВЕСЬ КОМПЛЕКТ чи ОКРЕМУ ПОЗИЦІЮ з нього.',
  'Коротко назви, що входить у комплект і його ціну, і спитай: «Берете весь комплект чи окрему річ?» 🙂',
  'На питання про склад/ціну/кольори/матеріал/доставку — ЗАВЖДИ коротко відповідай з даних вище (кольори теж є вище!), тоді знову м’яко став питання «весь комплект чи окрема річ».',
  'На звичайні запитання про ЦЕЙ товар НІКОЛИ не клич менеджера — відповідай з даних вище.',
  '',
  'ЯКЩО КЛІЄНТ ПРОСИТЬ ЖИВУ ЛЮДИНУ/МЕНЕДЖЕРА (навіть натяком: «хочу з людиною», «покличте оператора», «ви бот?») — одразу поверни json_output {"handoff":true}.',
  'ЯКЩО питання СПРАВДІ поза твоїми даними (гарантія, доставка за кордон, нестандартна оплата, знижки, претензія, скарга) — поверни json_output {"handoff":true}.',
  '',
  'json_output (СУВОРО):',
  '- Весь комплект → рівно {"setChoice":"set"}',
  '- Окрема позиція (клієнт назвав, яку саме) → рівно {"setChoice":"item","article":"<артикул цієї позиції зі складу вище>"}',
  '- Ще не визначився / просто питання (не з переліку вище) — БЕЗ json, тільки текст із питанням.',
  'Не вигадуй позицій, яких немає у складі комплекту.',
  'ЗАВЖДИ закінчуй повідомлення питанням або чітким наступним кроком — ніколи просто похвалою.',
].join(NL);

// Джерело істини для n_set_apply — migrate-sets-4-component-vars.js (компонент
// тягне ВЛАСНІ кольори/розміри/фото з CRM, не успадковує від набору). Тримаємо
// тут ІДЕНТИЧНИЙ код, щоб повторний запуск цього файлу не відкочував той фікс
// (сталось 2026-08-19: перезапуск цього скрипта для промпту стер sets-4 фікс).
const APPLY_CODE = [
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

const ROUTE_CODE = [
  "var cfg={}; try{cfg=JSON.parse(keys.SUPPLIER_CONFIG||'{}')}catch(e){}",
  "var sup=String(context.supplier||'').trim();",
  "function pick(){ if(!sup) return null; if(cfg[sup]) return cfg[sup]; var lo=sup.toLowerCase(); for(var k in cfg){ if(String(k).toLowerCase()===lo) return cfg[k]; } for(var k2 in cfg){ if(lo.indexOf(String(k2).toLowerCase())>=0) return cfg[k2]; } return null; }",
  "var c=pick()||{};",
  "var mech=String(c.mechanism||'').trim();",
  "if(!mech){ var lo2=sup.toLowerCase(); mech = lo2.indexOf('brewdrop')>=0 ? 'brewdrop' : (/easydrop|zahid|zaxid/.test(lo2) ? 'easydrop_offline' : 'manual'); }",
  "// Комплект: компоненти можуть бути від РІЗНИХ постачальників -> менеджеру йде розкладка",
  "var items=(context.product&&context.product.setItems)||[];",
  "if(context.setMode==='set' && items.length){",
  "  var br=items.map(function(x){ return '- '+x.name+' (арт. '+x.article+') -> '+(x.supplier||'постачальник не вказаний'); }).join(String.fromCharCode(10));",
  "  return { supplierMechanism:'manual', supplierCfg:c, supplierSetBreakdown:br };",
  "}",
  "return { supplierMechanism: mech, supplierCfg: c, supplierSetBreakdown:'' };",
].join(NL);

function compiles(code) { try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){' + code + NL + '})();'); return true; } catch (e) { return e.message; } }

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const edges = JSON.parse(JSON.stringify(fd.edges));
  const w = nodes.find(n => n.id === 'n_welcome');
  const pos = (w && w.position) || { x: 0, y: 800 };
  const up = (id, obj) => { const i = nodes.findIndex(n => n.id === id); if (i >= 0) nodes[i] = { ...nodes[i], ...obj, data: { ...(nodes[i].data || {}), ...(obj.data || {}) } }; else nodes.push({ id, ...obj }); };

  const c1 = compiles(APPLY_CODE); if (c1 !== true) { console.log('APPLY_CODE FAIL:', c1); process.exit(1); }
  const c2 = compiles(ROUTE_CODE); if (c2 !== true) { console.log('ROUTE_CODE FAIL:', c2); process.exit(1); }

  up('n_is_set', { type: 'condition', position: { x: pos.x, y: pos.y + 100 }, data: { label: '2.0a Це комплект?', condition: 'context.product && context.product.isSet === true' } });
  up('n_set_choice', { type: 'claude', position: { x: pos.x + 350, y: pos.y + 100 }, data: {
    label: '2.0b Комплект чи окрема річ?', mode: 'dialog', connectorId: '2ec53ba5-144e-463b-9758-c217c4a69b0e',
    temperature: 0.3, exitCondition: 'json_output', outputVar: 'context.setPick', useKb: true, systemPrompt: SET_PROMPT } });
  up('n_set_apply', { type: 'js', position: { x: pos.x + 700, y: pos.y + 100 }, data: { label: '2.0c Застосувати вибір комплекту', code: APPLY_CODE } });

  const setEdge = (s, t, h) => {
    for (let k = edges.length - 1; k >= 0; k--) if (edges[k].source === s && (h ? edges[k].sourceHandle === h : !edges[k].sourceHandle)) edges.splice(k, 1);
    const id = 'e_' + s + '_' + t + (h ? '_' + h : '');
    if (!edges.find(e => e.id === id)) edges.push({ id, source: s, target: t, ...(h ? { sourceHandle: h } : {}) });
  };
  setEdge('n_welcome', 'n_is_set');
  setEdge('n_is_set', 'n_set_choice', 'true');
  setEdge('n_is_set', 'n_is_clothing', 'false');
  setEdge('n_set_choice', 'n_set_apply');
  setEdge('n_set_apply', 'n_is_clothing');
  console.log('✅ гілка: n_welcome→n_is_set; [true]→n_set_choice→n_set_apply→n_is_clothing; [false]→n_is_clothing');

  const route = nodes.find(n => n.id === 'n_supplier_route');
  if (route) { route.data.code = ROUTE_CODE; console.log('✅ n_supplier_route: комплект → розкладка по постачальниках'); }

  const man = nodes.find(n => n.id === 'n_supplier_manual');
  if (man && !String(man.data.message).includes('supplierSetBreakdown')) {
    man.data.message = String(man.data.message) + NL + 'Склад комплекту:' + NL + '{{context.supplierSetBreakdown}}';
    console.log('✅ n_supplier_manual: додано склад комплекту у сигнал');
  }

  if (!APPLY) { console.log('DRY-RUN'); process.exit(0); }
  require('fs').writeFileSync('_backup_sets2_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes, edges } });
  console.log('✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
