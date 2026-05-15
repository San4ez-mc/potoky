'use strict';

const { sendMessage } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const { AppsScriptService } = require('../../services/AppsScriptService');
const { parseCashflowArticles, articlesToText } = require('../../services/ArticleParser');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');

const GREETING = (businessName, articlesText) =>
    `📊 Урок 2.2 — Таблиця Cashflow

Я бачу твої статті:
${articlesText}

Зараз я автоматично побудую таблицю Cashflow в Google Sheets на основі цих статей.

Готовий? Натисни "Почати" або напиши що-небудь щоб розпочати.`;

const MSG_BUILDING = `⏳ Будую таблицю під твій бізнес — це займе 20-30 секунд. Вже скоро!`;

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

        const session = await SessionService.getOrCreate(user.id, bot.id, 'building');
        await SessionService.updateState(session.id, 'building', {
            articles,
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

        // Build the table with retry and validation
        await sendMessage(chatId, MSG_BUILDING);
        try {
            const result = await AppsScriptService.withRetry(async () => {
                return await AppsScriptService.buildCashflowTable({
                    businessName: articles.businessName,
                    telegramId: user.telegramId,
                    articles: { inflows: articles.inflows, outflows: articles.outflows },
                });
            }, { maxAttempts: 3 });

            const sheetsUrl = result.spreadsheet_url || result.url || result.spreadsheetUrl;
            const spreadsheetId = result.spreadsheet_id;
            
            if (!sheetsUrl) throw new Error('No spreadsheet URL in response');

            // Validate and repair if needed
            let validationOk = false;
            if (spreadsheetId) {
                try {
                    const valResult = await AppsScriptService.validateAndRepair({ spreadsheetId });
                    validationOk = valResult.valid;
                    if (valResult.repaired) {
                        await sendMessage(chatId, '🔧 Таблиця відремонтована та перевірена.');
                    }
                } catch (valErr) {
                    logger.warn('Table validation/repair skipped', { error: valErr.message });
                    validationOk = false;
                }
            }

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
            
            const successMsg = validationOk 
                ? `✅ Таблиця Cashflow побудована й перевірена!\n\n📊 ${sheetsUrl}`
                : `✅ Таблиця Cashflow побудована!\n\n📊 ${sheetsUrl}`;
            
            await sendMessage(chatId,
                `${successMsg}\n\nВона відкрита для редагування. Поверніться до курсу для наступного уроку.`
            );
        } catch (err) {
            logger.error('Bot 2.2 Apps Script error', { error: err.message });
            await sendMessage(chatId,
                `⚠️ Не вдалося побудувати таблицю.\n\nПричина: ${err.message}\n\nПеревір налаштування та спробуй ще раз командою /start або /retry.`
            );
        }
    }
}

function getHandler() {
    return new Bot22Handler();
}
