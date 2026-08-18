const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

const CALC_CODE = [
"var s = context.sizeInput || {};",
"var w = Number(s.weight) || 0, h = Number(s.height) || 0;",
"var order = ['XS','S','M','L','XL','XXL','XXXL','2XL','3XL','4XL'];",
"var avail = (context.product && context.product.sizes && context.product.sizes.length) ? context.product.sizes.slice() : ['S','M','L','XL'];",
"var chart = {};",
"try { chart = JSON.parse(keys.SIZE_CHART || '{}'); } catch (e) {}",
"function inRange(v, r){ return r && v >= Number(r[0]) && v <= Number(r[1]); }",
"function pick(v, dim){ if(!v) return null; for(var kk in chart){ if(inRange(v, chart[kk] && chart[kk][dim])) return kk; } return null; }",
"// Межі сітки: якщо клієнт сильно поза ними — не вгадуємо, кличемо менеджера.",
"var hMin=1e9,hMax=-1e9,wMin=1e9,wMax=-1e9;",
"for (var k in chart){ var c=chart[k]||{}; if(c.height){ hMin=Math.min(hMin,Number(c.height[0])); hMax=Math.max(hMax,Number(c.height[1])); } if(c.weight){ wMin=Math.min(wMin,Number(c.weight[0])); wMax=Math.max(wMax,Number(c.weight[1])); } }",
"var TOL_H=5, TOL_W=8;",
"var oorH = h > 0 && isFinite(hMin) && (h < hMin - TOL_H || h > hMax + TOL_H);",
"var oorW = w > 0 && isFinite(wMin) && (w < wMin - TOL_W || w > wMax + TOL_W);",
"var byW = pick(w, 'weight'), byH = pick(h, 'height');",
"var size = null;",
"if (byW && byH) { size = order.indexOf(byW) >= order.indexOf(byH) ? byW : byH; }",
"else { size = byW || byH; }",
"if (!size && s.clothingSize) size = String(s.clothingSize).toUpperCase().trim();",
"if ((oorH || oorW) && !s.clothingSize) {",
"  return { sizeOutOfRange: true, sizeOorReason: (oorH?('зріст '+h+' см поза сіткою ('+hMin+'-'+hMax+')'):'') + (oorH&&oorW?'; ':'') + (oorW?('вага '+w+' кг поза сіткою ('+wMin+'-'+wMax+')'):''), recommendedSize: size || '' };",
"}",
"if (!size) size = 'M';",
"if (avail.indexOf(size) < 0 && avail.length) {",
"  var idx = order.indexOf(size), best = avail[0], bestd = 999;",
"  for (var i = 0; i < avail.length; i++){ var dd = Math.abs(order.indexOf(avail[i]) - idx); if (dd < bestd){ bestd = dd; best = avail[i]; } }",
"  size = best;",
"}",
"return { recommendedSize: size, sizeOutOfRange: false };",
].join("\n");

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const edges = JSON.parse(JSON.stringify(fd.edges));
  const calc = nodes.find(n => n.id === 'n_calc');
  if (!calc) { console.log('n_calc НЕМА'); process.exit(1); }
  try { new Function('context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','return (async function(){'+CALC_CODE+'\n})();'); }
  catch (e) { console.log('❌ CALC_CODE не компілюється:', e.message); process.exit(1); }
  calc.data.code = CALC_CODE;
  console.log('✅ n_calc: додано детект розміру поза сіткою');
  const pos = calc.position || { x: 0, y: 900 };
  const up = (id, obj) => { const i = nodes.findIndex(n => n.id === id); if (i >= 0) nodes[i] = { ...nodes[i], ...obj, data: { ...(nodes[i].data||{}), ...(obj.data||{}) } }; else nodes.push({ id, ...obj }); };
  up('n_size_oor', { type: 'condition', position: { x: pos.x + 350, y: pos.y }, data: { label: '3.5 Розмір поза сіткою?', condition: 'context.sizeOutOfRange === true' } });
  up('n_size_oor_msg', { type: 'message', position: { x: pos.x + 700, y: pos.y }, data: { label: '3.6 Поза сіткою → менеджер', variants: [],
    text: 'Дякую за параметри! 🙏 Щоб точно не помилитись із розміром саме для вас, я покличу менеджера — він підбере ідеальний варіант і одразу напише сюди 💛' } });
  up('n_size_oor_admin', { type: 'notifyAdmin', position: { x: pos.x + 700, y: pos.y + 120 }, data: { label: '3.7 Сигнал: розмір поза сіткою', targetKey: 'ADMIN_TELEGRAM_ID',
    message: '📏 РОЗМІР ПОЗА СІТКОЮ — потрібен менеджер.\nКлієнт: {{context.senderName}} ({{context.igUsername}})\nТовар: {{context.product.name}}\nПараметри: зріст {{context.sizeInput.height}} см, вага {{context.sizeInput.weight}} кг\nПричина: {{context.sizeOorReason}}' } });
  up('n_size_oor_stop', { type: 'js', position: { x: pos.x + 700, y: pos.y + 240 }, data: { label: '3.8 Пауза бота', code: 'return { adminEngaged: true };' } });
  const setEdge = (s, t, h) => {
    for (let k = edges.length - 1; k >= 0; k--) if (edges[k].source === s && (h ? edges[k].sourceHandle === h : !edges[k].sourceHandle)) edges.splice(k, 1);
    const id = 'e_' + s + '_' + t + (h ? '_' + h : '');
    if (!edges.find(e => e.id === id)) edges.push({ id, source: s, target: t, ...(h ? { sourceHandle: h } : {}) });
  };
  setEdge('n_calc', 'n_size_oor');
  setEdge('n_size_oor', 'n_size_oor_msg', 'true');
  setEdge('n_size_oor', 'n_size_reply', 'false');
  setEdge('n_size_oor_msg', 'n_size_oor_admin');
  setEdge('n_size_oor_admin', 'n_size_oor_stop');
  console.log('rewire: n_calc→n_size_oor; [true]→msg→admin→stop; [false]→n_size_reply');
  if (!APPLY) { console.log('\nDRY-RUN'); process.exit(0); }
  require('fs').writeFileSync('_backup_oor_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes, edges } });
  console.log('✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
