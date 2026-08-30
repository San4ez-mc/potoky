'use strict';

const { createClient } = require('./client');
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { ClaudeError } = require('@platform/errors');

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10);
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '30000', 10);
// Longer timeout for fallback providers — large generations (e.g. month content plans) need more time
const FALLBACK_TIMEOUT_MS = parseInt(process.env.FALLBACK_TIMEOUT_MS || '120000', 10);

// OpenAI fallback model — gpt-4o надійніший за mini для структурованого JSON; override via env
const OPENAI_FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o';
// Gemini fallback model (gemini-1.5-flash і gemini-2.0-flash обидва retired 2026-08-25 —
// перевірено живим викликом: 2.0-flash → 404 "no longer available", 2.5-flash → 200 OK,
// той самий, що вже надійно працює в n_lookup-code.js для ШІ-візії).
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash';

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

    const connectorId = normalizeApiKey(keyMap.CLAUDE_CONNECTOR_ID);
    if (connectorId) {
        const connector = await db.savedConnector.findUnique({
            where: { id: connectorId },
            select: { id: true, type: true, isActive: true, config: true },
        });
        if (connector?.isActive) {
            const connectorKey = extractApiKeyFromConnector(connector);
            if (connectorKey) return connectorKey;
        }
    }

    const direct = normalizeApiKey(keyMap.CLAUDE_API_KEY) || normalizeApiKey(keyMap.ANTHROPIC_API_KEY);
    return direct;
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
                key: { in: ['OPENAI_API_KEY', 'GPT_API_KEY', 'GEMINI_API_KEY', 'OPENAI_CONNECTOR_ID', 'GPT_CONNECTOR_ID', 'GEMINI_CONNECTOR_ID'] },
            },
            select: { key: true, value: true },
        });
    } catch { return result; }

    const km = funnelKeys.reduce((acc, k) => { acc[k.key] = k.value; return acc; }, {});

    // Prefer saved connector references first, then direct funnel key values.
    const openaiConnectorId = normalizeApiKey(km.OPENAI_CONNECTOR_ID) || normalizeApiKey(km.GPT_CONNECTOR_ID);
    if (openaiConnectorId) {
        try {
            const c = await db.savedConnector.findUnique({
                where: { id: openaiConnectorId },
                select: { config: true, isActive: true },
            });
            if (c?.isActive) {
                const key = extractApiKeyFromConnector(c);
                if (key) result.openai = key;
            }
        } catch { /* ignore */ }
    }

    if (!result.openai) {
        const directOpenAI = normalizeApiKey(km.OPENAI_API_KEY) || normalizeApiKey(km.GPT_API_KEY);
        if (directOpenAI) result.openai = directOpenAI;
    }

    const geminiConnectorId = normalizeApiKey(km.GEMINI_CONNECTOR_ID);
    if (geminiConnectorId) {
        try {
            const c = await db.savedConnector.findUnique({
                where: { id: geminiConnectorId },
                select: { config: true, isActive: true },
            });
            if (c?.isActive) {
                const key = extractApiKeyFromConnector(c);
                if (key) result.gemini = key;
            }
        } catch { /* ignore */ }
    }

    if (!result.gemini) {
        const directGemini = normalizeApiKey(km.GEMINI_API_KEY);
        if (directGemini) result.gemini = directGemini;
    }

    // Global fallback to any active saved connector instance by type.
    if (!result.openai) {
        try {
            const c = await db.savedConnector.findFirst({
                where: { type: 'openai_gpt4', isActive: true },
                select: { config: true },
            });
            if (c) result.openai = extractApiKeyFromConnector(c);
        } catch { /* ignore */ }
    }

    if (!result.gemini) {
        try {
            const c = await db.savedConnector.findFirst({
                where: { type: 'google_gemini', isActive: true },
                select: { config: true },
            });
            if (c) result.gemini = extractApiKeyFromConnector(c);
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
            setTimeout(() => reject(new Error(`OpenAI timeout after ${FALLBACK_TIMEOUT_MS}ms`)), FALLBACK_TIMEOUT_MS)
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
            setTimeout(() => reject(new Error(`Gemini timeout after ${FALLBACK_TIMEOUT_MS}ms`)), FALLBACK_TIMEOUT_MS)
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
// Admin alert — коли платний сервіс (AI чи інший) відмовляє через баланс/квоту
// ---------------------------------------------------------------------------
// Аудит 2026-08-26 (goverla_shop, сесія Сіразетдінова): Claude впав через
// "credit balance too low" (400), фолбек на Gemini ТЕЖ не відповів у ту мить
// (транзієнтний збіг — сам конектор при повторній перевірці живий) — клієнт
// лишився без жодної відповіді на ~13 годин, поки власник магазину випадково
// не помітив і не відповів вручну напряму в Instagram. Жодного алерту не було.
// Правило: коли платний виклик остаточно провалився — адмін дізнається одразу
// через Telegram, а не випадково.
//
// Аудит 2026-08-30: перша версія читала ТІЛЬКИ funnelKey.TELEGRAM_BOT_TOKEN
// (сирий токен) і funnelKey.ADMIN_TELEGRAM_ID — без резолву через
// TELEGRAM_CONNECTOR_ID і без системного фолбеку. Перевірка на проді: з 14
// активних ботів, що мали свій ADMIN_TELEGRAM_ID, 8 (57%) використовують
// TELEGRAM_CONNECTOR_ID замість сирого токена — алерт для них МОВЧКИ не
// спрацьовував. Ще 51 з 68 активних ботів взагалі не мають ADMIN_TELEGRAM_ID.
// Правило: резолвити токен так само, як нода notifyAdmin (funnelKey →
// TELEGRAM_CONNECTOR_ID → savedConnector), і завжди мати системний фолбек
// (savedConnector system_admin_telegram_id / system_telegram_bot_token) —
// щоб довільна воронка без жодного власного Telegram-налаштування теж
// достукувалась до власника.
const _serviceOutageAlertCooldown = new Map(); // `${botId}:${label}` -> timestamp останнього алерту
const SERVICE_OUTAGE_ALERT_COOLDOWN_MS = 15 * 60 * 1000; // не частіше ніж раз на 15 хв на бота+сервіс

function normalizeBotToken(value) {
    return /^\d+:[A-Za-z0-9_-]{20,}$/.test(String(value || '')) ? String(value) : '';
}

async function getSystemConnectorField(type, field) {
    try {
        const connector = await db.savedConnector.findFirst({
            where: { type, isActive: true },
            orderBy: { updatedAt: 'desc' },
            select: { config: true },
        });
        return connector?.config?.[field] || '';
    } catch { return ''; }
}

/**
 * Резолвить, куди й від чийого імені слати адмін-алерт для конкретного бота.
 * chatId: funnelKey.ADMIN_TELEGRAM_ID → системний конектор system_admin_telegram_id.
 * token: funnelKey.TELEGRAM_CONNECTOR_ID → funnelKey.TELEGRAM_BOT_TOKEN (сирий) →
 *        системний конектор system_telegram_bot_token (гарантований фолбек).
 */
async function resolveAdminAlertTarget(botId) {
    let chatId = '';
    let token = '';

    if (botId) {
        try {
            const keys = await db.funnelKey.findMany({
                where: { botId, key: { in: ['ADMIN_TELEGRAM_ID', 'TELEGRAM_CONNECTOR_ID', 'TELEGRAM_BOT_TOKEN'] } },
                select: { key: true, value: true },
            });
            const km = keys.reduce((acc, k) => { acc[k.key] = k.value; return acc; }, {});
            chatId = (km.ADMIN_TELEGRAM_ID || '').trim();

            if (km.TELEGRAM_CONNECTOR_ID) {
                const conn = await db.savedConnector.findUnique({
                    where: { id: km.TELEGRAM_CONNECTOR_ID },
                    select: { config: true },
                }).catch(() => null);
                token = normalizeBotToken(conn?.config?.token);
            }
            if (!token) token = normalizeBotToken(km.TELEGRAM_BOT_TOKEN);
        } catch { /* ignore, впадемо на системний фолбек нижче */ }
    }

    if (!chatId) chatId = (await getSystemConnectorField('system_admin_telegram_id', 'value')) || process.env.ADMIN_TELEGRAM_ID || '';
    if (!token) token = normalizeBotToken(await getSystemConnectorField('system_telegram_bot_token', 'token')) || normalizeBotToken(process.env.TELEGRAM_BOT_TOKEN);

    return { chatId: String(chatId || ''), token: String(token || '') };
}

/**
 * Сповіщає адміна в Telegram, коли платний сервіс (Claude, OpenAI, Gemini,
 * Whisper, будь-який httpRequest до платного API) відмовив — типово через
 * вичерпаний баланс/квоту. Дедуплікується по боту+сервісу (раз на 15 хв).
 * Приймає sessionId (типовий випадок — резолвиться botId) АБО одразу botId
 * напряму (options.botId) — для викликів поза сесією (напр. транскрипція
 * голосу відбувається до створення/прив'язки сесії).
 */
async function notifyAdminOfServiceOutage(sessionId, serviceLabel, errorMessage, options = {}) {
    try {
        let botId = options.botId || null;
        if (!botId && sessionId) {
            const session = await db.session.findUnique({ where: { id: sessionId }, select: { botId: true } }).catch(() => null);
            botId = session?.botId || null;
        }

        const cooldownKey = `${botId || 'no-bot'}:${serviceLabel}`;
        const last = _serviceOutageAlertCooldown.get(cooldownKey) || 0;
        if (Date.now() - last < SERVICE_OUTAGE_ALERT_COOLDOWN_MS) return; // вже сповіщали нещодавно
        _serviceOutageAlertCooldown.set(cooldownKey, Date.now());

        const { chatId, token } = await resolveAdminAlertTarget(botId);
        if (!chatId || !token) return;

        const text = `⚠️ ${serviceLabel} — можливо, закінчився баланс/квота!\n`
            + `Помилка: ${String(errorMessage || '').slice(0, 400)}\n\n`
            + 'Перевірте баланс/статус сервісу якнайшвидше.';

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: String(chatId), text, disable_web_page_preview: true }),
        }).catch(() => {});
    } catch { /* найгірше — просто не сповістили, не ламаємо основний потік */ }
}

