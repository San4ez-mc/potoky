'use strict';
/**
 * Нагадування асистента: «нагадай мені завтра о 12:30 написати клієнту».
 *
 * Ставить їх сам агент інструментом, тому вхід приймаємо в двох виглядах: точний
 * час (dueAt) або «через стільки-то хвилин» (inMinutes). Модель погано рахує
 * дати в голові, і якщо лишити тільки ISO, вона регулярно промахується на добу
 * чи на часовий пояс — а нагадування, що прийшло не тоді, гірше за відсутнє.
 *
 * Кому слати — визначає сервер за сесією, а не модель: інакше досить було б
 * підкинути чужий chat_id у аргументах, щоб бот написав сторонній людині.
 */
const express = require('express');
const router = express.Router();
const { db } = require('@platform/db');
const logger = require('@platform/logger');

const KYIV_OFFSET_HOURS = 3;
const MAX_AHEAD_DAYS = 365;

function requireSecret(req, res, next) {
    const secret = process.env.API_SECRET || '';
    if (!secret) return next(); // локальна розробка без секрета
    if (req.headers['x-api-secret'] !== secret) return res.status(401).json({ error: 'unauthorized' });
    next();
}

/** Людський час для підтвердження: модель має сказати клієнтці, коли саме нагадає. */
function kyivLabel(date) {
    return new Date(date.getTime() + KYIV_OFFSET_HOURS * 3600 * 1000)
        .toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Час нагадування з того, що передала модель.
 *
 * Дата без зони трактується як київська: модель домовляється з людиною в її
 * часі, і «12:30» для неї означає 12:30 у Києві, а не UTC.
 */
function parseDue(body) {
    const minutes = Number(body?.inMinutes);
    if (Number.isFinite(minutes) && minutes > 0) return new Date(Date.now() + minutes * 60 * 1000);

    const raw = String(body?.dueAt || '').trim();
    if (!raw) throw new Error('Вкажи dueAt (2026-09-26 12:30) або inMinutes');

    const hasZone = /(z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const iso = raw.replace(' ', 'T');
    const parsed = new Date(hasZone ? iso : `${iso}${iso.length <= 16 ? ':00' : ''}+0${KYIV_OFFSET_HOURS}:00`);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Не розумію час «${raw}». Приклад: 2026-09-26 12:30`);
    return parsed;
}

router.post('/', requireSecret, async (req, res) => {
    try {
        const sessionId = String(req.query.sessionId || req.body?.sessionId || '').trim();
        const text = String(req.body?.text || '').trim();
        if (!sessionId) return void res.status(400).json({ error: 'потрібен sessionId' });
        if (!text) return void res.status(400).json({ error: 'потрібен text — що саме нагадати' });

        const session = await db.session.findUnique({
            where: { id: sessionId },
            select: { id: true, botId: true, user: { select: { telegramId: true } } },
        });
        if (!session) return void res.status(404).json({ error: 'сесію не знайдено' });
        const chatId = session.user?.telegramId;
        if (!chatId) return void res.status(400).json({ error: 'у сесії немає чату для відповіді' });

        let dueAt;
        try { dueAt = parseDue(req.body); } catch (e) { return void res.status(400).json({ error: e.message }); }
        if (dueAt.getTime() < Date.now() - 60 * 1000) {
            return void res.status(400).json({ error: `Час ${kyivLabel(dueAt)} уже минув — уточни, коли саме нагадати` });
        }
        if (dueAt.getTime() > Date.now() + MAX_AHEAD_DAYS * 24 * 3600 * 1000) {
            return void res.status(400).json({ error: 'Більш ніж на рік наперед нагадування не ставимо' });
        }

        const r = await db.reminder.create({
            data: { botId: session.botId, sessionId: session.id, chatId: String(chatId), text, dueAt },
            select: { id: true, dueAt: true, text: true },
        });
        logger.info('[reminders] поставлено', { botId: session.botId, dueAt: r.dueAt.toISOString() });
        res.json({ ok: true, id: r.id, text: r.text, when: kyivLabel(r.dueAt), timezone: 'Europe/Kyiv' });
    } catch (err) {
        logger.error('[reminders] не вдалось поставити', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

/** Активні нагадування сесії — щоб асистент міг сказати, що вже стоїть, і не дублювати. */
router.get('/', requireSecret, async (req, res) => {
    try {
        const sessionId = String(req.query.sessionId || '').trim();
        if (!sessionId) return void res.status(400).json({ error: 'потрібен sessionId' });
        const rows = await db.reminder.findMany({
            where: { sessionId, sentAt: null, canceledAt: null },
            orderBy: { dueAt: 'asc' },
            select: { id: true, text: true, dueAt: true },
        });
        res.json({ count: rows.length, reminders: rows.map((r) => ({ id: r.id, text: r.text, when: kyivLabel(r.dueAt) })) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/** Скасування. Видаляти не можна: історія «що мені нагадували» лишається корисною. */
router.post('/:id/cancel', requireSecret, async (req, res) => {
    try {
        const r = await db.reminder.updateMany({
            where: { id: req.params.id, sentAt: null, canceledAt: null },
            data: { canceledAt: new Date() },
        });
        if (!r.count) return void res.status(404).json({ error: 'нагадування не знайдено або вже спрацювало' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
