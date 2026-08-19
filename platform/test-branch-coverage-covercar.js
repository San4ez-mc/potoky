/* Точкове покриття кожної гілки (32 ребра з 16 condition-нод), яких не торкають
   наскрізні сценарії (test-regression-covercar.js). Пряма ін'єкція currentNodeId+context
   ізолює конкретну гілку без проходження всього діалогу до неї. testMode:true скрізь,
   де це не сама мета тесту (безпечно — жодних реальних побічних дій). */
const { PrismaClient } = require('@prisma/client');
const { executeFlowStep } = require('/var/www/flows.fineko.space/platform/apps/api/src/services/testSession.js');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const results = [];
const ok = (id, name, pass, info) => { results.push({ id, name, pass: !!pass, info: info || '' }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ' ' + name + (info ? ('  — ' + info) : '')); };

async function mkAt(tag, nodeId, ctx) {
  const bot = await db.bot.findUnique({ where: { id: BOT }, select: { projectId: true } });
  let tid = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 99999));
  let user = null;
  for (let i = 0; i < 5 && !user; i++) {
    try { user = await db.user.create({ data: { telegramId: tid, firstName: 'Branch ' + tag, username: 'bc_' + tag.toLowerCase() + '_' + Date.now(), languageCode: 'uk', projectId: bot.projectId, metadata: { test: true, branchcov: true } } }); }
    catch (e) { if (e.code === 'P2002') tid += 1n; else throw e; }
  }
  return db.session.create({ data: { userId: user.id, botId: BOT, state: nodeId, isTest: true,
    context: Object.assign({ channel: 'zernio', testMode: true, igUsername: 'bc_' + tag, senderName: 'Branch ' + tag,
      conversationId: 'bc-' + tag + '-' + Date.now(), currentNode: nodeId,
      flowRuntime: { currentNodeId: nodeId, waitingForUser: false, nodesVisited: [], lastUserMessage: '', dialogHistory: {} } }, ctx || {}) } });
}
async function step(sid, msg) { try { await executeFlowStep({ sessionId: sid, incomingUserMessage: msg || '' }); } catch (e) { console.log('   err: ' + e.message); } }
const fresh = async (sid) => (await db.session.findUnique({ where: { id: sid } })).context || {};
// Condition-ноди одразу ланцюжком ведуть далі (нема паузи) — беремо трейс САМЕ цієї
// ноди за id, а не останній запис (інакше зчитаємо вже наступну ноду в ланцюжку).
const findTrace = (rt, nodeId) => (rt.nodeTraces || []).find((x) => x.nodeId === nodeId) || {};