// Збережено стару назву для існуючих викликів у цьому файлі — Claude-специфічний текст.
async function notifyAdminOfAiOutage(sessionId, errorMessage) {
    return notifyAdminOfServiceOutage(sessionId, 'ШІ (Claude) недоступний — бот НЕ відповідає клієнтам', errorMessage);
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

/**
 * Remove unpaired UTF-16 surrogates. A string sliced mid-emoji (e.g. .slice(0,500)
 * inside a node) leaves a lone surrogate, which Anthropic rejects with
 * "The request body is not valid JSON: no low surrogate in string" → 400.
 * Stripping them at this single chokepoint protects every funnel/node.
 */
function stripLoneSurrogates(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')   // high surrogate w/o following low
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ''); // low surrogate w/o preceding high
}

function sanitizeMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map((m) => {
        if (!m) return m;
        if (typeof m.content === 'string') {
            return { ...m, content: stripLoneSurrogates(m.content) };
        }
        if (Array.isArray(m.content)) {
            return {
                ...m,
                content: m.content.map((p) =>
                    p && typeof p.text === 'string' ? { ...p, text: stripLoneSurrogates(p.text) } : p
                ),
            };
        }
        return m;
    });
}

async function callClaude({ sessionId, systemPrompt, messages, options = {} }) {
    // Defend against lone surrogates (sliced emojis) breaking the JSON request body.
    systemPrompt = stripLoneSurrogates(systemPrompt);
    messages = sanitizeMessages(messages);

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
        // Streaming mode: TIMEOUT_MS = first-chunk timeout; full response has no hard cap.
        await new Promise((resolve, reject) => {
            let firstChunkReceived = false;
            let firstChunkTimer = setTimeout(
                () => reject(new ClaudeError(`Claude timeout after ${TIMEOUT_MS}ms (no first chunk)`)),
                TIMEOUT_MS
            );

            const stream = client.messages.stream(requestBody);

            stream.on('text', (text) => {
                if (!firstChunkReceived) {
                    firstChunkReceived = true;
                    clearTimeout(firstChunkTimer);
                }
                responseText += text;
            });

            stream.on('error', (err) => {
                clearTimeout(firstChunkTimer);
                reject(err);
            });

            stream.on('finalMessage', (msg) => {
                clearTimeout(firstChunkTimer);
                options._usage = {
                    inputTokens: msg.usage?.input_tokens || 0,
                    outputTokens: msg.usage?.output_tokens || 0,
                    cacheReadTokens: msg.usage?.cache_read_input_tokens || 0,
                    cacheWriteTokens: msg.usage?.cache_creation_input_tokens || 0,
                };
                resolve();
            });

            stream.on('end', () => {
                clearTimeout(firstChunkTimer);
                resolve();
            });
        });

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
            const finalMessage = `Claude недоступний (${errorMessage}) і всі резервні провайдери також не відповіли.`;
            await notifyAdminOfAiOutage(sessionId, finalMessage);
            throw new ClaudeError(finalMessage, { sessionId });
        }

        // Non-transient error, без спроби фолбеку — клієнт так само лишиться без відповіді
        await notifyAdminOfAiOutage(sessionId, error.message);
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

module.exports = { callClaude, resolveFunnelClaudeKey, notifyAdminOfServiceOutage };
