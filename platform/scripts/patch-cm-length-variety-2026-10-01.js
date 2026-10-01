'use strict';
// Patch (source of truth): 2 проблеми з реальних постів KIRO (26.09–01.10):
// 1) ~26% постів перевищували ~500 символів (Threads обрізає стрічку приблизно там) —
//    бо структури типу listicle/pas/aida офіційно дозволяють до 1800-2000 симв (це
//    ліміт для LinkedIn/Telegram, не Threads), а модель бере верхню межу структури,
//    ігноруючи мережеве правило "Обрізка ~500 символів".
// 2) Пости в стрічці не відчувались різними за довжиною/типом (все — середньо-довгий
//    наратив), хоча структур обирається багато різних — бо до цього 37 з 45 структур
//    взагалі не мали min_len/max_len (окремий фікс у content2: backfill-structure-lengths).
// Цей патч додає ЯВНЕ правило пріоритету (мережа > структура) і вимогу свідомо
// чергувати довжину/тип постів у межах одного батчу.
// Idempotent. Run on the server:  node scripts/patch-cm-length-variety-2026-10-01.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const NODE_ID = 'node_1780590932392'; // "ST: Generate (Sonnet)"
const MARK = 'ПРІОРИТЕТ ДОВЖИНИ';

async function main() {
    const f = await callTool('get_funnel', { botId: CM });
    const n = f.nodes.find((x) => x.id === NODE_ID);
    const sp = String(n.data.systemPrompt);
    if (sp.includes(MARK)) { console.log('already patched'); return; }

    const needle = 'СТРУКТУРИ ПОСТІВ (варіюй формати — не роби всі пости однаковими):\n{{context.structuresText}}';
    if (!sp.includes(needle)) throw new Error('маркер "СТРУКТУРИ ПОСТІВ" не знайдено — промпт змінився, патч треба оновити вручну');

    const insert = needle +
        '\n\n' + MARK + ' — коли max_len структури конфліктує з лімітом мережі (напр. Threads ~500 симв, а' +
        ' структура дозволяє до 1800-2000 — це ліміт для LinkedIn/Telegram), МЕРЕЖА ПЕРЕМАГАЄ: для Threads' +
        ' тримай пост у межах ~500 символів, НЕЗАЛЕЖНО від max_len структури. Виняток — thread_chain: там' +
        ' довгий багаточастинний формат і є сама суть структури.' +
        '\n\nЧЕРГУВАННЯ В БАТЧІ — якщо генеруєш кілька постів за один раз, свідомо чергуй довжину й тип,' +
        ' а не бери щоразу «середній наратив»: серед кожних 3-4 постів має бути хоча б один КОРОТКИЙ' +
        ' (<250 симв, напр. структура з діапазоном 150-280) і хоча б один з явно іншою формою (питання,' +
        ' список, факт) — не повторюй ту саму структуру двічі підряд по порядку дат.';

    const newSp = sp.split(needle).join(insert);
    await callTool('update_node', { botId: CM, nodeId: NODE_ID, data: { systemPrompt: newSp } });
    console.log('patched: ST: Generate тепер пріоритизує довжину мережі над структурою і вимагає чергування в батчі');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
