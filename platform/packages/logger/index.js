'use strict';

const { createLogger, format, transports } = require('winston');

const { combine, timestamp, json, colorize, simple, errors } = format;

const isDevelopment = process.env.NODE_ENV !== 'production';

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        errors({ stack: true }),
        timestamp(),
        json()
    ),
    transports: [
        new transports.Console({
            format: isDevelopment
                ? combine(colorize(), simple())
                : combine(timestamp(), json()),
        }),
    ],
});

/**
 * Sanitize log data: remove API keys, tokens, passwords.
 */
function sanitize(data) {
    if (!data || typeof data !== 'object') return data;
    const sensitiveKeys = ['apiKey', 'token', 'password', 'secret', 'authorization'];
    const result = { ...data };
    for (const key of Object.keys(result)) {
        if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
            result[key] = '[REDACTED]';
        } else if (typeof result[key] === 'object') {
            result[key] = sanitize(result[key]);
        }
    }
    return result;
}

module.exports = {
    error: (message, meta = {}) => logger.error(message, sanitize(meta)),
    warn: (message, meta = {}) => logger.warn(message, sanitize(meta)),
    info: (message, meta = {}) => logger.info(message, sanitize(meta)),
    debug: (message, meta = {}) => logger.debug(message, sanitize(meta)),
};
