'use strict';
/**
 * Зведення по робочих групах: щоденне і щотижневе.
 *
 * Ідея з ТЗ Digital Hiring: засновниця не встигає читати всі чати, і те, що
 * провисло, помічається із запізненням. Раз на день приходить коротка вижимка —
 * що зрушило, що чекає нас, що чекає клієнта; раз на тиждень ширша картина.
 *
 * Дайджест не переказує чат. Він відповідає на три питання: де мʼяч на нашому
 * боці, де ми чекаємо клієнта, і що взагалі зрушило. Переказ ніхто не читає,
 * список зобовʼязань читають.
 *
 * Вмикається ключем воронки DIGEST_ENABLED. Це не забаганка: сьогодні тричі
 * зʼясувалось, що поведінка, увімкнена в двигуні «для всіх», доїжджає до тих,
 * кому вона шкодить.
 */

const logger = require('@platform/logger');
const { db } = require('@platform/db');
const { callClaude } = require('@platform/claude');
const { loadKeys, loadTeamNames, resolveToken, authorOf } = require('./silenceChecker');

const KYIV_UTC_OFFSET_HOURS = 3;
const DEFAULT_WEEKLY_DAY = 5; // пʼятниця

function kyivNow() {
    return new Date(Date.now() + KYIV_UTC_OFFSET_HOURS * 3600 * 1000);
}

/** Ранкове вікно: дайджест має лежати в телефоні до початку роботи, а не серед дня. */
function isMorningWindow() {
    const k = kyivNow();
    return k.getUTCHours() === 9 && k.getUTCMinutes() < 30;
}

function kyivDateStr() {
    return kyivNow().toISOString().slice(0, 10);
}

async function sendMessage(token, chatId, text) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
}

/**
 * Переписка груп за період у вигляді, придатному для читання моделлю.
 *
 * Повідомлення бота пропускаємо: дайджест про те, що роблять люди, а не про те,
 * що відповідала помічниця.
 */
async function collectGroupTalk(botId, since) {
    const groups = await db.session.findMany({
        where: { botId, user: { telegramId: { lt: 0 } } },
        select: { id: true, user: { select: { firstName: true } } },
    });

    const blocks = [];
    let total = 0;
    for (const g of groups) {
        const msgs = await db.message.findMany({
            where: { sessionId: g.id, role: 'user', createdAt: { gte: since } },
            orderBy: { createdAt: 'asc' },
            select: { content: true, createdAt: true },
        });
        if (!msgs.length) continue;
        total += msgs.length;
        const lines = msgs.map((m) => {
            const t = new Date(m.createdAt.getTime() + KYIV_UTC_OFFSET_HOURS * 3600 * 1000)
                .toISOString().slice(5, 16).replace('T', ' ');
            return `  ${t}  ${String(m.content).replace(/\n/g, ' ').slice(0, 300)}`;
        });
        blocks.push(`ГРУПА «${g.user?.firstName || 'без назви'}»:\n${lines.join('\n')}`);
    }
    return { text: blocks.join('\n\n'), count: total, groups: blocks.length };
}

function buildPrompt(kind, team, talk) {
    const period = kind === 'weekly' ? 'тиждень' : 'добу';
    return [
        `Ти читаєш переписку робочих груп за ${period} і робиш зведення для власниці компанії.`,
        '',
        `НАША КОМАНДА: ${team.join(', ')}. Усі інші в цих групах — клієнти або кандидати.`,
        '',
        'ПЕРЕПИСКА:',
        talk,
        '',
        'Зроби коротке зведення рівно з трьох частин, кожна списком:',
        '1. ЧЕКАЄ НАС — питання клієнтів без відповіді від нашої команди. Хто, що, коли писав.',
        '2. ЧЕКАЄМО КЛІЄНТА — де мʼяч на їхньому боці.',
        '3. ЗРУШИЛО — що реально просунулось за період.',
        '',
        'ПРАВИЛА:',
        '- Спирайся тільки на переписку. Не додумуй статуси, яких там немає.',
        '- Пункт має бути дією або зобовʼязанням, а не переказом розмови.',
        '- Порожня частина — так і напиши «немає», не вигадуй наповнення.',
        '- Без вступу і висновків. Максимум 12 пунктів разом.',
        'Українською, стисло.',
    ].join('\n');
}

