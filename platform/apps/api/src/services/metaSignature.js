'use strict';
/**
 * metaSignature.js — перевірка підпису вебхука Meta (X-Hub-Signature-256 = sha256 HMAC сирого тіла секретом додатка). 2026-10-12.
 *
 * Вебхук /webhook/instagram/:botId керує живим ботом (metaChannel.js): без перевірки будь-хто, хто знає адресу, може підкинути
 * фальшиве «повідомлення клієнта» (бот напише людині) або «луну менеджера» (бот стане на паузу).
 * Секрети — ключі цільової воронки: INSTAGRAM_APP_SECRET (Instagram API з Instagram Login) і META_APP_SECRET (секрет додатка).
 * Яким із них Meta підписує — перевіряємо обома. Блокування — лише з ключем META_SIGNATURE_ENFORCE=1: спершу дивимось на живих
 * подіях, що справжні проходять (лог '[metaSignature]'), і лише тоді вмикаємо.
 */
const crypto = require('crypto');
const { db } = require('@platform/db');
const logger = require('@platform/logger');

const _cache = new Map();
async function secretsFor(botId) {
    const c = _cache.get(botId);
    if (c && c.until > Date.now()) return c.v;
    const rows = await db.funnelKey.findMany({ where: { botId, key: { in: ['INSTAGRAM_APP_SECRET', 'META_APP_SECRET', 'META_SIGNATURE_ENFORCE'] } }, select: { key: true, value: true } }).catch(() => []);
    const m = Object.fromEntries(rows.map((r) => [r.key, String(r.value || '').trim()]));
    const v = { secrets: ['INSTAGRAM_APP_SECRET', 'META_APP_SECRET'].filter((k) => m[k] && m[k] !== 'REPLACE_ME').map((k) => ({ name: k, value: m[k] })), enforce: /^(1|true|on|yes)$/i.test(m.META_SIGNATURE_ENFORCE || '') };
    _cache.set(botId, { v, until: Date.now() + 60 * 1000 });
    return v;
}

function safeEqualHex(a, b) {
    const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** { ok, matched, enforce, reason } — ok=true, якщо підпис збігся з будь-яким секретом (або перевіряти нічим і не enforce). */
async function verify(botId, rawBuffer, header) {
    const { secrets, enforce } = await secretsFor(botId);
    if (!secrets.length) return { ok: !enforce, matched: null, enforce, reason: 'no_secrets' };
    if (!rawBuffer || !rawBuffer.length) return { ok: false, matched: null, enforce, reason: 'no_raw_body' };
    const sig = String(header || '').replace(/^sha256=/i, '').trim().toLowerCase();
    if (!sig) return { ok: false, matched: null, enforce, reason: 'no_signature' };
    for (const s of secrets) {
        const h = crypto.createHmac('sha256', s.value).update(rawBuffer).digest('hex');
        if (safeEqualHex(h, sig)) return { ok: true, matched: s.name, enforce, reason: 'match' };
    }
    return { ok: false, matched: null, enforce, reason: 'mismatch' };
}

// Підсумок для звіту: скільки подій пройшло яким ключем (лог раз на 10 хв, щоб не засмічувати).
const _stats = new Map(); let _lastLog = 0; let _seen = 0;
function record(botId, v) {
    const k = botId + ':' + (v.matched || v.reason);
    _stats.set(k, (_stats.get(k) || 0) + 1);
    if (Date.now() - _lastLog > 10 * 60 * 1000) { _lastLog = Date.now(); logger.info('[metaSignature] підсумок перевірки підпису', { stats: Object.fromEntries(_stats) }); }
    if (_seen < 30) { _seen++; logger.info('[metaSignature] перевірка', { botId, matched: v.matched, reason: v.reason }); } // перші події після старту — щоб одразу побачити, яким ключем підписує Meta
    if (!v.ok) logger.warn('[metaSignature] підпис не пройшов', { botId, reason: v.reason, enforce: v.enforce });
}

module.exports = { verify, record };
