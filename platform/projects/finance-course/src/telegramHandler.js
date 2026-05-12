'use strict';

const logger = require('@platform/logger');
const { sendMessage } = require('@platform/telegram');
const { UserService } = require('./services/UserService');
const { DEEP_LINK_MAP, BOT_SLUGS } = require('./constants');
const { checkPrerequisites } = require('./config/prerequisites');
const { db } = require('@platform/db');

/**
 * Main entry point for all Telegram updates in the finance-course bot.
 */
async function handleTelegramUpdate(update) {
    if (update.message) {
        await handleMessage(update.message);
    } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
    }
}

async function handleMessage(msg) {
    const { from, text, chat } = msg;
    const chatId = chat.id;

    const user = await UserService.findOrCreate(from);

    if (text?.startsWith('/start')) {
        const parts = text.split(' ');
        const deepLink = parts[1];
        const normalizedDeepLink = deepLink ? deepLink.split('__')[0] : '';
        const botSlugFromLink = normalizedDeepLink
            ? (DEEP_LINK_MAP[normalizedDeepLink] || normalizedDeepLink)
            : null;
        const isKnownBotSlug = botSlugFromLink ? Object.values(BOT_SLUGS).includes(botSlugFromLink) : false;

        if (isKnownBotSlug) {
            await startBot(user, chatId, botSlugFromLink);
        } else {
            await sendMainMenu(user, chatId);
        }
        return;
    }

    if (text === '/progress') {
        await sendProgress(user, chatId);
        return;
    }

    if (text === '/files') {
        await sendFiles(user, chatId);
        return;
    }

    if (text === '/help') {
        await sendMessage(chatId,
            '📚 *Довідка*\n\n' +
            '/start — головне меню\n' +
            '/progress — прогрес по блоках\n' +
            '/files — всі згенеровані файли\n\n' +
            'Для старту уроку натисніть кнопку в меню або перейдіть по посиланню з урока.'
        );
        return;
    }

    // Route to active session handler
    await routeToActiveSession(user, chatId, text);
}

async function handleCallbackQuery(query) {
    const { from, data, message } = query;
    const chatId = message.chat.id;
    const user = await UserService.findOrCreate(from);
    await routeCallbackToActiveSession(user, chatId, data);
}

async function startBot(user, chatId, botSlug) {
    const { ok, missingNames } = await checkPrerequisites(user.id, botSlug);

    if (!ok) {
        await sendMessage(chatId,
            `⚠️ Для цього уроку потрібні файли, які ще не створені:\n` +
            missingNames.map(n => `• ${n}`).join('\n') +
            `\n\nПоверніться до попередніх уроків і запустіть відповідні боти.`
        );
        return;
    }

    const bot = await db.bot.findFirst({ where: { slug: botSlug } });
    if (!bot) {
        logger.error('Bot not found in DB', { botSlug });
        await sendMessage(chatId, '❌ Бот не знайдений. Зверніться до адміністратора.');
        return;
    }

    const { getHandler } = require(`./bots/${botSlug}/index`);
    const handler = getHandler();
    await handler.start(user, chatId, bot);
}

async function sendMainMenu(user, chatId) {
    const project = await db.project.findFirst({ where: { slug: 'finance-course' } });
    const progress = project
        ? await db.userProgress.findMany({ where: { userId: user.id, projectId: project.id } })
        : [];

    const completedLessons = new Set(progress.filter(p => p.status === 'completed').map(p => p.lessonNumber));

    const statusEmoji = (lesson) => completedLessons.has(lesson) ? '✅' : '🔄';

    const name = user.firstName || 'студент';
    await sendMessage(chatId,
        `👋 Привіт, ${name}!\n\n` +
        `📊 *Фінансова система малого бізнесу*\n\n` +
        `*Блок 1 — Бізнес-процес*\n` +
        `${statusEmoji('1.2')} Урок 1.2 — Бізнес-процес (swimlane)\n\n` +
        `*Блок 2 — Cashflow*\n` +
        `${statusEmoji('2.1')} Урок 2.1 — Статті Cashflow і P&L\n` +
        `${statusEmoji('2.2')} Урок 2.2 — Таблиця Cashflow\n` +
        `${statusEmoji('2.3')} Урок 2.3 — Платіжний календар\n\n` +
        `*Блок 3 — P&L і діагностика*\n` +
        `${statusEmoji('3.2')} Урок 3.2 — Таблиця P&L\n` +
        `${statusEmoji('3.3')} Урок 3.3 — Діагностика фінансової механіки\n\n` +
        `*Блок 4 — Операційна система*\n` +
        `${statusEmoji('4.1')} Урок 4.1 — Оновлення бізнес-процесу\n` +
        `${statusEmoji('4.2')} Урок 4.2 — Зарплати і виплати\n` +
        `${statusEmoji('4.3')} Урок 4.3 — Регулярні платежі\n` +
        `${statusEmoji('4.4')} Урок 4.4 — Єдина таблиця\n` +
        `${statusEmoji('4.5')} Урок 4.5 — Інструкції команді\n\n` +
        `*Блок 5 — Баланс*\n` +
        `${statusEmoji('5.1')} Урок 5.1 — Статті балансу\n` +
        `${statusEmoji('5.2')} Урок 5.2 — Таблиця балансу\n` +
        `${statusEmoji('5.3')} Урок 5.3 — Баланс у бізнес-процесі\n\n` +
        `Перейдіть по посиланню з урока або введіть /progress для деталей.`
    );
}

async function sendProgress(user, chatId) {
    await sendMainMenu(user, chatId);
}

async function sendFiles(user, chatId) {
    const { FileStorage } = require('@platform/storage');
    const files = await FileStorage.getAllLatest(user.id);

    if (files.length === 0) {
        await sendMessage(chatId, '📂 У вас ще немає згенерованих файлів.');
        return;
    }

    const list = files.map(f => `• *${f.fileType}* (v${f.version}) — ${new Date(f.updatedAt).toLocaleDateString('uk-UA')}`).join('\n');
    await sendMessage(chatId, `📂 *Ваші файли:*\n\n${list}`);
}

async function routeToActiveSession(user, chatId, text) {
    const activeSession = await db.session.findFirst({
        where: { userId: user.id, isActive: true },
        orderBy: { lastActive: 'desc' },
        include: { bot: true },
    });

    if (!activeSession) {
        await sendMessage(chatId, 'Немає активного уроку. Натисніть /start щоб побачити меню.');
        return;
    }

    const { getHandler } = require(`./bots/${activeSession.bot.slug}/index`);
    const handler = getHandler();
    await handler.handleMessage(user, chatId, text, activeSession);
}

async function routeCallbackToActiveSession(user, chatId, data) {
    const activeSession = await db.session.findFirst({
        where: { userId: user.id, isActive: true },
        orderBy: { lastActive: 'desc' },
        include: { bot: true },
    });

    if (!activeSession) return;

    const { getHandler } = require(`./bots/${activeSession.bot.slug}/index`);
    const handler = getHandler();
    if (handler.handleCallback) {
        await handler.handleCallback(user, chatId, data, activeSession);
    }
}

module.exports = { handleTelegramUpdate };
