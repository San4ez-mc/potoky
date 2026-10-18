'use strict';
/**
 * Етап 0 плану «правки → нуль» (13.10.2026): щоденний звіт якості й сторож «клієнт чекає менеджера».
 *  • 09:00 Київ — звіт за вчора кожній активній воронці з ключем QUALITY_REPORT=1: частка розмов бота з помилкою за класами
 *    (detectors.js), порівняння з позавчора, приклади з посиланнями → власнику (OWNER_TELEGRAM_ID, інакше ADMIN_TELEGRAM_ID);
 *    результат — у quality_daily (динаміка).
 *  • Кожні 5 хв, 08:00–22:00 Київ — клієнти, що чекають 15+ хв у розмові, яку веде менеджер (бот на паузі), — одним
 *    повідомленням у групу менеджерів (ADMIN_TELEGRAM_ID), кожен випадок раз. Розмови, де бот не на паузі, підхоплює сам бот
 *    (metaChannel.retryUnanswered).
 *  • Щодня — прибирання знімків ходів старших за 10 днів.
 */
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const Q = require('./detectors');

const kyivHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false }).format(new Date()));
const kyivDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(d); // YYYY-MM-DD
/** Межі доби за Києвом у UTC. */
function kyivDayBounds(dayStr) {
    const probe = new Date(dayStr + 'T12:00:00Z');
    const offH = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false }).format(probe)) - 12;
    const from = new Date(Date.parse(dayStr + 'T00:00:00Z') - offH * 3600 * 1000);
    return { from, to: new Date(from.getTime() + 24 * 3600 * 1000 - 1) };
}

async function keysOf(botId, names) {
    const rows = await db.funnelKey.findMany({ where: { botId, key: { in: names } }, select: { key: true, value: true } });
    return Object.fromEntries(rows.map((r) => [r.key, String(r.value || '').trim()]));
}
async function tg(token, chatId, text) {
    if (!token || !chatId) return false;
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    return !!j.ok;
}

async function reportBots() {
    const rows = await db.funnelKey.findMany({ where: { key: 'QUALITY_REPORT', value: { in: ['1', 'true', 'on', 'yes'] } }, select: { botId: true } });
    const out = [];
    for (const r of rows) { const b = await db.bot.findUnique({ where: { id: r.botId }, select: { id: true, isActive: true } }); if (b && b.isActive) out.push(b.id); }
    return out;
}

/** Звіт за добу (Київ) для воронки; send=false — лише порахувати й зберегти. */
async function dailyReport(botId, dayStr, { send = true } = {}) {
    const { from, to } = kyivDayBounds(dayStr);
    const res = await Q.qualityForPeriod(botId, from, to);
    const prevDay = kyivDay(new Date(from.getTime() - 12 * 3600 * 1000));
    const prevRow = await db.$queryRawUnsafe('select stats from quality_daily where "botId" = $1 and "day" = $2::date', botId, prevDay).catch(() => []);
    const prev = prevRow[0] && prevRow[0].stats;
    const stats = { clientConversations: res.clientConversations, botConversations: res.botConversations, defectSessions: res.defectSessions, defectRate: res.defectRate, byClass: res.byClass, examples: res.examples };
    await db.$executeRawUnsafe('insert into quality_daily ("id","botId","day","stats") values ($1,$2,$3::date,$4::jsonb) on conflict ("botId","day") do update set stats = excluded.stats, "createdAt" = now()',
        require('crypto').randomUUID(), botId, dayStr, JSON.stringify(stats));
    const k = await keysOf(botId, ['TELEGRAM_BOT_TOKEN', 'OWNER_TELEGRAM_ID', 'ADMIN_TELEGRAM_ID', 'SHOP_TAG']);
    const text = Q.formatReport(res, prev, { shopTag: k.SHOP_TAG, dayLabel: dayStr.split('-').reverse().slice(0, 2).join('.') });
    let sent = null;
    if (send) {
        // Звіт — власнику особисто (15.10: OWNER_TELEGRAM_ID не задано → звіт ішов у групу менеджерів, власник його не бачив).
        // Порядок: OWNER_TELEGRAM_ID воронки ботом воронки → системний чат власника (system_admin_telegram_id) системним ботом →
        // останній запас — група менеджерів. Результат Telegram перевіряємо, а не пишемо «надіслано» наосліп.
        const sys = async (type, field) => { try { const c = await db.savedConnector.findFirst({ where: { type, isActive: true }, orderBy: { updatedAt: 'desc' }, select: { config: true } }); return String((c && c.config && c.config[field]) || '').trim(); } catch (e) { return ''; } };
        const routes = [];
        if (k.OWNER_TELEGRAM_ID) routes.push([k.TELEGRAM_BOT_TOKEN, k.OWNER_TELEGRAM_ID, 'owner']);
        const sysChat = await sys('system_admin_telegram_id', 'value'); const sysTok = await sys('system_telegram_bot_token', 'token');
        if (sysChat && sysTok) routes.push([sysTok, sysChat, 'system_owner']);
        routes.push([k.TELEGRAM_BOT_TOKEN, k.ADMIN_TELEGRAM_ID, 'group']);
        for (const [tok, chat, via] of routes) { if (await tg(tok, chat, text)) { sent = via; break; } logger.warn('[quality] daily report: не доставлено через ' + via, { botId }); }
        if (sent) await db.$executeRawUnsafe(`update quality_daily set stats = stats || jsonb_build_object('sentAt', now()::text, 'sentVia', $3::text) where "botId" = $1 and "day" = $2::date`, botId, dayStr, sent).catch(() => {});
    }
    return { res, text, sent };
}
/** Звіт за цей день уже доставлено (позначка в БД, а не в памʼяті процесу — перезапуски сервера о 9-й слали його тричі). */
async function alreadySent(botId, dayStr) {
    const r = await db.$queryRawUnsafe(`select stats->>'sentAt' s from quality_daily where "botId" = $1 and "day" = $2::date`, botId, dayStr).catch(() => []);
    return !!(r[0] && r[0].s);
}

