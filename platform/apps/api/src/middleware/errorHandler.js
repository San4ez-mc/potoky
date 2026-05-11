'use strict';

const logger = require('@platform/logger');
const { PlatformError, AuthError, NotFoundError, ValidationError } = require('@platform/errors');

function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    if (err instanceof AuthError) {
        return res.status(401).json({ ok: false, error: { code: err.code, message: err.message } });
    }

    if (err instanceof NotFoundError) {
        return res.status(404).json({ ok: false, error: { code: err.code, message: err.message } });
    }

    if (err instanceof ValidationError) {
        return res.status(400).json({ ok: false, error: { code: err.code, message: err.message, context: err.context } });
    }

    if (err instanceof PlatformError) {
        logger.error('Platform error', { code: err.code, message: err.message, context: err.context });
        return res.status(500).json({ ok: false, error: { code: err.code, message: err.message } });
    }

    logger.error('Unhandled error', { message: err.message, stack: err.stack });
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}

module.exports = { errorHandler };
