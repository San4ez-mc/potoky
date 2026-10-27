'use strict';
// Бекфіл етапів воронки для старих розмов (27.10, запит власника: «зроби бекфіл, це буде корисно»).
// Дані беруться з самих розмов, нічого не вигадується:
//   1) є записи проходження нод (flowRuntime.nodeTraces) — етап і ЧАС беруться з них;
//   2) є лише список пройдених нод (nodesVisited) — етап за самим фактом проходу, час приблизний (початок / остання активність);
//   3) старий рушій зберіг лише поточну ноду (state) — етап вважається пройденим, якщо до цієї ноди НЕМОЖЛИВО дійти в обхід
//      його ноди-цілі (вона лежить на кожному шляху від старту); час приблизний.
//   4) завершені розмови без жодних слідів (старий рушій) — лише етап «Відкрив …» (сама розмова існує), без виводів про далі.
// Рядки пишуться ON CONFLICT DO NOTHING: уже записані справжні події не змінюються. Запуск з кореня platform/ на сервері:
//   DRY_RUN=1 node scripts/backfill-funnel-stages-2026-10-27.js     (лише показати)      ONLY=slug1,slug2 — лише ці воронки

const SELLER_SLUGS = ['sell-ai-seller', 'tpl-expert-seller'];

/** Специфікації етапів воронки з патчів: [{ name, order, side, targets:[nodeId...] }] */
function specsFor(slug, nodes, edges, PLANS, STAGES) {
    if (SELLER_SLUGS.includes(slug)) return STAGES.map((s) => ({ name: s.name, order: s.order, side: !!s.side, targets: [s.before] }));
    if (!PLANS[slug]) return [];
    const merged = new Map();
    for (const sp of PLANS[slug](nodes, edges)) {
        const cur = merged.get(sp.name) || { name: sp.name, order: sp.order, side: !!sp.side, targets: [] };
        cur.targets.push(...sp.before);
        merged.set(sp.name, cur);
    }
    return [...merged.values()];
}

/** true, якщо кожен шлях від старту до `target` проходить через одну з `blockers` (або target сам є blocker) */
function dominated(adj, startId, blockers, target) {
    if (blockers.has(target)) return true;
    const seen = new Set([startId]);
    const q = [startId];
    if (blockers.has(startId)) return true;
    while (q.length) {
        const id = q.shift();
        for (const t of adj[id] || []) {
            if (blockers.has(t) || seen.has(t)) continue;
            if (t === target) return false; // дійшли в обхід
            seen.add(t); q.push(t);
        }
    }
    return true;
}

/**
 * Для однієї розмови повертає { stages: Map(name → { order, firstAt, lastAt }), how } .
 * session: { id, state, startedAt, lastActive, context }
 */
function inferStages(session, specs, graph) {
    const rt = (session.context && session.context.flowRuntime) || {};
    const traces = Array.isArray(rt.nodeTraces) ? rt.nodeTraces : [];
    const visited = new Set(Array.isArray(rt.nodesVisited) ? rt.nodesVisited : []);
    const stages = new Map();
    const put = (sp, first, last) => {
        const cur = stages.get(sp.name);
        const f = new Date(first); const l = new Date(last);
        if (!cur) stages.set(sp.name, { order: sp.order, firstAt: f, lastAt: l });
        else { if (f < cur.firstAt) cur.firstAt = f; if (l > cur.lastAt) cur.lastAt = l; }
    };
    const started = session.startedAt; const active = session.lastActive || session.startedAt;

    if (traces.length || visited.size) {
        const tsByNode = new Map();
        for (const t of traces) {
            if (!t || !t.nodeId) continue;
            visited.add(t.nodeId);
            const ts = t.tsIso ? new Date(t.tsIso) : null;
            if (ts && !Number.isNaN(ts.getTime())) { const a = tsByNode.get(t.nodeId) || { min: ts, max: ts }; if (ts < a.min) a.min = ts; if (ts > a.max) a.max = ts; tsByNode.set(t.nodeId, a); }
        }
        for (const sp of specs) {
            const hit = sp.targets.filter((id) => visited.has(id));
            if (!hit.length) continue;
            const times = hit.map((id) => tsByNode.get(id)).filter(Boolean);
            if (times.length) put(sp, new Date(Math.min(...times.map((t) => t.min))), new Date(Math.max(...times.map((t) => t.max))));
            else put(sp, started, active);
        }
        return { stages, how: traces.length ? 'traces' : 'visited' };
    }

    const cur = session.state;
    if (cur && cur !== 'completed' && graph.ids.has(cur)) {
        for (const sp of specs) {
            const blockers = new Set(sp.targets.filter((id) => graph.ids.has(id)));
            if (!blockers.size) continue;
            if (dominated(graph.adj, graph.startId, blockers, cur)) put(sp, started, active);
        }
        return { stages, how: 'state' };
    }
    // завершена розмова без слідів: відомо лише, що вона була
    const first = specs.filter((s) => !s.side).sort((a, b) => a.order - b.order)[0];
    if (first) put(first, started, started);
    return { stages, how: 'completed-no-trace' };
}

