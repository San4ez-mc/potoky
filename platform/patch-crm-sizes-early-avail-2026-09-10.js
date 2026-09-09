'use strict';
/*
 * Доповнення до синхронізації з новою моделлю розмірів CRM (569e00c, 9d19167) — goverla-crm +
 * covercar-crm. ДЖЕРЕЛО ІСТИНИ для цієї конкретної зміни (fineko-funnel-standard §8): постійна
 * зміна воронки живе тут як окремий idempotent-патч, а не лише разовим прямим записом у БД —
 * щоб її можна було відтворити, якщо канонічний patch-goverla-crm-audit-2026-09-04.js колись
 * перезапише той самий шматок графа (це вже траплялось раз із funnelStage stageOrder).
 *
 * Що робить:
 *  1) Оновлює data.code нод n_lookup/n_avail на актуальний вміст n_lookup-crm-code.js/
 *     n_avail-code.js (нова модель: offer=колір, Product.sizes+offer.effectiveSizes).
 *  2) Власника: "перевірку наявності додай одразу після того, як людина написала параметри,
 *     воронка визначає розмір, а потім одразу перевіряє наявність і відписує про це" — додає
 *     n_avail_early (той самий код, що n_avail) + n_avail_early_cond одразу після n_size_reply,
 *     ДО n_has_colors: клієнт дізнається про розмір і одразу — чи він десь є, ще до вибору
 *     кольору. n_avail (після кольору) лишається як фінальна перевірка перед оформленням.
 *     Маршрутизація: available:true → n_has_colors (як і раніше); available:false (завжди
 *     availReason:'no_stock' на цьому кроці, бо колір ще не обраний) → n_avail_kind_cond →
 *     n_avail_stock_msg (те саме повідомлення "товар закінчився", що й у фінальній перевірці).
 *
 * ЗАПУСК:  node patch-crm-sizes-early-avail-2026-09-10.js            (dry-run, друкує план)
 *          node patch-crm-sizes-early-avail-2026-09-10.js --apply    (записує у БД)
 * Ідемпотентний (маркер: нода n_avail_early) — повторний запуск нічого не ламає.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');
const { computeAutoLayout } = require('./packages/flowLayout');
const db = new PrismaClient();

const BOTS = [
  { name: 'goverla-crm', botId: 'fcdee415-bef2-4a74-a650-e6e4b5a12322' },
  { name: 'covercar-crm', botId: 'a2d5ba79-f87b-48f2-8301-56292cdf3972' },
];

function readCode(f) { return fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, ''); }
const LOOKUP_CODE = readCode('n_lookup-crm-code.js');
const AVAIL_CODE = readCode('n_avail-code.js');

function transform(fd, log) {
  const nodes = fd.nodes.map((n) => ({ ...n }));
  const edges = fd.edges.map((e) => ({ ...e }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const notes = [];

  // 1) Синхронізація коду двох існуючих нод.
  if (byId.n_lookup) { if (byId.n_lookup.data.code !== LOOKUP_CODE) { byId.n_lookup.data.code = LOOKUP_CODE; notes.push('n_lookup: код оновлено'); } }
  else notes.push('⚠️ n_lookup не знайдено');
  if (byId.n_avail) { if (byId.n_avail.data.code !== AVAIL_CODE) { byId.n_avail.data.code = AVAIL_CODE; notes.push('n_avail: код оновлено'); } }
  else notes.push('⚠️ n_avail не знайдено');

  // 2) Ранній чек наявності — ІДЕМПОТЕНТНІСТЬ: якщо n_avail_early вже є, нічого не додаємо вдруге.
  if (byId.n_avail_early) {
    notes.push('n_avail_early вже існує — секцію 2 пропускаю (лише синхронізація коду вище)');
    if (byId.n_avail_early.data.code !== AVAIL_CODE) { byId.n_avail_early.data.code = AVAIL_CODE; notes.push('n_avail_early: код оновлено'); }
    return { nodes, edges, notes };
  }
  if (!byId.n_size_reply || !byId.n_has_colors || !byId.n_avail_kind_cond) {
    notes.push('⚠️ n_size_reply/n_has_colors/n_avail_kind_cond відсутні — секцію 2 пропускаю (граф інший, ніж очікувалось)');
    return { nodes, edges, notes };
  }

  // Позиції — плейсхолдер; §3.9 стандарту: після batch add_node/create_edge завжди
  // computeAutoLayout (нижче), а не підбір x/y на око.
  nodes.push({
    id: 'n_avail_early',
    type: 'js',
    data: {
      code: AVAIL_CODE,
      label: '6.05 Наявність за розміром (до вибору кольору)',
      description: 'Той самий код, що n_avail — тут виконується одразу після підбору розміру, ще до вибору кольору (власник: "визначили розмір → одразу перевірити наявність і сказати клієнту"). Без обраного кольору код перевіряє, чи є chosenSize хоч в ОДНОМУ кольорі.',
    },
    measured: { width: 320, height: 92 },
    position: { x: 0, y: 0 },
  });
  nodes.push({
    id: 'n_avail_early_cond',
    type: 'condition',
    data: {
      label: '6.06 Розмір десь у наявності?',
      condition: 'context.available === true',
      description: 'TRUE → нормальний плин, питаємо колір (n_has_colors). FALSE → на цьому кроці колір ще не обирали, тож availReason завжди no_stock → n_avail_kind_cond поведе на n_avail_stock_msg (те саме "товар закінчився", що й у фінальній перевірці).',
    },
    measured: { width: 320, height: 92 },
    position: { x: 0, y: 0 },
  });

  const withoutOldEdge = edges.filter((e) => !(e.source === 'n_size_reply' && e.target === 'n_has_colors' && !e.sourceHandle));
  if (withoutOldEdge.length === edges.length) notes.push('⚠️ ребро n_size_reply → n_has_colors не знайдено (граф інший?) — все одно додаю нові ребра');
  edges.length = 0;
  edges.push(...withoutOldEdge);
  edges.push({ id: 'e_n_size_reply_n_avail_early', source: 'n_size_reply', target: 'n_avail_early' });
  edges.push({ id: 'e_n_avail_early_n_avail_early_cond', source: 'n_avail_early', target: 'n_avail_early_cond' });
  edges.push({ id: 'e_n_avail_early_cond_n_has_colors_true', source: 'n_avail_early_cond', target: 'n_has_colors', sourceHandle: 'true' });
  edges.push({ id: 'e_n_avail_early_cond_n_avail_kind_cond_false', source: 'n_avail_early_cond', target: 'n_avail_kind_cond', sourceHandle: 'false' });
  notes.push('додано n_avail_early + n_avail_early_cond, перемкнуто n_size_reply → n_avail_early');

  // §3.9 стандарту: після batch add_node/create_edge — завжди auto_layout, ніколи x/y на око.
  const laidOut = computeAutoLayout(nodes, edges);
  notes.push('computeAutoLayout застосовано до всього графа');
  return { nodes: laidOut, edges, notes };
}

async function main() {
  const apply = process.argv.includes('--apply');
  for (const bot of BOTS) {
    const fd = await db.flowDefinition.findUnique({ where: { botId: bot.botId } });
    if (!fd) { console.log(bot.name + ': FlowDefinition не знайдено, пропускаю'); continue; }
    const { nodes, edges, notes } = transform(fd, console.log);
    console.log('=== ' + bot.name + ' ===');
    notes.forEach((n) => console.log('  ' + n));
    if (apply) {
      await db.flowDefinition.update({ where: { botId: bot.botId }, data: { nodes, edges } });
      console.log('  -> ЗАПИСАНО');
    } else {
      console.log('  (dry-run — щоб записати, запустіть з --apply)');
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
