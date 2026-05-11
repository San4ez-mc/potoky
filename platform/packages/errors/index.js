'use strict';

class PlatformError extends Error {
    constructor(message, code, context = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.context = context;
        Error.captureStackTrace(this, this.constructor);
    }
}

class StorageError extends PlatformError {
    constructor(message, context = {}) {
        super(message, 'STORAGE_ERROR', context);
    }
}

class BotError extends PlatformError {
    constructor(message, context = {}) {
        super(message, 'BOT_ERROR', context);
    }
}

class PrerequisiteError extends PlatformError {
    constructor(missingFiles) {
        super('Missing required files', 'MISSING_FILES', { missingFiles });
        this.missingFiles = missingFiles;
    }
}

class ClaudeError extends PlatformError {
    constructor(message, context = {}) {
        super(message, 'CLAUDE_ERROR', context);
    }
}

class TelegramError extends PlatformError {
    constructor(message, context = {}) {
        super(message, 'TELEGRAM_ERROR', context);
    }
}

class AuthError extends PlatformError {
    constructor(message = 'Unauthorized') {
        super(message, 'AUTH_ERROR');
    }
}

class ValidationError extends PlatformError {
    constructor(message, context = {}) {
        super(message, 'VALIDATION_ERROR', context);
    }
}

class NotFoundError extends PlatformError {
    constructor(resource, id) {
        super(`${resource} not found`, 'NOT_FOUND', { resource, id });
    }
}

module.exports = {
    PlatformError,
    StorageError,
    BotError,
    PrerequisiteError,
    ClaudeError,
    TelegramError,
    AuthError,
    ValidationError,
    NotFoundError,
};
