'use strict';

const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { callClaude } = require('@platform/claude');
const { BOT_REQUIREMENTS } = require('../../../../projects/finance-course/config/prerequisites');
const { enableTestChat, disableTestChat, consumeTestMessages, sendMessage } = require('@platform/telegram');
const crypto = require('crypto');
const https = require('https');
const vm = require('vm');
const { extractDocumentText } = require('./docExtract');

const { handleTelegramUpdate } = require('../../../../projects/finance-course/src/telegramHandler');

const MAX_SAFE_TELEGRAM_ID = 9007199254740991;

// monobank personal API дозволяє 1 запит виписки / 60 c на токен. Кешуємо останню
// відповідь у памʼяті процесу і віддаємо кеш, якщо з моменту виклику минуло < 60 c.
// Ключ — токен. { at: ms, items: [...] }
const MONO_STATEMENT_CACHE = new Map();
const MONO_MIN_INTERVAL_MS = 60 * 1000;

const FILE_SEED_DEFAULTS = {
    articles: JSON.stringify({
        cashflow: { inflows: ['Основний дохід', 'Додатковий дохід'], outflows: ['Зарплата', 'Оренда', 'Реклама'] },
        pl: { inflows: ['Дохід від продажів', 'Дохід від послуг'], outflows: ['Собівартість', 'Операційні витрати'] },
    }),
    user_onboarding_data: JSON.stringify({
        name: 'Тест Юзер',
        company_description: 'Тестова компанія',
        main_problem: 'Немає прозорості у фінансах',
    }),
    business_process: '# Бізнес-процес\n\nОпис тестового бізнес-процесу для регресійного тесту.',
    cashflow_table_url: 'https://docs.google.com/spreadsheets/d/test_seed_table_id/edit',
    pl_table_url: 'https://docs.google.com/spreadsheets/d/test_seed_table_id/edit',
    balance_articles: JSON.stringify({
        inflows: ['Грошові кошти', 'Дебіторська заборгованість'],
        outflows: ['Кредиторська заборгованість', 'Власний капітал'],
    }),
    payment_processes: '# Платіжні процеси\n\nОпис платіжних процесів.',
    salary_processes: '# Зарплатні процеси\n\nОпис зарплатних процесів.',
    business_process_v2: '# Оновлений бізнес-процес\n\nОпис оновленого бізнес-процесу.',
};

function toSafeNumberTelegramId(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || !Number.isSafeInteger(num)) {
        throw new Error('User telegramId is not a safe integer for test delivery');
    }
    return num;
}

function buildSyntheticTelegramIdentity(botSlug) {
    const base = 700000000;
    const random = Math.floor(Math.random() * 100000000);
    const telegramId = base + random;
    return {
        telegramId,
        username: `test_${botSlug}_${Date.now()}`,
        firstName: 'Test',
        lastName: 'Runner',
        languageCode: 'uk',
    };
}

function buildUpdate(identity, text) {
    const now = Date.now();
    return {
        update_id: now,
        message: {
            message_id: now,
            from: {
                id: identity.telegramId,
                is_bot: false,
                first_name: identity.firstName || 'Test',
                last_name: identity.lastName || '',
                username: identity.username || null,
                language_code: identity.languageCode || 'uk',
            },
            chat: {
                id: identity.telegramId,
                type: 'private',
            },
            date: Math.floor(now / 1000),
            text,
        },
    };
}

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getByPath(source, path) {
    if (!path || typeof path !== 'string') return undefined;
    const parts = path.split('.').flatMap((k) => {
        const m = k.match(/^([^\[]+)\[(\d+)\]$/);
        return m ? [m[1], parseInt(m[2], 10)] : [k];
    });
    return parts.reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function setByPath(source, path, value) {
    if (!path || typeof path !== 'string') return;
    const parts = path.split('.');
    let cursor = source;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const key = parts[i];
        if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
        cursor = cursor[key];
    }
    cursor[parts[parts.length - 1]] = value;
}

function normalizeContextOverride(contextOverride) {
    if (!contextOverride || typeof contextOverride !== 'object' || Array.isArray(contextOverride)) {
        return {};
    }

    const normalized = {};
    for (const [rawKey, value] of Object.entries(contextOverride)) {
        if (!rawKey || typeof rawKey !== 'string') continue;
        const key = rawKey.replace(/^context\./, '');
        if (!key) continue;
        normalized[key] = value;
    }
    return normalized;
}

function safeJsonStringify(value, indent) {
    return JSON.stringify(value, (_key, current) => (typeof current === 'bigint' ? current.toString() : current), indent);
}

function sanitizeBigInt(value) {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map((item) => sanitizeBigInt(item));
    if (value && typeof value === 'object') {
        const output = {};
        for (const [key, current] of Object.entries(value)) {
            output[key] = sanitizeBigInt(current);
        }
        return output;
    }
    return value;
}

// ── Спостережуваність: логування в api_calls / app_errors для UI вкладок сесії ──
function truncateStr(v, n = 5000) {
    if (v == null) return '';
    const s = typeof v === 'string' ? v : safeJsonStringify(v);
    return s.length > n ? s.slice(0, n) : s;
}

async function logFlowApiCall({ sessionId, service, method, requestData, responseData, statusCode, durationMs, error }) {
    try {
        await db.apiCall.create({
            data: {
                sessionId: sessionId || null,
                service: String(service || 'http').slice(0, 50),
                method: String(method || '').slice(0, 100),
                requestData: requestData || {},
                responseData: responseData || {},
                statusCode: typeof statusCode === 'number' ? statusCode : null,
                durationMs: typeof durationMs === 'number' ? durationMs : null,
                error: error ? truncateStr(error) : null,
            },
        });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[flow] logFlowApiCall failed', e.message);
    }
}

async function logFlowError({ sessionId, botId, errorType, message, stack, context }) {
    try {
        await db.appError.create({
            data: {
                sessionId: sessionId || null,
                botId: botId || null,
                errorType: String(errorType || 'flow_error').slice(0, 100),
                message: truncateStr(message),
                stack: stack ? truncateStr(stack) : null,
                context: context || {},
            },
        });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[flow] logFlowError failed', e.message);
    }
}

function hostFromUrl(u) {
    try { return new URL(u).host; } catch { return 'http'; }
}

function renderTemplate(input, scope) {
    if (typeof input !== 'string') return input || '';
    return input.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_m, expr) => {
        const resolved = getByPath(scope, String(expr).trim());
        if (resolved === null || resolved === undefined) return '';
        if (typeof resolved === 'string') return resolved;
        if (typeof resolved === 'bigint') return resolved.toString();
        return safeJsonStringify(resolved);
    });
}

function getOutgoingEdges(edges, nodeId) {
    return (Array.isArray(edges) ? edges : []).filter((edge) => edge.source === nodeId);
}

function pickNextNodeId(edges, nodeId, branch) {
    const outgoing = getOutgoingEdges(edges, nodeId);
    if (outgoing.length === 0) return null;
    if (branch) {
        const normalized = String(branch).toLowerCase();
        const branched = outgoing.find((edge) => String(edge.sourceHandle || '').toLowerCase().includes(normalized));
        if (branched) return branched.target;
    }
    return outgoing[0].target;
}

function parseClaudeMessages(template, scope, fallbackUserMessage) {
    const fallback = [{ role: 'user', content: fallbackUserMessage || 'Продовжуємо діалог' }];
    if (!template || typeof template !== 'string') return fallback;

    try {
        const parsed = JSON.parse(renderTemplate(template, scope));
        if (Array.isArray(parsed)) {
            const items = parsed
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                    role: item.role || 'user',
                    content: typeof item.content === 'string' ? item.content : safeJsonStringify(item.content || ''),
                }))
                .filter((item) => item.content);
            return items.length > 0 ? items : fallback;
        }
    } catch (_error) {
        // Ignore malformed template and use fallback
    }

    return fallback;
}

function truncateHistory(messages, maxItems = 24) {
    if (!Array.isArray(messages)) return [];
    if (messages.length <= maxItems) return messages;
    return messages.slice(messages.length - maxItems);
}

// Build a role-alternating message list from a raw session window. Anthropic requires
// the first message to be from the user and roles to alternate, so we drop leading
// assistant turns and merge consecutive same-role turns into one. Used to seed a
// dialog Claude node with recent cross-node context (e.g. a terse "Так" after a
// follow-up reminder) so the model doesn't misread the reply in isolation.
function normalizeAlternating(messages) {
    const out = [];
    for (const m of (messages || [])) {
        if (!m || !m.content) continue;
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        if (out.length === 0 && role !== 'user') continue; // must start with user
        const last = out[out.length - 1];
        if (last && last.role === role) {
            last.content = `${last.content}\n${m.content}`;
        } else {
            out.push({ role, content: m.content });
        }
    }
    return out;
}

// Replaces literal newlines/carriage-returns inside JSON string values with their
// escape sequences. Claude sometimes outputs raw \n inside strings, making JSON.parse fail.
function sanitizeJsonLiteralNewlines(text) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (esc) { out += ch; esc = false; continue; }
        if (ch === '\\') { out += ch; esc = true; continue; }
        if (ch === '"') { inStr = !inStr; out += ch; continue; }
        if (inStr && ch === '\n') { out += '\\n'; continue; }
        if (inStr && ch === '\r') { out += '\\r'; continue; }
        if (inStr && ch === '\t') { out += '\\t'; continue; }
        out += ch;
    }
    return out;
}

// Remove unpaired UTF-16 surrogates (e.g. an emoji sliced by .slice(0,N)).
// A lone surrogate makes the request body invalid JSON ("no low surrogate").
function stripLoneSurrogates(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

// Bottleneck checkpoint: make a JSON request body resilient to the two classes
// of corruption that recur in node-built bodies — sliced emojis (lone
// surrogates) and raw newlines/tabs inside string values (lesson 15.11).
// Returns a body that is valid JSON when possible; logs once if it cannot be.
function ensureValidJsonBody(payload, ctx) {
    if (typeof payload !== 'string' || !payload) return payload;
    const out = stripLoneSurrogates(payload);
    try { JSON.parse(out); return out; } catch (_) { /* try to repair */ }
    const repaired = sanitizeJsonLiteralNewlines(out);
    try { JSON.parse(repaired); return repaired; } catch (e) {
        logger.warn('[httpRequest] body still invalid JSON after repair', {
            nodeId: ctx && ctx.nodeId, url: ctx && ctx.url, error: e.message,
        });
        return repaired; // best-effort; the receiving server will report the real issue
    }
}

function extractJsonSegment(text) {
    if (!text || typeof text !== 'string') return null;

    const tryParse = (value) => {
        try {
            return JSON.parse(value);
        } catch (_error) {
            return null;
        }
    };

    const raw = text;
    const trimmed = raw.trim();
    const trimmedStartOffset = raw.indexOf(trimmed);

    const parsedDirect = tryParse(trimmed);
    if (parsedDirect !== null) {
        return {
            parsed: parsedDirect,
            start: Math.max(trimmedStartOffset, 0),
            end: Math.max(trimmedStartOffset, 0) + trimmed.length,
        };
    }

    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch && fencedMatch[1]) {
        const fencedContent = fencedMatch[1].trim();
        const parsedFenced = tryParse(fencedContent);
        if (parsedFenced !== null) {
            const start = fencedMatch.index || 0;
            const end = start + fencedMatch[0].length;
            return { parsed: parsedFenced, start, end };
        }
        // Fallback: sanitize literal newlines inside JSON strings (Claude sometimes
        // emits raw \n instead of \\n inside string values, making JSON invalid).
        const sanitized = sanitizeJsonLiteralNewlines(fencedContent);
        const parsedSanitized = tryParse(sanitized);
        if (parsedSanitized !== null) {
            const start = fencedMatch.index || 0;
            return { parsed: parsedSanitized, start, end: start + fencedMatch[0].length };
        }
    }

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const sliced = raw.slice(firstBrace, lastBrace + 1).trim();
        const parsedSliced = tryParse(sliced);
        if (parsedSliced !== null) {
            return {
                parsed: parsedSliced,
                start: firstBrace,
                end: lastBrace + 1,
            };
        }
    }

    // Балансування дужок: знаходимо ПЕРШИЙ повний JSON-обʼєкт від firstBrace,
    // ігноруючи зайві трейлінг-символи (типова помилка слабших моделей: зайва "}").
    if (firstBrace !== -1) {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = firstBrace; i < raw.length; i++) {
            const ch = raw[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const candidate = raw.slice(firstBrace, i + 1);
                    const parsed = tryParse(candidate);
                    if (parsed !== null) {
                        return { parsed, start: firstBrace, end: i + 1 };
                    }
                    break; // перший збалансований блок не парситься — далі немає сенсу
                }
            }
        }
    }

    return null;
}

function extractJsonValue(text) {
    return extractJsonSegment(text)?.parsed ?? null;
}

// Like extractJsonValue but returns null (not the raw string) when no valid JSON found.
// Used for single-mode json_output nodes so outputVar gets null on parse failure
// rather than the raw text blob.
function tryParseJsonStrict(text) {
    return extractJsonSegment(text)?.parsed ?? null;
}

