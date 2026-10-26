'use strict';
// Тест роуту /api/sellers без БД і мережі: підробний content2 (fetch) і підробна БД. Запуск: node scripts/qa/test-sellers-route.js
const express = require('express');
const http = require('http');
const { createSellersRouter } = require('../../apps/api/src/routes/sellers');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ПРОВАЛ: ' + m); } };

const calls = [];
let c2mode = 'ok';
const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, secret: opts.headers['x-webhook-secret'], body });
    if (c2mode === 'down') throw new Error('ECONNREFUSED');
    if (body.action === 'list') return { ok: true, status: 200, json: async () => ({ ok: true, sellers: [{ projectId: 'P1', projectName: 'Експерт 1', status: 'testing', ready: true }, { projectId: 'P2', projectName: 'Експерт 2', status: 'draft', ready: false }] }) };
    if (body.action === 'get') return body.projectId === 'NO' ? { ok: false, status: 404, json: async () => ({ ok: false, error: 'Проєкт не знайдено' }) } : { ok: true, status: 200, json: async () => ({ ok: true, projectId: body.projectId, config: { status: 'testing' } }) };
    if (body.action === 'put') return body.patch.status === 'live' ? { ok: false, status: 400, json: async () => ({ ok: false, error: 'Не можна запустити: ціна послуги', missing: ['ціна послуги'] }) } : { ok: true, status: 200, json: async () => ({ ok: true, status: body.patch.status || 'draft', readiness: { ready: true } }) };
    return { ok: false, status: 400, json: async () => ({ ok: false, error: 'bad action' }) };
};
const fakeDb = {
    bot: {
        findFirst: async () => ({ id: 'ONB' }),
        findMany: async () => [{ id: 'B1', slug: 'sell-ai-seller', isActive: true }, { id: 'BT', slug: 'tpl-expert-seller', isActive: true }],
    },
    funnelKey: {
        findMany: async ({ where }) => {
            if (where.key === 'EXPERT_PROJECT_ID') return [{ botId: 'B1', value: 'P1' }, { botId: 'BT', value: 'P1' }];
            if (where.key === 'TELEGRAM_BOT_USERNAME') return [{ botId: 'B1', value: 'den_fineko_bot' }];
            return [{ key: 'CONTENT2_URL', value: 'http://c2/' }, { key: 'CONTENT2_WEBHOOK_SECRET', value: 'SECRET' }];
        },
    },
};

(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/sellers', createSellersRouter({ db: fakeDb, fetchImpl: fakeFetch, env: {} }));
    const server = http.createServer(app).listen(0);
    const base = 'http://127.0.0.1:' + server.address().port + '/api/sellers';
    const j = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };

    console.log('список');
    let r = await j('GET', '/');
    ok(r.s === 200 && r.j.ok && r.j.data.length === 2, 'повертає 2 продавців');
    ok(calls[0].secret === 'SECRET' && calls[0].url === 'http://c2/api/webhooks/seller-admin', 'секрет і адреса content2 беруться з ключів воронки onboard (кінцевий / прибрано)');
    ok(r.j.data[0].clone && r.j.data[0].clone.slug === 'sell-ai-seller' && r.j.data[0].clone.link === 'https://t.me/den_fineko_bot?start=sell-ai-seller', 'клон підтягується з посиланням на Telegram');
    ok(r.j.data[1].clone === null, 'у продавця без клона clone = null');
    ok(!r.j.data[0].clone.slug.startsWith('tpl-'), 'шаблон tpl-expert-seller не вважається клоном');

    console.log('один продавець');
    r = await j('GET', '/P1');
    ok(r.s === 200 && r.j.data.projectId === 'P1' && r.j.data.clone.botId === 'B1' && r.j.data.ok === undefined, 'дані + клон, без службового ok всередині');
    r = await j('GET', '/NO');
    ok(r.s === 404 && r.j.ok === false && /не знайдено/.test(r.j.error.message), '404 з людським повідомленням');

    console.log('збереження');
    r = await j('PUT', '/P1', { status: 'testing', sellerName: 'Ден' });
    ok(r.s === 200 && r.j.data.status === 'testing', 'зберігає і віддає статус');
    ok(calls[calls.length - 1].body.patch.sellerName === 'Ден', 'патч доходить до content2 без змін');
    r = await j('PUT', '/P2', { status: 'live' });
    ok(r.s === 400 && /Не можна запустити/.test(r.j.error.message) && r.j.error.missing[0] === 'ціна послуги', 'запуск, коли не готово: 400 і що саме бракує');

    console.log('збої');
    c2mode = 'down';
    r = await j('GET', '/');
    ok(r.s === 502 && /недоступний/.test(r.j.error.message), 'content2 недоступний → 502 з поясненням, не 500');
    c2mode = 'ok';
    const app2 = express(); app2.use(express.json());
    app2.use('/s', createSellersRouter({ db: { bot: { findFirst: async () => null }, funnelKey: { findMany: async () => [] } }, fetchImpl: fakeFetch, env: {} }));
    const s2 = http.createServer(app2).listen(0);
    const r2 = await fetch('http://127.0.0.1:' + s2.address().port + '/s/');
    ok(r2.status === 503, 'без ключів content2 → 503 «не налаштовано звʼязок»');
    s2.close(); server.close();

    console.log('\nПідсумок: ' + pass + ' ✔, ' + fail + ' ✘');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ПОМИЛКА ТЕСТУ', e); process.exit(1); });
