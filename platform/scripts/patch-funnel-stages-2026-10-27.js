'use strict';
// Етапи воронки (нода flowStage → сторінка «Воронка» 🎯) для воронок, куди заходять нетехнічні люди (27.10, запит власника):
// курс «Фінансова система» (етап на урок), продаж курсу, продажні воронки Дена (SPIN), sale-* контент-платформи, Task Tracker, онбординг експерта.
// sell-ai-seller і tpl-expert-seller мають свій патч (patch-seller-stages-2026-10-27.js).
// Ребра, що вели до цільової ноди, переспрямовуються НА МІСЦІ (порядок ребер від умов не змінюється), далі додається ребро етап → ціль.
// Ідемпотентний; перед записом кладе резервну копію графа у BACKUP_DIR. Запуск з кореня platform/ на сервері:
//   DRY_RUN=1 node scripts/patch-funnel-stages-2026-10-27.js     (лише показати)      ONLY=slug1,slug2 — лише ці воронки

const lessonLabel = (n) => /^Урок /.test(String((n.data && n.data.label) || ''));

// spec: { id, name, order, side?, optional?, before: [id ноди-цілі, ...] } (optional: якщо ноди нема, мовчки пропускаємо) — на кожну ціль окрема нода етапу (назва та сама → один етап)
const SPIN_SIDE = (ids) => [
    { id: 'st_obj', name: 'Заперечення', order: 10, side: true, optional: true, before: [ids.obj] },
    { id: 'st_soft', name: 'Не переконали після заперечення', order: 11, side: true, optional: true, before: [ids.soft] },
    { id: 'st_nr', name: 'Не актуально', order: 12, side: true, before: [ids.nr] },
];
const SALE = (id2, name2, extraBefore) => (nodes) => [
    { id: 'st_open', name: 'Відкрив бота', order: 1, before: ['n_intro'] },
    ...(extraBefore ? [extraBefore] : []),
    { id: 'st_dialog', name: name2, order: extraBefore ? 3 : 2, before: ['n_cond'] },
    { id: 'st_offer', name: 'Побачив пропозицію демо', order: extraBefore ? 4 : 3, before: ['n_offer'] },
    { id: 'st_hot', name: 'Гарячий лід передано власнику', order: extraBefore ? 5 : 4, before: ['n_hot'] },
    ...SPIN_SIDE({ obj: 'n_obj', soft: 'n_soft', nr: 'n_nr' }),
];

const DEN_SPIN = (firstBefore) => () => [
    { id: 'st_open', name: 'Відкрив бота', order: 1, before: [firstBefore] },
    { id: 'st_dialog', name: 'Діалог завершено', order: 2, before: ['node_1779282229268'] },
    { id: 'st_offer', name: 'Побачив пропозицію консультації', order: 3, before: ['node_1779282313239', 'node_1781182969668'] },
    { id: 'st_link', name: 'Отримав посилання на оплату', order: 4, before: ['node_1779282332712'] },
    { id: 'st_paid', name: 'Оплатив', order: 5, before: ['node_1779282371687'] },
    { id: 'st_obj', name: 'Заперечення', order: 10, side: true, before: ['node_1779282259007'] },
    { id: 'st_soft', name: 'Не переконали після заперечення', order: 11, side: true, before: ['node_1779282299054'] },
    { id: 'st_nr', name: 'Не актуально', order: 12, side: true, before: ['node_1779282244891'] },
    { id: 'st_und', name: 'Думає', order: 13, side: true, optional: true, before: ['node_und_notify'] },
];

