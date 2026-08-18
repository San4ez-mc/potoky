/* Крок кольору потрібен ТІЛЬКИ якщо: у товару є кольори І клієнт ще не обрав.
   Інакше (товар без кольорів — напр. подушка з набору; або колір уже відомий з артикулу) — пропускаємо. */
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const COND = "context.product && String(context.product.colors||'').trim().length > 0 && !(context.colorChoice && context.colorChoice.color)";
(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const edges = JSON.parse(JSON.stringify(fd.edges));
  const col = nodes.find(n => n.id === 'n_color');
  const pos = (col && col.position) || { x: 0, y: 1200 };
  const i = nodes.findIndex(n => n.id === 'n_has_colors');
  const node = { id: 'n_has_colors', type: 'condition', position: { x: pos.x - 300, y: pos.y }, data: { label: '4.5 Потрібен вибір кольору?', condition: COND } };
  if (i >= 0) nodes[i] = { ...nodes[i], ...node, data: { ...(nodes[i].data || {}), ...node.data } }; else nodes.push(node);

  const setEdge = (s, t, h) => {
    for (let k = edges.length - 1; k >= 0; k--) if (edges[k].source === s && (h ? edges[k].sourceHandle === h : !edges[k].sourceHandle)) edges.splice(k, 1);
    const id = 'e_' + s + '_' + t + (h ? '_' + h : '');
    if (!edges.find(e => e.id === id)) edges.push({ id, source: s, target: t, ...(h ? { sourceHandle: h } : {}) });
  };
  // усі, хто вів у n_color (крім самого гейта), тепер ведуть у гейт
  const feeders = edges.filter(e => e.target === 'n_color' && e.source !== 'n_has_colors').map(e => ({ s: e.source, h: e.sourceHandle }));
  console.log('переспрямовую в гейт:', JSON.stringify(feeders));
  for (const f of feeders) setEdge(f.s, 'n_has_colors', f.h);
  setEdge('n_has_colors', 'n_color', 'true');
  setEdge('n_has_colors', 'n_avail', 'false');
  console.log('✅ n_has_colors: [true]→n_color, [false]→n_avail (пропуск кольору)');
  if (!APPLY) { console.log('DRY-RUN'); process.exit(0); }
  require('fs').writeFileSync('_backup_colorskip_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes, edges } });
  console.log('✅ записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
