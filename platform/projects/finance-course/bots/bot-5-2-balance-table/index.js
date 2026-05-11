'use strict';

const { sendMessage } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { db } = require('@platform/db');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const { AppsScriptService } = require('../../services/AppsScriptService');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');

const GREETING = `⚖️ Урок 5.2 — Таблиця балансу

Зараз додамо аркуш "Баланс" до твоєї таблиці Cashflow+P&L в Google Sheets.

Таблиця матиме три розділи: Активи / Зобов'язання / Власний капітал.
Формула автоматично перевірить: Активи = Зобов'язання + Капітал.

Починаю побудову...`;

function extractArticlesFromBalanceFile(content) {
    if (!content) return { assets: [], liabilities: [], equity: [] };

    const assets = [];
    const liabilities = [];
    const equity = [];
    let section = null;

    for (const line of content.split('\n')) {
        if (/^##\s*Оборотні активи|^##\s*Необоротні активи/i.test(line)) { section = 'assets'; continue; }
        if (/^##\s*Поточні зобов|^##\s*Довгострокові зобов/i.test(line)) { section = 'liabilities'; continue; }
        if (/^##\s*Власний капітал/i.test(line)) { section = 'equity'; continue; }

        const heading = line.match(/^###\s*(.+)$/);
        if (heading) {
            const name = heading[1].trim();
            if (section === 'assets') assets.push(name);
            else if (section === 'liabilities') liabilities.push(name);
            else if (section === 'equity') equity.push(name);
        }
    }

    return { assets, liabilities, equity };
}

function extractSpreadsheetId(url) {
    const match = url && url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

class Bot52Handler {
    async start(user, chatId, bot) {
        const balanceFile = await FileStorage.getLatest(user.id, 'balance_articles');
        if (!balanceFile) {
            await sendMessage(chatId, '⚠️ Файл balance_articles не знайдено. Пройди спочатку урок 5.1.');
            return;
        }

        const session = await SessionService.getOrCreate(user.id, bot.id, 'building');
        await SessionService.updateState(session.id, 'building', { balanceContent: balanceFile.content });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);

        await this._build(user, chatId, session, bot);
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            const url = session.context?.balanceUrl;
            await sendMessage(chatId, url ? `✅ Таблиця балансу готова: ${url}` : '✅ Цей урок вже завершено.');
            return;
        }
        await this._build(user, chatId, session, null);
    }

    async _build(user, chatId, session, bot) {
        await sendMessage(chatId, '⏳ Будую аркуш Баланс...');

        const context = session.context || {};
        const balanceFile = context.balanceContent
            ? { content: context.balanceContent }
            : await FileStorage.getLatest(user.id, 'balance_articles');

        if (!balanceFile) {
            await sendMessage(chatId, '⚠️ Файл balance_articles не знайдено.');
            return;
        }

        const articles = extractArticlesFromBalanceFile(balanceFile.content);
        const cfFile = await FileStorage.getLatest(user.id, 'cashflow_articles');
        const businessName = cfFile
            ? (cfFile.content.match(/\*\*Бізнес:\*\*\s*(.+)/) || [])[1] || 'Бізнес'
            : 'Бізнес';

        // Try to use existing combined spreadsheet
        const combinedFile = await FileStorage.getLatest(user.id, 'combined_table_url')
            || await FileStorage.getLatest(user.id, 'cashflow_table_url');
        const spreadsheetId = combinedFile ? extractSpreadsheetId(combinedFile.content) : null;

        try {
            const result = await AppsScriptService.buildBalanceTable({
                businessName,
                telegramId: user.telegramId,
                articles: {
                    inflows: articles.assets,
                    outflows: [...articles.liabilities, ...articles.equity],
                },
                spreadsheetId,
            });

            const balanceUrl = result.spreadsheet_url || result.url || result.spreadsheetUrl || combinedFile?.content;
            const botRecord = bot || await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
            await FileStorage.save({
                userId: user.id, botId: botRecord?.id, sessionId: session.id,
                fileType: 'balance_table_url', content: balanceUrl, projectSlug: 'finance-course',
            });

            await SessionService.complete(session.id);
            await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
            await sendMessage(chatId,
                `✅ Аркуш "Баланс" додано!\n\n⚖️ ${balanceUrl}\n\nТепер твоя таблиця містить: Cashflow + P&L + Баланс ✅`
            );
        } catch (err) {
            logger.error('Bot 5.2 Apps Script error', { error: err.message });
            await sendMessage(chatId, `⚠️ Помилка при побудові таблиці: ${err.message}`);
        }
    }
}

function getHandler() {
    return new Bot52Handler();
}

module.exports = { getHandler };
