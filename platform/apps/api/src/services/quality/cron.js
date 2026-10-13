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
    if (send) await tg(k.TELEGRAM_BOT_TOKEN, k.OWNER_TELEGRAM_ID || k.ADMIN_TELEGRAM_ID, text);
    return { res, text };
}

let _lastReportDay = null;
async function dailyTick() {
    if (kyivHour() !== 9) return;
    const today = kyivDay(new Date());
    if (_lastReportDay === today) return;
    _lastReportDay = today;
    const yesterday = kyivDay(new Date(Date.now() - 24 * 3600 * 1000));
    for (const botId of await reportBots()) {
        try { await dailyReport(botId, yesterday); logger.info('[quality] daily report sent', { botId, day: yesterday }); }
        catch (e) { logger.warn('[quality] daily report failed: ' + e.message, { botId }); }
    }
    await db.$executeRawUnsafe("delete from agent_turns where \"createdAt\" < now() - interval '10 days'").catch(() => {});
}

// ── Сторож: клієнт чекає менеджера ──
const _waitingAlerted = new Map(); // sessionId -> id останнього повідомлення клієнта, про яке вже сказали
let _waitingSentAt = 0;
async function waitingSentry() {
    const h = kyivHour(); if (h < 8 || h >= 22) return;
    if (Date.now() - _waitingSentAt < 15 * 60 * 1000) return;
    for (const botId of await reportBots()) {
        try {
            const rows = await db.$queryRawUnsafe(`select s.id, s.context->>'igUsername' ig, s.context->>'senderName' nm, m.id mid, m.content, m."createdAt" at
                from sessions s join lateral (select id, role, content, "createdAt" from messages where "sessionId" = s.id and role in ('user','assistant') order by "createdAt" desc limit 1) m on true
                where s."botId" = $1 and s."isActive" and not s."isTest" and s.context->>'funnelPaused' = 'true'
                  and s."lastActive" > now() - interval '4 hours' and m.role = 'user'
                  and m."createdAt" < now() - interval '15 minutes' and m."createdAt" > now() - interval '4 hours'
                order by m."createdAt" asc limit 30`, botId);
            const fresh = rows.filter((r) => _waitingAlerted.get(r.id) !== r.mid && !/^\[порожнє/.test(String(r.content || '')));
            if (!fresh.length) continue;
            fresh.forEach((r) => _waitingAlerted.set(r.id, r.mid));
            if (_waitingAlerted.size > 2000) _waitingAlerted.clear();
            const k = await keysOf(botId, ['TELEGRAM_BOT_TOKEN', 'ADMIN_TELEGRAM_ID', 'SHOP_TAG']);
            const text = (k.SHOP_TAG ? '🏪 ' + k.SHOP_TAG + '\n' : '') + '⏳ Клієнти чекають відповіді менеджера (бот на паузі в цих розмовах):\n'
                + fresh.slice(0, 12).map((r) => '• ' + (r.ig || r.nm || 'клієнт') + ' — ' + Math.round((Date.now() - new Date(r.at).getTime()) / 60000) + ' хв — «' + String(r.content || '').replace(/\s+/g, ' ').slice(0, 60) + '» https://flows.fineko.space/sessions/' + r.id).join('\n')
                + (fresh.length > 12 ? '\n… і ще ' + (fresh.length - 12) : '');
            if (await tg(k.TELEGRAM_BOT_TOKEN, k.ADMIN_TELEGRAM_ID, text)) _waitingSentAt = Date.now();
        } catch (e) { logger.warn('[quality] waiting sentry: ' + e.message, { botId }); }
    }
}

function start() {
    setTimeout(() => { dailyTick(); setInterval(dailyTick, 5 * 60 * 1000).unref(); }, 60 * 1000).unref();
    setTimeout(() => { waitingSentry(); setInterval(waitingSentry, 5 * 60 * 1000).unref(); }, 3 * 60 * 1000).unref();
}

module.exports = { start, dailyReport, kyivDayBounds, kyivDay, waitingSentry };
