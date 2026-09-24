'use strict';
// Patch (source of truth), п'ята хвиля: крок визначення архетипу без вигадування результатів пошуку.
// Idempotent. Run on the server:  node scripts/patch-fixes5-2026-09-24.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';
const MARK = 'ПРОЦЕДУРА АРХЕТИПУ';

async function main() {
    const f = await callTool('get_funnel', { botId: ONBOARD });
    const cur = String(f.nodes.find((x) => x.id === 'n_agent').data.systemPrompt);
    if (cur.includes(MARK)) { console.log('prompt: already'); return; }
    const add = '\n\n' + MARK + ' (обовʼязково, у такому порядку): (1) виклич query_vector двічі з різними формулюваннями способу впливу клієнта; ' +
        '(2) прочитай результати й назви архетипи ДОСЛІВНО з тексту результатів — ТІЛЬКИ вони можуть бути запропоновані як «з бази»; ' +
        '(3) у відповіді для кожного названого архетипу цитуй його опис із результатів; ' +
        '(4) якщо в профілі клієнта вже є архетип, якого В РЕЗУЛЬТАТАХ НЕМАЄ — так і скажи («опису цього архетипу в базі не знайшов») і спитай, лишати його чи обрати серед знайдених; ' +
        'ніколи не пиши «база підтверджує» про архетип, якого немає в результатах.';
    await callTool('update_node', { botId: ONBOARD, nodeId: 'n_agent', data: { systemPrompt: cur + add } });
    console.log('prompt: patched');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
