// Патч: розширення скрипту довіри (raніше — лише n_pay_collect) на решту діалогових кроків
// воронки. Власник підтвердив: "чи хочете, щоб той самий скрипт довіри спрацьовував на
// кожному кроці, а не лише на оплаті? - так".
//
// Механізм: кожна з нижче перелічених нод отримує ДОДАТКОВУ інструкцію в systemPrompt —
// коли клієнт виражає недовіру до передоплати ще ДО кроку оплати (напр. під час вибору
// розміру/кольору), нода НЕ намагається сама переконати чи вигадувати текст, а повертає
// json_output {"prepaymentObjection":true}. Сам скрипт (2-крокова ескалація, дослівний
// текст з n_pay_collect) і рахунок кроків (ctx.trustScriptStep) — обробляє ДВИГУН
// (apps/api/src/services/testSession.js, універсальний хендлер поряд з paymentMethodChange/
// colorUnavailable/handoff) — той самий "single source of truth" підхід, не дублюємо текст
// скрипту в кожному промпті.
//
// Ідемпотентно: анкер-based replace, guard на !/prepaymentObjection/.test(...).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BOT_IDS = [
  'fcdee415-bef2-4a74-a650-e6e4b5a12322', // goverla_shop — основний магазин (Zernio), production
];

const CLAUSE = '\nЯКЩО клієнт виражає НЕДОВІРУ до передоплати/оплати наперед (боїться шахрайства, «не вірю інтернет-магазинам», «спочатку отримаю — потім заплачу», «звідки я знаю, що ви не обманете») — НЕ намагайся сама переконати чи пояснювати правила оплати: поверни РІВНО json_output {"prepaymentObjection":true} (без тексту, без інших полів) — систему сама покаже перевірений скрипт довіри.';

// { nodeId: анкер-рядок (унікальний підрядок наприкінці релевантного речення), після якого вставляємо CLAUSE }
const TARGETS = {
  n_size: 'handoff — ЛИШЕ на явне прохання живої людини, претензію чи скаргу.',
  n_color: 'handoff — ЛИШЕ на явне прохання живої людини, претензію чи скаргу.',
  n_order_intent: 'Просить живу людину/менеджера явно («покличте менеджера», «ви бот?») → {"handoff":true} (без ready).',
  n_collect: 'Явно просить живу людину → {"handoff":true}. Не згадуй сайтів.',
};

async function patchBot(botId) {
  const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
  if (!flow) { console.log(botId, '— НЕМАЄ flowDefinition, пропускаю'); return; }
  const nodes = flow.nodes || [];
  let changed = false;
  const outNodes = nodes.map((n) => {
    const anchor = TARGETS[n.id];
    if (!anchor) return n;
    const sp = (n.data && n.data.systemPrompt) || '';
    if (!sp) { console.log(botId, n.id, '— немає systemPrompt, пропускаю'); return n; }
    if (/prepaymentObjection/.test(sp)) { console.log(botId, n.id, '= вже застосовано (пропускаю)'); return n; }
    const idx = sp.indexOf(anchor);
    if (idx === -1) { console.log(botId, n.id, '⚠️ анкер не знайдено — ПРОПУСКАЮ (промпт міг змінитись, перевірити вручну)'); return n; }
    const insertAt = idx + anchor.length;
    const newSp = sp.slice(0, insertAt) + CLAUSE + sp.slice(insertAt);
    changed = true;
    console.log(botId, n.id, '~ вставлено clause після анкера');
    return Object.assign({}, n, { data: Object.assign({}, n.data, { systemPrompt: newSp }) });
  });
  if (!changed) { console.log(botId, '— без змін'); return; }
  await prisma.flowDefinition.update({ where: { botId }, data: { nodes: outNodes } });
  console.log(botId, '✅ застосовано');
}

(async () => {
  for (const botId of BOT_IDS) await patchBot(botId);
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());
