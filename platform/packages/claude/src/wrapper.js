'use strict';

const { getClient } = require('./client');
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { ClaudeError } = require('@platform/errors');

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10);
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '30000', 10);

/**
 * Calls Claude API, logs the call to api_calls table.
 * @param {object} params
 * @param {string|null} params.sessionId
 * @param {string} params.systemPrompt
 * @param {Array<{role: string, content: string}>} params.messages
 * @param {object} [params.options] - override model, max_tokens etc.
 * @returns {Promise<string>} - text response
 */
async function callClaude({ sessionId, systemPrompt, messages, options = {} }) {
    const client = getClient();
    const startTime = Date.now();

    const requestBody = {
        model: options.model || MODEL,
        max_tokens: options.maxTokens || MAX_TOKENS,
        system: [
            {
                type: 'text',
                text: systemPrompt,
                cache_control: { type: 'ephemeral' }, // prompt caching
            },
        ],
        messages,
        ...options.extra,
    };

    let responseText = '';
    let statusCode = 200;
    let errorMessage = null;

    try {
        const response = await Promise.race([
            client.messages.create(requestBody),
            new Promise((_, reject) =>
                setTimeout(() => reject(new ClaudeError(`Claude timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
            ),
        ]);

        responseText = response.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('');

    } catch (error) {
        statusCode = error.status || 500;
        errorMessage = error.message;

        logger.error('Claude API call failed', {
            sessionId,
            error: error.message,
            statusCode,
        });

        await _logApiCall({
            sessionId,
            method: 'messages.create',
            requestData: _sanitizeRequest(requestBody),
            responseData: {},
            statusCode,
            durationMs: Date.now() - startTime,
            error: errorMessage,
        });

        throw new ClaudeError(error.message, { sessionId });
    }

    const durationMs = Date.now() - startTime;

    logger.info('Claude API call succeeded', {
        sessionId,
        durationMs,
        inputTokens: responseText.length,
    });

    await _logApiCall({
        sessionId,
        method: 'messages.create',
        requestData: _sanitizeRequest(requestBody),
        responseData: { text: responseText.substring(0, 5000) },
        statusCode,
        durationMs,
        error: null,
    });

    return responseText;
}

async function _logApiCall({ sessionId, method, requestData, responseData, statusCode, durationMs, error }) {
    try {
        await db.apiCall.create({
            data: {
                sessionId,
                service: 'claude',
                method,
                requestData,
                responseData,
                statusCode,
                durationMs,
                error,
            },
        });
    } catch (dbError) {
        logger.warn('Failed to log API call to DB', { error: dbError.message });
    }
}

function _sanitizeRequest(body) {
    return {
        model: body.model,
        max_tokens: body.max_tokens,
        messagesCount: body.messages?.length,
        systemLength: typeof body.system === 'string'
            ? body.system.length
            : body.system?.[0]?.text?.length,
    };
}

module.exports = { callClaude };
