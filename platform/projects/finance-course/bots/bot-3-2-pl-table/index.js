'use strict';

const { callClaude, buildMessages } = require('@platform/claude');
const { sendMessage } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { db } = require('@platform/db');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const { AppsScriptService } = require('../../services/AppsScriptService');
const { parsePlArticles, articlesToText } = require('../../services/ArticleParser');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');

const SYSTEM_PROMPT = `Ти — ШІ-асистент курсу "Фінансова система малого бізнесу".
Твоя задача — уточнити налаштування таблиці P&L перед побудовою.

## КОНТЕКСТ
Бізнес: {{business_name}}
Статті доходів: {{inflows}}
Статті витрат: {{outflows}}

## РЕЖИМИ P&L
- **Загальний** — один звіт по всьому бізнесу
- **По проектах/напрямках** — окремі колонки для кожного напрямку (потрібно перелічити напрямки)

## ЩО УТОЧНИТИ
1. Режим: загальний P&L чи по проектах?
2. Якщо по проектах — перелічи назви напрямків/проектів
3. Чи є вже таблиця Cashflow куди додати P&L? (якщо так — додаємо аркуш "P&L" туди ж)

## ПОТОЧНИЙ СТАН
{{session_json}}

## ФОРМАТ ВІДПОВІДІ
<pl_session>
{
  "status": "draft|in_progress|ready",
  "mode": "total|by_project",
  "projects": [],
  "use_existing_spreadsheet": false,
  "confirmed": false
}
</pl_session>
[Текст для користувача]

Коли підтверджено — маркер [BUILD_PL]`;

const GREETING = (businessName, articlesText) =>
    `📈 Урок 3.2 — Таблиця P&L

Статті з урока 2.1:
${articlesText}

P&L (Profit & Loss) показує прибутковість бізнесу: доходи → валовий прибуток → EBITDA → чистий прибуток.

Перш за все: загальний P&L чи по окремих напрямках/проектах?`;

function extractTag(text, tag) {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match) { try { return JSON.parse(match[1].trim()); } catch { return null; } }
    return null;
}

function stripTags(text, ...tags) {
    let result = text;
    for (const tag of tags) result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    return result.replace(/\[BUILD_PL\]/g, '').trim();
}

class Bot32Handler {
    async start(user, chatId, bot) {
        const file = await FileStorage.getLatest(user.id, 'pl_articles');
        if (!file) {
            await sendMessage(chatId, '⚠️ Файл pl_articles не знайдено. Пройди спочатку урок 2.1.');
            return;
        }

        const articles = parsePlArticles(file.content);
        const session = await SessionService.getOrCreate(user.id, bot.id, 'collecting');
        await SessionService.updateState(session.id, 'collecting', {
            articles,
            plSession: { status: 'draft', mode: 'total', projects: [], use_existing_spreadsheet: false, confirmed: false },
        });

        const greeting = GREETING(articles.businessName, articlesToText(articles));
        await MessageService.save(session.id, 'assistant', greeting);
        await sendMessage(chatId, greeting, {
            reply_markup: {
                inline_keyboard: [[
                    { text: 'Загальний P&L', callback_data: 'pl_total' },
                    { text: 'По проектах', callback_data: 'pl_by_project' },
                ]],
            },
        });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            const url = session.context?.plUrl;
            await sendMessage(chatId, url ? `✅ P&L готовий: ${url}` : '✅ Цей урок вже завершено.');
            return;
        }

        await MessageService.save(session.id, 'user', text);

        const context = session.context || {};
        const articles = context.articles;
        if (!articles) {
            await sendMessage(chatId, '⚠️ Помилка. Спробуй /start ще раз.');
            return;
        }

        const dbMessages = await MessageService.getAll(session.id);
        const systemPrompt = SYSTEM_PROMPT
            .replace('{{business_name}}', articles.businessName)
            .replace('{{inflows}}', articles.inflows.join(', ') || '—')
            .replace('{{outflows}}', articles.outflows.join(', ') || '—')
            .replace('{{session_json}}', JSON.stringify(context.plSession || {}, (key, value) => {
                if (typeof value === 'bigint') return value.toString();
                return value;
            }, 2));

        let responseText;
        try {
            responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages: dbMessages.map(m => ({ role: m.role, content: m.content })),
            });
        } catch (err) {
            logger.error('Bot 3.2 Claude error', { error: err.message });
            await sendMessage(chatId, '⚠️ Помилка ШІ. Спробуй ще раз.');
            return;
        }

        const updatedSession = extractTag(responseText, 'pl_session');
        const botText = stripTags(responseText, 'pl_session');
        const shouldBuild = responseText.includes('[BUILD_PL]') || (updatedSession?.status === 'ready' && updatedSession?.confirmed);

        const contextPatch = { articles, plSession: updatedSession || context.plSession || {} };

        if (!shouldBuild) {
            await MessageService.save(session.id, 'assistant', botText);
            await SessionService.updateState(session.id, 'collecting', contextPatch);
            if (botText) await sendMessage(chatId, botText);
            return;
        }

        await sendMessage(chatId, '⏳ Будую таблицю P&L в Google Sheets...');
        try {
            const plSess = updatedSession || context.plSession || {};
            const cashflowFile = await FileStorage.getLatest(user.id, 'cashflow_table_url');
            const spreadsheetId = plSess.use_existing_spreadsheet && cashflowFile
                ? extractSpreadsheetId(cashflowFile.content) : null;

            const result = await AppsScriptService.buildPlTable({
                businessName: articles.businessName,
                telegramId: user.telegramId,
                articles: { inflows: articles.inflows, outflows: articles.outflows },
                spreadsheetId,
                byProject: plSess.mode === 'by_project',
                projects: plSess.projects || [],
            });

            const plUrl = result.spreadsheet_url || result.url || result.spreadsheetUrl;
            const bot = await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
            await FileStorage.save({
                userId: user.id,
                botId: bot?.id,
                sessionId: session.id,
                fileType: 'pl_table_url',
                content: plUrl,
                projectSlug: 'finance-course',
            });

            await SessionService.complete(session.id);
            await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
            await sendMessage(chatId, `✅ Таблиця P&L готова!\n\n📈 ${plUrl}\n\nРівні: Валовий прибуток → EBITDA → Чистий прибуток.`);
        } catch (err) {
            logger.error('Bot 3.2 Apps Script error', { error: err.message });
            await sendMessage(chatId, `⚠️ Помилка: ${err.message}`);
        }
    }
}

function extractSpreadsheetId(url) {
    const match = url && url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

function getHandler() {
    return new Bot32Handler();
}

module.exports = { getHandler };
