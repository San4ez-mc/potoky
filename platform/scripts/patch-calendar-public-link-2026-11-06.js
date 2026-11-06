'use strict';
// Додає в повідомлення бота з вільними віконцями ПОСИЛАННЯ на публічну сторінку запису (calendar.fineko.space/book/<slug>):
// людина може обрати час цифрою в боті АБО на сторінці (два канали паралельно). Сторінка показує лише вільні години.
// Ідемпотентно (мітка PUBLIC_LINK у коді вузла «Календар: вільні віконця»). DRY_RUN=1 — лише показати.
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');
const DRY = !!process.env.DRY_RUN;
const SLUG = process.env.CAL_SLUG || 'matsuk';

const NEEDLE = "\n} catch (e) {\n  out.slotsError";
const INSERT = [
  '',
  '  /* PUBLIC_LINK */',
  "  const slug = String(keys.CALENDAR_PUBLIC_SLUG || '" + SLUG + "');",
  "  const nm = (context.spin_result && context.spin_result.name) || user.firstName || '';",
  "  out.slotsUrl = base + '/book/' + slug + '?' + new URLSearchParams({ tg: String(user.telegramId || ''), n: String(nm), u: String(user.username || ''), s: String(keys.CALENDAR_SOURCE || 'bot') }).toString();",
  "  if (picked.length) out.slotsMsg += '\n\nАбо обери час на сторінці запису, там видно всі вільні години:\n' + out.slotsUrl;",
].join('\n');

(async () => {
  for (const slug of ['sell-ai-seller', 'bot-karta-sales']) {
    const bot = await db.bot.findFirst({ where: { slug } });
    if (!bot) { console.log('— ' + slug + ' не знайдено'); continue; }
    const f = await callTool('get_funnel', { botId: bot.id });
    const node = f.nodes.find((n) => n.data && n.data.label === 'Календар: вільні віконця');
    console.log(slug);
    if (!node) { console.log('  — нема вузла календаря'); continue; }
    const code = String(node.data.code || '');
    if (code.includes('PUBLIC_LINK')) { console.log('  = вже є'); continue; }
    if (!code.includes(NEEDLE)) throw new Error(slug + ': не знайдено місце вставки');
    if (!DRY) {
      await callTool('update_node', { botId: bot.id, nodeId: node.id, data: { code: code.replace(NEEDLE, INSERT + NEEDLE) } });
      await callTool('update_funnel_key', { botId: bot.id, key: 'CALENDAR_PUBLIC_SLUG', value: SLUG, label: 'Календар: slug публічної сторінки запису', isSecret: false });
    }
    console.log('  ✔ посилання додано' + (DRY ? ' (dry-run)' : ''));
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
