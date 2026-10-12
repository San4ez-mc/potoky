'use strict';
// Patch (source of truth): жорсткий ліміт Threads для Content Manager (2026-10-12).
// Проблема: 5 з 38 опублікованих постів KIRO були обрізані публікатором на 500 символах (listicle 740 і т.ін.), бо ліміт існував лише як
// «побажання» в промпті (patch-cm-length-variety-2026-10-01), а модель рахує символи неточно. Тепер ліміт перевіряє код content2
// (create_post відхиляє, bulk-import кладе в чернетку), а цей патч каже моделі, ЩО її чекає, і як мірити.
// Idempotent. Run on the server:  node scripts/patch-cm-threads-limit-2026-10-12.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const NODE_ID = 'node_1780590932392'; // "ST: Generate (Sonnet)"
const MARK = 'ЖОРСТКИЙ ЛІМІТ THREADS';
const AFTER = 'ПРІОРИТЕТ ДОВЖИНИ';

async function main() {
    const f = await callTool('get_funnel', { botId: CM });
    const n = f.nodes.find((x) => x.id === NODE_ID);
    const sp = String(n.data.systemPrompt);
    if (sp.includes(MARK)) { console.log('already patched'); return; }
    if (!sp.includes(AFTER)) throw new Error('маркер ПРІОРИТЕТ ДОВЖИНИ не знайдено — промпт змінився');
    const add = '\n\n' + MARK + ': пост для Threads — НЕ БІЛЬШЕ 500 символів разом із пробілами, емодзі й хештегом; мовою (українська чи англійська) це не міняється, кожна літера = 1 символ. ' +
        'Система перевіряє це кодом: довший пост або не збережеться (create_post поверне помилку), або піде в чернетки без публікації. ' +
        'Цілься в 250–420 символів; пост на 450+ — на межі, скорочуй. Не вміщається думка — зроби ланцюжок з кількох окремих постів (кожен ≤ 500), а не один довгий. ' +
        'Порада: лістикл («5 причин…») найкраще заходить у цій аудиторії, але в межах ліміту — стисни пункти до однієї короткої фрази.';
    const idx = sp.indexOf(AFTER);
    const lineEnd = sp.indexOf('\n\n', idx);          // вставляємо після абзацу ПРІОРИТЕТ ДОВЖИНИ
    const pos = lineEnd === -1 ? sp.length : lineEnd;
    const newSp = sp.slice(0, pos) + add + sp.slice(pos);
    await callTool('update_node', { botId: CM, nodeId: NODE_ID, data: { systemPrompt: newSp } });
    console.log('patched: +' + add.length + ' симв.');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
