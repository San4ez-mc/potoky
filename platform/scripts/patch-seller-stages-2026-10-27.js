'use strict';
// Етапи воронки для ШІ-продавця (Ден), 27.10: нода «Етап (Flows)» (flowStage) перед ключовими нодами шаблону tpl-expert-seller
// і в усіх його клонах (sell-*). Сторінка «Воронка» (🎯) складе з них етапи й покаже, хто їх пройшов.
// Основний шлях: Відкрив бота → Діалог завершено → Побачив пропозицію запису → Гарячий лід передано експерту → Оплатив.
// Бічні виходи (поза основним шляхом): Заперечення, Не переконали після заперечення, Просить експерта, Думає, Не актуально.
// Ребра, що вели до цільової ноди, переспрямовуються НА МІСЦІ (порядок ребер від умов не змінюється), далі додається ребро етап → ціль.
// Ідемпотентний. Запуск з кореня platform/ на сервері:  node scripts/patch-seller-stages-2026-10-27.js   (DRY_RUN=1 — лише показати)

const STAGES = [
    { id: 'st_open', before: 'n_greet', name: 'Відкрив бота', order: 1 },
    { id: 'st_dialog', before: 'n_outcome', name: 'Діалог завершено', order: 2 },
    { id: 'st_offer', before: 'n_offer', name: 'Побачив пропозицію запису', order: 3 },
    { id: 'st_hot', before: 'n_hot_notify', name: 'Гарячий лід передано експерту', order: 4 },
    { id: 'st_paid', before: 'n_paid_notify', name: 'Оплатив', order: 5 },
    { id: 'st_obj', before: 'n_obj', name: 'Заперечення', order: 10, side: true },
    { id: 'st_obj_no', before: 'n_soft_msg', name: 'Не переконали після заперечення', order: 11, side: true },
    { id: 'st_dir', before: 'n_dir_notify', name: 'Просить розмову з експертом', order: 12, side: true },
    { id: 'st_und', before: 'n_und_notify', name: 'Думає', order: 13, side: true },
    { id: 'st_nr', before: 'n_nr_msg', name: 'Не актуально', order: 14, side: true },
];

/** Чиста функція: повертає { nodes, edges, added:[...] } — без мутацій вхідних масивів. */
function addStages(nodesIn, edgesIn) {
    const nodes = nodesIn.map((n) => ({ ...n }));
    let edges = edgesIn.map((e) => ({ ...e }));
    const added = [];
    for (const st of STAGES) {
        if (nodes.some((n) => n.id === st.id)) continue; // уже є
        const target = nodes.find((n) => n.id === st.before);
        if (!target) continue; // у цій версії графа такої ноди нема
        const incoming = edges.filter((e) => e.target === st.before);
        if (!incoming.length) continue;
        nodes.push({
            id: st.id,
            type: 'flowStage',
            position: { x: (target.position && target.position.x) || 0, y: ((target.position && target.position.y) || 0) - 70 },
            data: { label: 'Етап: ' + st.name, stageName: st.name, stageOrder: st.order, ...(st.side ? { side: true } : {}) },
        });
        for (const e of incoming) e.target = st.id;
        edges.push({ id: 'es_' + st.id + '__' + st.before, source: st.id, target: st.before });
        added.push(st.name);
    }
    return { nodes, edges, added };
}

module.exports = { STAGES, addStages };

if (require.main === module) {
    const path = require('path');
    const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    const { db } = require('@platform/db');
    const DRY = !!process.env.DRY_RUN;
    (async () => {
        const bots = await db.bot.findMany({ where: { OR: [{ slug: 'tpl-expert-seller' }, { slug: { startsWith: 'sell-' } }] }, select: { id: true, slug: true } });
        for (const b of bots) {
            const flow = await db.flowDefinition.findUnique({ where: { botId: b.id } });
            if (!flow) { console.log(b.slug + ': граф відсутній, пропуск'); continue; }
            const r = addStages(Array.isArray(flow.nodes) ? flow.nodes : [], Array.isArray(flow.edges) ? flow.edges : []);
            if (!r.added.length) { console.log(b.slug + ': уже все є (нічого додавати)'); continue; }
            console.log(b.slug + ': ' + (DRY ? 'додав би ' : 'додано ') + r.added.length + ' етапів: ' + r.added.join(' · '));
            if (!DRY) await db.flowDefinition.update({ where: { botId: b.id }, data: { nodes: r.nodes, edges: r.edges } });
        }
        process.exit(0);
    })().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
}
