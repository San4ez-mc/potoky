'use strict';

/**
 * RBAC — ролі й обмеження по проєктах (доступи приходять із SSO у сесію).
 * req.session.role: 'superadmin' | 'user'. req.session.allowedProjectIds: масив id | null (усі).
 * Пароль-резерв (без ролі, але isAdmin) трактуємо як суперадміна (власник).
 */

function roleOf(req) {
    if (req.session && req.session.role) return req.session.role;
    return req.session && req.session.isAdmin ? 'superadmin' : 'none';
}

function isSuperadmin(req) {
    return roleOf(req) === 'superadmin';
}

// null = усі проєкти (суперадмін); масив = дозволені; [] = жодного.
function allowedProjectIds(req) {
    if (isSuperadmin(req)) return null;
    return Array.isArray(req.session && req.session.allowedProjectIds) ? req.session.allowedProjectIds : [];
}

function requireSuperadmin(req, res, next) {
    if (!isSuperadmin(req)) {
        return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Доступ лише для суперадміна' } });
    }
    next();
}

// true якщо projectId дозволений цьому користувачу (суперадміну — завжди).
function isProjectAllowed(req, projectId) {
    const a = allowedProjectIds(req);
    if (a === null) return true;
    return !!projectId && a.includes(String(projectId));
}

const { db } = require('@platform/db');

function notFound(res) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Не знайдено' } });
}

// ── router.param гарди: перевіряють проєкт обʼєкта за його param у URL ──
async function guardBotParam(req, res, next, botId) {
    if (isSuperadmin(req)) return next();
    const bot = await db.bot.findUnique({ where: { id: botId }, select: { projectId: true } }).catch(() => null);
    if (!bot || !isProjectAllowed(req, bot.projectId)) return notFound(res);
    next();
}
async function guardSessionParam(req, res, next, sid) {
    if (isSuperadmin(req)) return next();
    const s = await db.session.findUnique({ where: { id: sid }, select: { bot: { select: { projectId: true } } } }).catch(() => null);
    if (!s || !isProjectAllowed(req, s.bot && s.bot.projectId)) return notFound(res);
    next();
}
async function guardUserParam(req, res, next, uid) {
    if (isSuperadmin(req)) return next();
    const u = await db.user.findUnique({ where: { id: uid }, select: { projectId: true } }).catch(() => null);
    if (!u || !isProjectAllowed(req, u.projectId)) return notFound(res);
    next();
}

// ── where-фрагменти для скоупу списків (суперадмін → {} = без обмежень) ──
function projectScopeWhere(req, field = 'projectId') {
    const a = allowedProjectIds(req);
    if (a === null) return {};
    return { [field]: { in: a } };
}
function botProjectScopeWhere(req) { // для сесій: bot.projectId
    const a = allowedProjectIds(req);
    if (a === null) return {};
    return { bot: { projectId: { in: a } } };
}

module.exports = {
    roleOf, isSuperadmin, allowedProjectIds, requireSuperadmin, isProjectAllowed,
    guardBotParam, guardSessionParam, guardUserParam,
    projectScopeWhere, botProjectScopeWhere,
};
