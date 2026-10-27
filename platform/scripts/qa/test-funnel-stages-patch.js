'use strict';
// Перевірка плану етапів на СПРАВЖНІХ графах воронок (дамп із сервера, лише читання): FIXTURE=шлях/до/real-graphs.json
// Перевіряємо: усі цілі знайдені й мають вхідні ребра, старі ребра зберігають порядок і джерела, стартова нода не чіпається,
// назви етапів унікальні за номером, повторний запуск нічого не додає.
const fs = require('fs');
const { PLANS, addStagesBySpec } = require('../patch-funnel-stages-2026-10-27');

const FIX = process.env.FIXTURE;
if (!FIX || !fs.existsSync(FIX)) { console.log('Потрібен FIXTURE=<real-graphs.json>'); process.exit(2); }
const G = JSON.parse(fs.readFileSync(FIX, 'utf8'));

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ПРОВАЛ: ' + m); } };

for (const slug of Object.keys(PLANS)) {
    const g = G[slug];
    if (!g) { console.log('(нема дампу ' + slug + ')'); continue; }
    console.log(slug + ' (' + g.nodes.length + ' нод)');
    const specs = PLANS[slug](g.nodes, g.edges);
    const r = addStagesBySpec(g.nodes, g.edges, specs);
    ok(r.skipped.length === 0, 'усі цілі знайдені й мають вхід' + (r.skipped.length ? ': ' + r.skipped.join('; ') : ''));
    const stageNodes = r.nodes.filter((n) => n.type === 'flowStage');
    ok(stageNodes.length === r.added.length && stageNodes.length > 0, 'додано ' + stageNodes.length + ' нод етапів');
    ok(g.nodes.length + stageNodes.length === r.nodes.length && g.edges.length + stageNodes.length === r.edges.length, 'нод і ребер додалось рівно по одному на етап');

    const byStage = new Map(); // назва → { order, side }
    let consistent = true;
    for (const n of stageNodes) {
        const prev = byStage.get(n.data.stageName);
        if (prev && (prev.order !== n.data.stageOrder || prev.side !== !!n.data.side)) consistent = false;
        byStage.set(n.data.stageName, { order: n.data.stageOrder, side: !!n.data.side });
    }
    ok(consistent, 'одна назва етапу = один номер і ознака (без розбіжностей)');
    const orders = new Map();
    let uniq = true;
    for (const [name, v] of byStage) { if (orders.has(v.order) && orders.get(v.order) !== name) uniq = false; orders.set(v.order, name); }
    ok(uniq, 'різні етапи мають різні номери');

    // старі ребра: той самий індекс, id, джерело; ціль або та сама, або етап, що веде в цю ж ціль
    const stageTarget = Object.fromEntries(r.edges.filter((e) => e.id.startsWith('es_')).map((e) => [e.source, e.target]));
    let edgesOk = true;
    for (let i = 0; i < g.edges.length; i++) {
        const o = g.edges[i]; const n = r.edges[i];
        if (n.id !== o.id || n.source !== o.source) edgesOk = false;
        if (n.target !== o.target && stageTarget[n.target] !== o.target) edgesOk = false;
    }
    ok(edgesOk, 'старі ребра: порядок і джерела збережено, шлях через етап веде в ту саму ноду');
    ok(!r.edges.some((e) => e.target === g.nodes.find((n) => n.type === 'start').id), 'в стартову ноду нічого не веде');

    const r2 = addStagesBySpec(r.nodes, r.edges, PLANS[slug](r.nodes, r.edges));
    ok(r2.added.length === 0 && r2.nodes.length === r.nodes.length, 'повторний запуск нічого не додає');
    console.log('    → ' + [...byStage.entries()].sort((a, b) => a[1].order - b[1].order).map(([n, v]) => v.order + (v.side ? '*' : '') + ' ' + n).join(' | ').slice(0, 330));
}
console.log('\nПідсумок: ' + pass + ' ✔, ' + fail + ' ✘');
process.exit(fail ? 1 : 0);
