'use strict';
// Холодний старт онбордингу v4: порожній проєкт content2 + клієнт, що відповідає «одним словом».
// Мірило — повнота документів у content2 після діалогу (критерій з онбординг-структура-питань-v4.md §5)
// і відсутність внутрішніх термінів у відповідях бота. Запуск НА СЕРВЕРІ:
//   node scripts/qa/run-onboard-cold.js [--only=S1] [--keep]
// Проєкт «QA — холодний старт» створюється один раз і чиститься між сценаріями (реальні компанії не чіпаємо).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require('@platform/db');
const { startTestSession, sendTestTurn, endTestSession } = require('../../apps/api/src/services/testSession');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';
const C2 = 'http://localhost:3002';
const PROJECT_NAME = 'QA — холодний старт';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));

const SITE_TEXT = [
    'Ось мій сайт, скопіювала текст:',
    'ШКОЛА ЙОГИ «ДИХАЙ». Київ, Поділ. Групові заняття хатха-йоги для початківців і тих, хто повертається після перерви.',
    'Абонемент 8 занять — 1600 грн, 12 занять — 2200 грн, разове заняття — 250 грн. Заняття по 75 хвилин, групи до 10 людей.',
    'Для кого: жінки 30–50 років із сидячою роботою, болить спина й шия, немає сил ввечері.',
    'Інструкторка Олена Ковальчук, сертифікована, 9 років практики, викладає з 2019 року.',
    'Онлайн-курс «Спина без болю» — 4 тижні, 990 грн, доступ 60 днів.',
].join('\n');

const SCENARIOS = [
    { id: 'S1', title: 'Психологиня (сесія 08.10, одним словом)', replies: ['Психолог', 'з жінками над виходом зі стосунків', 'не знаю', 'вона чіткіше доносить свої бажання до чоловіка', 'я за чесність і екологічність', 'я сама була в токсичних стосунках, пішла в психологію, вийшла з них, тепер допомагаю іншим', 'так', 'індивідуальні консультації', '50 євро за годину, є менторинг за 500 євро', 'так', 'фейсбук, телеграм, тредс', 'підходить', 'нема', 'так', 'так', 'так', 'так', 'так'] },
    { id: 'S2', noPrice: true, thin: true, title: 'Мінімум слів: так / не знаю / нема', replies: ['Коуч з продажів', 'так', 'не знаю', 'так', 'нема', 'так', 'не знаю', 'так', 'інстаграм', 'так', 'нема', 'так', 'так'] },
    { id: 'S3', title: 'Спрощений шлях: вставлений текст сайту', replies: [SITE_TEXT, 'так', 'так', 'нема кейсів', 'інстаграм і телеграм', 'так', 'підходить', 'так', 'так'] },
];

const BANNED = /архетип|дотик|cycleposition|contenttype|jtbd|розподіл контент/i;

