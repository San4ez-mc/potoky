'use strict';
/**
 * Інструменти нагадувань для асистента Digital Hiring.
 *
 * Патч-файл, а не разова міграція: воронку правлять і з UI, і скриптами, і без
 * джерела істини наступний, хто перезбирає її, мовчки втратить ці інструменти.
 * Ідемпотентний — можна запускати скільки завгодно разів.
 *
 *   node scripts/dh-add-reminder-tool.js
 */
const { db } = require('@platform/db');

const BOT_ID = process.env.DH_BOT_ID || '14d8099c-02e4-47d5-a01a-79dca4aa6e90';
const API = '{{env.FLOWS_API_URL}}';
const AUTH = { 'X-Api-Secret': '{{env.API_SECRET}}' };

// sessionId у URL, а не в аргументах: кому слати — вирішує сервер за сесією.
// Інакше досить було б підказати моделі чужий chat_id, щоб бот написав стороннім.
const TOOLS = [
  {
    name: 'remind_me',
    description:
      'Поставити нагадування власниці в цей чат. Час — або dueAt («2026-09-26 12:30», київський), '
      + 'або inMinutes. Підтверди їй, коли саме нагадаєш: у відповіді є поле when.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Що нагадати — її словами, коротко і конкретно.' },
        dueAt: { type: 'string', description: 'Дата й час, напр. 2026-09-26 12:30. Київський час.' },
        inMinutes: { type: 'number', description: 'Альтернатива dueAt: через скільки хвилин.' },
      },
      required: ['text'],
    },
    url: `${API}/api/reminders?sessionId={{session.id}}`,
    method: 'POST',
    headers: AUTH,
  },
  {
    name: 'reminders_list',
    description: 'Які нагадування вже стоять. Виклич, перш ніж ставити нове на ту саму справу.',
    inputSchema: { type: 'object', properties: {} },
    url: `${API}/api/reminders?sessionId={{session.id}}`,
    method: 'GET',
    headers: AUTH,
  },
];

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
  if (!fd) throw new Error(`Воронку ${BOT_ID} не знайдено`);

  let touched = 0;
  const nodes = fd.nodes.map((n) => {
    if (n.type !== 'agent' || !Array.isArray(n.data?.tools)) return n;
    const tools = n.data.tools.slice();
    for (const t of TOOLS) {
      const i = tools.findIndex((x) => x.name === t.name);
      if (i >= 0) tools[i] = t; else tools.push(t);
    }
    touched += 1;
    return { ...n, data: { ...n.data, tools } };
  });
  if (!touched) throw new Error('Агент-ноди з інструментами не знайдено');

  await db.flowDefinition.update({ where: { id: fd.id }, data: { nodes } });
  const names = nodes.find((n) => n.type === 'agent').data.tools.map((t) => t.name);
  console.log(`Оновлено агент-нод: ${touched}. Інструменти: ${names.join(', ')}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
