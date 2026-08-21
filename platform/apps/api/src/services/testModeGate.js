'use strict';

const { db } = require('@platform/db');

/**
 * Тестовий режим воронки (bot.settings.testMode): коли увімкнено, бот відповідає
 * ТІЛЬКИ користувачам зі списку bot.settings.testModeAllowedUsers (за нікнеймом/
 * іменем у каналі, регістронезалежно, без "@"). Усім іншим — повна тиша (як і коли
 * бот вимкнений взагалі), щоб недороблену/тестову воронку не показати живим клієнтам.
 *
 * identifiers — усі можливі ідентифікатори клієнта в цьому каналі (напр.
 * [igUsername, senderName] для Zernio/Instagram, [username, "Ім'я Прізвище"] для
 * Telegram) — блок знімається, якщо БУДЬ-ЯКИЙ співпав зі списком дозволених.
 */
async function isBlockedByTestMode(botId, identifiers) {
    if (!botId) return false;
    const bot = await db.bot.findUnique({ where: { id: botId }, select: { settings: true } }).catch(() => null);
    const settings = (bot && bot.settings) || {};
    if (!settings.testMode) return false;

    const allowed = Array.isArray(settings.testModeAllowedUsers) ? settings.testModeAllowedUsers : [];
    const norm = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();
    if (!allowed.length) return true; // тест-мод увімкнено, але нікого не дозволено -> блокує всіх

    const allowedSet = new Set(allowed.map(norm).filter(Boolean));
    const ids = (Array.isArray(identifiers) ? identifiers : [identifiers]).map(norm).filter(Boolean);
    return !ids.some((id) => allowedSet.has(id));
}

module.exports = { isBlockedByTestMode };