async function c2Secret() {
    const k = await db.funnelKey.findUnique({ where: { botId_key: { botId: ONBOARD, key: 'CONTENT2_WEBHOOK_SECRET' } }, select: { value: true } });
    return k && k.value;
}
async function ensureProject(secret) {
    const r = await fetch(C2 + '/api/webhooks/onboarding-save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify({ projectName: PROJECT_NAME, kind: 'brand', data: { title: 'QA холодний старт', content: 'Службовий запис, чиститься між прогонами.' } }) });
    const j = await r.json();
    if (!j.projectId) throw new Error('ensureProject: ' + JSON.stringify(j).slice(0, 200));
    return j.projectId;
}
function psql(sql) {
    return execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', 'fineko_content2', '-At', '-c', sql], { encoding: 'utf8' }).trim();
}
function assertId(id) { if (!/^[a-z0-9]+$/i.test(id)) throw new Error('bad project id'); return id; }
function wipe(projectId) {
    const id = assertId(projectId);
    for (const t of ['lead_magnets', 'cases', 'products', 'personas', 'content_topics', 'knowledge_entries', 'founder_profiles', 'smm_strategies', 'story_arcs', 'experiments', 'winning_patterns', 'edit_logs']) {
        psql(`delete from ${t} where project_id='${id}'`);
    }
}
function snapshot(projectId) {
    const id = assertId(projectId);
    const nz = (c) => `coalesce(${c},'')<>''`;
    const sql = `select json_build_object(
 'products',(select coalesce(json_agg(json_build_object('name',name,'description',${nz('description')},'price',${nz('price')},'audience',${nz('audience')},'pains',${nz('pains')},'transformation',${nz('transformation')},'benefits',${nz('benefits')})),'[]'::json) from products where project_id='${id}'),
 'personas',(select coalesce(json_agg(json_build_object('name',name,'pains',${nz('pains')},'goals',${nz('goals')},'triggers',${nz('triggers')},'objections',${nz('objections')},'language',${nz('language')},'tone',${nz('tone')})),'[]'::json) from personas where project_id='${id}'),
 'cases',(select count(*) from cases where project_id='${id}'),
 'founder',(select json_build_object('core',${nz('core')},'diff',coalesce(jsonb_array_length(differentiators::jsonb),0),'selfPres',coalesce(jsonb_array_length("selfPresentation"::jsonb),0)) from founder_profiles where project_id='${id}'),
 'strategy',(select count(*) from smm_strategies where project_id='${id}'),
 'topics',(select json_build_object('n',count(*),'objection',count(*) filter (where content_type='objection')) from content_topics where project_id='${id}'),
 'leadmagnets',(select count(*) from lead_magnets where project_id='${id}'),
 'brand',(select coalesce(json_agg(title),'[]'::json) from knowledge_entries where project_id='${id}' and category='brand'))`;
    return JSON.parse(psql(sql));
}
function grade(s, opts = {}) {
    const fails = [];
    if (!s.products.length) fails.push('нема жодного продукту');
    for (const p of s.products) {
        const miss = ['description', ...(opts.noPrice ? [] : ['price']), 'audience', 'pains', 'transformation', 'benefits'].filter((f) => !p[f]);
        if (miss.length) fails.push(`продукт «${p.name}»: порожні ${miss.join(',')}`);
    }
    if (!s.personas.length) fails.push('нема персони');
    for (const p of s.personas) {
        const miss = ['pains', 'goals', 'triggers', 'objections', 'language', 'tone'].filter((f) => !p[f]);
        if (miss.length) fails.push(`персона «${p.name}»: порожні ${miss.join(',')}`);
    }
    const hasNoCasesMark = (s.brand || []).some((t) => /кейс/i.test(t));
    if (!s.cases && !hasNoCasesMark) fails.push('нема ні кейсу, ні позначки «кейсів поки нема»');
    if (!s.founder || !s.founder.core) fails.push('нема профілю засновника (core)');
    else if (!opts.thin) { if (s.founder.diff < 2) fails.push('засновник: <2 відмінностей'); if (!s.founder.selfPres) fails.push('засновник: нема самопредставлення'); }
    if (!(s.brand || []).some((t) => /тон|tone|tov|голос/i.test(t))) fails.push('нема запису про тон голосу');
    if (!s.strategy) fails.push('нема стратегії');
    if (s.topics.n < 18) fails.push(`тем лише ${s.topics.n} (<18)`);
    else if (s.topics.objection / s.topics.n < 0.2) fails.push(`тем про заперечення ${s.topics.objection}/${s.topics.n} (<20%)`);
    if (!s.leadmagnets) fails.push('нема лід-магніту');
    return fails;
}

async function runScenario(sc, projectId) {
    wipe(projectId);
    const started = await startTestSession({ botId: ONBOARD, contextOverride: { testProjectId: projectId } });
    const sessionId = started.sessionId;
    log('▶', sc.id, sc.title, 'session', sessionId);
    let turns = 0;
    for (const text of sc.replies) {
        const cur = await db.session.findUnique({ where: { id: sessionId }, select: { state: true, isActive: true } });
        if (cur && cur.state === 'completed') break;
        try { await sendTestTurn({ sessionId, text }); turns += 1; } catch (e) { log('  turn failed:', e.message); break; }
    }
    await endTestSession({ sessionId }).catch(() => {});
    const msgs = await db.message.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, select: { role: true, content: true } });
    const bot = msgs.filter((m) => m.role === 'assistant');
    const bannedHits = bot.filter((m) => BANNED.test(m.content || '')).map((m) => (m.content || '').slice(0, 160));
    const snap = snapshot(projectId);
    const fails = grade(snap, { noPrice: !!sc.noPrice, thin: !!sc.thin });
    return { id: sc.id, title: sc.title, sessionId, turns, botMessages: bot.length, bannedHits, snapshot: snap, fails, transcript: msgs.map((m) => ({ role: m.role, content: m.content })) };
}

async function main() {
    const secret = await c2Secret();
    if (!secret) throw new Error('нема CONTENT2_WEBHOOK_SECRET');
    const projectId = await ensureProject(secret);
    log('проєкт', PROJECT_NAME, projectId);
    const results = [];
    for (const sc of SCENARIOS) {
        if (args.only && sc.id !== args.only) continue;
        const r = await runScenario(sc, projectId);
        results.push(r);
        log(r.fails.length || r.bannedHits.length ? '❌' : '✅', r.id, `ходів ${r.turns}, відповідей бота ${r.botMessages}`);
        for (const f of r.fails) log('   ·', f);
        for (const b of r.bannedHits) log('   ⚠ заборонене слово у відповіді:', b);
    }
    if (!args.keep) wipe(projectId);
    const out = '/tmp/onboard-cold-' + Date.now() + '.json';
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    log('ПІДСУМОК:', results.filter((r) => !r.fails.length && !r.bannedHits.length).length + '/' + results.length, 'чисто. Звіт:', out);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
