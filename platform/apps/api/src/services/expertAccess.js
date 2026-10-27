'use strict';
// Автоматичний доступ експерта після онбордингу ШІ-продавця (27.10, запит власника: «створення компанії теж автоматично»).
// «Компанія» експерта = його власний проєкт у Flows (там лише його клон-воронка) + його проєкт у content2. Доступи видає SSO
// (єдине джерело правди): Flows просить SSO створити акаунт за email із анкети (поле T3) і дати доступ ЛИШЕ до цих двох проєктів.
// Flows: лише перегляд (воронка, розмови, етапи, база знань). Content2: редагування своєї бази знань.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const extractEmail = (v) => { const m = String(v == null ? '' : v).match(EMAIL_RE); return m ? m[0].toLowerCase() : ''; };

/** Проєкт Flows експерта: знаходить або створює за привʼязкою settings.content2ProjectId. */
async function ensureExpertFlowsProject({ db, content2ProjectId, expertName, slugHint }) {
    const all = await db.project.findMany({ where: { slug: { startsWith: 'exp-' } }, select: { id: true, slug: true, name: true, settings: true } });
    const hit = all.find((p) => p.settings && typeof p.settings === 'object' && p.settings.content2ProjectId === content2ProjectId);
    if (hit) return hit;
    let slug = ('exp-' + (slugHint || content2ProjectId.slice(-8))).slice(0, 90); let n = 1;
    while (await db.project.findFirst({ where: { slug } })) slug = ('exp-' + (slugHint || content2ProjectId.slice(-8))).slice(0, 80) + '-' + (++n);
    return db.project.create({ data: { name: 'Експерт: ' + (expertName || content2ProjectId.slice(-8)), slug, settings: { content2ProjectId } }, select: { id: true, slug: true, name: true, settings: true } });
}

/**
 * Просить SSO створити акаунт експерта й видати доступ. Не кидає винятків: повертає { status, ... }.
 * status: created | existing | no_email | not_configured | shared_project | failed
 */
async function grantExpertAccess({ db, state, flowsProjectId, content2ProjectId, expertName, fetchImpl = fetch, env = process.env }) {
    const email = extractEmail(state && state.fields && state.fields.T3 && state.fields.T3.value);
    if (!email) return { status: 'no_email' };
    const secret = env.SSO_CLIENT_SECRET;
    if (!secret) return { status: 'not_configured', email };
    const grants = [];
    // Flows: лише якщо воронка експерта лежить у ЙОГО проєкті; інакше він побачив би чужі воронки спільного проєкту
    let flowsOk = false;
    if (flowsProjectId) {
        const p = await db.project.findUnique({ where: { id: flowsProjectId }, select: { settings: true } }).catch(() => null);
        flowsOk = !!(p && p.settings && typeof p.settings === 'object' && p.settings.content2ProjectId === content2ProjectId);
    }
    if (flowsOk) grants.push({ product: 'flows', projectIds: [flowsProjectId], canEdit: false });
    if (content2ProjectId) grants.push({ product: 'content2', projectIds: [content2ProjectId], canEdit: true });
    if (!grants.length) return { status: 'failed', email, error: 'нема що видавати' };
    try {
        const base = String(env.SSO_BASE_URL || 'https://sso.fineko.space').replace(/\/$/, '');
        const r = await fetchImpl(base + '/oauth/provision-expert', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sso-secret': secret },
            body: JSON.stringify({ email, displayName: expertName || '', grants }), signal: AbortSignal.timeout(20000),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) return { status: 'failed', email, error: j.error || ('SSO HTTP ' + r.status) };
        return { status: flowsOk ? (j.created ? 'created' : 'existing') : 'shared_project', email, created: !!j.created, invited: !!j.invited, mailed: !!j.mailed, inviteLink: j.inviteLink || '', flows: flowsOk, content2: !!content2ProjectId };
    } catch (e) {
        return { status: 'failed', email, error: String(e && e.message || e) };
    }
}

/** Рядок для картки власнику (Telegram HTML лишаємо без розмітки: просто текст). */
function accessText(a) {
    if (!a) return '';
    switch (a.status) {
        case 'created': return '🔑 Доступ експерта: акаунт для ' + a.email + ' створено (' + (a.flows ? 'Воронки + ' : '') + 'База знань), ' + (a.mailed ? 'лист-запрошення надіслано.' : 'лист не пішов; посилання для пароля: ' + (a.inviteLink || 'див. SSO') + '.');
        case 'existing': return '🔑 Доступ експерта: акаунт ' + a.email + ' уже існував, доступ до його проєктів додано.' + (a.invited ? ' Запрошення надіслано.' : '');
        case 'shared_project': return '🔑 Доступ експерта: ' + a.email + ' отримав лише базу знань (його воронка лежить у спільному проєкті Flows, тож доступ до Воронок не видано, щоб не відкрити чужі).';
        case 'no_email': return '🔑 Доступ експерта не створено: він не вказав пошту. Додайте її й повторіть, або створіть акаунт у SSO вручну.';
        case 'not_configured': return '🔑 Доступ експерта не створено: у Flows не налаштовано SSO_CLIENT_SECRET.';
        case 'failed': return '⚠️ Доступ експерта не створено: ' + (a.error || 'помилка') + '. Пошта: ' + (a.email || '—');
        default: return '';
    }
}

module.exports = { extractEmail, ensureExpertFlowsProject, grantExpertAccess, accessText };
