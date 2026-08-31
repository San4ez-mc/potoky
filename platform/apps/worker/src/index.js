'use strict';

require('dotenv').config();

const Bull = require('bull');
const { createClient } = require('redis');
const logger = require('@platform/logger');
const { db } = require('@platform/db');
const { getMonoStatement, hasFreshCache } = require('@platform/mono-statement');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Окремий redis-клієнт (не через Bull) — для mono-statement кешу, спільного з apps/api.
const monoRedisClient = createClient({ url: REDIS_URL });
monoRedisClient.on('error', (e) => logger.error('Mono redis client error', { message: e.message }));
monoRedisClient.connect().then(() => logger.info('Mono redis client connected', { redis: REDIS_URL })).catch((e) => logger.error('Mono redis connect failed', { message: e.message }));

// ── Queues ───────────────────────────────────────────────────
const telegramQueue = new Bull('telegram-messages', REDIS_URL);
const notificationQueue = new Bull('notifications', REDIS_URL);

// ── Processors ───────────────────────────────────────────────
telegramQueue.process(async (job) => {
    const { chatId, text, options } = job.data;
    const { sendMessage } = require('@platform/telegram');
    await sendMessage(chatId, text, options);
});

notificationQueue.process(async (job) => {
    const { text } = job.data;
    const { notifyOwner } = require('@platform/telegram');
    await notifyOwner(text);
});

// ── Error handlers ───────────────────────────────────────────
telegramQueue.on('failed', (job, error) => {
    logger.error('Telegram queue job failed', { jobId: job.id, error: error.message });
});

notificationQueue.on('failed', (job, error) => {
    logger.error('Notification queue job failed', { jobId: job.id, error: error.message });
});

// ── Follow-up checker ────────────────────────────────────────
// Runs every 30 min. Finds sessions where user went silent for >4h
// and sends one gentle follow-up message if configured.