async function runForBot(bot, kind) {
    const keys = await loadKeys(bot.id);
    if (!/^(1|true|on|yes)$/i.test(keys.DIGEST_ENABLED || '')) return;

    const ownerChat = keys.OWNER_TELEGRAM_ID;
    if (!ownerChat) return;

    // Один дайджест на день і один на тиждень — навіть якщо воркер перезапустився.
    const state = bot.settings?.digest || {};
    const today = kyivDateStr();
    if (state[kind] === today) return;

    if (kind === 'weekly') {
        const wanted = Number(keys.DIGEST_WEEKDAY) >= 0 ? Number(keys.DIGEST_WEEKDAY) : DEFAULT_WEEKLY_DAY;
        if (kyivNow().getUTCDay() !== wanted) return;
    }

    const hours = kind === 'weekly' ? 7 * 24 : 24;
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const talk = await collectGroupTalk(bot.id, since);
    if (!talk.count) {
        logger.debug('[groupDigest] у групах тиша — дайджест не потрібен', { botId: bot.id, kind });
        return;
    }

    const team = await loadTeamNames(keys);
    const token = await resolveToken(keys);
    if (!token) return;

    // sessionId потрібен лише щоб дістати Claude-ключ саме цієї воронки.
    const anySession = await db.session.findFirst({ where: { botId: bot.id }, select: { id: true } });

    let summary = '';
    try {
        const res = await callClaude({
            sessionId: anySession?.id || null,
            systemPrompt: 'Ти асистент власниці бізнесу. Пишеш стисло, по суті, без канцеляриту.',
            messages: [{ role: 'user', content: buildPrompt(kind, team.length ? team : ['(команда не вказана)'], talk.text) }],
            options: { maxTokens: 1200 },
        });
        summary = typeof res === 'string' ? res : (res?.text || res?.content || '');
    } catch (err) {
        logger.warn('[groupDigest] модель не відповіла', { botId: bot.id, kind, error: err.message });
        return;
    }
    if (!summary.trim()) return;

    const title = kind === 'weekly' ? '🗓 Зведення за тиждень' : '☀️ Зведення за добу';
    const head = `<b>${title}</b>\nГруп: ${talk.groups} · повідомлень: ${talk.count}\n\n`;
    try {
        await sendMessage(token, ownerChat, head + summary.trim().slice(0, 3500));
        await db.bot.update({
            where: { id: bot.id },
            data: { settings: { ...(bot.settings || {}), digest: { ...state, [kind]: today } } },
        });
        logger.info('[groupDigest] надіслано', { botId: bot.id, kind, groups: talk.groups, messages: talk.count });
    } catch (err) {
        logger.warn('[groupDigest] не вдалось надіслати', { botId: bot.id, kind, error: err.message });
    }
}

async function runDigests({ force = null } = {}) {
    if (!force && !isMorningWindow()) return;
    try {
        const bots = await db.bot.findMany({
            where: { isActive: true },
            select: { id: true, name: true, settings: true },
        });
        for (const bot of bots.filter((b) => b.settings?.groupMode?.enabled === true)) {
            for (const kind of (force ? [force] : ['daily', 'weekly'])) {
                await runForBot(bot, kind).catch((err) =>
                    logger.warn('[groupDigest] бот пропущено', { botId: bot.id, kind, error: err.message }));
            }
        }
    } catch (err) {
        logger.error('[groupDigest] прохід не вдався', { error: err.message });
    }
}

module.exports = { runDigests, collectGroupTalk, buildPrompt };
