'use strict';
/**
 * Алерт «клієнт написав і йому не відповіли».
 *
 * Робоча група — це місце, де домовленість помирає тихо: клієнт щось запитав,
 * усі бачили, ніхто не відповів, через два дні він пише вже роздратовано. Тут
 * ідея проста: якщо остання репліка в групі НЕ від нас і висить довше порогу —
 * засновниця дізнається про це сама, без того щоб гортати чати.
 *
 * Хто такі «ми» — беремо з орг-структури клієнта, а не з окремого списку в
 * налаштуваннях. ТЗ передбачало ролі з CRM-таблиці, але таблиці може не бути
 * місяцями, а команда в орг-платформі вже є і оновлюється сама, коли асистент
 * записує нову людину. Один список замість двох, і він не протухає.
 */

const logger = require('@platform/logger');
const { db } = require('@platform/db');

const DEFAULT_SILENCE_HOURS = 3;

/** Ключі воронки одним запитом — їх треба кілька і завжди разом. */
async function loadKeys(botId) {
    const rows = await db.funnelKey.findMany({ where: { botId }, select: { key: true, value: true } });
    return Object.fromEntries(rows.map((r) => [r.key, (r.value || '').trim()]));
}

/**
 * Імена нашої команди з орг-платформи.
 *
 * Порожній список означає «ми нікого не знаємо», і тоді перевірку не робимо
 * зовсім: інакше кожна репліка виглядала б як «клієнт без відповіді», і алерти
 * стали б шумом, який навчаються ігнорувати за день.
 */
async function loadTeamNames(keys) {
    if (!keys.ORG_API_URL || !keys.ORG_API_TOKEN || !keys.COMPANY_ID) return [];
    try {
        const res = await fetch(`${keys.ORG_API_URL}/companies/${keys.COMPANY_ID}`, {
            headers: { Authorization: `Bearer ${keys.ORG_API_TOKEN}` },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const body = await res.json();
        const company = body.company || body;
        const names = (company.orgUnits || [])
            .filter((u) => u.type === 'POST' && u.holderName)
            .map((u) => String(u.holderName).trim())
            .filter(Boolean);
        return [...new Set(names)];
    } catch (err) {
        logger.warn('[silenceChecker] не вдалось отримати команду з ORG', { error: err.message });
        return [];
    }
}

/** Автор пасивної репліки: транспорт зберігає її як «[Ім'я]: текст». */
function authorOf(content) {
    const m = String(content || '').match(/^\[([^\]]+)\]:\s*/);
    return m ? m[1].trim() : '';
}

/**
 * Чи це хтось наш. Порівнюємо за частинами імені: у групі людина підписана
 * «Олеся», а в структурі записана «Олеся Коваль» — і навпаки.
 */
function isOurs(author, teamNames) {
    if (!author) return false;
    const a = author.toLowerCase();
    return teamNames.some((full) => {
        const f = full.toLowerCase();
        if (a === f) return true;
        return f.split(/\s+/).some((part) => part.length > 2 && a.includes(part));
    });
}

/** Токен бота: спершу збережений конектор, потім прямий ключ воронки. */
async function resolveToken(keys) {
    if (keys.TELEGRAM_CONNECTOR_ID) {
        const c = await db.savedConnector.findUnique({
            where: { id: keys.TELEGRAM_CONNECTOR_ID }, select: { config: true },
        }).catch(() => null);
        const t = c?.config?.token;
        if (t && /^\d+:[A-Za-z0-9_-]{20,}$/.test(t.trim())) return t.trim();
    }
    return /^\d+:[A-Za-z0-9_-]{20,}$/.test(keys.TELEGRAM_BOT_TOKEN || '') ? keys.TELEGRAM_BOT_TOKEN : null;
}

async function sendAlert(token, chatId, text) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Telegram ${res.status}: ${err.slice(0, 160)}`);
    }
}

function humanAge(ms) {
    const h = Math.floor(ms / 3600000);
    if (h < 24) return `${h} год`;
    const d = Math.floor(h / 24);
    return `${d} дн ${h % 24} год`;
}

async function checkBotGroups(bot) {
    const keys = await loadKeys(bot.id);
    const ownerChat = keys.OWNER_TELEGRAM_ID;
    if (!ownerChat) return; // нема кому повідомляти — мовчимо, а не вгадуємо

    const token = await resolveToken(keys);
    if (!token) return;

    const team = await loadTeamNames(keys);
    if (!team.length) {
        logger.debug('[silenceChecker] команда невідома — пропускаємо', { botId: bot.id });
        return;
    }

    const hours = Number(keys.SILENCE_HOURS) > 0 ? Number(keys.SILENCE_HOURS) : DEFAULT_SILENCE_HOURS;
    const thresholdMs = hours * 3600 * 1000;

    // Групи впізнаємо за відʼємним telegramId — так їх позначає сам Telegram,
    // тож переплутати з людиною неможливо. Поле BigInt, тому порівняння числове.
    const groups = await db.session.findMany({
        where: { botId: bot.id, user: { telegramId: { lt: 0 } } },
        select: { id: true, context: true, user: { select: { firstName: true } } },
    });

    for (const session of groups) {
        const last = await db.message.findFirst({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true, role: true, content: true, createdAt: true },
        });
        if (!last || last.role !== 'user') continue; // останнє слово за нами — тиші немає

        const author = authorOf(last.content);
        if (isOurs(author, team)) continue;

        const age = Date.now() - last.createdAt.getTime();
        if (age < thresholdMs) continue;

        // Про одне й те саме повідомлення нагадуємо один раз: інакше кожні
        // пів години прилітав би той самий алерт, поки клієнт чекає.
        const ctx = session.context || {};
        if (ctx.silenceAlertedMessageId === last.id) continue;

        const title = session.user?.firstName || 'Група';
        const quote = String(last.content).replace(/^\[[^\]]+\]:\s*/, '').slice(0, 200);
        const text = `⏳ <b>Без відповіді ${humanAge(age)}</b>\n\n`
            + `Група: <b>${title}</b>\n`
            + `Написав: ${author || 'учасник'}\n\n`
            + `«${quote}»`;

        try {
            await sendAlert(token, ownerChat, text);
            await db.session.update({
                where: { id: session.id },
                data: { context: { ...ctx, silenceAlertedMessageId: last.id } },
            });
            logger.info('[silenceChecker] алерт надіслано', { botId: bot.id, group: title, hours });
        } catch (err) {
            logger.warn('[silenceChecker] не вдалось надіслати алерт', { botId: bot.id, error: err.message });
        }
    }
}

async function checkGroupSilence() {
    try {
        const bots = await db.bot.findMany({
            where: { isActive: true },
            select: { id: true, name: true, settings: true },
        });
        const withGroups = bots.filter((b) => b.settings?.groupMode?.enabled === true);
        for (const bot of withGroups) {
            await checkBotGroups(bot).catch((err) =>
                logger.warn('[silenceChecker] бот пропущено', { botId: bot.id, error: err.message }));
        }
    } catch (err) {
        logger.error('[silenceChecker] прохід не вдався', { error: err.message });
    }
}

module.exports = { checkGroupSilence, isOurs, authorOf, loadKeys, loadTeamNames, resolveToken };
