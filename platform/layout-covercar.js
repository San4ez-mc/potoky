// Авто-розкладка воронки covercar за 8 правилами:
// 1. Після condition — гілки на одному рівні (row)
// 2. true/справа-варіант лишається в "прямому" напрямку (та сама колонка), false/альт — праворуч
// 3. Мінімізація перетинів стрілок (barycenter-згладжування)
// 4. Умовна сітка: COL_W×ROW_H, вирівнювання по рядку/колонці
// 5. Крок сітки 260×150
// 6. true/основний сценарій завжди зверху-зліва (найменша колонка серед гілок)
// 7. Merge-точки (кілька вхідних) — колонка = середнє колонок джерел
// 8. Довгі лінійні ділянки (>6 нод без розгалуження) — компактний зигзаг колонок
//
// Це джерело істини для розкладки — перезапускати після додавання/видалення нод
// у воронці, щоб позиції лишались акуратними (grid-based, без ручного тягання).
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
// Картки нод у редакторі: min-w-[220px] max-w-[320px] (BaseNode, NodeTypes.jsx),
// висота плаває 90-220px залежно від типу (condition з TRUE/FALSE-прев'ю,
// claude з прев'ю промпту — найвищі). COL_W має перевищувати max-width картки
// з запасом на проміжок; ROW_H — з запасом під найвищі картки.
const COL_W = 360;
const ROW_H = 200;
const ZIGZAG_RUN = 6;

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes || []));
  const edges = JSON.parse(JSON.stringify(fd.edges || []));
  const byId = {}; nodes.forEach(n => { byId[n.id] = n; });
  const outEdges = {}; const inEdges = {};
  nodes.forEach(n => { outEdges[n.id] = []; inEdges[n.id] = []; });
  edges.forEach(e => { if (outEdges[e.source]) outEdges[e.source].push(e); if (inEdges[e.target]) inEdges[e.target].push(e); });

  const start = nodes.find(n => n.type === 'start');
  if (!start) { console.log('❌ нема start'); process.exit(1); }

  // ── Крок 1: row = BFS shortest-path depth від start (back-edges/цикли ігноруються природно) ──
  const row = {}; row[start.id] = 0;
  const bfsQ = [start.id];
  const order = [start.id]; // топологічний порядок відвідування (для колонок)
  while (bfsQ.length) {
    const cur = bfsQ.shift();
    for (const e of outEdges[cur]) {
      if (row[e.target] == null) {
        row[e.target] = row[cur] + 1;
        bfsQ.push(e.target);
        order.push(e.target);
      }
    }
  }
  const unreached = nodes.filter(n => row[n.id] == null);
  if (unreached.length) { console.log('⚠️ недосяжні (лишаю позицію як є):', unreached.map(n => n.id).join(',')); unreached.forEach(n => { row[n.id] = 0; }); }

  // ── Крок 2: попередня колонка (топологічний прохід) ──
  // Правило true=пряма колонка, false/альт=+1,+2..., merge=середнє джерел, лінійний ланцюг=та сама колонка.
  const col = {}; col[start.id] = 0;
  const branchLabelOrder = (h) => {
    // порядок вибору "прямої" гілки: true/успіх першим, потім cond#N за номером, false/default останнім
    if (h === 'true' || !h) return -1;
    if (h && h.startsWith('cond#')) return parseInt(h.slice(5), 10);
    if (h === 'false' || h === 'default') return 999;
    return 500;
  };
  for (const id of order) {
    if (id === start.id) continue;
    const ins = inEdges[id];
    if (ins.length === 0) { col[id] = col[id] != null ? col[id] : 0; continue; }
    if (ins.length > 1) {
      // Merge-точка: середнє колонок джерел (правило 7)
      const cs = ins.map(e => col[e.source]).filter(c => c != null);
      col[id] = cs.length ? Math.round(cs.reduce((a, b) => a + b, 0) / cs.length) : 0;
      continue;
    }
    const e = ins[0];
    const srcCol = col[e.source] != null ? col[e.source] : 0;
    const srcOuts = outEdges[e.source];
    if (srcOuts.length <= 1) { col[id] = srcCol; continue; } // лінійний ланцюг — та сама колонка
    // Розгалуження: сортуємо вихідні ребра джерела за "прямотою", даємо колонки 0,+1,+2...
    const sorted = [...srcOuts].sort((a, b) => branchLabelOrder(a.sourceHandle) - branchLabelOrder(b.sourceHandle));
    const idx = sorted.findIndex(x => x.id === e.id);
    col[id] = srcCol + Math.max(0, idx);
  }
  nodes.forEach(n => { if (col[n.id] == null) col[n.id] = 0; });

  // ── Крок 3: де-колізія в межах рядка (зсув праворуч, якщо зайнято) ──
  function decollide() {
    const byRow = {};
    nodes.forEach(n => { (byRow[row[n.id]] = byRow[row[n.id]] || []).push(n.id); });
    Object.values(byRow).forEach(ids => {
      ids.sort((a, b) => col[a] - col[b]);
      let last = -Infinity;
      ids.forEach(id => { if (col[id] <= last) col[id] = last + 1; last = col[id]; });
    });
  }
  decollide();

  // ── Крок 4: barycenter-згладжування (правило 3, мінімізація перетинів) — кілька ітерацій ──
  for (let iter = 0; iter < 3; iter++) {
    for (const id of order) {
      const neigh = [...inEdges[id].map(e => e.source), ...outEdges[id].map(e => e.target)]
        .map(x => col[x]).filter(c => c != null);
      if (neigh.length) {
        const target = neigh.reduce((a, b) => a + b, 0) / neigh.length;
        col[id] = Math.round((col[id] * 0.4) + (target * 0.6));
      }
    }
    decollide();
  }

  // ── Крок 5: зигзаг довгих лінійних ділянок (правило 8) ──
  // Знаходимо ланцюги indegree=1,outdegree<=1 послідовно (backbone), довші за ZIGZAG_RUN — розкидаємо колонку.
  const visited = new Set();
  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    if (inEdges[n.id].length > 1) continue; // не старт ланцюга з merge
    const chain = [];
    let cur = n.id;
    while (cur && !visited.has(cur)) {
      chain.push(cur); visited.add(cur);
      const outs = outEdges[cur];
      if (outs.length !== 1) break;
      const nxt = outs[0].target;
      if (inEdges[nxt].length !== 1) break; // наступний — merge/розгалуження, кінець ланцюга
      cur = nxt;
    }
    if (chain.length > ZIGZAG_RUN) {
      const baseCol = col[chain[0]];
      chain.forEach((id, i) => {
        const seg = Math.floor(i / ZIGZAG_RUN);
        col[id] = baseCol + seg; // кожні 6 нод — крок вправо (компактний каскад)
      });
    }
  }
  decollide();

  // ── Запис позицій ──
  const minCol = Math.min(...Object.values(col));
  nodes.forEach(n => {
    n.position = { x: (col[n.id] - minCol) * COL_W, y: row[n.id] * ROW_H };
  });

  console.log('розмір сітки: ' + (Math.max(...Object.values(row)) + 1) + ' рядків × ' + (Math.max(...Object.values(col)) - minCol + 1) + ' колонок для ' + nodes.length + ' нод');

  if (!APPLY) {
    console.log('\nDRY-RUN — перші 15 позицій:');
    nodes.slice(0, 15).forEach(n => console.log('  ', n.id, '(' + n.type + ')', 'row=' + row[n.id], 'col=' + (col[n.id] - minCol), '-> x=' + n.position.x + ' y=' + n.position.y));
    process.exit(0);
  }
  require('fs').writeFileSync('_backup_layout_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
  console.log('✅ позиції записано');
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
