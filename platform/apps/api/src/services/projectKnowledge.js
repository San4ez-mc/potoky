'use strict';
// «База знань проєкту» (Flows): що content2 знає про експерта цього проєкту + швидкі переходи в content2 і назад у воронки.
// Звʼязок проєкту Flows ↔ проєкт content2: ключ воронки EXPERT_PROJECT_ID (його ставить автостворення продавця) або
// Project.settings.content2ProjectId (ручне привʼязування). Дані читає content2 (action "knowledge"), Flows нічого не копіює.

async function loadProjectKnowledge({ db, content2, projectId }) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, slug: true, settings: true } });
    if (!project) return null;
    const bots = await db.bot.findMany({ where: { projectId, isActive: true }, select: { id: true, name: true, slug: true }, orderBy: { createdAt: 'asc' } });
    const keys = bots.length ? await db.funnelKey.findMany({ where: { botId: { in: bots.map((b) => b.id) }, key: 'EXPERT_PROJECT_ID' }, select: { botId: true, value: true } }) : [];
    const ids = [];
    const manual = project.settings && typeof project.settings === 'object' ? String(project.settings.content2ProjectId || '').trim() : '';
    if (manual) ids.push(manual);
    for (const k of keys) { const v = String(k.value || '').trim(); if (v && !ids.includes(v)) ids.push(v); }

    const items = [];
    for (const cid of ids) {
        try {
            const j = await content2.c2({ action: 'knowledge', projectId: cid });
            const { ok, ...view } = j;
            items.push({ ...view, projectId: cid });
        } catch (e) {
            if (e.status === 404) continue; // у шаблоні лишається плейсхолдер: такого проєкту в content2 нема
            items.push({ projectId: cid, error: e.message });
        }
    }
    return {
        project: { id: project.id, name: project.name },
        funnels: bots.filter((b) => b.slug !== 'tpl-expert-seller'),
        content2Url: content2.publicUrl(),
        linked: ids.length > 0,
        items,
    };
}

module.exports = { loadProjectKnowledge };
