'use strict';
// Тест етапів воронки на справжній (локальній) БД: запис, повторний прохід, тестові сесії, лічильники, конверсія, «зупинилися», список людей.
// Запуск: DATABASE_URL=... NODE_PATH="<main platform>/node_modules" node scripts/qa/test-stage-events.js
const crypto = require('crypto');
const { db } = require('@platform/db');
const { recordStage, getStages, getStageSessions, ensureTable } = require('../../apps/api/src/services/stageEvents');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ПРОВАЛ: ' + m); } };
const id = () => crypto.randomUUID();

(async () => {
    const tag = 'stagetest-' + Date.now();
    const project = await db.project.create({ data: { name: tag, slug: tag } });
    const bot = await db.bot.create({ data: { name: tag, slug: tag, projectId: project.id } });
    await db.flowDefinition.create({ data: { botId: bot.id, nodes: [
        { id: 'a', type: 'flowStage', data: { stageName: 'Привітання', stageOrder: 1 } },
        { id: 'b', type: 'flowStage', data: { stageName: 'Побачив пропозицію', stageOrder: 2 } },
        { id: 'c', type: 'flowStage', data: { stageName: 'Записався', stageOrder: 3 } },
        { id: 'd', type: 'flowStage', data: { stageName: 'Думає', stageOrder: 11, side: true } },
    ], edges: [] } });
    const mkUser = (n) => db.user.create({ data: { telegramId: BigInt(Date.now()) + BigInt(n), firstName: 'Тест' + n, projectId: project.id } });
    const mkSess = (u, isTest) => db.session.create({ data: { userId: u.id, botId: bot.id, state: 'x', isTest: !!isTest } });
    const [u1, u2, u3, u4] = [await mkUser(1), await mkUser(2), await mkUser(3), await mkUser(4)];
    const [s1, s2, s3, st] = [await mkSess(u1), await mkSess(u2), await mkSess(u3), await mkSess(u4, true)];
    try {
        await ensureTable();
        const rec = (s, u, name, order, isTest) => recordStage({ botId: bot.id, sessionId: s.id, userId: u.id, stageName: name, stageOrder: order, isTest });
        // s1 пройшла всі три, s2 дві, s3 одну, тестова — одну
        for (const [n, o] of [['Привітання', 1], ['Побачив пропозицію', 2], ['Записався', 3]]) await rec(s1, u1, n, o);
        for (const [n, o] of [['Привітання', 1], ['Побачив пропозицію', 2]]) await rec(s2, u2, n, o);
        await rec(s3, u3, 'Привітання', 1);
        await rec(st, u4, 'Привітання', 1, true);
        await rec(s2, u2, 'Думає', 11);
        ok(await rec(s1, u1, 'Привітання', 1) === true, 'повторний прохід не падає');

        let list = await getStages(bot.id, { period: '30d' });
        ok(list.map((x) => x.stageName).join('|') === 'Привітання|Побачив пропозицію|Записався|Думає', 'етапи впорядковані за номером, бічний останній');
        ok(list.slice(0, 3).map((x) => x.sessions).join(',') === '3,2,1', 'лічильники: 3 → 2 → 1 (тестова сесія сховано, повтор не роздув)');
        ok(list[1].convFromPrev === 66.7 && list[2].convFromFirst === 33.3, 'конверсія від попереднього і від першого');
        ok(list[3].side === true && list[3].convFromPrev === null && list[3].sessions === 1, 'бічний вихід: без конверсії від попереднього');
        ok(list[2].convFromFirst === 33.3, 'бічний вихід не зіпсував основну конверсію');
        ok(list.every((x) => x.inGraph), 'усі етапи є в графі');
        ok(list[0].stopped === 1 && list[1].stopped === 0 && list[2].stopped === 1, 'зупинилися: s3 на 1-му, s1 на 3-му; s2 пішла в бічний вихід, тож на 2-му не «стоїть»');

        list = await getStages(bot.id, { period: '30d', includeTest: true });
        ok(list[0].sessions === 4, 'з тестовими — 4');

        const ppl = await getStageSessions(bot.id, 'Привітання', { period: '30d' });
        ok(ppl.length === 3 && !ppl.some((p) => p.isTest), 'на першому етапі 3 людини без тестової');
        const p1 = ppl.find((p) => p.sessionId === s1.id);
        ok(p1 && p1.wentFurther && p1.furthest === 'Записався' && p1.name === 'Тест1', 'людина, що пішла далі: найдальший етап і імʼя');
        const stopped = await getStageSessions(bot.id, 'Привітання', { period: '30d', onlyStopped: true });
        ok(stopped.length === 1 && stopped[0].sessionId === s3.id, 'фільтр «зупинилися»: лише s3');
        ok(typeof stopped[0].telegramId === 'string', 'telegramId віддається рядком (BigInt не ламає JSON)');
        ok(JSON.stringify(ppl).length > 10, 'відповідь серіалізується');

        // етап, якого вже нема в графі, але події є
        await rec(s3, u3, 'Старий етап', 9);
        list = await getStages(bot.id, { period: 'all' });
        ok(list.some((x) => x.stageName === 'Старий етап' && x.inGraph === false), 'етап поза графом помічається inGraph=false');
        ok(await recordStage({ botId: bot.id, sessionId: s1.id, stageName: '   ' }) === false, 'порожня назва ігнорується без помилки');
    } finally {
        await db.$executeRaw`DELETE FROM funnel_stage_events WHERE bot_id = ${bot.id}`;
        await db.session.deleteMany({ where: { botId: bot.id } });
        await db.flowDefinition.deleteMany({ where: { botId: bot.id } });
        await db.user.deleteMany({ where: { projectId: project.id } });
        await db.bot.delete({ where: { id: bot.id } });
        await db.project.delete({ where: { id: project.id } });
    }
    console.log('\nПідсумок: ' + pass + ' ✔, ' + fail + ' ✘');
    await db.$disconnect();
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ПОМИЛКА ТЕСТУ', e); process.exit(1); });
