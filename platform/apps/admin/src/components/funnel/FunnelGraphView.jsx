import React, { useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Той самий словник іконок, що і на сторінці аналітики — навмисно продубльований
// (не імпортуємо з FunnelAnalytics.jsx, щоб не створювати циклічний імпорт).
const NODE_ICON = {
    start: '🚀', message: '💬', claude: '🤖', agent: '🤖', condition: '🔀',
    wait: '⏳', wait_payment: '💳', connector: '💳', notifyAdmin: '🔔', notifyTg: '🔔',
    httpRequest: '🌐', saveFile: '💾', loadFile: '📂', sendPhoto: '📸', js: '⚙️',
};
const nodeIcon = (t) => NODE_ICON[t] || '•';

// ─── Довільна нода-картка з даними аналітики (реальна позиція з редактора) ─────
function AnalyticsNode({ data }) {
    const { label, type, reached, pct, dropPct, isTerminal, isEntry, sourceHandles } = data;
    const unreached = reached === 0;
    const alpha = unreached ? 0 : Math.min(0.6, 0.14 + 0.46 * (pct / 100));
    const bigDrop = !isTerminal && dropPct >= 40 && reached > 0;

    return (
        <div
            className={`min-w-[150px] max-w-[190px] rounded-lg border px-2.5 py-2 text-xs shadow-sm ${unreached ? 'border-dashed border-gray-700 opacity-50' : 'border-brand/50'}`}
            style={{ background: unreached ? 'transparent' : `rgba(99,102,241,${alpha})` }}
            title={`${label}${unreached ? ' — не досягнуто за цей період' : ` — ${reached} сесій (${pct}% від входу гілки)`}`}
        >
            {!isEntry && <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-gray-600 !border !border-gray-400" />}
            <div className="flex items-center gap-1.5 min-w-0">
                <span className="shrink-0">{nodeIcon(type)}</span>
                <span className={`truncate ${unreached ? 'text-gray-500' : 'text-gray-100'}`}>{label}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
                <span className={`font-mono font-semibold ${unreached ? 'text-gray-600' : 'text-white'}`}>{reached}</span>
                {!unreached && <span className="text-[10px] text-gray-400">({pct}%)</span>}
                {bigDrop && <span className="text-[10px] text-red-400 font-medium ml-auto" title="Великий відтік саме тут — далі не пішли">⚠ -{dropPct}%</span>}
                {isTerminal && !unreached && <span className="text-[10px] text-gray-500 ml-auto" title="Кінцева дія цього сценарію — нема куди йти далі">⏹</span>}
            </div>
            {sourceHandles.map((hId, i) => (
                <Handle
                    key={hId || 'default'}
                    type="source"
                    id={hId || undefined}
                    position={Position.Bottom}
                    style={{ left: sourceHandles.length === 1 ? '50%' : `${12 + (76 * i) / (sourceHandles.length - 1)}%` }}
                    className="!w-2 !h-2 !bg-brand !border !border-brand-light"
                />
            ))}
        </div>
    );
}

const NODE_TYPES = { analyticsNode: AnalyticsNode };

// ─── Один компонент графа (незалежна група вузлів) — власний canvas + fitView ──
function ComponentCanvas({ title, hint, isPrimary, rfNodes, rfEdges }) {
    return (
        <div className={`rounded-xl border p-3 space-y-2 ${isPrimary ? 'border-gray-800 bg-gray-900' : 'border-amber-800/40 bg-amber-950/10'}`}>
            <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                    {!isPrimary && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 shrink-0">окрема гілка</span>}
                    {title}
                </div>
                {hint && <div className="text-xs text-gray-500">{hint}</div>}
            </div>
            <div style={{ height: Math.min(560, Math.max(220, rfNodes.length * 26)) }} className="rounded-lg overflow-hidden border border-gray-800">
                <ReactFlowProvider>
                    <ReactFlow
                        nodes={rfNodes}
                        edges={rfEdges}
                        nodeTypes={NODE_TYPES}
                        fitView
                        fitViewOptions={{ padding: 0.25 }}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        elementsSelectable={false}
                        panOnScroll
                        zoomOnScroll={false}
                        zoomOnPinch
                        proOptions={{ hideAttribution: true }}
                        className="bg-gray-950"
                    >
                        <Background color="#1f2937" gap={20} size={1} />
                        <Controls showInteractive={false} />
                        {rfNodes.length > 15 && (
                            <MiniMap
                                pannable zoomable
                                nodeColor={() => '#4f46e5'}
                                maskColor="#03070D88"
                            />
                        )}
                    </ReactFlow>
                </ReactFlowProvider>
            </div>
        </div>
    );
}

// ─── Проста картка для ізольованої одиночної ноди (без ребер узагалі) ─────────
function SingleNodeCard({ node, reachedInfo }) {
    const reached = reachedInfo?.reached || 0;
    return (
        <div className="rounded-xl border border-amber-800/40 bg-amber-950/10 p-3 flex items-center gap-3">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 shrink-0">окрема гілка</span>
            <span className="text-lg shrink-0">{nodeIcon(node.type)}</span>
            <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-200 truncate">{node.data?.label || node.id}</div>
                <div className="text-xs text-gray-500">Один крок без продовження — окремий вхід у воронку (напр. авто-відповідь на коментар), не частина основного сценарію</div>
            </div>
            <span className="text-lg font-mono font-semibold text-white shrink-0">{reached}</span>
        </div>
    );
}

/**
 * Реальний граф воронки (позиції — ті самі, що в редакторі) з накладеними
 * метриками замість фейкового лінійного списку. Кожна незв'язна компонента
 * графа (напр. окрема гілка для Instagram-коментарів, яку двигун запускає
 * напряму через currentNodeId, минаючи стартову ноду) рендериться ЯК ОКРЕМИЙ
 * canvas зі своїм fitView — так видно, що це справді інша гілка, а не
 * фінальний крок основної воронки.
 */
export function FunnelGraphView({ nodes, edges, reachedById }) {
    const components = useMemo(() => {
        if (!nodes || nodes.length === 0) return [];

        // Undirected adjacency для пошуку зв'язних компонент
        const undirected = {};
        const outByNode = {}; // directed: node -> [{target, sourceHandle}]
        const incoming = {};
        for (const n of nodes) { undirected[n.id] = []; outByNode[n.id] = []; incoming[n.id] = 0; }
        for (const e of edges) {
            if (!undirected[e.source] || !undirected[e.target]) continue; // ребро на неіснуючу ноду — ігноруємо
            undirected[e.source].push(e.target);
            undirected[e.target].push(e.source);
            outByNode[e.source].push({ target: e.target, sourceHandle: e.sourceHandle || null });
            incoming[e.target] = (incoming[e.target] || 0) + 1;
        }

        const visited = new Set();
        const groups = [];
        for (const n of nodes) {
            if (visited.has(n.id)) continue;
            const compIds = [];
            const queue = [n.id];
            visited.add(n.id);
            while (queue.length) {
                const id = queue.shift();
                compIds.push(id);
                for (const next of undirected[id] || []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
            }
            groups.push(compIds);
        }

        const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
        const maxIn = (id) => reachedById[id]?.reached || 0;

        return groups.map((ids) => {
            const compNodes = ids.map(id => byId[id]).filter(Boolean);
            const compMax = Math.max(1, ...compNodes.map(n => maxIn(n.id)));
            // Вхідна нода компоненти: type==='start' пріоритетно, інакше без вхідних ребер, інакше перша
            const entry = compNodes.find(n => n.type === 'start')
                || compNodes.find(n => (incoming[n.id] || 0) === 0)
                || compNodes[0];
            const hasEdgesInside = compNodes.length > 1;

            const rfNodes = compNodes.map(n => {
                const info = reachedById[n.id] || { reached: 0, dropPct: 0, isTerminal: true };
                const handles = outByNode[n.id].length
                    ? [...new Set(outByNode[n.id].map(o => o.sourceHandle))]
                    : [];
                return {
                    id: n.id,
                    type: 'analyticsNode',
                    position: n.position || { x: 0, y: 0 },
                    data: {
                        label: n.data?.label || n.id,
                        type: n.type,
                        reached: info.reached,
                        pct: compMax > 0 ? Math.round((info.reached / compMax) * 100) : 0,
                        dropPct: info.dropPct || 0,
                        isTerminal: !!info.isTerminal,
                        isEntry: n.id === entry?.id,
                        sourceHandles: handles,
                    },
                };
            });
            const rfEdges = ids.flatMap(id => (outByNode[id] || []).map((o, i) => {
                const targetInfo = reachedById[o.target] || { reached: 0 };
                const pct = compMax > 0 ? targetInfo.reached / compMax : 0;
                return {
                    id: `${id}-${o.target}-${o.sourceHandle || i}`,
                    source: id,
                    target: o.target,
                    sourceHandle: o.sourceHandle || undefined,
                    style: { stroke: '#6366f1', strokeWidth: 1 + 3 * pct, opacity: 0.25 + 0.6 * pct },
                    type: 'smoothstep',
                };
            }));

            return {
                key: entry?.id || ids[0],
                entryLabel: entry?.data?.label || entry?.id || '—',
                isPrimary: entry?.type === 'start',
                totalReached: maxIn(entry?.id) || compMax,
                hasEdgesInside,
                singleNode: !hasEdgesInside ? compNodes[0] : null,
                rfNodes,
                rfEdges,
            };
        }).sort((a, b) => (b.isPrimary - a.isPrimary) || (b.totalReached - a.totalReached));
    }, [nodes, edges, reachedById]);

    if (components.length === 0) return null;

    return (
        <div className="space-y-3">
            {components.map(c => c.singleNode ? (
                <SingleNodeCard key={c.key} node={c.singleNode} reachedInfo={reachedById[c.singleNode.id]} />
            ) : (
                <ComponentCanvas
                    key={c.key}
                    title={c.isPrimary ? `Основний сценарій — від «${c.entryLabel}»` : `Гілка: «${c.entryLabel}»`}
                    hint={c.isPrimary ? null : 'Вхід сюди не через стартову ноду — окремий сценарій (напр. автовідповідь на коментар), не етап основної воронки'}
                    isPrimary={c.isPrimary}
                    rfNodes={c.rfNodes}
                    rfEdges={c.rfEdges}
                />
            ))}
        </div>
    );
}
