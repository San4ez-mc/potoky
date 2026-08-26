// Спільний алгоритм авто-розкладки нод воронки — єдине джерело істини,
// яким користується і MCP (auto_layout tool, коли Claude будує/редагує воронку),
// і admin API/UI (кнопка «🧹 Впорядкувати» в редакторі, коли людина тягала ноди руками).
//
// Правила (затверджені 2026-08-19, аудит covercar):
// 1. Після condition-ноди — гілки на одному рівні (row = глибина від start).
// 2. true/основна гілка лишається в "прямій" колонці джерела; false/альт — праворуч.
// 3. Мінімізація перетинів стрілок — barycenter-згладжування (кілька ітерацій).
// 4. Умовна сітка: рядок = крок BFS від start, колонка = лінія сценарію.
// 5. Крок сітки COL_W×ROW_H — з запасом під реальний розмір картки
//    (BaseNode у NodeTypes.jsx: min-w-[220px] max-w-[320px], висота 90-220px).
// 6. true/основний сценарій завжди в найменшій колонці серед гілок розгалуження.
// 7. Merge-точки (кілька вхідних ребер) — колонка = округлене середнє колонок джерел.
// 8. Довгі лінійні ділянки (>ZIGZAG_RUN нод без розгалуження) — компактний
//    каскад колонок замість одного нескінченно довгого стовпця.
// 9. Транспонування (аудит 2026-08-26): барицентр — не повна мінімізація
//    перетинів, він лише тягне ноду до середнього сусідів і може застрягти
//    в локальному мінімумі, де перетину не було б, якби дві сусідні ноди
//    в одному рядку просто помінялись місцями. Явно пробуємо кожен такий
//    своп і лишаємо, якщо він строго зменшує кількість перетинів на межах
//    із сусідніми рядками.
//
// Не позиціонувати ноди вручну довільними координатами — викликати цю функцію.

const COL_W = 360;
const ROW_H = 200;
const ZIGZAG_RUN = 6;

/**
 * @param {Array<{id:string,type:string}>} nodesIn
 * @param {Array<{id?:string,source:string,target:string,sourceHandle?:string|null}>} edgesIn
 * @returns {Array} nodes з оновленим position {x,y} (копії, вхідні масиви не мутуються)
 */