const PLANS = {
    'bot-course-main': () => [{ id: 'st_open', name: 'Відкрив бота', order: 1, before: ['msg_intro'] }],

    // Курс: вітання, потім етап на кожен урок (за міткою «Урок …» і наявністю вхідного ребра), фінал
    'bot-course-finance': (nodes, edges) => {
        const hasIn = new Set(edges.map((e) => e.target));
        const specs = [{ id: 'st_greet', name: 'Вітання', order: 1, before: ['node_1779227348471'] }];
        let i = 2;
        for (const n of nodes) {
            if (n.type === 'message' && lessonLabel(n) && hasIn.has(n.id)) {
                specs.push({ id: 'st_l_' + n.id, name: String(n.data.label).trim(), order: i++, before: [n.id] });
            }
        }
        specs.push({ id: 'st_done', name: 'Завершив курс', order: i, before: ['node_1779281037531'] });
        return specs;
    },

    // Продаж курсу (Ден): SPIN → презентація/офер → оплата
    'bot-sales-spin': () => [
        { id: 'st_open', name: 'Відкрив бота', order: 1, before: ['node_1779479959155'] },
        { id: 'st_dialog', name: 'Діалог завершено', order: 2, before: ['node_1779281753967'] },
        { id: 'st_offer', name: 'Побачив пропозицію курсу', order: 3, before: ['node_1778765671047', 'node_1779281781135'] },
        { id: 'st_link', name: 'Отримав посилання на оплату', order: 4, before: ['node_1778704438576'] },
        { id: 'st_paid', name: 'Оплатив', order: 5, before: ['node_1778765724813'] },
        { id: 'st_nr', name: 'Не зацікавлений', order: 12, side: true, before: ['node_1778765657506'] },
    ],

    'bot-sales-automation': DEN_SPIN('node_1779479944763'),
    'bot-karta-sales': DEN_SPIN('node_send_karta'),

    'sale-spin-content': SALE('n_spin', 'Діалог завершено'),
    'sale-demo-direct': SALE('n_q', 'Кваліфікацію пройдено'),
    'sale-audience-value': SALE('n_q', 'Діалог завершено', { id: 'st_portrait', name: 'Отримав портрет аудиторії', order: 2, before: ['n_deliver'] }),
    'sale-time-audit': SALE('n_collect', 'Отримав розрахунок'),
    'sale-cost-calc': SALE('n_collect', 'Отримав розрахунок'),

    // Task Tracker: серія постів → розмова з Олександром → заявка
    'task-tracker-sales-funnel': () => [
        { id: 'st_open', name: 'Відкрив воронку', order: 1, before: ['msg_intro'] },
        { id: 'st_solution', name: 'Побачив рішення', order: 2, before: ['node_1779990741242'] },
        { id: 'st_case', name: 'Побачив кейс', order: 3, before: ['node_1779990843928'] },
        { id: 'st_price', name: 'Побачив тарифи', order: 4, before: ['node_1779991401598'] },
        { id: 'st_talk', name: 'Розмова з Олександром', order: 5, before: ['node_1779991569084'] },
        { id: 'st_lead', name: 'Заявку передано', order: 6, before: ['node_1779990926425'] },
        { id: 'st_week', name: 'Повернувся через тиждень', order: 7, before: ['node_1779991606945'] },
    ],

    // Онбординг експерта (Ден збирає дані)
    'onboard-seller': () => [
        { id: 'st_open', name: 'Відкрив онбординг', order: 1, before: ['node_1792664034582'] },
        { id: 'st_saved', name: 'Дані зібрано і збережено', order: 2, before: ['node_1792430354713'] },
        { id: 'st_card', name: 'Картку запуску передано власнику', order: 3, before: ['node_1792136797647'] },
        { id: 'st_edit', name: 'Повторний вхід: зміни до даних', order: 10, side: true, before: ['node_1792664034618'] },
    ],
};

/** Чиста функція: додає ноди етапів за планом. Повертає { nodes, edges, added:[назви], skipped:[пояснення] }. */
function addStagesBySpec(nodesIn, edgesIn, specs) {
    const nodes = nodesIn.map((n) => ({ ...n }));
    const edges = edgesIn.map((e) => ({ ...e }));
    const added = []; const skipped = [];
    for (const sp of specs) {
        sp.before.forEach((targetId, idx) => {
            const nid = idx === 0 ? sp.id : sp.id + '_' + (idx + 1);
            if (nodes.some((n) => n.id === nid)) return; // уже є
            const target = nodes.find((n) => n.id === targetId);
            if (!target) { if (!sp.optional) skipped.push(sp.name + ': нема ноди ' + targetId); return; }
            const incoming = edges.filter((e) => e.target === targetId);
            if (!incoming.length) { skipped.push(sp.name + ': у ноди ' + targetId + ' нема вхідних ребер'); return; }
            nodes.push({
                id: nid, type: 'flowStage',
                position: { x: (target.position && target.position.x) || 0, y: ((target.position && target.position.y) || 0) - 70 },
                data: { label: 'Етап: ' + sp.name, stageName: sp.name, stageOrder: sp.order, ...(sp.side ? { side: true } : {}) },
            });
            for (const e of incoming) e.target = nid;
            edges.push({ id: 'es_' + nid + '__' + targetId, source: nid, target: targetId });
            added.push(sp.name);
        });
    }
    return { nodes, edges, added, skipped };
}

module.exports = { PLANS, addStagesBySpec };

if (require.main === module || process.env.RUN_PATCH === '1') { // RUN_PATCH=1: запуск через stdin (node -)
    const path = require('path'); const fs = require('fs');
    const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    const { db } = require('@platform/db');
    const DRY = !!process.env.DRY_RUN;
    const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
    const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/stage-backups-2026-10-27';
    (async () => {
        if (!DRY) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        for (const slug of Object.keys(PLANS)) {
            if (ONLY.length && !ONLY.includes(slug)) continue;
            const bot = await db.bot.findFirst({ where: { slug } });
            if (!bot) { console.log(slug + ': воронки нема, пропуск'); continue; }
            const flow = await db.flowDefinition.findUnique({ where: { botId: bot.id } });
            if (!flow) { console.log(slug + ': графа нема, пропуск'); continue; }
            const nodes = Array.isArray(flow.nodes) ? flow.nodes : []; const edges = Array.isArray(flow.edges) ? flow.edges : [];
            const r = addStagesBySpec(nodes, edges, PLANS[slug](nodes, edges));
            const sk = r.skipped.length ? ' | пропущено: ' + r.skipped.join('; ') : '';
            if (!r.added.length) { console.log(slug + ': нічого додавати' + sk); continue; }
            console.log(slug + ': ' + (DRY ? 'додав би ' : 'додано ') + r.added.length + ' етапів: ' + r.added.join(' · ') + sk);
            if (!DRY) {
                fs.writeFileSync(path.join(BACKUP_DIR, slug + '.json'), JSON.stringify({ botId: bot.id, nodes, edges }));
                await db.flowDefinition.update({ where: { botId: bot.id }, data: { nodes: r.nodes, edges: r.edges } });
            }
        }
        process.exit(0);
    })().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
}
