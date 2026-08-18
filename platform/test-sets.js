/* Тест наборів: тимчасово проставляє CT_1005 у товарі #13 (склад: 50001, 50002),
   ганяє 2 сценарії (весь комплект / одна позиція), тоді ПРИБИРАЄ поле назад. */
const { PrismaClient } = require('@prisma/client');
const { executeFlowStep } = require('/var/www/flows.fineko.space/platform/apps/api/src/services/testSession.js');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const SET_PRODUCT_ID = 13;      // «Накидки алькантара, ромб, весь салон» — граємо як «набір»
const COMPONENTS = '50001, 50002';  // Накидки на підголівники + Подушка під шию
const CAPTION = 'Комплект для салону 🚘 Все для комфорту. Артикул набору 40001';

async function keycrm(path, opts) {
  const rows = await db.funnelKey.findMany({ where: { botId: BOT }, select: { key: true, value: true } });
  const K = Object.fromEntries(rows.map(r => [r.key, r.value || '']));
  const base = (K.KEYCRM_API_BASE || 'https://openapi.keycrm.app/v1').replace(/\/$/, '');
  return fetch(base + path, { ...(opts || {}), headers: { Authorization: 'Bearer ' + (K.KEYCRM_API_TOKEN || '').trim(), Accept: 'application/json', 'Content-Type': 'application/json', ...((opts || {}).headers || {}) } });
}

async function setField(value) {
  const r = await keycrm('/products/' + SET_PRODUCT_ID, { method: 'PUT', body: JSON.stringify({ custom_fields: [{ uuid: 'CT_1005', value: value }] }) });
  const t = await r.text();
  console.log('CT_1005 =', JSON.stringify(value), '→ HTTP', r.status, t.slice(0, 120));
  return r.ok;
}

async function mkSession(tag) {
  const bot = await db.bot.findUnique({ where: { id: BOT }, select: { projectId: true } });
  let tid = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 999));
  const user = await db.user.create({ data: { telegramId: tid, firstName: 'Набір ' + tag, username: 'tset_' + tag, languageCode: 'uk', projectId: bot.projectId, metadata: { test: true } } });
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const startId = ((fd.nodes || []).find(n => n.type === 'start') || {}).id || 'start_1';
  return db.session.create({ data: { userId: user.id, botId: BOT, state: startId, isTest: true,
    context: { channel: 'zernio', testMode: true, igUsername: 'tset_' + tag, senderName: 'Набір ' + tag, conversationId: 'tset-' + tag + '-' + Date.now(),
      sharedPost: { kind: 'reel', caption: CAPTION }, currentNode: startId,
      flowRuntime: { currentNodeId: startId, waitingForUser: false, nodesVisited: [], lastUserMessage: '', dialogHistory: {} } } } });
}

async function run(tag, steps) {
  const s = await mkSession(tag);
  try { await executeFlowStep({ sessionId: s.id, incomingUserMessage: '' }); } catch (e) { console.log('  step0 err:', e.message); }
  for (const m of steps) { try { await executeFlowStep({ sessionId: s.id, incomingUserMessage: m }); } catch (e) { console.log('  err «' + m + '»:', e.message); } }
  const fresh = await db.session.findUnique({ where: { id: s.id } });
  const ctx = fresh.context || {};
  const msgs = await db.message.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'asc' } });
  console.log('\n─── ' + tag + ' ─── session ' + s.id);
  console.log('  setMode:', ctx.setMode, '| setPick:', JSON.stringify(ctx.setPick || null));
  console.log('  товар:', ctx.product ? ('#' + ctx.product.id + ' ' + ctx.product.name + ' — ' + ctx.product.price + ' грн | isSet=' + ctx.product.isSet) : '—');
  if (ctx.product && ctx.product.setList) console.log('  склад:', ctx.product.setList);
  if (ctx.supplierSetBreakdown) console.log('  розкладка постачальників:\n   ', String(ctx.supplierSetBreakdown).replace(/\n/g, '\n    '));
  console.log('  постачальник:', ctx.supplier, '| механізм:', ctx.supplierMechanism, '| crmOrderId:', ctx.crmOrderId || '—');
  for (const m of msgs) console.log('   ' + (m.role === 'user' ? '👤' : '🤖') + ' ' + ((m.metadata && m.metadata.nodeId) ? ('[' + m.metadata.nodeId + ']').padEnd(16) : ''.padEnd(16)) + ' ' + (m.content || '').replace(/\n/g, ' ⏎ ').slice(0, 110));
}

(async () => {
  if (!(await setField(COMPONENTS))) { console.log('не вдалось проставити CT_1005'); process.exit(1); }
  await new Promise(r => setTimeout(r, 2000));
  try {
    await run('WHOLE', ['Скільки коштує?', 'беру весь комплект', 'Темно-сірий', 'так', '2', 'Іваненко Петро, 0971234567, Київ, НП 12']);
    await run('ONEITEM', ['Що входить?', 'хочу тільки подушку під шию', 'так', '1', 'Ковальчук Марія, 0501112233, Львів, НП 5']);
  } finally {
    await setField('');   // ПРИБИРАЄМО тестове поле
  }
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
