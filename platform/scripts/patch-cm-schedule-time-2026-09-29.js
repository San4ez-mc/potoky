'use strict';
// Patch (source of truth): пости, які генерує ST-ланцюжок (план на N днів), лягали в content2
// без schedule_time. Проєкт без календарних слотів (schedule_settings) — такий, як KIRO —
// покладається САМЕ на власний час кожного поста (content2 /api/scheduler/run:
// withinWindow(g.scheduleTime) у fallback-гілці). Без цього поля пост НІКОЛИ не ставав "due" —
// автопостинг мовчки не спрацьовував. Розкидаємо пости одного дня по трьох слотах, що
// збігаються з реальними вікнами крону (09:00 / 12:00 / 18:00 Kyiv — /etc/cron.d, сервер).
// Idempotent. Run on the server:  node scripts/patch-cm-schedule-time-2026-09-29.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const NODE_ID = 'node_1781266905762'; // "ST: Build import payload"
const MARK = 'var SLOTS_PER_DAY';

async function main() {
    const f = await callTool('get_funnel', { botId: CM });
    const n = f.nodes.find((x) => x.id === NODE_ID);
    let code = String(n.data.code);
    if (code.includes(MARK)) { console.log('already patched'); return; }

    const before = code;
    code = code.replace(
        "var importPosts = posts.map(function(p) {",
        "// Розкидаємо пости одного дня по слотах крону (09:00/12:00/18:00 Kyiv) — 1-й пост дня\n" +
        "// на слот 1, 2-й на слот 2 і т.д.; якщо постів на день більше за слоти — циклічно.\n" +
        "var SLOTS_PER_DAY = ['09:00', '12:00', '18:00'];\n" +
        "var __dayCount = {};\n" +
        "var importPosts = posts.map(function(p) {\n" +
        "  var __d = p.date || '';\n" +
        "  var __idx = __dayCount[__d] || 0;\n" +
        "  __dayCount[__d] = __idx + 1;\n" +
        "  var scheduleTimeForPost = SLOTS_PER_DAY[__idx % SLOTS_PER_DAY.length];"
    );
    if (code === before) throw new Error('маркер "var importPosts = posts.map" не знайдено — код змінився, патч треба оновити вручну');

    const before2 = code;
    code = code
        .split("    hook: p.hook || null,\n  };\n});")
        .join("    hook: p.hook || null,\n    schedule_time: scheduleTimeForPost,\n  };\n});");
    if (code === before2) throw new Error('маркер кінця return-обʼєкта importPosts не знайдено — патч треба оновити вручну');

    await callTool('update_node', { botId: CM, nodeId: NODE_ID, data: { code } });
    console.log('patched: ST: Build import payload тепер шле schedule_time (09:00/12:00/18:00 round-robin по днях)');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
