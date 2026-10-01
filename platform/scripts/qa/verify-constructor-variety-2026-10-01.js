'use strict';
// Регрес-перевірка (не FunnelTest — рахує статистику по батчу, суддя-LLM цього не
// бачить): генеруємо пачку постів для Threads у QA-проєкті й перевіряємо, що
// «конструктор» (structure/intent/hook_type + довжина) РЕАЛЬНО варіюється, а не
// щоразу та сама «середня наративна» форма. Регрес на 2026-10-01: на реальному
// KIRO-батчі 26% постів перевищували ~500 симв (Threads-стеля) і 37/45 структур
// не мали заданого діапазону довжини — у стрічці все виглядало однаково.
//   node scripts/qa/verify-constructor-variety-2026-10-01.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require('@platform/db');

const CM_BOT_ID = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const BATCH_SIZE = 8;

async function getKey(botId, key) {
    const row = await db.funnelKey.findUnique({ where: { botId_key: { botId, key } }, select: { value: true } });
    return row?.value;
}

async function contentDb(sql, params = []) {
    return db.$queryRawUnsafe(sql, ...params);
}

function fail(msg) { throw new Error(msg); }

async function main() {
    const projectId = await getKey(CM_BOT_ID, 'CONTENT2_TEST_PROJECT_ID');
    const secret = await getKey(CM_BOT_ID, 'CONTENT2_WEBHOOK_SECRET');
    if (!projectId || !secret) fail('CONTENT2_TEST_PROJECT_ID / CONTENT2_WEBHOOK_SECRET не знайдено в ключах CM');

    const delUrl = 'http://localhost:3002/api/agent-tools?action=delete_posts&token=' + encodeURIComponent(secret) + '&projectId=' + encodeURIComponent(projectId);
    await fetch(delUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date_from: '2020-01-01', date_to: '2035-12-31' }) });

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const r = await fetch('http://127.0.0.1:3000/webhook/bot/content-manager-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: BATCH_SIZE + ' постів для Threads на найближчий тиждень, різні теми з банку, тільки текст без картинок',
            projectId,
            testMode: true,
        }),
    });
    if (!r.ok) fail('webhook HTTP ' + r.status);

    const url = 'http://localhost:3002/api/agent-tools?action=list_posts&token=' + encodeURIComponent(secret) + '&projectId=' + encodeURIComponent(projectId) + '&date_from=' + tomorrow + '&date_to=2099-01-01';
    let posts = [];
    for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const jr = await fetch(url).then((x) => x.json()).catch(() => null);
        posts = Array.isArray(jr?.posts) ? jr.posts : [];
        if (posts.length >= BATCH_SIZE) break;
    }
    if (posts.length < BATCH_SIZE) fail('Пости не з’явились за ~3 хв (отримано ' + posts.length + ' з ' + BATCH_SIZE + ')');

    const numbers = posts.map((p) => p.number).filter(Boolean);
    const rows = await contentDb(
        'select g.number, g.structure_id, g.intent, g.hook_selected, length(i.content) as len from post_groups g join post_items i on i.group_id = g.id where g.project_id = $1 and g.number = ANY($2::int[]) order by g.number',
        [projectId, numbers]
    );
    console.log('Згенеровані пости:');
    for (const row of rows) console.log(' #' + row.number, row.structure_id, row.intent, row.hook_selected, row.len + ' симв');

    // Осиротілі плейсхолдери (порожній content, structure=null — бо claim не спрацював)
    // не рахуємо в статистику різноманітності, це не реальний пост.
    const real = rows.filter((x) => x.structure_id && Number(x.len) > 0);
    const structures = new Set(real.map((x) => x.structure_id));
    const intents = new Set(real.map((x) => x.intent).filter(Boolean));
    const hooks = new Set(real.map((x) => x.hook_selected).filter(Boolean));
    const lens = real.map((x) => Number(x.len));
    const spread = lens.length ? Math.max(...lens) - Math.min(...lens) : 0;
    const over550NonChain = real.filter((x) => Number(x.len) > 550 && x.structure_id !== 'thread_chain');

    console.log('\nПідсумок:',
        '\n  різних структур:', structures.size, [...structures].join(', '),
        '\n  різних intent:', intents.size, [...intents].join(', '),
        '\n  різних hook_type:', hooks.size, [...hooks].join(', '),
        '\n  довжини (симв):', lens.join(', '));

    // Поріг на РОЗКИД (max-min), а не на жорстку «мусить бути ≥400» — малий n=8 має
    // природну варіацію: батч, що весь впав у «короткий» діапазон (напр. 70-240),
    // усе одно реально чергує довжину між собою, просто без «довгого» хвоста цього разу.
    const problems = [];
    if (real.length < Math.max(3, Math.floor(BATCH_SIZE * 0.6))) problems.push('замало реальних постів: ' + real.length + ' з ' + rows.length + ' рядків (решта — осиротілі плейсхолдери)');
    if (structures.size < 3) problems.push('замало різних структур: ' + structures.size + ' (треба ≥ 3)');
    if (intents.size < 2) problems.push('замало різних intent: ' + intents.size + ' (треба ≥ 2)');
    if (spread < 100) problems.push('довжини постів майже однакові (розкид ' + spread + ' симв, треба ≥ 100) — конструктор не чергує форму');
    if (over550NonChain.length) problems.push(over550NonChain.length + ' пост(ів) перевищують ~550 симв без thread_chain: #' + over550NonChain.map((x) => x.number).join(', '));

    if (problems.length) fail(problems.join('; '));

    console.log('✅ verify-constructor-variety: PASS — структури/intent/hook_type і довжина реально варіюються');
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ verify-constructor-variety: FAIL —', e.message); process.exit(1); });