function containsMarkdown(text) {
    if (!text || typeof text !== 'string') return false;
    return /```/.test(text) || /^#{1,6}\s+/m.test(text);
}

function looksLikeGeneratedArtifact(text) {
    if (!text || typeof text !== 'string') return false;
    const value = text.trim();
    if (value.length < 32) return false;

    if (/```(?:mermaid|yaml|json|markdown)?/i.test(value)) return true;
    if (/^#{1,6}\s+/m.test(value)) return true;
    if (/\n[-*]\s+/.test(value) && value.length > 120) return true;
    if (/\n[\w\s\-"']+:\s+.+/.test(value) && value.length > 160) return true;

    return value.length > 1200;
}

function isUserConfirmation(text) {
    if (!text || typeof text !== 'string') return false;

    const normalized = text
        .trim()
        .toLowerCase()
        .replace(/[\s\n\t]+/g, ' ')
        .replace(/[!?,.;:()\[\]"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) return false;

    // Split into tokens — \b doesn't work with Cyrillic in JS (Cyrillic is non-\w),
    // so token-based matching is required for Ukrainian words.
    const tokens = normalized.split(/\s+/).filter(Boolean);

    const POSITIVE = new Set([
        'так', 'ок', 'окей', 'okay', 'гаразд', 'вірно', 'правильно',
        'yes', 'yep', 'sure', 'done',
        'підтверджую', 'підтверджено', 'підтверджую', 'погоджуюсь', 'згоден',
        'готово', 'зберегти', 'зберігаємо', 'зберігати', 'приймаю', 'приймаємо',
        'далі', 'продовжуємо', 'продовжити', 'все', 'всі',
    ]);
    const NEGATIVE = new Set([
        'ні', 'no', 'cancel', 'stop', 'скасувати', 'скасую',
    ]);

    const hasPositive = tokens.some((t) => POSITIVE.has(t));
    const hasNegative = tokens.some((t) => NEGATIVE.has(t));
    const hasNegativePhrase = /(not now|ще ні|не зараз|не вірно|неправильно)/.test(normalized);

    return hasPositive && !hasNegative && !hasNegativePhrase;
}

function shouldExitDialog({ exitCondition, responseText, inputText }) {
    const condition = String(exitCondition || 'json_output').trim();

    if (condition === 'json_output') {
        const jsonSegment = extractJsonSegment(responseText);
        return {
            done: jsonSegment !== null,
            parsed: jsonSegment?.parsed ?? null,
            jsonStart: jsonSegment?.start ?? null,
        };
    }

    if (condition.startsWith('keyword:')) {
        const keyword = condition.slice('keyword:'.length).trim();
        if (!keyword) return { done: false, parsed: null };
        return { done: String(responseText || '').toLowerCase().includes(keyword.toLowerCase()), parsed: null };
    }

    if (condition === 'user_confirms') {
        return { done: isUserConfirmation(inputText), parsed: null };
    }

    if (condition === 'markdown_output') {
        return { done: containsMarkdown(responseText), parsed: null };
    }

    return { done: false, parsed: null };
}

function stripJsonAndTrailingText(responseText, jsonStart) {
    if (!responseText || typeof responseText !== 'string') return '';
    if (typeof jsonStart !== 'number' || jsonStart <= 0) return '';
    return responseText.slice(0, jsonStart).trim();
}

function getFlowRuntime(context) {
    const ctx = asObject(context);
    const runtime = asObject(ctx.flowRuntime);
    if (!Array.isArray(runtime.nodesVisited)) runtime.nodesVisited = [];
    runtime.dialogHistory = asObject(runtime.dialogHistory);
    return { ctx, runtime };
}

async function findOrCreateTestUser(bot, identity) {
    const existing = await db.user.findUnique({ where: { telegramId: BigInt(identity.telegramId) } });
    if (existing) return existing;

    return db.user.create({
        data: {
            telegramId: BigInt(identity.telegramId),
            username: identity.username,
            firstName: identity.firstName,
            lastName: identity.lastName,
            languageCode: identity.languageCode || 'uk',
            projectId: bot.projectId,
            metadata: { source: 'test-session-flow-runtime' },
        },
    });
}

async function getFlowDefinition(botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) return null;
    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const edges = Array.isArray(flow.edges) ? flow.edges : [];
    if (nodes.length === 0) return null;
    return { nodes, edges };
}

function findStartNode(nodes) {
    return nodes.find((node) => node.type === 'start') || nodes[0] || null;
}

// ─── Context compression for Claude prompts ───────────────────────────────────
// Prevents 429 rate-limit errors by shrinking large context fields before they
// are interpolated into system prompts or message templates.
// Applied automatically to every claude node — original ctx is never mutated.
function compressContextForPrompt(ctx) {
    const c = { ...ctx };

    // contentPlan: collapse posts array → one metadata line per post
    if (c.contentPlan && Array.isArray(c.contentPlan.posts)) {
        const lines = c.contentPlan.posts.map(p => {
            const hook = String(p.content || '').replace(/\n/g, ' ').slice(0, 70);
            return `${p.date}|${p.platform}|${p.audience || ''}|${hook}`;
        });
        c.contentPlan = `[${lines.length} постів у плані]\n${lines.join('\n')}`;
    }

    // Long text fields — cap at reasonable limits
    const CAPS = {
        nlm_overview:        3000,
        p1_aggregated:       4000,
        allRules:            2500,
        p1_rules:            2500,
        p1_avatars:          2000,
        kbResponse:          2500,
        structurePreviewText: 1500,
        batchPreviewText:    1500,
        completionText:       800,
    };
    for (const [key, limit] of Object.entries(CAPS)) {
        if (typeof c[key] === 'string' && c[key].length > limit) {
            c[key] = c[key].slice(0, limit) + '\n[…скорочено]';
        }
    }

    // Strip large intermediate fields that are never needed in prompts
    const STRIP = [
        'generatedBatch', 'qualityResults', 'rewrittenPosts',
        'importPayload', 'batchFinalForSave', 'batchFinal',
        'p1_existing_raw', 'webhookBodyStart',
    ];
    for (const key of STRIP) {
        if (key in c) delete c[key];
    }

    return c;
}

// ─── Knowledge Base smart search ──────────────────────────────────────────────
// Keyword relevance scoring — no external deps, works fully offline.
// Returns up to 3 most relevant blocks as formatted text, or all blocks if
// no query / no matches. Scores title matches 3× higher than body matches.
function searchKnowledgeBase(blocks, query) {
    if (!blocks || blocks.length === 0) return '';

    const allText = blocks.map(b => `[${b.title}]\n${b.content}`).join('\n\n');

    if (!query || typeof query !== 'string') return allText;

    // Tokenize: split on non-word chars, keep tokens ≥ 3 chars
    const stopWords = new Set(['для', 'що', 'як', 'але', 'або', 'від', 'про', 'при', 'під', 'над', 'між', 'через', 'після', 'перед', 'якщо', 'коли', 'щоб', 'тобто', 'тому', 'дуже', 'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'are']);
    const tokens = query.toLowerCase()
        .split(/[\s,;.!?()[\]{}'"«»]+/)
        .filter(t => t.length >= 3 && !stopWords.has(t));

    if (tokens.length === 0) return allText;

    // Score each block
    const scored = blocks.map(block => {
        const titleLow = (block.title || '').toLowerCase();
        const contentLow = (block.content || '').toLowerCase();
        let score = 0;

        for (const token of tokens) {
            // Exact word count in title (weight ×4)
            let idx = titleLow.indexOf(token);
            while (idx !== -1) { score += 4; idx = titleLow.indexOf(token, idx + 1); }

            // Exact word count in content (weight ×1)
            idx = contentLow.indexOf(token);
            while (idx !== -1) { score += 1; idx = contentLow.indexOf(token, idx + 1); }
        }

        return { block, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Top-3 relevant blocks (score > 0); fallback to all blocks if nothing matched
    const relevant = scored.filter(s => s.score > 0).slice(0, 3);
    const chosen = relevant.length > 0 ? relevant.map(s => s.block) : blocks;

    return chosen.map(b => `[${b.title}]\n${b.content}`).join('\n\n');
}

async function persistAssistantMessage(sessionId, content, metadata = {}) {
    if (!content) return;
    await db.message.create({
        data: {
            sessionId,
            role: 'assistant',
            content,
            metadata,
        },
    });
}

async function persistUserMessage(sessionId, content) {
    await db.message.create({
        data: {
            sessionId,
            role: 'user',
            content,
            metadata: { source: 'test_session' },
        },
    });
}

async function getSystemKeyValue(keyName) {
    const typeByKey = {
        CLAUDE_API_KEY:         { type: 'system_claude_api',           field: 'apiKey' },
        ADMIN_TELEGRAM_ID:      { type: 'system_admin_telegram_id',    field: 'value'  },
        TELEGRAM_BOT_TOKEN:     { type: 'system_telegram_bot_token',   field: 'token'  },
        COURSE_PRICE:           { type: 'system_course_price',         field: 'value'  },
        COURSE_PRICE_INT:       { type: 'system_course_price_int',     field: 'value'  },
    };
    const def = typeByKey[keyName];
    if (!def) return null;

    const connector = await db.savedConnector.findFirst({
        where: { type: def.type, isActive: true },
        orderBy: { updatedAt: 'desc' },
        select: { config: true },
    });

    if (!connector?.config || typeof connector.config !== 'object') return null;
    return connector.config[def.field] || null;
}

async function executeFlowStep({ sessionId, incomingUserMessage = null, incomingFile = null, incomingImageUrl = null }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: { user: true, bot: true },
    });
    if (!session) throw new Error('Session not found');

    const flow = await getFlowDefinition(session.botId);
    if (!flow) {
        return { session, botResponse: null, flowDriven: false };
    }

    const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
    const { ctx, runtime } = getFlowRuntime(session.context);

    const funnelKeyRows = await db.funnelKey.findMany({
        where: { botId: session.botId },
        select: { key: true, value: true },
    });
    const funnelEnv = Object.fromEntries(funnelKeyRows.map((k) => [k.key, k.value]));

    // Auto-resolve TELEGRAM_BOT_TOKEN from TELEGRAM_CONNECTOR_ID when not set directly.
    // Bots that store the token inside a savedConnector (e.g. CM2) need this so that
    // {{env.TELEGRAM_BOT_TOKEN}} in httpRequest bodies resolves to the actual token
    // (used by deliverTo mechanics for content funnels).
    if (!funnelEnv.TELEGRAM_BOT_TOKEN && funnelEnv.TELEGRAM_CONNECTOR_ID) {
        const tgConn = await db.savedConnector.findUnique({
            where: { id: funnelEnv.TELEGRAM_CONNECTOR_ID },
            select: { config: true },
        }).catch(() => null);
        if (tgConn?.config?.token) {
            funnelEnv.TELEGRAM_BOT_TOKEN = tgConn.config.token;
        }
    }

    // Resolve external API keys from their SAVED CONNECTORS at runtime, so that
    // replacing a key inside a connector propagates to every funnel automatically
    // (no copied values to keep in sync). CONNECTOR_ID always wins over any
    // stale direct *_API_KEY funnel key.
    const __resolveConnectorKey = async (connectorIdKey, targetKey) => {
        const cid = (funnelEnv[connectorIdKey] || '').trim();
        if (!cid) return;
        const c = await db.savedConnector.findUnique({
            where: { id: cid },
            select: { config: true },
        }).catch(() => null);
        const k = c?.config?.api_key || c?.config?.apiKey || c?.config?.key || c?.config?.token;
        if (k) funnelEnv[targetKey] = k;
    };
    await __resolveConnectorKey('HEYGEN_CONNECTOR_ID', 'HEYGEN_API_KEY');
    await __resolveConnectorKey('FAL_CONNECTOR_ID', 'FAL_AI_KEY');
    await __resolveConnectorKey('OPENAI_CONNECTOR_ID', 'OPENAI_API_KEY');
    await __resolveConnectorKey('GEMINI_CONNECTOR_ID', 'GEMINI_API_KEY');
    // Google Vertex connector carries TWO fields (SA JSON + project id) under exact names.
    const __vcid = (funnelEnv.GOOGLE_VERTEX_CONNECTOR_ID || '').trim();
    if (__vcid) {
        const __vc = await db.savedConnector.findUnique({ where: { id: __vcid }, select: { config: true } }).catch(() => null);
        if (__vc?.config?.GOOGLE_SA_KEY) funnelEnv.GOOGLE_SA_KEY = __vc.config.GOOGLE_SA_KEY;
        if (__vc?.config?.GOOGLE_PROJECT_ID) funnelEnv.GOOGLE_PROJECT_ID = __vc.config.GOOGLE_PROJECT_ID;
    }

    // Recent cross-node conversation window — lets a dialog Claude node interpret a
    // terse reply (e.g. "Так" after a follow-up reminder) with its prior context
    // instead of reading it in isolation. Node-scoped dialogHistory still wins when
    // present; this only seeds nodes whose own history is empty. See normalizeAlternating.
    let conversationWindow = [];
    try {
        const recentRows = await db.message.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'desc' },
            take: 16,
            select: { role: true, content: true, metadata: true },
        });
        conversationWindow = recentRows.reverse()
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && !(m.metadata && m.metadata.hidden))
            .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 1200) }));
    } catch (_e) { conversationWindow = []; }

    if (!runtime.currentNodeId) {
        runtime.currentNodeId = findStartNode(flow.nodes)?.id || null;
    }

    if (incomingUserMessage || incomingFile) {
        runtime.lastUserMessage = incomingUserMessage || '';
        runtime.waitingForUser = false;
        // Вхідний файл кладемо у контекст (як lastUserMessage) — його спожиє нода readFile.
        if (incomingFile) ctx.lastFile = incomingFile;
    }
    // Вхідне зображення (скрін/фото квитанції) → у контекст для нод звірки оплати.
    if (incomingImageUrl) {
        ctx.lastReceiptImageUrl = incomingImageUrl;
        ctx.lastUserImageUrl = incomingImageUrl;
    }

    let lastAssistant = null;
    let guard = 0;

    // 100: батч-цикли генерації контенту (7 батчів × 3 ноди) не вміщались у 40
    while (runtime.currentNodeId && guard < 100) {
        guard += 1;
        const node = nodesById.get(runtime.currentNodeId);
        if (!node) break;

        runtime.nodesVisited.push(node.id);
        const data = asObject(node.data);
        const _nowDate = new Date();
        const scope = {
            context: ctx,
            user: sanitizeBigInt(session.user),
            session: { id: session.id, state: session.state },
            input: runtime.lastUserMessage || '',
            env: funnelEnv,
            // JSON array of {role,content} — usable as messagesTemplate:'{{conversationHistory}}'
            conversationHistory: safeJsonStringify(conversationWindow),
            now: {
                iso: _nowDate.toISOString(),
                date: _nowDate.toISOString().slice(0, 10),       // YYYY-MM-DD
                year: _nowDate.getFullYear(),
                month: _nowDate.getMonth() + 1,                   // 1-12
                monthName: _nowDate.toLocaleDateString('uk-UA', { month: 'long' }),
                day: _nowDate.getDate(),
            },
        };

        if (node.type === 'start') {
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'message') {
            let _mtpl = data.text || data.label || '';
            if (Array.isArray(data.variants) && data.variants.length) { _mtpl = data.variants[Math.floor(Math.random() * data.variants.length)] || _mtpl; }
            const text = renderTemplate(_mtpl, scope) || '...';
            // Render inline keyboard buttons (if any)
            const rawButtons = Array.isArray(data.buttons) ? data.buttons : [];
            const renderedButtons = rawButtons
                .map(row => (Array.isArray(row) ? row : [row])
                    .map(btn => ({
                        text: renderTemplate(String(btn.text || btn.label || ''), scope),
                        ...(btn.url ? { url: renderTemplate(String(btn.url), scope) } : {}),
                        ...(btn.callback_data ? { callback_data: renderTemplate(String(btn.callback_data), scope) } : {}),
                    }))
                    .filter(btn => btn.text))
                .filter(row => row.length > 0);
            // Optional document attachment (data.attachmentUrl supports templates + Telegram file_id)
            let msgAttachment = null;
            if (data.attachmentUrl) {
                const resolvedUrl = renderTemplate(String(data.attachmentUrl), scope);
                if (resolvedUrl) {
                    msgAttachment = {
                        type: 'document',
                        url: resolvedUrl,           // can be http URL or Telegram file_id
                        fileName: data.attachmentFileName
                            ? renderTemplate(String(data.attachmentFileName), scope)
                            : 'document.pdf',
                    };
                }
            }
            await persistAssistantMessage(session.id, text, {
                nodeId: node.id,
                nodeType: node.type,
                ...(renderedButtons.length > 0 ? { keyboard: renderedButtons } : {}),
                ...(msgAttachment ? { attachment: msgAttachment } : {}),
            });
            lastAssistant = text;
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        // readFile — очікує ввід (документ або текст) і кладе витягнутий текст у context.
        // Що робити далі (зберегти/у вектор/віддати ШІ) — вирішують наступні ноди воронки.
        if (node.type === 'readFile') {
            const outKey = String(data.outputVar || 'context.docText').replace(/^context\./, '');
            if (!ctx.lastFile && !runtime.lastUserMessage) {
                runtime.waitingForUser = true;
                break;
            }
            let docText = '', wasFile = false, ok = false, fileName = '';
            if (ctx.lastFile && ctx.lastFile.fileUrl) {
                wasFile = true;
                fileName = ctx.lastFile.fileName || '';
                try {
                    docText = (await extractDocumentText(ctx.lastFile.fileUrl, ctx.lastFile.mimeType, ctx.lastFile.fileName, data.maxChars)) || '';
                } catch (e) {
                    logger.warn('[flow readFile] extract failed', { sessionId, error: e.message });
                }
                ok = !!docText;
            } else if (runtime.lastUserMessage) {
                docText = runtime.lastUserMessage; // вставлений текст замість файлу
                ok = true;
            }
            ctx[outKey] = docText;
            // Мета для condition-ноди: був файл? прочитався? назва файлу.
            ctx.readFileMeta = { wasFile, ok, fileName };
            ctx.lastFile = null;
            runtime.lastUserMessage = '';
            runtime.waitingForUser = false;
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'claude') {
            const mode = String(data.mode || 'single');
            const exitCondition = data.exitCondition || 'json_output';
            const isUserConfirmExit = exitCondition === 'user_confirms';

            // Auto-resume after an internal tool step (e.g. query_kb) — the flow looped
            // back to the agent with a fresh result and should continue WITHOUT waiting
            // for a new user message.
            const resumeAfterTool = ctx.__resumeAfterTool === true;

            // Check if we need user input (not in finalization stage for user_confirms).
            // Skip the check when the node provides its own messagesTemplate — that means
            // it builds the user message from context variables and never needs live input.
            const inFinalizationStage = isUserConfirmExit && runtime.userConfirmationReceived;
            const selfContained = mode === 'single' && !!data.messagesTemplate;
            // speakFirst: нода-діалог сама починає розмову (пропонує/питає), не чекаючи вводу.
            // Тільки на ПЕРШОМУ вході (нема lastUserMessage); далі — звичайний діалог.
            const speakFirstNow = data.speakFirst === true && mode === 'dialog' && !runtime.lastUserMessage;
            if (!runtime.lastUserMessage && !inFinalizationStage && !resumeAfterTool && !selfContained && !speakFirstNow) {
                runtime.waitingForUser = true;
                break;
            }

            // Build a compressed scope for prompt rendering — prevents 429 rate-limit
            // errors caused by large context fields (contentPlan, nlm_overview, etc.).
            // The live ctx is never modified; only the prompt interpolation sees the
            // compressed version.
            const claudeScope = { ...scope, context: compressContextForPrompt(ctx) };

            const systemPrompt = renderTemplate(data.systemPrompt || 'You are a helpful assistant.', claudeScope);
            let messages;

            if (mode === 'dialog') {
                const historyForNode = Array.isArray(runtime.dialogHistory[node.id])
                    ? runtime.dialogHistory[node.id]
                    : [];

                // In finalization stage lastUserMessage is already cleared — provide explicit instruction
                const userContent = runtime.lastUserMessage
                    || (inFinalizationStage ? 'Підтверджено. Згенеруй фінальний документ.'
                        : (resumeAfterTool ? 'Використай результат з бази знань вище і продовж виконання мого попереднього запиту.'
                            : (speakFirstNow ? 'Почни діалог сам: за завданням із системного промпту одразу ЗАПРОПОНУЙ перший варіант (стисло, на основі відомого) і попроси підтвердити/скоригувати. НЕ віддавай JSON на цьому кроці — спершу пропозиція.' : '')));
                // Consume the resume flag so we don't loop forever
                if (resumeAfterTool) delete ctx.__resumeAfterTool;

                if (historyForNode.length > 0) {
                    messages = [...historyForNode, { role: 'user', content: userContent }];
                } else if (data.messagesTemplate) {
                    messages = parseClaudeMessages(data.messagesTemplate, claudeScope, userContent);
                } else {
                    // No node-scoped history yet — seed with the recent session window so a
                    // terse reply keeps its context (fixes the "Так" after reminder misread).
                    const seeded = normalizeAlternating(conversationWindow);
                    const lastItem = seeded[seeded.length - 1];
                    if (lastItem && lastItem.role === 'user' && String(userContent).startsWith(lastItem.content)) {
                        messages = seeded;
                    } else {
                        messages = normalizeAlternating([...conversationWindow, { role: 'user', content: userContent }]);
                    }
                    if (messages.length === 0) messages = [{ role: 'user', content: userContent || 'Продовжуємо' }];
                }
            } else {
                messages = parseClaudeMessages(data.messagesTemplate, claudeScope, runtime.lastUserMessage || '');
            }

            const claudeOptions = {};
            if (data.model) claudeOptions.model = data.model;
            if (data.maxTokens) claudeOptions.maxTokens = parseInt(data.maxTokens, 10) || undefined;
            if (data.temperature != null && data.temperature !== '') {
                const t = parseFloat(data.temperature);
                if (!Number.isNaN(t)) claudeOptions.extra = { temperature: t };
            }

            let responseText;
            try {
                responseText = await callClaude({
                    sessionId: session.id,
                    systemPrompt,
                    messages,
                    options: claudeOptions,
                });
            } catch (aiErr) {
                // callClaude вже пише невдалий виклик у api_calls — додатково фіксуємо у вкладці Помилки
                await logFlowError({
                    sessionId: session.id,
                    botId: session.botId,
                    errorType: 'ai_node',
                    message: `AI-нода «${data.label || node.id}» впала: ${aiErr.message}`,
                    stack: aiErr.stack,
                    context: { nodeId: node.id, nodeLabel: data.label || '', model: data.model || null },
                });
                throw aiErr;
            }

            if (mode === 'dialog') {
                // For user_confirms in finalization stage: skip exit condition check, just finalize and move on
                if (inFinalizationStage) {
                    await persistAssistantMessage(session.id, responseText, { nodeId: node.id, nodeType: node.type });
                    lastAssistant = responseText;

                    if (data.outputVar) {
                        const outputPath = String(data.outputVar).replace(/^context\./, '');
                        setByPath(ctx, outputPath, responseText);
                    }

                    const historyWithReply = truncateHistory([
                        ...messages,
                        { role: 'assistant', content: responseText },
                    ]);
                    runtime.dialogHistory[node.id] = historyWithReply;

                    runtime.userConfirmationReceived = false;
                    runtime.lastUserMessage = '';
                    runtime.waitingForUser = false;
                    runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                    continue;
                }

                // Normal exit condition check
                const exit = shouldExitDialog({
                    exitCondition: exitCondition,
                    responseText,
                    inputText: runtime.lastUserMessage,
                });

                const isJsonExit = String(exitCondition).trim() === 'json_output';
                const visibleAssistantText = (exit.done && isJsonExit)
                    ? stripJsonAndTrailingText(responseText, exit.jsonStart)
                    : responseText;

                if (visibleAssistantText) {
                    await persistAssistantMessage(session.id, visibleAssistantText, { nodeId: node.id, nodeType: node.type });
                    lastAssistant = visibleAssistantText;
                }

                const historyWithReply = truncateHistory([
                    ...messages,
                    { role: 'assistant', content: responseText },
                ]);
                runtime.dialogHistory[node.id] = historyWithReply;

                if (exit.done) {
                    if (data.outputVar && !isUserConfirmExit) {
                        const outputPath = String(data.outputVar).replace(/^context\./, '');
                        setByPath(ctx, outputPath, exit.parsed !== null ? exit.parsed : responseText);
                    }

                    // For user_confirms: flag for finalization on next iteration
                    if (isUserConfirmExit) {
                        const outputPath = data.outputVar ? String(data.outputVar).replace(/^context\./, '') : '';

                        // If Claude already returned a large final artifact on confirmation,
                        // persist it and proceed immediately to the next node.
                        if (outputPath && looksLikeGeneratedArtifact(responseText)) {
                            setByPath(ctx, outputPath, responseText);
                            runtime.lastUserMessage = '';
                            runtime.waitingForUser = false;
                            runtime.userConfirmationReceived = false;
                            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                            continue;
                        }

                        runtime.userConfirmationReceived = true;
                        runtime.lastUserMessage = '';
                        runtime.waitingForUser = false;
                        continue;
                    }

                    // Regular exit
                    runtime.lastUserMessage = '';
                    runtime.waitingForUser = false;
                    runtime.userConfirmationReceived = false;
                    runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                } else {
                    runtime.lastUserMessage = '';
                    runtime.waitingForUser = true;
                    break;
                }
                continue;
            }

            // For single-mode json_output nodes: don't show raw JSON to the user.
            // The parsed value goes to outputVar; the message is persisted as hidden
            // so it's in the DB for debugging but never delivered to Telegram.
            const isSingleJsonExit = mode === 'single' && String(exitCondition).trim() === 'json_output';
            if (isSingleJsonExit) {
                await persistAssistantMessage(session.id, responseText, { nodeId: node.id, nodeType: node.type, hidden: true });
                const singleParsed = tryParseJsonStrict(responseText);
                if (data.outputVar) {
                    setByPath(ctx, String(data.outputVar).replace(/^context\./, ''), singleParsed !== null ? singleParsed : responseText);
                }
            } else {
                await persistAssistantMessage(session.id, responseText, { nodeId: node.id, nodeType: node.type });
                lastAssistant = responseText;
                if (data.outputVar) {
                    setByPath(ctx, String(data.outputVar).replace(/^context\./, ''), responseText);
                }
            }

            runtime.lastUserMessage = '';
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'saveFile') {
            const fileType = data.fileType || 'generated_artifact';
            const contentPath = data.contentVar ? String(data.contentVar).replace(/^context\./, '') : '';
            const normalizedFileType = (contentPath === 'articles_result' && (fileType === 'cashflow_articles' || fileType === 'pl_articles'))
                ? 'articles'
                : fileType;

            let fileContent = '';
            if (data.contentVar) {
                const value = getByPath(ctx, contentPath);
                fileContent = typeof value === 'string' ? value : safeJsonStringify(value || {}, 2);
            }
            if (!fileContent) {
                fileContent = data.template ? renderTemplate(data.template, scope) : `Generated by node ${node.id}`;
            }

            const duplicateInSession = await db.file.findFirst({
                where: {
                    sessionId: session.id,
                    content: fileContent,
                    fileType: normalizedFileType,
                },
                select: { id: true },
            });

            if (duplicateInSession) {
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }

            await db.file.create({
                data: {
                    userId: session.userId,
                    botId: session.botId,
                    sessionId: session.id,
                    fileType: normalizedFileType,
                    fileName: `${normalizedFileType}_${Date.now()}.md`,
                    filePath: `/tmp/test-flow/${session.id}/${normalizedFileType}.md`,
                    content: fileContent,
                    version: 1,
                },
            });

            // ── Інтеграція з content.fineko.space: контент-план → дашборд ──
            // Якщо це content_plan і налаштовані ключі — пушимо пости в PHP-дашборд.
            if (normalizedFileType === 'content_plan' && scope.env.CONTENT_IMPORT_URL && scope.env.CONTENT_PROJECT_ID) {
                const importStart = Date.now();
                try {
                    const importUrl = `${scope.env.CONTENT_IMPORT_URL}?token=${encodeURIComponent(scope.env.CONTENT_IMPORT_TOKEN || '')}`;
                    const importBody = `{"projectId":${parseInt(scope.env.CONTENT_PROJECT_ID, 10) || 0},"plan":${fileContent}}`;
                    const importRes = await fetch(importUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: importBody,
                    });
                    const importText = await importRes.text();
                    await logFlowApiCall({
                        sessionId: session.id,
                        service: 'content.fineko.space',
                        method: 'POST /import-content-plan',
                        requestData: { projectId: scope.env.CONTENT_PROJECT_ID, bodyLen: importBody.length },
                        responseData: { body: truncateStr(importText, 2000) },
                        statusCode: importRes.status,
                        durationMs: Date.now() - importStart,
                        error: importRes.ok ? null : `HTTP ${importRes.status}`,
                    });
                    if (!importRes.ok) {
                        await logFlowError({
                            sessionId: session.id, botId: session.botId, errorType: 'content_import',
                            message: `Імпорт плану в дашборд впав: HTTP ${importRes.status} — ${truncateStr(importText, 500)}`,
                            context: { nodeId: node.id },
                        });
                    }
                } catch (err) {
                    await logFlowError({
                        sessionId: session.id, botId: session.botId, errorType: 'content_import',
                        message: `Імпорт плану в дашборд впав: ${err.message}`,
                        stack: err.stack, context: { nodeId: node.id },
                    });
                }
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'loadFile') {
            const fileType = data.fileType ? String(data.fileType).trim() : '';
            const outputVar = data.outputVar ? String(data.outputVar).replace(/^context\./, '') : '';
            const onMissing = data.onMissing || 'skip';

            // ── content_plan: читаємо АКТУАЛЬНИЙ план з дашборда (те саме джерело, що й запис) ──
            if (fileType === 'content_plan' && outputVar && scope.env.CONTENT_PLAN_URL && scope.env.CONTENT_PROJECT_ID) {
                const planStart = Date.now();
                try {
                    // Вікно дат, щоб не тягнути всю історію проєкту (інакше промпт роздувається на десятки тис. токенів)
                    const _d = new Date();
                    const _from = new Date(_d.getTime() - 7 * 864e5).toISOString().slice(0, 10);
                    const _to = new Date(_d.getTime() + 90 * 864e5).toISOString().slice(0, 10);
                    const url = `${scope.env.CONTENT_PLAN_URL}?token=${encodeURIComponent(scope.env.CONTENT_IMPORT_TOKEN || '')}&projectId=${parseInt(scope.env.CONTENT_PROJECT_ID, 10) || 0}&date_from=${_from}&date_to=${_to}`;
                    const res = await fetch(url);
                    const j = await res.json().catch(() => null);
                    await logFlowApiCall({
                        sessionId: session.id, service: 'content.fineko.space', method: 'GET /get-content-plan',
                        requestData: { projectId: scope.env.CONTENT_PROJECT_ID },
                        responseData: { count: j?.posts?.length ?? 0 },
                        statusCode: res.status, durationMs: Date.now() - planStart,
                        error: res.ok ? null : `HTTP ${res.status}`,
                    });
                    if (j && j.ok && Array.isArray(j.posts)) {
                        setByPath(ctx, outputVar, { posts: j.posts });
                        runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                        continue;
                    }
                } catch (err) {
                    await logFlowError({
                        sessionId: session.id, botId: session.botId, errorType: 'content_plan_load',
                        message: `Завантаження плану з дашборда впало: ${err.message}`, stack: err.stack,
                        context: { nodeId: node.id },
                    });
                    // падіння — підемо на платформне сховище нижче
                }
            }

            if (fileType && outputVar) {
                const file = await db.file.findFirst({
                    where: { userId: session.userId, fileType },
                    orderBy: { createdAt: 'desc' },
                    select: { content: true },
                });

                if (file) {
                    let value = file.content;
                    try { value = JSON.parse(file.content); } catch { /* keep as string */ }
                    setByPath(ctx, outputVar, value);
                } else if (onMissing !== 'skip') {
                    const msg = '⚠️ Необхідний файл не знайдений. Пройди попередній урок спочатку.';
                    await persistAssistantMessage(session.id, msg, { nodeId: node.id, nodeType: node.type });
                    if (session.user?.telegramId) {
                        await sendMessage(String(session.user.telegramId), msg, {}, session.id).catch(() => {});
                    }
                    runtime.currentNodeId = null;
                    break;
                }
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'generateDocument') {
            const sourceVar = data.sourceVar ? String(data.sourceVar).replace(/^context\./, '') : '';
            const template = data.template || 'default';
            const filename = renderTemplate(data.filename || 'document.docx', scope);
            const sendToUser = data.sendToUser === true;

            let sourceContent = '';
            if (sourceVar) {
                const value = getByPath(ctx, sourceVar);
                sourceContent = typeof value === 'string' ? value : safeJsonStringify(value || {}, 2);
            }

            // Generate simple document content (can be enhanced with docx library)
            let documentContent = '';
            if (template === 'student_profile') {
                const profileData = sourceContent ? (typeof sourceContent === 'string' ? JSON.parse(sourceContent) : sourceContent) : {};
                documentContent = `
ПРОФІЛЬ СТУДЕНТА — Урок 1.1
${new Date().toLocaleDateString('uk-UA')}

Ім'я: ${profileData.name || '—'}
Роль: ${profileData.role || '—'}
Компанія: ${profileData.company_description || '—'}
Головна фінансова проблема: ${profileData.main_problem || '—'}

---
Цей документ згенеровано автоматично системою курсу.
Зберігається у вашому профілі та доступний на всіх наступних заняттях.
                `.trim();
            } else if (template === 'business_process') {
                // Parse Mermaid swimlane or Markdown business process document
                const parseMermaidSwimlane = (text) => {
                    if (!text || typeof text !== 'string') return null;

                    // Find Mermaid code block
                    const mermaidMatch = text.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
                    const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : text;

                    // Extract subgraph sections
                    const subgraphPattern = /subgraph\s+["']?([^"'\n]+)["']?\s*\n([\s\S]*?)end/gi;
                    const sections = [];
                    let match;
                    while ((match = subgraphPattern.exec(mermaidCode)) !== null) {
                        const sectionName = match[1].trim();
                        const sectionBody = match[2].trim();

                        // Extract node labels from body: A[Label], B{"Label"}, etc.
                        const nodePattern = /\[["']?([^"'\[\]]+)["']?\]/g;
                        const steps = [];
                        let nodeMatch;
                        while ((nodeMatch = nodePattern.exec(sectionBody)) !== null) {
                            const step = nodeMatch[1].trim();
                            if (step && !steps.includes(step)) {
                                steps.push(step);
                            }
                        }

                        if (sectionName) {
                            sections.push({ name: sectionName, steps });
                        }
                    }

                    return sections.length > 0 ? sections : null;
                };

                const sections = parseMermaidSwimlane(sourceContent);
                const dateStr = new Date().toLocaleDateString('uk-UA');

                if (sections && sections.length > 0) {
                    const sectionsText = sections.map((s) => {
                        const stepsText = s.steps.length > 0
                            ? s.steps.map((st, i) => `  ${i + 1}. ${st}`).join('\n')
                            : '  (кроки не визначені)';
                        return `${s.name.toUpperCase()}\n${stepsText}`;
                    }).join('\n\n');

                    documentContent = `БІЗНЕС-ПРОЦЕС КОМПАНІЇ — Урок 1.2
${dateStr}

${sectionsText}

---
Документ згенеровано автоматично системою курсу.
Схема процесу збережена окремим файлом.`.trim();
                } else {
                    // Fallback: use source content as-is (already structured Markdown)
                    documentContent = `БІЗНЕС-ПРОЦЕС КОМПАНІЇ — Урок 1.2
${dateStr}

${sourceContent || '(немає даних)'}

---
Документ згенеровано автоматично системою курсу.`.trim();
                }
            } else {
                documentContent = sourceContent || 'Generated document';
            }

            // Save as file artifact
            const fileType = `document_${template}`;
            const fileName = filename || `${template}_${Date.now()}.txt`;

            const duplicateInSession = await db.file.findFirst({
                where: {
                    sessionId: session.id,
                    content: documentContent,
                    fileType: fileType,
                },
                select: { id: true },
            });

            if (!duplicateInSession) {
                await db.file.create({
                    data: {
                        userId: session.userId,
                        botId: session.botId,
                        sessionId: session.id,
                        fileType: fileType,
                        fileName: fileName,
                        filePath: `/tmp/test-flow/${session.id}/${fileName}`,
                        content: documentContent,
                        version: 1,
                    },
                });
            }

            // If sendToUser is true, persist message with document reference
            if (sendToUser) {
                await persistAssistantMessage(session.id, `📄 Документ: ${fileName}`, {
                    nodeId: node.id,
                    nodeType: node.type,
                    attachment: { type: 'document', fileName, template },
                });
                lastAssistant = `📄 Документ: ${fileName}`;
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'condition') {
            // ── Multi-condition format: data.conditions = [{id, label, expression}] ──
            // Edges are matched by creation-order index (same order as conditions array).
            if (Array.isArray(data.conditions) && data.conditions.length > 0) {
                const outgoing = getOutgoingEdges(flow.edges, node.id);
                let matchedIndex = -1;
                for (let i = 0; i < data.conditions.length; i++) {
                    try {
                        const expr = String(data.conditions[i].expression || 'false');
                        const result = Boolean(
                            Function('context', 'user', 'session', 'input', `return (${expr});`)(
                                ctx, session.user, session, runtime.lastUserMessage || ''
                            )
                        );
                        if (result) {
                            matchedIndex = i;
                            break;
                        }
                    } catch (_error) {
                        // expression failed — skip this branch
                    }
                }
                // Pick edge by index; fall back to first edge if nothing matched
                const target = matchedIndex >= 0
                    ? outgoing[matchedIndex]?.target
                    : outgoing[0]?.target;
                runtime.currentNodeId = target || null;
                continue;
            }

            // ── Legacy single-condition format: data.condition = "js expression" ──
            let result = false;
            try {
                const expr = data.condition || 'false';
                result = Boolean(Function('context', 'user', 'session', 'input', `return (${expr});`)(ctx, session.user, session, runtime.lastUserMessage || ''));
            } catch (_error) {
                result = false;
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id, result ? 'true' : 'false');
            continue;
        }

        if (node.type === 'wait') {
            // Event-driven wait: pauses until a named context key is set to true.
            // Used for homework-completion gates between lessons.
            if (data.mode === 'event' && data.eventKey) {
                const eventKey = String(data.eventKey);
                if (ctx[eventKey]) {
                    // Event fired — clear the flag and proceed
                    delete ctx[eventKey];
                    runtime.waitEventNodeId = null;
                    runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                    continue;
                }
                // First encounter — send a callback button so user can confirm homework done
                if (runtime.waitEventNodeId !== node.id) {
                    const buttonLabel = renderTemplate(String(data.buttonText || '✅ Домашнє завдання виконано'), scope);
                    const waitMsg = renderTemplate(String(data.waitMessage || 'Виконай домашнє завдання і натисни кнопку нижче, коли буде готово 👇'), scope);
                    await persistAssistantMessage(session.id, waitMsg, {
                        nodeId: node.id,
                        nodeType: 'wait_event_prompt',
                        keyboard: [[{ text: buttonLabel, callback_data: `hw_done:${eventKey}` }]],
                    });
                }
                // Still waiting for event
                runtime.waitEventNodeId = node.id;
                runtime.waitingForUser = false;
                break;
            }

            const toWaitMs = () => {
                const unitRaw = String(data.unit || 'minutes').toLowerCase();
                const unit = unitRaw.endsWith('s') ? unitRaw : `${unitRaw}s`;

                if (typeof data.duration === 'string') {
                    const m = data.duration.trim().match(/^(\d+)\s*([mhdw])$/i);
                    if (m) {
                        const amount = Number(m[1]);
                        const short = m[2].toLowerCase();
                        if (short === 'm') return amount * 60 * 1000;
                        if (short === 'h') return amount * 60 * 60 * 1000;
                        if (short === 'd') return amount * 24 * 60 * 60 * 1000;
                        if (short === 'w') return amount * 7 * 24 * 60 * 60 * 1000;
                    }
                }

                const amount = Math.max(1, Number(data.duration || 1));
                const unitToMs = {
                    minutes: 60 * 1000,
                    hours: 60 * 60 * 1000,
                    days: 24 * 60 * 60 * 1000,
                    weeks: 7 * 24 * 60 * 60 * 1000,
                };
                return amount * (unitToMs[unit] || unitToMs.minutes);
            };

            const now = Date.now();
            const waitMs = toWaitMs();

            // First pass: arm wait timer and persist in DB context.
            if (!runtime.waitUntil || runtime.waitNodeId !== node.id) {
                runtime.waitUntil = now + waitMs;
                runtime.waitNodeId = node.id;
                runtime.waitingForUser = false;
                break;
            }

            // Keep waiting until target timestamp.
            if (now < Number(runtime.waitUntil)) {
                runtime.waitingForUser = false;
                break;
            }

            // Wait is over, continue flow.
            runtime.waitUntil = null;
            runtime.waitNodeId = null;
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'wait_payment') {
            const paid = String(ctx.wfp_payment_status || '').toLowerCase() === 'approved'
                || String(ctx.wfp_transaction_status || '').toLowerCase() === 'approved'
                || ctx.testMode === 'flow'; // auto-approve in test mode

            if (paid) {
                runtime.waitPaymentUntil = null;
                runtime.waitPaymentNodeId = null;
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id, 'paid') || pickNextNodeId(flow.edges, node.id, 'true');
                continue;
            }

            const timeoutHours = Math.max(1, Number(data.timeoutHours || 24));
            const timeoutMs = timeoutHours * 60 * 60 * 1000;
            const now = Date.now();

            if (!runtime.waitPaymentUntil || runtime.waitPaymentNodeId !== node.id) {
                runtime.waitPaymentUntil = now + timeoutMs;
                runtime.waitPaymentNodeId = node.id;
                runtime.waitingForUser = false;
                break;
            }

            if (now < Number(runtime.waitPaymentUntil)) {
                runtime.waitingForUser = false;
                break;
            }

            runtime.waitPaymentUntil = null;
            runtime.waitPaymentNodeId = null;
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id, 'unpaid') || pickNextNodeId(flow.edges, node.id, 'false') || pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'httpEncode') {
            const sourceVar = data.sourceVar ? String(data.sourceVar).replace(/^context\./, '') : '';
            const outputVar = data.outputVar ? String(data.outputVar).replace(/^context\./, '') : '';

            if (!sourceVar || !outputVar) {
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }

            try {
                const sourceValue = getByPath(ctx, sourceVar);
                const textToEncode = typeof sourceValue === 'string' ? sourceValue : safeJsonStringify(sourceValue || '');
                const encoded = Buffer.from(textToEncode).toString('base64');
                setByPath(ctx, outputVar, encoded);
            } catch (_error) {
                // Silently skip encoding on error
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'httpRequest') {
            const url = renderTemplate(data.url || '', scope);
            const method = (data.method || 'GET').toUpperCase();
            const outputVar = data.outputVar ? String(data.outputVar).replace(/^context\./, '') : '';

            if (!url) {
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }

            // Parse custom headers from node data (supports {{env.KEY}} templates)
            let customHeaders = {};
            if (data.headers) {
                try {
                    const rawHeaders = typeof data.headers === 'string' ? JSON.parse(data.headers) : data.headers;
                    for (const [k, v] of Object.entries(rawHeaders)) {
                        customHeaders[k] = typeof v === 'string' ? renderTemplate(v, scope) : String(v);
                    }
                } catch (_) { /* ignore malformed headers */ }
            }

            try {
                let bodyPayload = null;
                if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
                    if (data.bodyFields && typeof data.bodyFields === 'object') {
                        const rendered = {};
                        for (const [k, v] of Object.entries(data.bodyFields)) {
                            if (typeof v !== 'string') { rendered[k] = v; continue; }
                            // Pure {{path}} reference → resolve directly (preserves objects/arrays)
                            const singleRef = v.trim().match(/^\{\{\s*([^}]+)\s*\}\}$/);
                            if (singleRef) {
                                const resolved = getByPath(scope, String(singleRef[1]).trim());
                                rendered[k] = resolved !== undefined ? resolved : '';
                            } else {
                                rendered[k] = renderTemplate(v, scope);
                            }
                        }
                        bodyPayload = JSON.stringify(rendered);
                    } else if (data.body) {
                        bodyPayload = typeof data.body === 'string' ? renderTemplate(data.body, scope) : JSON.stringify(data.body);
                    }
                }

                // Bottleneck checkpoint: repair node-built JSON bodies (sliced
                // emojis + raw newlines in strings) so a single fragile node can't
                // 400 the whole flow. No-op for non-JSON / already-valid bodies.
                const _ct = String(customHeaders['Content-Type'] || customHeaders['content-type'] || 'application/json');
                if (bodyPayload && /json/i.test(_ct)) {
                    bodyPayload = ensureValidJsonBody(bodyPayload, { nodeId: node.id, url });
                }

                const doRequest = (reqUrl, reqMethod, payload, redirectsLeft = 5) => new Promise((resolve, reject) => {
                    const pu = new URL(reqUrl);
                    const isHttps = pu.protocol === 'https:';
                    const mod = isHttps ? https : require('http');
                    const opts = {
                        hostname: pu.hostname,
                        port: pu.port || (isHttps ? 443 : 80),
                        path: pu.pathname + pu.search,
                        method: reqMethod,
                        // Merge defaults with custom headers (custom takes precedence)
                        headers: Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json' }, customHeaders),
                    };
                    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
                    const req = mod.request(opts, (res) => {
                        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
                            res.resume();
                            // 303 and most 302s switch to GET; 307/308 keep original method
                            const nextMethod = (res.statusCode === 307 || res.statusCode === 308) ? reqMethod : 'GET';
                            const nextPayload = nextMethod === 'GET' ? null : payload;
                            const location = res.headers.location.startsWith('http')
                                ? res.headers.location
                                : new URL(res.headers.location, reqUrl).toString();
                            resolve(doRequest(location, nextMethod, nextPayload, redirectsLeft - 1));
                        } else {
                            const chunks = [];
                            res.on('data', (chunk) => chunks.push(chunk));
                            res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
                            res.on('error', reject);
                        }
                    });
                    req.on('error', reject);
                    if (payload) req.write(payload);
                    req.end();
                });

                const httpStart = Date.now();
                const httpResult = await doRequest(url, method, bodyPayload);
                const responseText = typeof httpResult === 'string' ? httpResult : httpResult.body;
                const httpStatus = typeof httpResult === 'object' ? httpResult.statusCode : null;
                console.log(`[httpRequest] url=${url.slice(0, 80)} status=${httpStatus} responseLen=${responseText.length} preview=${responseText.slice(0, 300)}`);

                // Лог у api_calls для вкладки API сесії
                await logFlowApiCall({
                    sessionId: session.id,
                    service: hostFromUrl(url),
                    method: `${method} ${new URL(url).pathname}`,
                    requestData: { url, method, headers: customHeaders, body: truncateStr(bodyPayload, 2000) },
                    responseData: { body: truncateStr(responseText, 3000) },
                    statusCode: httpStatus,
                    durationMs: Date.now() - httpStart,
                    error: (httpStatus && httpStatus >= 400) ? `HTTP ${httpStatus}` : null,
                });
                // HTTP-помилка (4xx/5xx) — також у вкладку Помилки
                if (httpStatus && httpStatus >= 400) {
                    await logFlowError({
                        sessionId: session.id,
                        botId: session.botId,
                        errorType: 'http_request',
                        message: `HTTP ${httpStatus} від ${url}`,
                        context: { nodeId: node.id, nodeLabel: data.label || '', response: truncateStr(responseText, 1000) },
                    });
                }

                if (outputVar) {
                    try {
                        const parsed = JSON.parse(responseText);
                        const value = data.responseField ? getByPath(parsed, data.responseField) : parsed;
                        console.log(`[httpRequest] responseField=${data.responseField} value=${JSON.stringify(value)}`);
                        if (value !== undefined) setByPath(ctx, outputVar, value);
                    } catch {
                        setByPath(ctx, outputVar, responseText);
                    }
                }
            } catch (_error) {
                console.error(`[httpRequest] error: ${_error.message}`);
                // Мережева помилка/таймаут — у обидві вкладки
                await logFlowApiCall({
                    sessionId: session.id,
                    service: hostFromUrl(url),
                    method: `${method} ${url}`,
                    requestData: { url, method },
                    responseData: {},
                    statusCode: null,
                    durationMs: null,
                    error: _error.message,
                });
                await logFlowError({
                    sessionId: session.id,
                    botId: session.botId,
                    errorType: 'http_request',
                    message: `httpRequest до ${url} впав: ${_error.message}`,
                    stack: _error.stack,
                    context: { nodeId: node.id, nodeLabel: data.label || '' },
                });
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'js') {
            const code = data.code || '';
            if (code) {
                try {
                    // Wrap in IIFE so node code can use `return {...}` to update context.
                    // Two patterns supported:
                    //   1) direct mutation: `context.foo = 1` (ctx passed by reference)
                    //   2) returned object: `return { foo: 1 }` → merged into context root
                    const sandbox = {
                        context: ctx,
                        user: sanitizeBigInt(session.user),
                        session: { id: session.id, state: session.state },
                        input: runtime.lastUserMessage || '',
                        keys: funnelEnv,
                        __jsResult: undefined,
                    };
                    // Support async/await in JS nodes (fetch, Buffer, crypto, etc.)
                    // new Function wraps user code in async IIFE so top-level await works
                    const asyncResult = await Promise.race([
                        new Function(
                            'context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto',
                            'return (async function(){"use strict";\n' + code + '\n})();'
                        )(ctx, sandbox.user, sandbox.session, sandbox.input, sandbox.keys || {}, fetch, Buffer, FormData, Blob, console, require('crypto')),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('JS node timeout (60s)')), 60000)),
                    ]);
                    if (asyncResult && typeof asyncResult === 'object' && !Array.isArray(asyncResult)) {
                        Object.assign(ctx, asyncResult);
                    }
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.warn('[flow] js node execution failed', node.id, err.message);
                    await logFlowError({
                        sessionId: session.id,
                        botId: session.botId,
                        errorType: 'js_node',
                        message: `JS-нода «${data.label || node.id}» впала: ${err.message}`,
                        stack: err.stack,
                        context: { nodeId: node.id, nodeLabel: data.label || '' },
                    });
                }
            }
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'sendPhoto') {
            const photoVar = data.photoVar ? String(data.photoVar).replace(/^context\./, '') : '';
            const caption = renderTemplate(data.caption || '', ctx);

            if (!photoVar) {
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }

            try {
                const photoData = getByPath(ctx, photoVar);
                let photoUrl = '';

                // If photoData is base64, convert to data URL
                if (typeof photoData === 'string' && photoData.length > 0) {
                    if (photoData.startsWith('http')) {
                        photoUrl = photoData;
                    } else {
                        photoUrl = `data:image/png;base64,${photoData}`;
                    }
                }

                if (photoUrl) {
                    // Store as metadata for later telegram send
                    await persistAssistantMessage(session.id, caption || '📸 Фото', {
                        nodeId: node.id,
                        nodeType: node.type,
                        attachment: { type: 'photo', url: photoUrl, caption },
                    });

                    if (caption) {
                        lastAssistant = caption;
                    }
                }
            } catch (_error) {
                // Silently skip on error
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'sendDocument') {
            const fileKey = data.fileKey ? String(data.fileKey).trim() : '';
            const fileType = data.fileType ? String(data.fileType).trim() : '';
            const fileVar = data.fileVar ? String(data.fileVar).replace(/^context\./, '') : '';
            const caption = renderTemplate(data.caption || '', scope);

            try {
                let fileName = data.fileName ? renderTemplate(data.fileName, scope) : '';
                let attachment = null;

                // fileKey — env var name, e.g. PRESENTATION_PDF_URL (supports both http URLs and Telegram file_ids)
                if (!attachment && fileKey) {
                    const resolvedValue = funnelEnv[fileKey] || '';
                    if (resolvedValue) {
                        attachment = { type: 'document', url: resolvedValue, fileName: fileName || 'document.pdf' };
                    }
                }

                // fileVar — context variable (supports http URLs and Telegram file_ids)
                if (!attachment && fileVar) {
                    const source = getByPath(ctx, fileVar);
                    if (typeof source === 'string' && source) {
                        if (source.startsWith('http')) {
                            attachment = { type: 'document', url: source, fileName: fileName || 'document.pdf' };
                        } else {
                            // Could be a Telegram file_id or text content
                            attachment = {
                                type: 'document',
                                url: source,
                                fileName: fileName || 'document.pdf',
                            };
                        }
                    } else if (source && typeof source !== 'string') {
                        attachment = {
                            type: 'document',
                            fileName: fileName || 'document.txt',
                            content: safeJsonStringify(source, 2),
                        };
                    }
                }

                // Direct URL with template support (e.g. {{env.PRESENTATION_PDF_URL}})
                if (!attachment && data.url) {
                    const resolvedUrl = renderTemplate(String(data.url), scope);
                    if (resolvedUrl) {
                        attachment = { type: 'document', url: resolvedUrl, fileName: fileName || 'document.pdf' };
                    }
                }

                if (!attachment && fileType) {
                    const latestFile = await db.file.findFirst({
                        where: {
                            userId: session.userId,
                            botId: session.botId,
                            fileType,
                        },
                        orderBy: { createdAt: 'desc' },
                        select: { fileName: true, filePath: true, fileType: true, content: true },
                    });

                    if (latestFile) {
                        attachment = {
                            type: 'document',
                            fileName: fileName || latestFile.fileName,
                            fileType: latestFile.fileType,
                            filePath: latestFile.filePath,
                            content: latestFile.content,
                        };
                    }
                }

                if (attachment) {
                    const messageText = caption || `📄 Документ: ${attachment.fileName || 'document'}`;
                    await persistAssistantMessage(session.id, messageText, {
                        nodeId: node.id,
                        nodeType: node.type,
                        attachment,
                    });
                    lastAssistant = messageText;
                }
            } catch (sendDocumentError) {
                console.error('[sendDocument] Error:', sendDocumentError.message);
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        // sendFile — static pre-uploaded file (PDF etc.) stored on the server
        if (node.type === 'sendFile') {
            const fileUrl = renderTemplate(data.fileUrl || '', scope);
            const fileName = renderTemplate(data.fileName || 'file', scope);
            const caption = renderTemplate(data.caption || '', scope);

            if (fileUrl) {
                const messageText = caption || `📎 ${fileName}`;
                await persistAssistantMessage(session.id, messageText, {
                    nodeId: node.id,
                    nodeType: node.type,
                    attachment: { type: 'document', url: fileUrl, fileName, caption },
                });
                lastAssistant = messageText;
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'fetchTelegramProfile') {
            // Fetch Telegram bio and profile photo for the current user (silent node)
            try {
                const user = session.user || await db.user.findUnique({ where: { id: session.userId }, select: { telegramId: true } });
                const telegramId = user?.telegramId;

                if (telegramId) {
                    // Load bot token from funnelKey
                    const tokenKey = await db.funnelKey.findUnique({
                        where: { botId_key: { botId: session.botId, key: 'TELEGRAM_BOT_TOKEN' } },
                        select: { value: true },
                    });
                    const token = tokenKey?.value || process.env.TELEGRAM_BOT_TOKEN || '';

                    if (token) {
                        const tgApiBase = `https://api.telegram.org/bot${token}`;

                        // Get chat info for bio
                        const chatRes = await fetch(`${tgApiBase}/getChat?chat_id=${telegramId}`);
                        const chatData = await chatRes.json();
                        ctx.tg_bio = chatData?.result?.bio || null;

                        // Get profile photo
                        const photoRes = await fetch(`${tgApiBase}/getUserProfilePhotos?user_id=${telegramId}&limit=1`);
                        const photoData = await photoRes.json();
                        const fileId = photoData?.result?.photos?.[0]?.[0]?.file_id;

                        if (fileId) {
                            const fileRes = await fetch(`${tgApiBase}/getFile?file_id=${fileId}`);
                            const fileData = await fileRes.json();
                            const filePath = fileData?.result?.file_path;
                            if (filePath) {
                                ctx.tg_photo_url = `https://api.telegram.org/file/bot${token}/${filePath}`;
                            }
                        }
                    }
                }
            } catch (tgError) {
                console.warn('[fetchTelegramProfile] Error (non-fatal):', tgError.message);
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'notifyTg') {
            if (ctx.testMode) { runtime.currentNodeId = pickNextNodeId(flow.edges, node.id); continue; }
            try {
                const _chat = funnelEnv[data.targetKey || 'ADMIN_TELEGRAM_ID'] || '';
                const _tok = funnelEnv.TELEGRAM_BOT_TOKEN || '';
                const _msg = renderTemplate(data.message || '', scope);
                if (_chat && _tok && /^\d+:[A-Za-z0-9_-]{20,}$/.test(_tok) && _msg) {
                    await fetch('https://api.telegram.org/bot' + _tok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(_chat), text: _msg, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(function(e){ console.error('[notifyTg] ' + e.message); });
                }
            } catch (e) { console.error('[notifyTg] ' + e.message); }
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'notifyAdmin') {
            if (ctx.testMode) { runtime.currentNodeId = pickNextNodeId(flow.edges, node.id); continue; }
            try {
                const adminTelegramIdValue = await getSystemKeyValue('ADMIN_TELEGRAM_ID');

                const enrichedScope = {
                    ...scope,
                    env: {
                        ...scope.env,
                        ADMIN_TELEGRAM_ID: adminTelegramIdValue || scope.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_TELEGRAM_ID || '',
                    },
                    timestamp: new Date().toISOString(),
                };

                // Support both legacy `telegramId` and new `targetKey` field
                let adminTelegramId;
                if (data.targetKey) {
                    // targetKey is an env var name (no {{env.}} prefix)
                    adminTelegramId = enrichedScope.env[data.targetKey] || '';
                    if (!adminTelegramId) {
                        // Try as a bot key
                        const keyRow = await db.funnelKey.findUnique({
                            where: { botId_key: { botId: session.botId, key: data.targetKey } },
                            select: { value: true },
                        }).catch(() => null);
                        adminTelegramId = keyRow?.value || adminTelegramIdValue || '';
                    }
                } else {
                    adminTelegramId = renderTemplate(data.telegramId || '{{env.ADMIN_TELEGRAM_ID}}', enrichedScope);
                }
                const adminMessage = renderTemplate(data.message || 'Нова подія в системі.', enrichedScope);

                if (adminTelegramId && adminMessage) {
                    // Resolve bot token: prefer bot's own funnel key → system key → env fallback
                    const botTokenRow = await db.funnelKey.findFirst({
                        where: { botId: session.botId, key: { in: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CONNECTOR_ID'] } },
                        select: { key: true, value: true },
                    }).catch(() => null);

                    let notifyToken = null;
                    if (botTokenRow?.key === 'TELEGRAM_CONNECTOR_ID' && botTokenRow.value) {
                        const conn = await db.savedConnector.findUnique({
                            where: { id: botTokenRow.value },
                            select: { config: true },
                        }).catch(() => null);
                        notifyToken = conn?.config?.token || null;
                    } else if (botTokenRow?.key === 'TELEGRAM_BOT_TOKEN' && /^\d+:[A-Za-z0-9_-]{20,}$/.test(botTokenRow.value)) {
                        notifyToken = botTokenRow.value;
                    }

                    if (!notifyToken) {
                        notifyToken = await getSystemKeyValue('TELEGRAM_BOT_TOKEN');
                    }
                    if (!notifyToken) {
                        notifyToken = process.env.TELEGRAM_BOT_TOKEN || null;
                    }

                    if (notifyToken) {
                        // Direct Telegram API call — bypasses the global singleton bot instance
                        await fetch(`https://api.telegram.org/bot${notifyToken}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: String(adminTelegramId), text: adminMessage }),
                        }).catch((e) => console.error('[notifyAdmin] fetch error:', e.message));
                    } else {
                        // Legacy fallback
                        await sendMessage(String(adminTelegramId), adminMessage, {}, session.id);
                    }
                }

                // Optional student confirmation from the same node
                if (data.notifyUser && data.userMessage && session.user?.telegramId) {
                    const studentMessage = renderTemplate(data.userMessage, enrichedScope);
                    if (studentMessage) {
                        await sendMessage(String(session.user.telegramId), studentMessage, {}, session.id);
                    }
                }
            } catch (notifyError) {
                console.error('[notifyAdmin] Error:', notifyError.message);
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'fbEvent') {
            // Facebook Conversions API (CAPI) — server-side подія (у Telegram нема браузера для пікселя).
            // Best-effort: НІКОЛИ не блокує воронку; без валідних ключів (тестові плейсхолдери) — тихо пропускає.
            const eventName = renderTemplate(String(data.eventName || 'Lead'), scope) || 'Lead';
            const pixelId = String(scope.env?.FB_PIXEL_ID || '').trim();
            const token = String(scope.env?.FB_CAPI_TOKEN || '').trim();
            const placeholder = !pixelId || !token || /test|placeholder|replace|xxxx/i.test(pixelId) || /test|placeholder|replace|xxxx/i.test(token);
            if (!placeholder) {
                try {
                    const crypto = require('crypto');
                    const tgId = String(scope.user?.telegramId || scope.user?.id || '');
                    const sha = (v) => v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined;
                    const value = data.value != null && data.value !== '' ? Number(renderTemplate(String(data.value), scope)) : undefined;
                    const payload = {
                        data: [{
                            event_name: eventName,
                            event_time: Math.floor(Date.now() / 1000),
                            event_id: `${node.id}_${tgId}_${Date.now()}`,
                            action_source: 'chat',
                            user_data: { external_id: sha(tgId) },
                            ...(value ? { custom_data: { value, currency: data.currency || 'USD' } } : {}),
                        }],
                        ...(data.testEventCode ? { test_event_code: String(data.testEventCode) } : {}),
                    };
                    await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
                    });
                } catch (e) {
                    console.warn('[fbEvent] CAPI best-effort fail:', e.message);
                }
            }
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'connector') {
            const connectorType = data.connectorType || '';
            const action = data.action || '';
            const outputVar = data.outputVar ? String(data.outputVar).replace(/^context\./, '') : '';

            // Тест-режим: платіжні конектори не б'ють реальні API (нема левих замовлень/лінків).
            // monoStatement лишаємо як інжектнув харнес; ibanoplata віддає фейковий URL.
            if (ctx.testMode && (connectorType === 'ibanoplata' || connectorType === 'monobank' || connectorType === 'browser_agent')) {
                if (connectorType === 'ibanoplata' && action === 'create_invoice') {
                    if (!ctx.orderRef) ctx.orderRef = 'TEST' + Date.now().toString(36).toUpperCase();
                    ctx.ibanInvoiceUid = 'test-uid';
                    ctx.ibanPayUrl = 'https://test.local/pay/' + ctx.orderRef;
                    if (outputVar) setByPath(ctx, outputVar, ctx.ibanPayUrl);
                }
                if (connectorType === 'browser_agent' && outputVar) setByPath(ctx, outputVar, { ok: true, testMode: true });
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }

            try {
                // Load connector config from DB
                const savedConnector = await db.savedConnector.findFirst({
                    where: { type: connectorType, isActive: true },
                });

                // Ключі можуть бути у САМІЙ воронці (funnelEnv), а не лише у збереженому
                // конекторі — тоді savedConnector не обовʼязковий (перевага для one-funnel
                // ключів). Це стосується ibanoplata/monobank; wayforpay лишається на конекторі.
                const KEY_BASED = connectorType === 'ibanoplata' || connectorType === 'monobank' || connectorType === 'browser_agent';
                if (!savedConnector && !KEY_BASED) {
                    console.warn(`[connector] Connector type "${connectorType}" not found or inactive`);
                    await logFlowError({
                        sessionId: session.id,
                        botId: session.botId,
                        errorType: 'connector',
                        message: `Конектор типу «${connectorType}» не знайдено або неактивний`,
                        context: { nodeId: node.id, nodeLabel: data.label || '', connectorType },
                    });
                    runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                    continue;
                }

                const config = (savedConnector && savedConnector.config) || {};

                if (connectorType === 'wayforpay' && action === 'create_invoice') {
                    const merchantAccount = config.merchant_account || '';
                    const merchantSecret = config.merchant_secret || '';
                    const merchantDomainRaw = config.merchant_domain || '';
                    const merchantDomainName = merchantDomainRaw.split('://').pop().replace(/[/]+$/, '');
                    const merchantName = config.merchant_name || merchantDomainName;

                    // Resolve dynamic params from context / data fields
                    const amount = String(renderTemplate(data.amount || '0', scope));
                    const productName = renderTemplate(data.productName || 'Course', scope);
                    const productImageUrl = renderTemplate(data.productImageUrl || '', scope);
                    const clientFirstName = (ctx.tg_first_name || '').trim();
                    const clientLastName = (ctx.tg_last_name || '').trim();
                    const clientEmail = ctx.email || '';
                    const orderReference = `order_${session.id}_${Date.now()}`;
                    const orderDate = Math.floor(Date.now() / 1000);
                    const currency = 'UAH';
                    const productCount = 1;

                    // Build HMAC MD5 signature
                    const signatureString = [
                        merchantAccount,
                        merchantDomainName,
                        orderReference,
                        orderDate,
                        amount,
                        currency,
                        productName,
                        productCount,
                        amount,
                    ].join(';');

                    const merchantSignature = crypto
                        .createHmac('md5', merchantSecret)
                        .update(signatureString)
                        .digest('hex');

                    const amountNum = parseFloat(amount) || 0;
                    const serviceUrl = (process.env.PUBLIC_BASE_URL || "https://flows.fineko.space").replace(/\/$/, "") + "/webhook/wayforpay";
                    const returnUrl = "https://t.me/michael_fineko_bot";

                    const payload = safeJsonStringify({
                        transactionType: "CREATE_INVOICE",
                        merchantAccount,
                        merchantDomainName,
                        merchantName,
                        orderReference,
                        orderDate,
                        amount: amountNum,
                        currency,
                        productName: [productName],
                        productPrice: [amountNum],
                        productCount: [productCount],
                        merchantSignature,
                        serviceUrl,
                        returnUrl,
                        apiVersion: 1,
                        language: 'UA',
                        ...(productImageUrl ? { productImageUrl: [productImageUrl] } : {}),
                        ...(clientFirstName ? { clientFirstName, clientLastName } : {}),
                        ...(clientEmail ? { clientEmail } : {}),
                    });

                    // POST to WayForPay API
                    const wfpCallStart = Date.now();
                    const wfpResponse = await new Promise((resolve, reject) => {
                        const options = {
                            hostname: 'api.wayforpay.com',
                            path: '/api',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(payload),
                            },
                        };
                        const req = https.request(options, (res) => {
                            let body = '';
                            res.on('data', (chunk) => { body += chunk; });
                            res.on('end', () => {
                                try { resolve(JSON.parse(body)); } catch { resolve({}); }
                            });
                        });
                        req.on('error', reject);
                        req.write(payload);
                        req.end();
                    });

                    const invoiceUrl = wfpResponse.invoiceUrl || '';
                    if (outputVar && invoiceUrl) {
                        setByPath(ctx, outputVar, invoiceUrl);
                    }

                    // Store orderReference for webhook matching
                    ctx.wfp_order_reference = orderReference;

                    // Auto-set legal footer — added to context for every WayForPay invoice
                    // Rule: always include {{context.wfp_legal_footer}} in the message node after WayForPay connector
                    const _baseUrl = (process.env.PUBLIC_BASE_URL || 'https://flows.fineko.space').replace(/\/$/, '');
                    ctx.wfp_legal_footer = `📄 Оплачуючи, ти погоджуєшся з умовами:
${_baseUrl}/legal/offer — Публічна оферта
${_baseUrl}/legal/refund — Повернення коштів
${_baseUrl}/legal/terms — Правила використання`;

                    console.log(`[connector:wayforpay] Invoice created: ${invoiceUrl || 'no url'}, reason: ${wfpResponse.reason}`);

                    // Log to api_calls for visibility in session API tab
                    db.apiCall.create({
                        data: {
                            sessionId: session.id,
                            service: 'wayforpay',
                            method: 'create_invoice',
                            requestData: {
                                orderReference,
                                amount,
                                currency,
                                productName,
                                merchantAccount,
                            },
                            responseData: {
                                invoiceUrl: invoiceUrl || null,
                                reasonCode: wfpResponse.reasonCode || null,
                                reason: wfpResponse.reason || null,
                            },
                            statusCode: invoiceUrl ? 200 : 422,
                            durationMs: Date.now() - wfpCallStart,
                        },
                    }).catch(e => console.error('[wfp:log] Failed to log create_invoice:', e.message));

                    // ── Auto-notify admin when payment link is generated ──
                    try {
                        const adminId = await getSystemKeyValue('ADMIN_TELEGRAM_ID');
                        if (adminId && invoiceUrl) {
                            const sr = ctx.spin_result || {};
                            const clientName = sr.name || sr.company || 'Клієнт';
                            const clientCompany = sr.company || sr.business || '';
                            const clientPain = sr.main_pain || '';
                            const botLabel = flow.bot?.name || 'бот';
                            let notifyText = `🔔 *Новий потенційний клієнт* — ${botLabel}\n\n`;
                            notifyText += `👤 ${clientName}`;
                            if (clientCompany && clientCompany !== clientName) notifyText += ` (${clientCompany})`;
                            notifyText += '\n';
                            if (clientPain) notifyText += `📌 Біль: ${clientPain}\n`;
                            notifyText += `\n💳 Посилання на оплату відправлено\n${invoiceUrl}`;
                            await sendMessage(String(adminId), notifyText, { parse_mode: 'Markdown' }, session.id).catch(() => {});
                        }
                    } catch (_notifyErr) { /* silent fail */ }
                }

                // ── ibanoplata: створення IBAN-посилання на оплату (orderRef у призначенні) ──
                if (connectorType === 'ibanoplata' && action === 'create_invoice') {
                    // Ключі: перевага funnelEnv (ключі воронки) → потім збережений конектор.
                    const apiKey = (funnelEnv.IBANOPLATA_API_KEY || config.api_key || config.apiKey || '').trim();
                    const orgName = renderTemplate(data.organizationName || funnelEnv.FOP_NAME || config.organization_name || '', scope);
                    const idCode = renderTemplate(data.identificationCode || funnelEnv.FOP_CODE || config.identification_code || '', scope);
                    const iban = renderTemplate(data.iban || funnelEnv.FOP_IBAN || config.iban || '', scope);
                    const amountNum = parseFloat(String(renderTemplate(data.amount || '{{context.payAmount}}', scope)).replace(',', '.')) || 0;
                    // orderRef — короткий унікальний ідентифікатор замовлення, який летить у
                    // призначення платежу → потім шукаємо його у виписці Mono.
                    let orderRef = (ctx.orderRef || '').toString().trim();
                    if (!orderRef) {
                        orderRef = 'GOV' + (Number(session.user && session.user.telegramId || 0).toString(36).slice(-4) + Date.now().toString(36).slice(-4)).toUpperCase();
                        ctx.orderRef = orderRef;
                    }
                    const paymentPurpose = renderTemplate(data.paymentPurpose || `Оплата за товар ${orderRef}`, scope);
                    const clientNotes = renderTemplate(data.clientNotes || `Замовлення ${orderRef}`, scope);
                    const expirationHours = parseInt(data.expirationHours || funnelEnv.IBANOPLATA_EXPIRATION_HOURS || config.expiration_hours || 24, 10) || 24;
                    const reqBody = {
                        organizationName: orgName, identificationCode: idCode, iban,
                        amount: Math.round(amountNum * 100) / 100,
                        paymentPurpose, notes: orderRef, clientNotes, expirationHours,
                    };
                    const ibStart = Date.now();
                    let ibJson = {}; let ibStatus = null;
                    try {
                        const r = await fetch('https://api.ibanoplata.com/v2/iban-invoice', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Api-Key': apiKey },
                            body: JSON.stringify(reqBody),
                        });
                        ibStatus = r.status;
                        ibJson = await r.json().catch(() => ({}));
                    } catch (e) { ibJson = { errorMessage: e.message }; }
                    const payUrl = ibJson.ibanInvoiceUrl || '';
                    if (payUrl) {
                        ctx.ibanPayUrl = payUrl;
                        ctx.ibanInvoiceUid = ibJson.ibanInvoiceUid || '';
                        if (outputVar) setByPath(ctx, outputVar, payUrl);
                    }
                    db.apiCall.create({ data: {
                        sessionId: session.id, service: 'ibanoplata', method: 'create_invoice',
                        requestData: { amount: reqBody.amount, paymentPurpose, orderRef },
                        responseData: { ibanInvoiceUid: ibJson.ibanInvoiceUid || null, ibanInvoiceUrl: payUrl || null, error: ibJson.errorMessage || null },
                        statusCode: ibStatus, durationMs: Date.now() - ibStart,
                    } }).catch(() => {});
                }

                // ── monobank ФОП: отримання виписки (кредити) для звірки оплат ──
                if (connectorType === 'monobank' && action === 'get_statement') {
                    const token = (funnelEnv.MONO_TOKEN || config.token || config.api_key || '').trim();
                    const account = (renderTemplate(data.accountId || funnelEnv.MONO_ACCOUNT_ID || config.account_id || '0', scope) || '0').trim() || '0';
                    const windowHours = parseInt(data.windowHours || 48, 10) || 48;
                    const cacheKey = `${token}:${account}`;
                    const cached = MONO_STATEMENT_CACHE.get(cacheKey);
                    let items = null; let monoStatus = null;
                    const monoStart = Date.now();
                    if (cached && (Date.now() - cached.at) < MONO_MIN_INTERVAL_MS) {
                        items = cached.items; monoStatus = 304; // кеш — щоб не порушити ліміт 1/60c
                    } else {
                        const from = Math.floor((Date.now() - windowHours * 3600 * 1000) / 1000);
                        try {
                            const r = await fetch(`https://api.monobank.ua/personal/statement/${encodeURIComponent(account)}/${from}`, { headers: { 'X-Token': token } });
                            monoStatus = r.status;
                            const j = await r.json().catch(() => null);
                            if (Array.isArray(j)) { items = j; MONO_STATEMENT_CACHE.set(cacheKey, { at: Date.now(), items: j }); }
                            else if (cached) { items = cached.items; } // 429/помилка — беремо останнє добре
                            else { items = []; }
                        } catch (e) { items = cached ? cached.items : []; }
                    }
                    const credits = (items || []).filter((t) => t && Number(t.amount) > 0).map((t) => ({
                        id: t.id, amountUah: Math.round(Number(t.amount)) / 100, time: t.time,
                        comment: t.comment || '', description: t.description || '',
                        counterName: t.counterName || '', counterIban: t.counterIban || '',
                    }));
                    ctx.monoStatement = credits;
                    // Глобальний реєстр уже зарахованих транзакцій (антидубль між сесіями).
                    try {
                        const reg = await db.funnelKey.findFirst({ where: { botId: session.botId, key: '_CONSUMED_MONO_TX' }, select: { value: true } });
                        const globalConsumed = reg && reg.value ? (JSON.parse(reg.value) || []) : [];
                        const sess = Array.isArray(ctx.consumedTxIds) ? ctx.consumedTxIds : [];
                        ctx.consumedTxIds = Array.from(new Set([...sess, ...globalConsumed]));
                    } catch (_e) { /* ignore */ }
                    if (outputVar) setByPath(ctx, outputVar, credits);
                    db.apiCall.create({ data: {
                        sessionId: session.id, service: 'monobank', method: 'get_statement',
                        requestData: { account, windowHours },
                        responseData: { count: credits.length, fromCache: monoStatus === 304 },
                        statusCode: monoStatus, durationMs: Date.now() - monoStart,
                    } }).catch(() => {});
                }

                // ── monobank: позначити транзакцію зарахованою у глобальному реєстрі ──
                if (connectorType === 'monobank' && action === 'mark_consumed') {
                    const txId = (renderTemplate(data.txId || '{{context.payTxId}}', scope) || '').trim();
                    if (txId) {
                        try {
                            const reg = await db.funnelKey.findFirst({ where: { botId: session.botId, key: '_CONSUMED_MONO_TX' } });
                            let arr = reg && reg.value ? (JSON.parse(reg.value) || []) : [];
                            if (!arr.includes(txId)) {
                                arr.push(txId);
                                if (arr.length > 500) arr = arr.slice(-500); // обмежуємо розмір реєстру
                                if (reg) await db.funnelKey.update({ where: { id: reg.id }, data: { value: JSON.stringify(arr) } });
                                else await db.funnelKey.create({ data: { botId: session.botId, key: '_CONSUMED_MONO_TX', value: JSON.stringify(arr), isSecret: false } });
                            }
                        } catch (_e) { /* best-effort */ }
                    }
                }

                // ── ibanoplata: видалення посилання (після оплати або протягом cron) ──
                if (connectorType === 'ibanoplata' && action === 'delete_invoice') {
                    const apiKey = (funnelEnv.IBANOPLATA_API_KEY || config.api_key || config.apiKey || '').trim();
                    const uid = (renderTemplate(data.invoiceUid || '{{context.ibanInvoiceUid}}', scope) || '').trim();
                    if (uid) {
                        const dStart = Date.now(); let dStatus = null;
                        try {
                            const r = await fetch(`https://api.ibanoplata.com/v2/iban-invoice/${encodeURIComponent(uid)}`, {
                                method: 'DELETE', headers: { Accept: 'application/json', 'X-Api-Key': apiKey },
                            });
                            dStatus = r.status;
                        } catch (_e) { /* best-effort */ }
                        db.apiCall.create({ data: {
                            sessionId: session.id, service: 'ibanoplata', method: 'delete_invoice',
                            requestData: { uid }, responseData: {}, statusCode: dStatus, durationMs: Date.now() - dStart,
                        } }).catch(() => {});
                    }
                }

                // ── browser_agent: веб-автоматизація через мікросервіс (replay/agent/read) ──
                if (connectorType === 'browser_agent') {
                    const base = (funnelEnv.BROWSER_AGENT_URL || config.base_url || 'http://127.0.0.1:8091').replace(/\/$/, '');
                    const secret = (funnelEnv.BROWSER_AGENT_SECRET || config.secret || '').trim();
                    const headers = { 'Content-Type': 'application/json', 'X-Agent-Secret': secret };
                    let path = ''; let reqBody = {};
                    if (action === 'replay') {
                        let scenario = {};
                        if (data.scenarioKey && funnelEnv[data.scenarioKey]) { try { scenario = JSON.parse(funnelEnv[data.scenarioKey]); } catch (_e) { scenario = {}; } }
                        else if (data.scenarioVar) { scenario = getByPath(ctx, String(data.scenarioVar).replace(/^context\./, '')) || {}; }
                        const payload = data.dataVar ? (getByPath(ctx, String(data.dataVar).replace(/^context\./, '')) || {}) : {};
                        path = '/replay'; reqBody = { scenario, data: payload, screenshot: data.screenshot !== false };
                    } else if (action === 'agent') {
                        const payload = data.dataVar ? (getByPath(ctx, String(data.dataVar).replace(/^context\./, '')) || {}) : {};
                        path = '/agent'; reqBody = {
                            task: renderTemplate(data.task || '', scope),
                            startUrl: renderTemplate(data.startUrl || '', scope) || null,
                            data: payload, dry_run: data.dryRun !== false,
                            screenshot: data.screenshot !== false, max_steps: parseInt(data.maxSteps || 40, 10) || 40,
                        };
                    } else if (action === 'read') {
                        path = '/read'; reqBody = { url: renderTemplate(data.url || '', scope), mode: data.mode || 'markdown', render_js: data.renderJs === true };
                    }
                    if (path) {
                        const bStart = Date.now(); let bStatus = null; let bJson = {};
                        try {
                            const r = await fetch(base + path, { method: 'POST', headers, body: safeJsonStringify(reqBody) });
                            bStatus = r.status; bJson = await r.json().catch(() => ({}));
                        } catch (e) { bJson = { ok: false, error: e.message }; }
                        if (outputVar) setByPath(ctx, outputVar, bJson);
                        if (bJson && bJson.screenshot_b64) ctx.browserScreenshot = bJson.screenshot_b64;
                        if (bJson && bJson.draft_scenario_raw) ctx.browserScenarioDraft = bJson.draft_scenario_raw;
                        db.apiCall.create({ data: {
                            sessionId: session.id, service: 'browser_agent', method: action,
                            requestData: { path, action }, // секрет НЕ логуємо
                            responseData: { ok: !!(bJson && bJson.ok), error: (bJson && bJson.error) || null, url: (bJson && bJson.url) || null },
                            statusCode: bStatus, durationMs: Date.now() - bStart,
                        } }).catch(() => {});
                    }
                }
            } catch (connectorError) {
                console.error(`[connector:${connectorType}] Error:`, connectorError.message);
                await logFlowApiCall({
                    sessionId: session.id,
                    service: connectorType || 'connector',
                    method: action || 'call',
                    requestData: { connectorType, action },
                    responseData: {},
                    statusCode: null,
                    durationMs: null,
                    error: connectorError.message,
                });
                await logFlowError({
                    sessionId: session.id,
                    botId: session.botId,
                    errorType: 'connector',
                    message: `Конектор «${connectorType}» (${action}) впав: ${connectorError.message}`,
                    stack: connectorError.stack,
                    context: { nodeId: node.id, nodeLabel: data.label || '', connectorType, action },
                });
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        // ── AGENT NODE — agentic loop with HTTP tools ─────────────────────────────
        if (node.type === 'agent') {
            const agentScope = { ...scope, context: compressContextForPrompt(ctx) };
            const systemPrompt = renderTemplate(data.systemPrompt || 'You are a helpful assistant.', agentScope);
            const maxIterations = parseInt(data.maxIterations, 10) || 10;
            const outputPath = data.outputVar ? String(data.outputVar).replace(/^context\./, '') : null;

            // Build initial messages from template. У dialogMode без вводу — стартовий тригер,
            // щоб агент сам привітався/продовжив (як speakFirst).
            let agentUserInput = runtime.lastUserMessage
                || (data.dialogMode ? (data.startTrigger || 'Почни/продовж діалог: за потреби виклич get_profile, зрозумій поточний стан і став наступне питання або підсумуй.') : '');
            // Вхідний документ → додати його текст у ввід (агент сам витягне дані й збереже через інструменти).
            if (ctx.lastFile && ctx.lastFile.fileUrl) {
                try {
                    const _dtxt = await extractDocumentText(ctx.lastFile.fileUrl, ctx.lastFile.mimeType, ctx.lastFile.fileName);
                    if (_dtxt) agentUserInput = (agentUserInput ? agentUserInput + '\n\n' : '') + `[Користувач надіслав документ «${ctx.lastFile.fileName || 'файл'}». Текст документа:]\n${_dtxt}`;
                } catch (e) { logger.warn('[agent node] doc extract failed', { error: e.message }); }
                ctx.lastFile = null;
            }
            // Історія діалогу між ходами (як у claude-ноді). Зберігаємо ТІЛЬКИ чисті
            // текстові ходи (user/assistant) — без проміжних tool_use/tool_result, бо
            // truncateHistory може розірвати пару tool_use↔tool_result і Claude API впаде.
            if (!runtime.dialogHistory) runtime.dialogHistory = {};
            const priorHistory = (data.dialogMode && Array.isArray(runtime.dialogHistory[node.id]))
                ? runtime.dialogHistory[node.id] : [];
            let messages;
            if (priorHistory.length > 0) {
                messages = [...priorHistory, { role: 'user', content: agentUserInput }];
            } else {
                try {
                    messages = parseClaudeMessages(data.messagesTemplate, agentScope, agentUserInput);
                } catch (e) {
                    messages = [{ role: 'user', content: agentUserInput }];
                }
            }

            // Build Claude tools from node.data.tools
            const rawTools = Array.isArray(data.tools) ? data.tools : [];
            const claudeTools = rawTools.map((t) => ({
                name: t.name,
                description: t.description || t.name,
                input_schema: t.inputSchema || { type: 'object', properties: {}, required: [] },
            }));

            // Resolve API key
            const { createClient } = require('@platform/claude/src/client');
            const { resolveFunnelClaudeKey } = require('@platform/claude/src/wrapper');
            let apiKey = '';
            try { apiKey = await resolveFunnelClaudeKey(session.id); } catch (e) { /* ignore */ }
            if (!apiKey) {
                logger.warn('[agent node] No API key, skipping', { nodeId: node.id });
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
            }
            const anthropic = createClient(apiKey);
            const agentModel = data.model || 'claude-sonnet-4-6';
            const agentMaxTokens = parseInt(data.maxTokens, 10) || 4096;

            let agentResponse = '';
            let agentDone = false;
            for (let iter = 0; iter < maxIterations; iter++) {
                let response;
                try {
                    response = await anthropic.messages.create({
                        model: agentModel,
                        max_tokens: agentMaxTokens,
                        system: systemPrompt,
                        tools: claudeTools.length > 0 ? claudeTools : undefined,
                        messages,
                    });
                } catch (e) {
                    logger.error('[agent node] Claude error', { nodeId: node.id, error: e.message });
                    agentResponse = `Помилка агента: ${e.message}`;
                    break;
                }

                const textBlocks = response.content.filter((b) => b.type === 'text');
                const toolBlocks = response.content.filter((b) => b.type === 'tool_use');

                if (textBlocks.length > 0) {
                    agentResponse = textBlocks.map((b) => b.text).join('\n');
                }

                if (response.stop_reason === 'end_turn' || toolBlocks.length === 0) {
                    break;
                }

                // Execute tool calls
                messages = [...messages, { role: 'assistant', content: response.content }];
                const toolResults = [];

                for (const toolCall of toolBlocks) {
                    // finishTool — сигнал завершення діалогу (dialogMode): не HTTP, а прапорець.
                    if (data.finishTool && toolCall.name === data.finishTool) {
                        agentDone = true;
                        toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: 'Готово, завершую.' });
                        continue;
                    }
                    const toolDef = rawTools.find((t) => t.name === toolCall.name);
                    let toolResult = '';
                    if (toolDef && toolDef.url) {
                        try {
                            // Render URL with current scope + tool inputs in context
                            const toolScope = { ...agentScope, context: { ...agentScope.context, ...toolCall.input } };
                            const resolvedUrl = renderTemplate(toolDef.url, toolScope);
                            const toolMethod = (toolDef.method || 'POST').toUpperCase();
                            const toolBody = toolMethod !== 'GET' ? JSON.stringify(toolCall.input) : undefined;
                            const toolHeaders = { 'Content-Type': 'application/json', ...(toolDef.headers || {}) };

                            const httpStart = Date.now();
                            const httpRes = await fetch(resolvedUrl, {
                                method: toolMethod,
                                headers: toolHeaders,
                                body: toolBody,
                                signal: AbortSignal.timeout(30000),
                            });
                            const rawText = await httpRes.text();
                            let parsed;
                            try { parsed = JSON.parse(rawText); } catch { parsed = rawText; }
                            toolResult = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
                            logger.info('[agent node] Tool call', { tool: toolCall.name, status: httpRes.status, ms: Date.now() - httpStart });
                        } catch (e) {
                            toolResult = `Tool error: ${e.message}`;
                            logger.error('[agent node] Tool HTTP error', { tool: toolCall.name, error: e.message });
                        }
                    } else {
                        toolResult = `Tool "${toolCall.name}" not found`;
                    }

                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolCall.id,
                        content: toolResult,
                    });
                }

                messages = [...messages, { role: 'user', content: toolResults }];
            }

            if (agentResponse) {
                await persistAssistantMessage(session.id, agentResponse, { nodeId: node.id, nodeType: 'agent' });
                lastAssistant = agentResponse;
            }
            if (outputPath) {
                setByPath(ctx, outputPath, agentResponse);
            }
            runtime.lastUserMessage = '';
            // Дописати чистий хід у історію (документи обрізаємо — не тягнемо 40K щоразу).
            if (data.dialogMode) {
                const histUser = agentUserInput.length > 4000
                    ? agentUserInput.slice(0, 4000) + '…[обрізано]' : agentUserInput;
                runtime.dialogHistory[node.id] = truncateHistory([
                    ...priorHistory,
                    { role: 'user', content: histUser || 'Продовжуємо.' },
                    { role: 'assistant', content: agentResponse || 'Ок.' },
                ]);
            }
            // dialogMode: якщо агент НЕ викликав finishTool — чекаємо наступне повідомлення
            // юзера (лишаємось на цій ноді). Інакше — йдемо далі.
            if (data.dialogMode && !agentDone) {
                runtime.waitingForUser = true;
                break;
            }
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'knowledgeBase') {
            const blocks = Array.isArray(data.blocks) ? data.blocks : [];
            const contextKey = data.contextKey ? String(data.contextKey).trim() : 'knowledge_base';

            if (blocks.length > 0) {
                const query = runtime.lastUserMessage || '';
                const result = searchKnowledgeBase(blocks, query);
                setByPath(ctx, contextKey, result);
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
    }

    const completed = !runtime.currentNodeId;
    const state = completed ? 'completed' : runtime.currentNodeId;
    const updatedContext = {
        ...ctx,
        flowRuntime: runtime,
        currentNode: runtime.currentNodeId || null,
    };

    const updatedSession = await db.session.update({
        where: { id: session.id },
        data: {
            state,
            context: updatedContext,
            isActive: !completed,
            completedAt: completed ? new Date() : null,
            lastActive: new Date(),
        },
    });

    return {
        session: updatedSession,
        botResponse: lastAssistant,
        flowDriven: true,
        contextSnapshot: updatedContext,
    };
}

async function resolveBot({ botId, botSlug }) {
    if (!botId && !botSlug) {
        throw new Error('Provide botId or botSlug');
    }

    const bot = await db.bot.findFirst({
        where: botId ? { id: botId } : { slug: botSlug },
        include: { project: true },
    });

    if (!bot) {
        throw new Error('Bot not found');
    }

    // Support any bot that has a flow definition (not limited to finance-course)
    return bot;
}

async function resolveIdentity(userId, botSlug) {
    if (!userId) {
        return buildSyntheticTelegramIdentity(botSlug);
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new Error('User not found');
    }

    return {
        telegramId: toSafeNumberTelegramId(user.telegramId),
        username: user.username || `test_user_${user.id.slice(0, 8)}`,
        firstName: user.firstName || 'Test',
        lastName: user.lastName || '',
        languageCode: user.languageCode || 'uk',
    };
}

async function getLatestAssistantMessage(sessionId) {
    return db.message.findFirst({
        where: { sessionId, role: 'assistant' },
        orderBy: { createdAt: 'desc' },
    });
}

async function findLatestSession(userId, botId) {
    return db.session.findFirst({
        where: { userId, botId },
        orderBy: { startedAt: 'desc' },
    });
}

async function ensurePrerequisiteFiles(userId, bot) {
    const requirements = BOT_REQUIREMENTS[bot.slug] || { files: [] };
    const allFileTypes = new Set(requirements.files || []);

    // Also seed fileTypes needed by loadFile nodes in the flow definition
    try {
        const flowDef = await db.flowDefinition.findUnique({ where: { botId: bot.id }, select: { nodes: true } });
        if (flowDef?.nodes) {
            const nodes = Array.isArray(flowDef.nodes) ? flowDef.nodes : [];
            for (const node of nodes) {
                if (node.type === 'loadFile' && node.data?.fileType) allFileTypes.add(node.data.fileType);
            }
        }
    } catch { /* flow parsing errors are non-fatal */ }

    for (const fileType of allFileTypes) {
        const latest = await db.file.findFirst({
            where: { userId, fileType },
            orderBy: { version: 'desc' },
        });

        if (latest) continue;

        const content = FILE_SEED_DEFAULTS[fileType] || `Seed file for automated regression: ${fileType}`;
        await db.file.create({
            data: {
                userId,
                botId: bot.id,
                fileType,
                fileName: `${fileType}_seed_v1.md`,
                filePath: `/tmp/test-seed/${userId}/${fileType}_v1.md`,
                content,
                version: 1,
            },
        });
    }
}

async function startTestSession({ botId, botSlug, userId, contextOverride }) {
    const bot = await resolveBot({ botId, botSlug });
    const identity = await resolveIdentity(userId, bot.slug);

    const flow = await getFlowDefinition(bot.id);
    if (flow) {
        const user = await findOrCreateTestUser(bot, identity);
        await ensurePrerequisiteFiles(user.id, bot);
        const overrideContext = normalizeContextOverride(contextOverride);

        const startNode = findStartNode(flow.nodes);
        const created = await db.session.create({
            data: {
                userId: user.id,
                botId: bot.id,
                state: startNode?.id || 'start',
                isTest: true,
                context: {
                    ...overrideContext,
                    currentNode: startNode?.id || null,
                    testMode: 'flow',
                    flowRuntime: {
                        currentNodeId: startNode?.id || null,
                        waitingForUser: false,
                        nodesVisited: [],
                        lastUserMessage: '',
                    },
                },
            },
        });

        const stepped = await executeFlowStep({ sessionId: created.id });
        const firstMessage = await getLatestAssistantMessage(created.id);

        return {
            sessionId: created.id,
            firstMessage: firstMessage?.content || null,
            currentState: stepped.session.state,
            contextSnapshot: stepped.contextSnapshot,
            slotsSnapshot: stepped.contextSnapshot?.slots || {},
            testUser: {
                id: user.id,
                telegramId: identity.telegramId,
                username: identity.username,
            },
            warning: null,
            mode: 'flow',
        };
    }

    let warning = null;
    const diagnostics = [];
    const attempts = [
        `/start ${bot.slug}`,
        '/start',
        'Привіт',
        `/start ${bot.slug}`,
    ];

    for (const message of attempts) {
        try {
            enableTestChat(identity.telegramId);
            await handleTelegramUpdate(buildUpdate(identity, message));
        } catch (error) {
            warning = error.message;
        } finally {
            disableTestChat(identity.telegramId);
            consumeTestMessages(identity.telegramId);
        }

        const existingUser = await db.user.findUnique({ where: { telegramId: BigInt(identity.telegramId) } });
        if (!existingUser) {
            diagnostics.push({ message, userCreated: false, sessionCreated: false, warning });
            continue;
        }

        await ensurePrerequisiteFiles(existingUser.id, bot);

        const existingSession = await findLatestSession(existingUser.id, bot.id);
        diagnostics.push({
            message,
            userCreated: true,
            sessionCreated: Boolean(existingSession),
            warning,
        });
        if (existingSession) break;
    }

    const user = await db.user.findUnique({ where: { telegramId: BigInt(identity.telegramId) } });
    if (!user) {
        throw new Error('Test user was not created by handler');
    }

    const session = await findLatestSession(user.id, bot.id);

    if (!session) {
        throw new Error(`Test session was not created. Diagnostics: ${safeJsonStringify(diagnostics)}`);
    }

    const firstMessage = await getLatestAssistantMessage(session.id);

    return {
        sessionId: session.id,
        firstMessage: firstMessage?.content || null,
        currentState: session.state,
        contextSnapshot: session.context,
        slotsSnapshot: session.context?.slots || {},
        testUser: {
            id: user.id,
            telegramId: identity.telegramId,
            username: identity.username,
        },
        warning,
    };
}

async function sendTestMessage({ sessionId, message }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: { user: true, bot: { include: { project: true } } },
    });

    if (!session) {
        throw new Error('Session not found');
    }

    if (session.context?.testMode === 'flow') {
        await persistUserMessage(session.id, message);
        const stepped = await executeFlowStep({ sessionId: session.id, incomingUserMessage: message });

        return {
            sessionId: session.id,
            botResponse: stepped.botResponse,
            currentState: stepped.session.state,
            contextSnapshot: stepped.contextSnapshot,
            slotsSnapshot: stepped.contextSnapshot?.slots || {},
            warning: null,
            mode: 'flow',
        };
    }

    if (session.bot.project?.slug !== 'finance-course') {
        throw new Error('Test session currently supports finance-course bots only');
    }

    const identity = {
        telegramId: toSafeNumberTelegramId(session.user.telegramId),
        username: session.user.username || `test_user_${session.user.id.slice(0, 8)}`,
        firstName: session.user.firstName || 'Test',
        lastName: session.user.lastName || '',
        languageCode: session.user.languageCode || 'uk',
    };

    let warning = null;
    try {
        enableTestChat(identity.telegramId);
        await handleTelegramUpdate(buildUpdate(identity, message));
    } catch (error) {
        warning = error.message;
    } finally {
        disableTestChat(identity.telegramId);
    }

    const sentMessages = consumeTestMessages(identity.telegramId);
    const lastSent = sentMessages.length > 0 ? sentMessages[sentMessages.length - 1] : null;

    const latestAssistantMessage = await getLatestAssistantMessage(session.id);
    const updatedSession = await db.session.findUnique({ where: { id: session.id } });

    return {
        sessionId: session.id,
        botResponse: lastSent?.text || latestAssistantMessage?.content || null,
        currentState: updatedSession?.state || session.state,
        contextSnapshot: updatedSession?.context || session.context,
        slotsSnapshot: (updatedSession?.context || session.context)?.slots || {},
        warning,
    };
}

async function getTestSessionState({ sessionId }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: {
            user: { select: { id: true, firstName: true, username: true, telegramId: true } },
            bot: { select: { id: true, name: true, slug: true } },
            messages: { orderBy: { createdAt: 'asc' }, take: 200 },
            files: { orderBy: { createdAt: 'desc' }, take: 100 },
        },
    });

    if (!session) {
        throw new Error('Session not found');
    }

    return {
        sessionId: session.id,
        bot: session.bot,
        user: session.user,
        isActive: session.isActive,
        currentState: session.state,
        currentNode: session.context?.currentNode || session.context?.currentNodeId || session.state || null,
        nodesVisited: session.context?.flowRuntime?.nodesVisited || null,
        context: session.context,
        slots: session.context?.slots || {},
        history: session.messages,
        files: session.files,
    };
}

async function endTestSession({ sessionId }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: {
            _count: { select: { messages: true, apiCalls: true, files: true } },
        },
    });

    if (!session) {
        throw new Error('Session not found');
    }

    const updatedSession = session.isActive
        ? await db.session.update({
            where: { id: sessionId },
            data: { isActive: false, completedAt: new Date(), lastActive: new Date() },
        })
        : session;

    return {
        sessionId,
        summary: {
            isActive: updatedSession.isActive,
            completedAt: updatedSession.completedAt,
            state: updatedSession.state,
        },
        nodesVisited: updatedSession.context?.flowRuntime?.nodesVisited || null,
        filesCreated: session._count.files,
        messagesCount: session._count.messages,
        apiCallsCount: session._count.apiCalls,
        slotsSet: Object.keys(updatedSession.context?.slots || {}).length,
    };
}

module.exports = {
    startTestSession,
    sendTestMessage,
    getTestSessionState,
    endTestSession,
    executeFlowStep,
};
