'use strict';
/**
 * Доставка нагадувань, які поставив асистент.
 *
 * Свідомо окремо від follow-up: той сам вирішує, кому написати після мовчання, і
 * тому вимкнений за замовчуванням. Нагадування — навпаки, пряме прохання людини
 * («нагадай завтра о 12:30»), і не надіслати його гірше, ніж надіслати зайве.
 */

const logger = require('@platform/logger');
const { db } = require('@platform/db');
const { loadKeys, resolveToken } = require('./silenceChecker');

/** Скільки спізнення ще має сенс: після простою сервера нічні нагадування не валимо гуртом. */
const MAX_LATE_MS = 6 * 3600 * 1000;

async function sendMessage(token, chatId, text) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
}

async function deliverReminders() {
    try {
        const due = await db.reminder.findMany({
            where: { sentAt: null, canceledAt: null, dueAt: { lte: new Date() } },
            orderBy: { dueAt: 'asc' },
            take: 100,
            select: { id: true, botId: true, chatId: true, text: true, dueAt: true },
        });
        if (!due.length) return;

        const tokens = new Map(); // токен на бота, а не на нагадування
        for (const r of due) {
            try {
                const late = Date.now() - r.dueAt.getTime();
                if (late > MAX_LATE_MS) {
                    await db.reminder.update({ where: { id: r.id }, data: { canceledAt: new Date() } });
                    logger.warn('[reminders] протерміноване — не шлемо', { id: r.id, lateHours: Math.round(late / 3600000) });
                    continue;
                }

                if (!tokens.has(r.botId)) tokens.set(r.botId, await resolveToken(await loadKeys(r.botId)));
                const token = tokens.get(r.botId);
                if (!token) { logger.warn('[reminders] немає токена бота', { botId: r.botId }); continue; }

                await sendMessage(token, r.chatId, `⏰ <b>Нагадування</b>\n\n${r.text}`);
                await db.reminder.update({ where: { id: r.id }, data: { sentAt: new Date() } });
                logger.info('[reminders] надіслано', { id: r.id, botId: r.botId });
            } catch (err) {
                logger.warn('[reminders] не вдалось надіслати', { id: r.id, error: err.message });
            }
        }
    } catch (err) {
        logger.error('[reminders] прохід не вдався', { error: err.message });
    }
}

module.exports = { deliverReminders };
