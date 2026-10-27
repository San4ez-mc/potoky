'use strict';
// Перевірка патча етапів Дена на структурі графа шаблону tpl-expert-seller (ідентифікатори й ребра як у реальному).
const { addStages, STAGES } = require('../patch-seller-stages-2026-10-27');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ПРОВАЛ: ' + m); } };

const ids = ['start_1', 'n_load', 'n_gate', 'n_err_notify', 'n_err_msg', 'n_blocked_msg', 'n_lead', 'n_greet', 'n_spin', 'n_outcome', 'n_nr_msg', 'n_obj', 'n_obj_cond', 'n_soft_msg', 'n_dir_notify', 'n_dir_msg', 'n_und_notify', 'n_und_msg', 'n_und_wait', 'n_und_nudge', 'n_offer', 'n_hot_notify', 'n_mode', 'n_pay', 'n_pay_test', 'n_pay_msg', 'n_pay_wait', 'n_paid_msg', 'n_paid_notify', 'n_after', 'n_after_end'];
const nodes = ids.map((id, i) => ({ id, type: 'x', data: {}, position: { x: 0, y: i * 100 } }));
const E = [['start_1', 'n_load'], ['n_load', 'n_gate'], ['n_gate', 'n_err_notify'], ['n_gate', 'n_blocked_msg'], ['n_gate', 'n_lead'], ['n_err_notify', 'n_err_msg'], ['n_lead', 'n_greet'], ['n_greet', 'n_spin'], ['n_spin', 'n_outcome'],
    ['n_outcome', 'n_nr_msg'], ['n_outcome', 'n_obj'], ['n_outcome', 'n_dir_notify'], ['n_outcome', 'n_und_notify'], ['n_outcome', 'n_offer'], ['n_outcome', 'n_und_notify'], ['n_obj', 'n_obj_cond'], ['n_obj_cond', 'n_soft_msg'], ['n_obj_cond', 'n_offer'],
    ['n_dir_notify', 'n_dir_msg'], ['n_und_notify', 'n_und_msg'], ['n_und_msg', 'n_und_wait'], ['n_und_wait', 'n_und_nudge'], ['n_offer', 'n_hot_notify'], ['n_hot_notify', 'n_mode'], ['n_mode', 'n_pay'], ['n_mode', 'n_pay_test'], ['n_mode', 'n_after'],
    ['n_pay_test', 'n_paid_msg'], ['n_pay', 'n_pay_msg'], ['n_pay_msg', 'n_pay_wait'], ['n_pay_wait', 'n_paid_msg'], ['n_paid_msg', 'n_paid_notify'], ['n_after', 'n_after_end']];
const edges = E.map(([s, t], i) => ({ id: 'e' + i, source: s, target: t }));

const r = addStages(nodes, edges);
ok(r.added.length === STAGES.length, 'додано всі ' + STAGES.length + ' етапів');
ok(r.nodes.filter((n) => n.type === 'flowStage').length === STAGES.length, 'нод flowStage стільки ж');
ok(nodes.length === ids.length && edges.length === E.length, 'вхідні масиви не змінено');
ok(r.edges.length === E.length + STAGES.length, 'ребер: старі + по одному на етап');

// порядок і зміст старих ребер збережено: змінилися лише цілі, які мають етап перед собою
const stageBefore = Object.fromEntries(STAGES.map((s) => [s.before, s.id]));
let same = true;
for (let i = 0; i < edges.length; i++) {
    const exp = stageBefore[edges[i].target] || edges[i].target;
    if (r.edges[i].id !== edges[i].id || r.edges[i].source !== edges[i].source || r.edges[i].target !== exp) same = false;
}
ok(same, 'порядок і джерела старих ребер не змінились (важливо для умов), цілі переспрямовано на етапи');

const out = (from) => r.edges.filter((e) => e.source === from).map((e) => e.target);
ok(out('n_lead').join() === 'st_open' && out('st_open').join() === 'n_greet', 'Лід → Відкрив бота → Вітання');
ok(out('n_spin').join() === 'st_dialog' && out('st_dialog').join() === 'n_outcome', 'Діалог → Діалог завершено → Результат');
ok(out('n_outcome').join() === 'st_nr,st_obj,st_dir,st_und,st_offer,st_und', 'умова «Результат»: ті самі 6 виходів у тому ж порядку, кожен через свій етап');
ok(r.edges.filter((e) => e.target === 'st_offer').map((e) => e.source).sort().join() === 'n_obj_cond,n_outcome', 'етап «Побачив пропозицію» отримує обидва шляхи (з діалогу і після заперечення)');
ok(out('n_hot_notify').join() === 'n_mode' && out('n_offer').join() === 'st_hot', 'пропозиція → гарячий лід → сповіщення');
ok(r.edges.filter((e) => e.target === 'st_paid').length === 1 && out('st_paid').join() === 'n_paid_notify', 'Оплатив стоїть перед сповіщенням про оплату');
ok(r.nodes.filter((n) => n.data.side).length === 5, '5 бічних виходів позначені side');

const r2 = addStages(r.nodes, r.edges);
ok(r2.added.length === 0 && r2.nodes.length === r.nodes.length && r2.edges.length === r.edges.length, 'повторний запуск нічого не додає (ідемпотентність)');

// клон зі старішим графом, де немає частини нод: не падає
const r3 = addStages(nodes.filter((n) => n.id !== 'n_paid_notify'), edges.filter((e) => e.target !== 'n_paid_notify' && e.source !== 'n_paid_notify'));
ok(r3.added.length === STAGES.length - 1 && !r3.added.includes('Оплатив'), 'немає ноди-цілі → етап пропускається без помилки');

console.log('\nПідсумок: ' + pass + ' ✔, ' + fail + ' ✘');
process.exit(fail ? 1 : 0);
