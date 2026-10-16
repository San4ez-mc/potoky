// Повернення/обмін, які веде менеджер (Edits 16.10: Валентина, Денис, Алла) + контроль (продаж менеджера Валерія, звичайний продаж).
// Відтворює ПОВНУ історію справжньої розмови (клієнт + бот + менеджер) до проблемного повідомлення в тестовій сесії й робить один хід
// бота (testMode — нічого не надсилається, сповіщення не йдуть). ≈ $0.03 на випадок.
// Запуск на сервері з робочої копії: BOT_FILES_DIR=... node scripts/qa/replay-aftersale-2026-10-16.js
const path = require('path');
const { db } = require(path.join(__dirname, '../../apps/api/src/services/shopAgent/lib'));
const { handleTurn } = require(path.join(__dirname, '../../apps/api/src/services/shopAgent/index'));

const CASES = [
    { name: 'Валентина: фото зворотної накладної + «відправите XXL?»', sid: 'd3f06eba-af68-4c50-b5fd-97abeae4b875', at: '2026-10-14T07:46:00Z', expect: 'aftersale' },
    { name: 'Денис: «Вітаю» + номер картки для повернення коштів', sid: '51434be7-0581-4826-a3b3-6ac5eb878a4d', at: '2026-10-15T06:11:00Z', expect: 'aftersale' },
    { name: 'Алла: «Зараз» посеред зʼясування повернення', sid: '933c290b-48fc-4c71-8d3c-81380384194a', at: '2026-10-13T17:44:00Z', expect: 'aftersale' },
    { name: 'Алла: «Костюм вам не прийшов?»', sid: '933c290b-48fc-4c71-8d3c-81380384194a', at: '2026-10-13T17:54:00Z', expect: 'aftersale' },
    { name: 'КОНТРОЛЬ Валерій: продаж менеджера з рядком «Обмін/повернення 14 днів»', sid: 'ae1985ac-b833-4fec-88ea-7eb39fd7f36f', at: '2026-10-13T10:22:00Z', expect: 'not_aftersale' },
    { name: 'Катя: фото браку після «надішліть фото» (стан бота — як перед тим ходом)', sid: 'b12ef797-4287-4fcd-86b7-e97241ddc5a1', at: '2026-10-16T14:54:40Z', expect: 'defect_photo', fromTurn: true },
    { name: 'dobryi___17: «Два комплекти» + зріст/вага двох людей', sid: '0c364768', at: '2026-10-16T14:18:00Z', expect: 'multi_set', fromTurn: true },
    { name: 'КОНТРОЛЬ (живе хибне 16.10): відгук «гарна якість, ви молодці»', sid: '9a55776d', at: '2026-10-16T15:51:00Z', expect: 'not_aftersale', fromTurn: true },
    { name: 'Вікторія: «Дякую» в розмові про обмін — без картки товару', sid: '5843b175', at: '2026-10-16T16:01:00Z', expect: 'no_present', fromTurn: true },
    { name: 'КОНТРОЛЬ (живе хибне 16.10): «кофту отримали, сподобалась, як прати?»', sid: '16f7db52-84fd-407a-8460-8e08d071c827', at: '2026-10-16T14:42:00Z', expect: 'not_aftersale' },
];

