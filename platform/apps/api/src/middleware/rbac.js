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

module.exports = { roleOf, isSuperadmin, allowedProjectIds, requireSuperadmin, isProjectAllowed };
