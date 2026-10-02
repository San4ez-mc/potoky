'use strict';
// Регрес-перевірка «актуально / застаріло» (не FunnelTest: суддя-LLM тут зайвий — перевіряємо
// ДЕТЕРМІНОВАНО на маркерах-сентинелах). Працює в ізольованому QA-проєкті (пекарня «Крихта»).
//
// Сценарій:
//   0. чистимо факти й пости QA-проєкту; сідимо СТАРИЙ факт (акція «СУБОТА-40»), факт, що вже
//      закінчився за датою («ВЧОРА-77», valid_until = вчора), майбутній факт («ПОДІЛ-20», valid_from
//      через 18 днів) і запланований пост зі старим формулюванням;
//   1. ПИШЕМО БОТУ новину (як клієнт): СУБОТА-40 закінчилась, замість неї НЕДІЛЯ-55;
//   2. перевіряємо в БД: новий факт активний, СУБОТА-40 застаріла (замінена), ВЧОРА-77 застарілий за
//      датою, ПОДІЛ-20 — «заплановано», блок АКТУАЛЬНІ ФАКТИ не містить застарілого;
//   3. запланований пост зі СУБОТА-40 виправлено ботом (не лишилось старого формулювання);
//   4. просимо ботa згенерувати 6 постів про акції — НЕ має бути СУБОТА-40/ВЧОРА-77 і не має бути
//      ПОДІЛ-20 як чогось вже наявного; хоча б в одному посту — НЕДІЛЯ-55.
//   node scripts/qa/verify-dated-facts-2026-10-02.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require('@platform/db');
const { chat } = require('./cm-chat');

const CM_BOT_ID = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const BASE = 'http://localhost:3002/api/agent-tools';

const fail = (m) => { throw new Error(m); };
const iso = (offsetDays) => { const d = new Date(Date.now() + offsetDays * 86400000); return d.toISOString().slice(0, 10); };

async function getKey(key) {
    const row = await db.funnelKey.findUnique({ where: { botId_key: { botId: CM_BOT_ID, key } }, select: { value: true } });
    return row && row.value;
}

