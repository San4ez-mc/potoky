'use strict';

const { sendMessage } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { db } = require('@platform/db');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const { AppsScriptService } = require('../../services/AppsScriptService');
const { parseCashflowArticles, parsePlArticles } = require('../../services/ArticleParser');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');

const GREETING = `🔗 Урок 4.4 — Єдина таблиця Cashflow + P&L

Зараз об'єднаємо всі таблиці в один Google Sheets файл:
- Аркуш "Cashflow" — рух грошей
- Аркуш "P&L" — прибутки і збитки
- Аркуш "Зарплати" (якщо є файл)
- Аркуш "Регулярні платежі" (якщо є файл)

Починаю збірку таблиці...`;

function extractSpreadsheetId(url) {
    const match = url && url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

class Bot44Handler {
    async start(user, chatId, bot) {
        const session = await SessionService.getOrCreate(user.id, bot.id, 'building');
        await SessionService.updateState(session.id, 'building', {});

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);

        // Auto-proceed to build
        await this._build(user, chatId, session, bot);
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            const url = session.context?.combinedUrl;
            await sendMessage(chatId, url ? `✅ Таблиця готова: ${url}` : '✅ Цей урок вже завершено.');
            return;
        }
        // Re-trigger build
        await this._build(user, chatId, session, null);
    }

    async _build(user, chatId, session, bot) {
        await sendMessage(chatId, '⏳ Будую єдину таблицю...');

        const [cfFile, plFile, salaryFile, paymentsFile, cfUrlFile, plUrlFile] = await Promise.all([
            FileStorage.getLatest(user.id, 'cashflow_articles'),
            FileStorage.getLatest(user.id, 'pl_articles'),
            FileStorage.getLatest(user.id, 'salary_processes'),
            FileStorage.getLatest(user.id, 'payment_processes'),
            FileStorage.getLatest(user.id, 'cashflow_table_url'),
            FileStorage.getLatest(user.id, 'pl_table_url'),
        ]);

        const cfArticles = cfFile ? parseCashflowArticles(cfFile.content) : { businessName: 'Бізнес', inflows: [], outflows: [] };
        const plArticles = plFile ? parsePlArticles(plFile.content) : { inflows: [], outflows: [] };

        // Prefer to extend existing spreadsheet
        const existingId = (cfUrlFile ? extractSpreadsheetId(cfUrlFile.content) : null)
            || (plUrlFile ? extractSpreadsheetId(plUrlFile.content) : null);

        try {
            const result = await AppsScriptService.callAppsScript({
                action: 'build_table',
                report_type: 'cashflow_and_pl',
                business_name: cfArticles.businessName,
                telegram_id: String(user.telegramId),
                articles: {
                    inflows: cfArticles.inflows,
                    outflows: cfArticles.outflows,
                    pl_outflows: plArticles.outflows,
                },
                ...(existingId ? { spreadsheet_id: existingId } : {}),
                include_salary_sheet: Boolean(salaryFile),
                include_payments_sheet: Boolean(paymentsFile),
                salary_data: salaryFile ? salaryFile.content.slice(0, 3000) : '',
                payments_data: paymentsFile ? paymentsFile.content.slice(0, 3000) : '',
            });

            const combinedUrl = result.spreadsheet_url || result.url || result.spreadsheetUrl;
            const botRecord = bot || await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
            await FileStorage.save({
                userId: user.id, botId: botRecord?.id, sessionId: session.id,
                fileType: 'cashflow_table_url', content: combinedUrl, projectSlug: 'finance-course',
            });

            await SessionService.complete(session.id);
            await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
            await sendMessage(chatId,
                `✅ Єдина таблиця готова!\n\n🔗 ${combinedUrl}\n\nТепер у тебе один файл з Cashflow, P&L та всіма пов'язаними аркушами.`
            );
        } catch (err) {
            logger.error('Bot 4.4 Apps Script error', { error: err.message });
            await sendMessage(chatId,
                `⚠️ Не вдалося об'єднати таблиці автоматично: ${err.message}\n\nПеревір налаштування APPS_SCRIPT_URL.`
            );
        }
    }
}

function getHandler() {
    return new Bot44Handler();
}

module.exports = { getHandler };
