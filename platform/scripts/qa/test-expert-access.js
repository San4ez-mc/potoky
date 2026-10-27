'use strict';
// Автоматичний доступ експерта: проєкт-«компанія» у Flows, виклик SSO, відмови. Без мережі й БД.
const { extractEmail, ensureExpertFlowsProject, grantExpertAccess, accessText } = require('../../apps/api/src/services/expertAccess');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ПРОВАЛ: ' + m); } };

(async () => {
    console.log('пошта з відповіді експерта');
    ok(extractEmail('моя пошта Marina.Koval@Gmail.com, дякую') === 'marina.koval@gmail.com', 'знаходить адресу в тексті, нижній регістр');
    ok(extractEmail('не вказано') === '' && extractEmail(null) === '' && extractEmail('a@b') === '', 'нема адреси → порожньо');

    console.log('«компанія» експерта у Flows');
    const projects = [];
    const db = {
        project: {
            findMany: async () => projects.filter((p) => p.slug.startsWith('exp-')),
            findFirst: async ({ where }) => projects.find((p) => p.slug === where.slug) || null,
            findUnique: async ({ where }) => projects.find((p) => p.id === where.id) || null,
            create: async ({ data }) => { const p = { id: 'FP' + (projects.length + 1), ...data }; projects.push(p); return p; },
        },
    };
    const p1 = await ensureExpertFlowsProject({ db, content2ProjectId: 'C2A', expertName: 'Марина Коваль', slugHint: 'marina-koval' });
    ok(p1.slug === 'exp-marina-koval' && p1.settings.content2ProjectId === 'C2A' && p1.name === 'Експерт: Марина Коваль', 'новий проєкт: імʼя, слаг, привʼязка до проєкту content2');
    const p1b = await ensureExpertFlowsProject({ db, content2ProjectId: 'C2A', expertName: 'Марина Коваль', slugHint: 'marina-koval' });
    ok(p1b.id === p1.id && projects.length === 1, 'повторно той самий проєкт, дубль не створюється');
    const p2 = await ensureExpertFlowsProject({ db, content2ProjectId: 'C2B', expertName: 'Інша', slugHint: 'marina-koval' });
    ok(p2.id !== p1.id && p2.slug === 'exp-marina-koval-2', 'інший експерт з таким самим слагом отримує інший слаг');

    console.log('виклик SSO');
    const calls = [];
    const mkFetch = (resp, status = 200) => async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: status < 400, status, json: async () => resp }; };
    const state = { fields: { T3: { value: 'marina@example.com' } } };
    let a = await grantExpertAccess({ db, state, flowsProjectId: p1.id, content2ProjectId: 'C2A', expertName: 'Марина Коваль', fetchImpl: mkFetch({ ok: true, created: true, invited: true, mailed: true }), env: { SSO_CLIENT_SECRET: 'sec', SSO_BASE_URL: 'https://sso.test/' } });
    ok(a.status === 'created' && a.mailed && a.flows, 'створено акаунт, лист надіслано');
    ok(calls[0].url === 'https://sso.test/oauth/provision-expert' && calls[0].opts.headers['x-sso-secret'] === 'sec', 'запит іде на SSO з секретом клієнта flows');
    const g = calls[0].body.grants;
    ok(g.length === 2 && g[0].product === 'flows' && g[0].projectIds[0] === p1.id && g[0].canEdit === false && g[1].product === 'content2' && g[1].projectIds[0] === 'C2A' && g[1].canEdit === true, 'Flows: лише його проєкт, лише перегляд; content2: його проєкт, редагування');
    ok(calls[0].body.email === 'marina@example.com' && calls[0].body.displayName === 'Марина Коваль', 'пошта й імʼя');

    a = await grantExpertAccess({ db, state, flowsProjectId: p1.id, content2ProjectId: 'C2A', fetchImpl: mkFetch({ ok: true, created: false, invited: false }), env: { SSO_CLIENT_SECRET: 'sec' } });
    ok(a.status === 'existing', 'акаунт уже був → existing');

    console.log('захист і відмови');
    projects.push({ id: 'SHARED', slug: 'den', name: 'Спільний', settings: {} });
    calls.length = 0;
    a = await grantExpertAccess({ db, state, flowsProjectId: 'SHARED', content2ProjectId: 'C2A', fetchImpl: mkFetch({ ok: true, created: true, mailed: true }), env: { SSO_CLIENT_SECRET: 'sec' } });
    ok(a.status === 'shared_project' && calls[0].body.grants.length === 1 && calls[0].body.grants[0].product === 'content2', 'воронка у спільному проєкті: доступ до Воронок НЕ видається, лише content2');
    ok(/лише базу знань/.test(accessText(a)), 'власнику пояснено, чому без Воронок');
    a = await grantExpertAccess({ db, state: { fields: {} }, flowsProjectId: p1.id, content2ProjectId: 'C2A', fetchImpl: mkFetch({}), env: { SSO_CLIENT_SECRET: 'sec' } });
    ok(a.status === 'no_email' && /не вказав пошту/.test(accessText(a)), 'пошти нема → no_email, SSO не викликається');
    a = await grantExpertAccess({ db, state, flowsProjectId: p1.id, content2ProjectId: 'C2A', fetchImpl: mkFetch({}), env: {} });
    ok(a.status === 'not_configured', 'нема SSO_CLIENT_SECRET → not_configured');
    a = await grantExpertAccess({ db, state, flowsProjectId: p1.id, content2ProjectId: 'C2A', fetchImpl: mkFetch({ error: 'unauthorized' }, 401), env: { SSO_CLIENT_SECRET: 'bad' } });
    ok(a.status === 'failed' && /unauthorized/.test(accessText(a)), 'SSO відмовив → failed з поясненням, без винятку');
    a = await grantExpertAccess({ db, state, flowsProjectId: p1.id, content2ProjectId: 'C2A', fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, env: { SSO_CLIENT_SECRET: 'sec' } });
    ok(a.status === 'failed' && /ECONNREFUSED/.test(a.error), 'SSO недоступний → failed, без винятку');
    a = await grantExpertAccess({ db, state, flowsProjectId: p1.id, content2ProjectId: 'C2A', fetchImpl: mkFetch({ ok: true, created: true, mailed: false, inviteLink: 'https://sso/reset/abc' }), env: { SSO_CLIENT_SECRET: 'sec' } });
    ok(/https:\/\/sso\/reset\/abc/.test(accessText(a)), 'лист не пішов → посилання для пароля потрапляє в картку власнику');

    console.log('\nПідсумок: ' + pass + ' ✔, ' + fail + ' ✘');
    process.exit(fail ? 1 : 0);
})();
