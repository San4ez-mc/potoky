'use strict';
// Синхронізує QA-тести воронок (онбординг + Content Manager) у БД і запускає їх послідовно.
//   node scripts/qa/run-suite.js [--bot=onboard|cm|all] [--only=<частина назви>] [--sync-only] [--no-cleanup]
// Результати: stdout (компактно) + повний JSON у /tmp/qa-results-<ts>.json (транскрипти, вердикти).

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require('@platform/db');
const ft = require('../../apps/api/src/services/funnelTests');
const { PROFILE } = require('./qa-profile');

const JUDGE_CONNECTOR = '4f9fbe29-e85a-40dd-93ed-4ed1b5f9fba6'; // Claude ключ для контент платформи
const BOTS = {
    onboard: { id: 'ab566038-395e-4da8-b500-8f9b226bc77a', label: 'Онбординг v3', defs: require('./tests-onboard') },
    cm: { id: '22f2bce5-ac62-4297-8ea0-66e258e8b505', label: 'Content Manager 2.0', defs: require('./tests-content-manager') },
};

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
const only = args.only ? String(args.only).toLowerCase() : null;
const which = args.bot && args.bot !== 'all' ? [args.bot] : Object.keys(BOTS);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const RUN_ID = String(Date.now()).slice(-4); // код прогону: робить «новий» продукт у O5 справді новим
const withRun = (v) => (typeof v === 'string' ? v.split('{{RUN}}').join(RUN_ID) : v);

async function sync(botKey) {
    const { id: botId, defs } = BOTS[botKey];
    const existing = await db.funnelTest.findMany({ where: { botId }, select: { id: true, name: true } });
    const byName = new Map(existing.map((t) => [t.name, t.id]));
    const ids = [];
    for (const d of defs) {
        const payload = { name: d.name, description: withRun(d.description), steps: d.steps.map((st) => ({ ...st, text: withRun(st.text) })), expectedOutcome: withRun(d.expectedOutcome), connectorId: JUDGE_CONNECTOR };
        if (byName.has(d.name)) { await ft.updateTest(byName.get(d.name), payload); ids.push({ id: byName.get(d.name), name: d.name }); }
        else { const created = await ft.createTest({ botId, ...payload }); ids.push({ id: created.id, name: d.name }); }
    }
    return ids;
}

// Чистимо пости QA-проєкту перед запуском Content Manager — щоб тести не залежали від минулих прогонів.
async function cleanupQaPosts() {
    const cm = BOTS.cm.id;
    const get = async (key) => (await db.funnelKey.findUnique({ where: { botId_key: { botId: cm, key } }, select: { value: true } }))?.value;
    const projectId = await get('CONTENT2_TEST_PROJECT_ID');
    const secret = await get('CONTENT2_WEBHOOK_SECRET');
    if (!projectId || !secret) { log('cleanup: пропущено (нема CONTENT2_TEST_PROJECT_ID/секрету)'); return; }
    const url = 'http://localhost:3002/api/agent-tools?action=delete_posts&token=' + encodeURIComponent(secret) + '&projectId=' + encodeURIComponent(projectId);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date_from: '2020-01-01', date_to: '2035-12-31' }) });
    log('cleanup QA posts → HTTP', r.status, (await r.text()).slice(0, 120));
}


// Повертаємо профіль QA-проєкту онбордингу до еталона (onboarding-save оновлює за назвою) — щоб зміни попередніх прогонів (ціна тощо) не впливали.
async function resetOnboardProfile() {
    const ob = BOTS.onboard.id;
    const get = async (key) => (await db.funnelKey.findUnique({ where: { botId_key: { botId: ob, key } }, select: { value: true } }))?.value;
    const projectId = await get('CONTENT2_TEST_PROJECT_ID');
    const secret = await get('CONTENT2_WEBHOOK_SECRET');
    if (!projectId || !secret) { log('reset: пропущено'); return; }
    for (const item of PROFILE) {
        await fetch('http://localhost:3002/api/webhooks/onboarding-save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify({ projectId, kind: item.kind, data: item.data }) });
    }
    log('reset QA-профілю онбордингу виконано');
}

async function main() {
    const results = [];
    for (const botKey of which) {
        const ids = await sync(botKey);
        log(`[${BOTS[botKey].label}] тестів у БД: ${ids.length}`);
        if (args['sync-only']) continue;
        if (botKey === 'onboard' && !args['no-cleanup']) await resetOnboardProfile();
        if (botKey === 'cm' && !args['no-cleanup']) await cleanupQaPosts();
        for (const { id, name } of ids) {
            if (only && !name.toLowerCase().includes(only)) continue;
            log('▶', name);
            const started = Date.now();
            const res = await ft.runTest(id);
            const sec = Math.round((Date.now() - started) / 1000);
            const v = res.verdict || {};
            log(res.status === 'passed' ? '✅' : (res.status === 'error' ? '💥' : '❌'), name, `(${sec}s)`, res.status !== 'passed' ? '— ' + String(v.reasoning || '').slice(0, 600) : '');
            results.push({ bot: botKey, name, testId: id, status: res.status, sec, verdict: v, transcript: res.transcript, sessionId: res.sessionId });
        }
    }
    const out = '/tmp/qa-results-' + Date.now() + '.json';
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    const passed = results.filter((r) => r.status === 'passed').length;
    log(`ПІДСУМОК: ${passed}/${results.length} пройдено. Повний звіт: ${out}`);
    for (const r of results.filter((x) => x.status !== 'passed')) log(' -', r.name, '→', r.status);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
