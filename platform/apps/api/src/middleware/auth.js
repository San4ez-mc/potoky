'use strict';

const bcrypt = require('bcrypt');
const { AuthError } = require('@platform/errors');

/**
 * Session-based admin authentication middleware.
 */
function authMiddleware(req, res, next) {
    if (req.session?.isAdmin) {
        return next();
    }
    const apiSecret = req.headers['x-api-secret'];
    if (apiSecret && apiSecret === process.env.API_SECRET) {
        return next();
    }
    throw new AuthError('Authentication required');
}

/**
 * Login handler — verify password and set session.
 */
async function loginHandler(req, res) {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ ok: false, error: { code: 'MISSING_PASSWORD', message: 'Password required' } });
    }

    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) {
        return res.status(500).json({ ok: false, error: { code: 'SERVER_ERROR', message: 'Admin not configured' } });
    }

    const isValid = await bcrypt.compare(password, hash);
    if (!isValid) {
        return res.status(401).json({ ok: false, error: { code: 'INVALID_PASSWORD', message: 'Invalid password' } });
    }

    req.session.isAdmin = true;
    res.json({ ok: true });
}

function logoutHandler(req, res) {
    req.session.destroy();
    res.json({ ok: true });
}

module.exports = { authMiddleware, loginHandler, logoutHandler };