function computeAutoLayout(nodesIn, edgesIn) {
    const nodes = nodesIn.map((n) => ({ ...n }));
    const edges = edgesIn || [];
    const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
    const outEdges = {}; const inEdges = {};
    nodes.forEach((n) => { outEdges[n.id] = []; inEdges[n.id] = []; });
    edges.forEach((e) => {
        if (outEdges[e.source]) outEdges[e.source].push(e);
        if (inEdges[e.target]) inEdges[e.target].push(e);
    });

    const start = nodes.find((n) => n.type === 'start') || nodes[0];
    if (!start) return nodes;

    // ── Row: BFS shortest-path depth від start (back-edges/цикли природно ігноруються) ──
    const row = {}; row[start.id] = 0;
    const bfsQ = [start.id];
    const order = [start.id];
    while (bfsQ.length) {
        const cur = bfsQ.shift();
        for (const e of outEdges[cur]) {
            if (row[e.target] == null) { row[e.target] = row[cur] + 1; bfsQ.push(e.target); order.push(e.target); }
        }
    }
    nodes.forEach((n) => { if (row[n.id] == null) { row[n.id] = 0; order.push(n.id); } }); // недосяжні — row 0, не ламаємо

    // ── Column: топологічний прохід (правила 2,6,7) ──
    const col = {}; col[start.id] = 0;
    const branchOrder = (h) => {
        if (h === 'true' || !h) return -1;
        if (h && String(h).startsWith('cond#')) return parseInt(String(h).slice(5), 10);
        if (h === 'false' || h === 'default') return 999;
        return 500;
    };
    for (const id of order) {
        if (id === start.id) continue;
        const ins = inEdges[id];
        if (ins.length === 0) { col[id] = col[id] != null ? col[id] : 0; continue; }
        if (ins.length > 1) {
            const cs = ins.map((e) => col[e.source]).filter((c) => c != null);
            col[id] = cs.length ? Math.round(cs.reduce((a, b) => a + b, 0) / cs.length) : 0;
            continue;
        }
        const e = ins[0];
        const srcCol = col[e.source] != null ? col[e.source] : 0;
        const srcOuts = outEdges[e.source];
        if (srcOuts.length <= 1) { col[id] = srcCol; continue; }
        const sorted = [...srcOuts].sort((a, b) => branchOrder(a.sourceHandle) - branchOrder(b.sourceHandle));
        const idx = sorted.findIndex((x) => (x.id ? x.id === e.id : x.target === e.target && x.sourceHandle === e.sourceHandle));
        col[id] = srcCol + Math.max(0, idx);
    }
    nodes.forEach((n) => { if (col[n.id] == null) col[n.id] = 0; });

    // ── Де-колізія в межах рядка (правило 4) ──
    function decollide() {
        const byRow = {};
        nodes.forEach((n) => { (byRow[row[n.id]] = byRow[row[n.id]] || []).push(n.id); });
        Object.values(byRow).forEach((ids) => {
            ids.sort((a, b) => col[a] - col[b]);
            let last = -Infinity;
            ids.forEach((id) => { if (col[id] <= last) col[id] = last + 1; last = col[id]; });
        });
    }
    decollide();

    // ── Barycenter-згладжування, мінімізація перетинів (правило 3) ──
    for (let iter = 0; iter < 3; iter++) {
        for (const id of order) {
            const neigh = [...inEdges[id].map((e) => e.source), ...outEdges[id].map((e) => e.target)]
                .map((x) => col[x]).filter((c) => c != null);
            if (neigh.length) {
                const target = neigh.reduce((a, b) => a + b, 0) / neigh.length;
                col[id] = Math.round((col[id] * 0.4) + (target * 0.6));
            }
        }
        decollide();
    }

    // ── Транспонування, мінімізація перетинів (правило 9) ──
    // Кількість перетинів стрілок на межі між рядком rowA і рядком rowB:
    // для кожної пари ребер, що з'єднують ці два рядки, перетин є тоді й
    // тільки тоді, коли їхній відносний порядок колонок інвертований.
    function boundaryCrossings(rowA, rowB) {
        const pairs = [];
        edges.forEach((e) => {
            const rs = row[e.source], rt = row[e.target];
            if (rs === rowA && rt === rowB) pairs.push([col[e.source], col[e.target]]);
            else if (rs === rowB && rt === rowA) pairs.push([col[e.target], col[e.source]]);
        });
        let count = 0;
        for (let i = 0; i < pairs.length; i++) {
            for (let j = i + 1; j < pairs.length; j++) {
                const [a1, b1] = pairs[i]; const [a2, b2] = pairs[j];
                if ((a1 - a2) * (b1 - b2) < 0) count++;
            }
        }
        return count;
    }
    function transposePass() {
        let improved = false;
        const byRow = {};
        nodes.forEach((n) => { (byRow[row[n.id]] = byRow[row[n.id]] || []).push(n.id); });
        Object.keys(byRow).forEach((r) => {
            const rNum = Number(r);
            const ids = byRow[r].sort((a, b) => col[a] - col[b]);
            for (let i = 0; i < ids.length - 1; i++) {
                const a = ids[i]; const b = ids[i + 1];
                const before = boundaryCrossings(rNum - 1, rNum) + boundaryCrossings(rNum, rNum + 1);
                const tmp = col[a]; col[a] = col[b]; col[b] = tmp;
                const after = boundaryCrossings(rNum - 1, rNum) + boundaryCrossings(rNum, rNum + 1);
                if (after < before) { improved = true; ids[i] = b; ids[i + 1] = a; }
                else { const back = col[a]; col[a] = col[b]; col[b] = back; }
            }
        });
        return improved;
    }
    for (let pass = 0; pass < 6; pass++) {
        if (!transposePass()) break;
    }
    decollide();

    // ── Зигзаг довгих лінійних ділянок (правило 8) ──
    const visited = new Set();
    for (const n of nodes) {
        if (visited.has(n.id) || inEdges[n.id].length > 1) continue;
        const chain = [];
        let cur = n.id;
        while (cur && !visited.has(cur)) {
            chain.push(cur); visited.add(cur);
            const outs = outEdges[cur];
            if (outs.length !== 1) break;
            const nxt = outs[0].target;
            if (!byId[nxt] || inEdges[nxt].length !== 1) break;
            cur = nxt;
        }
        if (chain.length > ZIGZAG_RUN) {
            const baseCol = col[chain[0]];
            chain.forEach((id, i) => { col[id] = baseCol + Math.floor(i / ZIGZAG_RUN); });
        }
    }
    decollide();

    const minCol = Math.min(...Object.values(col));
    nodes.forEach((n) => { n.position = { x: (col[n.id] - minCol) * COL_W, y: row[n.id] * ROW_H }; });
    return nodes;
}

module.exports = { computeAutoLayout, COL_W, ROW_H, ZIGZAG_RUN };
