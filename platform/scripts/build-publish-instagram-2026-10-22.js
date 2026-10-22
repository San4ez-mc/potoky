'use strict';
// Автопостинг в Instagram (Reels / фото / каруселі) через Instagram API (вхід через Instagram, без Facebook-сторінки).
//  1) створює воронку publish-instagram (у тому ж проєкті, що publish-tiktok): код — scripts/autopost/publish-instagram-node-code.js;
//     після нього умова «є помилка?» і два сповіщення в Telegram (успіх: текст поста + приховане посилання; помилка: причина);
//  2) оновлює код воронки oauth-video (додано platform "instagram") і додає в неї ключі IG_APP_ID, IG_APP_SECRET, PUBLISH_INSTAGRAM_BOT_ID;
//  3) оновлює content-scheduler (код не змінювався, але перевіряється, що підтримує публікатори за autopostSlug).
// Підключення акаунта: після введення IG_APP_ID / IG_APP_SECRET у ключі oauth-video — POST /webhook/bot/oauth-video {"platform":"instagram"}.
// Мок-тести: scripts/autopost/test-publishers.js. Idempotent. Run on the server: node scripts/build-publish-instagram-2026-10-22.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

const SLUG = 'publish-instagram';
const TELEGRAM_CONNECTOR_ID = 'eb411228-6318-4e15-8ddb-286d3776fe8b'; // «Контент бот»
const ADMIN_TELEGRAM_ID = '345126254';
const read = (f) => fs.readFileSync(path.join(__dirname, 'autopost', f), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const COND_LABEL = 'Чи є помилка публікації?';

async function main() {
    const tt = await db.bot.findFirst({ where: { slug: 'publish-tiktok' }, include: { project: true } });
    if (!tt) throw new Error('publish-tiktok не знайдено (з нього беремо проєкт)');
    const code = read('publish-instagram-node-code.js');
    new AsyncFunction('context', 'keys', code); // синтаксис

    let bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) {
        await callTool('new_bot', {
            projectSlug: tt.project.slug, name: 'Публікація в Instagram (Reels, фото, каруселі)', slug: SLUG,
            description: 'Публікує Reels, фото і каруселі в Instagram через Instagram API, повертає результат у content2.',
            goal: 'Автопублікація візуального контенту в Instagram за розкладом.', trigger: 'webhook', isActive: true,
        });
        bot = await db.bot.findFirst({ where: { slug: SLUG } });
        console.log('bot created', bot.id);
    }
    const botId = bot.id;

    const have = new Map((await db.funnelKey.findMany({ where: { botId }, select: { key: true, value: true } })).map((x) => [x.key, x.value]));
    const keys = [
        ['IG_USER_ID', '', 'Instagram user id (записується воронкою oauth-video)', false],
        ['IG_ACCESS_TOKEN', '', 'Instagram long-lived access token (записується oauth-video, оновлюється автоматично)', true],
        ['IG_TOKEN_ISSUED_AT', '', 'Коли токен Instagram видано/оновлено (мс)', false],
        ['SELF_BOT_ID', botId, 'ID цієї воронки (для запису оновленого токена)', false],
        ['CONTENT2_URL', 'https://content2.fineko.space', 'content2 (конвертер PNG→JPEG для Instagram)', false],
        ['TELEGRAM_CONNECTOR_ID', TELEGRAM_CONNECTOR_ID, 'Telegram — Контент бот', false],
        ['ADMIN_TELEGRAM_ID', ADMIN_TELEGRAM_ID, 'Кому слати результат публікації', false],
    ];
    for (const [key, value, label, isSecret] of keys) {
        if (have.get(key) && !['SELF_BOT_ID', 'CONTENT2_URL', 'TELEGRAM_CONNECTOR_ID', 'ADMIN_TELEGRAM_ID'].includes(key)) continue; // не затираємо токени
        await callTool('update_funnel_key', { botId, key, value, label, isSecret });
    }
    if (process.env.MCP_SECRET) await callTool('update_funnel_key', { botId, key: 'MCP_SECRET', value: process.env.MCP_SECRET, label: 'MCP write-secret (запис оновленого токена)', isSecret: true });

    // ── граф: start → код → умова → (помилка | успіх) ─────────────────────────────────────────────
    let f = await callTool('get_funnel', { botId });
    if (f.nodes.some((n) => n.id === 'msg_intro')) { await callTool('delete_node', { botId, nodeId: 'msg_intro' }); f = await callTool('get_funnel', { botId }); }
    const L1 = 'Публікація в Instagram';
    let n1 = f.nodes.find((n) => n.type === 'js' && n.data && n.data.label === L1);
    if (!n1) { const r = await callTool('add_node', { botId, type: 'js', position: { x: 160, y: 200 }, data: { label: L1, code, qaExpectation: 'Reels/фото/карусель публікуються; без медіа чесна помилка NO_MEDIA; publishedMessage містить текст поста і сховане посилання.' } }); n1 = r.added; }
    else if (String(n1.data.code) !== code) await callTool('update_node', { botId, nodeId: n1.id, data: { code } });
    const start = f.nodes.find((n) => n.type === 'start');
    await callTool('update_node', { botId, nodeId: start.id, data: { label: 'Webhook Trigger', trigger: 'webhook', bodySchema: '{\n  "items": "[{text, imageUrl|videoUrl}]",\n  "postGroupId": "string",\n  "callbackUrl": "string"\n}' } });
    f = await callTool('get_funnel', { botId });
    if (!f.edges.some((e) => e.source === start.id && e.target === n1.id)) await callTool('create_edge', { botId, source: start.id, target: n1.id });

    if (!f.nodes.some((x) => x.data && x.data.label === COND_LABEL)) {
        const cond = await callTool('add_node', { botId, type: 'condition', position: { x: 160, y: 360 }, data: { label: COND_LABEL, conditions: [
            { id: 'fail', label: 'Помилка', expression: '!!context.publishError' }, { id: 'ok', label: 'OK', expression: 'true' } ] } });
        const err = await callTool('add_node', { botId, type: 'notifyTg', position: { x: 0, y: 520 }, data: { label: 'Instagram: помилка публікації', targetKey: 'ADMIN_TELEGRAM_ID', message: '⚠️ Instagram: не вдалось опублікувати.\n{{context.publishError}}' } });
        const ok = await callTool('add_node', { botId, type: 'notifyTg', position: { x: 320, y: 520 }, data: { label: 'Instagram: опубліковано', targetKey: 'ADMIN_TELEGRAM_ID', message: '{{context.publishedMessage}}' } });
        // порядок ребер від condition = порядок умов: перше — помилка, друге — успіх
        await callTool('create_edge', { botId, source: n1.id, target: cond.added.id });
        await callTool('create_edge', { botId, source: cond.added.id, target: err.added.id });
        await callTool('create_edge', { botId, source: cond.added.id, target: ok.added.id });
        console.log('notify nodes added');
    }
    try { await callTool('auto_layout', { botId }); } catch (e) { /* косметика */ }

    // ── oauth-video: код + ключі Instagram ───────────────────────────────────────────────────────
    const oa = await db.bot.findFirst({ where: { slug: 'oauth-video' } });
    if (oa) {
        const oCode = read('oauth-video-node-code.js');
        new AsyncFunction('context', 'keys', oCode);
        const of = await callTool('get_funnel', { botId: oa.id });
        const on = of.nodes.find((n) => n.type === 'js');
        if (on && String(on.data.code) !== oCode) { await callTool('update_node', { botId: oa.id, nodeId: on.id, data: { code: oCode } }); console.log('oauth-video: code updated'); }
        const oHave = new Map((await db.funnelKey.findMany({ where: { botId: oa.id }, select: { key: true, value: true } })).map((x) => [x.key, x.value]));
        for (const [key, value, label, isSecret] of [
            ['IG_APP_ID', '', 'Instagram app ID (Meta for Developers → Instagram → API setup with Instagram login)', false],
            ['IG_APP_SECRET', '', 'Instagram app secret (там же)', true],
            ['PUBLISH_INSTAGRAM_BOT_ID', botId, 'Куди писати токен Instagram (воронка publish-instagram)', false],
        ]) { if (oHave.get(key) && key !== 'PUBLISH_INSTAGRAM_BOT_ID') continue; await callTool('update_funnel_key', { botId: oa.id, key, value, label, isSecret }); }
    } else console.log('УВАГА: воронку oauth-video не знайдено');
    console.log('ok', botId);
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
