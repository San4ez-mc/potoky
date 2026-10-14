'use strict';
/**
 * Нагадування від бота в каналі Meta (2026-10-14, рішення власника: «так» — 2 год і 20 год, лише вдень).
 * Клієнт отримав від бота прохання (розмір, колір, оплата, адреса, «оформлюємо?») і замовк. Раніше нагадували лише менеджери
 * вручну (alexvansmith — через 78 хв), а нагадування воркера (checkZernioReminders) працювали тільки для каналу Zernio.
 * Правила:
 *   • 1-ше — через 2 год після прохання бота, 2-ге — через 20 год; не більше двох на одне прохання;
 *   • лише 9:00–21:00 за Києвом і лише у 24-годинному вікні Meta від останнього повідомлення клієнта (з запасом 23 год);
 *   • не нагадуємо: пауза / менеджер писав після бота / відмова, «подумаю», подяка / замовлення вже в CRM / тестова розмова.
 * Вмикається ключем воронки BOT_REMINDERS=1. Працює лише в platform-api (process.env.name).
 */
const { db } = require('@platform/db');
const logger = require('@platform/logger');

const ASK_STEP = /(ask_params|size_verify_ask|set_size_ask|ask_color|set_color_ask|pay_options|pay_options_repeat|pay_options_reshow|ask_address|ask_address_partial|order_intent|order_intent_repeat|set_ask)$/;
const SOFT_STEP = /(declined|soft_hesitate|_soft|thanks|post_decline|handoff|loop_handoff|question_waiting|complaint|annoyed)/;
const TEXTS = {
    params: ['Нагадаю 🙂 Щоб підібрати розмір, напишіть, будь ласка, ваш зріст і вагу.', 'Ще актуально? 🙂 Напишіть зріст і вагу — і я одразу підберу розмір.'],
    color: ['Нагадаю 🙂 Лишилось обрати колір — напишіть назву або номер зі списку вище.', 'Ще актуально? 🙂 Як оберете колір — напишіть, і оформимо.'],
    pay: ['Нагадаю 🙂 Оберіть, будь ласка, зручний спосіб оплати з повідомлення вище — 1 чи 2.', 'Ще актуально? 🙂 Напишіть 1 чи 2 — і я одразу надішлю дані для оплати.'],
    address: ['Нагадаю 🙂 Для відправки лишилось написати ПІБ, телефон, місто й відділення Нової пошти.', 'Ще актуально? 🙂 Напишіть дані для відправки — і оформлю замовлення.'],
    intent: ['Нагадаю 🙂 Оформлюємо замовлення? Якщо є питання — пишіть, підкажу.', 'Ще актуально? 🙂 Я на звʼязку — допоможу з оформленням.'],
};
function slotOfStep(step) {
    const s = String(step || '').split('+').pop();
    if (/ask_params|size_verify_ask|set_size_ask/.test(s)) return 'params';
    if (/color/.test(s)) return 'color';
    if (/pay_options/.test(s)) return 'pay';
    if (/ask_address/.test(s)) return 'address';
    return 'intent';
}
function kyivHour(now) { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false }).format(new Date(now))); }

/**
 * Що нагадати (чисте рішення, без БД — для тестів). lastBot — останнє повідомлення бота {step, at}; lastClientAt — час останнього
 * повідомлення клієнта; managerAfter — менеджер писав після бота; ctx — контекст розмови. Повертає { n, key, text } або null.
 */
function reminderFor({ lastBot, lastClientAt, managerAfter, ctx, now = Date.now() }) {
    if (!lastBot || !lastBot.step || !ASK_STEP.test(String(lastBot.step).split('+').pop()) || SOFT_STEP.test(String(lastBot.step))) return null;
    if (managerAfter || !ctx || ctx.funnelPaused || ctx.testMode || ctx.crmOrderId || ctx.declinedAt && now - Number(ctx.declinedAt) < 24 * 3600 * 1000) return null;
    if (!lastClientAt || new Date(lastClientAt).getTime() > new Date(lastBot.at).getTime()) return null; // клієнт уже відповів
    if (now - new Date(lastClientAt).getTime() > 23 * 3600 * 1000) return null; // поза 24-годинним вікном Meta
    const h = kyivHour(now); if (h < 9 || h >= 21) return null;
    const key = String(lastBot.id || lastBot.at);
    const done = (ctx.agent && ctx.agent.reminders && ctx.agent.reminders.key === key) ? ctx.agent.reminders.n : 0;
    const since = now - new Date(lastBot.at).getTime();
    const n = done === 0 && since >= 2 * 3600 * 1000 ? 1 : (done === 1 && since >= 20 * 3600 * 1000 ? 2 : 0);
    if (!n) return null;
    return { n, key, text: TEXTS[slotOfStep(lastBot.step)][n - 1] };
}