async function main() {
    const projectId = await getKey('CONTENT2_TEST_PROJECT_ID');
    const secret = await getKey('CONTENT2_WEBHOOK_SECRET');
    if (!projectId || !secret) fail('CONTENT2_TEST_PROJECT_ID / CONTENT2_WEBHOOK_SECRET не знайдено');

    const tool = async (action, body, query) => {
        const url = BASE + '?action=' + action + '&token=' + encodeURIComponent(secret) + '&projectId=' + encodeURIComponent(projectId) + (query || '');
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
        return r.json();
    };

    // ── 0. чистий стан ───────────────────────────────────────────────────────
    await tool('delete_posts', { date_from: '2020-01-01', date_to: '2035-12-31' });
    await tool('delete_facts', {});

    const r1 = await tool('save_fact', { topic: 'акція на хліб', title: 'Акція СУБОТА-40', content: 'Щосуботи діє акція «СУБОТА-40»: буханка ранкового хліба коштує 40 грн.', valid_from: iso(-20) });
    if (!r1.ok) fail('seed old fact: ' + JSON.stringify(r1));
    const r2 = await tool('save_fact', { topic: 'вчорашня акція', title: 'Акція ВЧОРА-77', content: 'Діє акція «ВЧОРА-77»: другий круасан за 77 грн.', valid_from: iso(-30), valid_until: iso(-1) });
    if (!r2.ok) fail('seed expired fact: ' + JSON.stringify(r2));
    const r3 = await tool('save_fact', { topic: 'друга пекарня', title: 'Друга пекарня на Подолі', content: 'Друга пекарня на Подолі відкриється з вихідних; акція відкриття «ПОДІЛ-20»: знижка 20% першого дня.', valid_from: iso(18) });
    if (!r3.ok) fail('seed future fact: ' + JSON.stringify(r3));

    // запланований пост зі старим формулюванням (його має виправити бот, коли СУБОТА-40 застаріє)
    const staleCreate = await tool('create_post', {
        date: iso(3), platform: 'threads',
        content: 'Щосуботи — акція СУБОТА-40: буханка ранкового хліба 40 грн. Заходьте за теплим, поки не розібрали.',
        audience: 'cold', post_type: 'post',
    });
    if (!staleCreate.ok) fail('seed stale post: ' + JSON.stringify(staleCreate));
    const stalePostNumber = staleCreate.post && staleCreate.post.number;
    console.log('Сід: старий факт, прострочений факт, майбутній факт, запланований пост #' + stalePostNumber);

    // ── 1. новина боту ───────────────────────────────────────────────────────
    const news = 'Нова інформація по пекарні. Акцію «СУБОТА-40» ми закінчили. Тепер щонеділі діє нова акція «НЕДІЛЯ-55»: буханка 55 грн, а кава в подарунок. Це вже діє.';
    const rep = await chat(projectId, news, 420);
    console.log('Відповідь бота на новину:\n' + rep.replies.slice(-1)[0]);

    // ── 2. стан фактів ───────────────────────────────────────────────────────
    const facts = (await tool('get_facts', {}, '&status=all')).facts || [];
    const problems = [];
    const find = (s) => facts.filter((f) => (f.title + ' ' + f.content).includes(s));
    const newer = find('НЕДІЛЯ-55');
    if (!newer.length) problems.push('новий факт НЕДІЛЯ-55 не збережено ботом');
    else if (!newer.some((f) => f.status === 'active')) problems.push('НЕДІЛЯ-55 збережено, але не активний: ' + newer.map((f) => f.status).join(','));
    const oldSat = find('СУБОТА-40').filter((f) => !f.title.includes('НЕДІЛЯ') && !newer.includes(f));
    if (oldSat.some((f) => f.status === 'active')) problems.push('СУБОТА-40 лишився АКТУАЛЬНИМ (бот не замінив старий факт: інша topic?)');
    const exp = find('ВЧОРА-77');
    if (!exp.length || exp.some((f) => f.status !== 'outdated')) problems.push('ВЧОРА-77 (valid_until учора) має бути застарілим: ' + JSON.stringify(exp.map((f) => f.status)));
    const fut = find('ПОДІЛ-20');
    if (!fut.length || fut.some((f) => f.status !== 'scheduled')) problems.push('ПОДІЛ-20 (valid_from через 18 днів) має бути «заплановано»: ' + JSON.stringify(fut.map((f) => f.status)));

    const block = (await tool('get_facts', {})).text || '';
    if (/СУБОТА-40/.test(block)) problems.push('блок АКТУАЛЬНІ ФАКТИ все ще містить СУБОТА-40');
    if (/ВЧОРА-77/.test(block)) problems.push('блок АКТУАЛЬНІ ФАКТИ містить ВЧОРА-77');
    if (!/НЕДІЛЯ-55/.test(block)) problems.push('блок АКТУАЛЬНІ ФАКТИ не містить НЕДІЛЯ-55');
    const actualPart = block.split('ЗАПЛАНОВАНО')[0];
    if (/ПОДІЛ-20/.test(actualPart)) problems.push('ПОДІЛ-20 потрапив у «актуальне», хоча діє лише з майбутньої дати');

    // ── 3. запланований пост виправлено ──────────────────────────────────────
    const stalePost = await tool('get_post', { number: String(stalePostNumber) });
    const staleText = stalePost.ok && stalePost.post ? stalePost.post.content || '' : '';
    if (!stalePost.ok) problems.push('запланований пост #' + stalePostNumber + ' зник');
    else if (/СУБОТА-40/.test(staleText)) problems.push('пост #' + stalePostNumber + ' лишився зі старим формулюванням СУБОТА-40: «' + staleText.slice(0, 80) + '»');
    console.log('Пост #' + stalePostNumber + ' після новини: «' + staleText.slice(0, 160) + '»');

    // ── 4. генерація нових постів ────────────────────────────────────────────
    const gen = await chat(projectId, '6 постів для Threads на найближчий тиждень про наші акції та ціни на хліб, тільки текст без картинок', 480);
    console.log('Відповідь бота на генерацію (початок): ' + String(gen.replies.slice(-1)[0] || '').slice(0, 200));
    const listed = await tool('list_posts', { date_from: iso(0), date_to: '2099-01-01' });
    const rows = [];
    for (const p of (listed.posts || [])) {
        if (p.number === stalePostNumber) continue;
        const full = await tool('get_post', { number: String(p.number) });
        const content = full.ok && full.post ? full.post.content || '' : '';
        if (content.length > 0) rows.push({ number: p.number, content });
    }
    if (rows.length < 3) problems.push('згенеровано замало постів: ' + rows.length);
    const hits = (re) => rows.filter((x) => re.test(x.content)).map((x) => '#' + x.number);
    const sat = hits(/СУБОТА-40|субот\S*\s*-?\s*40/i);
    const yest = hits(/ВЧОРА-77/i);
    if (sat.length) problems.push('у НОВИХ постах лишилась застаріла акція СУБОТА-40: ' + sat.join(', '));
    if (yest.length) problems.push('у НОВИХ постах акція, що вже закінчилась за датою (ВЧОРА-77): ' + yest.join(', '));
    const fresh = hits(/НЕДІЛЯ-55|неділ\S*\s*-?\s*55/i);
    if (!fresh.length) problems.push('жоден новий пост не згадує актуальну акцію НЕДІЛЯ-55');
    const podil = rows.filter((x) => /ПОДІЛ-20/i.test(x.content));
    console.log('Нових постів: ' + rows.length + ' | з НЕДІЛЯ-55: ' + fresh.join(', ') + ' | зі СУБОТА-40: ' + (sat.join(', ') || '—') + ' | з ВЧОРА-77: ' + (yest.join(', ') || '—') + ' | з майбутнім ПОДІЛ-20: ' + (podil.map((x) => '#' + x.number).join(', ') || '—'));

    if (problems.length) fail(problems.join('; '));
    console.log('✅ verify-dated-facts: PASS — актуальне потрапляє в пости, застаріле й прострочене — ні, майбутнє не видається за наявне');
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ verify-dated-facts: FAIL —', e.message); process.exit(1); });
