'use strict';

const { callClaude, buildMessages } = require('@platform/claude');
const { sendMessage } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const { AppsScriptService } = require('../../services/AppsScriptService');
const { parseCashflowArticles, articlesToText } = require('../../services/ArticleParser');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');
const { CASHFLOW_TABLE_PROMPT } = require('./prompts');

const GREETING = (businessName, articlesText) =>
    `📊 Урок 2.2 — Таблиця Cashflow

Я бачу твої статті:
${articlesText}

Зараз я задам кілька коротких питань про те, як буде вноситись інформація, і після цього автоматично побудую таблицю Cashflow в Google Sheets.

Готовий? Почнемо!`;

function extractTag(text, tag) {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match) { try { return JSON.parse(match[1].trim()); } catch { return null; } }
    return null;
}

function stripTags(text, ...tags) {
    let result = text;
    for (const tag of tags) {
        result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    }
    return result.replace(/\[BUILD_TABLE\]/g, '').trim();
}

function buildSystemPrompt(articles, sessionJson) {
    return CASHFLOW_TABLE_PROMPT
        .replace('{{business_name}}', articles.businessName)
        .replace('{{inflows}}', articles.inflows.join(', ') || '—')
        .replace('{{outflows}}', articles.outflows.join(', ') || '—')
        .replace('{{session_json}}', JSON.stringify(sessionJson, null, 2));
}

class Bot22Handler {
    async start(user, chatId, bot) {
        // Load cashflow_articles file
        const file = await FileStorage.getLatest(user.id, 'cashflow_articles');
        if (!file) {
            await sendMessage(chatId, '⚠️ Файл cashflow_articles не знайдено. Спочатку пройди урок 2.1.');
            return;
        }

        const articles = parseCashflowArticles(file.content);
        const articlesText = articlesToText(articles);

        const session = await SessionService.getOrCreate(user.id, bot.id, 'collecting');
        await SessionService.updateState(session.id, 'collecting', {
            articles,
            tableSession: { status: 'draft', article_settings: [], confirmed: false },
        });

        const greeting = GREETING(articles.businessName, articlesText);
        await MessageService.save(session.id, 'assistant', greeting);
        await sendMessage(chatId, greeting);
        logger.info('Bot 2.2 started', { userId: user.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            const ctx = session.context || {};
            const url = ctx.sheetsUrl;
            await sendMessage(chatId, url
                ? `✅ Таблиця вже побудована: ${url}`
                : '✅ Ти вже завершив цей урок.');
            return;
        }

        await MessageService.save(session.id, 'user', text);

        const context = session.context || {};
        const articles = context.articles;
        if (!articles) {
            await sendMessage(chatId, '⚠️ Помилка: статті не знайдено. Спробуй /start ще раз.');
            return;
        }

        const dbMessages = await MessageService.getHistory(session.id);
        const messages = buildMessages(dbMessages);
        const systemPrompt = buildSystemPrompt(articles, context.tableSession || {});

        let responseText;
        try {
            responseText = await callClaude({ sessionId: session.id, systemPrompt, messages });
        } catch (err) {
            logger.error('Bot 2.2 Claude error', { error: err.message });
            await sendMessage(chatId, '⚠️ Не вдалося отримати відповідь. Спробуй ще раз.');
            return;
        }

        const updatedSession = extractTag(responseText, 'table_session');
        const botText = stripTags(responseText, 'table_session');
        const shouldBuild = responseText.includes('[BUILD_TABLE]') || (updatedSession?.status === 'ready' && updatedSession?.confirmed);

        const contextPatch = { articles, tableSession: updatedSession || context.tableSession || {} };

        if (!shouldBuild) {
            await MessageService.save(session.id, 'assistant', botText);
            await SessionService.updateState(session.id, 'collecting', contextPatch);
            if (botText) await sendMessage(chatId, botText);
            return;
        }

        // Build the table
        await sendMessage(chatId, '⏳ Будую таблицю Cashflow в Google Sheets...');
        try {
            const result = await AppsScriptService.buildCashflowTable({
                businessName: articles.businessName,
                telegramId: user.telegramId,
                articles: { inflows: articles.inflows, outflows: articles.outflows },
            });

            const sheetsUrl = result.spreadsheet_url || result.url || result.spreadsheetUrl;
            if (!sheetsUrl) throw new Error('No spreadsheet URL in response');

            // Save URL as file artifact
            const bot = await require('@platform/db').db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
            await FileStorage.save({
                userId: user.id,
                botId: bot?.id,
                sessionId: session.id,
                fileType: 'cashflow_table_url',
                content: sheetsUrl,
                projectSlug: 'finance-course',
            });

            await SessionService.complete(session.id);
            await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
            await sendMessage(chatId,
                `✅ Таблиця Cashflow побудована!\n\n📊 ${sheetsUrl}\n\nВона відкрита для редагування. Поверніться до курсу для наступного уроку.`
            );
        } catch (err) {
            logger.error('Bot 2.2 Apps Script error', { error: err.message });
            await sendMessage(chatId,
                `⚠️ Не вдалося побудувати таблицю автоматично.\n\nПричина: ${err.message}\n\nПеревір що APPS_SCRIPT_URL налаштовано і спробуй ще раз командою /start.`
            );
        }
    }
}

function getHandler() {
    return new Bot22Handler();
}

module.exports = { getHandler };
