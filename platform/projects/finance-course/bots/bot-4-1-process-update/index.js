'use strict';

const { callClaude, buildMessages } = require('@platform/claude');
const { sendMessage } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { db } = require('@platform/db');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');

const SYSTEM_PROMPT = `Ти — ШІ-асистент курсу "Фінансова система малого бізнесу".
Твоя задача — допомогти оновити схему бізнес-процесу, додавши в неї всі фінансові точки.

## КОНТЕКСТ
Поточний бізнес-процес:
{{business_process}}

Статті Cashflow:
{{cashflow_articles}}

Статті P&L:
{{pl_articles}}

## ЗАДАЧА
Для кожної фінансової статті визнач:
1. Де в бізнес-процесі виникає ця стаття? (на якому кроці)
2. Хто відповідає за фіксацію?
3. Як часто і звідки беруться дані?

Після аналізу — запропонуй оновлену схему де кожен фінансовий момент привязаний до конкретного кроку процесу.

## ПРАВИЛА ДІАЛОГУ
- Задавай ОДНЕ питання за раз
- Показуй прогрес: "Стаття 3 з 8"
- Якщо відповідь очевидна — підтверди і не запитуй
- Після всіх статей — покажи підсумкову таблицю і попроси підтвердження

## ПОТОЧНИЙ СТАН
{{session_json}}

## ФОРМАТ ВІДПОВІДІ
<update_session>
{
  "status": "draft|in_progress|complete",
  "processed_articles": [],
  "financial_points": [
    {
      "article": "назва статті",
      "process_step": "назва кроку",
      "responsible": "хто",
      "frequency": "як часто",
      "data_source": "звідки дані"
    }
  ],
  "confirmed": false
}
</update_session>
[Текст для користувача]

Коли підтверджено — маркер [COMPLETE]`;

const GREETING = `📋 Урок 4.1 — Оновлення бізнес-процесу

Тепер ми прив'яжемо кожну фінансову статтю до конкретного кроку твого бізнес-процесу.

Це допоможе команді розуміти: хто, де і коли фіксує кожну цифру.

Починаємо! Дивлюся на твої статті...`;

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

function buildDocument(financialPoints, businessProcess) {
    const date = new Date().toISOString().slice(0, 10);
    const rows = (financialPoints || []).map(fp =>
        `| ${fp.article} | ${fp.process_step} | ${fp.responsible} | ${fp.frequency} | ${fp.data_source} |`
    ).join('\n');

    return [
        '# Оновлений бізнес-процес (v2)',
        `**Дата:** ${date}`,
        '',
        '## Фінансові точки в процесі',
        '',
        '| Стаття | Крок процесу | Відповідальний | Periodичність | Джерело даних |',
        '|---|---|---|---|---|',
        rows,
        '',
        '## Вихідний бізнес-процес',
        businessProcess || '',
    ].join('\n');
}

class Bot41Handler {
    async start(user, chatId, bot) {
        const [bpFile, cfFile, plFile] = await Promise.all([
            FileStorage.getLatest(user.id, 'business_process'),
            FileStorage.getLatest(user.id, 'cashflow_articles'),
            FileStorage.getLatest(user.id, 'pl_articles'),
        ]);

        const session = await SessionService.getOrCreate(user.id, bot.id, 'interviewing');
        await SessionService.updateState(session.id, 'interviewing', {
            businessProcess: bpFile?.content || '',
            cashflowArticles: cfFile?.content || '',
            plArticles: plFile?.content || '',
            interviewSession: { status: 'draft', processed_articles: [], financial_points: [], confirmed: false },
        });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);
        logger.info('Bot 4.1 started', { userId: user.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Цей урок вже завершено. Файл business_process_v2.md збережено.');
            return;
        }

        await MessageService.save(session.id, 'user', text);

        const context = session.context || {};
        const dbMessages = await MessageService.getAll(session.id);
        const systemPrompt = SYSTEM_PROMPT
            .replace('{{business_process}}', (context.businessProcess || '').slice(0, 2000))
            .replace('{{cashflow_articles}}', (context.cashflowArticles || '').slice(0, 1500))
            .replace('{{pl_articles}}', (context.plArticles || '').slice(0, 1500))
            .replace('{{session_json}}', JSON.stringify(context.interviewSession || {}, (key, value) => {
                if (typeof value === 'bigint') return value.toString();
                return value;
            }, 2));

        let responseText;
        try {
            responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages: buildMessages(dbMessages),
            });
        } catch (err) {
            logger.error('Bot 4.1 Claude error', { error: err.message });
            await sendMessage(chatId, '⚠️ Помилка ШІ. Спробуй ще раз.');
            return;
        }

        const updatedSession = extractTag(responseText, 'update_session');
        const botText = stripTags(responseText, 'update_session');
        const isComplete = responseText.includes('[COMPLETE]') || (updatedSession?.confirmed && updatedSession?.status === 'complete');

        const contextPatch = { ...context, interviewSession: updatedSession || context.interviewSession || {} };

        if (!isComplete) {
            await MessageService.save(session.id, 'assistant', botText);
            await SessionService.updateState(session.id, 'interviewing', contextPatch);
            if (botText) await sendMessage(chatId, botText);
            return;
        }

        const fp = (updatedSession || context.interviewSession || {}).financial_points || [];
        const docContent = buildDocument(fp, context.businessProcess);

        const bot = await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
        await FileStorage.save({
            userId: user.id, botId: bot?.id, sessionId: session.id,
            fileType: 'business_process_v2', content: docContent, projectSlug: 'finance-course',
        });

        await SessionService.complete(session.id);
        await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');

        if (botText) await sendMessage(chatId, botText);
        await sendMessage(chatId, '✅ Оновлений бізнес-процес збережено як *business_process_v2.md*\n\nПереходьте до уроку 4.2 ✅', { parse_mode: 'Markdown' });
    }
}

function getHandler() {
    return new Bot41Handler();
}

module.exports = { getHandler };
