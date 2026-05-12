'use strict';

const { callClaude, buildMessages } = require('@platform/claude');
const { sendMessage } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { db } = require('@platform/db');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const { AppsScriptService } = require('../../services/AppsScriptService');
const { parseCashflowArticles, articlesToText } = require('../../services/ArticleParser');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');
const { PAYMENT_CALENDAR_PROMPT } = require('./prompts');

const GREETING = (businessName, articlesText) =>
    `📅 Урок 2.3 — Платіжний календар

Маю твої статті:
${articlesText}

Платіжний календар — це таблиця де видно всі надходження і виплати по тижнях. Формули автоматично підсвітять тижні де витрати перевищують надходження.

Перш за все: на який горизонт будуємо?`;

function extractTag(text, tag) {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match) { try { return JSON.parse(match[1].trim()); } catch { return null; } }
    return null;
}

function stripTags(text, ...tags) {
    let result = text;
    for (const tag of tags) result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    return result.replace(/\[BUILD_CALENDAR\]/g, '').trim();
}

class Bot23Handler {
    async start(user, chatId, bot) {
        const file = await FileStorage.getLatest(user.id, 'cashflow_articles');
        if (!file) {
            await sendMessage(chatId, '⚠️ Файл cashflow_articles не знайдено. Спочатку пройди урок 2.1.');
            return;
        }

        const articles = parseCashflowArticles(file.content);
        const session = await SessionService.getOrCreate(user.id, bot.id, 'collecting');
        await SessionService.updateState(session.id, 'collecting', {
            articles,
            calendarSession: { status: 'draft', horizon_months: 1, known_payments: [], current_article_index: 0, confirmed: false },
        });

        const greeting = GREETING(articles.businessName, articlesToText(articles));
        await MessageService.save(session.id, 'assistant', greeting);
        await sendMessage(chatId, greeting, {
            reply_markup: {
                inline_keyboard: [[
                    { text: '1 місяць', callback_data: '1_month' },
                    { text: '3 місяці', callback_data: '3_months' },
                ]],
            },
        });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            const url = session.context?.calendarUrl;
            await sendMessage(chatId, url ? `✅ Календар готовий: ${url}` : '✅ Цей урок вже завершено.');
            return;
        }

        await MessageService.save(session.id, 'user', text);

        const context = session.context || {};
        const articles = context.articles;
        if (!articles) {
            await sendMessage(chatId, '⚠️ Помилка. Спробуй /start ще раз.');
            return;
        }

        const dbMessages = await MessageService.getHistory(session.id);
        const systemPrompt = PAYMENT_CALENDAR_PROMPT
            .replace('{{business_name}}', articles.businessName)
            .replace('{{inflows}}', articles.inflows.join(', ') || '—')
            .replace('{{outflows}}', articles.outflows.join(', ') || '—')
            .replace('{{session_json}}', JSON.stringify(context.calendarSession || {}, null, 2));

        let responseText;
        try {
            responseText = await callClaude({ sessionId: session.id, systemPrompt, messages: buildMessages(dbMessages) });
        } catch (err) {
            logger.error('Bot 2.3 Claude error', { error: err.message });
            await sendMessage(chatId, '⚠️ Помилка ШІ. Спробуй ще раз.');
            return;
        }

        const updatedSession = extractTag(responseText, 'calendar_session');
        const botText = stripTags(responseText, 'calendar_session');
        const shouldBuild = responseText.includes('[BUILD_CALENDAR]') || (updatedSession?.status === 'ready' && updatedSession?.confirmed);

        const contextPatch = { articles, calendarSession: updatedSession || context.calendarSession || {} };

        if (!shouldBuild) {
            await MessageService.save(session.id, 'assistant', botText);
            await SessionService.updateState(session.id, 'collecting', contextPatch);
            if (botText) await sendMessage(chatId, botText);
            return;
        }

        await sendMessage(chatId, '⏳ Будую Платіжний календар в Google Sheets...');
        try {
            const horizonMonths = updatedSession?.horizon_months || 1;
            // Try to get existing cashflow spreadsheet ID
            const cashflowFile = await FileStorage.getLatest(user.id, 'cashflow_table_url');
            const spreadsheetId = cashflowFile ? extractSpreadsheetId(cashflowFile.content) : null;

            const result = await AppsScriptService.buildPaymentCalendar({
                businessName: articles.businessName,
                telegramId: user.telegramId,
                articles: { inflows: articles.inflows, outflows: articles.outflows },
                spreadsheetId,
                horizonMonths,
            });

            const calendarUrl = result.spreadsheet_url || result.url || result.spreadsheetUrl || cashflowFile?.content;
            const bot = await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
            await FileStorage.save({
                userId: user.id,
                botId: bot?.id,
                sessionId: session.id,
                fileType: 'payment_calendar_url',
                content: calendarUrl,
                projectSlug: 'finance-course',
            });

            await SessionService.complete(session.id);
            await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
            await sendMessage(chatId, `✅ Платіжний календар готовий!\n\n📅 ${calendarUrl}`);
        } catch (err) {
            logger.error('Bot 2.3 Apps Script error', { error: err.message });
            await sendMessage(chatId, `⚠️ Помилка при побудові календаря: ${err.message}`);
        }
    }
}

function extractSpreadsheetId(url) {
    const match = url && url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

function getHandler() {
    return new Bot23Handler();
}

module.exports = { getHandler };
