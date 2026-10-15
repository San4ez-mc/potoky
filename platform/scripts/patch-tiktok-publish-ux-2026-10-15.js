'use strict';
// Patch (source of truth): вікно публікації TikTok (вимоги TikTok до Direct Post, аудит додатка).
//  1) publish-tiktok: режим action=creator_info (нік, дозволена приватність, заборони) → callback у content2;
//     публікація з вибором користувача (context.tiktok); опитування статусу раз на 15 с (ліміт 6 запитів/хв).
//  2) content-scheduler: пробрасує post.tiktok у публікатор.
//  3) Сповіщення публікатора (✅/⚠️ у Telegram) НЕ спрацьовують на creator_info: умови розгалуження розширено третьою «інфо» гілкою
//     з порожнім кінцем, бо інакше кожне відкриття вікна слало б «TikTok: відео відправлено».
// Ідемпотентний. Запуск на сервері:  node scripts/patch-tiktok-publish-ux-2026-10-15.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

const read = (f) => fs.readFileSync(path.join(__dirname, 'autopost', f), 'utf8');
const COND_LABEL = 'Чи є помилка публікації?';
const INFO_LABEL = 'creator_info завершено (без сповіщень)';

async function botBySlug(slug) { const b = await db.bot.findFirst({ where: { slug } }); if (!b) throw new Error('бот не знайдено: ' + slug); return b; }

async function setCode(slug, finder, file) {
    const bot = await botBySlug(slug);
    const f = await callTool('get_funnel', { botId: bot.id });
    const n = f.nodes.find(finder);
    if (!n) throw new Error(slug + ': нода коду не знайдена');
    const code = read(file);
    new (Object.getPrototypeOf(async function () {}).constructor)('context', 'keys', code); // синтаксис
    if (String(n.data.code) === code) { console.log(slug, ': code already up to date'); return { bot, f }; }
    await callTool('update_node', { botId: bot.id, nodeId: n.id, data: { code } });
    console.log(slug, ': code updated');
    return { bot, f };
}

async function main() {
    await setCode('content-scheduler', (n) => n.type === 'js' && String(n.data.code || '').includes('AUTOPOST_BASE'), 'content-scheduler-node-code.js');
    const tt = await setCode('publish-tiktok', (n) => n.type === 'js' && String(n.data.code || '').includes('open.tiktokapis.com'), 'publish-tiktok-node-code.js');

    // сповіщення: creator_info не має слати «відправлено»/«помилка»
    const f = await callTool('get_funnel', { botId: tt.bot.id });
    const cond = f.nodes.find((n) => n.data && n.data.label === COND_LABEL);
    if (!cond) throw new Error('нода умови сповіщень не знайдена — спершу patch-autopost-video-2026-10-03.js');
    const conds = cond.data.conditions || [];
    if (conds.some((c) => c.id === 'info')) { console.log('notify gate: already present'); return; }
    const notInfo = "context.action !== 'creator_info'";
    const next = conds.map((c) => (c.id === 'fail' ? { ...c, expression: '!!context.publishError && ' + notInfo } : c.id === 'ok' ? { ...c, expression: notInfo } : c));
    next.push({ id: 'info', label: 'creator_info', expression: 'true' });
    await callTool('update_node', { botId: tt.bot.id, nodeId: cond.id, data: { conditions: next } });
    const end = await callTool('add_node', { botId: tt.bot.id, type: 'js', position: { x: 0, y: 0 }, data: { label: INFO_LABEL, code: 'return {};' } });
    // порядок ребер від condition = порядок умов: info — третя
    await callTool('create_edge', { botId: tt.bot.id, source: cond.id, target: end.added.id });
    try { await callTool('auto_layout', { botId: tt.bot.id }); } catch (e) { /* косметика */ }
    console.log('notify gate: added (creator_info → тихий кінець)');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