function buildGraph(nodes, edges) {
    const adj = {};
    for (const e of edges) (adj[e.source] = adj[e.source] || []).push(e.target);
    const start = nodes.find((n) => n.type === 'start') || nodes[0];
    return { adj, startId: start && start.id, ids: new Set(nodes.map((n) => n.id)) };
}

module.exports = { specsFor, inferStages, buildGraph, dominated };

if (require.main === module || process.env.RUN_PATCH === '1') {
    const path = require('path');
    const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    const { db } = require('@platform/db');
    const { ensureTable } = require(path.join(ROOT, 'apps/api/src/services/stageEvents'));
    const { PLANS } = (global.__PATCH_PLANS__ || require('./patch-funnel-stages-2026-10-27'));
    const { STAGES } = (global.__PATCH_STAGES__ || require('./patch-seller-stages-2026-10-27'));
    const DRY = !!process.env.DRY_RUN;
    const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
    (async () => {
        if (!DRY) await ensureTable();
        const slugs = [...Object.keys(PLANS), ...SELLER_SLUGS];
        for (const slug of slugs) {
            if (ONLY.length && !ONLY.includes(slug)) continue;
            const bot = await db.bot.findFirst({ where: { slug } });
            if (!bot) { console.log(slug + ': воронки нема'); continue; }
            const flow = await db.flowDefinition.findUnique({ where: { botId: bot.id } });
            const nodes = Array.isArray(flow && flow.nodes) ? flow.nodes : []; const edges = Array.isArray(flow && flow.edges) ? flow.edges : [];
            const specs = specsFor(slug, nodes, edges, PLANS, STAGES);
            if (!specs.length) { console.log(slug + ': нема етапів у графі'); continue; }
            const graph = buildGraph(nodes, edges);
            const sessions = await db.session.findMany({ where: { botId: bot.id }, select: { id: true, userId: true, state: true, startedAt: true, lastActive: true, isTest: true, context: true } });
            const how = {}; const tally = {}; let rows = 0; let inserted = 0;
            for (const s of sessions) {
                const r = inferStages(s, specs, graph);
                how[r.how] = (how[r.how] || 0) + 1;
                for (const [name, v] of r.stages) {
                    rows++;
                    if (!s.isTest) tally[name] = (tally[name] || 0) + 1;
                    if (!DRY) {
                        const n = await db.$executeRaw`
                            INSERT INTO funnel_stage_events (session_id, stage_name, bot_id, user_id, stage_order, is_test, first_at, last_at)
                            VALUES (${s.id}, ${name}, ${bot.id}, ${s.userId}, ${v.order}, ${s.isTest}, ${v.firstAt}, ${v.lastAt})
                            ON CONFLICT (session_id, stage_name) DO NOTHING`;
                        inserted += Number(n) || 0;
                    }
                }
            }
            const top = [...specs].sort((a, b) => a.order - b.order).filter((sp) => tally[sp.name]).map((sp) => sp.order + (sp.side ? '*' : '') + ' ' + sp.name + '=' + tally[sp.name]).join(' | ');
            console.log(slug + ': сесій ' + sessions.length + ' (' + Object.entries(how).map(([k, v]) => k + ' ' + v).join(', ') + '), етапів ' + rows + (DRY ? '' : ', записано нових ' + inserted) + '\n    реальні: ' + (top || '—'));
        }
        process.exit(0);
    })().catch((e) => { console.error('FAILED:', e && e.stack || e); process.exit(1); });
}
