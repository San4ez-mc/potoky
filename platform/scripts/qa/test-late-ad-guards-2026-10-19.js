// Варіант А — запобіжники: коли бот НЕ має дописувати (тестові сесії, нічого не надсилається).
process.chdir(require('path').join(__dirname, '..', '..'));
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const W = require('path').join(__dirname, '../../apps/api/src/services') + '/';
const { db } = require(W + 'shopAgent/lib');
const MC = require(W + 'metaChannel');
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const rp = { entryAdId: '120251392152910329', lastReferral: { adId: '120251392152910329', via: 'test' }, adTitle: 'тест' };
(async () => {
    const u = await db.session.findFirst({ where: { botId: BOT, isTest: true }, select: { userId: true } });
    const mk = async (ctx, msgs) => {
        const s = await db.session.create({ data: { botId: BOT, userId: u.userId, isTest: true, state: 'consulting', context: { agent: {}, testMode: true, ...ctx } } });
        let t = Date.now() - 120000;
        for (const [role, content, ago] of msgs) await db.message.create({ data: { sessionId: s.id, role, content, createdAt: new Date(ago ? Date.now() - ago : (t += 20000)) } });
        return s.id;
    };
    const cases = [
        ['товар уже обрано', { product: { sku: 'D0043' } }, [['user', 'Яка ціна пуховика?'], ['assistant', 'Список…']], 'товар уже є'],
        ['клієнт написав після списку', {}, [['user', 'Яка ціна пуховика?'], ['assistant', 'Список…'], ['user', '2']], 'клієнт писав після відповіді'],
        ['вже дописували', { agent: { lateAdFollowed: Date.now() } }, [['user', 'Яка ціна пуховика?'], ['assistant', 'Список…']], 'вже дописували'],
        ['давно (40 хв)', {}, [['user', 'Яка ціна пуховика?', 40 * 60000], ['assistant', 'Список…', 39 * 60000]], 'давно'],
        ['на паузі', { funnelPaused: true }, [['user', 'Яка ціна пуховика?'], ['assistant', 'Список…']], 'пауза'],
    ];
    let fail = 0;
    for (const [name, ctx, msgs, want] of cases) {
        const sid = await mk(ctx, msgs);
        const r = await MC._lateAdFollowUp(BOT, sid, 'test-psid', rp, 'test');
        const ok = r === want; if (!ok) fail++;
        console.log((ok ? '✅ ' : '❌ ') + name + ' → ' + r + (ok ? '' : ' (очікую ' + want + ')'));
        await db.message.deleteMany({ where: { sessionId: sid } }); await db.session.delete({ where: { id: sid } }).catch(() => {});
    }
    console.log(fail ? '❌ провалено: ' + fail : '✅ усі запобіжники працюють');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ПОМИЛКА', e.message); process.exit(1); });
