'use strict';
// Воронка «OAuth: TikTok / YouTube» (slug oauth-video, проєкт content-social): одноразове (і повторне за потреби) підключення
// акаунтів до автопостингу. Код ноди — scripts/autopost/oauth-video-node-code.js (мок-тести test-publishers.js).
//   1) POST /webhook/bot/oauth-video {"platform":"tiktok"}  → у Telegram посилання авторизації;
//   2) після згоди скопіювати code з адресного рядка → POST {"platform":"tiktok","code":"…"} → токени самі пишуться у ключі
//      воронок publish-tiktok / publish-youtube-shorts (як це зроблено для Threads: kiro-threads-oauth).
// Також: публікатору TikTok потрібні MCP_SECRET і SELF_BOT_ID — щоб зберігати ротацію refresh-токена.
// Idempotent. Run on the server: node scripts/build-oauth-video-2026-10-03.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

const SLUG = 'oauth-video';
const TELEGRAM_CONNECTOR_ID = 'eb411228-6318-4e15-8ddb-286d3776fe8b'; // «Контент бот»
const ADMIN_TELEGRAM_ID = '345126254';
const REDIRECT = 'https://flows.fineko.space/webhook/bot/oauth-video';
const code = fs.readFileSync(path.join(__dirname, 'autopost', 'oauth-video-node-code.js'), 'utf8');

