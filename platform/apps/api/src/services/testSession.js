'use strict';

const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { callClaude, notifyAdminOfServiceOutage } = require('@platform/claude');
const { BOT_REQUIREMENTS } = require('../../../../projects/finance-course/config/prerequisites');
const { enableTestChat, disableTestChat, consumeTestMessages, sendMessage } = require('@platform/telegram');
const crypto = require('crypto');
const https = require('https');
const vm = require('vm');
const { extractDocumentText } = require('./docExtract');
const { redisClient } = require('../lib/sessionStore');
const { getMonoStatement, markConsumed: markMonoConsumed, getConsumedSet: getMonoConsumedSet } = require('@platform/mono-statement');

const { handleTelegramUpdate } = require('../../../../projects/finance-course/src/telegramHandler');

const MAX_SAFE_TELEGRAM_ID = 9007199254740991;

// monobank personal API дозволяє 1 запит виписки / 60 c на токен. Кеш+лок тепер
// у Redis (@platform/mono-statement) — спільний між api/worker процесами і
// захищає від "thundering herd" (N сесій одночасно б'ють Mono API повз кеш).

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

// Евристика «схоже на вичерпаний баланс/квоту» для довільних httpRequest-нод
// (fal.ai, ElevenLabs, Replicate, HeyGen, Ideogram тощо — платні сервіси, на
// які воронка ходить напряму, не через callClaude). 402/403 + типові фрази
// в тілі відповіді. Не намагається бути точною для кожного провайдера —
// краще хибне спрацювання раз на 15 хв (дедуп у notifyAdminOfServiceOutage),
// ніж мовчазний простій воронки без жодного алерту.
function looksLikeBalanceError(status, bodyText) {
    if (status === 402) return true;
    const t = String(bodyText || '').toLowerCase();
    return /insufficient.{0,20}(balance|credit|fund)|out of credit|credit balance|low balance|balance too low|quota exceeded|exceeded.{0,20}quota|payment required|billing/i.test(t);
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

// ── Робоча памʼять agent-ноди ────────────────────────────────────────────────
// Чому не «останні N повідомлень»: день із десятьма короткими репліками і день із
// важкою перепискою — це різні обсяги, а не різна кількість. Ріжемо за розміром.
//
// І ріжемо ЦІЛИМИ ходами. Хід = повідомлення користувача плюс усе, що сталося до
// наступного його повідомлення, включно з парами виклик-інструмента ↔ результат.
// Якщо різати посеред такої пари, Claude API поверне помилку — тому межа завжди
// на повідомленні користувача.
const HISTORY_BUDGET_CHARS = 40000; // ~10k токенів

/** Справжня репліка людини, а не tool_result (той теж має role 'user', але масив). */
function isUserTurnStart(m) {
    return m && m.role === 'user' && typeof m.content === 'string';
}

function approxChars(m) {
    return typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length;
}

function trimDialogTurns(messages, budget = HISTORY_BUDGET_CHARS) {
    if (!Array.isArray(messages) || !messages.length) return [];

    const turns = [];
    for (const m of messages) {
        if (isUserTurnStart(m) || !turns.length) turns.push([]);
        turns[turns.length - 1].push(m);
    }

    let total = messages.reduce((sum, m) => sum + approxChars(m), 0);
    // Останній хід лишаємо завжди, навіть якщо він сам перевищує бюджет:
    // без нього модель втратить те, про що щойно йшлося.
    while (turns.length > 1 && total > budget) {
        const dropped = turns.shift();
        total -= dropped.reduce((sum, m) => sum + approxChars(m), 0);
    }
    return turns.flat();
}

// ── MCP-клієнт для agent-ноди ────────────────────────────────────────────────
// Каталог інструментів живе в самому продукті (ORG тощо), а не дублюється в кожній
// воронці. Двигун читає його по JSON-RPC і кешує.
//
// Стабільність тут важливіша за свіжість: якщо продукт на хвилину ліг, ми беремо
// ОСТАННІЙ РОБОЧИЙ каталог і бот працює далі. Впасти через те, що сусідній сервіс
// перезапускається, — найгірший з можливих сценаріїв.
const MCP_TTL_MS = 5 * 60 * 1000;
const mcpCatalogCache = new Map(); // url → { tools, fetchedAt, lastGoodAt }

async function mcpRpc(server, method, params, timeoutMs = 15000) {
    const res = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(server.headers || {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'MCP error');
    return j.result;
}

/** Каталог інструментів сервера: свіжий, або з кешу, або останній робочий. */
async function mcpListTools(server) {
    const cached = mcpCatalogCache.get(server.url);
    if (cached && Date.now() - cached.fetchedAt < MCP_TTL_MS) return cached.tools;

    try {
        const result = await mcpRpc(server, 'tools/list', {}, 8000);
        const tools = Array.isArray(result?.tools) ? result.tools : [];
        mcpCatalogCache.set(server.url, { tools, fetchedAt: Date.now(), lastGoodAt: Date.now() });
        return tools;
    } catch (e) {
        if (cached) {
            // Не оновлюємо fetchedAt — щоб наступний хід спробував ще раз.
            logger.warn('[mcp] каталог недоступний, працюємо на останньому робочому', {
                url: server.url, error: e.message, ageMs: Date.now() - cached.lastGoodAt,
            });
            return cached.tools;
        }
        logger.error('[mcp] каталог недоступний і кешу немає', { url: server.url, error: e.message });
        return [];
    }
}

/**
 * Зібрати інструменти з усіх MCP-серверів ноди.
 * Повертає список у форматі Claude і мапу «назва → сервер» для виклику.
 */
async function mcpCollectTools(servers) {
    const tools = [];
    const owner = new Map();
    for (const server of servers) {
        const list = await mcpListTools(server);
        for (const t of list) {
            if (!t?.name) continue;
            if (owner.has(t.name)) {
                logger.warn('[mcp] дубль назви інструмента, лишаємо перший', { name: t.name, url: server.url });
                continue;
            }
            owner.set(t.name, server);
            tools.push({
                name: t.name,
                description: t.description || t.name,
                input_schema: t.inputSchema || t.input_schema || { type: 'object', properties: {} },
            });
        }
    }
    return { tools, owner };
}

/** Виклик інструмента через MCP. Помилку віддаємо текстом — модель має шанс виправитись. */
async function mcpCallTool(server, name, args) {
    const result = await mcpRpc(server, 'tools/call', { name, arguments: args || {} }, 30000);
    const text = Array.isArray(result?.content)
        ? result.content.map((c) => (c?.type === 'text' ? c.text : JSON.stringify(c))).join(String.fromCharCode(10))
        : JSON.stringify(result);
    return { text, isError: Boolean(result?.isError) };
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
// Назва магазину в кожному сповіщенні (воронка дублюється на різні магазини).
// Аудит 2026-08-28 (запит власника): (1) пуста лінія між назвою магазину і
// текстом самого сповіщення — раніше зливались в один рядок; (2) назва
// магазину — клікабельне посилання на Instagram-профіль (HTML parse_mode,
// усі виклики shopPrefix нижче тепер явно передають parse_mode:'HTML').
function shopPrefix(env) {
    const shop = ((env && (env.SHOP_TAG || env.SHOP_NAME)) || '').trim();
    if (!shop) return '';
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Аудит 2026-08-29 (живий кейс, goverla_shop): INSTAGRAM_USERNAME був НЕЗАПОВНЕНИМ
    // плейсхолдером "REPLACE_ME" — без цієї перевірки посилання виходило
    // https://instagram.com/REPLACE_ME. Той самий /^\d+:/ patern валідності, що й у
    // isReal() для інших ключів (тут inline, бо isReal перевіряє токени, не юзернейми).
    const _rawIgUser = ((env && env.INSTAGRAM_USERNAME) || '').trim().replace(/^@/, '');
    const igUser = (_rawIgUser && _rawIgUser.toUpperCase() !== 'REPLACE_ME') ? _rawIgUser : '';
    const label = '🏪 ' + esc(shop);
    const linked = igUser ? `<a href="https://instagram.com/${encodeURIComponent(igUser)}">${label}</a>` : label;
    return linked + '\n\n';
}

// Лог доставки у runtime (видно у вкладці «Ноди» → «Доставка повідомлень»).
// Кап 100 записів; старіші за 14 днів відсікаються — щоб context не роздувався.
function pushDelivery(runtime, channel, ok, error, extra) {
    try {
        if (!runtime) return;
        const cutoff = Date.now() - 14 * 86400000;
        const prev = (Array.isArray(runtime.deliveryLog) ? runtime.deliveryLog : [])
            .filter((e) => !e.ts || new Date(e.ts).getTime() > cutoff);
        prev.push({ ts: new Date().toISOString(), channel, ok: !!ok, ...(error ? { error: String(error).slice(0, 300) } : {}), ...(extra || {}) });
        runtime.deliveryLog = prev.slice(-100);
    } catch (_e) { /* лог не має ламати потік */ }
}

// Аудит 2026-08-28 (живий кейс, goverla_shop): клієнт попросив фото, автовідповідь
// пообіцяла "зараз надішлю" / "менеджер надішле вручну" — а valid URL фото не було,
// і БЕЗ цього виклику жодне сповіщення в Telegram не йшло: обіцянка лишалась порожньою.
// Викликається з обох гілок (основний товар / товар з допродажу), коли надіслати
// фото автоматично не вдалось — щоб менеджер реально дізнався й надіслав вручну сам.
async function notifyAdminPhotoMissing(session, ctx, funnelEnv, runtime, whatLabel) {
    try {
        // Аудит 2026-08-29 (антипатерн A6, живий кейс Сіразетдінова): ключ ВОРОНКИ
        // (група конкретного магазину) має пріоритет над системним — системний
        // ADMIN_TELEGRAM_ID часто особистий чат, і бот не може писати юзеру, який
        // йому не писав першим ("Forbidden: bot can't initiate conversation").
        const adminId = funnelEnv.ADMIN_TELEGRAM_ID || await getSystemKeyValue('ADMIN_TELEGRAM_ID');
        const tok = funnelEnv.TELEGRAM_BOT_TOKEN || '';
        if (!adminId || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(tok)) {
            pushDelivery(runtime, 'telegram_notify', false, 'немає ADMIN_TELEGRAM_ID або валідного TELEGRAM_BOT_TOKEN', { reason: 'photo_missing' });
            return;
        }
        const txt = shopPrefix(funnelEnv) + '📸 <b>Клієнт просить фото ' + whatLabel + '</b> — автоматично надіслати не вдалось (немає фото в CRM)\n\n⚠️ Бот уже пообіцяв клієнту фото — надішліть, будь ласка, вручну\n\n👤 Клієнт: ' + (ctx.senderName || '') + ' (' + (ctx.igUsername || '') + ')\n🔗 Сесія: ' + session.id;
        const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(adminId), text: txt, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(() => null);
        const j = r ? await r.json().catch(() => ({})) : {};
        pushDelivery(runtime, 'telegram_notify', !!j.ok, j.ok ? null : (j.description || 'fetch failed'), { chatId: String(adminId), reason: 'photo_missing' });
    } catch (_e) { /* сповіщення не має ламати потік */ }
}

// Аудит 2026-09-02 (Проблема 5, покращення): клієнт practically ЗАВЖДИ пересилає
// посилання на ВЛАСНИЙ пост/рілс магазину — тож ПЕРШ НІЖ будь-який скрапінг,
// пробуємо офіційний Instagram Graph API (той самий INSTAGRAM_ACCESS_TOKEN/
// INSTAGRAM_BUSINESS_ID, що вже є в funnelKey кожного бота): тягнемо ВЛАСНІ медіа
// акаунта (з пагінацією через paging.next) і шукаємо, чиє permalink містить той
// самий shortcode з лінка клієнта. Якщо знайдено — маємо caption+media_url НАПРЯМУ
// з офіційного API, БЕЗ жодного HTTP-запиту на сам instagram.com (жодного
// скрапінгу, жодної залежності від того, чи Instagram сьогодні віддає
// login-стіну). Ліміт 10 сторінок (500 медіа) — той самий паттерн, що вже
// використовує n_lookup для пагінації каталогу KeyCRM. Найновіші медіа йдуть
// першими (Graph API default order) — типовий рекламний пост/рілс знайдеться
// рано, тож зазвичай 1 запит без пагінації.
async function resolveInstagramMediaViaGraphAPI(shortcode, igBusinessId, accessToken) {
    if (!shortcode || !igBusinessId || !accessToken) return null;
    try {
        // Аудит 2026-09-02 (живий тест): токен у funnelKey має префікс "IGAA" — це
        // ІНСТАГРАМ-ТОКЕН з flow'у "Instagram API with Instagram Login" (прямий
        // бізнес-логін у сам Instagram, не через привʼязану Facebook-сторінку). Такі
        // токени ФІЗИЧНО НЕ ПРАЦЮЮТЬ на graph.facebook.com (перевірено: HTTP 400
        // "Cannot parse access token" на ОБОХ ботах, однаково) — обов'язково
        // graph.instagram.com. Підтверджено живим запитом: HTTP 200 з реальними
        // медіа на цьому хості для обох акаунтів.
        let url = 'https://graph.instagram.com/v18.0/' + encodeURIComponent(igBusinessId)
            + '/media?fields=id,caption,permalink,media_url,thumbnail_url,media_type&limit=50&access_token=' + encodeURIComponent(accessToken);
        for (let page = 0; page < 10 && url; page++) {
            const r = await fetch(url);
            if (!r.ok) break;
            const j = await r.json().catch(() => ({}));
            const items = Array.isArray(j.data) ? j.data : [];
            for (const it of items) {
                if (it && it.permalink && String(it.permalink).indexOf(shortcode) >= 0) {
                    const isVideo = String(it.media_type || '').toUpperCase() === 'VIDEO';
                    const imgUrl = isVideo ? (it.thumbnail_url || it.media_url || '') : (it.media_url || it.thumbnail_url || '');
                    return { caption: it.caption || null, url: imgUrl || null };
                }
            }
            url = (j.paging && j.paging.next) || null;
        }
        return null;
    } catch (_e) {
        return null;
    }
}

// Аудит 2026-09-01 (Проблема 5, живий кейс): клієнт кидає СИРИЙ текстовий лінк
// instagram.com/reel|p|tv/<code> (звичайний текст, НЕ пересланий пост-attachment).
// Instagram Graph oEmbed вимагає окремого дозволу від Meta ("oEmbed Read"), якого в
// нас немає (перевірено: без токена ендпоінт віддає лише порожній embed-віджет без
// прямого URL картинки/підпису) — але ПУБЛІЧНА html-сторінка посту/рілса (без
// авторизації) містить <meta property="og:image"> з реальним прев'ю на
// cdninstagram.com. Підтверджено живим запитом із продакшн-сервера — але Instagram
// НЕПОСЛІДОВНО віддає login-стіну замість цього прев'ю (rate-limit/fingerprint по
// IP, підтверджено: 1 успіх, потім кілька невдач поспіль з тієї самої точки).
// Тому це ТІЛЬКИ резервний шлях (Пріоритет 2) — Graph API вище (Пріоритет 1)
// покриває переважну більшість реальних кейсів (власний пост магазину) надійно.
// Повертає URL картинки (уже в тому самому форматі, що й sharedPost.url для
// СПРАВЖНЬОГО пересланого поста, host — у тому ж allowlist, що й Gemini vision у
// n_lookup) або null, якщо не вдалось — best-effort, ніколи не кидає.
async function resolveInstagramLinkPreview(kind, shortcode) {
    if (!shortcode) return null;
    const path = kind === 'reel' ? 'reel' : 'p';
    const url = 'https://www.instagram.com/' + path + '/' + encodeURIComponent(shortcode) + '/';
    const ac = new AbortController();
    const to = setTimeout(() => { try { ac.abort(); } catch (_e) { /* noop */ } }, 8000);
    try {
        const r = await fetch(url, {
            signal: ac.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
        });
        if (!r.ok) return null;
        const html = await r.text();
        const m = html.match(/<meta property="og:image" content="([^"]+)"/i);
        if (!m) return null;
        const imgUrl = m[1].replace(/&amp;/g, '&');
        const h = new URL(imgUrl).hostname.toLowerCase();
        const allowed = ['cdninstagram.com', 'fbcdn.net', 'fbsbx.com'];
        if (!allowed.some((d) => h === d || h.endsWith('.' + d))) return null;
        return imgUrl;
    } catch (_e) {
        return null;
    } finally {
        clearTimeout(to);
    }
}

// Аудит 2026-09-01 (Проблема В, живий кейс: ibanoplata create_invoice віддав 403,
// context.ibanPayUrl лишився порожнім — а НАСТУПНЕ статичне повідомлення (n_requisites)
// все одно казало "оплатіть за посиланням... 👇" з порожнім рядком замість лінка,
// клієнт: "Не бачу посилання"). Той самий системний принцип, що й notifyAdminPhotoMissing
// (не обіцяти те, чого немає / централізована ескалація при порожньому значенні), просто
// для платіжного посилання, а не фото.
async function notifyAdminPaymentLinkMissing(session, ctx, funnelEnv, runtime, whatLabel) {
    try {
        const adminId = funnelEnv.ADMIN_TELEGRAM_ID || await getSystemKeyValue('ADMIN_TELEGRAM_ID');
        const tok = funnelEnv.TELEGRAM_BOT_TOKEN || '';
        if (!adminId || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(tok)) {
            pushDelivery(runtime, 'telegram_notify', false, 'немає ADMIN_TELEGRAM_ID або валідного TELEGRAM_BOT_TOKEN', { reason: 'payment_link_missing' });
            return;
        }
        const txt = shopPrefix(funnelEnv) + '💳 <b>Не вдалось згенерувати ' + whatLabel + '</b>\n\n⚠️ Перевірте, чи клієнт оплатив за реквізитами; за потреби надішліть посилання вручну\n\n👤 Клієнт: ' + (ctx.senderName || '') + ' — https://instagram.com/' + (ctx.igUsername || '') + '\n🧾 Замовлення: ' + (ctx.orderRef || '—') + ' | сума ' + (ctx.payAmount != null ? ctx.payAmount + ' грн' : '—') + '\n🔗 Сесія: ' + session.id;
        const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(adminId), text: txt, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(() => null);
        const j = r ? await r.json().catch(() => ({})) : {};
        pushDelivery(runtime, 'telegram_notify', !!j.ok, j.ok ? null : (j.description || 'fetch failed'), { chatId: String(adminId), reason: 'payment_link_missing' });
    } catch (_e) { /* сповіщення не має ламати потік */ }
}

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

    // Sonnet (2026-09-04) відкриває блок як ```json_output — приймаємо будь-яку json-мітку.
    const fencedMatch = raw.match(/```(?:json[\w-]*)?\s*([\s\S]*?)\s*```/i);
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
    // Мітка відкритого блоку перед JSON ("```json_output") не має долетіти до клієнта.
    return responseText.slice(0, jsonStart).replace(/```[\w-]*\s*$/, '').trim();
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
    // Порожній content дозволений, ЯКЩО є attachment (фото без підпису) —
    // інакше sendPhoto/wantsPhoto з пустим caption тихо губили повідомлення.
    if (!content && !(metadata && metadata.attachment)) return;
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

    // Повторний клієнт (ідея користувача 2026-08-27): якщо в ЦІЙ воронці підключена
    // нода n_recall_cond, одноразово за сесію підтягуємо зріст/вагу і дані доставки
    // з ОСТАННЬОГО завершеного замовлення цього ж клієнта в ЦІЙ ЖЕ воронці — щоб не
    // питати спочатку, а лише запропонувати підтвердити чи скоригувати. Рахуємо ще
    // ДО циклу по нодах (не всередині n_lookup чи іншої JS-ноди — ті не мають доступу
    // до БД), щоб дані вже були готові, коли граф дійде до n_recall_cond у ЦЬОМУ Ж
    // виклику (нода n_lookup і n_recall_cond можуть виконатись в одному кроці, без
    // очікування наступного повідомлення користувача). Гейт на flow.nodes.some(...) —
    // щоб не бити базу зайвим запитом на воронках, де фіча не підключена.
    if (!ctx.returningCustomerChecked && !ctx.crmOrderId && session.userId && flow.nodes.some((n) => n.id === 'n_recall_cond')) {
        ctx.returningCustomerChecked = true;
        try {
            const _prevSessions = await db.session.findMany({
                where: { userId: session.userId, botId: session.botId, id: { not: session.id } },
                orderBy: { startedAt: 'desc' },
                take: 20,
                select: { context: true },
            });
            const _prev = _prevSessions.find((s) => s.context && s.context.crmOrderId);
            if (_prev) {
                const _od = _prev.context.orderData || {};
                const _si = _prev.context.sizeInput || {};
                const _recall = {};
                if (_od.fullName) _recall.fullName = _od.fullName;
                if (_od.phone) _recall.phone = _od.phone;
                if (_od.city) _recall.city = _od.city;
                if (_od.branch) _recall.branch = _od.branch;
                if (_si.height) _recall.height = _si.height;
                if (_si.weight) _recall.weight = _si.weight;
                if (Object.keys(_recall).length) ctx.returningCustomerData = _recall;
            }
        } catch (_e) { /* recall — не критично для замовлення, тихо ігноруємо помилку */ }
    }

    // Аудит 2026-09-01 (Проблема 5, живий кейс): клієнт кидає СИРИЙ текстовий лінк
    // на instagram.com/reel|p/... (звичайний текст, не пересланий пост-attachment).
    // Ні n_signal_check/n_prev_match_snapshot (нодовий regex "є ознака товару"), ні
    // "перемикання товару посеред консультації" нижче не бачили сирий URL як сигнал
    // — сесія лишалась застряглою в поточній консультаційній claude-ноді, яка
    // імпровізувала без жодних даних (звідси суперечливе "не можу відкрити, але вже
    // сканую" і вгадування зі старого товару в контексті). Резолвимо ДО всіх
    // перевірок нижче: якщо в тексті є сирий IG-лінк — витягуємо og:image з
    // публічної сторінки поста (без токена) і кладемо як звичайний ctx.sharedPost —
    // той самий формат, що й для СПРАВЖНЬОГО пересланого поста (zernioHandler.js),
    // тож увесь подальший конвеєр (n_signal_check → n_lookup Gemini vision →
    // "перемикання товару" нижче, яке звіряє sharedPost.mediaId) працює БЕЗ ЗМІН.
    let _hasRawIgLink = false;
    if (incomingUserMessage) {
        const _igm = String(incomingUserMessage).match(/instagram\.com\/(reel|p|tv)\/([A-Za-z0-9_-]+)/i);
        if (_igm) {
            _hasRawIgLink = true;
            try {
                // Пріоритет 1 (аудит 2026-09-02): офіційний Graph API — власні медіа
                // магазину, без жодного скрапінгу. funnelEnv тут ще НЕ побудований
                // (рахується нижче за ходом функції) — читаємо ці 2 ключі напряму,
                // окремим легким запитом (той самий підхід, що вже є в
                // handleCommentReceived, zernioHandler.js).
                const _igKeyRows = await db.funnelKey.findMany({
                    where: { botId: session.botId, key: { in: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_BUSINESS_ID'] } },
                    select: { key: true, value: true },
                }).catch(() => []);
                const _igKeys = Object.fromEntries((_igKeyRows || []).map((k) => [k.key, k.value]));
                const _igToken = (_igKeys.INSTAGRAM_ACCESS_TOKEN || '').trim();
                const _igBiz = (_igKeys.INSTAGRAM_BUSINESS_ID || '').trim();
                let _graphHit = null;
                if (_igToken && _igToken !== 'REPLACE_ME' && _igBiz && _igBiz !== 'REPLACE_ME') {
                    _graphHit = await resolveInstagramMediaViaGraphAPI(_igm[2], _igBiz, _igToken);
                }
                if (_graphHit && _graphHit.url) {
                    ctx.sharedPost = { kind: _igm[1] === 'reel' ? 'reel' : 'post', mediaId: _igm[2], caption: _graphHit.caption || null, url: _graphHit.url, _fromRawLink: true, _via: 'graph_api' };
                } else {
                    // Пріоритет 2: og:image скрапінг (чуже медіа, або Graph API не знайшов
                    // серед власних — не наш пост, або медіа старше вікна пагінації).
                    const _resolvedImg = await resolveInstagramLinkPreview(_igm[1], _igm[2]);
                    if (_resolvedImg) {
                        ctx.sharedPost = { kind: _igm[1] === 'reel' ? 'reel' : 'post', mediaId: _igm[2], caption: null, url: _resolvedImg, _fromRawLink: true, _via: 'scrape' };
                    }
                }
            } catch (_e) { /* best-effort — сирий лінк не має ламати обробку повідомлення */ }
        }
    }

    // Бот замовк, бо не визначив товар. Якщо клієнт САМ прислав товар (рілс/пост/реклама
    // або артикул у тексті) — це нова спроба, відновлюємось і шукаємо товар знову.
    // Явне прохання менеджера (handoffKind !== 'product_unknown') так НЕ знімається.
    //
    // Аудит 2026-08-27 (goverla_shop, Сіразетдінов): раніше цей чек спрацьовував
    // ТІЛЬКИ коли ctx.adminEngaged вже true — але "прохання про товар" (ask-нода,
    // напр. n_unknown_msg, mode:single) саме й з'їдає ПЕРШЕ повідомлення з новим
    // товаром на повторення канкан-фрази, і лише пауза вмикається ПІСЛЯ неї. Клієнту
    // доводилось писати артикул ДВІЧІ: раз щоб "розбудити" паузу, ще раз щоб вона
    // підхопилась. Тепер той самий чек спрацьовує і коли currentNodeId стоїть на
    // ноді з міткою data.productUnknownAsk===true — незалежно від того, встигла
    // пауза формально увімкнутись, чи ще ні. Мітка — узагальнений, не hardcoded під
    // конкретний бот прапорець: будь-яка воронка може позначити ним свою
    // "запитати про товар" ноду, щоб отримати той самий одноразовий re-check.
    const _currentNode = runtime.currentNodeId ? nodesById.get(runtime.currentNodeId) : null;
    const _isProductAskNode = Boolean(_currentNode?.data?.productUnknownAsk);
    if ((ctx.adminEngaged && ctx.handoffKind === 'product_unknown' && !ctx.funnelPaused) || _isProductAskNode) {
        // Аудит 2026-08-27 (реплей "найскладніших" реальних діалогів goverla_shop):
        // голий '\b\d{4,8}\b' у попередній версії цього регексу хибно спрацьовував на
        // ПОШТОВИЙ ІНДЕКС ("08137"), ЦІНУ ("1279 грн"), номер відділення тощо — будь-яке
        // окреме 4-8-значне число в звичайній розмові. Це скидало currentNodeId на
        // start_1 на КОЖНЕ таке повідомлення (адреса доставки, ціна, індекс), створюючи
        // нескінченний цикл "скинули → знову не визначили товар → знову питаємо".
        // Прибрано: голий номер БЕЗ ключового слова/букви більше не рахується ознакою
        // товару — тільки явний "артикул/арт/код/sku/№ <число>" або буквено-цифровий
        // код (A0165). Втрата: клієнт, що назве "5931" без слова "артикул" у відповідь
        // на паузу, не підхопиться автоматично — прийнятний компроміс проти
        // хибних спрацювань на кожній адресі/ціні.
        const _hasProductSignal = Boolean(ctx.sharedPost && ctx.sharedPost.caption)
            || Boolean(ctx.entryAd || ctx.entryAdId || ctx.postId)
            || _hasRawIgLink
            || /(?:артикул|арт\.?|код|sku|№)\s*[:#№.-]?\s*[A-Za-zА-Яа-я]{0,5}\d{2,8}|\b[A-Za-z]\d{3,6}\b/i.test(String(incomingUserMessage || ''));
        if (_hasProductSignal) {
            ctx.adminEngaged = false;
            delete ctx.handoffKind;
            delete ctx.handoffReason;
            const _startNode = flow.nodes.find((n) => n.type === 'start') || flow.nodes[0];
            if (_startNode) { runtime.currentNodeId = _startNode.id; runtime.waitingForUser = false; }
        }
    }

    // Загальне відновлення після БУДЬ-ЯКОГО автоматичного хендофу (не лише
    // product_unknown вище) — аудит 2026-08-29, живий кейс Сіразетдінова.
    // adminEngaged тут — АВТОМАТИЧНЕ рішення системи (ключове слово / низька
    // впевненість claude-ноди), а НЕ ручна дія адміна (те — funnelPaused,
    // окремий прапорець, який ЦЕЙ блок НЕ чіпає — ручна пауза лишається
    // повною тишею, доки людина сама не увімкне бота назад).
    // Раніше: якщо клієнта автоматично ескалували (напр. невизначене "Що
    // далі??"), а сповіщення менеджеру не дійшло (підтверджено: "Forbidden:
    // bot can't initiate conversation with a user" — окремо виправлено вище)
    // АБО менеджер просто не встиг відповісти — клієнт лишався в АБСОЛЮТНІЙ
    // тиші НАЗАВЖДИ: жодне наступне повідомлення (навіть за день) не отримувало
    // жодної реакції. Тепер: перше ж наступне повідомлення клієнта, поки він
    // чекає менеджера, — (а) ще раз сповіщає менеджера, що клієнт продовжує
    // писати, і (б) знімає adminEngaged із ЦЬОГО ходу, щоб уся звичайна
    // обробка нижче (в т.ч. перемикання товару, n_route тощо) відпрацювала як
    // для щойно активного клієнта — жодної permanentної мовчанки.
    // Аудит 2026-09-04: пауза product_unknown — це НЕ "клієнт чекає менеджера": йому сказали
    // "покажіть товар", а не "зачекайте". Тому без "перепрошуємо за очікування" і без
    // повторного алерту (n_unknown_admin і так шле раз на сесію) — тихо знімаємо паузу,
    // далі звичайний шлях зі старту (n_unknown_msg перепитає товар ще раз).
    if (ctx.adminEngaged && !ctx.funnelPaused && ctx.handoffKind === 'product_unknown' && (incomingUserMessage || incomingImageUrl)) {
        ctx.adminEngaged = false;
        delete ctx.handoffKind;
        delete ctx.handoffReason;
    }
    if (ctx.adminEngaged && !ctx.funnelPaused && (incomingUserMessage || incomingImageUrl)) {
        ctx.adminEngaged = false;
        delete ctx.handoffKind;
        delete ctx.handoffReason;
        try {
            const _admin = funnelEnv.ADMIN_TELEGRAM_ID || await getSystemKeyValue('ADMIN_TELEGRAM_ID');
            const _tok = funnelEnv.TELEGRAM_BOT_TOKEN || '';
            if (_admin && /^\d+:[A-Za-z0-9_-]{20,}$/.test(_tok) && !ctx.testMode) {
                const _txt = shopPrefix(funnelEnv) + '↩️ <b>Клієнт написав ще раз, поки чекав на менеджера</b> — бот автоматично відновив роботу\n\n👤 Клієнт: ' + (ctx.senderName || '') + ' (' + (ctx.igUsername || '') + ')\n💬 Повідомлення: «' + String(incomingUserMessage || '[фото]').slice(0, 160) + '»\n\n🔗 Сесія: ' + session.id;
                const _r = await fetch('https://api.telegram.org/bot' + _tok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(_admin), text: _txt, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(() => null);
                const _j = _r ? await _r.json().catch(() => ({})) : {};
                pushDelivery(runtime, 'telegram_notify', !!_j.ok, _j.ok ? null : (_j.description || 'fetch failed'), { chatId: String(_admin), reason: 'handoff_auto_resume' });
            } else {
                pushDelivery(runtime, 'telegram_notify', false, 'немає ADMIN_TELEGRAM_ID або валідного TELEGRAM_BOT_TOKEN', { reason: 'handoff_auto_resume' });
            }
        } catch (_e) { /* сповіщення не має ламати відновлення */ }
        await persistAssistantMessage(session.id, '⚙️ Перепрошуємо за очікування! Я знову тут і можу продовжити допомагати 🙂', { source: 'handoff_auto_resume' });
        // Свідомо БЕЗ return — звичайна обробка ЦЬОГО ж повідомлення триває далі
        // нижче (перемикання товару, n_route тощо), а не чекає ще одного ходу.

        // Аудит 2026-09-03 (термінальна ескалація, живий кейс власника — розмір поза
        // сіткою/провал створення замовлення в CRM): термінальні "стоп"-ноди (напр.
        // n_size_oor_stop, n_crm_order_failed_stop) — свідомі глухі кути БЕЗ жодного
        // вихідного ребра (return {adminEngaged:true}, і все) — тому runtime.currentNodeId
        // після них лишається null. Далі за замовчуванням (нижче в цій-таки функції)
        // null currentNodeId падає на СТАРТОВУ ноду воронки. Для goverla_shop/covercar_ua
        // це випадково потрапляє на n_returning_check (бо n_signal_cond враховує вже
        // відомий ctx.product) — але це НЕГАРАНТОВАНО для будь-якого графа воронки і
        // ламке при майбутніх правках (напр. якщо хтось посилить regex n_signal_check,
        // прибере n_signal_cond, чи додасть нову _stop-ноду без цього шляху) — бот
        // знову зустрічав би клієнта "з нуля", а не контекстним поверненням. Явно
        // ведемо на n_prev_match_snapshot (НЕ одразу на n_returning_check!) — та сама
        // js-нода, що ЗАВЖДИ перераховує context.hasFreshSignalThisTurn з нуля ПЕРЕД
        // n_returning_check. Живий тест підтвердив: стрибок ОДРАЗУ на n_returning_check
        // ламався — hasFreshSignalThisTurn лишався зі СТАРОГО значення (виставленого
        // ще як клієнт ВПЕРШЕ назвав артикул товару, задовго до ескалації) і НІКОЛИ
        // не скидався, тож n_returning_check помилково йшов у "have_product" (повна
        // презентація+допродаж в один хід) замість м'якого "З поверненням!". Через
        // n_prev_match_snapshot той самий n_lookup (зберігає товар, є сигналу нема) і
        // n_returning_check отримують СВІЖЕ значення — саме так, як і за звичайним
        // "поверни на start" шляхом, тільки явно й не завʼязано на випадкову форму графа.
        // Якщо товару в контексті ще нема (ескалація сталась ДО того, як товар
        // визначили) — навмисно НЕ чіпаємо: нижче спрацює звичайний шлях через start
        // (n_unknown_msg — коректно перепитає товар, тут "повертатись" нема куди).
        if (!runtime.currentNodeId && ctx.product && ctx.product.name) {
            const _resumeNode = flow.nodes.find((n) => n.id === 'n_prev_match_snapshot')
                || flow.nodes.find((n) => n.id === 'n_returning_check');
            if (_resumeNode) {
                runtime.currentNodeId = _resumeNode.id;
                runtime.waitingForUser = false;
            }
        }
    }

    // Перемикання товару ПОСЕРЕД консультації (не тільки на етапі "товар невідомий").
    // Аудит 2026-08-27 (реплей реальних діалогів, сесія Сіразетдінова): клієнт вже
    // отримав консультацію по товару А (лофери 5931), потім переслав пост/рілс з
    // ІНШИМ товаром Б (бомбер A0165) — жодна з консультаційних діалог-нод (n_color/
    // n_order_intent/тощо) не вміє повторно викликати n_lookup, тому ШІ або вигадує
    // альтернативу, або чесно каже "немає в каталозі", хоча товар Б РЕАЛЬНО є.
    // Генерично (не hardcoded під конкретну воронку): якщо в поточному повідомленні
    // є артикуло-подібний токен, який НЕ збігається з жодним відомим ідентифікатором
    // УЖЕ визначеного context.product — це нова спроба, скидаємось на старт, щоб
    // n_lookup підхопив НОВИЙ товар. Не чіпаємо сесії з уже підтвердженим замовленням
    // (crmOrderId) і не заважаємо активному хендофу (adminEngaged) — тільки коли бот
    // сам ще консультує.
    // Аудит 2026-08-28 (живий кейс, тестер matsukoleksandr — повторний коментар не
    // отримав публічної відповіді): handleCommentReceived (zernioHandler.js) явно
    // ставить runtime.currentNodeId='n_comment_entry' ПЕРЕД викликом цього кроку —
    // але executeFlowStep запускається із incomingUserMessage=ТЕКСТ КОМЕНТАРЯ (та сама
    // debounce-функція, що й для DM), тож якщо коментар був під ІНШИМ постом, ніж
    // раніше визначений ctx.product, ЦЯ перевірка бачила "новий товар" і скидала
    // currentNodeId на start_1 — n_comment_entry так і НЕ запускався, публічна
    // відповідь не постилась, а замість цього одразу йшов повний DM-каскад
    // (start->n_route->n_lookup->n_welcome->...), ніби це звичайне повідомлення в
    // директ. Явний маршрут від виклику (n_comment_entry) МАЄ пріоритет — не
    // перебиваємо його цією евристикою.
    // Аудит 2026-09-02 (CRM-клони goverla/covercar): цю евристику писали, коли єдиним
    // джерелом товару був KeyCRM (_source==='keycrm'). Нова СРМ віддає _source==='crm' —
    // без цього уточнення "клієнт назвав інший товар" мовчки НЕ спрацьовувало на клонах,
    // товар залишався "застряглим" на першому визначеному.
    // v9 (тест Олексія 2026-09-06 15:17): ПІСЛЯ оформленого замовлення (crmOrderId є) клієнт переслав рілс іншого
    // товару (F0029, A0165) — раніше `!ctx.crmOrderId` блокував перемикання, бот показував старий костюм і слав
    // «уточню в менеджера». Тепер новий товар після покупки = нове замовлення: товар перемикається тут,
    // а n_order_prefill архівує попереднє замовлення (prevOrder) перед створенням нового. Фото після
    // замовлення й далі НЕ перемикає (це квитанція — гард !ctx.orderRef нижче).
    if (ctx.product && (ctx.product._source === 'keycrm' || ctx.product._source === 'crm') && !ctx.adminEngaged
        && runtime.currentNodeId !== 'n_comment_entry' && (incomingUserMessage || incomingImageUrl)) {
        const _extractArticleCandidates = (txt) => {
            const out = [];
            const re1 = /(?:артикул|арт\.?|код|sku|№)\s*[:#№.-]?\s*([A-Za-zА-Яа-я]{0,5}\d{2,8})/gi;
            const re2 = /\b([A-Za-z]\d{3,6})\b/g;
            let m;
            while ((m = re1.exec(txt))) out.push(m[1].toUpperCase());
            while ((m = re2.exec(txt))) out.push(m[1].toUpperCase());
            return out;
        };
        const _candidates = _extractArticleCandidates(String(incomingUserMessage));
        let _isDifferentProduct = false;
        if (_candidates.length) {
            const _known = new Set();
            if (ctx.product.supplierArticle) _known.add(String(ctx.product.supplierArticle).toUpperCase());
            if (ctx.product._matchKey && String(ctx.product._matchKey).startsWith('art_')) {
                _known.add(String(ctx.product._matchKey).slice(4).toUpperCase());
            }
            (Array.isArray(ctx.product.offers) ? ctx.product.offers : []).forEach((o) => {
                if (o && o.sku) _known.add(String(o.sku).toUpperCase());
            });
            _isDifferentProduct = _candidates.some((c) => !_known.has(c));
        }
        // Аудит 2026-08-27 (питання користувача "чи воронка спочатку зависає, якщо
        // людина за деякий час/наступного дня кидає новий товар"): підтверджено живим
        // прогоном — старий/призупинений діалог ЧАСТО не містить артикулу в тексті
        // взагалі (клієнт просто ПЕРЕСИЛАЄ новий пост/рілс без підпису чи з описовим
        // текстом типу "хочу такий бомбер"), тож перевірка вище нічого не ловила і
        // застрягла нода (напр. n_collect з учорашньої адреси) намагалась "консультувати"
        // по НОВОМУ товару, тримаючи в контексті СТАРИЙ product/currentNode — видима
        // клієнту відповідь виглядала правдоподібно, але воронка фактично не зрушила з
        // місця. Тепер додатково звіряємо: чи з'явився НОВИЙ sharedPost/entryAd,
        // якого не було при визначенні ПОТОЧНОГО ctx.product (стемпиться в n_lookup —
        // _matchedSharedPostId/_matchedEntryAd). Спрацьовує незалежно від часу, що минув
        // між повідомленнями — сесія в БД не має TTL і завжди підхоплюється повторно.
        if (!_isDifferentProduct) {
            const _newSharedPostId = ctx.sharedPost && ctx.sharedPost.mediaId ? String(ctx.sharedPost.mediaId) : '';
            const _newEntryAd = String(ctx.entryAd || ctx.entryAdId || '');
            const _matchedPostId = String(ctx.product._matchedSharedPostId || '');
            const _matchedEntryAd = String(ctx.product._matchedEntryAd || '');
            if (_newSharedPostId && _newSharedPostId !== _matchedPostId) _isDifferentProduct = true;
            else if (_newEntryAd && _newEntryAd !== _matchedEntryAd) _isDifferentProduct = true;
        }
        // Скріншот товару замість поста/рілса (те саме питання користувача, "чи
        // скоіншот" теж збиває воронку): на цьому кроці замовлення ще НЕ підтверджене
        // (crmOrderId нема), тому щойно надіслане фото — майже напевно спроба показати
        // ІНШИЙ товар, а не квитанція (той самий принцип, що вже діє у ПРІОРІТЕТІ 2.9
        // n_lookup). Скидаємось на старт і даємо n_lookup самому розпізнати фото через
        // Gemini vision; якщо не впізнає — чесно попросить пост/артикул, це краще, ніж
        // застрягла нода плутано питає адресу/розмір по фото невідомо чого.
        //
        // Проблема Г (аудит 2026-09-01, живий кейс): це припущення НЕПРАВИЛЬНЕ, щойно
        // клієнт вже в процесі оформлення — orderRef (і, як наслідок, reqisites/
        // ibanPayUrl) виставляється у n_iban_invoice РАНІШЕ, ніж crmOrderId (той
        // з'являється лише ПІСЛЯ підтвердженої оплати). Клієнт, який отримав реквізити
        // й номер платежу та надсилає СКРІНШОТ КВИТАНЦІЇ, потрапляв саме в це вікно
        // (crmOrderId ще нема, orderRef вже є) — фото трактувалось як "новий товар",
        // весь контекст замовлення стирався, і бот скидав до "який товар вас цікавить?"
        // повністю втрачаючи активне замовлення. orderRef — надійніший сигнал "клієнт
        // вже в чекауті" (виставляється одразу при переході до оплати), тому фото на
        // цьому етапі більше НЕ трактуємо як новий товар — його підхопить звірка оплати
        // (n_reconcile: context.lastReceiptImageUrl → Gemini vision квитанції).
        // Реальні кейси goverla 2026-09-04: клієнт посеред підбору розміру/кольору шле фото СВОЄЇ куртки
        // ("це куртка, яка мені норм", "вони однакові??") — скидати товар і шукати "новий" по фото тут
        // хибно. Ноди з data.keepProductOnImage===true (n_size/n_color/n_set_choice) тримають товар;
        // фото йде моделі як "[фото]", а змінити товар клієнт може постом/артикулом.
        const _curNodeForImage = runtime.currentNodeId ? nodesById.get(runtime.currentNodeId) : null;
        const _keepOnImage = Boolean(_curNodeForImage && _curNodeForImage.data && _curNodeForImage.data.keepProductOnImage === true);
        if (!_isDifferentProduct && incomingImageUrl && !ctx.orderRef && !_keepOnImage) {
            _isDifferentProduct = true;
        }
        // v8.1 (прогін 2026-09-06, «і ще хочу кофту A0187 до цього ж замовлення» на кроці «Оформляємо?»):
        // на нодах чекауту з data.lockProduct===true (n_order_intent/n_pay_collect/n_collect) інший
        // артикул/пост НЕ перемикає товар і не стирає замовлення — інакше костюм мовчки замінювався на
        // кофту, а бот обіцяв «спільне замовлення», якого система не створить. Натомість позначаємо
        // context.extraProductMention — промпт ноди пояснює, що другий товар додасть менеджер у ту ж посилку.
        const _lockNode = runtime.currentNodeId ? nodesById.get(runtime.currentNodeId) : null;
        if (_isDifferentProduct && _lockNode && _lockNode.data && _lockNode.data.lockProduct === true) {
            ctx.extraProductMention = _candidates.length ? _candidates.join(', ') : (incomingImageUrl ? 'фото' : 'пост/рілс');
            _isDifferentProduct = false;
        }
        if (_isDifferentProduct) {
            delete ctx.product;
            delete ctx.colorChoice;
            delete ctx.recommendedSize;
            delete ctx.sizeInput;
            delete ctx.sizeOutOfRange;
            delete ctx.available;
            delete ctx.orderIntent;
            const _startNode = flow.nodes.find((n) => n.type === 'start') || flow.nodes[0];
            if (_startNode) {
                runtime.currentNodeId = _startNode.id;
                runtime.waitingForUser = false;
                runtime.dialogHistory = {};
            }
        }
    }

    // Проблема Г (аудит 2026-09-01, живий кейс, доповнення до фіксу вище): клієнт міг
    // надіслати квитанцію, коли виконання вже "застрягло" десь ПІСЛЯ n_requisites
    // (напр. чекає уточнення адреси), а не точно на кроці звірки оплати. Той самий
    // патерн, що вже є для "перемикання товару" й "автовідновлення після хендофу" —
    // явно перенаправляємо на n_mono_fetch, щоб звірка оплати (n_reconcile: Gemini
    // vision квитанції за context.lastReceiptImageUrl) реально відпрацювала для
    // ЦЬОГО фото, а не загубилась у консультаційній ноді, яка про квитанції нічого
    // не знає (звідси "Вибачте, я не можу переглядати фото... Який товар цікавить?").
    // 2026-09-05 (тест Олексія: чек надіслано ПІСЛЯ створення замовлення → потрапляв у n_upsell2_wait і
    // ніколи не звірявся; замовлення лишалось неоплаченим, у CRM платежу нема): звірку запускаємо і після
    // створення замовлення — на фото або на явне "оплатив/переказав", доки payStatus не confirmed.
    const _claimsPaid = /оплатив|оплатила|заплатив|заплатила|переказав|переказала|скинув чек|скинула чек|оплата пройшла|гроші (пішли|відправив|відправила)|paid/i.test(String(incomingUserMessage || ''));
    if (ctx.orderRef && ctx.payStatus !== 'confirmed' && (incomingImageUrl || (_claimsPaid && ctx.crmOrderId)) && !ctx.adminEngaged && !ctx.funnelPaused) {
        const _monoNode = flow.nodes.find((n) => n.id === 'n_mono_fetch');
        if (_monoNode && runtime.currentNodeId !== 'n_mono_fetch' && runtime.currentNodeId !== 'n_reconcile') {
            runtime.currentNodeId = 'n_mono_fetch';
            runtime.waitingForUser = false;
        }
    }

    // Оператор перехопив діалог (handoff) — бот мовчить, доки прапорець не знято.
    // Це страхує канали, які не мають власного гарду (тести, інші хендлери).
    if (ctx.adminEngaged || ctx.funnelPaused) {
        return { session, botResponse: null, flowDriven: false, paused: true };
    }

    // Повернення/обмін товару — детермінований детект (аудит 2026-08-28, запит
    // власника). Раніше "поверн"/"обмін" потрапляли під ЗАГАЛЬНИЙ "хочу менеджера"
    // хендоф — бот ПОВНІСТЮ зупинявся (adminEngaged), хоча запит на повернення не
    // повинен блокувати подальшу консультацію (в т.ч. з цим самим клієнтом — може,
    // він хоче ще щось замовити). Тепер: сповіщаємо менеджера, тепло відповідаємо —
    // і adminEngaged/funnelPaused НЕ виставляємо, тож НАСТУПНЕ повідомлення клієнта
    // бот обробить як завжди.
    // Аудит 2026-08-28 (живий тест-прогін): якщо просто "не return" і дати обробці
    // йти далі — ЦЕ Ж повідомлення потрапляло ЩЕ РАЗ у активну claude-ноду діалогу
    // (напр. n_order_intent чекав "Так/Ні" на допродаж) — модель бачила
    // "Хочу повернути товар" як питання поза її зоною і САМА повертала
    // {"handoff":true}, ставлячи adminEngaged=true — бот усе одно зупинявся,
    // тільки з двома суперечливими повідомленнями замість одного. Тепер —
    // явний return одразу після відповіді: цей конкретний хід завершено, але БЕЗ
    // прапорця паузи, тож бот лишається "живим" для наступного повідомлення.
    // Аудит 2026-09-04: ДО замовлення "чи є повернення?" — звичайне передпродажне питання,
    // на яке має відповідати діалогова нода (KB/промпт), а не "передала запит менеджеру".
    // Широкий regex лишаємо лише для сесій із оформленим замовленням; інакше — тільки
    // явний намір ("хочу повернути", "поверніть гроші", "обміняти товар").
    const _returnRe = ctx.crmOrderId
        ? /поверн(ення|ути|іть)|обмін(яти|яю)?|обмен/i
        : /хочу\s+(поверну|обміня|вернут)|поверн(ути|іть)\s+(товар|гроші|кошти|замовлення|посилку)|обміня(ти|ю)\s+(товар|розмір|на\s)|вернуть\s+(товар|деньги)/i;
    if (incomingUserMessage && !ctx.returnHandledAt && _returnRe.test(String(incomingUserMessage))) {
        ctx.returnHandledAt = new Date().toISOString();
        const retMsg = 'Звичайно, допоможемо! 🙂 Передала ваш запит на повернення/обмін менеджеру — він зв\'яжеться з деталями найближчим часом. Якщо тим часом є ще питання — я тут 💛';
        await persistAssistantMessage(session.id, retMsg, { source: 'return_keyword' });
        try {
            const _env = Object.fromEntries((await db.funnelKey.findMany({ where: { botId: session.botId }, select: { key: true, value: true } })).map((k) => [k.key, k.value]));
            const _admin = _env.ADMIN_TELEGRAM_ID || '';
            const _tok = _env.TELEGRAM_BOT_TOKEN || '';
            if (_admin && /^\d+:[A-Za-z0-9_-]{20,}$/.test(_tok) && !ctx.testMode) {
                const _txt = shopPrefix(_env) + '↩️ <b>Клієнт просить повернення/обмін товару</b>\n\n👤 Клієнт: ' + (ctx.senderName || '') + ' (' + (ctx.igUsername || '') + ')\n💬 Повідомлення: «' + String(incomingUserMessage).slice(0, 160) + '»\n\n🔗 Сесія: ' + session.id;
                const _r = await fetch('https://api.telegram.org/bot' + _tok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(_admin), text: _txt, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(() => null);
                const _j = _r ? await _r.json().catch(() => ({})) : {};
                pushDelivery(runtime, 'telegram_notify', !!_j.ok, _j.ok ? null : (_j.description || 'fetch failed'), { chatId: String(_admin), reason: 'return_keyword' });
            }
        } catch (_e) { /* сповіщення не має ламати потік */ }
        await db.session.update({ where: { id: session.id }, data: { context: { ...ctx, flowRuntime: runtime } } }).catch(() => {});
        return { session, botResponse: retMsg, flowDriven: true, handoff: false };
    }

    // Явне прохання живої людини — детермінований детект (не покладаємось лише на LLM).
    // Не спрацьовує, якщо замовлення вже оформлене (там веде інший сценарій).
    // Аудит 2026-09-04: regex розділено на HARD (явне прохання людини, брак, скарга — завжди
    // handoff) і SOFT (слова недовіри / "не прийшло"). SOFT свідомо опрацьовує сама нода,
    // якщо позначена data.softHandoffOff===true (напр. n_pay_collect: "боюсь, що обманете" →
    // сценарій винятку довіри cod_trust з промпту) — раніше двигун перехоплював ці слова
    // ДО ноди, і ретельно прописаний сценарій ніколи не спрацьовував.
    const _hoNode = runtime.currentNodeId ? nodesById.get(runtime.currentNodeId) : null;
    const _softHandoffOff = Boolean(_hoNode && _hoNode.data && _hoNode.data.softHandoffOff === true);
    const _hoHardRe = /менеджер|оператор(?!ськ)|з\s*людин|живою\s*людин|жива\s*людин|людину\s*(покличте|дайте)|ви\s*бот|це\s*бот|справжн(я|ій)\s*людин|\bбрак\b|скарг|жалоб|конфлікт/i;
    const _hoSoftRe = /обман|шахра|не\s*прийшл|не\s*дійшл|не\s*дошл/i;
    if (incomingUserMessage && !ctx.crmOrderId
        && (_hoHardRe.test(String(incomingUserMessage)) || (!_softHandoffOff && _hoSoftRe.test(String(incomingUserMessage))))) {
        ctx.adminEngaged = true;
        ctx.handoffReason = String(incomingUserMessage).slice(0, 160);
        const hoMsg = 'Добре, зараз покличу менеджера 🙂 Незабаром вам відповість жива людина — дякую за терпіння 💛';
        await persistAssistantMessage(session.id, hoMsg, { source: 'handoff_keyword' });
        try {
            const _env = Object.fromEntries((await db.funnelKey.findMany({ where: { botId: session.botId }, select: { key: true, value: true } })).map((k) => [k.key, k.value]));
            const _admin = _env.ADMIN_TELEGRAM_ID || '';
            const _tok = _env.TELEGRAM_BOT_TOKEN || '';
            if (_admin && /^\d+:[A-Za-z0-9_-]{20,}$/.test(_tok) && !ctx.testMode) {
                const _txt = shopPrefix(_env) + '🙋 <b>Клієнт просить живу людину</b>\n\n👤 Клієнт: ' + (ctx.senderName || '') + ' (' + (ctx.igUsername || '') + ')\n💬 Повідомлення: «' + String(incomingUserMessage).slice(0, 160) + '»\n\n🔗 Сесія: ' + session.id;
                const _r = await fetch('https://api.telegram.org/bot' + _tok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(_admin), text: _txt, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(() => null);
                const _j = _r ? await _r.json().catch(() => ({})) : {};
                pushDelivery(runtime, 'telegram_notify', !!_j.ok, _j.ok ? null : (_j.description || 'fetch failed'), { chatId: String(_admin), reason: 'handoff_keyword' });
            }
        } catch (_e) { /* сповіщення не має ламати handoff */ }
        runtime.waitingForUser = true;
        await db.session.update({ where: { id: session.id }, data: { context: { ...ctx, flowRuntime: runtime } } }).catch(() => {});
        return { session, botResponse: hoMsg, flowDriven: true, handoff: true };
    }

    const funnelKeyRows = await db.funnelKey.findMany({
        where: { botId: session.botId },
        select: { key: true, value: true },
    });
    const funnelEnv = Object.fromEntries(funnelKeyRows.map((k) => [k.key, k.value]));

    // Зміна способу оплати ПІСЛЯ видачі інвойсу (2026-09-03/04): спільний хелпер для двох шляхів —
    // (а) модель повернула {"paymentMethodChange":"cod"|"full"}; (б) детермінований regex-детект
    // на claude-ноді з data.detectPaymentChange===true (живий прогін 2026-09-04: Haiku в n_collect
    // замість JSON вигадала посилання goverla.shop/pay — на гроші не можна покладатись на промпт).
    // Дії: best-effort видалити старий ibanoplata-інвойс, оновити paymentInfo.method, стрибнути на
    // n_intl_route (він форсує full для закордону) або n_pay_amount — далі граф штатно перевипускає лінк.
    const performPaymentMethodChange = async (newMethod, targetNodeId) => {
        const _oldInvoiceUid = (ctx.ibanInvoiceUid || '').toString().trim();
        if (_oldInvoiceUid && !ctx.testMode && _oldInvoiceUid !== 'test-uid') {
            try {
                const _delApiKey = (funnelEnv.IBANOPLATA_API_KEY || '').trim();
                if (_delApiKey) {
                    const _delStart = Date.now();
                    let _delStatus = null;
                    try {
                        const _dr = await fetch(`https://api.ibanoplata.com/v2/iban-invoice/${encodeURIComponent(_oldInvoiceUid)}`, {
                            method: 'DELETE', headers: { Accept: 'application/json', 'X-Api-Key': _delApiKey },
                        });
                        _delStatus = _dr.status;
                    } catch (_e) { /* best-effort */ }
                    db.apiCall.create({ data: {
                        sessionId: session.id, service: 'ibanoplata', method: 'delete_invoice',
                        requestData: { uid: _oldInvoiceUid, reason: 'payment_method_changed' }, responseData: {}, statusCode: _delStatus, durationMs: Date.now() - _delStart,
                    } }).catch(() => {});
                }
            } catch (_e) { /* best-effort */ }
        }
        ctx.paymentInfo = Object.assign({}, ctx.paymentInfo, { method: newMethod });
        ctx.ibanPayUrl = '';
        ctx.ibanInvoiceUid = '';
        runtime.lastUserMessage = '';
        runtime.waitingForUser = false;
        runtime.userConfirmationReceived = false;
        runtime.currentNodeId = targetNodeId;
    };
    const paymentChangeTargetNode = () => (nodesById.has('n_intl_route') ? 'n_intl_route' : (nodesById.has('n_pay_amount') ? 'n_pay_amount' : null));
    // 'cod' | 'full' | null — лише при явному намірі змінити або дуже короткій відповіді ("1", "2").
    const detectPaymentMethodChange = (text) => {
        const t = String(text || '').trim();
        if (!t) return null;
        const short = t.replace(/[^\wа-яіїєґ]/gi, '').length <= 3;
        const intent = /передумав|краще|змін|давайте|хочу|можна|перейд|оберу|обираю|виб[ие]р|варіант|спос[іо]б/i.test(t);
        if (!short && !intent) return null;
        const wantsCod = /частков|накладн|наложк|післяплат|при\s*отриманн|передоплат[аиу]?\s*200|\b200\b|перш(ий|ого|у)|варіант\s*1|^\s*1\s*$/i.test(t);
        const wantsFull = /повн(а|у|істю|ої)|всю\s*суму|одразу\s*всю|друг(ий|ого|у)|варіант\s*2|^\s*2\s*$/i.test(t);
        if (wantsCod && !wantsFull) return 'cod';
        if (wantsFull && !wantsCod) return 'full';
        return null;
    };

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
    await __resolveConnectorKey('CLAUDE_CONNECTOR_ID', 'ANTHROPIC_API_KEY');
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
        const chronological = recentRows.reverse();
        // Аудит 2026-08-31 (живий кейс власника: "сесію перезапускав, але підтягнулась
        // інфа із попередніх повідомлень"): admin_restart/test_mode_auto_restart свідомо
        // скидають лише context/state, а НЕ саму історію повідомлень (історія зберігається
        // навмисно — див. sessions.js /restart). Але це вікно раніше тягнуло останні 16
        // повідомлень БЕЗ огляду на такий скид — тому claude-нода все одно бачила "Ви вже
        // обрали Футболка..." з ДО рестарту й продовжувала той діалог, ніби нічого не було.
        // Шукаємо ОСТАННІЙ маркер рестарту в цьому ж вікні — і відрізаємо все, що ДО нього.
        const RESET_MARKERS = new Set(['admin_restart', 'test_mode_auto_restart']);
        let resetIdx = -1;
        for (let i = chronological.length - 1; i >= 0; i--) {
            const src = chronological[i].metadata && chronological[i].metadata.source;
            if (RESET_MARKERS.has(src)) { resetIdx = i; break; }
        }
        const afterReset = resetIdx >= 0 ? chronological.slice(resetIdx + 1) : chronological;
        conversationWindow = afterReset
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && !(m.metadata && m.metadata.hidden))
            // Аудит 2026-09-02 (Проблема 5, доповнення): raw-лінк-стрипінг на
            // runtime.lastUserMessage (вище) НЕ покриває цей шлях — claude-ноди на
            // СВОЄМУ першому вході (без dialogHistory[node.id]) підхоплюють історію
            // САМЕ звідси (з БД, де повідомлення клієнта збережено з ОРИГІНАЛЬНИМ
            // URL), а не з runtime.lastUserMessage. Живий тест підтвердив: без цього
            // n_set_choice все одно бачив сирий instagram.com/... лінк і імпровізував
            // "не можу відкрити" навіть коли товар уже правильно визначено вище.
            // Другий живий тест: заміна на "[посилання на товар]" НЕ допомогла — саме
            // СЛОВО "посилання" й далі наводило модель на "не можу відкрити посилання".
            // Прибираємо URL ЦІЛКОМ (порожній рядок), без жодного слова про "лінк".
            .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).replace(/https?:\/\/(www\.)?instagram\.com\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim().slice(0, 1200) }));
    } catch (_e) { conversationWindow = []; }

    if (!runtime.currentNodeId) {
        runtime.currentNodeId = findStartNode(flow.nodes)?.id || null;
    }

    if (incomingUserMessage || incomingFile || incomingImageUrl) {
        // Фото/скрін БЕЗ підпису — теж хід клієнта: без цього runtime.lastUserMessage
        // лишається порожнім і будь-яка dialog-нода (claude) мовчки виходить у
        // waitingForUser нічого не зробивши (клієнт "зависає" без відповіді).
        // Знайдено 2026-08-19: клієнт скинув скрін оплати на кроці n_collect — бот
        // не відповів і не обробив фото взагалі.
        runtime.lastUserMessage = incomingUserMessage || (incomingImageUrl && !incomingFile ? '[фото]' : '');
        // Аудит 2026-08-29 (живий кейс, covercar_ua/mashadelrey): notifyTg-ноди типу
        // n_unknown_admin, що йдуть ПІСЛЯ claude-ноди (напр. n_unknown_msg) в тому ж
        // ході, рендерились з ПОРОЖНІМ "Останнє:" — не через помилку в шаблоні
        // (шлях {{context.flowRuntime.lastUserMessage}} правильний), а через те, що
        // claude-ноди СВІДОМО чистять runtime.lastUserMessage='' одразу після того,
        // як спожили повідомлення (щоб наступна нода того ж ходу не обробила його
        // ЩЕ РАЗ) — і до notifyTg, що йде третім у каскаді, вже нічого не лишалось.
        // ctx.lastCustomerMessage — стабільний знімок на ПОЧАТКУ ходу, який НІЯКА
        // нода далі в каскаді не чистить — саме його треба показувати людям
        // (сповіщення, адмінка), а не транзиторний runtime.lastUserMessage.
        ctx.lastCustomerMessage = runtime.lastUserMessage;
        // Аудит 2026-09-02 (Проблема 5, доповнення — живий тест виявив): якщо в
        // повідомленні був сирий IG-лінк (_hasRawIgLink вище), товар уже міг бути
        // ПРАВИЛЬНО визначений системою через sharedPost/Graph API — але сам URL і
        // далі лишається в runtime.lastUserMessage, і консультаційна claude-нода
        // (n_set_choice/n_color/тощо), побачивши його, імпровізує "я не можу
        // відкрити посилання на Instagram" навіть КОЛИ товар щойно правильно
        // показано в тому ж ході — суперечливо, збиває клієнта. Замінюємо САМ URL
        // на нейтральний плейсхолдер у runtime.lastUserMessage (те, що бачать
        // claude-ноди) — решта повідомлення (реальне питання клієнта) лишається
        // незмінною. ctx.lastCustomerMessage (сповіщення/адмінка, вже зафіксовано
        // рядком вище) — БЕЗ змін, показує оригінал. Живий тест: плейсхолдер
        // "[посилання на товар]" НЕ допоміг — саме слово "посилання" й далі
        // наводило модель на "не можу відкрити посилання". Прибираємо URL
        // ЦІЛКОМ (порожній рядок), без жодного слова про "лінк".
        if (_hasRawIgLink) {
            runtime.lastUserMessage = runtime.lastUserMessage.replace(/https?:\/\/(www\.)?instagram\.com\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim();
        }
        runtime.waitingForUser = false;
        // Вхідний файл кладемо у контекст (як lastUserMessage) — його спожиє нода readFile.
        if (incomingFile) ctx.lastFile = incomingFile;
    }
    // Вхідне зображення (скрін/фото квитанції) → у контекст для нод звірки оплати.
    if (incomingImageUrl) {
        ctx.lastReceiptImageUrl = incomingImageUrl;
        ctx.lastUserImageUrl = incomingImageUrl;
    } else if (incomingUserMessage) {
        // Живий тест 2026-09-04 (Олексій): фото з попереднього ходу лишалось у lastUserImageUrl,
        // і наступний ТЕКСТ ("Світло-сірий") n_prev_match_snapshot рахував як "свіжий сигнал товару"
        // → повторна презентація замість post-order/welcome-back. Фото належить лише своєму ходу.
        delete ctx.lastUserImageUrl;
    }

    let lastAssistant = null;
    let guard = 0;

    // ── Трейс виконання по-нодах (для вкладки «Ноди» у сесії) ──────────────────
    // Пишемо у runtime.nodeTraces (персиститься з context). Значення обрізаємо,
    // масив капимо — щоб не роздувати контекст. input = конфіг ноди; output =
    // діф змінених ключів контексту після ноди. API/помилки корелюємо на фронті.
    if (!Array.isArray(runtime.nodeTraces)) runtime.nodeTraces = [];
    const TRACE_MAX = 80;
    const TRACE_VAL_MAX = 8000;
    const _snapKey = (v) => {
        let s;
        try { s = JSON.stringify(v); } catch (_e) { s = String(v); }
        if (s == null) return 'null';
        return s.length > TRACE_VAL_MAX ? s.slice(0, TRACE_VAL_MAX) + '…' : s;
    };
    const _snapRoot = (o) => {
        const s = {};
        for (const k of Object.keys(o || {})) { if (k === 'flowRuntime') continue; s[k] = _snapKey(o[k]); }
        return s;
    };
    const _snapData = (d) => {
        const s = {};
        for (const k of Object.keys(d || {})) s[k] = _snapKey(d[k]);
        return s;
    };
    const _finalizeTrace = (tr) => {
        if (!tr) return;
        const before = tr._before || {};
        const after = _snapRoot(ctx);
        const diff = {};
        for (const k of Object.keys(after)) { if (before[k] !== after[k]) diff[k] = after[k]; }
        tr.output = diff;
        tr.tookMs = Date.now() - tr._ts;
        delete tr._before; delete tr._ts;
        runtime.nodeTraces.push(tr);
        if (runtime.nodeTraces.length > TRACE_MAX) runtime.nodeTraces = runtime.nodeTraces.slice(-TRACE_MAX);
    };
    let pendingTrace = null;

    // 100: батч-цикли генерації контенту (7 батчів × 3 ноди) не вміщались у 40
    while (runtime.currentNodeId && guard < 100) {
        guard += 1;
        const node = nodesById.get(runtime.currentNodeId);
        if (!node) break;

        // Аудит 2026-08-30 (дублювання презентації товару, живий кейс oleksii_sirazetdinov,
        // артикул C0043): одноразові контекстні прапорці, виставлені ПОПЕРЕДНЬОЮ нодою через
        // data.setContext, мають лишатись видимими, доки їх реально не прочитає нода, що щось
        // РОБИТЬ з клієнтом (claude/message/…) — а не згаснути на першій-ліпшій проміжній
        // condition/js-ноді маршрутизації (звичайна річ між n_welcome і n_size: n_is_set →
        // n_recall_cond → n_is_clothing). Тому чищення — у ДВІ фази: прапорці переживають
        // будь-яку кількість "тихих" condition/js-нод, озброюються на клірінг щойно
        // натрапляють на першу "не тиху" ноду (вона ще встигає їх прочитати), і реально
        // чистяться на самому початку ноди ПІСЛЯ неї. Детермінований (код, не "здогадка"
        // моделі) спосіб сказати "щось щойно сталось", без прив'язки до id нод.
        const SILENT_PASSTHROUGH_TYPES = new Set(['condition', 'js', 'funnelStage']);
        if (runtime.__pendingClearArmed) {
            for (const k of (runtime.__pendingClearFlags || [])) delete ctx[k];
            runtime.__pendingClearFlags = [];
            runtime.__pendingClearArmed = false;
        } else if (Array.isArray(runtime.__pendingClearFlags) && runtime.__pendingClearFlags.length && !SILENT_PASSTHROUGH_TYPES.has(node.type)) {
            runtime.__pendingClearArmed = true;
        }

        runtime.nodesVisited.push(node.id);
        const data = asObject(node.data);
        if (data.setContext && typeof data.setContext === 'object' && !Array.isArray(data.setContext)) {
            for (const [k, v] of Object.entries(data.setContext)) ctx[k] = v;
            runtime.__pendingClearFlags = Object.keys(data.setContext);
            runtime.__pendingClearArmed = false;
        }
        // Закриваємо трейс попередньої ноди (діф контексту = її ефект) і починаємо новий.
        if (pendingTrace) _finalizeTrace(pendingTrace);
        pendingTrace = {
            seq: runtime.nodeTraces.length,
            nodeId: node.id, nodeType: node.type, label: (data && data.label) || '',
            input: _snapData(data),
            userInput: String(runtime.lastUserMessage || '').slice(0, 1500),
            tsIso: new Date().toISOString(),
            _before: _snapRoot(ctx), _ts: Date.now(),
        };
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
            // Детермінована зміна способу оплати (data.detectPaymentChange) — ДО виклику моделі,
            // лише коли інвойс уже є (paymentInfo.method) і нода не n_pay_collect (там це штатний вибір).
            if (data.detectPaymentChange === true && mode === 'dialog' && node.id !== 'n_pay_collect' && runtime.lastUserMessage
                && ctx.paymentInfo && ctx.paymentInfo.method && ctx.paymentInfo.method !== 'cod_trust') {
                const _detected = detectPaymentMethodChange(runtime.lastUserMessage);
                const _target = _detected && _detected !== ctx.paymentInfo.method ? paymentChangeTargetNode() : null;
                if (_target) {
                    pushDelivery(runtime, 'payment_method_change', true, null, { nodeId: node.id, from: ctx.paymentInfo.method, to: _detected, via: 'regex' });
                    await performPaymentMethodChange(_detected, _target);
                    continue;
                }
            }
            // Аудит 2026-09-04 (живий кейс власника, "дубль опису товару на кроці зріст/вага"):
            // data.waitAfterPresentation===true — якщо в ЦЬОМУ Ж ході щойно показали картку
            // товару (ctx.productJustPresented, ставить n_welcome через setContext) і нода ще не
            // має історії — НЕ викликаємо модель з первинним повідомленням клієнта (вона
            // переказувала опис ще раз), а чекаємо його відповідь на питання з презентації
            // (n_welcome сам питає параметри). Детерміновано, без покладання на промпт.
            // waitAfterPresentationUnless — regex (рядок у data): якщо ПЕРШЕ повідомлення клієнта вже містить
            // потрібне (напр. "182/100", "зріст 167 вага 75" — реальні кейси goverla 2026-09-04), не чекаємо,
            // а одразу віддаємо його моделі — інакше бот перепитує те, що клієнт щойно написав.
            let _presentationUnless = false;
            if (data.waitAfterPresentationUnless && runtime.lastUserMessage) {
                try { _presentationUnless = new RegExp(String(data.waitAfterPresentationUnless), 'i').test(String(runtime.lastUserMessage)); } catch (_e) { _presentationUnless = false; }
            }
            if (data.waitAfterPresentation === true && mode === 'dialog' && ctx.productJustPresented && runtime.lastUserMessage && !_presentationUnless
                && !(Array.isArray(runtime.dialogHistory[node.id]) && runtime.dialogHistory[node.id].length)) {
                delete ctx.productJustPresented;
                runtime.lastUserMessage = '';
                runtime.waitingForUser = true;
                break;
            }
            if (!runtime.lastUserMessage && !inFinalizationStage && !resumeAfterTool && !selfContained && !speakFirstNow) {
                runtime.waitingForUser = true;
                break;
            }

            // Build a compressed scope for prompt rendering — prevents 429 rate-limit
            // errors caused by large context fields (contentPlan, nlm_overview, etc.).
            // The live ctx is never modified; only the prompt interpolation sees the
            // compressed version.
            const claudeScope = { ...scope, context: compressContextForPrompt(ctx) };

            let systemPrompt = renderTemplate(data.systemPrompt || 'You are a helpful assistant.', claudeScope);
            // RAG: якщо нода з useKb — шукаємо у вектор-базі за повідомленням клієнта й
            // додаємо топ-результати у системний промпт (FAQ/заперечення з Google Doc).
            // База знань у CRM (2026-09-05, замість вектор-бази з Google-документа): пошук лише коли
            // повідомлення схоже на питання, лише на нодах з data.useCrmKb, у скоупі поточного товару.
            if (data.useCrmKb && runtime.lastUserMessage && ctx.product !== undefined) {
                try {
                    const _q = String(runtime.lastUserMessage).trim();
                    const _looksLikeQuestion = _q.length >= 6 && (/\?/.test(_q) || /^(чи|як|коли|де|скільки|чому|можна|є\s|який|яка|які|що|а\s)/i.test(_q));
                    const _kRawBase = String(funnelEnv.CRM_API_URL || funnelEnv.CRM_API_BASE || '').trim().replace(/\/$/, '');
                    const _kApiUrl = _kRawBase && !_kRawBase.endsWith('/api') ? `${_kRawBase}/api` : _kRawBase;
                    const _kApiKey = String(funnelEnv.CRM_API_KEY || '').trim();
                    if (_looksLikeQuestion && _kApiUrl && _kApiKey) {
                        const _scope = ctx.product && ctx.product.id ? 'product:' + ctx.product.id : 'shop';
                        const _kStart = Date.now();
                        const _kr = await fetch(`${_kApiUrl}/knowledge/search?q=${encodeURIComponent(_q.slice(0, 200))}&scope=${encodeURIComponent(_scope)}&limit=3`, { headers: { Authorization: `Bearer ${_kApiKey}` } });
                        const _kj = _kr.ok ? await _kr.json().catch(() => ({})) : {};
                        const _hits = Array.isArray(_kj.data) ? _kj.data : [];
                        if (_hits.length) {
                            systemPrompt += '\n\n=== ДОВІДКА ПО ПИТАННЮ (база знань магазину в CRM — відповідай СПИРАЮЧИСЬ на неї, своїми словами, без вигадок) ===\n'
                                + _hits.map((h) => '• ' + (h.question ? ('Питання: ' + String(h.question).slice(0, 200) + ' → ') : '') + 'Відповідь: ' + String(h.answer || '').slice(0, 600)).join('\n');
                        }
                        db.apiCall.create({ data: { sessionId: session.id, service: 'crm_kb', method: 'search', requestData: { query: _q.slice(0, 120), scope: _scope }, responseData: { count: _hits.length }, statusCode: _kr.status, durationMs: Date.now() - _kStart } }).catch(() => {});
                    }
                } catch (_kbErr2) { /* best-effort — база знань не блокує діалог */ }
            }
            if (data.useKb && runtime.lastUserMessage) {
                try {
                    const vURL = (funnelEnv.VECTOR_URL || 'http://127.0.0.1:4500').replace(/\/$/, '');
                    const vTok = (funnelEnv.VECTOR_TOKEN || '').trim();
                    if (vTok) {
                        const vr = await fetch(vURL + '/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + vTok }, body: safeJsonStringify({ query: runtime.lastUserMessage, limit: 3 }) });
                        const vj = await vr.json().catch(() => ({}));
                        const hits = (vj && vj.results) || [];
                        if (hits.length) {
                            systemPrompt += '\n\n=== БАЗА ЗНАНЬ (FAQ/скрипти — використай, якщо доречно до питання клієнта) ===\n'
                                + hits.map((h) => '• ' + String(h.content || '').slice(0, 500)).join('\n')
                                + '\nЯкщо у клієнта нестандартне питання чи заперечення — відповідай СПИРАЮЧИСЬ на цю базу. Якщо потрібної інформації тут НЕМА і ти не впевнений у відповіді — НЕ вигадуй: додай у json_output {"handoff": true}.';
                        } else if (!vr.ok) {
                            // Аудит 2026-09-02 (сповіщення про недоступні зовнішні сервіси): вектор-база
                            // недоступна — не блокуємо діалог (промпт вище й так каже моделі не вигадувати
                            // і кликати handoff при непевності), лише сигналізуємо адміну best-effort.
                            notifyAdminOfServiceOutage(session.id, 'База знань (вектор-пошук FAQ)', 'HTTP ' + vr.status).catch(() => {});
                        }
                        db.apiCall.create({ data: { sessionId: session.id, service: 'vector', method: 'search', requestData: { query: String(runtime.lastUserMessage).slice(0, 120) }, responseData: { count: hits.length }, statusCode: vr.status, durationMs: null } }).catch(() => {});
                    }
                } catch (_kbErr) {
                    notifyAdminOfServiceOutage(session.id, 'База знань (вектор-пошук FAQ)', _kbErr.message).catch(() => {});
                }
            }
            // Каталог: якщо нода з useCatalog — клієнт міг спитати про ІНШИЙ товар,
            // не той, що вже "заблокований" у context.product (напр. запитав про
            // чорні класичні накидки посеред оформлення тестової позиції) — раніше
            // модель без реальних даних або вигадувала відповідь, або відмовлялась
            // ("немає каталогу під рукою"), хоча каталог насправді доступний через
            // KeyCRM. Підмішуємо релевантні товари в промпт — реальні дані замість
            // вигадки чи відмовки.
            // Аудит 2026-09-02 (живий кейс: "хочу замовити" на кроці допродажу збило
            // n_order_intent на generic-привітання): цей блок мав ловити "клієнт спитав
            // про ІНШИЙ товар" — але рахував keyword-збіг ЛИШЕ проти ПОТОЧНОГО повідомлення,
            // без огляду на те, що товар уже ОДНОЗНАЧНО встановлений у context.product.
            // Фрази підтвердження ("хочу замовити", "так, беру", "оформляємо") не несуть
            // жодних товарних слів — блок чесно рахував "нічого не знайдено" і ІНСТРУКТУВАВ
            // модель сказати клієнту "не бачу точного відповідника, назвіть товар" — це
            // прямо суперечило основному системному промпту (який каже підсумувати вже
            // відомий товар) і модель губилась, скочуючись у generic-привітання.
            // Справжнє "клієнт назвав інший товар" уже надійно ловиться РАНІШЕ, окремим
            // детермінованим механізмом (product-switch евристика + n_lookup), який
            // спрацьовує ДО того, як дійти до цієї claude-ноди. Тому тут — лише коли товар
            // ЩЕ НЕ встановлений (genuінно "не знаю, про що клієнт" сценарій); якщо
            // context.product вже є, цей re-search лише вносить шум і суперечності.
            if (data.useCatalog && runtime.lastUserMessage && !ctx.product) {
                try {
                    const token = (funnelEnv.KEYCRM_API_TOKEN || '').trim();
                    const base = (funnelEnv.KEYCRM_API_BASE || 'https://openapi.keycrm.app/v1').replace(/\/$/, '');
                    if (token && token !== 'REPLACE_ME') {
                        const stop = new Set(['який','яка','яке','які','чи','є','у','вас','мене','цікавить','хочу','можна','будь','ласка','для','на','по','те','то','це','та','і','в','з','мені','покажіть','покажи','скільки','коштує','коштують']);
                        const qWords = String(runtime.lastUserMessage).toLowerCase().replace(/[^\wа-яіїєґ\s]/gi, ' ').split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
                        if (qWords.length) {
                            const r = await fetch(base + '/products?limit=50&page=1', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
                            const j = await r.json().catch(() => ({}));
                            const all = (j && j.data) || [];
                            const scored = all.map((p) => {
                                const name = String(p.name || '').toLowerCase();
                                const score = qWords.reduce((acc, w) => acc + (name.includes(w) ? 1 : 0), 0);
                                return { p, score };
                            }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
                            if (scored.length) {
                                systemPrompt += '\n\n=== ТОВАРИ З КАТАЛОГУ (реальні, знайдені за запитом клієнта — використай ЛИШЕ ці дані, не вигадуй інші) ===\n'
                                    + scored.map((x) => '• ' + x.p.name + (x.p.price != null ? (' — ' + x.p.price + ' грн') : '')).join('\n')
                                    + '\nЯкщо жоден із цих товарів не відповідає питанню — чесно скажи, що зараз не бачиш точного відповідника, і попроси клієнта скинути пост/рілс/артикул товару АБО запропонуй покликати менеджера. НІКОЛИ не кажи "немає каталогу під рукою" — каталог у тебе є, просто з цього переліку.';
                            } else {
                                systemPrompt += '\n\n=== КАТАЛОГ: за запитом клієнта нічого релевантного не знайдено ===\nЧесно скажи клієнту, що не знайшов точного відповідника, і попроси уточнити або скинути пост/артикул. НІКОЛИ не кажи "немає каталогу під рукою" і не вигадуй товари.';
                            }
                            if (!r.ok) {
                                // Best-effort: інструкція вище вже каже моделі чесно визнати "не бачу
                                // відповідника" замість вигадки — недоступність KeyCRM тут не блокує
                                // діалог, лише сигналізує адміну (окремо від n_lookup — там повний
                                // хендоф уже є для головного пошуку товару).
                                notifyAdminOfServiceOutage(session.id, 'KeyCRM (уточнення товару в діалозі)', 'HTTP ' + r.status).catch(() => {});
                            }
                            db.apiCall.create({ data: { sessionId: session.id, service: 'keycrm', method: 'catalog_search', requestData: { query: String(runtime.lastUserMessage).slice(0, 120) }, responseData: { count: scored.length }, statusCode: r.status, durationMs: null } }).catch(() => {});
                        }
                    }
                } catch (_catErr) {
                    notifyAdminOfServiceOutage(session.id, 'KeyCRM (уточнення товару в діалозі)', _catErr.message).catch(() => {});
                }
            }
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

                // Модель іноді видає порожній {} замість того щоб взагалі промовчати про json
                // (напр. коли не зрозуміла клієнта, але звикла завжди щось повертати) — порожній
                // об'єкт не несе жодного сигналу, тому НЕ вважається завершенням діалогу.
                if (exit.parsed && typeof exit.parsed === 'object' && !Array.isArray(exit.parsed) && Object.keys(exit.parsed).length === 0) {
                    exit.done = false;
                }
                // Аудит 2026-09-02 (Проблема 1, доповнення sizeAsked-прапорця): та сама
                // проблема, лише замість {} модель іноді вигадує json з УСІМА полями
                // null/порожніми (напр. {"height":null,"weight":null}), коли насправді
                // реальних даних клієнта ще нема — живий тест підтвердив: n_calc після
                // такого json спокійно домальовує розмір "M" за фолбеком, хоча клієнт
                // ЖОДНОГО разу не назвав ні зросту, ні ваги. Узагальнюємо перевірку
                // вище: об'єкт, де ВСІ значення null/undefined/порожній рядок — так само
                // не несе сигналу, як і {}.
                if (exit.parsed && typeof exit.parsed === 'object' && !Array.isArray(exit.parsed) && exit.done) {
                    const _vals = Object.values(exit.parsed);
                    if (_vals.length > 0 && _vals.every((v) => v === null || v === undefined || v === '')) {
                        exit.done = false;
                    }
                }

                // Якщо json_output містить ЛИШЕ wantsPhoto (клієнт просто попросив фото,
                // жодного реального рішення типу setChoice/color не назвав) — це НЕ привід
                // просувати воронку далі. Інакше клієнт випадково "вибирає" щось, чого не казав.
                // Аудит 2026-09-03 (живий регресійний тест, n_set_choice): photoArticle —
                // МЕТАДАНІ про те, ЯКЕ САМЕ фото показати (яку позицію набору), а не окреме
                // "рішення" клієнта — раніше воно НЕ виключалось з otherKeys, тож комбінація
                // {"wantsPhoto":true,"photoArticle":"5934"} (точно те, що промпт n_set_choice
                // сам і просить повертати на прохання фото конкретного компонента) хибно
                // трактувалась як "клієнт щось вирішив" → exit.done лишався true → нода
                // просувала воронку далі з ПОРОЖНІМ/невизначеним setPick → n_set_apply
                // мовчки дефолтив на setMode:'set' (нібито клієнт узяв ВЕСЬ комплект),
                // хоча він лише попросив фото. Виключаємо photoArticle з тих самих причин,
                // що й wantsPhoto.
                if (exit.parsed && exit.parsed.wantsPhoto === true) {
                    const otherKeys = Object.keys(exit.parsed).filter((k) => k !== 'wantsPhoto' && k !== 'photoArticle');
                    if (otherKeys.length === 0) exit.done = false;
                }
                // Те саме для wantsUpsellPhoto (фото товару з допродажу, не основного) —
                // окремий, незалежний сигнал, той самий принцип (аудит 2026-08-26).
                if (exit.parsed && exit.parsed.wantsUpsellPhoto === true) {
                    const otherKeys = Object.keys(exit.parsed).filter((k) => k !== 'wantsUpsellPhoto');
                    if (otherKeys.length === 0) exit.done = false;
                }
                // Аудит 2026-09-04 (goverla CRM-клон): {"colorUnavailable":true} БЕЗ "color" — клієнт
                // назвав колір, якого нема; модель уже відповіла текстом і запропонувала наявні.
                // Це НЕ рішення — нода лишається активною й чекає наступний вибір. Раніше такий
                // json завершував n_color, далі n_avail без кольору вважав товар наявним, і
                // замовлення йшло в "Оформляємо?" та в CRM з першим-ліпшим offer. Прапорець на
                // root промотуємо тут же (worker читає ctx.colorUnavailable для "розумних
                // нагадувань"), бо штатний блок промоції нижче виконується лише при exit.done.
                if (exit.parsed && exit.parsed.colorUnavailable === true && !exit.parsed.color) {
                    ctx.colorUnavailable = true;
                    const otherKeys = Object.keys(exit.parsed).filter((k) => k !== 'colorUnavailable' && k !== 'wantsPhoto' && k !== 'photoArticle');
                    if (otherKeys.length === 0) exit.done = false;
                }
                // v3 (реальні переписки 2026-09-04: "хто виробник?", "чи можна підʼїхати приміряти?"): питання, на
                // яке в моделі нема даних, — НЕ handoff (бот зупинявся й клієнт втрачав крок), а "askManager":
                // модель чесно каже, що уточнить, і веде далі; менеджеру летить сигнал у Telegram, бот НЕ спиняється.
                if (exit.parsed && exit.parsed.askManager && typeof exit.parsed.askManager === 'string') {
                    try {
                        const _amAdmin = funnelEnv.ADMIN_TELEGRAM_ID || await getSystemKeyValue('ADMIN_TELEGRAM_ID');
                        const _amTok = funnelEnv.TELEGRAM_BOT_TOKEN || '';
                        if (_amAdmin && /^\d+:[A-Za-z0-9_-]{20,}$/.test(_amTok) && !ctx.testMode) {
                            const _amText = shopPrefix(funnelEnv) + '❓ <b>Клієнт спитав те, чого бот не знає</b> (бот продовжує діалог, відповідь можна дописати в чат)\n\n👤 ' + (ctx.senderName || '') + ' (' + (ctx.igUsername || '') + ')\n💬 «' + String(exit.parsed.askManager).slice(0, 200) + '»\n🛍️ ' + ((ctx.product && ctx.product.customerName) || '') + '\n🔗 Сесія: ' + session.id;
                            const _amR = await fetch('https://api.telegram.org/bot' + _amTok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(_amAdmin), text: _amText, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(() => null);
                            const _amJ = _amR ? await _amR.json().catch(() => ({})) : {};
                            pushDelivery(runtime, 'telegram_notify', !!_amJ.ok, _amJ.ok ? null : (_amJ.description || 'fetch failed'), { nodeId: node.id, chatId: String(_amAdmin), reason: 'ask_manager' });
                        } else {
                            pushDelivery(runtime, 'telegram_notify', false, ctx.testMode ? 'testMode' : 'немає ADMIN_TELEGRAM_ID або TELEGRAM_BOT_TOKEN', { nodeId: node.id, reason: 'ask_manager' });
                        }
                    } catch (_e) { /* сигнал не має ламати діалог */ }
                    // База знань CRM: питання без відповіді → чернетка (from_dialog), менеджер дописує в CRM.
                    try {
                        const _fdRawBase = String(funnelEnv.CRM_API_URL || funnelEnv.CRM_API_BASE || '').trim().replace(/\/$/, '');
                        const _fdApiUrl = _fdRawBase && !_fdRawBase.endsWith('/api') ? `${_fdRawBase}/api` : _fdRawBase;
                        const _fdApiKey = String(funnelEnv.CRM_API_KEY || '').trim();
                        if (_fdApiUrl && _fdApiKey && !ctx.testMode) {
                            await fetch(`${_fdApiUrl}/knowledge/from-dialog`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_fdApiKey}` }, body: JSON.stringify({ question: String(exit.parsed.askManager).slice(0, 500), sessionId: session.id, productId: (ctx.product && ctx.product.id) || null }) }).catch(() => {});
                        }
                    } catch (_e) { /* best-effort */ }
                    const otherKeys = Object.keys(exit.parsed).filter((k) => k !== 'askManager' && k !== 'wantsPhoto' && k !== 'photoArticle');
                    if (otherKeys.length === 0) exit.done = false;
                }

                const isJsonExit = String(exitCondition).trim() === 'json_output';
                // Використовуємо jsonStart (а не exit.done) — інакше форсований wantsPhoto-only
                // "continue" (див. вище) показав би клієнту сирий ```json{"wantsPhoto":true}``` блок.
                const visibleAssistantText = (isJsonExit && typeof exit.jsonStart === 'number')
                    ? stripJsonAndTrailingText(responseText, exit.jsonStart)
                    : responseText;

                if (visibleAssistantText) {
                    await persistAssistantMessage(session.id, visibleAssistantText, { nodeId: node.id, nodeType: node.type });
                    lastAssistant = visibleAssistantText;
                }

                // Фото на вимогу: клієнт попросив фото посеред діалогу (напр. n_set_choice/
                // n_color) — раніше модель могла лише чесно сказати "не можу надіслати",
                // хоча платформа насправді вміє слати альбом. Модель сигналить
                // {"wantsPhoto":true} у json_output (разом з іншими полями або окремо),
                // рушій бере готові context.product.imageUrls і шле як окреме повідомлення
                // з attachments — той самий формат, що й sendPhoto-нода/zernioHandler альбом.
                // Прапорець: чи вже оброблено фото-обіцянку ЦЬОГО ходу структурованим
                // сигналом (wantsPhoto/wantsUpsellPhoto нижче) — використовується
                // генеричним текстовим safety-net'ом (Проблема 4) далі, щоб не слати
                // ДРУГЕ сповіщення менеджеру за той самий хід.
                let photoPromiseHandledThisTurn = false;
                if (exit.parsed && exit.parsed.wantsPhoto === true) {
                    photoPromiseHandledThisTurn = true;
                    // Аудит 2026-09-01 (Проблема 3, живий кейс: клієнт у наборі питав фото
                    // КОНКРЕТНОГО компонента — лоферів 5931/5934 — отримав колаж ЦІЛОГО
                    // набору): якщо модель (n_set_choice) розпізнала, про яку САМЕ позицію
                    // складу йдеться, вона додає photoArticle поруч з wantsPhoto — тоді
                    // беремо ВЛАСНІ фото цього компонента з product.setItems (n_lookup тепер
                    // підтягує їх з KeyCRM разом з рештою даних набору), а НЕ фото цілого
                    // набору. Якщо компонент знайдено, але власних фото в нього нема —
                    // ЧЕСНО ескалюємо (не підміняємо помилковим фото набору-колажу).
                    const _photoArticle = exit.parsed.photoArticle ? String(exit.parsed.photoArticle).toUpperCase().trim() : '';
                    let firstImg = '';
                    let _photoLabel = 'основного товару';
                    if (_photoArticle && ctx.product && Array.isArray(ctx.product.setItems)) {
                        const _comp = ctx.product.setItems.find((it) => it && String(it.article || '').toUpperCase().trim() === _photoArticle);
                        if (_comp) {
                            firstImg = (Array.isArray(_comp.imageUrls) && _comp.imageUrls[0]) || _comp.photoUrl || '';
                            _photoLabel = 'позиції набору «' + (_comp.name || _photoArticle) + '» (арт. ' + _photoArticle + ')';
                        } else {
                            _photoLabel = 'позиції набору (арт. ' + _photoArticle + ')';
                        }
                    } else {
                        // zernioHandler сам підтягує ПОВНУ галерею з context.product.imageUrls і
                        // шле альбомом — тут достатньо позначити attachment ОДНИМ фото (той самий
                        // формат, що й у sendPhoto-ноді), решту логіки альбому він добере сам.
                        firstImg = (ctx.product && Array.isArray(ctx.product.imageUrls) && ctx.product.imageUrls[0])
                            || (ctx.product && ctx.product.photoUrl) || '';
                    }
                    if (firstImg && String(firstImg).startsWith('http')) {
                        await persistAssistantMessage(session.id, '', { nodeId: node.id, nodeType: 'photo_on_demand', attachment: { type: 'photo', url: firstImg, caption: '' } });
                    } else {
                        // Аудит 2026-08-28: якщо фото немає (порожній/битий URL) — модель у
                        // ТЕКСТІ вже могла пообіцяти клієнту фото ("зараз надішлю") або навіть
                        // "менеджер надішле вручну" — а без явного сповіщення це порожня
                        // обіцянка, ніхто нічого не пришле. Сигналимо менеджеру одразу.
                        pushDelivery(runtime, 'photo_on_demand', false, 'немає валідного product.imageUrls/photoUrl', { nodeId: node.id });
                        await notifyAdminPhotoMissing(session, ctx, funnelEnv, runtime, _photoLabel);
                    }
                }

                // Фото товару з ДОПРОДАЖУ (не основного) — окремий сигнал wantsUpsellPhoto.
                // Аудит 2026-08-26 (goverla_shop/Притула): клієнт попросив фото футболки з
                // "часто разом замовляють", а бот чесно сказав "немає", хоча фото Є в
                // KeyCRM — просто context.product.upsell ніс лише назву+ціну. n_lookup тепер
                // кладе context.product.upsellPhotoUrl (фото першого апсейл-товару) — рушій
                // шле його тим самим механізмом, що й основне фото.
                if (exit.parsed && exit.parsed.wantsUpsellPhoto === true) {
                    photoPromiseHandledThisTurn = true;
                    const upImg = (ctx.product && ctx.product.upsellPhotoUrl) || '';
                    if (upImg && String(upImg).startsWith('http')) {
                        // Аудит 2026-08-28 (живий кейс, goverla_shop: клієнт просив фото
                        // допродажу-футболки, а отримав альбом ОСНОВНОГО товару — бомбери):
                        // nodeType навмисно ІНШИЙ ('photo_on_demand_upsell', не 'photo_on_demand'),
                        // бо zernioHandler.deliver для photo_on_demand підтягує ПОВНУ галерею з
                        // context.product.imageUrls (це правильно для фото ОСНОВНОГО товару, але
                        // для апсейла — це фото ІНШОГО товару, галереї якого в контексті взагалі
                        // нема). Тут nodeType сигналить рушію: НЕ підміняти на галерею, слати
                        // рівно цей один upImg.
                        await persistAssistantMessage(session.id, '', { nodeId: node.id, nodeType: 'photo_on_demand_upsell', attachment: { type: 'photo', url: upImg, caption: '' } });
                    } else {
                        // Аудит 2026-08-28 (живий кейс, goverla_shop): upsellPhotoUrl порожній/
                        // недоступний — модель у тексті вже пообіцяла клієнту "менеджер
                        // надішле" (бо так написано в промпті на цей випадок), але без
                        // сповіщення ЖОДЕН менеджер про це не дізнається. Кличемо явно.
                        pushDelivery(runtime, 'photo_on_demand_upsell', false, 'немає валідного product.upsellPhotoUrl', { nodeId: node.id });
                        await notifyAdminPhotoMissing(session, ctx, funnelEnv, runtime, 'товару з допродажу (' + (ctx.product && ctx.product.upsell || '') + ')');
                    }
                }

                // Централізований текстовий safety-net (Проблема 4, аудит 2026-09-01,
                // живий кейс: клієнт просив фото графітової кофти — модель відповіла
                // "зараз надішлю фото графітової кофти" ЗВИЧАЙНИМ ТЕКСТОМ, без
                // wantsPhoto/wantsUpsellPhoto у json_output — жодне фото не пішло, і
                // жодне сповіщення менеджеру теж, бо структурованого сигналу не було
                // взагалі). Попередні точкові фікси (wantsPhoto/wantsUpsellPhoto вище)
                // покривають лише ходи, де МОДЕЛЬ слухняно виставила прапорець — а вона
                // не завжди це робить, особливо коли питання не про "фото товару"
                // загалом, а про фото КОНКРЕТНОГО кольору/варіанта, якого в даних
                // просто нема (промпт-нода описує це вільним текстом, без формального
                // поля). Це УНІВЕРСАЛЬНИЙ регекс-детектор поверх ВИДИМОГО тексту БУДЬ-
                // ЯКОЇ claude dialog-ноди (не лише n_color) — якщо модель пообіцяла
                // надіслати фото/сітку словами, а жоден із офіційних сигналів вище
                // цього ходу не спрацював (ні успішно, ні з власною ескалацією) —
                // ескалюємо так само, як і порожній URL. Клієнт не має чекати обіцянку,
                // яка ніколи не прийде, без жодного сповіщення людині.
                if (!photoPromiseHandledThisTurn && visibleAssistantText) {
                    const _promiseNeg = /(не\s+можу|немає|нема\b|поки\s+не|не\s+вийде|не\s+буде|немож)[^.!?\n]{0,40}(фото|сітк|таблиц)|(фото|сітк|таблиц)[^.!?\n]{0,40}(немає|нема\b|не\s+можу|не\s+вийде)/i;
                    const _promisePos = /(надішл\w*|надсила\w*|скин\w*|вишл\w*|відправ\w*|прийшл\w*|скид\w*)[^.!?\n]{0,25}(фото|сітк|таблиц)|(фото|сітк|таблиц)[^.!?\n]{0,25}(вже\s+в\s+дороз\w*|вже\s+йде|прийде|надсил\w*|скоро|летит\w*|летить)/i;
                    if (_promisePos.test(visibleAssistantText) && !_promiseNeg.test(visibleAssistantText)) {
                        pushDelivery(runtime, 'photo_promise_text_only', false, 'модель пообіцяла фото/сітку текстом без wantsPhoto/wantsUpsellPhoto сигналу', { nodeId: node.id });
                        await notifyAdminPhotoMissing(session, ctx, funnelEnv, runtime, 'обіцяного текстом (без технічного сигналу — перевір, що саме мав на увазі клієнт)');
                    }
                }

                const historyWithReply = truncateHistory([
                    ...messages,
                    { role: 'assistant', content: responseText },
                ]);
                runtime.dialogHistory[node.id] = historyWithReply;

                if (exit.done) {
                    // Low-confidence handoff: модель сама сигналить {"handoff":true} → кличемо людину й зупиняємось.
                    if (exit.parsed && exit.parsed.handoff === true) {
                        ctx.adminEngaged = true;
                        const hoMsg = 'Добре, зараз покличу менеджера 🙂 Незабаром вам відповість жива людина — дякую за терпіння 💛';
                        await persistAssistantMessage(session.id, hoMsg, { nodeId: node.id, nodeType: node.type, source: 'handoff' });
                        lastAssistant = hoMsg;
                        try {
                            // Аудит 2026-08-29 (антипатерн A6, живий кейс Сіразетдінова): ключ
                            // ВОРОНКИ (група конкретного магазину, -5327070815) має пріоритет
                            // над системним (тут виявився особистий чат 345126254) — інакше
                            // "Forbidden: bot can't initiate conversation with a user", менеджер
                            // НІКОЛИ не дізнається про хендоф, а клієнт лишається в тиші назавжди.
                            const adminId = funnelEnv.ADMIN_TELEGRAM_ID || await getSystemKeyValue('ADMIN_TELEGRAM_ID');
                            const hoText = shopPrefix(funnelEnv) + '🙋 <b>Бот передав діалог людині</b> (низька впевненість)\n\n👤 Клієнт: ' + (ctx.senderName || '') + ' (' + (ctx.igUsername || '') + ')\n💬 Останнє: «' + String(ctx.lastCustomerMessage || runtime.lastUserMessage || '').slice(0, 160) + '»\n\n🔗 Сесія: ' + session.id;
                            const hoTok = funnelEnv.TELEGRAM_BOT_TOKEN || '';
                            if (adminId && /^\d+:[A-Za-z0-9_-]{20,}$/.test(hoTok)) {
                                const _hr = await fetch('https://api.telegram.org/bot' + hoTok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(adminId), text: hoText, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(() => null);
                                const _hj = _hr ? await _hr.json().catch(() => ({})) : {};
                                pushDelivery(runtime, 'telegram_notify', !!_hj.ok, _hj.ok ? null : (_hj.description || 'fetch failed'), { nodeId: node.id, chatId: String(adminId), reason: 'handoff' });
                            } else {
                                pushDelivery(runtime, 'telegram_notify', false, 'немає ADMIN_TELEGRAM_ID або валідного TELEGRAM_BOT_TOKEN', { nodeId: node.id, reason: 'handoff' });
                            }
                        } catch (_e) { /* silent */ }
                        runtime.lastUserMessage = '';
                        runtime.waitingForUser = true;
                        break;
                    }
                    // Аудит 2026-09-04: {"productMismatch":true} — модель (за matchNote низької
                    // впевненості з n_lookup: keyword/photo-матчинг) визнала, що товар у контексті
                    // не той, і вже попросила клієнта скинути пост/артикул. Скидаємо товарний
                    // скоуп і переходимо у той самий стан, що після n_unknown_stop: наступний
                    // пост/артикул підхопиться зі старту (блок product_unknown вище), а звичайне
                    // повідомлення без сигналу знову м'яко перепитає товар.
                    if (exit.parsed && exit.parsed.productMismatch === true) {
                        ['product', 'sharedPost', 'entryAd', 'entryAdId', 'postId', 'storyId', 'colorChoice', 'sizeInput', 'recommendedSize',
                            'sizeOutOfRange', 'sizeOorReason', 'available', 'orderIntent', 'setPick', 'setMode', 'setParent', 'productJustPresented'].forEach((k) => { delete ctx[k]; });
                        ctx.adminEngaged = true;
                        ctx.handoffKind = 'product_unknown';
                        runtime.dialogHistory = {};
                        runtime.lastUserMessage = '';
                        runtime.waitingForUser = true;
                        runtime.currentNodeId = null;
                        break;
                    }
                    if (data.outputVar && !isUserConfirmExit) {
                        const outputPath = String(data.outputVar).replace(/^context\./, '');
                        setByPath(ctx, outputPath, exit.parsed !== null ? exit.parsed : responseText);
                    }

                    // Аудит 2026-08-31 (запит власника, "розумні нагадування" — виняток
                    // "нема потрібного кольору"): той самий патерн, що вже є для
                    // exit.parsed.handoff вище — УНІВЕРСАЛЬНО (не лише n_color, будь-яка
                    // claude dialog-нода) промотуємо colorUnavailable/color на РІВЕНЬ
                    // context root, а не лише всередину outputVar (напр. context.colorChoice).
                    // checkZernioReminders (worker) читає САМЕ context.colorUnavailable —
                    // без цього прапорець був би похований у context.colorChoice.colorUnavailable,
                    // недосяжний без знання конкретного outputVar кожної ноди.
                    if (exit.parsed && typeof exit.parsed === 'object') {
                        if (exit.parsed.colorUnavailable === true) ctx.colorUnavailable = true;
                        else if (exit.parsed.color) ctx.colorUnavailable = false;
                    }

                    // Проблема 1 (аудит 2026-09-03, живий кейс goverla_shop, ФІНАНСОВИЙ
                    // РИЗИК): клієнт уже обрав спосіб оплати (n_pay_collect позаду, лінк
                    // на оплату вже надіслано), і на будь-якій НАСТУПНІЙ claude dialog-ноді
                    // (напр. n_collect — збір адреси) пише "передумав, краще 1/2". Промпт цих
                    // нод має "відповідай текстом на побічне питання" — модель ЧЕСНО рахує
                    // нову суму словами, але СТАРИЙ ctx.payAmount/ctx.ibanPayUrl (той самий
                    // інвойс) лишався незмінним — клієнт міг заплатити не ту суму. Сигнал
                    // paymentMethodChange — УНІВЕРСАЛЬНИЙ, той самий патерн, що й handoff/
                    // colorUnavailable вище: БУДЬ-ЯКА claude dialog-нода (крім самої
                    // n_pay_collect, де це і так штатний перший вибір) може повернути
                    // {"paymentMethodChange":"cod"|"full"} у json_output. Рушій: 1) best-effort
                    // видаляє СТАРИЙ ibanoplata-інвойс (ліміт ~20 активних на акаунт), 2)
                    // оновлює context.paymentInfo.method, 3) повертає currentNodeId на
                    // n_intl_route (не напряму на n_pay_amount) — n_intl_route САМ форсує
                    // method:'full' для міжнародної доставки (правило "накладеного платежу
                    // міжнародно не буває"), тож перевикористовуємо той самий guard, а не
                    // дублюємо його тут. Далі граф іде штатно: n_pay_amount (нова сума) →
                    // n_skip_payment_cond → n_iban_invoice (СВІЖИЙ інвойс з правильною сумою)
                    // → n_requisites (новий лінк) → назад у збір адреси. Захист від інших
                    // ботів: стрибок лише якщо в ЦЬОМУ flow.nodes реально є n_intl_route/
                    // n_pay_amount — інакше сигнал просто ігнорується (guard нижче).
                    if (node.id !== 'n_pay_collect' && exit.parsed && typeof exit.parsed === 'object') {
                        const _newPayMethod = exit.parsed.paymentMethodChange;
                        if (
                            (_newPayMethod === 'cod' || _newPayMethod === 'full')
                            && ctx.paymentInfo && ctx.paymentInfo.method
                            && ctx.paymentInfo.method !== _newPayMethod
                        ) {
                            const _payChangeTarget = paymentChangeTargetNode();
                            if (_payChangeTarget) {
                                await performPaymentMethodChange(_newPayMethod, _payChangeTarget);
                                continue;
                            }
                        }
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
                    // data.keepUserMessageOnExit (v3, 2026-09-04): нода-«шлюз» (n_welcome_back) не споживає
                    // повідомлення клієнта — воно йде далі наступній діалоговій ноді. Кейс: клієнт після паузи
                    // відповідає на старе питання ("182 90") — інакше n_size мовчки чекала б нового вводу.
                    if (data.keepUserMessageOnExit !== true) runtime.lastUserMessage = '';
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
                if (pendingTrace) { pendingTrace.branch = matchedIndex >= 0 ? ('cond#' + matchedIndex) : 'default'; pendingTrace.branchTarget = target || null; }
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

            if (pendingTrace) { pendingTrace.branch = result ? 'true' : 'false'; pendingTrace.branchTarget = pickNextNodeId(flow.edges, node.id, result ? 'true' : 'false'); }
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
                // First encounter — send a callback button so user can confirm homework done.
                // Повторний показ теж — якщо клієнт написав текстом замість кнопки, раніше
                // бот мовчав повністю; тепер нагадуємо про кнопку замість повної тиші.
                if (runtime.waitEventNodeId !== node.id || runtime.lastUserMessage) {
                    const buttonLabel = renderTemplate(String(data.buttonText || '✅ Домашнє завдання виконано'), scope);
                    const waitMsg = renderTemplate(String(data.waitMessage || 'Виконай домашнє завдання і натисни кнопку нижче, коли буде готово 👇'), scope);
                    await persistAssistantMessage(session.id, waitMsg, {
                        nodeId: node.id,
                        nodeType: 'wait_event_prompt',
                        keyboard: [[{ text: buttonLabel, callback_data: `hw_done:${eventKey}` }]],
                    });
                    lastAssistant = waitMsg;
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

            // Клієнт сам написав, поки бот "спав" на паузі (напр. n_followup_wait —
            // 20-годинна пауза перед нагадуванням) — раніше повідомлення просто
            // мовчки ігнорувалось до спливу таймера (реальний баг: власник написав
            // "Привіт" і НЕ отримав відповіді). Якщо це genuine вхідне повідомлення
            // (не рутинна перевірка таймера воркером) — пропускаємо очікування й
            // одразу продовжуємо потік, бо клієнт явно повернувся сам.
            if (runtime.lastUserMessage) {
                runtime.waitUntil = null;
                runtime.waitNodeId = null;
                runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                continue;
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
                // Клієнт написав, поки чекаємо підтвердження оплати — НЕ пропускаємо
                // очікування (це б обходило перевірку оплати), але й не мовчимо повністю:
                // одна коротка відповідь на "сесію очікування" (не на кожне повідомлення).
                if (runtime.lastUserMessage && runtime.waitPaymentAckNodeId !== node.id) {
                    runtime.waitPaymentAckNodeId = node.id;
                    const ackMsg = renderTemplate(String(data.waitingMessage || 'Ще очікуємо підтвердження оплати — щойно надійде, одразу продовжимо 🙂'), scope);
                    await persistAssistantMessage(session.id, ackMsg, { nodeId: node.id, nodeType: 'wait_payment_ack' });
                    lastAssistant = ackMsg;
                }
                runtime.waitingForUser = false;
                break;
            }

            runtime.waitPaymentUntil = null;
            runtime.waitPaymentNodeId = null;
            runtime.waitPaymentAckNodeId = null;
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
                    if (looksLikeBalanceError(httpStatus, responseText)) {
                        notifyAdminOfServiceOutage(session.id, `Платний сервіс ${hostFromUrl(url)}`, `HTTP ${httpStatus}: ${truncateStr(responseText, 300)}`).catch(() => {});
                    }
                }

                if (outputVar) {
                    try {
                        const parsed = JSON.parse(responseText);
                        const value = data.responseField ? getByPath(parsed, data.responseField) : parsed;
                        // ФІКС (2026-09-01): раніше логувався ПОВНИЙ value через JSON.stringify —
                        // для великих полів (напр. base64-картинка з slide-builder, 5-7MB рядок)
                        // це один синхронний console.log на кілька мегабайт, який відчутно
                        // затримує єдиний Node-процес двигуна; за цей час generation-watchdog
                        // встигав позначити пост "failed" ще до того, як цей-таки успішний рендер
                        // доходив до callback'а. Логуємо тільки прев'ю.
                        const _valStr = typeof value === 'string' ? value : JSON.stringify(value);
                        const _valPreview = _valStr && _valStr.length > 200 ? _valStr.slice(0, 200) + `...(${_valStr.length} chars total)` : _valStr;
                        console.log(`[httpRequest] responseField=${data.responseField} value=${_valPreview}`);
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
                if (looksLikeBalanceError(null, _error.message)) {
                    notifyAdminOfServiceOutage(session.id, `Платний сервіс ${hostFromUrl(url)}`, _error.message).catch(() => {});
                }
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
                    // notifyBalanceIssue(serviceLabel, message) — доступний усередині js-ноди
                    // для прямих fetch-викликів платних API (Gemini vision у n_lookup-code.js
                    // тощо), які самі ловлять свою помилку і не прокидають її сюди назовні.
                    const notifyBalanceIssue = (serviceLabel, message) =>
                        notifyAdminOfServiceOutage(session.id, String(serviceLabel || 'Зовнішній сервіс'), String(message || '')).catch(() => {});
                    // Support async/await in JS nodes (fetch, Buffer, crypto, etc.)
                    // new Function wraps user code in async IIFE so top-level await works
                    const asyncResult = await Promise.race([
                        new Function(
                            'context','user','session','input','keys','fetch','Buffer','FormData','Blob','console','crypto','notifyBalanceIssue',
                            'return (async function(){"use strict";\n' + code + '\n})();'
                        )(ctx, sandbox.user, sandbox.session, sandbox.input, sandbox.keys || {}, fetch, Buffer, FormData, Blob, console, require('crypto'), notifyBalanceIssue),
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
                    if (looksLikeBalanceError(null, err.message)) {
                        notifyAdminOfServiceOutage(session.id, `JS-нода «${data.label || node.id}»`, err.message).catch(() => {});
                    }
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
                    // Фото несе attachment; текст-плейсхолдер «📸 Фото» не шлемо (клієнту зайвий).
                    await persistAssistantMessage(session.id, caption || '', {
                        nodeId: node.id,
                        nodeType: node.type,
                        attachment: { type: 'photo', url: photoUrl, caption },
                    });

                    if (caption) {
                        lastAssistant = caption;
                    }
                } else {
                    // Аудит 2026-09-01 (Проблема 4, централізація): детермінований sendPhoto-
                    // вузол мовчки пропускав крок, коли photoVar порожній/невалідний — клієнт
                    // не бачив ЖОДНОГО повідомлення про це (нода просто немов не існувала), і
                    // менеджер теж ніколи не дізнавався. Той самий принцип, що вже діє для
                    // wantsPhoto/wantsUpsellPhoto (claude-ноди): порожній URL — це не "нічого
                    // не сталось", а "обіцянку виконати не вдалось", і ЦЕ завжди має падати в
                    // ескалацію менеджеру.
                    pushDelivery(runtime, 'sendPhoto', false, 'немає валідного ' + photoVar, { nodeId: node.id });
                    await notifyAdminPhotoMissing(session, ctx, funnelEnv, runtime, 'з ноди «' + (data.label || node.id) + '»');
                }
            } catch (_error) {
                pushDelivery(runtime, 'sendPhoto', false, 'помилка: ' + (_error && _error.message || String(_error)), { nodeId: node.id });
                await notifyAdminPhotoMissing(session, ctx, funnelEnv, runtime, 'з ноди «' + (data.label || node.id) + '» (технічна помилка)').catch(() => {});
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
                // Best-effort збагачення (бонусне поле tg_bio/tg_photo_url, є fallback —
                // просто лишається порожнім) — сповіщаємо адміна, але не блокуємо діалог.
                notifyAdminOfServiceOutage(session.id, 'Telegram API (профіль клієнта — bio/фото)', tgError.message).catch(() => {});
            }

            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'notifyTg') {
            if (ctx.testMode) { runtime.currentNodeId = pickNextNodeId(flow.edges, node.id); continue; }
            try {
                const _chat = funnelEnv[data.targetKey || 'ADMIN_TELEGRAM_ID'] || '';
                const _tok = funnelEnv.TELEGRAM_BOT_TOKEN || '';
                const _msg = shopPrefix(funnelEnv) + renderTemplate(data.message || '', scope);
                if (_chat && _tok && /^\d+:[A-Za-z0-9_-]{20,}$/.test(_tok) && _msg) {
                    const _r = await fetch('https://api.telegram.org/bot' + _tok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(_chat), text: _msg, parse_mode: 'HTML', disable_web_page_preview: true }) }).catch(function(e){ console.error('[notifyTg] ' + e.message); return null; });
                    const _j = _r ? await _r.json().catch(() => ({})) : {};
                    pushDelivery(runtime, 'telegram_notify', !!_j.ok, _j.ok ? null : (_j.description || 'fetch failed'), { nodeId: node.id, chatId: String(_chat) });
                } else {
                    pushDelivery(runtime, 'telegram_notify', false, 'немає chat_id/токена або порожній текст', { nodeId: node.id, chatId: String(_chat || '') });
                }
            } catch (e) { console.error('[notifyTg] ' + e.message); pushDelivery(runtime, 'telegram_notify', false, e.message, { nodeId: node.id }); }
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
                        // Ключ ВОРОНКИ має пріоритет над системним: у кожного магазину своя група,
                        // а системний id часто особистий — бот не може писати юзеру, який йому не писав.
                        ADMIN_TELEGRAM_ID: funnelEnv.ADMIN_TELEGRAM_ID || scope.env.ADMIN_TELEGRAM_ID || adminTelegramIdValue || process.env.ADMIN_TELEGRAM_ID || '',
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
                const adminMessage = shopPrefix(funnelEnv) + renderTemplate(data.message || 'Нова подія в системі.', enrichedScope);

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
                        const _r = await fetch(`https://api.telegram.org/bot${notifyToken}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: String(adminTelegramId), text: adminMessage, parse_mode: 'HTML', disable_web_page_preview: true }),
                        }).catch((e) => { console.error('[notifyAdmin] fetch error:', e.message); return null; });
                        const _j = _r ? await _r.json().catch(() => ({})) : {};
                        pushDelivery(runtime, 'telegram_notify', !!_j.ok, _j.ok ? null : (_j.description || 'fetch failed'), { nodeId: node.id, chatId: String(adminTelegramId) });
                    } else {
                        // Legacy fallback
                        await sendMessage(String(adminTelegramId), adminMessage, { parse_mode: 'HTML' }, session.id);
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
                    const fbRes = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
                    });
                    if (!fbRes.ok) {
                        const fbErrText = await fbRes.text().catch(() => '');
                        console.warn('[fbEvent] CAPI non-ok:', fbRes.status, fbErrText.slice(0, 200));
                        // Чисто аналітика (конверсії для реклами) — не впливає на клієнта, тому
                        // лише сповіщаємо адміна best-effort (з дедупом), без зупинки діалогу.
                        notifyAdminOfServiceOutage(session.id, 'Meta CAPI (аналітика конверсій)', `HTTP ${fbRes.status}: ${fbErrText.slice(0, 200)}`).catch(() => {});
                    }
                } catch (e) {
                    console.warn('[fbEvent] CAPI best-effort fail:', e.message);
                    notifyAdminOfServiceOutage(session.id, 'Meta CAPI (аналітика конверсій)', e.message).catch(() => {});
                }
            }
            runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
            continue;
        }

        if (node.type === 'funnelStage') {
            // Контрольна точка воронки — ЧИСТО для аналітики конверсії (звідки будується
            // графік-воронка на дашборді CRM). Назва/порядок довільні — задає автор воронки,
            // бо в різних воронках етапи різні. Best-effort: ніколи не блокує і не спиняє
            // виконання, немає ключів → тихо пропускає (як fbEvent вище).
            try {
                const stageName = renderTemplate(String(data.stageName || data.label || ''), scope).trim();
                // CRM_API_URL (голий origin, старе очікування) або CRM_API_BASE (вже з /api,
                // конвенція з n_crm_order/n_ttn_sync_crm — 2026-09-02) — приймаємо обидва,
                // нормалізуємо так, щоб не здвоїти "/api" у фінальному шляху.
                const rawBase = String(scope.env?.CRM_API_URL || scope.env?.CRM_API_BASE || '').trim().replace(/\/$/, '');
                const crmApiUrl = rawBase && !rawBase.endsWith('/api') ? `${rawBase}/api` : rawBase;
                const crmApiKey = String(scope.env?.CRM_API_KEY || '').trim();
                // 2026-09-04: тестові сесії (testMode / isTest) НЕ пишемо в аналітику CRM — вони засмічували
                // графік-воронку (43 "презентації" за день тестів).
                if (stageName && crmApiUrl && crmApiKey && !ctx.testMode && session.isTest !== true) {
                    const botRow = await db.bot.findUnique({ where: { id: session.botId }, select: { slug: true } }).catch(() => null);
                    const fsRes = await fetch(`${crmApiUrl}/funnel-events`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${crmApiKey}` },
                        body: JSON.stringify({
                            funnelSlug: botRow?.slug || session.botId,
                            sessionId: session.id,
                            stageName,
                            stageOrder: Number(data.stageOrder) || 0,
                        }),
                    }).catch((e) => { console.warn('[funnelStage] CRM best-effort fail:', e.message); notifyAdminOfServiceOutage(session.id, 'CRM funnel-events (аналітика етапів воронки)', e.message).catch(() => {}); return null; });
                    if (fsRes && !fsRes.ok) {
                        notifyAdminOfServiceOutage(session.id, 'CRM funnel-events (аналітика етапів воронки)', `HTTP ${fsRes.status}`).catch(() => {});
                    }
                    // 2026-09-05 (запит власника: картка замовлення в CRM не рухалась по воронці): якщо
                    // замовлення в CRM уже створене — переводимо його на стадію з ТІЄЮ Ж назвою, що й
                    // етап воронки (стадії pipeline у CRM названі як етапи). Best-effort.
                    if (ctx.crmOrderId && !String(ctx.crmOrderId).startsWith('TEST-')) {
                        try {
                            const _pr = await fetch(`${crmApiUrl}/pipelines`, { headers: { Authorization: `Bearer ${crmApiKey}` } });
                            const _pj = _pr.ok ? await _pr.json().catch(() => ({})) : {};
                            let _stageId = null;
                            const _want = stageName.toLowerCase();
                            for (const _p of (Array.isArray(_pj.data) ? _pj.data : [])) { const _hit = (_p.stages || []).find((s) => String(s.name || '').trim().toLowerCase() === _want); if (_hit) { _stageId = _hit.id; break; } }
                            if (_stageId) await fetch(`${crmApiUrl}/orders/${ctx.crmOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${crmApiKey}` }, body: JSON.stringify({ stageId: _stageId }) }).catch(() => {});
                        } catch (_e) { /* best-effort */ }
                    }
                }
            } catch (e) {
                console.warn('[funnelStage] best-effort fail:', e.message);
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
                    // Проблема 2 (аудит 2026-09-03, живий кейс: реквізити читались із
                    // funnelEnv.FOP_NAME/CODE/IBAN — застарілий per-bot ФОП, не бачив зміни
                    // активного ФОП у новій CRM). Тепер: якщо в funnelKey воронки є CRM_API_KEY
                    // (+CRM_API_BASE/CRM_API_URL) — питаємо АКТИВНОГО ФОП (isActive:true) у CRM
                    // ПЕРЕД funnelEnv.FOP_*. Best-effort, короткий таймаут (3с): якщо CRM
                    // недоступна / ключа нема / активного ФОП нема / у нього немає iban —
                    // тихо падаємо назад на СТАРУ funnelKey-логіку нижче (нічого не ламаємо,
                    // якщо CRM недоступна). Той самий підхід (Bearer tenant.apiKey, нормалізація
                    // /api) що вже є у funnelStage-ноді (n_crm_order/n_ttn_sync_crm, 2026-09-02).
                    let crmActiveFop = null;
                    try {
                        const _crmRawBase = String(funnelEnv.CRM_API_URL || funnelEnv.CRM_API_BASE || '').trim().replace(/\/$/, '');
                        const _crmApiUrl = _crmRawBase && !_crmRawBase.endsWith('/api') ? `${_crmRawBase}/api` : _crmRawBase;
                        const _crmApiKey = String(funnelEnv.CRM_API_KEY || '').trim();
                        if (_crmApiUrl && _crmApiKey) {
                            const _fopAc = new AbortController();
                            const _fopTo = setTimeout(() => { try { _fopAc.abort(); } catch (_e) { /* noop */ } }, 3000);
                            try {
                                const _fr = await fetch(`${_crmApiUrl}/fops`, { headers: { Authorization: `Bearer ${_crmApiKey}` }, signal: _fopAc.signal });
                                if (_fr.ok) {
                                    const _fj = await _fr.json().catch(() => ({}));
                                    const _list = Array.isArray(_fj.data) ? _fj.data : [];
                                    const _active = _list.find((f) => f && f.isActive === true && f.name && f.iban);
                                    if (_active) crmActiveFop = _active;
                                }
                            } finally { clearTimeout(_fopTo); }
                        }
                    } catch (_e) { /* best-effort — фолбек на funnelKey нижче */ }

                    // Ключі: перевага funnelEnv (ключі воронки) → потім збережений конектор.
                    const apiKey = (funnelEnv.IBANOPLATA_API_KEY || config.api_key || config.apiKey || '').trim();
                    const orgName = renderTemplate(data.organizationName || (crmActiveFop && crmActiveFop.name) || funnelEnv.FOP_NAME || config.organization_name || '', scope);
                    const idCode = renderTemplate(data.identificationCode || (crmActiveFop && crmActiveFop.taxId) || funnelEnv.FOP_CODE || config.identification_code || '', scope);
                    const iban = renderTemplate(data.iban || (crmActiveFop && crmActiveFop.iban) || funnelEnv.FOP_IBAN || config.iban || '', scope);
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
                    // Тест Олексія 2026-09-06 (17:11 і 22:24): двічі «fetch failed» рівно за ~10.4 с — це дефолтний
                    // connect-timeout undici, api.ibanoplata.com не відповів на зʼєднання (з сервера потім усе
                    // відкривалось за 0.1 с — перебій мережі/DNS). Робимо 2 спроби з явним таймаутом 15 с.
                    for (let _attempt = 1; _attempt <= 2 && !ibJson.ibanInvoiceUrl; _attempt++) {
                        if (_attempt > 1) await new Promise((res) => setTimeout(res, 1500));
                        const _ibAc = new AbortController();
                        const _ibTo = setTimeout(() => { try { _ibAc.abort(); } catch (_e) { /* noop */ } }, 15000);
                        try {
                            const r = await fetch('https://api.ibanoplata.com/v2/iban-invoice', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Api-Key': apiKey },
                                body: JSON.stringify(reqBody), signal: _ibAc.signal,
                            });
                            ibStatus = r.status;
                            ibJson = await r.json().catch(() => ({}));
                            if (!ibJson.ibanInvoiceUrl && r.status >= 400 && r.status < 500 && r.status !== 429) break; // 4xx (крім 429) — повтор не допоможе
                        } catch (e) { ibJson = { errorMessage: e.message + (_attempt > 1 ? ' (2 спроби)' : '') }; } finally { clearTimeout(_ibTo); }
                    }
                    const payUrl = ibJson.ibanInvoiceUrl || '';
                    if (payUrl) {
                        ctx.ibanPayUrl = payUrl;
                        ctx.ibanInvoiceUid = ibJson.ibanInvoiceUid || '';
                        ctx.ibanLinkFailed = false;
                        if (outputVar) setByPath(ctx, outputVar, payUrl);
                    } else {
                        // Посилання не створилось. Раніше (2026-09-01/02): фраза-заглушка «посилання ще генерується»
                        // + adminEngaged=true (бот зупинявся). Живий тест 2026-09-06: клієнт двічі питав «є посилання?
                        // надішли ще раз», одне повідомлення (18:20) лишилось без відповіді через паузу, менеджер
                        // посилання так і не надіслав. Тепер: бот НЕ зупиняється, ctx.ibanLinkFailed=true — воронка
                        // (n_iban_ok_cond) одразу віддає реквізити для ручної оплати; менеджера лише сповіщаємо.
                        ctx.ibanPayUrl = '';
                        ctx.ibanInvoiceUid = '';
                        ctx.ibanLinkFailed = true;
                        pushDelivery(runtime, 'ibanoplata_create_invoice', false, ibJson.errorMessage || ('HTTP ' + ibStatus), { nodeId: node.id });
                        notifyAdminPaymentLinkMissing(session, ctx, funnelEnv, runtime, 'посилання на оплату (ibanoplata) — клієнту автоматично надіслано реквізити для ручної оплати').catch(() => {});
                    }
                    db.apiCall.create({ data: {
                        sessionId: session.id, service: 'ibanoplata', method: 'create_invoice',
                        requestData: { amount: reqBody.amount, paymentPurpose, orderRef, fopSource: crmActiveFop ? 'crm' : 'funnelKey', fopName: orgName },
                        responseData: { ibanInvoiceUid: ibJson.ibanInvoiceUid || null, ibanInvoiceUrl: payUrl || null, error: ibJson.errorMessage || null },
                        statusCode: ibStatus, durationMs: Date.now() - ibStart,
                    } }).catch(() => {});
                }

                // ── monobank ФОП: отримання виписки (кредити) для звірки оплат ──
                // Кеш+лок у Redis (@platform/mono-statement) — спільний між усіма
                // одночасними сесіями (і api, і worker), захищає ліміт 1/60c навіть
                // коли десятки клієнтів чекають підтвердження одночасно.
                if (connectorType === 'monobank' && action === 'get_statement') {
                    // 2026-09-05 (живий тест Олексія): оплата пішла на рахунок АКТИВНОГО ФОП з CRM
                    // (Клімчук), а виписка бралась зі старого ключа MONO_TOKEN/MONO_ACCOUNT_ID (інший
                    // ФОП) — платіж "не знайдено" ніколи. Пріоритет: monobankToken активного ФОП у CRM
                    // (той самий, з якого ibanoplata бере IBAN), рахунок — через client-info (кеш у
                    // context.fop.monoAccountId); фолбек — ключі воронки.
                    // Мультитенантність (рішення власника 2026-09-05): банківські секрети живуть ТІЛЬКИ в CRM
                    // (активний ФОП), у ключах воронки їх нема і фолбеку на них нема.
                    let token = '';
                    let account = (renderTemplate(data.accountId || '0', scope) || '0').trim() || '0';
                    let monoFopSource = 'none';
                    try {
                        const _mRawBase = String(funnelEnv.CRM_API_URL || funnelEnv.CRM_API_BASE || '').trim().replace(/\/$/, '');
                        const _mApiUrl = _mRawBase && !_mRawBase.endsWith('/api') ? `${_mRawBase}/api` : _mRawBase;
                        const _mApiKey = String(funnelEnv.CRM_API_KEY || '').trim();
                        if (_mApiUrl && _mApiKey) {
                            const _mAc = new AbortController(); const _mTo = setTimeout(() => { try { _mAc.abort(); } catch (_e) { /* noop */ } }, 3000);
                            let _mFop = null;
                            try {
                                const _fr2 = await fetch(`${_mApiUrl}/fops`, { headers: { Authorization: `Bearer ${_mApiKey}` }, signal: _mAc.signal });
                                if (_fr2.ok) { const _fj2 = await _fr2.json().catch(() => ({})); _mFop = (Array.isArray(_fj2.data) ? _fj2.data : []).find((f) => f && f.isActive === true && f.monobankToken) || null; }
                            } finally { clearTimeout(_mTo); }
                            if (_mFop) {
                                token = String(_mFop.monobankToken).trim();
                                monoFopSource = 'crm:' + (_mFop.name || '');
                                const _cached = ctx.fop && ctx.fop.monoAccountId && ctx.fop.monoTokenHint === token.slice(0, 6) ? ctx.fop.monoAccountId : null;
                                if (_cached) account = _cached;
                                else {
                                    const _ciAc = new AbortController(); const _ciTo = setTimeout(() => { try { _ciAc.abort(); } catch (_e) { /* noop */ } }, 5000);
                                    try {
                                        const _ci = await fetch('https://api.monobank.ua/personal/client-info', { headers: { 'X-Token': token }, signal: _ciAc.signal });
                                        const _cij = _ci.ok ? await _ci.json().catch(() => ({})) : {};
                                        const _accs = Array.isArray(_cij.accounts) ? _cij.accounts : [];
                                        const _fopIban = String(_mFop.iban || '').replace(/\s/g, '');
                                        const _pick = _accs.find((a) => _fopIban && String(a.iban || '').replace(/\s/g, '') === _fopIban)
                                            || _accs.find((a) => String(a.type || '').toLowerCase() === 'fop' && Number(a.currencyCode) === 980)
                                            || _accs.find((a) => String(a.type || '').toLowerCase() === 'fop');
                                        if (_pick && _pick.id) { account = _pick.id; ctx.fop = Object.assign({}, ctx.fop || {}, { monoAccountId: _pick.id, monoTokenHint: token.slice(0, 6) }); }
                                    } catch (_e) { /* best-effort: лишаємо account з ключів */ } finally { clearTimeout(_ciTo); }
                                }
                            }
                        }
                    } catch (_e) { /* best-effort */ }
                    if (!token) {
                        // Немає активного ФОП з monobank-токеном у CRM — виписки нема, звірка дасть not_found,
                        // менеджер отримає штатний сигнал; у логах API видно причину.
                        ctx.monoStatement = [];
                        if (outputVar) setByPath(ctx, outputVar, []);
                        db.apiCall.create({ data: { sessionId: session.id, service: 'monobank', method: 'get_statement', requestData: { fopSource: 'none' }, responseData: { error: 'у CRM немає активного ФОП з monobankToken' }, statusCode: 0, durationMs: 0 } }).catch(() => {});
                        runtime.currentNodeId = pickNextNodeId(flow.edges, node.id);
                        continue;
                    }
                    const windowHours = parseInt(data.windowHours || 48, 10) || 48;
                    const monoStart = Date.now();
                    const { items, fromCache, status: monoStatus } = await getMonoStatement({ redisClient, token, account, windowHours });
                    const credits = (items || []).filter((t) => t && Number(t.amount) > 0).map((t) => ({
                        id: t.id, amountUah: Math.round(Number(t.amount)) / 100, time: t.time,
                        comment: t.comment || '', description: t.description || '',
                        counterName: t.counterName || '', counterIban: t.counterIban || '',
                    }));
                    ctx.monoStatement = credits;
                    // Глобальний реєстр уже зарахованих транзакцій (антидубль між сесіями) — Redis SET, atomic.
                    try {
                        const globalConsumed = await getMonoConsumedSet({ redisClient, botId: session.botId });
                        const sess = Array.isArray(ctx.consumedTxIds) ? ctx.consumedTxIds : [];
                        ctx.consumedTxIds = Array.from(new Set([...sess, ...globalConsumed]));
                    } catch (_e) { /* ignore */ }
                    if (outputVar) setByPath(ctx, outputVar, credits);
                    db.apiCall.create({ data: {
                        sessionId: session.id, service: 'monobank', method: 'get_statement',
                        requestData: { account, windowHours, fopSource: monoFopSource },
                        responseData: { count: credits.length, fromCache: !!fromCache },
                        statusCode: monoStatus || (fromCache ? 304 : null), durationMs: Date.now() - monoStart,
                    } }).catch(() => {});
                }

                // ── monobank: позначити транзакцію зарахованою у глобальному реєстрі ──
                // Redis SADD — atomic, без read-modify-write гонки при одночасних оплатах
                // (попередній варіант читав JSON-масив із funnelKey, редагував і писав
                // назад — дві одночасні оплати могли загубити одна одну).
                if (connectorType === 'monobank' && action === 'mark_consumed') {
                    const txId = (renderTemplate(data.txId || '{{context.payTxId}}', scope) || '').trim();
                    if (txId) await markMonoConsumed({ redisClient, botId: session.botId, txId });
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
                // startTrigger теж шаблон: без renderTemplate {{context.x}} доїжджало до
                // моделі як текст, і вона бачила назву змінної замість значення —
                // тобто ухвалювала рішення наосліп.
                || (data.dialogMode ? renderTemplate(data.startTrigger || 'Почни/продовж діалог: за потреби виклич get_profile, зрозумій поточний стан і став наступне питання або підсумуй.', agentScope) : '');
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

            // Інструменти ноди: локальні (описані у воронці) + отримані з MCP-серверів.
            const rawTools = Array.isArray(data.tools) ? data.tools : [];
            const claudeTools = rawTools.map((t) => ({
                name: t.name,
                description: t.description || t.name,
                input_schema: t.inputSchema || { type: 'object', properties: {}, required: [] },
            }));

            // MCP: каталог живе в продукті, а не у воронці. Заголовки рендеримо —
            // саме там їде секрет і companyId.
            const mcpServers = (Array.isArray(data.mcpServers) ? data.mcpServers : []).map((srv) => ({
                name: srv.name || srv.url,
                url: renderTemplate(String(srv.url || ''), agentScope),
                headers: Object.fromEntries(
                    Object.entries(srv.headers || {}).map(([k, v]) => [k, typeof v === 'string' ? renderTemplate(v, agentScope) : v]),
                ),
            })).filter((srv) => srv.url);

            let mcpOwner = new Map();
            if (mcpServers.length) {
                const collected = await mcpCollectTools(mcpServers);
                mcpOwner = collected.owner;
                // Локальні мають пріоритет: якщо назва збігається, воронка перекриває каталог.
                const localNames = new Set(claudeTools.map((t) => t.name));
                for (const t of collected.tools) {
                    if (localNames.has(t.name)) { mcpOwner.delete(t.name); continue; }
                    claudeTools.push(t);
                }
                logger.info('[agent node] MCP', {
                    servers: mcpServers.length, fromMcp: mcpOwner.size, total: claudeTools.length,
                });
            }

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

            // Агент-нода — це «чорна скринька»: на канвасі один прямокутник, а всередині
            // цикл із викликами інструментів. Тому пишемо в лог сесії, що саме модель
            // отримала на вхід — інакше при дивній поведінці нема за що зачепитись.
            logFlowApiCall({
                sessionId: session.id,
                service: 'agent',
                method: 'context',
                requestData: {
                    node: node.id,
                    model: agentModel,
                    systemPromptChars: String(systemPrompt || '').length,
                    tools: claudeTools.map((t) => t.name),
                    historyTurns: priorHistory.length,
                    userInput: String(agentUserInput || '').slice(0, 500),
                    contextKeys: Object.keys(agentScope.context || {}).slice(0, 40),
                },
                responseData: {},
                statusCode: null,
                durationMs: null,
            }).catch(() => {});

            let agentResponse = '';
            let agentDone = false;
            for (let iter = 0; iter < maxIterations; iter++) {
                let response;
                try {
                    // Кешування префікса. Порядок рендеру в API: tools → system → messages,
                    // тож точка кешу на system покриває і схеми інструментів.
                    // Без цього кожен оберт циклу (а їх до maxIterations на одне
                    // повідомлення) наново оплачує промпт і всі схеми за повною ціною.
                    response = await anthropic.messages.create({
                        model: agentModel,
                        max_tokens: agentMaxTokens,
                        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
                        tools: claudeTools.length > 0 ? claudeTools : undefined,
                        messages,
                    });
                } catch (e) {
                    logger.error('[agent node] Claude error', { nodeId: node.id, error: e.message });
                    agentResponse = `Помилка агента: ${e.message}`;
                    break;
                }

                // Чи спрацював кеш — видно тільки тут. Якщо cacheRead стабільно 0,
                // значить префікс щоразу різний і кеш не працює.
                const u = response.usage || {};
                logger.info('[agent node] usage', {
                    iter, in: u.input_tokens, out: u.output_tokens,
                    cacheWrite: u.cache_creation_input_tokens || 0,
                    cacheRead: u.cache_read_input_tokens || 0,
                });

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
                    // Інструмент із MCP — викликаємо через сервер каталогу.
                    const mcpSrv = mcpOwner.get(toolCall.name);
                    if (mcpSrv) {
                        const mcpStart = Date.now();
                        let mcpText = '';
                        let mcpErr = null;
                        try {
                            const r = await mcpCallTool(mcpSrv, toolCall.name, toolCall.input);
                            mcpText = r.text;
                            if (r.isError) mcpErr = r.text;
                        } catch (e) {
                            mcpText = `Інструмент недоступний: ${e.message}`;
                            mcpErr = e.message;
                        }
                        logFlowApiCall({
                            sessionId: session.id,
                            service: 'agent-mcp',
                            method: toolCall.name,
                            requestData: { input: toolCall.input, server: mcpSrv.name },
                            responseData: { preview: String(mcpText).slice(0, 800) },
                            statusCode: mcpErr ? null : 200,
                            durationMs: Date.now() - mcpStart,
                            error: mcpErr,
                        }).catch(() => {});
                        toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: mcpText });
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
                            // Заголовки теж рендеримо: без цього в них не можна покласти
                            // {{env.TOKEN}}, і жоден інструмент не дістанеться захищеного API.
                            const toolHeaders = { 'Content-Type': 'application/json' };
                            for (const [hk, hv] of Object.entries(toolDef.headers || {})) {
                                toolHeaders[hk] = typeof hv === 'string' ? renderTemplate(hv, toolScope) : hv;
                            }

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
                            const toolMs = Date.now() - httpStart;
                            logger.info('[agent node] Tool call', { tool: toolCall.name, status: httpRes.status, ms: toolMs });
                            logFlowApiCall({
                                sessionId: session.id,
                                service: 'agent-tool',
                                method: toolCall.name,
                                // Аргументи пише модель — саме вони найчастіше й пояснюють дивний результат.
                                requestData: { input: toolCall.input, url: resolvedUrl.split('?')[0] },
                                responseData: { preview: String(toolResult).slice(0, 800) },
                                statusCode: httpRes.status,
                                durationMs: toolMs,
                            }).catch(() => {});
                        } catch (e) {
                            toolResult = `Tool error: ${e.message}`;
                            logger.error('[agent node] Tool HTTP error', { tool: toolCall.name, error: e.message });
                            logFlowApiCall({
                                sessionId: session.id,
                                service: 'agent-tool',
                                method: toolCall.name,
                                requestData: { input: toolCall.input },
                                responseData: {},
                                statusCode: null,
                                durationMs: null,
                                error: e.message,
                            }).catch(() => {});
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

                // `messages` містить увесь хід: репліку людини, виклики інструментів і
                // їх результати. Зберігаємо саме його — інакше на наступному ході модель
                // не памʼятає, що повернув пошук, і «прочитай його» змушує шукати заново.
                const thisTurn = messages.slice(priorHistory.length);
                const budget = parseInt(data.historyBudgetChars, 10) || HISTORY_BUDGET_CHARS;
                runtime.dialogHistory[node.id] = trimDialogTurns([
                    ...priorHistory,
                    ...(thisTurn.length ? thisTurn : [{ role: 'user', content: histUser || 'Продовжуємо.' }]),
                    { role: 'assistant', content: agentResponse || 'Ок.' },
                ], budget);
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
    if (pendingTrace) _finalizeTrace(pendingTrace);

    // Тестовий режим — автоматичний рестарт воронки (2026-08-27, запит користувача).
    // Коли бот у ТЕСТОВОМУ РЕЖИМІ (bot.settings.testMode — перемикач бойовий/тестовий,
    // окремий від session.isTest) і ОСТАННЯ виконана в цьому кроці нода позначена
    // data.testRestartAfter===true — сесія одразу скидається на старт, а тестувальнику
    // йде повідомлення про це. Мітку ставлять НА ноди, де воронка передає діалог
    // менеджеру/зупиняється (типово — ПІСЛЯ повідомлення клієнту й сповіщення в
    // Telegram), щоб тестувальник міг одразу почати новий сценарій без ручного
    // рестарту сесії. Прапорець узагальнений — не hardcoded під конкретну воронку:
    // ставиться через MCP (update_node, довільне поле в data) або UI-редактор
    // (чекбокс "🔁 Перезапустити воронку в тестовому режимі" у панелі будь-якої ноди).
    const _lastVisitedId = runtime.nodesVisited[runtime.nodesVisited.length - 1];
    const _lastVisitedNode = _lastVisitedId ? nodesById.get(_lastVisitedId) : null;
    if (session.bot?.settings?.testMode === true && _lastVisitedNode?.data?.testRestartAfter === true) {
        const _restartMsg = '⚙️ Воронка перезапущена (тестовий режим) — можете почати заново.';
        await persistAssistantMessage(session.id, _restartMsg, { source: 'test_mode_auto_restart', nodeId: _lastVisitedNode.id });
        const _startNode = flow.nodes.find((n) => n.type === 'start') || flow.nodes[0];
        const _resetContext = {
            ...(ctx.testMode !== undefined ? { testMode: ctx.testMode } : {}),
            // Аудит 2026-08-27 (автовідповіді на коментарі, живий тест): якщо ця ж
            // нода-стоп спрацювала одразу після n_comment_entry (типово — товар не
            // визначено з emoji-коментаря), commentReplyText/commentId треба донести
            // до адаптера (він постить публічну відповідь ПІСЛЯ executeFlowStep) —
            // інакше рестарт стирав їх до того, як відповідь встигала піти.
            ...(ctx.commentReplyText !== undefined ? { commentReplyText: ctx.commentReplyText, commentCategory: ctx.commentCategory, commentId: ctx.commentId, commentMediaId: ctx.commentMediaId, commentReplyPosted: ctx.commentReplyPosted } : {}),
            flowRuntime: {
                currentNodeId: _startNode?.id || null,
                waitingForUser: false,
                nodesVisited: [],
                lastUserMessage: '',
                dialogHistory: {},
                // Аудит 2026-08-27: лог доставки (вкладка "Ноди" → "Доставка") раніше
                // стирався щоразу на рестарті — після кожного тестового рестарту
                // губився слід, чи реально пішло повідомлення. Переносимо в новий
                // flowRuntime (той самий ліміт/TTL, що й logDelivery, застосується
                // на наступному записі).
                deliveryLog: Array.isArray(runtime.deliveryLog) ? runtime.deliveryLog : [],
            },
        };
        const _restartedSession = await db.session.update({
            where: { id: session.id },
            data: {
                state: _startNode?.id || 'start',
                context: _resetContext,
                isActive: true,
                completedAt: null,
                lastActive: new Date(),
            },
        });
        return {
            session: _restartedSession,
            botResponse: _restartMsg,
            flowDriven: true,
            contextSnapshot: _resetContext,
            testModeRestarted: true,
        };
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
