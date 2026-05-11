'use strict';

const { db } = require('@platform/db');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { sendMessage } = require('@platform/telegram');
const { callClaude, buildMessages } = require('@platform/claude');
const { FileStorage } = require('@platform/storage');
const { ProgressService } = require('../../services/ProgressService');
const { SYSTEM_PROMPT } = require('./prompts/system');
const logger = require('@platform/logger');

const BOT_CONFIG = require('./bot.config');

const GREETING = `Привіт! 👋 Я допоможу тобі визначити статті для двох ключових фінансових звітів — Cashflow і P&L.

Спочатку скажи: чим займається твій бізнес? Коротко — сфера і що ви робите/продаєте.`;

/**
 * Парсить [GENERATE_FILES]...[/GENERATE_FILES] з відповіді Claude.
 */
function extractGeneratePayload(text) {
    const match = text.match(/\[GENERATE_FILES\]([\s\S]*?)\[\/GENERATE_FILES\]/);
    if (!match) return null;
    try {
        return JSON.parse(match[1].trim());
    } catch {
        return null;
    }
}

/**
 * Генерує markdown-файл cashflow_articles.md
 */
function buildCashflowFile(data) {
    const incomeLines = data.cashflow.income
        .map(i => `### ${i.name}\n${i.description}`)
        .join('\n\n');

    const expenseLines = data.cashflow.expense
        .map(e => `### ${e.name}\nОпис: ${e.description}\nПеріодичність: ${e.frequency}`)
        .join('\n\n');

    return `# Статті Cashflow\n\n**Бізнес:** ${data.businessType}\n\n## Статті доходів\n\n${incomeLines}\n\n## Статті витрат\n\n${expenseLines}\n`;
}

/**
 * Генерує markdown-файл pl_articles.md
 */
function buildPlFile(data) {
    const incomeLines = data.pl.income
        .map(i => `### ${i.name}\n${i.description}`)
        .join('\n\n');

    const expenseLines = data.pl.expense
        .map(e => `### ${e.name}\nОпис: ${e.description}\nТип: ${e.costType === 'variable' ? 'Змінні' : 'Постійні'}`)
        .join('\n\n');

    return `# Статті P&L\n\n**Бізнес:** ${data.businessType}\n\n## Статті доходів\n\n${incomeLines}\n\n## Статті витрат\n\n${expenseLines}\n`;
}

class Bot21Handler {
    async start(user, chatId, bot) {
        const session = await SessionService.getOrCreate(user.id, bot.id, 'awaiting_business_type');

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);

        logger.info('Bot 2.1 started', { userId: user.id, sessionId: session.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Ти вже завершив цей урок. Файли збережені. Використай /files щоб їх переглянути.');
            return;
        }

        await MessageService.save(session.id, 'user', text);
        await SessionService.updateState(session.id, session.state, {});

        const dbMessages = await MessageService.getAll(session.id);
        const messages = buildMessages(dbMessages.filter(m => m.role !== 'system'));

        const responseText = await callClaude({
            sessionId: session.id,
            systemPrompt: SYSTEM_PROMPT,
            messages,
        });

        const payload = extractGeneratePayload(responseText);

        if (payload) {
            await this._generateFiles(user, chatId, session, payload);
        } else {
            await MessageService.save(session.id, 'assistant', responseText);
            await sendMessage(chatId, responseText);
        }
    }

    async _generateFiles(user, chatId, session, payload) {
        const bot = await db.bot.findUnique({ where: { id: session.botId } });
        const project = await db.project.findFirst({ where: { slug: 'finance-course' } });

        await sendMessage(chatId, '⏳ Генерую файли...');

        const [cashflowFile, plFile] = await Promise.all([
            FileStorage.save({
                userId: user.id,
                botId: session.botId,
                sessionId: session.id,
                fileType: 'cashflow_articles',
                content: buildCashflowFile(payload),
                projectSlug: 'finance-course',
            }),
            FileStorage.save({
                userId: user.id,
                botId: session.botId,
                sessionId: session.id,
                fileType: 'pl_articles',
                content: buildPlFile(payload),
                projectSlug: 'finance-course',
            }),
        ]);

        await SessionService.complete(session.id);

        if (project) {
            await ProgressService.markCompleted(user.id, project.id, BOT_CONFIG.lessonNumber, session.botId, cashflowFile.id);
        }

        await sendMessage(chatId,
            `✅ *Готово! Файли збережені:*\n\n` +
            `📄 *cashflow_articles.md* (v${cashflowFile.version})\n` +
            `📄 *pl_articles.md* (v${plFile.version})\n\n` +
            `Тепер ти можеш перейти до уроку 2.2 — побудова таблиці Cashflow в Google Sheets.`
        );

        logger.info('Bot 2.1 completed', {
            userId: user.id,
            sessionId: session.id,
            cashflowVersion: cashflowFile.version,
            plVersion: plFile.version,
        });
    }
}

function getHandler() {
    return new Bot21Handler();
}

module.exports = { getHandler };