const FOLLOW_UP_DELAY_HOURS = Number(process.env.FOLLOW_UP_DELAY_HOURS || 4);
const FOLLOW_UP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function sendFollowUpViaTelegram(token, chatId, text) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram API error: ${err}`);
    }
}

// ── NLM helper: generate unique re-engagement message ────────────────────────
async function getFollowUpFromNlm(nlmUrl, followUpNum, recentMsgs) {
    try {
        const ctx = recentMsgs
            .map(m => `${m.role === 'user' ? 'Клієнт' : 'Бот'}: ${String(m.content || '').slice(0, 300)}`)
            .join('\n');

        const queries = [
            `Склади перше ненав'язливе нагадування від продавця після 1 дня мовчання. Контекст діалогу:\n${ctx}\n\nВикористовуй техніки онлайн-продажів з бази знань. 2-3 речення, тепло, без тиску, одне відкрите питання наприкінці. Тільки текст повідомлення.`,
            `Склади останнє нагадування (через тиждень мовчання). Контекст:\n${ctx}\n\nВикористай несподіваний підхід — корисний інсайт, провокативне питання, або особисте спостереження. 2-3 речення, ненав'язливо. Тільки текст повідомлення.`,
        ];

        const query = queries[Math.min(followUpNum - 1, 1)];
        const res = await fetch(`${nlmUrl}/notebooks/content-rules/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: query }),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.answer?.trim() || null;
    } catch { return null; }
}

async function checkInactiveSessions() {
    try {
        // Broad cutoff — per-session timing is checked individually below
        const broadCutoff = new Date(Date.now() - 20 * 60 * 60 * 1000); // min 20h

        const staleSessions = await db.session.findMany({
            where: {
                isActive: true,
                isTest: false,
                state: { notIn: ['unsubscribed', 'completed'] },
                lastActive: { lte: broadCutoff },
            },
            include: {
                user: { select: { telegramId: true } },
                bot: { select: { id: true, name: true } },
            },
            orderBy: { lastActive: 'desc' },
        });

        // Dedup: only 1 follow-up per (userId, botId) pair per run
        const processedPairs = new Set();

        for (const session of staleSessions) {
            try {
                const pairKey = `${session.userId}:${session.botId}`;
                if (processedPairs.has(pairKey)) continue;

                const ctx = (typeof session.context === 'object' ? session.context : JSON.parse(session.context || '{}')) || {};
                const runtime = ctx.flowRuntime || {};

                if (!runtime.waitingForUser) continue;

                const followUpCount = ctx.followUpCount || 0;
                // Max 2 follow-ups: #1 after 24h, #2 after 7 days, then stop
                if (followUpCount >= 2) continue;

                // Timing per follow-up number
                const DELAYS_HOURS = [24, 168]; // 24h for 1st, 7 days for 2nd
                const requiredHours = DELAYS_HOURS[followUpCount] ?? 24;
                const requiredCutoff = new Date(Date.now() - requiredHours * 60 * 60 * 1000);
                if (session.lastActive > requiredCutoff) continue;

                const telegramId = session.user?.telegramId;
                if (!telegramId) continue;

                // Resolve token
                const allKeys = await db.funnelKey.findMany({
                    where: { botId: session.botId, key: { in: ['TELEGRAM_CONNECTOR_ID', 'TELEGRAM_BOT_TOKEN', 'NOTEBOOKLM_URL'] } },
                    select: { key: true, value: true },
                });
                const km = Object.fromEntries(allKeys.map(k => [k.key, k.value]));
                let token = null;
                if (km.TELEGRAM_CONNECTOR_ID) {
                    const sc = await db.savedConnector.findUnique({ where: { id: km.TELEGRAM_CONNECTOR_ID }, select: { config: true } });
                    token = sc?.config?.token || null;
                }
                if (!token) token = km.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || null;
                if (!token) continue;

                // Get last 6 messages for context
                const recentMsgs = await db.message.findMany({
                    where: { sessionId: session.id },
                    orderBy: { createdAt: 'desc' },
                    take: 6,
                    select: { role: true, content: true },
                });
                recentMsgs.reverse();

                // Generate unique follow-up via NLM, fallback to static key
                let followUpText = null;
                if (km.NOTEBOOKLM_URL) {
                    followUpText = await getFollowUpFromNlm(km.NOTEBOOKLM_URL, followUpCount + 1, recentMsgs);
                }
                if (!followUpText) {
                    const n = followUpCount + 1; // 1-based follow-up number
                    // Per-follow-up static keys (FOLLOW_UP_MESSAGE_1, _2, ...) let each
                    // reminder differ. Legacy single FOLLOW_UP_MESSAGE applies ONLY to #1,
                    // so a later follow-up is never an identical copy of the first.
                    const keyRows = await db.funnelKey.findMany({
                        where: { botId: session.botId, key: { in: [`FOLLOW_UP_MESSAGE_${n}`, 'FOLLOW_UP_MESSAGE'] } },
                        select: { key: true, value: true },
                    });
                    const km2 = Object.fromEntries(keyRows.map(k => [k.key, k.value]));
                    followUpText = km2[`FOLLOW_UP_MESSAGE_${n}`]
                        || (n === 1 ? km2['FOLLOW_UP_MESSAGE'] : null)
                        || (followUpCount === 0
                            ? `Привіт! 👋 Ми ще на зв'язку — якщо є питання, просто напиши. Буду радий допомогти! 😊`
                            : `Гей, востаннє нагадаю — без тиску. Якщо надумаєш — просто напиши. Удачі! 👋`);
                }

                await sendFollowUpViaTelegram(token, String(telegramId), followUpText);
                processedPairs.add(pairKey);

                const updatedCtx = { ...ctx, followUpCount: followUpCount + 1 };
                await db.session.update({ where: { id: session.id }, data: { context: updatedCtx } });

                // Mark other sessions of same user+bot
                const others = staleSessions.filter(s => s.userId === session.userId && s.botId === session.botId && s.id !== session.id);
                for (const other of others) {
                    const otherCtx = (typeof other.context === 'object' ? other.context : JSON.parse(other.context || '{}')) || {};
                    db.session.update({ where: { id: other.id }, data: { context: { ...otherCtx, followUpCount: 99 } } }).catch(() => {});
                }

                logger.info('Follow-up sent', { sessionId: session.id, followUpNum: followUpCount + 1, chatId: String(telegramId) });
            } catch (sessionError) {
                logger.warn('Follow-up failed for session', { sessionId: session.id, error: sessionError.message });
            }
        }
    } catch (err) {
        logger.error('Follow-up checker error', { error: err.message });
    }
}

// Start follow-up checker after a 2-minute warm-up delay
setTimeout(() => {
    checkInactiveSessions();
    setInterval(checkInactiveSessions, FOLLOW_UP_INTERVAL_MS);
}, 2 * 60 * 1000);

