'use strict';
// Повний прогін FunnelTest бота (тести, що імітують живих клієнтів) паралельно, з порівнянням із попереднім результатом кожного тесту.
//   node scripts/qa/run-all-funnel-tests.js [botId] [--par 6] [--out /tmp/funnel-all.json]
// Наприкінці: ПІДСУМОК, «стало гірше» (раніше passed → тепер failed), «стало краще», решта провалів — з причиною від судді.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const API = path.join(__dirname, '..', '..', 'apps', 'api', 'src', 'services');
const { runTest, testSpendTodayUsd, TEST_BUDGET_USD_DAY } = require(path.join(API, 'funnelTests'));
const { db } = require(path.join(API, 'shopAgent/lib'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BOT = args.find((a) => /^[0-9a-f-]{36}$/.test(a)) || 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const PAR = Math.max(1, Math.min(10, Number(opt('--par', 6))));
const OUT = opt('--out', '/tmp/funnel-all.json');

(async () => {
    let tests = await db.funnelTest.findMany({ where: { botId: BOT }, select: { id: true, name: true, lastRunStatus: true }, orderBy: { createdAt: 'asc' } });
    // --only id1,id2 — лише ці тести (префікси id), напр. повторний прогін «стало гірше», щоб відрізнити випадковість від поломки.
    const only = String(opt('--only', '')).split(',').map((s) => s.trim()).filter(Boolean);
    if (only.length) tests = tests.filter((t) => only.some((p) => t.id.startsWith(p)));
    const before = new Map(tests.map((t) => [t.id, t.lastRunStatus || null]));
    console.log('тестів:', tests.length, 'паралельно:', PAR);
    // Витрати: вже витрачено сьогодні й орієнтовна вартість цього прогону (≈$0.07 за тест-діалог із суддею, за даними 15.10).
    const spent0 = await testSpendTodayUsd().catch(() => 0); const lim = TEST_BUDGET_USD_DAY();
    console.log('витрачено на тести сьогодні ≈$' + spent0.toFixed(2) + ' з ліміту $' + lim + '; цей прогін ≈$' + (tests.length * 0.07).toFixed(2));
    let stop = false;
    const results = []; let next = 0; let done = 0;
    async function worker() {
        while (!stop && next < tests.length) {
            const t = tests[next++];
            let r;
            try { r = await runTest(t.id); } catch (e) { r = { status: 'error', error: e.message }; }
            if (r.budgetStop) { if (!stop) console.log('⛔ ' + (r.verdict && r.verdict.reasoning)); stop = true; break; }
            const v = r.verdict || {};
            results.push({ id: t.id, name: t.name, before: before.get(t.id), status: r.status, reason: String(v.reasoning || r.error || '').slice(0, 600), sessionId: r.sessionId || null });
            done++;
            console.log('[' + done + '/' + tests.length + '] ' + (r.status === 'passed' ? 'PASS' : r.status === 'failed' ? 'FAIL' : 'ERR ') + ' ' + t.id.slice(0, 8) + ' | ' + String(t.name).slice(0, 90));
        }
    }
    await Promise.all(Array.from({ length: PAR }, worker));
    require('fs').writeFileSync(OUT, JSON.stringify(results, null, 1));
    const passed = results.filter((r) => r.status === 'passed');
    const worse = results.filter((r) => r.status !== 'passed' && r.before === 'passed');
    const better = results.filter((r) => r.status === 'passed' && r.before && r.before !== 'passed');
    const restFail = results.filter((r) => r.status !== 'passed' && r.before !== 'passed');
    const line = (r) => '  ' + r.id.slice(0, 8) + ' | ' + String(r.name).slice(0, 100) + '\n      ' + r.reason.replace(/\s+/g, ' ').slice(0, 400) + (r.sessionId ? '\n      сесія: ' + r.sessionId : '');
    console.log('\nПІДСУМОК: ' + passed.length + ' з ' + results.length + ' (було пройдено раніше: ' + [...before.values()].filter((s) => s === 'passed').length + ')');
    console.log('\nСТАЛО ГІРШЕ (раніше проходив, тепер ні): ' + worse.length); worse.forEach((r) => console.log(line(r)));
    console.log('\nСТАЛО КРАЩЕ (раніше не проходив, тепер так): ' + better.length); better.forEach((r) => console.log('  ' + r.id.slice(0, 8) + ' | ' + String(r.name).slice(0, 100)));
    console.log('\nНЕ ПРОХОДИВ І РАНІШЕ: ' + restFail.length); restFail.forEach((r) => console.log(line(r)));
    process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