(async () => {
  // ── n_upsell_cond: true (product has upsell) / false (без допродажу) ──
  let s = await mkAt('UPS-T', 'n_upsell_cond', { product: { id: 13, name: 'Набір', price: 3490, upsell: 'Подушка — 390 грн' } });
  await step(s.id);
  let c = await fresh(s.id); let t = findTrace(c.flowRuntime, 'n_upsell_cond');
  ok('BR-UPSELL-T', 'upsell_cond true -> n_upsell_msg', t.branch === 'true' && t.branchTarget === 'n_upsell_msg', t.branch + '->' + t.branchTarget);

  s = await mkAt('UPS-F', 'n_upsell_cond', { product: { id: 18, name: 'Тестова оплата', price: 1 } });
  await step(s.id);
  c = await fresh(s.id); t = findTrace(c.flowRuntime, 'n_upsell_cond');
  ok('BR-UPSELL-F', 'upsell_cond false -> n_order_intent', t.branch === 'false' && t.branchTarget === 'n_order_intent', t.branch + '->' + t.branchTarget);

  // ── n_is_clothing: true (є розмір) / false (нема) ──
  s = await mkAt('CLOTH-T', 'n_is_clothing', { product: { id: 17, name: 'Органайзер', price: 1690, isClothing: true, sizes: ['S', 'M', 'L', 'XL'] } });
  await step(s.id);
  c = await fresh(s.id); t = findTrace(c.flowRuntime, 'n_is_clothing');
  ok('BR-CLOTH-T', 'is_clothing true -> n_size', t.branch === 'true' && t.branchTarget === 'n_size', t.branch + '->' + t.branchTarget);

  s = await mkAt('CLOTH-F', 'n_is_clothing', { product: { id: 13, name: 'Набір', price: 3490, isClothing: false, sizes: [] } });
  await step(s.id);
  c = await fresh(s.id); t = findTrace(c.flowRuntime, 'n_is_clothing');
  ok('BR-CLOTH-F', 'is_clothing false -> n_has_colors', t.branch === 'false' && t.branchTarget === 'n_has_colors', t.branch + '->' + t.branchTarget);

  // ── n_avail_cond: false (немає в наявності — колір розібрали) ──
  s = await mkAt('AVAIL-F', 'n_avail', { product: { id: 13, name: 'Набір', offers: [{ sku: 'x', properties: [{ name: 'Колір', value: 'Синій' }], available: false }] }, colorChoice: { color: 'Синій' } });
  await step(s.id);
  c = await fresh(s.id);
  ok('BR-AVAIL-F', 'available=false обчислено (n_avail)', c.available === false, 'available=' + c.available);

  // ── n_size_oor: true (поза сіткою) / false (у межах) ──
  s = await mkAt('OOR-T', 'n_calc', { product: { id: 17, name: 'Органайзер', sizes: ['S', 'M', 'L', 'XL'] }, sizeInput: { height: 90, weight: 20 } });
  await step(s.id);
  c = await fresh(s.id);
  ok('BR-OOR-T', 'sizeOutOfRange true для 90см/20кг', c.sizeOutOfRange === true, JSON.stringify({ sizeOutOfRange: c.sizeOutOfRange, reason: c.sizeOorReason }));
  await step(s.id); // n_size_oor -> перевірити гілку
  c = await fresh(s.id); const t2 = (c.flowRuntime.nodeTraces || []).find(x => x.nodeId === 'n_size_oor');
  ok('BR-OOR-T2', 'n_size_oor true -> n_size_oor_msg', t2 && t2.branch === 'true' && t2.branchTarget === 'n_size_oor_msg', t2 ? (t2.branch + '->' + t2.branchTarget) : 'no trace');

  s = await mkAt('OOR-F', 'n_calc', { product: { id: 17, name: 'Органайзер', sizes: ['S', 'M', 'L', 'XL'] }, sizeInput: { height: 175, weight: 70 } });
  await step(s.id);
  c = await fresh(s.id);
  ok('BR-OOR-F', 'sizeOutOfRange false для 175см/70кг', c.sizeOutOfRange === false, 'recommendedSize=' + c.recommendedSize);

  // ── n_supplier_cond / _ed / _cart / _manual: усі 4 механізми ──
  const mechs = [
    ['brewdrop.in.ua', 'brewdrop', 'n_supplier_order'],
    ['easydrop', 'easydrop_offline', 'n_supplier_order_ed'],
    ['Zaxid_drop', 'easydrop_cart', 'n_supplier_order_cart'],
    ['по накидках', 'manual', 'n_supplier_manual'],
  ];
  for (const [supplier, mechExpected, nodeExpected] of mechs) {
    s = await mkAt('SUP-' + mechExpected, 'n_supplier_route', { supplier, product: { id: 13, name: 'Набір', price: 1 }, orderData: { fullName: 'Тест Тестов', phone: '0000000000', city: 'Київ', branch: '1' } });
    await step(s.id);
    c = await fresh(s.id);
    const routeTrace = (c.flowRuntime.nodeTraces || []).find(x => x.nodeId === 'n_supplier_route');
    const mechOk = c.supplierMechanism === mechExpected;
    ok('BR-SUP-' + mechExpected, 'постачальник «' + supplier + '» -> механізм ' + mechExpected, mechOk, 'supplierMechanism=' + c.supplierMechanism);
  }

  // ── n_ttn_cond: true (є ТТН) / false (нема) ──
  s = await mkAt('TTN-T', 'n_ttn_cond', { supplierTtn: '20450123456789' });
  await step(s.id);
  c = await fresh(s.id); t = findTrace(c.flowRuntime, 'n_ttn_cond');
  ok('BR-TTN-T', 'ttn true -> n_ttn_client', t.branch === 'true' && t.branchTarget === 'n_ttn_client', t.branch + '->' + t.branchTarget);

  s = await mkAt('TTN-F', 'n_ttn_cond', { supplierTtn: '' });
  await step(s.id);
  c = await fresh(s.id); t = findTrace(c.flowRuntime, 'n_ttn_cond');
  ok('BR-TTN-F', 'ttn false -> n_confirm', t.branch === 'false' && t.branchTarget === 'n_confirm', t.branch + '->' + t.branchTarget);

  // ── n_np_gate: true (уточнити область — Шевченкове) / false (Одеса, однозначно) ──
  s = await mkAt('NP-T', 'n_np_check', { orderData: { city: 'Шевченкове', fullName: 'Тест Тестов', phone: '0000000000', branch: '1' } });
  await step(s.id);
  c = await fresh(s.id);
  ok('BR-NP-T', 'Шевченкове -> np.ask=true (кілька нас. пунктів)', c.np && c.np.ask === true, JSON.stringify(c.np || {}).slice(0, 150));

  s = await mkAt('NP-F', 'n_np_check', { orderData: { city: 'Одеса', fullName: 'Тест Тестов', phone: '0000000000', branch: '5' } });
  await step(s.id);
  c = await fresh(s.id);
  ok('BR-NP-F', 'Одеса -> np.ask=false (однозначно)', c.np && c.np.ask === false, JSON.stringify(c.np || {}).slice(0, 150));

  // ── n_is_set: true (набір) / false (звичайний товар) ──
  s = await mkAt('SET-T', 'n_is_set', { product: { id: 13, name: 'Набір', isSet: true, setList: 'A — 1грн; B — 2грн' } });
  await step(s.id);
  c = await fresh(s.id); t = findTrace(c.flowRuntime, 'n_is_set');
  ok('BR-SET-T', 'is_set true -> n_set_choice', t.branch === 'true' && t.branchTarget === 'n_set_choice', t.branch + '->' + t.branchTarget);

  s = await mkAt('SET-F', 'n_is_set', { product: { id: 9, name: 'Накидки', isSet: false } });
  await step(s.id);
  c = await fresh(s.id); t = findTrace(c.flowRuntime, 'n_is_set');
  ok('BR-SET-F', 'is_set false -> n_is_clothing', t.branch === 'false' && t.branchTarget === 'n_is_clothing', t.branch + '->' + t.branchTarget);

  // ── n_has_photo: true / false ──
  s = await mkAt('PH-T', 'n_has_photo', { product: { id: 9, name: 'Накидки', photoUrl: 'https://example.com/x.jpg' } });
  await step(s.id);
  c = await fresh(s.id); t = findTrace(c.flowRuntime, 'n_has_photo');
  ok('BR-PHOTO-T', 'has_photo true -> n_photo', t.branch === 'true' && t.branchTarget === 'n_photo', t.branch + '->' + t.branchTarget);

  s = await mkAt('PH-F', 'n_has_photo', { product: { id: 18, name: 'Тестова оплата', photoUrl: '' } });
  await step(s.id);
  c = await fresh(s.id); t = findTrace(c.flowRuntime, 'n_has_photo');
  ok('BR-PHOTO-F', 'has_photo false -> n_welcome', t.branch === 'false' && t.branchTarget === 'n_welcome', t.branch + '->' + t.branchTarget);

  // ── claude handoff: n_color 3 невдалі спроби поспіль ──
  s = await mkAt('COLOR-HO', 'n_color', { product: { id: 13, name: 'Набір', desc: '-', price: 100, colors: 'Синій, Червоний' } });
  await step(s.id, 'га?');
  await step(s.id, 'шо?');
  await step(s.id, 'незрозуміло');
  c = await fresh(s.id);
  ok('BR-COLOR-HANDOFF', '3 незрозумілі відповіді -> handoff', !!c.adminEngaged, 'adminEngaged=' + c.adminEngaged);

  console.log('\n===== ПІДСУМОК =====');
  const bad = results.filter(r => !r.pass);
  console.log('усього ' + results.length + ' | PASS ' + (results.length - bad.length) + ' | FAIL ' + bad.length);
  if (bad.length) { console.log('\nПРОВАЛЕНІ:'); bad.forEach(b => console.log('  ' + b.id + ' ' + b.name + (b.info ? (' — ' + b.info) : ''))); }
  await db.$disconnect();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(2); });