// ── Розумні нагадування для sales-воронок Zernio ─────────────────────────────
// прочитав, не відповів → 10 хв; не прочитав → 2 год; текст залежно від етапу;
// поважати «напишу після HH:MM» (+30хв); не нагадувати якщо оформлено; макс 3.
const ZERNIO_REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const REMINDER_STAGE_TEXT = {
    n_size: 'Підкажіть, будь ласка, ваш зріст і вагу — підберу найкращий розмір 🙂',
    n_color: 'Підкажіть, будь ласка, чи визначились із кольором? 😊',
    n_order_intent: 'Підкажіть, чи буде можливість оформити замовлення сьогодні? 🙂',
    n_order_cond: 'Підкажіть, чи буде можливість оформити замовлення сьогодні? 🙂',
    n_pay: 'Нагадую про оплату 🙌 Щойно надішлете підтвердження — одразу оформимо відправку.',
    n_pay_collect: 'Нагадую про оплату 🙌 Оберіть, будь ласка, спосіб — і продовжимо.',
    n_requisites: 'Нагадую про оплату 🙌 Реквізити вище — після оплати надішліть чек/скрін.',
    n_collect: 'Чекаю дані для відправки (ПІБ, телефон, місто, № відділення НП) 📦',
};
function parseAfterTime(text) {
    // «після 18:00», «після 18», «о 18:30» → час у мс (сьогодні). +30хв додаємо у виклику.
    const m = String(text || '').match(/(?:післ[яo]|опісля|о)\s*(\d{1,2})(?:[:.](\d{2}))?/i);
    if (!m) return null;
    const h = Number(m[1]); const mm = Number(m[2] || 0);
    if (h > 23 || mm > 59) return null;
    const d = new Date(); d.setHours(h, mm, 0, 0);
    return d.getTime();
}
// Аудит 2026-08-31 (запит власника, "розумні нагадування" — виняток №4): клієнт
// явно відклав рішення БЕЗ конкретного часу ("подумаю", "порадж(усь) з чоловіком/
// дружиною", "напишу пізніше") — на відміну від "напишу після 18:00" (вже покрито
// parseAfterTime вище). Детерміновано (regex, НЕ LLM — правило "критичні рішення —
// в коді", те саме, що вже застосовано для parseAfterTime). Якщо в тексті Є
// конкретний час — це НЕ vague-відкладення, той шлях уже обробляє parseAfterTime.
const DEFERRED_DECISION_RE = /(подумаю|подумати|треба\s*подумати|дайте\s*подумати|порад[жя](усь|уся|усь|итись|итися|итись)|порадит(ись|ися)|спитаю\s*(у\s*)?(чолов|дружин|сім[’'ʼ]?ї)|спрошу\s*(у\s*)?(муж|жен)|напишу\s*(пізніше|потім|згодом)|зателефоную\s*(пізніше|потім)|потім\s*напишу|дайте\s*час|потрібен\s*час|дай(те)?\s*подумати)/i;
function isVagueDeferral(text) {
    const t = String(text || '');
    if (!t.trim()) return false;
    if (parseAfterTime(t)) return false; // конкретний час — інший, вже покритий шлях
    return DEFERRED_DECISION_RE.test(t);
}
async function sendZernioReminder(botId, conversationId, text) {
    const rows = await db.funnelKey.findMany({ where: { botId, key: { in: ['ZERNIO_API_TOKEN', 'ZERNIO_SEND_URL', 'ZERNIO_ACCOUNT_ID'] } }, select: { key: true, value: true } });
    const km = Object.fromEntries(rows.map((k) => [k.key, (k.value || '').trim()]));
    if (!km.ZERNIO_API_TOKEN || km.ZERNIO_API_TOKEN === 'REPLACE_ME' || !conversationId) return false;
    const tmpl = km.ZERNIO_SEND_URL || 'https://zernio.com/api/v1/inbox/conversations/{conversationId}/messages';
    const url = tmpl.replace('{conversationId}', encodeURIComponent(conversationId));
    try {
        const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${km.ZERNIO_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: km.ZERNIO_ACCOUNT_ID || undefined, message: { text } }) });
        return res.ok;
    } catch (e) { logger.warn('[zernio-reminder] send failed', { error: e.message }); return false; }
}
async function checkZernioReminders() {
    try {
        const now = Date.now();
        const sessions = await db.session.findMany({
            where: {
                isActive: true, isTest: false,
                state: { notIn: ['completed', 'unsubscribed'] },
                lastActive: { lte: new Date(now - 10 * 60 * 1000), gte: new Date(now - 26 * 60 * 60 * 1000) },
                context: { path: ['channel'], equals: 'zernio' },
            },
            select: { id: true, botId: true, context: true, lastActive: true },
            take: 200,
        });
        for (const s of sessions) {
            try {
                const ctx = (typeof s.context === 'object' ? s.context : JSON.parse(s.context || '{}')) || {};
                const rt = ctx.flowRuntime || {};
                if (!rt.waitingForUser) continue;
                // Аудит 2026-08-31 (запит власника, 4 винятки для "розумних нагадувань"):
                // 1) sizeOutOfRange — клієнт поза сіткою розмірів, вже виставляється
                //    n_calc/n_size_oor ланцюжком (testSession.js) — немає сенсу нагадувати
                //    про товар, який ми самі ще не можемо запропонувати.
                // 2) colorUnavailable — клієнт хотів колір, якого нема (нове поле, рушій
                //    промотує з exit.parsed.colorUnavailable будь-якої claude dialog-ноди).
                // 3) crmOrderId/orderData — вже було, замовлення оформлено.
                if (ctx.adminEngaged || ctx.funnelPaused || ctx.crmOrderId || (ctx.orderData && ctx.orderData.fullName)
                    || ctx.sizeOutOfRange || ctx.colorUnavailable) continue;
                const rem = ctx.reminders || { count: 0, lastAt: 0 };
                if (rem.count >= 3) continue;
                // 4) клієнт явно відклав рішення без конкретного часу ("подумаю" тощо) —
                // довша пауза (24г) перед НАСТУПНИМ нагадуванням, а не звичайні 10хв/120хв.
                if (rem.deferUntil && now < rem.deferUntil) continue;

                const node = rt.currentNodeId || '';
                const ageMin = (now - new Date(s.lastActive).getTime()) / 60000;

                // статус останнього нашого повідомлення (read/delivered/sent)
                const lastAsst = await db.message.findFirst({ where: { sessionId: s.id, role: 'assistant' }, orderBy: { createdAt: 'desc' }, select: { metadata: true } });
                const status = (lastAsst && lastAsst.metadata && lastAsst.metadata.status) || 'sent';
                const read = status === 'read';

                // тригер за таймінгом
                if (read && ageMin < 10) continue;
                if (!read && ageMin < 120) continue;
                // не частіше ніж раз на 10 хв
                if (now - (rem.lastAt || 0) < 10 * 60 * 1000) continue;

                // поважати «напишу після HH:MM» з останніх повідомлень користувача
                const lastUser = await db.message.findFirst({ where: { sessionId: s.id, role: 'user' }, orderBy: { createdAt: 'desc' }, select: { content: true } });
                const after = parseAfterTime(lastUser && lastUser.content);
                if (after && now < after + 30 * 60 * 1000) continue;

                // Виняток №4: явне відкладення БЕЗ конкретного часу ("подумаю", "порадж(усь)
                // з чоловіком/дружиною", "напишу пізніше") — НЕ шлемо нагадування ЦЬОГО разу,
                // а ставимо довшу паузу (24г) перед НАСТУПНОЮ спробою замість звичайних 10хв/120хв.
                if (isVagueDeferral(lastUser && lastUser.content)) {
                    await db.session.update({ where: { id: s.id }, data: { context: { ...ctx, reminders: { ...rem, deferUntil: now + 24 * 60 * 60 * 1000 } } } }).catch(() => {});
                    logger.info('[zernio-reminder] vague deferral detected — pausing 24h', { sessionId: s.id, node });
                    continue;
                }

                const text = REMINDER_STAGE_TEXT[node] || 'Ми на звʼязку 🙂 Якщо є питання — просто напишіть, допоможу.';
                const ok = await sendZernioReminder(s.botId, ctx.conversationId, text);
                if (ok) {
                    await db.session.update({ where: { id: s.id }, data: { context: { ...ctx, reminders: { ...rem, count: rem.count + 1, lastAt: now, stage: node } } } }).catch(() => {});
                    logger.info('[zernio-reminder] sent', { sessionId: s.id, node, status, ageMin: Math.round(ageMin), n: rem.count + 1 });
                }
            } catch (e) { logger.warn('[zernio-reminder] session error', { sessionId: s.id, error: e.message }); }
        }
    } catch (err) { logger.error('[zernio-reminder] checker error', { error: err.message }); }
}
setTimeout(() => { checkZernioReminders(); setInterval(checkZernioReminders, ZERNIO_REMINDER_INTERVAL_MS); }, 3 * 60 * 1000);

