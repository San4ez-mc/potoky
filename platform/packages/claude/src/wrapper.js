'use strict';

const { createClient } = require('./client');
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { ClaudeError } = require('@platform/errors');

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10);
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '30000', 10);

// OpenAI fallback model — GPT-4o-mini is cheap & fast; override via env
const OPENAI_FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini';
// Gemini fallback model
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-1.5-flash';

// ---------------------------------------------------------------------------
// Error classification — transient vs permanent
// ---------------------------------------------------------------------------

/**
 * Returns true if the Claude error is transient (overload/timeout/network)
 * and we should try a fallback provider.
 */
function isTransientClaudeError(error) {
    const status = error?.status;
    const msg = String(error?.message || '').toLowerCase();

    // 529 = Anthropic-specific overloaded_error
    if (status === 529) return true;
    // 503 = Service Unavailable
    if (status === 503) return true;
    // 500 = internal server error on Anthropic side
    if (status === 500) return true;
    // 402 = Payment Required (billing issue — Claude account not paid)
    if (status === 402) return true;
    // 401 = Unauthorized (invalid/expired API key — try fallback)
    if (status === 401) return true;
    // Timeout (set by our own timer)
    if (msg.includes('timeout')) return true;
    // Network-level errors
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network')) return true;
    // Explicit overload message
    if (msg.includes('overloaded')) return true;
    // Billing/payment messages from Anthropic
    if (msg.includes('billing') || msg.includes('payment') || msg.includes('credit')) return true;

    return false;
}

// ---------------------------------------------------------------------------
// Key resolution helpers
// ---------------------------------------------------------------------------

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

/**
 * Resolve Claude key for a session (from funnelKey or connector).
 */
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

    const keyMap = keys.reduce((acc, item) => { acc[item.key] = item.value; return acc; }, {});

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
 * Resolve fallback AI keys for a session.
 * Returns { openai: string|null, gemini: string|null }
 */
