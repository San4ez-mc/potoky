'use strict';
/**
 * quality/aiCostSync.js — вартість ШІ-бота по розмовах → картка розмови в CRM (04.11.2026, Edits Олексія 03.11).
 *
 * Олексій: «щоб я бачив, скільки реально заробляю» — у «Щоденній аналітиці» мають бути витрати на токени Claude. Токени кожного виклику моделі
 * вже пишуться в журнал викликів (api_calls: sessionId + inputTokens/outputTokens/кеш у responseData, модель у requestData). Раз на пів години
 * беремо розмови, де були виклики за останні 90 хвилин, рахуємо ПОВНУ суму за тарифами моделі й шлемо в CRM (POST /funnel-events/ai-cost —
 * перезапис, тож повтор і пропущений тік безпечні). CRM складає суму по днях початку розмови.
 *
 * Тарифи — USD за 1 млн токенів, публічні ціни провайдерів; нова модель без запису в таблиці рахується як Sonnet (щоб не занижувати).
 * Це оцінка: виклики Gemini-vision (розпізнавання фото/квитанцій), які не пишуться в журнал, сюди не входять.
 */
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { crmFetch } = require('../shopAgent/lib');

// [префікс моделі, вхід, вихід, читання кешу, запис кешу] — USD / 1M токенів
const PRICES = [
    ['claude-sonnet', 3, 15, 0.3, 3.75],
    ['claude-haiku-4', 1, 5, 0.1, 1.25],
    ['claude-haiku', 1, 5, 0.1, 1.25], // haiku-5-x: тариф уточнити, поки як у 4.5
    ['claude-opus', 5, 25, 0.5, 6.25],
    ['gemini', 0.3, 2.5, 0.03, 0.3],
];
const DEFAULT_PRICE = PRICES[0];
const WINDOW_MIN = 90;

function priceFor(model) {
    const m = String(model || '').toLowerCase();
    return PRICES.find((p) => m.startsWith(p[0])) || DEFAULT_PRICE;
}

/** Вартість одного запису {model, inp, outp, cr, cw} (токени), USD. */
function costOf(row) {
    const p = priceFor(row.model);
    return (Number(row.inp || 0) * p[1] + Number(row.outp || 0) * p[2] + Number(row.cr || 0) * p[3] + Number(row.cw || 0) * p[4]) / 1e6;
}

/** Повні суми по розмовах, де були виклики моделі за останні WINDOW_MIN хвилин: [{sessionId, botId, costUsd}]. */
async function recentSessionCosts() {
    const rows = await db.$queryRawUnsafe(`
        WITH recent AS (
            SELECT DISTINCT "sessionId" FROM api_calls
            WHERE service LIKE 'claude%' AND "sessionId" IS NOT NULL AND "createdAt" > now() - interval '${WINDOW_MIN} minutes'
        )
        SELECT a."sessionId" AS sid, s."botId" AS bot, COALESCE(a."requestData"->>'model', '') AS model,
               SUM(COALESCE((a."responseData"->>'inputTokens')::numeric, 0))::float8 AS inp,
               SUM(COALESCE((a."responseData"->>'outputTokens')::numeric, 0))::float8 AS outp,
               SUM(COALESCE((a."responseData"->>'cacheReadTokens')::numeric, 0))::float8 AS cr,
               SUM(COALESCE((a."responseData"->>'cacheWriteTokens')::numeric, 0))::float8 AS cw
        FROM api_calls a JOIN recent r ON r."sessionId" = a."sessionId" JOIN sessions s ON s.id = a."sessionId"
        WHERE a.service LIKE 'claude%'
        GROUP BY 1, 2, 3`);
    const by = new Map();
    for (const r of rows) {
        const e = by.get(r.sid) || { sessionId: r.sid, botId: r.bot, costUsd: 0 };
        e.costUsd += costOf(r);
        by.set(r.sid, e);
    }
    return [...by.values()];
}

async function keysOf(botId) {
    const rows = await db.funnelKey.findMany({ where: { botId, key: { in: ['CRM_API_KEY', 'CRM_API_BASE'] } }, select: { key: true, value: true } });
    return Object.fromEntries(rows.map((r) => [r.key, String(r.value || '').trim()]));
}

let _running = false;
async function tick() {
    if (_running) return;
    _running = true;
    try {
        const costs = await recentSessionCosts();
        const byBot = new Map();
        for (const c of costs) { if (!byBot.has(c.botId)) byBot.set(c.botId, []); byBot.get(c.botId).push(c); }
        for (const [botId, list] of byBot) {
            const keys = await keysOf(botId);
            if (!keys.CRM_API_KEY) continue; // воронка без CRM (не магазин)
            const items = list.map((c) => ({ sessionId: c.sessionId, costUsd: Math.round(c.costUsd * 1e6) / 1e6 }));
            for (let i = 0; i < items.length; i += 500) {
                const r = await crmFetch(keys, '/funnel-events/ai-cost', { method: 'POST', body: JSON.stringify({ items: items.slice(i, i + 500) }) }, 20000);
                if (!r.ok) logger.warn('[aiCostSync] CRM ' + r.status + ' ' + (r.error || JSON.stringify(r.json).slice(0, 120)), { botId });
                else logger.info('[aiCostSync] розмов: ' + items.length + ', оновлено карток: ' + (r.data && r.data.updated), { botId });
            }
        }
    } catch (e) { logger.warn('[aiCostSync] tick failed: ' + e.message); }
    finally { _running = false; }
}

function start() {
    setTimeout(() => { tick(); setInterval(tick, 30 * 60 * 1000).unref(); }, 3 * 60 * 1000).unref();
}

module.exports = { start, tick, costOf, priceFor, recentSessionCosts };