// ── Авто-рестарт сесії після покупки або тривалої тиші ─────────────────────
// Ідея власника (2026-08-23): не лишати сесію "мертвою" назавжди на термінальній
// ноді (n_final/n_confirm) чи посеред покинутого діалогу. Коли клієнт УЖЕ купив
// АБО мовчить 24+ год — скидаємо стан воронки (сесію/історію НЕ видаляємо), щоб
// наступне повідомлення від тієї ж людини стартувало з початку графа, а не
// застрягало в старому контексті (чужий товар/колір/адреса з минулого разу).
const SESSION_RESET_INTERVAL_MS = 30 * 60 * 1000;
const SESSION_RESET_MIN_IDLE_MS = 60 * 60 * 1000; // грейс-період 1 год (не рвати діалог одразу після покупки, поки триває апсейл2)
// Поля, специфічні для ПОПЕРЕДНЬОГО проходу воронки — прибираємо, щоб наступний
// прохід не тягнув чужий товар/колір/адресу. Ідентичність (igUsername, senderName,
// conversationId, channel) і прапорці ручного керування (adminEngaged/funnelPaused/
// testMode) НЕ займаємо.
const VOLATILE_CONTEXT_KEYS = [
    'product', 'colorChoice', 'sizeInput', 'recommendedSize', 'sizeOutOfRange', 'sizeOorReason',
    'orderIntent', 'paymentInfo', 'orderData', 'np', 'ibanPayUrl', 'ibanInvoiceUid', 'payAmount',
    'payLabel', 'orderRef', 'orderQty', 'crmOrderId', 'crmClientId', 'orderSku', 'supplier',
    'supplierMechanism', 'supplierCfg', 'supplierSetBreakdown', 'supplierOrderResult', 'supplierOrderId',
    'supplierOrderStatus', 'supplierNeedsManual', 'supplierTtn', 'monoStatement', 'consumedTxIds',
    'payStatus', 'payVia', 'payTxId', 'reminders', 'followUpCount', 'upsell2', 'available',
    'entryAd', 'skipFollowup', 'lastReceiptImageUrl', 'lastUserImageUrl',
];
async function resetStaleOrCompletedSessions() {
    try {
        const now = Date.now();
        const sessions = await db.session.findMany({
            where: { isActive: true, isTest: false, lastActive: { lte: new Date(now - SESSION_RESET_MIN_IDLE_MS) } },
            select: { id: true, context: true, lastActive: true },
            take: 300,
        });
        for (const s of sessions) {
            try {
                const ctx = (typeof s.context === 'object' ? s.context : JSON.parse(s.context || '{}')) || {};
                if (!ctx.flowRuntime) continue; // не flow-сесія (напр. курс/контент-бот) — не чіпаємо
                if (ctx.adminEngaged || ctx.funnelPaused) continue; // людина зараз веде розмову — не втручаємось
                const lastActiveMs = new Date(s.lastActive).getTime();
                if (ctx.resetAt && lastActiveMs <= ctx.resetAt) continue; // вже скинуто, нової активності після скидання не було

                const ageHours = (now - lastActiveMs) / 3600000;
                const purchased = !!ctx.crmOrderId;
                const silentTooLong = ageHours >= 24;
                if (!purchased && !silentTooLong) continue;

                const cleanCtx = { ...ctx };
                for (const k of VOLATILE_CONTEXT_KEYS) delete cleanCtx[k];
                cleanCtx.flowRuntime = {}; // engine сам знайде start-ноду на наступному кроці
                cleanCtx.resetAt = now;
                cleanCtx.resetReason = purchased ? 'purchased' : 'silent_24h';

                await db.session.update({ where: { id: s.id }, data: { context: cleanCtx } });
                logger.info('[session-reset] сесію скинуто до старту воронки', { sessionId: s.id, reason: cleanCtx.resetReason, ageHours: Math.round(ageHours) });
            } catch (e) { logger.warn('[session-reset] session error', { sessionId: s.id, error: e.message }); }
        }
    } catch (err) { logger.error('[session-reset] checker error', { error: err.message }); }
}
setTimeout(() => { resetStaleOrCompletedSessions(); setInterval(resetStaleOrCompletedSessions, SESSION_RESET_INTERVAL_MS); }, 4 * 60 * 1000);

