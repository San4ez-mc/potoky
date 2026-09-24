'use strict';
// Patch (source of truth): direct autopost pipeline.
//  1) content-scheduler: per-post Telegram toggle + dispatch to publish-<slug> for posts with postDirectly.
//  2) publish-threads: reply-chain support (items[]), permalink, and Telegram notify on success/failure.
// Idempotent: safe to re-run (node code is overwritten; notify nodes are added only once).
// Run on the server:  node scripts/patch-autopost-2026-09-24.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const SCHEDULER_BOT = '0283616c-45e7-43c1-a699-d2dab43f3534';
const SCHEDULER_NODE = 'node_1781106316537';
const THREADS_BOT = 'cacaf5fb-6ac4-4c34-9a3f-a5a31bbea55c';
const THREADS_NODE = 'node_1782133451881';
const TELEGRAM_CONNECTOR_ID = 'eb411228-6318-4e15-8ddb-286d3776fe8b'; // "Контент бот"
const ADMIN_TELEGRAM_ID = '345126254';
const COND_LABEL = 'Чи є помилка публікації?';

const read = (f) => fs.readFileSync(path.join(__dirname, 'autopost', f), 'utf8');

async function main() {
    const out = {};

    await callTool('update_node', { botId: SCHEDULER_BOT, nodeId: SCHEDULER_NODE, data: { code: read('content-scheduler-node-code.js') } });
    out.scheduler = 'code updated';

    await callTool('update_node', { botId: THREADS_BOT, nodeId: THREADS_NODE, data: { code: read('publish-threads-node-code.js') } });
    out.threadsCode = 'code updated';

    await callTool('update_funnel_key', { botId: THREADS_BOT, key: 'TELEGRAM_CONNECTOR_ID', value: TELEGRAM_CONNECTOR_ID, label: 'Telegram — Контент бот' });
    await callTool('update_funnel_key', { botId: THREADS_BOT, key: 'ADMIN_TELEGRAM_ID', value: ADMIN_TELEGRAM_ID, label: 'Кому слати результат публікації' });

    const funnel = await callTool('get_funnel', { botId: THREADS_BOT });
    if (funnel.nodes.some((n) => n.data && n.data.label === COND_LABEL)) {
        out.notify = 'already present, skipped';
    } else {
        const cond = await callTool('add_node', {
            botId: THREADS_BOT, type: 'condition', position: { x: 0, y: 0 },
            data: {
                label: COND_LABEL,
                conditions: [
                    { id: 'fail', label: 'Помилка', expression: '!!context.publishError' },
                    { id: 'ok', label: 'OK', expression: 'true' },
                ],
            },
        });
        const err = await callTool('add_node', {
            botId: THREADS_BOT, type: 'notifyTg', position: { x: 0, y: 0 },
            data: {
                label: 'Threads: помилка публікації',
                targetKey: 'ADMIN_TELEGRAM_ID',
                message: '⚠️ Threads: не вдалось опублікувати.\n{{context.publishError}}\nОпубліковано частково: {{context.threadIds}}',
            },
        });
        const ok = await callTool('add_node', {
            botId: THREADS_BOT, type: 'notifyTg', position: { x: 0, y: 0 },
            data: {
                label: 'Threads: опубліковано',
                targetKey: 'ADMIN_TELEGRAM_ID',
                message: '✅ Опубліковано в Threads\n{{context.permalink}}',
            },
        });
        // Condition edge order matters: index0 = error branch, index1 = success.
        await callTool('create_edge', { botId: THREADS_BOT, source: THREADS_NODE, target: cond.added.id });
        await callTool('create_edge', { botId: THREADS_BOT, source: cond.added.id, target: err.added.id });
        await callTool('create_edge', { botId: THREADS_BOT, source: cond.added.id, target: ok.added.id });
        await callTool('auto_layout', { botId: THREADS_BOT });
        out.notify = 'added condition + 2 notifyTg';
    }

    await callTool('update_bot', {
        botId: THREADS_BOT,
        description: 'Публікує текст/фото/відео в Threads через офіційний Threads API (Meta). Приймає items[] — ланцюжок (перший пост + відповіді). Шле результат у Telegram.',
        goal: 'Автопублікація постів із контент-плану в Threads і сповіщення власника про результат.',
    });

    console.log(JSON.stringify(out, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
