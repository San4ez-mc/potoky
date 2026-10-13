'use strict';
// Воронка «Сторожок календаря» (slug plan-watch, проєкт content-social): щодня питає content2, чи закрито найближчі 3 дні постами
// у мережах з автопублікацією, і пише власнику в Telegram лише коли план вичерпується (інакше мовчить).
// Привід (2026-10-13): план Threads закінчився 14.10, 13.10 автопосту не було, і ніхто про це не знав.
// Код ноди — scripts/autopost/plan-watch-node-code.js. Idempotent. Run on the server: node scripts/build-plan-watch-2026-10-13.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

const SLUG = 'plan-watch';
const TELEGRAM_CONNECTOR_ID = 'eb411228-6318-4e15-8ddb-286d3776fe8b'; // «Контент бот»
const ADMIN_TELEGRAM_ID = '345126254';
const code = fs.readFileSync(path.join(__dirname, 'autopost', 'plan-watch-node-code.js'), 'utf8');

async function main() {
    let bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) {
        await callTool('new_bot', {
            projectSlug: 'content-social', name: 'Сторожок календаря (чи є пости на найближчі дні)', slug: SLUG,
            description: 'Щодня перевіряє, що в мережах з автопублікацією заплановані пости на найближчі 3 дні, і сповіщає власника, якщо план вичерпується.',
            goal: 'Не допустити тихих днів без публікацій через вичерпаний контент-план.', trigger: 'webhook', isActive: true,
        });
        bot = await db.bot.findFirst({ where: { slug: SLUG } });
        console.log('bot created', bot.id);
    }
    const botId = bot.id;
    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'fnk_wh_2026_x9mK4pLqR7vNsT1eYcJdBuAw';
    for (const [key, value, label, isSecret] of [
        ['CONTENT2_URL', 'https://content2.fineko.space', 'content2', false],
        ['CONTENT2_TOKEN', WEBHOOK_SECRET, 'Токен вебхуків content2 (plan-watch)', true],
        ['TELEGRAM_CONNECTOR_ID', TELEGRAM_CONNECTOR_ID, 'Telegram — Контент бот', false],
        ['ADMIN_TELEGRAM_ID', ADMIN_TELEGRAM_ID, 'Кому слати попередження', false],
    ]) await callTool('update_funnel_key', { botId, key, value, label, isSecret });

    let f = await callTool('get_funnel', { botId });
    if (f.nodes.some((n) => n.id === 'msg_intro')) { await callTool('delete_node', { botId, nodeId: 'msg_intro' }); f = await callTool('get_funnel', { botId }); }
    const L1 = 'Перевірити план на найближчі дні', L2 = 'Попередити (лише коли план вичерпується)';
    let n1 = f.nodes.find((n) => n.data && n.data.label === L1);
    let n2 = f.nodes.find((n) => n.data && n.data.label === L2);
    new (Object.getPrototypeOf(async function () {}).constructor)('context', 'keys', code);
    if (!n1) { const r = await callTool('add_node', { botId, type: 'js', position: { x: 160, y: 320 }, data: { label: L1, code, qaExpectation: 'planWatchMessage порожній, якщо на найближчі 3 дні в усіх автопублікаційних мережах є пости; інакше містить список прогалин.' } }); n1 = r.added; }
    else await callTool('update_node', { botId, nodeId: n1.id, data: { code } });
    if (!n2) { const r = await callTool('add_node', { botId, type: 'notifyTg', position: { x: 160, y: 480 }, data: { label: L2, targetKey: 'ADMIN_TELEGRAM_ID', message: '{{context.planWatchMessage}}' } }); n2 = r.added; }
    const start = f.nodes.find((n) => n.type === 'start');
    await callTool('update_node', { botId, nodeId: start.id, data: { label: 'Webhook Trigger', trigger: 'webhook', bodySchema: '{}' } });
    const f2 = await callTool('get_funnel', { botId });
    const has = (a, b) => f2.edges.some((e) => e.source === a && e.target === b);
    if (!has(start.id, n1.id)) await callTool('create_edge', { botId, source: start.id, target: n1.id });
    if (!has(n1.id, n2.id)) await callTool('create_edge', { botId, source: n1.id, target: n2.id });
    try { await callTool('auto_layout', { botId }); } catch (e) { /* косметика */ }
    console.log('ok', botId);
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