// ── Mono statement: фонове оновлення ЛИШЕ коли є сесія, що чекає оплату ───────
// Ідея власника (2026-08-20): не смикати Mono API, коли нікого немає в черзі
// підтвердження — тримати кеш "теплим" тільки за реальної потреби. Coordination
// (лок проти одночасних запитів з різних сесій) — у @platform/mono-statement.
const MONO_REFRESH_INTERVAL_MS = 45 * 1000; // з запасом під ліміт 1/60c
const MONO_PENDING_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 год — далі рахуємо кинутим кошиком

async function refreshMonoIfPending() {
    try {
        const botsWithMono = await db.funnelKey.findMany({
            where: { key: 'MONO_TOKEN', value: { not: '' } },
            select: { botId: true },
        });
        const botIds = [...new Set(botsWithMono.map((b) => b.botId))];
        if (!botIds.length) return;

        const sessions = await db.session.findMany({
            where: {
                botId: { in: botIds }, isTest: false,
                lastActive: { gte: new Date(Date.now() - MONO_PENDING_WINDOW_MS) },
            },
            select: { botId: true, context: true },
            take: 500,
        });
        const pendingBotIds = new Set();
        for (const s of sessions) {
            const ctx = (typeof s.context === 'object' ? s.context : JSON.parse(s.context || '{}')) || {};
            if (ctx.orderRef && ctx.payStatus !== 'confirmed') pendingBotIds.add(s.botId);
        }
        if (!pendingBotIds.size) return; // нікого не чекаємо — не смикаємо Mono взагалі

        for (const botId of pendingBotIds) {
            const rows = await db.funnelKey.findMany({ where: { botId, key: { in: ['MONO_TOKEN', 'MONO_ACCOUNT_ID'] } }, select: { key: true, value: true } });
            const km = Object.fromEntries(rows.map((k) => [k.key, (k.value || '').trim()]));
            if (!km.MONO_TOKEN) continue;
            const account = km.MONO_ACCOUNT_ID || '0';
            const fresh = await hasFreshCache({ redisClient: monoRedisClient, token: km.MONO_TOKEN, account });
            if (fresh) continue; // вже свіжо (можливо, хтось інший щойно оновив) — не дублюємо запит
            await getMonoStatement({ redisClient: monoRedisClient, token: km.MONO_TOKEN, account, windowHours: 48 }).catch((e) => {
                logger.warn('[mono-refresh] fetch failed', { botId, error: e.message });
            });
            logger.info('[mono-refresh] statement refreshed', { botId, pendingSessions: sessions.filter((s) => s.botId === botId).length });
        }
    } catch (err) { logger.error('[mono-refresh] checker error', { error: err.message }); }
}
setTimeout(() => { refreshMonoIfPending(); setInterval(refreshMonoIfPending, MONO_REFRESH_INTERVAL_MS); }, 20 * 1000);

