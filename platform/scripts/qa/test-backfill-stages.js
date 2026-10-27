'use strict';
// Логіка бекфілу етапів на справжніх графах (FIXTURE=real-graphs.json) і синтетичних розмовах трьох типів даних.
const fs = require('fs');
const { PLANS } = require('../patch-funnel-stages-2026-10-27');
const { STAGES } = require('../patch-seller-stages-2026-10-27');
const { specsFor, inferStages, buildGraph } = require('../backfill-funnel-stages-2026-10-27');

const FIX = process.env.FIXTURE;
if (!FIX || !fs.existsSync(FIX)) { console.log('Потрібен FIXTURE=<real-graphs.json>'); process.exit(2); }
const G = JSON.parse(fs.readFileSync(FIX, 'utf8'));

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ПРОВАЛ: ' + m); } };
const names = (r) => [...r.stages.keys()].sort().join(' | ');
const T = (s) => new Date(s);

const slug = 'bot-sales-automation';
const g = G[slug];
const specs = specsFor(slug, g.nodes, g.edges, PLANS, STAGES);
const graph = buildGraph(g.nodes, g.edges);
const base = { id: 's', startedAt: T('2026-10-20T10:00:00Z'), lastActive: T('2026-10-21T12:00:00Z') };

console.log('тип 1: є записи проходження нод (з часом)');
let r = inferStages({ ...base, state: 'completed', context: { flowRuntime: { nodeTraces: [
    { nodeId: 'node_1779479944763', tsIso: '2026-10-20T10:00:05Z' },
    { nodeId: 'node_1779282229268', tsIso: '2026-10-20T10:05:00Z' },
    { nodeId: 'node_1779282313239', tsIso: '2026-10-20T10:05:01Z' },
    { nodeId: 'node_1779282332712', tsIso: '2026-10-20T10:05:02Z' },
] } } }, specs, graph);
ok(r.how === 'traces' && names(r) === 'Відкрив бота | Діалог завершено | Отримав посилання на оплату | Побачив пропозицію консультації', 'етапи за пройденими нодами');
ok(r.stages.get('Діалог завершено').firstAt.toISOString() === '2026-10-20T10:05:00.000Z', 'час етапу береться з запису ноди');

console.log('тип 2: лише список пройдених нод');
r = inferStages({ ...base, state: 'node_1779282215866', context: { flowRuntime: { nodesVisited: ['start_1', 'node_1779479944763', 'node_1779282215866'] } } }, specs, graph);
ok(r.how === 'visited' && names(r) === 'Відкрив бота', 'Вітання пройдено, діалог триває → лише «Відкрив бота»');
ok(r.stages.get('Відкрив бота').firstAt.getTime() === base.startedAt.getTime(), 'час приблизний: початок розмови');

console.log('тип 3: старий рушій, лише поточна нода');
r = inferStages({ ...base, state: 'node_1779282215866', context: { flowRuntime: { deliveryLog: [] } } }, specs, graph);
ok(r.how === 'state' && names(r) === 'Відкрив бота', 'зараз у SPIN-діалозі → лише «Відкрив бота»');
r = inferStages({ ...base, state: 'wait_payment_1779393779251', context: {} }, specs, graph);
ok(names(r) === 'Відкрив бота | Діалог завершено | Отримав посилання на оплату | Побачив пропозицію консультації', 'очікує оплату → пройшов пропозицію й отримав посилання, але ще не «Оплатив»');
ok(!r.stages.has('Оплатив') && !r.stages.has('Заперечення'), 'не вигадує «Оплатив» і гілку заперечення (вона не на кожному шляху)');
r = inferStages({ ...base, state: 'node_1779282340270', context: {} }, specs, graph);
ok(r.stages.has('Отримав посилання на оплату'), '«24 год до нагадування» (після посилання) → посилання отримано');
r = inferStages({ ...base, state: 'node_1781444187713', context: {} }, specs, graph); // Follow-up 1 після 24 год мовчання
ok(names(r) === 'Відкрив бота', 'follow-up після мовчання → лише «Відкрив бота»');

console.log('завершені без слідів і невідомі');
r = inferStages({ ...base, state: 'completed', context: {} }, specs, graph);
ok(r.how === 'completed-no-trace' && names(r) === 'Відкрив бота', 'завершена без слідів → лише «Відкрив бота»');
r = inferStages({ ...base, state: 'node_якась_видалена', context: {} }, specs, graph);
ok(names(r) === 'Відкрив бота', 'поточна нода зникла з графа → лише «Відкрив бота», без падіння');

console.log('курс: етап на урок');
const cs = specsFor('bot-course-finance', G['bot-course-finance'].nodes, G['bot-course-finance'].edges, PLANS, STAGES);
const cg = buildGraph(G['bot-course-finance'].nodes, G['bot-course-finance'].edges);
r = inferStages({ ...base, state: 'node_1779280335869', context: {} }, cs, cg); // Чекаю ДЗ — lesson 1.1
ok(names(r) === 'Вітання | Урок 1.1', 'чекає ДЗ уроку 1.1 → Вітання і Урок 1.1');
r = inferStages({ ...base, state: 'node_1779280466222', context: {} }, cs, cg); // Урок 2.1
ok(r.stages.has('Урок 1.1') && r.stages.has('Урок 1.2') && r.stages.has('Урок 2.1') && !r.stages.has('Урок 2.2'), 'зараз на уроці 2.1 → пройдено 1.1, 1.2, 2.1, але не 2.2');

console.log('шаблон продавця (етапи з іншого патча)');
const ss = specsFor('sell-ai-seller', [], [], PLANS, STAGES);
ok(ss.length === STAGES.length && ss.every((s) => s.targets.length === 1), 'специфікації продавця беруться зі STAGES');

console.log('\nПідсумок: ' + pass + ' ✔, ' + fail + ' ✘');
process.exit(fail ? 1 : 0);
