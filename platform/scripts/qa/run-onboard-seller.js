'use strict';
// Запуск НА СЕРВЕРІ (потрібні кредити Claude): node scripts/qa/run-onboard-seller.js
// Тест-прогін onboard-seller: експерт-психолог без матеріалів, інформативні відповіді (порядок питань може відрізнятись).
const P = require('path').join(__dirname, '..', '..');
require('dotenv').config({ path: P + '/.env' });
const { db } = require('@platform/db');
const { startTestSession, sendTestTurn, endTestSession } = require(P + '/apps/api/src/services/testSession');
const D = require(P + '/apps/api/src/services/sellerDossier');

const REPLIES = [
  'Нема матеріалів. Я Марина Коваль, проєкт «Спокійна голова», інстаграм @spokiina_holova',
  'Я психолог, працюю з тривожністю і панічними атаками у жінок 28-45, онлайн.',
  'Продаю діагностичну консультацію «Розбір тривоги»: 60 хвилин у Zoom, ми розбираємо ситуацію, я даю письмовий план на 2 тижні і рекомендації, що робити далі.',
  'Коштує 1800 грн, оплата наперед повністю. Скасувати можна за 24 години, тоді повертаю гроші. Якщо пізніше, можна перенести один раз.',
  'Типовий список обіцянок підходить, ще додай: не обіцяти вилікувати і не називати діагнозів.',
  'Підходить тим, хто має тривогу більше місяця і готовий працювати. Не беру людей у гострій кризі чи з суїцидальними думками, таких направляю до психіатра чи на лінію допомоги.',
  'Що мені треба знати: скільки триває тривога, як вона проявляється, чи був досвід терапії, чи є ліки від психіатра, що хоче змінити, коли готова почати.',
  'Звертайся на «ти» до клієнтів, тепло, без жартів, українською і російською. Не люблю слово «проблема» і «лікування».',
  'Список для передачі мені підходить, ще додай скарги на мою роботу і питання про ліки.',
  'Ціль: запис на консультацію з оплатою. Записуються через Calendly, пн-пт 10-18 за Києвом.',
  'Так, усе вірно.',
  'Ціна 1800 грн, повна передоплата, скасування за 24 години з поверненням. Так, підтверджую.',
  'Бот не обіцяє вилікувати, діагнози, терміни результату, знижки. Підтверджую.',
  'Досить, дякую.',
];

(async () => {
  const bot = await db.bot.findFirst({ where: { slug: 'onboard-seller' } });
  const started = await startTestSession({ botId: bot.id, contextOverride: {} });
  const sid = started.sessionId;
  console.log('session', sid);
  for (const text of REPLIES) {
    const cur = await db.session.findUnique({ where: { id: sid }, select: { state: true } });
    if (cur && cur.state === 'completed') break;
    try { await sendTestTurn({ sessionId: sid, text }); } catch (e) { console.log('TURN FAIL:', e.message); break; }
  }
  const msgs = await db.message.findMany({ where: { sessionId: sid }, orderBy: { createdAt: 'asc' }, select: { role: true, content: true } });
  for (const m of msgs) console.log((m.role === 'assistant' ? 'BOT: ' : 'EXP: ') + String(m.content || '').slice(0, 700).replace(/\n/g, ' ⏎ '));
  const s = await db.session.findUnique({ where: { id: sid }, select: { userId: true, botId: true, state: true } });
  const row = await db.file.findFirst({ where: { userId: s.userId, botId: s.botId, fileType: 'seller_dossier' } });
  console.log('\nstate:', s.state);
  if (row) { const st = JSON.parse(row.content); const c = D.computeCard(st); console.log('VERDICT:', c.verdict); console.log(D.renderOwnerCard(c, st).replace(/<[^>]+>/g, '')); }
  else console.log('ДОСЬЄ НЕ ЗБЕРЕЖЕНО');
  const calls = await db.apiCall.findMany({ where: { sessionId: sid, service: 'agent-tool' }, select: { method: true, statusCode: true, error: true } });
  const by = {}; for (const c of calls) { const k = c.method + ':' + (c.statusCode || c.error); by[k] = (by[k] || 0) + 1; }
  console.log('tool calls:', JSON.stringify(by));
  await endTestSession({ sessionId: sid }).catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message, e.stack); process.exit(1); });