// ── Morning homework reminder ─────────────────────────────────
// Runs every 30 min. Between 09:00-09:30 Kyiv time (UTC+2/+3),
// sends a reminder to users whose course session is stuck waiting
// for a homework event and who haven't received a reminder today.

const HOMEWORK_REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const KYIV_UTC_OFFSET_HOURS = 3; // UTC+3 (use 2 in winter if needed; +3 covers summer DST)

function isKyivMorningWindow() {
    const now = new Date();
    const kyivHour = (now.getUTCHours() + KYIV_UTC_OFFSET_HOURS) % 24;
    const kyivMinute = now.getUTCMinutes();
    return kyivHour === 9 && kyivMinute < 30;
}

function todayKyivDateStr() {
    const now = new Date();
    const kyivMs = now.getTime() + KYIV_UTC_OFFSET_HOURS * 3600 * 1000;
    return new Date(kyivMs).toISOString().slice(0, 10); // YYYY-MM-DD
}

async function resolveBotToken(botId) {
    // Prefer TELEGRAM_CONNECTOR_ID → savedConnector.config.token
    const keys = await db.funnelKey.findMany({
        where: { botId, key: { in: ['TELEGRAM_CONNECTOR_ID', 'TELEGRAM_BOT_TOKEN'] } },
        select: { key: true, value: true },
    });
    const keyMap = Object.fromEntries(keys.map(k => [k.key, k.value]));
    const connectorId = keyMap.TELEGRAM_CONNECTOR_ID;
    if (connectorId) {
        try {
            const connector = await db.savedConnector.findUnique({ where: { id: connectorId }, select: { config: true } });
            const t = connector?.config?.token;
            if (t && /^\d+:[A-Za-z0-9_-]{20,}$/.test(t.trim())) return t.trim();
        } catch { /* ignore */ }
    }
    const direct = keyMap.TELEGRAM_BOT_TOKEN?.trim();
    if (direct && /^\d+:[A-Za-z0-9_-]{20,}$/.test(direct)) return direct;
    return null;
}

async function sendReminderMessage(token, chatId, text) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Telegram API ${res.status}: ${err.slice(0, 200)}`);
    }
}

async function sendHomeworkReminders() {
    if (!isKyivMorningWindow()) return;

    const today = todayKyivDateStr();

    try {
        // Find active sessions that are paused at an event-wait node (homework gate)
        // runtime.waitEventNodeId is set when the wait node is in event mode and hasn't fired yet
        const activeSessions = await db.session.findMany({
            where: { state: { not: 'completed' } },
            include: {
                user: { select: { id: true, telegramId: true, firstName: true } },
                bot: { select: { id: true, name: true } },
            },
        });

        for (const session of activeSessions) {
            try {
                const ctx = (typeof session.context === 'object' ? session.context : {}) || {};
                const runtime = (typeof ctx.flowRuntime === 'object' ? ctx.flowRuntime : {}) || {};

                // Only sessions stuck waiting for a homework event
                if (!runtime.waitEventNodeId) continue;

                // Max 2 reminders: #1 on day 1, #2 on day 7. Use count+lastDate.
                const reminderCount = ctx.homeworkReminderCount || 0;
                if (reminderCount >= 2) continue; // Already sent both, stop

                // Check timing: #1 = first morning after getting stuck, #2 = 7 days later
                const lastSent = ctx.homeworkReminderLastDate; // YYYY-MM-DD
                if (reminderCount === 0) {
                    // Don't re-send today if somehow triggered twice
                    if (lastSent === today) continue;
                } else if (reminderCount === 1) {
                    // #2: wait 7 days from last sent date
                    if (lastSent) {
                        const daysSinceLast = (new Date(today) - new Date(lastSent)) / (1000 * 60 * 60 * 24);
                        if (daysSinceLast < 7) continue;
                    }
                }

                const telegramId = session.user?.telegramId;
                if (!telegramId) continue;

                const token = await resolveBotToken(session.botId);
                if (!token) continue;

                // Try NLM for unique reminder text
                const nlmKey = await db.funnelKey.findUnique({
                    where: { botId_key: { botId: session.botId, key: 'NOTEBOOKLM_URL' } },
                    select: { value: true },
                });

                let reminderText = null;
                const firstName = session.user?.firstName || 'друже';

                if (nlmKey?.value) {
                    const q = reminderCount === 0
                        ? `Склади мотивуюче нагадування студенту (ім'я: ${firstName}) про домашнє завдання. Він проходить курс і застрягнув на домашці. Коротко, тепло, підбадьорливо. 2 речення. Тільки текст.`
                        : `Склади останнє нагадування студенту (ім'я: ${firstName}) про домашнє завдання після 7 днів мовчання. М'яко, без тиску, з нагадуванням що урок чекає. 2 речення. Тільки текст.`;
                    reminderText = await getFollowUpFromNlm(nlmKey.value, reminderCount + 1, []);
                }

                if (!reminderText) {
                    const reminderKey = await db.funnelKey.findUnique({
                        where: { botId_key: { botId: session.botId, key: 'HOMEWORK_REMINDER_TEXT' } },
                        select: { value: true },
                    });
                    reminderText = reminderKey?.value
                        || (reminderCount === 0
                            ? `🌅 Доброго ранку, ${firstName}!\n\nНагадую, що тебе чекає домашнє завдання від Майкла. Виконай його і одразу отримаєш наступний урок! 💪`
                            : `👋 ${firstName}, тут ще є незакінчена практика від Майкла.\n\nКоли будеш готовий — повертайся, наступний урок вже чекає! 🎯`);
                }

                await sendReminderMessage(token, String(telegramId), reminderText);

                const updatedCtx = {
                    ...ctx,
                    homeworkReminderCount: reminderCount + 1,
                    homeworkReminderLastDate: today,
                };
                await db.session.update({ where: { id: session.id }, data: { context: updatedCtx } });

                logger.info('Homework reminder sent', {
                    sessionId: session.id, botId: session.botId, telegramId: String(telegramId),
                });
            } catch (err) {
                logger.warn('Homework reminder failed for session', {
                    sessionId: session.id, error: err.message,
                });
            }
        }
    } catch (err) {
        logger.error('Homework reminder checker error', { error: err.message });
    }
}

