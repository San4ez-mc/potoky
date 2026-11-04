'use strict';
// Сповіщення власнику про нового експерта: простими словами, без кодів полів (K1, O3…) і без службових рядків content2.
// Було: «Бажано доповнити (не блокує): O3, O4…», «content2: проєкт … записано 13 з 13. Налаштування продавця підставлено: sellerName…»,
// посилання на content2/user-data (не туди). Стало: «🆕 Новий експерт завершив онбординг», що зібрали (послуга, ціна, кому, запис),
// що ще бракує людською мовою і ПОСИЛАННЯ на картку продавця для перевірки й затвердження (flows.fineko.space/sellers/<проєкт>).
// Правка живого вузла «Зібрати картку запуску» (onboard-seller). Ідемпотентно (мітка PLAIN_NOTICE).
// Запуск з кореня platform/:  PLATFORM_ROOT=$PWD node scripts/patch-onboard-seller-owner-notice-plain-2026-11-04.js  (DRY_RUN=1 — лише показати)
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const DRY = !!process.env.DRY_RUN;
const MARK = '// PLAIN_NOTICE';

const CODE = String.raw`// PLAIN_NOTICE
// js-нода «Картка запуску»: після завершення діалогу бере досьє експерта з Flows API й готує ТЕКСТИ ДЛЯ ВЛАСНИКА простими словами.
// Не кидає винятків: збій не має зірвати сесію.
const base = String(keys.SELLER_DOSSIER_URL || '').replace(/\/$/, '');
const out = { ownerCardText: '', ownerFull1: '', ownerFull2: '', ownerFull3: '', cardReady: false, cardVerdict: '' };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PLAIN = { K1: 'Про експерта', K2: 'Яку послугу продає', K3: 'Як проходить консультація', K4: 'Ціна й умови', K5: 'Кому підходить', K6: 'Що з’ясовувати про клієнта', K7: 'Що має зробити клієнт', K8: 'Як записуються', K9: 'Що бот не має обіцяти', K10: 'Коли передавати експерту', K11: 'Мова й стиль', O3: 'Звідки приходять клієнти', O4: 'Скільки заявок і що болить', O10: 'Часті запитання', O11: 'Типові клієнти', O12: 'Кейси', O13: 'Шлях і відгуки експерта', O15: 'Імʼя продавця', O16: 'Чутливі теми', O19: 'Куди надсилати заявки', T3: 'Пошта для доступу' };
const who = [user.firstName, user.lastName].filter(Boolean).join(' ') || ('Telegram ' + user.telegramId);
const un = user.username ? ' (@' + user.username + ')' : '';
try {
  const res = await fetch(base + '/owner-card?sessionId=' + encodeURIComponent(session.id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Search-Secret': String(keys.SEARCH_SECRET || '') },
    body: '{}',
  });
  const j = await res.json();
  if (!j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + res.status));
  // зі службової картки беремо значення полів (рядок: «✅ K2 Назва поля: значення — слова експерта…»)
  const plainText = String(j.cardText || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const val = {}; const notDone = [];
  for (const line of plainText.split('\n')) {
    const m = /^(\S+)\s+([KOT]\d+)\s+[^:]*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const clean = m[3].replace(/\s+—\s+(слова|з матеріалів|типов|підтверд|за замовчуванням).*$/i, '').trim();
    val[m[2]] = clean.length > 170 ? clean.slice(0, 167) + '…' : clean;
    if (m[1] !== '✅' && /^K/.test(m[2])) notDone.push(PLAIN[m[2]] || m[2]);
  }
  const optional = [];
  const mo = /Бажано доповнити[^:]*:\s*([^\n]+)/.exec(plainText);
  if (mo) for (const c of mo[1].split(/[,\s]+/)) if (PLAIN[c]) optional.push(PLAIN[c].toLowerCase());
  const L = [];
  L.push('🆕 <b>Новий експерт завершив онбординг</b>');
  L.push('');
  L.push('👤 <b>' + esc(who) + '</b>' + esc(un) + ' · Telegram ' + user.telegramId);
  L.push('');
  L.push(j.ready ? '✅ Усе потрібне для запуску заповнено.' : '⚠️ Для запуску ще бракує: ' + (notDone.length ? notDone.join(', ') : 'див. картку') + '.');
  L.push('');
  L.push('<b>Коротко, що зібрали</b>');
  for (const [c, t] of [['K2', 'Послуга'], ['K4', 'Ціна й умови'], ['K5', 'Кому підходить'], ['K8', 'Як записуються']]) if (val[c]) L.push('• ' + t + ': ' + esc(val[c]));
  if (optional.length) { L.push(''); L.push('Можна ще уточнити (не обовʼязково): ' + optional.join(', ') + '.'); }
  L.push('');
  L.push('<b>Що зробити зараз</b>');
  const pid = context.c2ProjectId || '';
  L.push('1) Переглянути й затвердити дані: ' + (pid ? 'https://flows.fineko.space/sellers/' + pid : 'https://flows.fineko.space/sellers'));
  if (context.provisionLink) L.push('2) Воронка продавця (чернетка, поки нікому не відповідає): ' + context.provisionLink);
  L.push((context.provisionLink ? '3' : '2') + ') Уся розмова онбордингу: https://flows.fineko.space/sessions/' + session.id);
  if (String(context.c2Summary || '').startsWith('⚠️')) { L.push(''); L.push('⚠️ Дані не вдалося записати в базу контенту. Вони збережені в сесії онбордингу, скажіть мені, і я перенесу.'); }
  if (String(context.provisionText || '').startsWith('⚠️')) { L.push(''); L.push('⚠️ Воронку продавця автоматично не створено. Її можна створити кнопкою на сторінці «ШІ-продавці».'); }
  out.ownerCardText = L.join('\n');
  out.ownerFull1 = (j.fullParts && j.fullParts[0]) || '';
  out.ownerFull2 = (j.fullParts && j.fullParts[1]) || '';
  out.ownerFull3 = (j.fullParts && j.fullParts[2]) || '';
  out.cardReady = !!j.ready;
  out.cardVerdict = j.verdict || '';
} catch (e) {
  out.ownerCardText = '🆕 <b>Новий експерт завершив онбординг</b>: ' + esc(who) + esc(un) + '\n\n⚠️ Картку зібрати не вдалося (' + esc(e.message) + '). Розмова: https://flows.fineko.space/sessions/' + session.id + (context.c2ProjectId ? '\nКартка продавця: https://flows.fineko.space/sellers/' + context.c2ProjectId : '');
}
return out;
`;

(async () => {
    const bot = await db.bot.findFirst({ where: { slug: 'onboard-seller' } });
    if (!bot) throw new Error('onboard-seller не знайдено');
    const f = await callTool('get_funnel', { botId: bot.id });
    const n = (f.nodes || []).find((x) => x.type === 'js' && x.data && x.data.label === 'Зібрати картку запуску');
    if (!n) throw new Error('вузол «Зібрати картку запуску» не знайдено');
    if (String(n.data.code || '').includes(MARK)) { console.log('  = вже оновлено'); process.exit(0); }
    if (!DRY) await callTool('update_node', { botId: bot.id, nodeId: n.id, data: { code: CODE } });
    console.log('  ✔ вузол «Зібрати картку запуску»', DRY ? '(dry-run)' : 'оновлено', '| код', String(n.data.code).length, '→', CODE.length);
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
