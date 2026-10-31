'use strict';
/**
 * quality/stuckOrders.js — щоденний звіт менеджерам: прийняті замовлення без ТТН довше 5 робочих днів (31.10.2026).
 *
 * Чому: розбір тижня 24–30.10 показав, що «де моє замовлення / чому досі не відправили» — найбільший клас скарг і
 * непрочитаних питань (≈20 із 37 відкритих питань, 12 із 17 скарг). Замовлення губляться не через бота — бот сумлінно каже
 * «відправка до 5 робочих днів», а далі ніхто системно не стежить, доки клієнт сам не напише. Це лише ЧИТАННЯ з CRM і
 * повідомлення менеджерам (той самий канал, що й waitingSentry) — бот і клієнта цей код не чіпає.
 *
 * Стадії: рахуємо лише ті, де клієнт уже дав дані й оплату («Замовлення прийняте», «Замовлення оформлене в
 * постачальника») — до цього моменту відсутність ТТН очікувана. Повернення/обмін і відмови не рахуємо (там інший процес).
 */
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { loadAssets, crmFetch } = require('../shopAgent/lib');

// Порядок стадій CRM (lib/orderOps.js на боці CRM) — рахуємо лише ці двоï, бо до них немає ТТН не через застій,
// а тому, що клієнт ще не дав адресу/оплату; після «Відправлено» ТТН за визначенням уже є.
const STUCK_STAGES = /^(замовлення прийняте|замовлення оформлене в постачальника)$/i;
const WORKDAYS_THRESHOLD = 5;

/** N-й робочий день (пн–пт) тому від зараз, повертає Date. */
function workdaysAgo(n) {
    const d = new Date();
    let left = n;
    while (left > 0) {
        d.setDate(d.getDate() - 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) left--;
    }
    return d;
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

/** Прийняті замовлення без ТТН старші за 5 робочих днів — для одного магазину (botId з QUALITY_REPORT=1 і ключем CRM). */
async function stuckOrders(botId) {
    const assets = await loadAssets(botId);
    if (!assets.keys.CRM_API_KEY) return { ok: false, reason: 'no CRM key' };
    const cutoff = workdaysAgo(WORKDAYS_THRESHOLD);
    // ftFrom/ftTo фільтрує за placedAt (дата оформлення, не дата розмови) — беремо з запасом 25 днів, щоб не пропустити
    // давно забуті замовлення, далі відсікаємо віком самі.
    const from = new Date(cutoff.getTime() - 20 * 24 * 3600 * 1000);
    const r = await crmFetch(assets.keys, `/orders?ftFrom=${from.toISOString().slice(0, 10)}&ftTo=${cutoff.toISOString().slice(0, 10)}&take=500`, {}, 10000);
    if (!r.ok || !Array.isArray(r.data)) return { ok: false, reason: 'crm fetch failed: ' + r.status };
    const stuck = r.data.filter((o) => o.buyerId && (!o.ttn || !o.ttn.length) && !o.isRefused
        && !(o.returns || []).length && o.stage && STUCK_STAGES.test(String(o.stage.name || '')));
    stuck.sort((a, b) => new Date(a.placedAt || a.createdAt) - new Date(b.placedAt || b.createdAt));
    return { ok: true, stuck, cutoff };
}

function formatReport(stuck, { shopTag = '' } = {}) {
    const lines = [];
    if (shopTag) lines.push('🏪 ' + shopTag);
    lines.push('📦 Прийняті замовлення без ТТН довше ' + WORKDAYS_THRESHOLD + ' робочих днів (' + stuck.length + '):');
    for (const o of stuck.slice(0, 20)) {
        const who = (o.buyer && (o.buyer.igUsername || o.buyer.fullName)) || o.contactIg || o.contactName || 'клієнт';
        const days = Math.round((Date.now() - new Date(o.placedAt || o.createdAt).getTime()) / (24 * 3600 * 1000));
        const items = (o.items || []).map((it) => it.name).slice(0, 2).join(', ');
        lines.push('• ' + who + ' — ' + days + ' дн. тому, «' + (o.stage && o.stage.name) + '»' + (items ? ' — ' + items.slice(0, 60) : ''));
    }
    if (stuck.length > 20) lines.push('… і ще ' + (stuck.length - 20));
    lines.push('Перевірте в CRM: https://pcrm.fineko.space/orders');
    return lines.join('\n');
}

let _lastSentDay = null;
async function tick() {
    const kyivHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false }).format(new Date()));
    if (kyivHour !== 9) return; // одразу за щоденним звітом якості, той самий час
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
    if (_lastSentDay === today) return;
    _lastSentDay = today;
    const rows = await db.funnelKey.findMany({ where: { key: 'QUALITY_REPORT', value: { in: ['1', 'true', 'on', 'yes'] } }, select: { botId: true } });
    for (const { botId } of rows) {
        try {
            const bot = await db.bot.findUnique({ where: { id: botId }, select: { isActive: true } });
            if (!bot || !bot.isActive) continue;
            const r = await stuckOrders(botId);
            if (!r.ok) { if (r.reason !== 'no CRM key') logger.warn('[stuckOrders] ' + r.reason, { botId }); continue; }
            if (!r.stuck.length) continue;
            const k = await keysOf(botId, ['TELEGRAM_BOT_TOKEN', 'ADMIN_TELEGRAM_ID', 'SHOP_TAG']);
            const sent = await tg(k.TELEGRAM_BOT_TOKEN, k.ADMIN_TELEGRAM_ID, formatReport(r.stuck, { shopTag: k.SHOP_TAG }));
            logger.info('[stuckOrders] ' + (sent ? 'sent' : 'NOT delivered') + ', ' + r.stuck.length + ' замовлень', { botId });
        } catch (e) { logger.warn('[stuckOrders] tick failed: ' + e.message, { botId }); }
    }
}

function start() {
    setTimeout(() => { tick(); setInterval(tick, 5 * 60 * 1000).unref(); }, 90 * 1000).unref();
}

module.exports = { start, stuckOrders, formatReport, workdaysAgo, tick };
