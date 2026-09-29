'use strict';
// Регрес-перевірка (не FunnelTest — це перевірка стану БД, суддя-LLM її не бачить):
// генеруємо кілька постів на ОДИН день у QA-проєкті Content Manager і перевіряємо, що
// кожен отримав НЕПОРОЖНІЙ schedule_time, а для кількох постів одного дня — РІЗНИЙ
// (09:00/12:00/18:00 round-robin, ST: Build import payload + content2 bulk-import,
// patch-cm-schedule-time-2026-09-29.js). Без цього автопостинг для проєктів БЕЗ
// календарних слотів (schedule_settings) мовчки ніколи не спрацьовує — саме це стались
// з KIRO (2026-09-29).
//   node scripts/qa/verify-schedule-time-2026-09-29.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require('@platform/db');

const CM_BOT_ID = '22f2bce5-ac62-4297-8ea0-66e258e8b505';

async function getKey(botId, key) {
    const row = await db.funnelKey.findUnique({ where: { botId_key: { botId, key } }, select: { value: true } });
    return row?.value;
}

async function contentDb(sql, params = []) {
    return db.$queryRawUnsafe(sql, ...params);
}

async function main() {
    const projectId = await getKey(CM_BOT_ID, 'CONTENT2_TEST_PROJECT_ID');
    const secret = await getKey(CM_BOT_ID, 'CONTENT2_WEBHOOK_SECRET');
    if (!projectId || !secret) throw new Error('CONTENT2_TEST_PROJECT_ID / CONTENT2_WEBHOOK_SECRET не знайдено в ключах CM');

    // 1) прибираємо старі QA-пости, щоб рахувати чисто
    const delUrl = 'http://localhost:3002/api/agent-tools?action=delete_posts&token=' + encodeURIComponent(secret) + '&projectId=' + encodeURIComponent(projectId);
    await fetch(delUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date_from: '2020-01-01', date_to: '2035-12-31' }) });

    // 2) просимо 3 пости на ЗАВТРА (один день) — прямий виклик тієї самої продакшн-ноди
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const r = await fetch('http://127.0.0.1:3000/webhook/bot/content-manager-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: '3 пости для Threads на ' + tomorrow + ' про ранкову випічку, тільки текст без картинок',
            projectId,
            testMode: true,
        }),
    });
    if (!r.ok) throw new Error('webhook HTTP ' + r.status);

    // 3) чекаємо, поки content2 запише пости (генерація асинхронна)
    const url = 'http://localhost:3002/api/agent-tools?action=list_posts&token=' + encodeURIComponent(secret) + '&projectId=' + encodeURIComponent(projectId) + '&date_from=' + tomorrow + '&date_to=' + tomorrow;
    let posts = [];
    for (let i = 0; i < 24; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const jr = await fetch(url).then((x) => x.json()).catch(() => null);
        posts = Array.isArray(jr?.posts) ? jr.posts : [];
        if (posts.length >= 3) break;
    }
    if (posts.length < 3) throw new Error('Пости не з’явились за 2 хв (отримано ' + posts.length + ') — генерація не завершилась або зламалась');

    // 4) перевіряємо schedule_time напряму в БД content2 (list_posts його не віддає)
    const numbers = posts.map((p) => p.number).filter(Boolean);
    const rows = await contentDb(
        'select number, schedule_time from post_groups where project_id = $1 and number = ANY($2::int[]) order by number',
        [projectId, numbers]
    );
    console.log('Пости і їх schedule_time:', rows);

    const empty = rows.filter((x) => !x.schedule_time);
    if (empty.length) throw new Error('У ' + empty.length + ' з ' + rows.length + ' постів schedule_time ПОРОЖНІЙ — регресія повернулась');

    const times = rows.map((x) => x.schedule_time);
    const distinct = new Set(times);
    if (distinct.size < Math.min(3, rows.length)) {
        throw new Error('Час постів одного дня НЕ розкидано (' + times.join(', ') + ') — round-robin по 09:00/12:00/18:00 не спрацював');
    }

    console.log('OK: ' + rows.length + ' постів на ' + tomorrow + ', schedule_time розкидано:', times.join(', '));
}

main()
    .then(() => { console.log('✅ verify-schedule-time: PASS'); process.exit(0); })
    .catch((e) => { console.error('❌ verify-schedule-time: FAIL —', e.message); process.exit(1); });
