'use strict';
// Доступ по проєктах (SSO-користувач з роллю user): бачить лише свою воронку, її сесії, етапи (🎯 «Воронка»), канбан.
// Реальні роутери + локальна БД, сесія підроблена middleware-ом. Запуск:
//   DATABASE_URL=... NODE_PATH="<main platform>/node_modules" node scripts/qa/test-project-access.js
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { db } = require('@platform/db');
const { recordStage } = require('../../apps/api/src/services/stageEvents');

BigInt.prototype.toJSON = function () { return this.toString(); }; // як у apps/api/src/index.js
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ПРОВАЛ: ' + m); } };

(async () => {
    const tag = 'acc-' + Date.now();
    const mk = async (n) => {
        const project = await db.project.create({ data: { name: tag + n, slug: tag + n } });
        const bot = await db.bot.create({ data: { name: tag + n, slug: tag + n, projectId: project.id } });
        await db.flowDefinition.create({ data: { botId: bot.id, nodes: [{ id: 'a', type: 'flowStage', data: { stageName: 'Етап ' + n, stageOrder: 1 } }], edges: [] } });
        const user = await db.user.create({ data: { telegramId: BigInt(Date.now()) + BigInt(n.charCodeAt(0)), firstName: 'Клієнт' + n, username: 'u_' + tag + n, projectId: project.id } });
        const session = await db.session.create({ data: { userId: user.id, botId: bot.id, state: 'x' } });
        await recordStage({ botId: bot.id, sessionId: session.id, userId: user.id, stageName: 'Етап ' + n, stageOrder: 1 });
        return { project, bot, user, session };
    };
    const A = await mk('A'); const B = await mk('B');
    const nn = await db.user.create({ data: { telegramId: BigInt(Date.now()) + BigInt(777), firstName: 'БезНіка', projectId: A.project.id } }); // людина без @username
    await db.session.create({ data: { userId: nn.id, botId: A.bot.id, state: 'x' } });
    let server;
    try {
        const app = express();
        app.use(express.json());
        const role = { current: null };
        app.use((req, res, next) => { req.session = role.current; next(); });
        const { authMiddleware } = require('../../apps/api/src/middleware/auth');
        const { errorHandler } = require('../../apps/api/src/middleware/errorHandler');
        app.use('/api/projects', authMiddleware, require('../../apps/api/src/routes/projects'));
        app.use('/api/bots', authMiddleware, require('../../apps/api/src/routes/bots'));
        app.use('/api/sessions', authMiddleware, require('../../apps/api/src/routes/sessions'));
        app.use('/api/users', authMiddleware, require('../../apps/api/src/routes/users'));
        app.use('/api/funnels', authMiddleware, require('../../apps/api/src/routes/funnels'));
        app.use(errorHandler); // справжній обробник помилок API
        server = http.createServer(app).listen(0);
        const base = 'http://127.0.0.1:' + server.address().port;
        const get = async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) { /* не json */ } return { s: r.status, j }; };

        // користувач SSO: роль user, доступ лише до проєкту A, лише перегляд
        role.current = { isAdmin: true, role: 'user', allowedProjectIds: [A.project.id], allowedPageIds: [], canEdit: false };
        console.log('користувач з доступом до одного проєкту (A)');
        let r = await get('/api/projects');
        const ids = (r.j && r.j.data || []).map((p) => p.id);
        ok(r.s === 200 && ids.includes(A.project.id) && !ids.includes(B.project.id), 'список проєктів: лише свій');
        r = await get('/api/funnels/analytics/compare?period=all&includeTest=true');
        const bn = JSON.stringify(r.j);
        ok(r.s === 200 && bn.includes(A.bot.slug) && !bn.includes(B.bot.slug), 'порівняння воронок: лише своя');
        r = await get('/api/funnels/' + A.bot.id + '/stages/board?period=all&includeTest=true');
        ok(r.s === 200 && r.j.data[0].cards.length === 1 && r.j.data[0].cards[0].sessionId === A.session.id, 'канбан своєї воронки з карткою людини');
        r = await get('/api/funnels/' + B.bot.id + '/stages/board?period=all&includeTest=true');
        ok(r.s === 404, 'канбан чужої воронки — 404');
        r = await get('/api/projects/' + A.project.id + '/knowledge');
        ok(r.s === 200 && r.j.data.project.id === A.project.id && r.j.data.funnels.length === 1, 'база знань свого проєкту відкривається');
        r = await get('/api/projects/' + B.project.id + '/knowledge');
        ok(r.s === 404, 'база знань чужого проєкту — 404 (' + r.s + ' ' + JSON.stringify(r.j).slice(0, 120) + ')');
        r = await get('/api/sessions/' + A.session.id);
        ok(r.s === 200, 'своя сесія відкривається (' + r.s + ' ' + JSON.stringify(r.j).slice(0, 160) + ')');
        r = await get('/api/sessions/' + B.session.id);
        ok(r.s === 404, 'чужа сесія — 404');
        r = await get('/api/sessions/' + B.session.id + '/messages');
        ok(r.s === 404, 'повідомлення чужої сесії — 404');
        r = await get('/api/bots/' + B.bot.id + '/sessions');
        ok(r.s === 404, 'сесії чужої воронки — 404');
        r = await get('/api/users');
        const us = JSON.stringify(r.j);
        ok(r.s === 200 && us.includes('КлієнтA') && !us.includes('КлієнтB'), 'підписники: лише свої (' + r.s + ' має A=' + us.includes('КлієнтA') + ' має B=' + us.includes('КлієнтB') + ' ' + us.slice(0, 120) + ')');
        ok(us.includes('БезНіка'), 'підписники: людина без @username у Telegram теж видна');
        r = await get('/api/funnels/' + A.bot.id + '/keys');
        ok(r.s === 200 || r.s === 403, 'ключі своєї воронки: відповідь без падіння (' + r.s + ')');
        r = await get('/api/funnels/' + A.bot.id + '/auto-layout', 'POST', {});
        ok(r.s === 403, 'лише перегляд: редагування своєї воронки заборонено (403)');

        // суперадмін бачить усе
        role.current = { isAdmin: true, role: 'superadmin' };
        r = await get('/api/funnels/' + B.bot.id + '/stages/board?period=all&includeTest=true');
        ok(r.s === 200, 'суперадмін бачить дошку будь-якої воронки');
    } finally {
        if (server) server.close();
        for (const X of [A, B]) {
            await db.$executeRaw`DELETE FROM funnel_stage_events WHERE bot_id = ${X.bot.id}`;
            await db.session.deleteMany({ where: { botId: X.bot.id } });
            await db.flowDefinition.deleteMany({ where: { botId: X.bot.id } });
            await db.user.deleteMany({ where: { projectId: X.project.id } });
            await db.bot.delete({ where: { id: X.bot.id } });
            await db.project.delete({ where: { id: X.project.id } });
        }
    }
    console.log('\nПідсумок: ' + pass + ' ✔, ' + fail + ' ✘');
    await db.$disconnect();
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ПОМИЛКА ТЕСТУ', e); process.exit(1); });