async function enabledBots() {
    const rows = await db.funnelKey.findMany({ where: { key: 'BOT_REMINDERS', value: { in: ['1', 'true', 'on', 'yes'] } }, select: { botId: true } });
    const out = [];
    for (const r of rows) { const ch = await db.funnelKey.findFirst({ where: { botId: r.botId, key: 'INBOUND_CHANNEL' }, select: { value: true } }); if (ch && String(ch.value).trim() === 'meta') out.push(r.botId); }
    return out;
}

async function tick() {
    const h = kyivHour(Date.now()); if (h < 9 || h >= 21) return;
    const mc = require('./metaChannel');
    for (const botId of await enabledBots().catch(() => [])) {
        // Кандидати: активні розмови, останнє — повідомлення бота від 2 до 23 год тому.
        const rows = await db.$queryRawUnsafe(`select s.id, s.context->>'psid' psid from sessions s join lateral (select role, "createdAt", metadata from messages where "sessionId" = s.id and role in ('user','assistant') and coalesce(metadata->>'hidden','') <> 'true' order by "createdAt" desc limit 1) m on true
            where s."botId" = $1 and s."isActive" and not s."isTest" and coalesce(s.context->>'funnelPaused','') <> 'true' and m.role = 'assistant' and m.metadata->>'source' = 'shop_agent'
              and m."createdAt" < now() - interval '2 hours' and m."createdAt" > now() - interval '23 hours' limit 100`, botId).catch((e) => { logger.warn('[reminders] query: ' + e.message); return []; });
        for (const r of rows) {
            try {
                const s = await db.session.findUnique({ where: { id: r.id }, select: { context: true } }); const ctx = (s && s.context) || {};
                const msgs = await db.message.findMany({ where: { sessionId: r.id, role: { in: ['user', 'assistant'] } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, role: true, createdAt: true, metadata: true } });
                const lastBotM = msgs.find((m) => m.role === 'assistant' && (m.metadata || {}).source === 'shop_agent' && !(m.metadata || {}).hidden && (m.metadata || {}).nodeId && !/reminder/.test(String((m.metadata || {}).nodeId)));
                const lastClient = msgs.find((m) => m.role === 'user');
                const managerAfter = !!(lastBotM && msgs.some((m) => m.role === 'assistant' && (m.metadata || {}).source === 'zernio_inbox' && m.createdAt > lastBotM.createdAt));
                const rem = reminderFor({ lastBot: lastBotM && { id: lastBotM.id, step: String((lastBotM.metadata || {}).step || (lastBotM.metadata || {}).nodeId || '').replace(/^agent:/, ''), at: lastBotM.createdAt }, lastClientAt: lastClient && lastClient.createdAt, managerAfter, ctx });
                if (!rem || !ctx.psid) continue;
                const mid = await mc.sendText(botId, ctx.psid, rem.text);
                await db.message.create({ data: { sessionId: r.id, role: 'assistant', content: rem.text, metadata: { source: 'shop_agent', nodeId: 'agent:reminder_' + rem.n, channel: 'meta', status: 'sent', metaMessageId: mid || null } } });
                const fresh = (await db.session.findUnique({ where: { id: r.id }, select: { context: true } })).context || {};
                await db.session.update({ where: { id: r.id }, data: { context: { ...fresh, agent: { ...(fresh.agent || {}), reminders: { key: rem.key, n: rem.n, at: new Date().toISOString() } } } } });
                logger.info('[reminders] нагадування ' + rem.n, { botId, sessionId: r.id });
            } catch (e) { logger.warn('[reminders] ' + e.message, { sessionId: r.id }); }
        }
    }
}

const __runsBackground = !process.env.name || process.env.name === 'platform-api';
if (__runsBackground) setTimeout(() => { tick().catch(() => {}); setInterval(() => tick().catch(() => {}), 10 * 60 * 1000).unref(); }, 4 * 60 * 1000).unref();

module.exports = { reminderFor, tick, slotOfStep };
