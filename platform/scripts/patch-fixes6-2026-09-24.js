'use strict';
// Patch (source of truth), шоста хвиля: банк тем — діяти без уточнювальних питань про формат.
// Idempotent. Run on the server:  node scripts/patch-fixes6-2026-09-24.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';
const MARK = 'БАНК ТЕМ БЕЗ УТОЧНЕНЬ';

async function main() {
    const f = await callTool('get_funnel', { botId: ONBOARD });
    const cur = String(f.nodes.find((x) => x.id === 'n_agent').data.systemPrompt);
    if (cur.includes(MARK)) { console.log('prompt: already'); return; }
    const add = '\n\n' + MARK + ': коли клієнт просить згенерувати банк тем (навіть без деталей) — НЕ перепитуй про формат, кількість чи мережу: ' +
        'візьми їх із профілю й запиту, одразу виклич query_vector двічі (типи контенту; цикл «7 дотиків»), склади банк і збережи через save(kind=topics). ' +
        'Уточнення допустимі лише ПІСЛЯ показу першого варіанту.';
    await callTool('update_node', { botId: ONBOARD, nodeId: 'n_agent', data: { systemPrompt: cur + add } });
    console.log('prompt: patched');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