(async () => {
    let fail = 0;
    for (const c of CASES) {
        if (c.sid.length < 36) c.sid = ((await db.$queryRawUnsafe('select id from sessions where id::text like $1 limit 1', c.sid + '%'))[0] || {}).id;
        const real = await db.session.findUnique({ where: { id: c.sid } });
        const at = new Date(c.at);
        const all = await db.message.findMany({ where: { sessionId: c.sid }, orderBy: { createdAt: 'asc' }, select: { role: true, content: true, metadata: true, createdAt: true } });
        const before = all.filter((m) => m.createdAt < at).slice(-30);
        const batch = []; for (const m of all) { if (m.createdAt < at) continue; if (m.role !== 'user') break; if (batch.length && m.createdAt - batch[batch.length - 1].createdAt > 120000) break; batch.push(m); }
        const text = batch.map((b) => String(b.content || '')).filter((t) => t && !/^\[(фото|порожнє|\d+ медіа)/.test(t)).join('\n');
        const img = (batch.map((b) => (b.metadata || {}).attachment).find((a) => a && a.type === 'photo') || {}).url || null;
        const rc = real.context || {};
        const seed = { testMode: true, replayOf: c.sid, channel: 'meta', psid: rc.psid, igUsername: rc.igUsername, senderName: rc.senderName, agent: {} };
        for (const k of ['product', 'crmOrderId', 'payStatus', 'supplierTtn', 'orderData', 'colorChoice', 'recommendedSize']) if (rc[k] !== undefined && !/Валерій/.test(c.name)) seed[k] = rc[k];
        if (c.fromTurn) { const tb = await db.$queryRawUnsafe('select "ctxBefore" cb from agent_turns where "sessionId"=$1 and "createdAt" >= $2 order by "createdAt" asc limit 1', c.sid, at); if (tb[0] && tb[0].cb) Object.assign(seed, tb[0].cb, { testMode: true, replayOf: c.sid, funnelPaused: false }); }
        const ru = await db.user.findUnique({ where: { id: real.userId }, select: { projectId: true } });
        const user = await db.user.create({ data: { telegramId: BigInt(-9100000000000) - BigInt(Math.floor(Math.random() * 1e9)), username: 'replay_as_' + Date.now().toString(36), firstName: 'Replay', metadata: { replay: true }, projectId: ru.projectId } });
        const test = await db.session.create({ data: { userId: user.id, botId: real.botId, state: 'inbox', isTest: true, context: seed } });
        for (const m of before) await db.message.create({ data: { sessionId: test.id, role: m.role, content: m.content, createdAt: m.createdAt, metadata: m.metadata || {} } });
        for (const b of batch) await db.message.create({ data: { sessionId: test.id, role: 'user', content: b.content, createdAt: new Date(), metadata: b.metadata || {} } });
        let r; try { r = await handleTurn({ botId: real.botId, sessionId: test.id, text, imageUrl: img }); } catch (e) { console.log('❌', c.name, 'ERROR', e.message); fail++; continue; }
        const u = r.understanding || {};
        const steps = (r.replies || []).map((o) => o.step).join(',');
        const paused = r.ctx && r.ctx.funnelPaused && r.ctx.pausedBy;
        const ok = c.expect === 'multi_set' ? (/multi_set_handoff/.test(steps) && paused === 'multi_set') : c.expect === 'no_present' ? !/present/.test(steps) : c.expect === 'defect_photo' ? (/return_defect_photo/.test(steps) && !/present/.test(steps)) : c.expect === 'aftersale' ? (paused === 'aftersale' && !/present|order_intent|hint|ask_params|phone_invalid|return_easy|post_order/.test(steps)) : paused !== 'aftersale';
        if (!ok) { fail++; console.log('    trace: ' + JSON.stringify((r.trace || []).map((x) => x.step || x.tool || x.node || '')).slice(0, 900)); }
        console.log((ok ? '✅ ' : '❌ ') + c.name + '\n    вхід: ' + (text.replace(/\d{12,19}/g, '<число>').replace(/\n/g, ' ⏎ ').slice(0, 120) || '') + (img ? ' [фото]' : '') + '\n    afterSale=' + u.afterSale + ' intent=' + u.intent + ' пауза=' + (paused || '—') + ' кроки=' + (steps || '— (мовчить)') + '\n    відповідь: ' + ((r.replies || []).map((o) => String(o.text || '').replace(/\n/g, ' ')).join(' | ').slice(0, 200) || '—'));
        await db.message.deleteMany({ where: { sessionId: test.id } }); await db.session.delete({ where: { id: test.id } }).catch(() => {}); await db.user.delete({ where: { id: user.id } }).catch(() => {});
    }
    console.log(fail ? 'ПРОВАЛЕНО: ' + fail : 'УСЕ ПРОЙШЛО');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
