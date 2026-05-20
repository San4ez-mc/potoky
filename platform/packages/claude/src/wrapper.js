'use strict';

const { getClient, createClient } = require('./client');
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { ClaudeError } = require('@platform/errors');

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10);
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '30000', 10);

function normalizeApiKey(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function extractApiKeyFromConnector(connector) {
    const config = connector?.config || {};
    const candidates = [config.api_key, config.apiKey, config.key, config.token];
    for (const candidate of candidates) {
        const normalized = normalizeApiKey(candidate);
        if (normalized) return normalized;
    }
    return '';
}

async function resolveFunnelClaudeKey(sessionId) {
    if (!sessionId) return '';

    const session = await db.session.findUnique({
        where: { id: sessionId },
        select: { botId: true },
    });
    if (!session?.botId) return '';

    const keys = await db.funnelKey.findMany({
        where: {
            botId: session.botId,
            key: { in: ['CLAUDE_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CONNECTOR_ID'] },
        },
        select: { key: true, value: true },
    });

    const keyMap = keys.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});

    const direct = normalizeApiKey(keyMap.CLAUDE_API_KEY) || normalizeApiKey(keyMap.ANTHROPIC_API_KEY);
    if (direct) return direct;

    const connectorId = normalizeApiKey(keyMap.CLAUDE_CONNECTOR_ID);
    if (!connectorId) return '';

    const connector = await db.savedConnector.findUnique({
        where: { id: connectorId },
        select: { id: true, type: true, isActive: true, config: true },
    });
    if (!connector || !connector.isActive) return '';

    return extractApiKeyFromConnector(connector);
}

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
    const resolvedFunnelKey = options.apiKey ? '' : await resolveFunnelClaudeKey(sessionId);
    const effectiveApiKey = normalizeApiKey(options.apiKey) || resolvedFunnelKey;
    if (!effectiveApiKey) {
        const message = sessionId
            ? 'Не знайдено Claude ключ для цієї воронки. Додайте CLAUDE_API_KEY або CLAUDE_CONNECTOR_ID у Ключі воронки.'
            : 'Не знайдено Claude API key для виклику. Передайте options.apiKey або налаштуйте ключ в контексті воронки.';
        throw new ClaudeError(message, { sessionId });
    }

    const client = createClient(effectiveApiKey);
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

        // Track token usage from API response
        options._usage = {
            inputTokens: response.usage?.input_tokens || 0,
            outputTokens: response.usage?.output_tokens || 0,
            cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
            cacheWriteTokens: response.usage?.cache_creation_input_tokens || 0,
        };

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

    const usage = options._usage || {};

    await _logApiCall({
        sessionId,
        method: 'messages.create',
        requestData: _sanitizeRequest(requestBody),
        responseData: {
            text: responseText.substring(0, 5000),
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
            cacheReadTokens: usage.cacheReadTokens || 0,
            cacheWriteTokens: usage.cacheWriteTokens || 0,
        },
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