async function resolveFallbackKeys(sessionId) {
    const result = { openai: null, gemini: null };

    // Keys must be set per-funnel only — no global env fallback
    if (!sessionId) return result;

    // Per-funnel keys override env
    let botId;
    try {
        const session = await db.session.findUnique({
            where: { id: sessionId },
            select: { botId: true },
        });
        botId = session?.botId;
    } catch { /* ignore */ }

    if (!botId) return result;

    let funnelKeys;
    try {
        funnelKeys = await db.funnelKey.findMany({
            where: {
                botId,
                key: { in: ['OPENAI_API_KEY', 'GPT_API_KEY', 'GEMINI_API_KEY', 'OPENAI_CONNECTOR_ID', 'GEMINI_CONNECTOR_ID'] },
            },
            select: { key: true, value: true },
        });
    } catch { return result; }

    const km = funnelKeys.reduce((acc, k) => { acc[k.key] = k.value; return acc; }, {});

    const directOpenAI = normalizeApiKey(km.OPENAI_API_KEY) || normalizeApiKey(km.GPT_API_KEY);
    if (directOpenAI) result.openai = directOpenAI;

    const directGemini = normalizeApiKey(km.GEMINI_API_KEY);
    if (directGemini) result.gemini = directGemini;

    // Resolve connector references
    const openaiConnectorId = normalizeApiKey(km.OPENAI_CONNECTOR_ID);
    if (openaiConnectorId && !result.openai) {
        try {
            const c = await db.savedConnector.findUnique({
                where: { id: openaiConnectorId },
                select: { config: true, isActive: true },
            });
            if (c?.isActive) result.openai = extractApiKeyFromConnector(c);
        } catch { /* ignore */ }
    }

    const geminiConnectorId = normalizeApiKey(km.GEMINI_CONNECTOR_ID);
    if (geminiConnectorId && !result.gemini) {
        try {
            const c = await db.savedConnector.findUnique({
                where: { id: geminiConnectorId },
                select: { config: true, isActive: true },
            });
            if (c?.isActive) result.gemini = extractApiKeyFromConnector(c);
        } catch { /* ignore */ }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Fallback provider implementations
// ---------------------------------------------------------------------------

/**
 * Call OpenAI Chat Completions API with the same prompt shape as Claude.
 */
async function callOpenAI({ apiKey, systemPrompt, messages, options = {} }) {
    const model = options.model?.includes('gpt') ? options.model : OPENAI_FALLBACK_MODEL;
    const maxTokens = options.maxTokens || MAX_TOKENS;

    const oaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    const body = JSON.stringify({
        model,
        messages: oaiMessages,
        max_tokens: maxTokens,
        temperature: 0.7,
    });

    const res = await Promise.race([
        fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body,
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`OpenAI timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
        ),
    ]);

    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`OpenAI API error ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
        text,
        usage: {
            inputTokens: data.usage?.prompt_tokens || 0,
            outputTokens: data.usage?.completion_tokens || 0,
        },
        provider: 'openai',
        model,
    };
}

/**
 * Call Google Gemini generateContent API with the same prompt shape as Claude.
 */
async function callGemini({ apiKey, systemPrompt, messages, options = {} }) {
    const model = GEMINI_FALLBACK_MODEL;

    // Gemini uses "contents" array; system instruction is separate
    const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));

    const body = JSON.stringify({
        system_instruction: {
            parts: [{ text: systemPrompt }],
        },
        contents,
        generationConfig: {
            maxOutputTokens: options.maxTokens || MAX_TOKENS,
            temperature: 0.7,
        },
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await Promise.race([
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Gemini timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
        ),
    ]);

    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Gemini API error ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const usage = data.usageMetadata || {};

    return {
        text,
        usage: {
            inputTokens: usage.promptTokenCount || 0,
            outputTokens: usage.candidatesTokenCount || 0,
        },
        provider: 'gemini',
        model,
    };
}

// ---------------------------------------------------------------------------
// Main callClaude — with automatic fallback
// ---------------------------------------------------------------------------

/**
 * Calls Claude API, logs the call to api_calls table.
 * If Claude is unavailable (overload/timeout), falls back to OpenAI → Gemini.
 *
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
    let claudeError = null;

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

        options._usage = {
            inputTokens: response.usage?.input_tokens || 0,
            outputTokens: response.usage?.output_tokens || 0,
            cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
            cacheWriteTokens: response.usage?.cache_creation_input_tokens || 0,
        };

    } catch (error) {
        statusCode = error.status || 500;
        errorMessage = error.message;
        claudeError = error;

        logger.error('Claude API call failed', { sessionId, error: error.message, statusCode });

        await _logApiCall({
            sessionId,
            method: 'messages.create',
            requestData: _sanitizeRequest(requestBody),
            responseData: {},
            statusCode,
            durationMs: Date.now() - startTime,
            error: errorMessage,
            provider: 'claude',
        });

        // ── Fallback to OpenAI or Gemini on transient errors ─────────────
        if (isTransientClaudeError(error)) {
            logger.warn('Claude unavailable — trying fallback providers', {
                sessionId, claudeStatus: statusCode, claudeError: errorMessage,
            });

            const fallbackKeys = await resolveFallbackKeys(sessionId).catch(() => ({ openai: null, gemini: null }));
            const fallbackOrder = [];
            if (fallbackKeys.openai) fallbackOrder.push({ name: 'openai', key: fallbackKeys.openai });
            if (fallbackKeys.gemini) fallbackOrder.push({ name: 'gemini', key: fallbackKeys.gemini });

            for (const { name, key } of fallbackOrder) {
                const fbStart = Date.now();
                try {
                    let result;
                    if (name === 'openai') {
                        result = await callOpenAI({ apiKey: key, systemPrompt, messages, options });
                    } else {
                        result = await callGemini({ apiKey: key, systemPrompt, messages, options });
                    }

                    responseText = result.text;
                    options._usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };

                    logger.info(`Fallback ${name} succeeded`, {
                        sessionId, durationMs: Date.now() - fbStart,
                        inputTokens: result.usage.inputTokens,
                        provider: name, model: result.model,
                    });

                    await _logApiCall({
                        sessionId,
                        method: 'messages.create',
                        requestData: { ..._sanitizeRequest(requestBody), model: result.model },
                        responseData: {
                            text: responseText.substring(0, 5000),
                            inputTokens: result.usage.inputTokens,
                            outputTokens: result.usage.outputTokens,
                            fallbackFrom: 'claude',
                        },
                        statusCode: 200,
                        durationMs: Date.now() - fbStart,
                        error: null,
                        provider: name,
                    });

                    return responseText;

                } catch (fbError) {
                    logger.warn(`Fallback ${name} also failed`, {
                        sessionId, error: fbError.message,
                    });
                    await _logApiCall({
                        sessionId,
                        method: 'messages.create',
                        requestData: _sanitizeRequest(requestBody),
                        responseData: {},
                        statusCode: 500,
                        durationMs: Date.now() - fbStart,
                        error: fbError.message,
                        provider: name,
                    });
                }
            }

            // All fallbacks exhausted — throw original Claude error
            throw new ClaudeError(
                `Claude недоступний (${errorMessage}) і всі резервні провайдери також не відповіли.`,
                { sessionId }
            );
        }

        // Non-transient error (bad key, 400, 401) — throw as-is
        throw new ClaudeError(error.message, { sessionId });
    }

    const durationMs = Date.now() - startTime;

    logger.info('Claude API call succeeded', { sessionId, durationMs });

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
        provider: 'claude',
    });

    return responseText;
}

// ---------------------------------------------------------------------------
// DB logging
// ---------------------------------------------------------------------------

async function _logApiCall({ sessionId, method, requestData, responseData, statusCode, durationMs, error, provider = 'claude' }) {
    try {
        await db.apiCall.create({
            data: {
                sessionId,
                service: provider === 'claude' ? 'claude' : `claude_fallback_${provider}`,
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
