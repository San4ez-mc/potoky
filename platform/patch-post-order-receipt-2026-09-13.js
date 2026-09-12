// Патч: детект чека/квитанції (Monobank/ПриватБанк/Portmone/check.gov.ua) у повідомленні
// клієнта ПІСЛЯ оформлення замовлення. Живий баг (владелец, "🌚"/john_titor_01_, знайдено
// агентом-розслідувачем): n_reconcile (єдине місце, що розпізнає check.monobank.ua тощо) сидить
// ЛИШЕ на pre-order шляху очікування оплати — щойно crmOrderId проставлено, ВСІ повідомлення
// клієнта йдуть через n_post_order_cond (чисто булевий стан, контент не дивиться) прямо в
// генеричне "Ваше замовлення в роботі" — чек від клієнта повністю ігнорувався змістовно.
//
// Обсяг НАВМИСНО простий (як return-flow): не повторюємо повну reconciliation-логіку
// n_reconcile (та зав'язана на очікування оплати, тут вона вже неактуальна) — детермінований
// regex-детект + подяка клієнту + сигнал менеджеру З ПОСИЛАННЯМ (де менеджер сам звірить чек
// вручну, як і робив раніше судячи з реальних сесій).
//
// Вставка: n_post_order_cond --true--> n_post_order_receipt_cond --true--> receipt-гілка
//                                                            \--false--> n_return_intent_cond (як було)

const { PrismaClient } = require('@prisma/client');
const { computeAutoLayout } = require('@platform/flow-layout');
const prisma = new PrismaClient();

const BOT_IDS = ['fcdee415-bef2-4a74-a650-e6e4b5a12322'];

const NEW_NODES = [
  {
    id: 'n_post_order_receipt_cond',
    type: 'condition',
    data: {
      label: '1.845 Чек/квитанція після оформлення?',
      condition: "/check\\.monobank\\.ua|send\\.monobank\\.ua|pay\\.mono\\.ua|privatbank\\.ua|next\\.privat24\\.ua|portmone\\.com\\.ua|check\\.gov\\.ua/i.test(String(input || context.lastCustomerMessage || ''))",
      description: 'TRUE → подяка + сигнал менеджеру з посиланням на чек (n_reconcile не дістає сюди — той лише на pre-order шляху). FALSE → стара поведінка (n_return_intent_cond).',
    },
  },
  {
    id: 'n_post_order_receipt_msg',
    type: 'message',
    data: {
      label: '1.846 Чек: подяка клієнту',
      text: 'Дякуємо! Отримали підтвердження оплати — зараз передамо менеджеру на перевірку 🙏',
      variants: [],
      description: 'Клієнт скинув посилання на чек (Monobank/ПриватБанк/Portmone/check.gov.ua) уже ПІСЛЯ оформлення замовлення.',
    },
  },
  {
    id: 'n_post_order_receipt_admin',
    type: 'notifyTg',
    data: {
      label: '1.847 Сигнал: чек після оформлення',
      message: '🧾 <b>Чек після оформлення</b> — замовлення {{context.orderRef}} (CRM {{context.crmOrderId}})\n\n👤 {{context.senderName}} ({{context.igUsername}})\n🔗 {{context.lastCustomerMessage}}\n\nПеревірте вручну — чи стосується цей чек саме цього замовлення.',
      targetKey: 'ADMIN_TELEGRAM_ID',
      alertTitle: '🧾 Чек після оформлення',
      alertMain: 'Клієнт скинув посилання на чек уже після оформлення замовлення — звірте вручну.',
      description: 'Термінальний сигнал — n_reconcile сюди не дістає (той лише на pre-order шляху очікування оплати).',
    },
  },
];

async function patchBot(botId) {
  const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
  if (!flow) { console.log(botId, '— НЕМАЄ flowDefinition, пропускаю'); return; }
  const nodes = flow.nodes || [];
  const edges = flow.edges || [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  if (!nodeIds.has('n_post_order_cond')) { console.log(botId, '— немає n_post_order_cond, пропускаю'); return; }

  let changed = false;
  const outNodes = nodes.slice();
  for (const n of NEW_NODES) {
    const idx = outNodes.findIndex((x) => x.id === n.id);
    if (idx === -1) { outNodes.push(Object.assign({ position: { x: 0, y: 0 } }, n)); changed = true; console.log(botId, '+ node', n.id); }
    else {
      const mergedData = Object.assign({}, outNodes[idx].data, n.data);
      if (JSON.stringify(outNodes[idx].data) !== JSON.stringify(mergedData)) { outNodes[idx] = Object.assign({}, outNodes[idx], { data: mergedData }); changed = true; console.log(botId, '~ node дані оновлено', n.id); }
      else console.log(botId, '= node вже актуальна', n.id);
    }
  }

  // Перепідключення: n_post_order_cond --true--> (стара ціль) стає n_post_order_cond --true--> n_post_order_receipt_cond
  let outEdges = edges.slice();
  const oldEdgeIdx = outEdges.findIndex((e) => e.source === 'n_post_order_cond' && (e.sourceHandle === 'true' || e.sourceHandle === undefined) && e.target !== 'n_post_order_receipt_cond');
  let oldTarget = null;
  if (oldEdgeIdx !== -1) {
    oldTarget = outEdges[oldEdgeIdx].target;
    outEdges[oldEdgeIdx] = Object.assign({}, outEdges[oldEdgeIdx], { target: 'n_post_order_receipt_cond' });
    changed = true;
    console.log(botId, '~ перенаправлено n_post_order_cond -> ' + oldTarget + ' на -> n_post_order_receipt_cond');
  }
  const NEW_EDGES = [
    { id: 'edge_receipt_1', source: 'n_post_order_receipt_cond', target: 'n_post_order_receipt_msg', sourceHandle: 'true' },
    { id: 'edge_receipt_2', source: 'n_post_order_receipt_cond', target: oldTarget || 'n_return_intent_cond', sourceHandle: 'false' },
    { id: 'edge_receipt_3', source: 'n_post_order_receipt_msg', target: 'n_post_order_receipt_admin' },
  ];
  const existingEdgeKeys = new Set(outEdges.map((e) => e.source + '>>' + e.target + '>>' + (e.sourceHandle || '')));
  for (const e of NEW_EDGES) {
    const key = e.source + '>>' + e.target + '>>' + (e.sourceHandle || '');
    if (!existingEdgeKeys.has(key)) { outEdges.push(e); changed = true; console.log(botId, '+ edge', e.source, '->', e.target, e.sourceHandle || ''); }
    else console.log(botId, '= edge вже є', e.source, '->', e.target);
  }

  if (!changed) { console.log(botId, '— без змін'); return; }
  const laidOut = computeAutoLayout(outNodes, outEdges);
  await prisma.flowDefinition.update({ where: { botId }, data: { nodes: laidOut, edges: outEdges } });
  console.log(botId, '✅ застосовано, вузлів:', laidOut.length, 'ребер:', outEdges.length);
}

(async () => {
  for (const botId of BOT_IDS) await patchBot(botId);
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());