// Start homework reminder checker after warm-up
setTimeout(() => {
    sendHomeworkReminders();
    setInterval(sendHomeworkReminders, HOMEWORK_REMINDER_INTERVAL_MS);
}, 3 * 60 * 1000);

// ── Ф0.1: TTL-очистка processed_messages (ідемпотентність вхідних) ──
// Кожен Telegram-update пишеться в processed_messages для відсіву дублів.
// За ТЗ (Ф0.1) TTL = 48 год — старіші записи більше не потрібні (Telegram не
// ретраїть так довго). Раз на 6 год чистимо, щоб таблиця не росла безкінечно.
const PROCESSED_MSG_TTL_MS = 48 * 60 * 60 * 1000;
const PROCESSED_MSG_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function cleanupProcessedMessages() {
    try {
        const cutoff = new Date(Date.now() - PROCESSED_MSG_TTL_MS);
        const { count } = await db.processedMessage.deleteMany({ where: { createdAt: { lt: cutoff } } });
        if (count > 0) logger.info('Ф0.1: очищено старі processed_messages', { deleted: count, olderThan: cutoff.toISOString() });
    } catch (err) {
        logger.error('Ф0.1 processed_messages cleanup error', { error: err.message });
    }
}

// Старт після 4-хв прогріву, далі кожні 6 год
setTimeout(() => {
    cleanupProcessedMessages();
    setInterval(cleanupProcessedMessages, PROCESSED_MSG_CLEANUP_INTERVAL_MS);
}, 4 * 60 * 1000);

// ── Ретенція логів: трейси нод, лог доставки, api_calls, помилки ──────────────
// Логуємо все (щоб можна було розібрати «чому не прийшло»), але тримаємо обмежений
// час, інакше БД і context сесій роздуваються. Раз на добу.
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 14);
const LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function cleanupOldLogs() {
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86400000);
    try {
        const a = await db.apiCall.deleteMany({ where: { createdAt: { lt: cutoff } } });
        const e = await db.appError.deleteMany({ where: { createdAt: { lt: cutoff } } });
        // Трейси/лог доставки живуть у context сесій — чистимо в неактивних сесіях
        const stale = await db.session.findMany({
            where: { lastActive: { lt: cutoff } },
            select: { id: true, context: true },
            take: 500,
        });
        let trimmed = 0;
        for (const s of stale) {
            const ctx = s.context || {};
            const rt = ctx.flowRuntime;
            if (!rt || (!Array.isArray(rt.nodeTraces) && !Array.isArray(rt.deliveryLog))) continue;
            if (!rt.nodeTraces?.length && !rt.deliveryLog?.length) continue;
            const next = { ...ctx, flowRuntime: { ...rt, nodeTraces: [], deliveryLog: [] } };
            await db.session.update({ where: { id: s.id }, data: { context: next } }).catch(() => {});
            trimmed += 1;
        }
        if (a.count || e.count || trimmed) {
            logger.info('Ретенція логів', { apiCalls: a.count, appErrors: e.count, sessionsTrimmed: trimmed, olderThan: cutoff.toISOString(), days: LOG_RETENTION_DAYS });
        }
    } catch (err) {
        logger.error('Ретенція логів: помилка', { error: err.message });
    }
}

