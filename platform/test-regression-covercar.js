/* Регресійні тести воронки covercar: кожен тест = раніше знайдений баг.
   S — структурні (флоу/ключі/движок), B — поведінкові (прогони в testMode). */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const { executeFlowStep } = require('/var/www/flows.fineko.space/platform/apps/api/src/services/testSession.js');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const ROOT = '/var/www/flows.fineko.space/platform';
const CAPTION = 'Преміальний комфорт та захист салону. Накидки з алькантари. Ціни: водій 1690, передній 1990, весь салон 3490.\n\n40001';
const results = [];
const ok = (id, name, pass, info) => { results.push({ id, name, pass: !!pass, info: info || '' }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ' ' + name + (info ? ('  — ' + info) : '')); };

async function mkSession(tag, extraCtx) {
  const bot = await db.bot.findUnique({ where: { id: BOT }, select: { projectId: true } });
  let tid = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 9999));
  let user = null;
  for (let i = 0; i < 5 && !user; i++) {
    try { user = await db.user.create({ data: { telegramId: tid, firstName: 'Regress ' + tag, username: 'rg_' + tag.toLowerCase(), languageCode: 'uk', projectId: bot.projectId, metadata: { test: true, regress: true } } }); }
    catch (e) { if (e.code === 'P2002') tid += 1n; else throw e; }
  }
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const startId = ((fd.nodes || []).find(n => n.type === 'start') || {}).id || 'start_1';
  return db.session.create({ data: { userId: user.id, botId: BOT, state: startId, isTest: true,
    context: Object.assign({ channel: 'zernio', testMode: true, igUsername: 'rg_' + tag, senderName: 'Regress ' + tag,
      conversationId: 'rg-' + tag + '-' + Date.now(), currentNode: startId,
      flowRuntime: { currentNodeId: startId, waitingForUser: false, nodesVisited: [], lastUserMessage: '', dialogHistory: {} } }, extraCtx || {}) } });
}
async function play(sid, msgs) { for (const m of msgs) { try { await executeFlowStep({ sessionId: sid, incomingUserMessage: m }); } catch (e) { console.log('   (err: ' + e.message + ')'); } } }
const fresh = async (sid) => (await db.session.findUnique({ where: { id: sid } })).context || {};

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = fd.nodes || [], edges = fd.edges || [];
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const branch = (id, h) => (edges.find(e => e.source === id && e.sourceHandle === h) || {}).target;
  const keys = Object.fromEntries((await db.funnelKey.findMany({ where: { botId: BOT }, select: { key: true, value: true } })).map(r => [r.key, r.value || '']));
  const engine = fs.readFileSync(ROOT + '/apps/api/src/services/testSession.js', 'utf8');
  const zern = fs.readFileSync(ROOT + '/apps/api/src/services/zernioHandler.js', 'utf8');
  const patch = fs.readFileSync(ROOT + '/patch-covercar-payments.js', 'utf8');

  console.log('\n===== СТРУКТУРНІ =====');
  ok('S-A1a', 'DEFAULT_AD_ID порожній (нема демо-фолбеку)', !String(keys.DEFAULT_AD_ID || '').trim());
  ok('S-A1b', 'у флоу нема демо-товару', !/Мілітар|TEST-ONE/i.test(JSON.stringify(nodes)));
  ok('S-A2', 'товар не визначено -> handoff, не n_size', branch('n_have_product', 'false') === 'n_unknown_msg', 'false->' + branch('n_have_product', 'false'));
  const indeg = {}, outdeg = {};
  nodes.forEach(n => { indeg[n.id] = 0; outdeg[n.id] = 0; });
  edges.forEach(e => { if (outdeg[e.source] != null) outdeg[e.source]++; if (indeg[e.target] != null) indeg[e.target]++; });
  const orphans = nodes.filter(n => n.type !== 'start' && indeg[n.id] === 0 && outdeg[n.id] === 0).map(n => n.id);
  const unreach = nodes.filter(n => n.type !== 'start' && indeg[n.id] === 0 && outdeg[n.id] > 0).map(n => n.id);
  ok('S-A3a', 'нема осиротілих нод', orphans.length === 0, orphans.join(','));
  ok('S-A3b', 'нема недосяжних нод', unreach.length === 0, unreach.join(','));
  const condBad = nodes.filter(n => n.type === 'condition' && n.data && n.data.condition && (!branch(n.id, 'true') || !branch(n.id, 'false'))).map(n => n.id);
  ok('S-A2b', 'у кожної condition обидві гілки', condBad.length === 0, condBad.join(','));
  const oiPrompt = ((byId.n_order_intent || {}).data || {}).systemPrompt || '';
  ok('S-A4a', 'n_order_intent забороняє вигадані значення', /ЗАБОРОНЕНО/.test(oiPrompt) && /pending/.test(oiPrompt));
  const ocCond = ((byId.n_order_cond || {}).data || {}).condition || '';
  ok('S-A4b', 'n_order_cond fail-forward', ocCond.indexOf('!/^(n') >= 0, ocCond.slice(0, 70));
  ok('S-A5', 'n_welcome не питає зріст/вагу', !/зріст|вагу/i.test(((byId.n_welcome || {}).data || {}).text || ''));
  const naLeft = nodes.filter(n => n.type === 'notifyAdmin').map(n => n.id);
  ok('S-A6a', 'усі сповіщення через notifyTg', naLeft.length === 0, naLeft.join(','));
  ok('S-A6b', 'у кожної notifyTg є targetKey', nodes.filter(n => n.type === 'notifyTg').every(n => (n.data || {}).targetKey));
  ok('S-A6c', 'ADMIN_TELEGRAM_ID у ключах воронки', !!String(keys.ADMIN_TELEGRAM_ID || '').trim());
  ok('S-A7', 'n_set_apply перезаповнює кольори компонента', /colors:colors\.join/.test(((byId.n_set_apply || {}).data || {}).code || ''));
  const lk = ((byId.n_lookup || {}).data || {}).code || '';
  ok('S-A8a', 'резолвер набору виключає сам товар', lk.indexOf('String(found.id)) continue') >= 0);
  ok('S-A8b', 'резолвер ігнорує CT_1002/CT_1005/CT_1003', lk.indexOf("CT_1002'||f.uuid==='CT_1005'") >= 0);
  ok('S-A10', 'фінальні промпти у patch-файлі', /НЕ ПИТАЙ ПІБ/.test(patch) && /ЗАБОРОНЕНО писати/.test(patch));
  ok('S-A15', 'sendPhoto без плейсхолдера', engine.indexOf("caption || '📸 Фото'") < 0);
  ok('S-COLOR', 'гейт пропуску кольору', !!byId.n_has_colors && branch('n_has_colors', 'true') === 'n_color' && !!branch('n_has_colors', 'false'));
  ok('S-OOR', 'розмір поза сіткою -> менеджер', !!byId.n_size_oor && /sizeOutOfRange/.test(((byId.n_calc || {}).data || {}).code || ''));
  ok('S-SETS', 'гілка наборів', !!byId.n_is_set && branch('n_is_set', 'true') === 'n_set_choice' && !!branch('n_is_set', 'false'));
  ok('S-SUPP', 'SUPPLIER_CONFIG з механізмами', /easydrop_cart/.test(keys.SUPPLIER_CONFIG || '') && !!byId.n_supplier_route);
  ok('S-DRY', 'ключі DRY_RUN присутні', ['BREWDROP_DRY_RUN', 'EASYDROP_DRY_RUN', 'EASYDROP_CART_DRY_RUN'].every(k => keys[k] !== undefined), ['BREWDROP_DRY_RUN', 'EASYDROP_DRY_RUN', 'EASYDROP_CART_DRY_RUN'].map(k => k + '=' + keys[k]).join(' '));
  ok('S-A12', 'відновлення після handoff product_unknown', engine.indexOf("handoffKind === 'product_unknown'") >= 0 && zern.indexOf('_resumeOnProduct') >= 0);
  ok('S-GUARD', 'гард adminEngaged/funnelPaused', engine.indexOf('ctx.adminEngaged || ctx.funnelPaused') >= 0);
  ok('S-HANDOFF', 'детермінований детект прохання людини', engine.indexOf('живою') >= 0 && engine.indexOf('handoff_keyword') >= 0);
  ok('S-SHOP', 'назва магазину у сповіщеннях', /shopPrefix/.test(engine) && !!keys.SHOP_TAG);
  ok('S-LOG', 'лог доставки', /pushDelivery/.test(engine) && /logDelivery/.test(zern));
  ok('S-PAUSE', 'кнопка стоп/старт знімає handoff', fs.readFileSync(ROOT + '/apps/api/src/routes/sessions.js', 'utf8').indexOf('req.body.funnelPaused === false') >= 0);

  console.log('\n===== ПОВЕДІНКОВІ =====');
  let s = await mkSession('B1', { sharedPost: { kind: 'reel', caption: CAPTION } });
  await play(s.id, ['', 'Скільки коштує?']);
  let c = await fresh(s.id);
  ok('B1', 'рілс з артикулом -> товар визначено', c.product && String(c.product.id) === '13' && !c.adminEngaged, c.product ? ('#' + c.product.id) : 'НЕМА');

  s = await mkSession('B2', {});
  await play(s.id, ['', 'Скільки?']);
  let c2 = await fresh(s.id);
  const stopped = !!c2.adminEngaged && c2.handoffKind === 'product_unknown';
  await db.session.update({ where: { id: s.id }, data: { context: Object.assign({}, c2, { sharedPost: { kind: 'reel', caption: CAPTION } }) } });
  await play(s.id, ['Яка ціна?']);
  const c2b = await fresh(s.id);
  ok('B2', 'текст раніше рілса -> бот відновився', stopped && !c2b.adminEngaged && c2b.product && String(c2b.product.id) === '13', 'stop=' + stopped + ' prod=' + (c2b.product ? c2b.product.id : '-'));

  s = await mkSession('B3', { sharedPost: { kind: 'reel', caption: CAPTION } });
  await play(s.id, ['', 'хочу поговорити з живою людиною']);
  c = await fresh(s.id);
  ok('B3', 'прохання людини -> бот замовкає', !!c.adminEngaged);

  // Адаптивний прогін: реальний клієнт не завжди відповідає в тому порядку, якого чекає
  // фіксований скрипт (напр. n_set_choice і n_color — окремі кроки з одним обов'язком
  // кожен, §3 правила). Тому дивимось на поточну ноду й відповідаємо доречно, а не за
  // жорстким списком повідомлень.
  s = await mkSession('B4', { sharedPost: { kind: 'reel', caption: CAPTION } });
  await play(s.id, ['']);
  for (let i = 0; i < 8; i++) {
    c = await fresh(s.id);
    const node = (c.flowRuntime || {}).currentNodeId;
    if (node === 'n_set_choice') await play(s.id, ['весь комплект']);
    else if (node === 'n_color') await play(s.id, ['Темно-сірий']);
    else if (node === 'n_order_intent') await play(s.id, ['так']);
    else if (node === 'n_pay_collect') await play(s.id, ['2']);
    else break;
  }
  c = await fresh(s.id);
  ok('B4', 'підтвердження -> дійшли до оплати', !!c.orderRef && !!c.payAmount, 'ref=' + (c.orderRef || '-') + ' amount=' + (c.payAmount || '-') + ' node=' + (c.flowRuntime || {}).currentNodeId);

  s = await mkSession('B5', {});
  await play(s.id, ['', 'привіт']);
  c = await fresh(s.id);
  ok('B5', 'невідомий товар -> менеджер, не n_size', !!c.adminEngaged && (c.flowRuntime || {}).currentNodeId !== 'n_size', 'node=' + (c.flowRuntime || {}).currentNodeId);

  s = await mkSession('B6', { sharedPost: { kind: 'reel', caption: CAPTION } });
  await play(s.id, ['']);
  const msgs = await db.message.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'asc' } });
  const asks = msgs.filter(m => /зріст|вагу/i.test(m.content || '')).length;
  ok('B6', 'вітання без запиту параметрів (не-одяг)', asks === 0, 'таких: ' + asks);

  console.log('\n===== ПІДСУМОК =====');
  const bad = results.filter(r => !r.pass);
  console.log('усього ' + results.length + ' | PASS ' + (results.length - bad.length) + ' | FAIL ' + bad.length);
  if (bad.length) { console.log('\nПРОВАЛЕНІ:'); bad.forEach(b => console.log('  ' + b.id + ' ' + b.name + (b.info ? (' — ' + b.info) : ''))); }
  await db.$disconnect();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERR', e.message, e.stack); process.exit(2); });
