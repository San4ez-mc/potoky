'use strict';
// «База знань проєкту»: зв'язок проєкту Flows з проєктом content2, відсів плейсхолдерів, збої не валять сторінку. Без мережі й БД.
const { loadProjectKnowledge } = require('../../apps/api/src/services/projectKnowledge');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔ ' + m); } else { fail++; console.log('  ✘ ПРОВАЛ: ' + m); } };

const mkDb = ({ settings = {}, keys = [], bots } = {}) => ({
    project: { findUnique: async ({ where }) => (where.id === 'P' ? { id: 'P', name: 'Проєкт', slug: 'p', settings } : null) },
    bot: { findMany: async () => bots || [{ id: 'B1', name: 'Продавець', slug: 'sell-x' }, { id: 'BT', name: 'Шаблон', slug: 'tpl-expert-seller' }] },
    funnelKey: { findMany: async () => keys },
});
const calls = [];
const mkC2 = (impl) => ({ publicUrl: () => 'https://content2.fineko.space', c2: async (b) => { calls.push(b); return impl(b); } });

(async () => {
    let r = await loadProjectKnowledge({ db: mkDb({ keys: [{ botId: 'B1', value: 'C1' }, { botId: 'BT', value: 'C1' }] }), content2: mkC2((b) => ({ ok: true, projectName: 'Експерт ' + b.projectId, sections: [{ id: 'expert', items: [] }], seller: null })), projectId: 'P' });
    ok(r.linked && r.items.length === 1 && r.items[0].projectId === 'C1' && r.items[0].projectName === 'Експерт C1', 'проєкт content2 знаходиться за ключем EXPERT_PROJECT_ID (дубль із шаблону не множить)');
    ok(calls.length === 1 && calls[0].action === 'knowledge', 'у content2 іде один запит action=knowledge');
    ok(r.items[0].ok === undefined, 'службове ok не потрапляє у відповідь');
    ok(r.funnels.length === 1 && r.funnels[0].slug === 'sell-x', 'шаблон не показується серед воронок проєкту');
    ok(r.content2Url === 'https://content2.fineko.space', 'публічна адреса content2 для посилань');

    r = await loadProjectKnowledge({ db: mkDb({ settings: { content2ProjectId: 'M1' }, keys: [{ botId: 'B1', value: 'C1' }] }), content2: mkC2(() => ({ ok: true, sections: [] })), projectId: 'P' });
    ok(r.items.map((i) => i.projectId).join() === 'M1,C1', 'ручна привʼязка settings.content2ProjectId теж працює і йде першою');

    r = await loadProjectKnowledge({ db: mkDb({ keys: [{ botId: 'BT', value: '{{плейсхолдер}}' }] }), content2: mkC2(() => { throw Object.assign(new Error('Проєкт не знайдено'), { status: 404 }); }), projectId: 'P' });
    ok(r.linked && r.items.length === 0, 'плейсхолдер без проєкту в content2 (404) мовчки пропускається');

    r = await loadProjectKnowledge({ db: mkDb({ keys: [{ botId: 'B1', value: 'C1' }] }), content2: mkC2(() => { throw Object.assign(new Error('Content2 недоступний: ECONNREFUSED'), { status: 502 }); }), projectId: 'P' });
    ok(r.items.length === 1 && /недоступний/.test(r.items[0].error), 'збій content2 не валить сторінку: повертається помилка в картці');

    r = await loadProjectKnowledge({ db: mkDb({ bots: [{ id: 'B2', name: 'Курс', slug: 'course' }] }), content2: mkC2(() => ({ ok: true })), projectId: 'P' });
    ok(r.linked === false && r.items.length === 0 && r.funnels.length === 1, 'проєкт без експерта: linked=false, воронки лишаються');

    ok(await loadProjectKnowledge({ db: mkDb(), content2: mkC2(() => ({})), projectId: 'X' }) === null, 'нема проєкту → null');
    console.log('\nПідсумок: ' + pass + ' ✔, ' + fail + ' ✘');
    process.exit(fail ? 1 : 0);
})();
