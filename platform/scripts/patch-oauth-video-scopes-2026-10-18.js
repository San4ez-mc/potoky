'use strict';
// Patch (source of truth): TikTok OAuth просить лише scopes, які реально використовує публікація (Direct Post):
// user.info.basic + video.publish. video.upload (чернетки) не використовується — зайвий scope TikTok не схвалює на аудиті.
// Ідемпотентний. Запуск на сервері:  node scripts/patch-oauth-video-scopes-2026-10-18.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

async function main() {
    const bot = await db.bot.findFirst({ where: { slug: 'oauth-video' } });
    if (!bot) throw new Error('бот oauth-video не знайдено');
    const f = await callTool('get_funnel', { botId: bot.id });
    const n = f.nodes.find((x) => x.type === 'js' && String(x.data.code || '').includes('tiktok.com/v2/auth/authorize'));
    if (!n) throw new Error('нода коду OAuth не знайдена');
    const code = fs.readFileSync(path.join(__dirname, 'autopost', 'oauth-video-node-code.js'), 'utf8');
    new (Object.getPrototypeOf(async function () {}).constructor)('context', 'keys', code);
    if (String(n.data.code) === code) { console.log('oauth-video: already up to date'); return; }
    await callTool('update_node', { botId: bot.id, nodeId: n.id, data: { code } });
    console.log('oauth-video: code updated');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