let _lastReportDay = null;
async function dailyTick() {
    if (kyivHour() !== 9) return;
    const today = kyivDay(new Date());
    if (_lastReportDay === today) return;
    _lastReportDay = today;
    const yesterday = kyivDay(new Date(Date.now() - 24 * 3600 * 1000));
    for (const botId of await reportBots()) {
        try {
            if (await alreadySent(botId, yesterday)) continue;
            const r = await dailyReport(botId, yesterday);
            logger.info('[quality] daily report ' + (r.sent ? 'sent via ' + r.sent : 'NOT delivered'), { botId, day: yesterday });
        }
        catch (e) { logger.warn('[quality] daily report failed: ' + e.message, { botId }); }
    }
    await db.$executeRawUnsafe("delete from agent_turns where \"createdAt\" < now() - interval '10 days'").catch(() => {});
}

// ── Сторож: клієнт чекає менеджера ──
const _waitingAlerted = new Map(); // sessionId -> id останнього повідомлення клієнта, про яке вже сказали
// Чи потребує останнє повідомлення клієнта відповіді — за ЗМІСТОМ (ШІ, останні повідомлення розмови), а не регуляркою закриття
// (16.10, Edits 17d2ae90/cada3f57/5eecd6f2, Олексій: «Так, зараз», «Є. Дякую», «Да есть, спасибо» → хибне «клієнт чекає»; «краще
// прибрати такі сповіщення»). Справжнє очікування (питання, дані, квитанція, «??») лишається. Результат кешуємо за id повідомлення.
const _needsReply = new Map();
async function needsReply(r, histOverride) {
    if (!histOverride && _needsReply.has(r.mid)) return _needsReply.get(r.mid);
    let v;
    try {
        const { callClaude, HELPER_MODEL } = require('@platform/claude');
        const msgs = await db.message.findMany({ where: { sessionId: r.id, role: { in: ['user', 'assistant'] } }, orderBy: { createdAt: 'desc' }, take: 8, select: { role: true, content: true, metadata: true } });
        const hist = histOverride || msgs.reverse().filter((m) => !(m.metadata && m.metadata.hidden)).map((m) => (m.role === 'user' ? 'КЛІЄНТ' : ((m.metadata || {}).source === 'zernio_inbox' ? 'МЕНЕДЖЕР' : 'БОТ')) + ': ' + String(m.content || '').replace(/\s+/g, ' ').slice(0, 300)).join('\n');
        const raw = await callClaude({ sessionId: r.id, systemPrompt: 'Ти визначаєш, чи клієнт інтернет-магазину чекає відповіді. Відповідаєш лише JSON.', messages: [{ role: 'user', content: 'Розмова (останнє — внизу):\n' + hist + '\n\nЧи потребує ОСТАННЄ повідомлення КЛІЄНТА відповіді або дії менеджера?\nНІ — подяка чи завершення («Є. Дякую», «Да есть, спасибо», «Супер»), підтвердження без питання («Так, зараз», «Добре», «+», «Ок»), обіцянка самого клієнта щось зробити («зараз напишу», «завтра наберу», «подумаю»).\nТАК — питання, прохання, скарга, надіслані дані / фото / квитанція / номер, на які треба відреагувати, нетерплячка («??», «ау», «чекаю»).\nJSON: {"needsReply": true|false}' }], options: { model: HELPER_MODEL, maxTokens: 30, extra: { temperature: 0 } } });
        const m = String(raw || '').match(/\{[\s\S]*\}/);
        v = m ? JSON.parse(m[0]).needsReply !== false : true;
    } catch (e) {
        const { isClosing } = require('./detectors'); // ШІ недоступний — як раніше
        v = !(isClosing(r.content) && !/(чека|жду|ждем|очіку)/i.test(String(r.content || '')));
    }
    _needsReply.set(r.mid, v); if (_needsReply.size > 3000) _needsReply.clear();
    return v;
}
let _waitingSentAt = 0;
async function waitingSentry() {
    const h = kyivHour(); if (h < 8 || h >= 22) return;
    if (Date.now() - _waitingSentAt < 15 * 60 * 1000) return;
    for (const botId of await reportBots()) {
        try {
            // Чекає: останнє — повідомлення клієнта, АБО бот сам передав розмову («менеджер напише вам тут») і відтоді тиша
            // (14.10, fdde77d9: «Ви людина?» → передача о 12:49, менеджер — о 20:47; сповіщення не було, бо останнім був бот).
            const rows = await db.$queryRawUnsafe(`select s.id, s.context->>'igUsername' ig, s.context->>'senderName' nm, m.id mid, m.content, m."createdAt" at, m.role
                from sessions s join lateral (select id, role, content, "createdAt", metadata from messages where "sessionId" = s.id and role in ('user','assistant') and coalesce(metadata->>'hidden','') <> 'true' order by "createdAt" desc limit 1) m on true
                where s."botId" = $1 and s."isActive" and not s."isTest" and s.context->>'funnelPaused' = 'true'
                  and s."lastActive" > now() - interval '4 hours'
                  and (m.role = 'user' or (m.metadata->>'source' = 'shop_agent' and coalesce(m.metadata->>'step', m.metadata->>'nodeId', '') ~ '(handoff|post_status_unknown_order|question_waiting|complaint|annoyed|insist|escalat|post_unknown)'))
                  and m."createdAt" < now() - interval '15 minutes' and m."createdAt" > now() - interval '4 hours'
                order by m."createdAt" asc limit 30`, botId);
            // Клієнт сам закрив розмову («Дякую», «Ні, дякую», «Подумаю») — відповідь менеджера не потрібна (14.10, власник: список
            // «чекають» на 7 з 9 рядків складався з «Дякую»). «Чекаю», «жду» тут — саме очікування менеджера, лишаємо.
            const cand = rows.filter((r) => _waitingAlerted.get(r.id) !== r.mid && !/^\[порожнє/.test(String(r.content || '')));
            const fresh = [];
            for (const r of cand) {
                if (r.role === 'user' && !(await needsReply(r))) { _waitingAlerted.set(r.id, r.mid); continue; } // не чекає — більше не перевіряємо
                fresh.push(r);
            }
            if (!fresh.length) continue;
            fresh.forEach((r) => _waitingAlerted.set(r.id, r.mid));
            if (_waitingAlerted.size > 2000) _waitingAlerted.clear();
            const k = await keysOf(botId, ['TELEGRAM_BOT_TOKEN', 'ADMIN_TELEGRAM_ID', 'SHOP_TAG']);
            const text = (k.SHOP_TAG ? '🏪 ' + k.SHOP_TAG + '\n' : '') + '⏳ Клієнти чекають відповіді менеджера (бот на паузі в цих розмовах):\n'
                + fresh.slice(0, 12).map((r) => '• ' + (r.ig || r.nm || 'клієнт') + ' — ' + Math.round((Date.now() - new Date(r.at).getTime()) / 60000) + ' хв — ' + (r.role === 'user' ? '«' + String(r.content || '').replace(/\s+/g, ' ').slice(0, 60) + '»' : 'бот передав вам розмову, відповіді ще нема') + ' https://flows.fineko.space/sessions/' + r.id).join('\n')
                + (fresh.length > 12 ? '\n… і ще ' + (fresh.length - 12) : '');
            if (await tg(k.TELEGRAM_BOT_TOKEN, k.ADMIN_TELEGRAM_ID, text)) _waitingSentAt = Date.now();
        } catch (e) { logger.warn('[quality] waiting sentry: ' + e.message, { botId }); }
    }
}

function start() {
    setTimeout(() => { dailyTick(); setInterval(dailyTick, 5 * 60 * 1000).unref(); }, 60 * 1000).unref();
    setTimeout(() => { waitingSentry(); setInterval(waitingSentry, 5 * 60 * 1000).unref(); }, 3 * 60 * 1000).unref();
}

module.exports = { start, dailyReport, kyivDayBounds, kyivDay, waitingSentry, _needsReply: needsReply };
