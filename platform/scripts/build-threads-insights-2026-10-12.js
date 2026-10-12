'use strict';
// Воронка «Threads: збір метрик» (slug threads-insights, проєкт content-social): раз на добу (серверний cron → webhook)
//  • оновлює 60-денний токен Threads (refresh), якщо лишилось < 30 днів;
//  • збирає метрики опублікованих постів за 30 днів (перегляди/лайки/відповіді/репости/цитування/поширення) → content2 /api/webhooks/post-metrics → PostGroup.scores;
//  • знімає кількість підписників акаунта.
// Код ноди — scripts/autopost/threads-insights-node-code.js (мок-тести test-publishers.js). Повідомлення власнику — лише коли є про що (помилка / токен оновлено).
// Токен читається з копії ключа цієї воронки (значення ключів воронки через MCP не віддаються): скрипт засіває копію з publish-threads
// і далі refresh-вузол оновлює ОБИДВА ключі. Після повторної авторизації kiro-threads-oauth — перезапустити цей скрипт (він пересіє токен).
// Idempotent. Run on the server: node scripts/build-threads-insights-2026-10-12.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

const SLUG = 'threads-insights';
const TELEGRAM_CONNECTOR_ID = 'eb411228-6318-4e15-8ddb-286d3776fe8b'; // «Контент бот»
const ADMIN_TELEGRAM_ID = '345126254';
const code = fs.readFileSync(path.join(__dirname, 'autopost', 'threads-insights-node-code.js'), 'utf8');

async function main() {
    const pub = await db.bot.findFirst({ where: { slug: 'publish-threads' } });
    if (!pub) throw new Error('publish-threads не знайдено');
    const pubKeys = await db.funnelKey.findMany({ where: { botId: pub.id, key: { in: ['THREADS_USER_ID', 'THREADS_ACCESS_TOKEN'] } }, select: { key: true, value: true } });
    const uid = (pubKeys.find((k) => k.key === 'THREADS_USER_ID') || {}).value;
    const tok = (pubKeys.find((k) => k.key === 'THREADS_ACCESS_TOKEN') || {}).value;
    if (!uid || !tok) throw new Error('у publish-threads немає THREADS_USER_ID / THREADS_ACCESS_TOKEN');

    let bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) {
        await callTool('new_bot', {
            projectSlug: 'kiro', name: 'Threads: збір метрик і оновлення токена', slug: SLUG,
            description: 'Щодоби збирає метрики опублікованих постів Threads (перегляди, лайки, відповіді, репости) у content2 і оновлює токен Threads.',
            goal: 'Дати контент-менеджеру реальні цифри ефективності постів і не втратити доступ до Threads через спливання токена.', trigger: 'webhook', isActive: true,
        });
        bot = await db.bot.findFirst({ where: { slug: SLUG } });
        console.log('bot created', bot.id);
    }
    const botId = bot.id;

    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'fnk_wh_2026_x9mK4pLqR7vNsT1eYcJdBuAw';
    const keys = [
        ['THREADS_USER_ID', uid, 'Threads user id (kiro.ukraine)', false],
        ['THREADS_ACCESS_TOKEN', tok, 'Threads access token (копія з publish-threads; оновлюється автоматично)', true],
        ['PUBLISH_THREADS_BOT_ID', pub.id, 'Воронка publish-threads (куди писати оновлений токен)', false],
        ['SELF_BOT_ID', botId, 'ID цієї воронки', false],
        ['CONTENT2_URL', 'https://content2.fineko.space', 'content2', false],
        ['CONTENT2_TOKEN', WEBHOOK_SECRET, 'Токен вебхуків content2 (post-metrics)', true],
        ['TELEGRAM_CONNECTOR_ID', TELEGRAM_CONNECTOR_ID, 'Telegram — Контент бот', false],
        ['ADMIN_TELEGRAM_ID', ADMIN_TELEGRAM_ID, 'Кому слати повідомлення про помилки/оновлення токена', false],
    ];
    for (const [key, value, label, isSecret] of keys) await callTool('update_funnel_key', { botId, key, value, label, isSecret });
    if (process.env.MCP_SECRET) await callTool('update_funnel_key', { botId, key: 'MCP_SECRET', value: process.env.MCP_SECRET, label: 'MCP write-secret (запис оновленого токена)', isSecret: true });

    let f = await callTool('get_funnel', { botId });
    if (f.nodes.some((n) => n.id === 'msg_intro')) { await callTool('delete_node', { botId, nodeId: 'msg_intro' }); f = await callTool('get_funnel', { botId }); }
    const L1 = 'Метрики Threads → content2 + оновлення токена', L2 = 'Повідомити (лише коли є про що)';
    let n1 = f.nodes.find((n) => n.data && n.data.label === L1);
    let n2 = f.nodes.find((n) => n.data && n.data.label === L2);
    new (Object.getPrototypeOf(async function () {}).constructor)('context', 'keys', code);
    if (!n1) { const r = await callTool('add_node', { botId, type: 'js', position: { x: 160, y: 320 }, data: { label: L1, code, qaExpectation: 'Повертає collected/updated; threadsInsightsMessage непорожній лише при помилці або оновленні токена.' } }); n1 = r.added; }
    else await callTool('update_node', { botId, nodeId: n1.id, data: { code } });
    if (!n2) { const r = await callTool('add_node', { botId, type: 'notifyTg', position: { x: 160, y: 480 }, data: { label: L2, targetKey: 'ADMIN_TELEGRAM_ID', message: '{{context.threadsInsightsMessage}}' } }); n2 = r.added; }
    const start = f.nodes.find((n) => n.type === 'start');
    await callTool('update_node', { botId, nodeId: start.id, data: { label: 'Webhook Trigger', trigger: 'webhook', bodySchema: '{\n  "days": "number (опційно) — за скільки днів опитувати пости, за замовчуванням 30"\n}' } });
    const f2 = await callTool('get_funnel', { botId });
    const has = (a, b) => f2.edges.some((e) => e.source === a && e.target === b);
    if (!has(start.id, n1.id)) await callTool('create_edge', { botId, source: start.id, target: n1.id });
    if (!has(n1.id, n2.id)) await callTool('create_edge', { botId, source: n1.id, target: n2.id });
    try { await callTool('auto_layout', { botId }); } catch (e) { /* косметика */ }
    console.log('ok', botId);
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
