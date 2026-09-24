'use strict';
// Patch (source of truth), четверта хвиля: чесність щодо архетипів + спрощення qaExpectation ноди онбордингу.
// Idempotent. Run on the server:  node scripts/patch-fixes4-2026-09-24.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';

async function main() {
    const f = await callTool('get_funnel', { botId: ONBOARD });
    const n = f.nodes.find((x) => x.id === 'n_agent');
    const cur = String(n.data.systemPrompt);
    if (cur.includes('ЧЕСНІСТЬ ЩОДО АРХЕТИПІВ')) {
        console.log('prompt: already');
    } else {
        const add = '\n\nЧЕСНІСТЬ ЩОДО АРХЕТИПІВ: пропонуй лише ті архетипи, що РЕАЛЬНО повернув query_vector, і не пиши «підтверджує база» про архетип, якого в результатах не було. ' +
            'Якщо для підсилювача підходящого результату нема — зроби ще один query_vector з іншим формулюванням або чесно запропонуй один архетип і спитай клієнта, який ще резонує.';
        await callTool('update_node', { botId: ONBOARD, nodeId: 'n_agent', data: { systemPrompt: cur + add } });
        console.log('prompt: patched');
    }
    await callTool('update_node', {
        botId: ONBOARD, nodeId: 'n_agent',
        data: {
            qaExpectation:
                'Агент онбордингу: відповідає зрозуміло й по-людськи українською на «ти» (списки гіпотез чи тем до 3-4 пунктів допустимі), 1-2 питання за раз; ' +
                'НЕ вигадує факти про клієнта і результати пошуку в базі знань; не перепитує те, що клієнт уже сказав.',
        },
    });
    console.log('qaExpectation: simplified');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
