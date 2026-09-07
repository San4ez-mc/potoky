'use strict';
/**
 * Технічні сповіщення власнику: щось зламалось або агент не зрозумів клієнта.
 *
 * Окремо від повідомлень клієнту і окремо від бота, у якому сталась подія. Бот
 * клієнта не може писати власнику, якщо той не починав з ним діалог, — а саме
 * тоді, коли все ламається, з'ясовувати це найгірше. Тому канал сповіщень своя
 * пара «бот + чат», яку налаштовують ключами воронки.
 *
 * Точка входу одна, бо джерел два: двигун (падіння ноди, недоступний сервіс) і
 * сам агент (не зрозумів відповідь, не знайшов даних, уперся в межі доступу).
 */
const express = require('express');
const router = express.Router();
const db = require('@platform/db');
const logger = require('@platform/logger');

const ALERT_SECRET = process.env.API_SECRET || '';

function requireSecret(req, res, next) {
    if (!ALERT_SECRET) return next(); // локальна розробка без секрета
    const got = req.headers['x-alert-secret'] || req.headers['x-api-secret'];
    if (got !== ALERT_SECRET) return res.status(401).json({ ok: false, error: 'unauthorized' });
    next();
}

/**
 * Захист від лавини.
 *
 * Помилка в циклі шле те саме двадцять разів на хвилину, і замість сигналу
 * власник отримує шум, який навчається ігнорувати. Однакове повідомлення в межах
 * вікна відправляємо один раз.
 */
const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map(); // хеш → час останньої відправки

function isDuplicate(key) {
    const now = Date.now();
    for (const [k, at] of recent) if (now - at > WINDOW_MS) recent.delete(k);
    if (recent.has(key)) return true;
    recent.set(key, now);
    return false;
}

/** Куди слати: пара «бот + чат» із ключів воронки, із системним запасним варіантом. */
async function resolveTarget(botId) {
    const keys = botId
        ? await db.funnelKey.findMany({
            where: { botId, key: { in: ['ALERT_CONNECTOR_ID', 'ALERT_CHAT_ID', 'TELEGRAM_CONNECTOR_ID'] } },
            select: { key: true, value: true },
        }).catch(() => [])
        : [];
    const k = Object.fromEntries(keys.map((x) => [x.key, (x.value || '').trim()]));

    let chatId = k.ALERT_CHAT_ID;
    if (!chatId) {
        const sys = await db.savedConnector.findFirst({
            where: { type: 'system_admin_telegram_id' },
            select: { config: true },
        }).catch(() => null);
        chatId = (sys?.config?.value || '').trim();
    }

    // Бот сповіщень окремий; якщо не заданий — падаємо назад на бота воронки.
    const connectorId = k.ALERT_CONNECTOR_ID || k.TELEGRAM_CONNECTOR_ID;
    let token = '';
    if (connectorId) {
        const c = await db.savedConnector.findUnique({
            where: { id: connectorId },
            select: { config: true },
        }).catch(() => null);
        token = (c?.config?.token || '').trim();
    }
    return { token, chatId };
}

const KIND_LABEL = {
    error: '🔴 Збій',
    stuck: '🟡 Агент не зрозумів',
    limit: '🟠 Уперся в межі доступу',
    info: 'ℹ️',
};

/**
 * Надіслати сповіщення. Повертає `sent: false` без помилки, коли канал не
 * налаштований: сповіщення — не та річ, через яку має падати основна робота.
 */
async function sendAlert({ botId, sessionId, kind, text, details }) {
    const { token, chatId } = await resolveTarget(botId);
    if (!token || !chatId) {
        logger.warn('[alerts] канал сповіщень не налаштований', { botId, hasToken: Boolean(token), hasChat: Boolean(chatId) });
        return { sent: false, reason: 'no-channel' };
    }

    const body = String(text || '').slice(0, 1500);
    if (isDuplicate(`${botId || ''}|${kind}|${body}`)) return { sent: false, reason: 'duplicate' };

    let botName = '';
    if (botId) {
        const b = await db.bot.findUnique({ where: { id: botId }, select: { name: true } }).catch(() => null);
        botName = b?.name || botId;
    }

    const lines = [
        `${KIND_LABEL[kind] || KIND_LABEL.info} ${botName}`.trim(),
        '',
        body,
    ];
    if (details) lines.push('', String(details).slice(0, 600));
    if (sessionId) lines.push('', `Сесія: https://flows.fineko.space/sessions/${sessionId}`);

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), disable_web_page_preview: true }),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            logger.warn('[alerts] telegram відмовив', { status: res.status, body: t.slice(0, 200) });
            return { sent: false, reason: `telegram-${res.status}` };
        }
        return { sent: true };
    } catch (err) {
        logger.warn('[alerts] не вдалось надіслати', { error: err.message });
        return { sent: false, reason: 'network' };
    }
}

// POST /api/alerts/report — і для двигуна, і для інструмента агента.
router.post('/report', requireSecret, async (req, res) => {
    const { botId, sessionId, kind, text, details } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: 'text обовʼязковий' });
    const r = await sendAlert({
        botId: botId || null,
        sessionId: sessionId || null,
        kind: ['error', 'stuck', 'limit', 'info'].includes(kind) ? kind : 'info',
        text,
        details,
    });
    // Для агента це має виглядати як успіх: він повідомив, далі не його справа.
    res.json({ ok: true, ...r });
});

module.exports = router;
module.exports.sendAlert = sendAlert;
