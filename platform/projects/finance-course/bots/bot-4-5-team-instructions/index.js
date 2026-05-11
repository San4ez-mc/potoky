'use strict';

const { callClaude } = require('@platform/claude');
const { sendMessage } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { db } = require('@platform/db');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');

const SYSTEM_PROMPT = `Ти — ШІ-асистент курсу "Фінансова система малого бізнесу".
Твоя задача — сформувати персональні інструкції для кожної ролі в компанії.

## ДОКУМЕНТИ КЛІЄНТА

### Бізнес-процес v2:
{{business_process_v2}}

### Зарплати і виплати:
{{salary_processes}}

### Регулярні платежі:
{{payment_processes}}

### Статті Cashflow:
{{cashflow_articles}}

### Статті P&L:
{{pl_articles}}

## ЗАДАЧА
1. Визнач всі ролі в компанії (з бізнес-процесу)
2. Для кожної ролі визнач: що вносити в таблицю, коли, звідки брати дані, куди вносити
3. Сформуй інструкцію для кожної ролі

## ПРАВИЛА
- Говори конкретно: "щопонеділка до 10:00 вносиш суму виручки в аркуш Cashflow, колонка 'Оплата клієнта'"
- Уникай загальних фраз
- Якщо є уточнення — задавай ОДНЕ питання

## ФОРМАТ ВІДПОВІДІ
<team_session>
{
  "status": "draft|in_progress|complete",
  "roles_processed": [],
  "instructions": [
    {
      "role": "Менеджер продажів",
      "tasks": ["Щопонеділка до 10:00 вносиш..."]
    }
  ],
  "confirmed": false
}
</team_session>
[Текст для користувача]

Коли підтверджено — маркер [COMPLETE]`;

const GREETING = `👥 Урок 4.5 — Інструкції для команди

Фінальний крок блоку 4: я проаналізую всі твої файли і створю персональні інструкції для кожної ролі в команді.

Кожен отримає чіткий список: що вносити, коли і куди.

Аналізую документи... Це займе кілька секунд.`;

function extractTag(text, tag) {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match) { try { return JSON.parse(match[1].trim()); } catch { return null; } }
    return null;
}

function stripTags(text, ...tags) {
    let result = text;
    for (const t of tags) result = result.replace(new RegExp(`<${t}>[\\s\\S]*?<\\/${t}>`, 'gi'), '');
    return result.replace(/\[COMPLETE\]/g, '').trim();
}

function buildDocument(teamSession) {
    const s = teamSession || {};
    const date = new Date().toISOString().slice(0, 10);
    const instructions = (s.instructions || []).map(inst => {
        const tasks = (inst.tasks || []).map(t => `- ${t}`).join('\n');
        return `## ${inst.role}\n${tasks}`;
    }).join('\n\n');

    return [
        '# Персональні інструкції команді',
        `**Дата:** ${date}`,
        '',
        instructions || '_Інструкції не сформовано_',
    ].join('\n');
}

class Bot45Handler {
    async start(user, chatId, bot) {
        const [bpV2, salary, payments, cf, pl] = await Promise.all([
            FileStorage.getLatest(user.id, 'business_process_v2'),
            FileStorage.getLatest(user.id, 'salary_processes'),
            FileStorage.getLatest(user.id, 'payment_processes'),
            FileStorage.getLatest(user.id, 'cashflow_articles'),
            FileStorage.getLatest(user.id, 'pl_articles'),
        ]);

        const session = await SessionService.getOrCreate(user.id, bot.id, 'generating');
        await SessionService.updateState(session.id, 'generating', {
            businessProcessV2: bpV2?.content || '',
            salaryProcesses: salary?.content || '',
            paymentProcesses: payments?.content || '',
            cashflowArticles: cf?.content || '',
            plArticles: pl?.content || '',
            interviewSession: { status: 'draft', roles_processed: [], instructions: [], confirmed: false },
        });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);

        // Trigger initial generation automatically
        await this._generate(user, chatId, session);
        logger.info('Bot 4.5 started', { userId: user.id });
    }

    async _generate(user, chatId, session) {
        const context = session.context || {};
        const dbMessages = await MessageService.getHistory(session.id);
        const systemPrompt = SYSTEM_PROMPT
            .replace('{{business_process_v2}}', (context.businessProcessV2 || '').slice(0, 2000))
            .replace('{{salary_processes}}', (context.salaryProcesses || '').slice(0, 1000))
            .replace('{{payment_processes}}', (context.paymentProcesses || '').slice(0, 1000))
            .replace('{{cashflow_articles}}', (context.cashflowArticles || '').slice(0, 1000))
            .replace('{{pl_articles}}', (context.plArticles || '').slice(0, 1000));

        let responseText;
        try {
            responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages: dbMessages.map(m => ({ role: m.role, content: m.content })),
                options: { maxTokens: 4096 },
            });
        } catch (err) {
            logger.error('Bot 4.5 Claude error', { error: err.message });
            await sendMessage(chatId, '⚠️ Помилка ШІ. Спробуй ще раз.');
            return;
        }

        const updatedSession = extractTag(responseText, 'team_session');
        const botText = stripTags(responseText, 'team_session');
        const isComplete = responseText.includes('[COMPLETE]') || updatedSession?.confirmed;

        const contextPatch = { ...context, interviewSession: updatedSession || context.interviewSession || {} };

        if (!isComplete) {
            await MessageService.save(session.id, 'assistant', botText);
            await SessionService.updateState(session.id, 'generating', contextPatch);
            if (botText) await sendMessage(chatId, botText);
            return;
        }

        await this._finalize(user, chatId, session, updatedSession || context.interviewSession, botText);
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Цей урок вже завершено. Файл team_instructions.md збережено.');
            return;
        }
        await MessageService.save(session.id, 'user', text);
        await this._generate(user, chatId, session);
    }

    async _finalize(user, chatId, session, teamSession, botText) {
        const docContent = buildDocument(teamSession);
        const bot = await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
        await FileStorage.save({
            userId: user.id, botId: bot?.id, sessionId: session.id,
            fileType: 'team_instructions', content: docContent, projectSlug: 'finance-course',
        });
        await SessionService.complete(session.id);
        await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
        if (botText) await sendMessage(chatId, botText);
        await sendMessage(chatId, '✅ Файл *team_instructions.md* збережено!\n\nБлок 4 завершено. Переходьте до блоку 5 ✅', { parse_mode: 'Markdown' });
    }
}

function getHandler() {
    return new Bot45Handler();
}

module.exports = { getHandler };
