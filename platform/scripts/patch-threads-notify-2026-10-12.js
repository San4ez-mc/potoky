'use strict';
// Patch (source of truth): повідомлення власнику про публікацію в Threads — текст поста + посилання сховане за «Опубліковано в Threads»
// (2026-10-12, прохання власника). Текст збирає публікатор (context.publishedMessage, HTML-екранований), нода лише його надсилає.
// Idempotent. Run on the server:  node scripts/patch-threads-notify-2026-10-12.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const BOT = 'cacaf5fb-6ac4-4c34-9a3f-a5a31bbea55c'; // publish-threads
const NODE = 'node_1790210936525';                   // «Threads: опубліковано»
const MSG = '{{context.publishedMessage}}';

async function main() {
    const f = await callTool('get_funnel', { botId: BOT });
    const n = f.nodes.find((x) => x.id === NODE);
    if (!n) throw new Error('нода повідомлення про успіх не знайдена');
    if (n.data.message === MSG) { console.log('already patched'); return; }
    await callTool('update_node', { botId: BOT, nodeId: NODE, data: { message: MSG } });
    console.log('notify message patched');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
