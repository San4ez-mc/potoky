'use strict';
// Patch (джерело істини): допрацювання ІСНУЮЧИХ автопост-воронок під відео (проєкт content-social).
//   content-scheduler — відео як videoUrl (раніше mp4 йшов як imageUrl), title/hook/callbackUrl у публікатор, sendVideo в Telegram,
//                       «published» ставить лише публікатор (а не планувальник одразу, навіть коли публікація впала);
//   publish-threads   — для відео/фото чекає статусу контейнера FINISHED замість фіксованих пауз, callback з externalId/url;
//   publish-tiktok    — Content Posting API через FILE_UPLOAD (без верифікації домену), refresh токена, рівень приватності за
//                       дозволеним акаунтом, опитування статусу, callback;
//   publish-youtube-shorts — Shorts: метаданіз хука/хештегів, обробка квоти й «private через неаудований проєкт», callback;
//   + для TikTok і YouTube — повідомлення власнику про результат (як у Threads).
// Код нод — у scripts/autopost/*.js (покриті мок-тестами test-publishers.js). Idempotent. Run on the server:
//   node scripts/patch-autopost-video-2026-10-03.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

const read = (f) => fs.readFileSync(path.join(__dirname, 'autopost', f), 'utf8');
const COND_LABEL = 'Чи є помилка публікації?';
const TELEGRAM_CONNECTOR_ID = 'eb411228-6318-4e15-8ddb-286d3776fe8b'; // «Контент бот», як у publish-threads
const ADMIN_TELEGRAM_ID = '345126254';

async function botBySlug(slug) { const b = await db.bot.findFirst({ where: { slug } }); if (!b) throw new Error('бот не знайдено: ' + slug); return b; }

async function setCode(slug, nodeFinder, file) {
    const bot = await botBySlug(slug);
    const f = await callTool('get_funnel', { botId: bot.id });
    const n = f.nodes.find(nodeFinder);
    if (!n) throw new Error(slug + ': нода коду не знайдена');
    const code = read(file);
    new (Object.getPrototypeOf(async function () {}).constructor)('context', 'keys', code); // синтаксис
    if (String(n.data.code) === code) { console.log(slug, ': code already up to date'); return { bot, node: n, f }; }
    await callTool('update_node', { botId: bot.id, nodeId: n.id, data: { code } });
    console.log(slug, ': code updated');
    return { bot, node: n, f };
}

async function ensureNotify(bot, node, f, label, okMsg, errMsg) {
    await callTool('update_funnel_key', { botId: bot.id, key: 'TELEGRAM_CONNECTOR_ID', value: TELEGRAM_CONNECTOR_ID, label: 'Telegram — Контент бот' });
    await callTool('update_funnel_key', { botId: bot.id, key: 'ADMIN_TELEGRAM_ID', value: ADMIN_TELEGRAM_ID, label: 'Кому слати результат публікації' });
    if (f.nodes.some((x) => x.data && x.data.label === COND_LABEL)) { console.log(label, ': notify already present'); return; }
    const cond = await callTool('add_node', { botId: bot.id, type: 'condition', position: { x: 0, y: 0 }, data: { label: COND_LABEL, conditions: [
        { id: 'fail', label: 'Помилка', expression: '!!context.publishError' }, { id: 'ok', label: 'OK', expression: 'true' } ] } });
    const err = await callTool('add_node', { botId: bot.id, type: 'notifyTg', position: { x: 0, y: 0 }, data: { label: label + ': помилка публікації', targetKey: 'ADMIN_TELEGRAM_ID', message: errMsg } });
    const ok = await callTool('add_node', { botId: bot.id, type: 'notifyTg', position: { x: 0, y: 0 }, data: { label: label + ': опубліковано', targetKey: 'ADMIN_TELEGRAM_ID', message: okMsg } });
    // порядок ребер від condition = порядок умов: перше — помилка, друге — успіх
    await callTool('create_edge', { botId: bot.id, source: node.id, target: cond.added.id });
    await callTool('create_edge', { botId: bot.id, source: cond.added.id, target: err.added.id });
    await callTool('create_edge', { botId: bot.id, source: cond.added.id, target: ok.added.id });
    try { await callTool('auto_layout', { botId: bot.id }); } catch (e) { /* косметика */ }
    console.log(label, ': notify nodes added');
}

async function main() {
    await setCode('content-scheduler', (n) => n.type === 'js' && /Content Scheduler|scheduler/i.test(String(n.data.label || '')) || String(n.data.code || '').includes('AUTOPOST_BASE'), 'content-scheduler-node-code.js');
    await setCode('publish-threads', (n) => n.type === 'js' && String(n.data.code || '').includes('graph.threads.net'), 'publish-threads-node-code.js');

    const tt = await setCode('publish-tiktok', (n) => n.type === 'js', 'publish-tiktok-node-code.js');
    await ensureNotify(tt.bot, tt.node, tt.f, 'TikTok',
        '✅ TikTok: відео відправлено (publish_id {{context.publishId}}, приватність {{context.privacy}}).\n{{context.note}}',
        '⚠️ TikTok: не вдалось опублікувати.\n{{context.publishError}}');
    const yt = await setCode('publish-youtube-shorts', (n) => n.type === 'js', 'publish-youtube-node-code.js');
    await ensureNotify(yt.bot, yt.node, yt.f, 'YouTube',
        '✅ YouTube Shorts: {{context.url}}\n{{context.note}}',
        '⚠️ YouTube: не вдалось опублікувати.\n{{context.publishError}}');

    for (const [slug, desc, goal] of [
        ['publish-tiktok', 'Публікує вертикальне відео в TikTok через Content Posting API (FILE_UPLOAD), повертає результат у content2.', 'Автопублікація відео з контент-плану в TikTok і сповіщення власника.'],
        ['publish-youtube-shorts', 'Публікує вертикальне відео як YouTube Shorts через YouTube Data API v3, повертає результат у content2.', 'Автопублікація відео з контент-плану в YouTube Shorts і сповіщення власника.'],
    ]) { const b = await botBySlug(slug); try { await callTool('update_bot', { botId: b.id, description: desc, goal }); } catch (e) { console.log('update_bot', slug, e.message); } }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
