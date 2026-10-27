'use strict';
// Сховище досьє: content2 як основне, тіньова копія у files, відмовостійкість. Без мережі й БД (підробні db/content2).
const { createDossierStore } = require('../../apps/api/src/services/dossierStore');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ПРОВАЛ: ' + m); } };

const empty = () => ({ version: 1, fields: {}, materials: [], createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z' });
const st = (updatedAt, extra = {}) => ({ version: 1, fields: { K1: { id: 'K1', status: 'confirmed', value: 'хто' } }, materials: [], updatedAt, ...extra });

function world({ ctx = {}, c2 = {}, file = null, down = false } = {}) {
    const w = { files: file ? [{ id: 'F1', userId: 'U1', botId: 'B1', fileType: 'seller_dossier', content: JSON.stringify(file) }] : [], session: { context: { ...ctx } }, c2: { ...c2 }, calls: [], down };
    w.db = {
        session: {
            findUnique: async ({ where }) => (where.id === 'S1' ? { id: 'S1', userId: 'U1', botId: 'B1', context: w.session.context } : null),
            update: async ({ data }) => { w.session.context = data.context; },
        },
        user: { findUnique: async () => ({ telegramId: BigInt(777) }) },
        file: {
            findFirst: async () => w.files[0] || null,
            create: async ({ data }) => { const r = { id: 'F' + (w.files.length + 1), ...data }; w.files.push(r); return r; },
            update: async ({ where, data }) => { Object.assign(w.files.find((f) => f.id === where.id), data); return null; },
        },
    };
    w.content2 = {
        call: async (path, body) => {
            w.calls.push({ path, body });
            if (w.down) throw Object.assign(new Error('Content2 недоступний: ECONNREFUSED'), { status: 502 });
            if (body.action === 'get') return { ok: true, projectId: w.c2.projectId || null, state: w.c2.state || null };
            if (body.action === 'put') { w.c2.state = body.state; w.c2.projectId = w.c2.projectId || 'P-NEW'; return { ok: true, projectId: w.c2.projectId }; }
            throw new Error('bad');
        },
    };
    w.store = createDossierStore({ db: w.db, content2: w.content2, logger: { warn() {} }, emptyState: empty });
    return w;
}

(async () => {
    console.log('новий експерт');
    let w = world();
    let c = await w.store.load('S1');
    ok(c.source === 'new' && Object.keys(c.state.fields).length === 0, 'нічого ніде нема → порожня анкета');
    ok(w.calls[0].body.action === 'get' && w.calls[0].body.projectName === 'Експерт TG777', 'content2 питаємо за іменем проєкту «Експерт TG<id>» (те саме, що в ноді запису)');
    c.state = st('2026-10-27T10:00:00Z'); await w.store.save(c);
    ok(w.files.length === 1 && JSON.parse(w.files[0].content).fields.K1.value === 'хто', 'тіньова копія записана у files');
    const put = w.calls.find((x) => x.body.action === 'put');
    ok(put && put.body.projectName === 'Експерт TG777' && put.body.state.fields.K1, 'у content2 пішов put зі станом і назвою проєкту');
    ok(w.session.context.c2ProjectId === 'P-NEW', 'проєкт content2 запамʼятовано в контексті розмови');

    console.log('content2 основне');
    w = world({ c2: { projectId: 'P1', state: st('2026-10-27T11:00:00Z') }, file: st('2026-10-27T09:00:00Z') });
    c = await w.store.load('S1');
    ok(c.source === 'content2' && c.projectId === 'P1', 'є в обох → беремо content2 (воно новіше)');
    w = world({ c2: { projectId: 'P1', state: st('2026-10-27T09:00:00Z') }, file: st('2026-10-27T12:00:00Z', { marker: 'fresh' }) });
    c = await w.store.load('S1');
    ok(c.source === 'file-newer' && c.state.marker === 'fresh', 'копія свіжіша (попередній запис у content2 не дійшов) → беремо копію, відповіді не губляться');
    await w.store.save(c);
    ok(w.c2.state.marker === 'fresh', 'наступне збереження дошле свіже в content2');
    w = world({ c2: { projectId: 'P1', state: st('2026-10-27T11:00:00Z') } });
    c = await w.store.load('S1');
    ok(c.source === 'content2' && w.files.length === 0, 'лише в content2 (копії нема) → читаємо з content2');
    w = world({ file: st('2026-10-20T11:00:00Z') });
    c = await w.store.load('S1');
    ok(c.source === 'file', 'лише стара копія (експерт онбордився до переїзду) → читаємо її');
    await w.store.save(c);
    ok(w.c2.state && w.c2.projectId === 'P-NEW', 'перше ж збереження переносить стару анкету в content2');

    console.log('режими й відмови');
    w = world({ ctx: { testMode: true, c2ProjectId: 'P9' } });
    c = await w.store.load('S1');
    ok(w.calls[0].body.projectId === 'P9' && w.calls[0].body.projectName === 'QA Експерт TG777', 'тестова розмова: «QA »-назва, а відомий проєкт передається за id');
    w = world({ file: st('2026-10-27T10:00:00Z'), down: true });
    c = await w.store.load('S1');
    ok(c.source === 'file' && c.state.fields.K1, 'content2 лежить: читаємо копію, без помилки');
    c.state = st('2026-10-27T13:00:00Z'); await w.store.save(c);
    ok(JSON.parse(w.files[0].content).updatedAt === '2026-10-27T13:00:00Z', 'content2 лежить: збереження все одно проходить у копію');
    w = world({ down: true });
    c = await w.store.load('S1'); c.state = st('2026-10-27T14:00:00Z');
    let threw = false; try { await w.store.save(c); } catch (e) { threw = true; }
    ok(!threw && w.files.length === 1, 'новий експерт при недоступному content2: розмова не падає');
    w = world();
    ok(await w.store.load('NOPE') === null, 'невідома сесія → null');
    w = world({ c2: { projectId: 'P1', state: { broken: true } } });
    c = await w.store.load('S1');
    ok(c.source === 'new', 'зіпсований стан у content2 ігнорується (не ламає розмову)');

    console.log('\nПідсумок: ' + pass + ' ✔, ' + fail + ' ✘');
    process.exit(fail ? 1 : 0);
})();