async function main() {
    const tt = await db.bot.findFirst({ where: { slug: 'publish-tiktok' } });
    const yt = await db.bot.findFirst({ where: { slug: 'publish-youtube-shorts' } });
    let bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) {
        await callTool('new_bot', {
            projectSlug: 'content-social', name: 'OAuth: TikTok / YouTube (підключення автопостингу)', slug: SLUG,
            description: 'Одноразове підключення акаунтів TikTok і YouTube до автопостингу: видає посилання авторизації в Telegram, міняє code на токени й записує їх у воронки publish-tiktok / publish-youtube-shorts.',
            goal: 'Отримати й зберегти токени TikTok/YouTube для автопублікації відео.', trigger: 'webhook', isActive: true,
        });
        bot = await db.bot.findFirst({ where: { slug: SLUG } });
        console.log('bot created', bot.id);
    }
    const botId = bot.id;

    const keys = [
        ['TIKTOK_CLIENT_KEY', '', 'TikTok client key (TikTok for Developers → додаток)', false],
        ['TIKTOK_CLIENT_SECRET', '', 'TikTok client secret', true],
        ['YT_CLIENT_ID', '', 'Google OAuth client id (Cloud Console → Credentials)', false],
        ['YT_CLIENT_SECRET', '', 'Google OAuth client secret', true],
        ['OAUTH_REDIRECT_URI', REDIRECT, 'Redirect URI (вписати в додаток TikTok і в OAuth client Google)', false],
        ['PUBLISH_TIKTOK_BOT_ID', tt.id, 'Куди писати токени TikTok (воронка publish-tiktok)', false],
        ['PUBLISH_YOUTUBE_BOT_ID', yt.id, 'Куди писати токени YouTube (воронка publish-youtube-shorts)', false],
        ['TELEGRAM_CONNECTOR_ID', TELEGRAM_CONNECTOR_ID, 'Telegram — Контент бот', false],
        ['ADMIN_TELEGRAM_ID', ADMIN_TELEGRAM_ID, 'Кому слати посилання й результат', false],
    ];
    const existingKeys = await db.funnelKey.findMany({ where: { botId }, select: { key: true, value: true } });
    const have = new Map(existingKeys.map((x) => [x.key, x.value]));
    for (const [key, value, label, isSecret] of keys) {
        // не затираємо вже введені ключі (client key/secret)
        if (have.get(key) && !['OAUTH_REDIRECT_URI', 'PUBLISH_TIKTOK_BOT_ID', 'PUBLISH_YOUTUBE_BOT_ID'].includes(key)) continue;
        await callTool('update_funnel_key', { botId, key, value, label, isSecret });
    }
    if (process.env.MCP_SECRET) await callTool('update_funnel_key', { botId, key: 'MCP_SECRET', value: process.env.MCP_SECRET, label: 'MCP write-secret (запис токенів у publish-воронки)', isSecret: true });

    // publish-tiktok: ротація refresh-токена пишеться в його власні ключі
    if (process.env.MCP_SECRET) await callTool('update_funnel_key', { botId: tt.id, key: 'MCP_SECRET', value: process.env.MCP_SECRET, label: 'MCP write-secret (збереження ротації refresh-токена)', isSecret: true });
    await callTool('update_funnel_key', { botId: tt.id, key: 'SELF_BOT_ID', value: tt.id, label: 'ID цієї воронки (для запису ротації токена)', isSecret: false });
    for (const [key, label, isSecret] of [['TIKTOK_CLIENT_KEY', 'TikTok client key', false], ['TIKTOK_CLIENT_SECRET', 'TikTok client secret', true], ['TIKTOK_REFRESH_TOKEN', 'TikTok refresh token (~365 днів)', true]]) {
        const row = await db.funnelKey.findUnique({ where: { botId_key: { botId: tt.id, key } }, select: { value: true } });
        if (!row) await callTool('update_funnel_key', { botId: tt.id, key, value: '', label, isSecret });
    }
    for (const [key, label, isSecret] of [['YT_CLIENT_ID', 'Google OAuth client id', false], ['YT_CLIENT_SECRET', 'Google OAuth client secret', true], ['YT_REFRESH_TOKEN', 'YouTube refresh token', true]]) {
        const row = await db.funnelKey.findUnique({ where: { botId_key: { botId: yt.id, key } }, select: { value: true } });
        if (!row) await callTool('update_funnel_key', { botId: yt.id, key, value: '', label, isSecret });
    }

    let f = await callTool('get_funnel', { botId });
    if (f.nodes.some((n) => n.id === 'msg_intro')) { await callTool('delete_node', { botId, nodeId: 'msg_intro' }); f = await callTool('get_funnel', { botId }); }
    const L1 = 'OAuth: посилання або обмін code', L2 = 'Повідомити результат';
    let n1 = f.nodes.find((n) => n.data && n.data.label === L1);
    let n2 = f.nodes.find((n) => n.data && n.data.label === L2);
    new (Object.getPrototypeOf(async function () {}).constructor)('context', 'keys', code);
    if (!n1) { const r = await callTool('add_node', { botId, type: 'js', position: { x: 160, y: 320 }, data: { label: L1, code, qaExpectation: 'Без code повертає посилання авторизації; з code — міняє на токени і пише їх у воронки-публікатори.' } }); n1 = r.added; }
    else await callTool('update_node', { botId, nodeId: n1.id, data: { code } });
    if (!n2) { const r = await callTool('add_node', { botId, type: 'notifyTg', position: { x: 160, y: 480 }, data: { label: L2, targetKey: 'ADMIN_TELEGRAM_ID', message: '{{context.oauthMessage}}' } }); n2 = r.added; }
    const start = f.nodes.find((n) => n.type === 'start');
    await callTool('update_node', { botId, nodeId: start.id, data: { label: 'Webhook Trigger', trigger: 'webhook', bodySchema: '{\n  "platform": "tiktok | youtube",\n  "code": "string (опційно) — code з адреси після згоди; без нього повертається посилання авторизації"\n}' } });
    const f2 = await callTool('get_funnel', { botId });
    const has = (a, b) => f2.edges.some((e) => e.source === a && e.target === b);
    if (!has(start.id, n1.id)) await callTool('create_edge', { botId, source: start.id, target: n1.id });
    if (!has(n1.id, n2.id)) await callTool('create_edge', { botId, source: n1.id, target: n2.id });
    try { await callTool('auto_layout', { botId }); } catch (e) { /* косметика */ }
    console.log('ok', botId);
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