setTimeout(() => { cleanupOldLogs(); setInterval(cleanupOldLogs, LOG_CLEANUP_INTERVAL_MS); }, 5 * 60 * 1000);

// ── Broadcast queue ──────────────────────────────────────────
const broadcastQueue = new Bull('broadcasts', REDIS_URL);

async function sendTelegramMessage(token, chatId, msg) {
    const base = `https://api.telegram.org/bot${token}`;
    let method, body;

    if (msg.photoUrl) {
        method = 'sendPhoto';
        body = { chat_id: chatId, photo: msg.photoUrl, caption: msg.caption || msg.text || '', parse_mode: msg.parseMode || 'Markdown' };
    } else if (msg.documentUrl) {
        method = 'sendDocument';
        body = { chat_id: chatId, document: msg.documentUrl, caption: msg.caption || msg.text || '', parse_mode: msg.parseMode || 'Markdown' };
    } else {
        method = 'sendMessage';
        body = { chat_id: chatId, text: msg.text, parse_mode: msg.parseMode || 'Markdown', disable_web_page_preview: true };
    }

    const res = await fetch(`${base}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram ${method} error: ${err}`);
    }
}

async function getBotToken(botId) {
    // Check TELEGRAM_CONNECTOR_ID -> savedConnector
    const connectorKey = await db.funnelKey.findFirst({
        where: { botId, key: 'TELEGRAM_CONNECTOR_ID' },
    });
    if (connectorKey?.value) {
        const sc = await db.savedConnector.findUnique({ where: { id: connectorKey.value } });
        if (sc?.config?.token) return sc.config.token;
    }
    // Check TELEGRAM_BOT_TOKEN directly
    const tokenKey = await db.funnelKey.findFirst({
        where: { botId, key: 'TELEGRAM_BOT_TOKEN' },
    });
    return tokenKey?.value || null;
}

broadcastQueue.process(async (job) => {
    const { broadcastId } = job.data;
    const broadcast = await db.broadcast.findUnique({ where: { id: broadcastId } });
    if (!broadcast || broadcast.status === 'cancelled') return;

    await db.broadcast.update({ where: { id: broadcastId }, data: { status: 'sending' } });

    const recipients = Array.isArray(broadcast.recipients) ? broadcast.recipients : [];
    const message = broadcast.message || {};

    // Cache bot tokens
    const tokenCache = {};
    const getToken = async (botId) => {
        if (!tokenCache[botId]) tokenCache[botId] = await getBotToken(botId);
        return tokenCache[botId];
    };

    let sent = 0, failed = 0;
    const updatedRecipients = [...recipients];

    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        try {
            const token = await getToken(r.botId);
            if (!token) throw new Error('No bot token');
            await sendTelegramMessage(token, r.telegramId, message);
            updatedRecipients[i] = { ...r, sent: true };
            sent++;
        } catch (err) {
            const errMsg = String(err.message || '').toLowerCase();
            const isBlocked = errMsg.includes('blocked') || errMsg.includes('forbidden') || errMsg.includes('403') || errMsg.includes('deactivated');
            if (isBlocked && r.botId) {
                // Mark user session as unsubscribed
                db.session.updateMany({
                    where: { botId: r.botId, isActive: true, user: { telegramId: BigInt(r.telegramId) } },
                    data: { isActive: false, state: 'unsubscribed' },
                }).catch(() => {});
            }
            updatedRecipients[i] = { ...r, sent: false, error: err.message, unsubscribed: isBlocked };
            failed++;
            logger.error('Broadcast send error', { broadcastId, telegramId: r.telegramId, error: err.message, isBlocked });
        }
        // Rate limit: 30 msg/sec max, use 50ms delay
        if (i < recipients.length - 1) await new Promise(resolve => setTimeout(resolve, 50));
    }

    await db.broadcast.update({
        where: { id: broadcastId },
        data: {
            status: 'sent',
            sentAt: new Date(),
            stats: { total: recipients.length, sent, failed },
            recipients: updatedRecipients,
        },
    });

    logger.info('Broadcast completed', { broadcastId, sent, failed });
});

broadcastQueue.on('failed', (job, error) => {
    logger.error('Broadcast queue job failed', { jobId: job.id, error: error.message });
    db.broadcast.update({ where: { id: job.data.broadcastId }, data: { status: 'failed' } }).catch(() => {});
});

// ── Graceful shutdown ────────────────────────────────────────
async function shutdown() {
    logger.info('Worker shutting down...');
    await telegramQueue.close();
    await notificationQueue.close();
    await broadcastQueue.close();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info('Platform worker started', { redis: REDIS_URL });

module.exports = { telegramQueue, notificationQueue, broadcastQueue };
