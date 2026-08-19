'use strict';
// Спільний, багатопроцесний (api + worker) кеш+координатор виписки Monobank.
// Проблема, яку вирішує: monobank дозволяє 1 запит виписки / 60с НА ТОКЕН, а
// одночасно можуть чекати підтвердження оплати десятки клієнтів (40-50
// замовлень/день) — кожен незалежний виклик з testSession.js раніше міг
// одночасно "промахнутись" повз in-memory кеш і вдарити по Mono API кілька
// разів за раз (thundering herd → 429).
//
// Рішення: Redis-кеш (ключ token:account, TTL ~70с) + короткий розподілений
// лок (SET NX PX) — з N одночасних запитів РЕАЛЬНО б'є Mono лише ОДИН, решта
// або чекають (до ~3с), або беруть останній добрий кеш. Той самий модуль
// також дає atomic-реєстр "спожитих" транзакцій (Redis SET, SADD — без
// read-modify-write гонки, на відміну від попереднього JSON-блоба у funnelKey).
const MONO_MIN_INTERVAL_MS = 60 * 1000;
const CACHE_TTL_MS = 70 * 1000;
const LOCK_TTL_MS = 8000;
const WAIT_STEP_MS = 500;
const WAIT_MAX_TRIES = 6;

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

/**
 * @param {object} opts
 * @param {import('redis').RedisClientType} opts.redisClient
 * @param {string} opts.token
 * @param {string} opts.account
 * @param {number} [opts.windowHours]
 * @returns {Promise<{items: any[], fromCache: boolean, status?: number}>}
 */
async function getMonoStatement({ redisClient, token, account, windowHours = 48 }) {
    const cacheKey = `mono:stmt:${token}:${account}`;
    const lockKey = `mono:lock:${token}:${account}`;

    let cached = null;
    try {
        const raw = await redisClient.get(cacheKey);
        if (raw) cached = JSON.parse(raw);
    } catch (_e) { /* Redis best-effort */ }

    if (cached && (Date.now() - cached.at) < MONO_MIN_INTERVAL_MS) {
        return { items: cached.items, fromCache: true };
    }

    let gotLock = false;
    try { gotLock = !!(await redisClient.set(lockKey, '1', { NX: true, PX: LOCK_TTL_MS })); } catch (_e) { gotLock = false; }

    if (gotLock) {
        try {
            const from = Math.floor((Date.now() - windowHours * 3600 * 1000) / 1000);
            const r = await fetch(`https://api.monobank.ua/personal/statement/${encodeURIComponent(account)}/${from}`, { headers: { 'X-Token': token } });
            const status = r.status;
            const j = await r.json().catch(() => null);
            if (Array.isArray(j)) {
                try { await redisClient.set(cacheKey, JSON.stringify({ at: Date.now(), items: j }), { PX: CACHE_TTL_MS }); } catch (_e) { /* ignore */ }
                return { items: j, fromCache: false, status };
            }
            return { items: cached ? cached.items : [], fromCache: !!cached, status };
        } catch (_e) {
            return { items: cached ? cached.items : [], fromCache: !!cached };
        } finally {
            try { await redisClient.del(lockKey); } catch (_e) { /* ignore */ }
        }
    }

    // Хтось інший саме зараз тягне виписку — трохи почекати на його результат,
    // а не бити Mono API вдруге в межах тієї ж секунди.
    for (let i = 0; i < WAIT_MAX_TRIES; i++) {
        await sleep(WAIT_STEP_MS);
        try {
            const raw2 = await redisClient.get(cacheKey);
            if (raw2) {
                const o2 = JSON.parse(raw2);
                if ((Date.now() - o2.at) < MONO_MIN_INTERVAL_MS) return { items: o2.items, fromCache: true };
            }
        } catch (_e) { /* ignore, keep waiting */ }
    }
    return { items: cached ? cached.items : [], fromCache: !!cached };
}

/** Чи існує бодай одне свіже кешоване значення (для worker — не форсує запит). */
async function hasFreshCache({ redisClient, token, account }) {
    try {
        const raw = await redisClient.get(`mono:stmt:${token}:${account}`);
        if (!raw) return false;
        const o = JSON.parse(raw);
        return (Date.now() - o.at) < MONO_MIN_INTERVAL_MS;
    } catch (_e) { return false; }
}

/** Atomic-додавання txId у реєстр "спожитих" транзакцій (без read-modify-write гонки). */
async function markConsumed({ redisClient, botId, txId }) {
    if (!txId) return;
    try { await redisClient.sAdd(`mono:consumed:${botId}`, String(txId)); } catch (_e) { /* best-effort */ }
}

/** Повний набір "спожитих" txId для бота (мердж у ctx.consumedTxIds). */
async function getConsumedSet({ redisClient, botId }) {
    try { return await redisClient.sMembers(`mono:consumed:${botId}`); } catch (_e) { return []; }
}

module.exports = { getMonoStatement, hasFreshCache, markConsumed, getConsumedSet, MONO_MIN_INTERVAL_MS };
