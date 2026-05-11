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
Твоя задача — розробити процес заповнення балансу для конкретного бізнесу.

## ДОКУМЕНТИ КЛІЄНТА

### Статті балансу:
{{balance_articles}}

### Бізнес-процес v2 (з фінансовими точками):
{{business_process_v2}}

### Команда і зарплати:
{{team_instructions}}

## ЗАДАЧА
Для кожної статті балансу визнач:
1. Хто відповідальний за оновлення?
2. Як часто оновлюється (щомісяця / щоквартально / раз на рік)?
3. Звідки брати дані (банк, 1С, Xero, ручний підрахунок)?
4. До якої дати вносити?

## ПРАВИЛА
- Задавай ОДНЕ питання за раз
- Групуй схожі статті, щоб не перевантажувати
- Якщо відповідь очевидна — пропонуй за замовчуванням, питай підтвердження

## ПОТОЧНИЙ СТАН
{{session_json}}

## ФОРМАТ ВІДПОВІДІ
<balance_process_session>
{
  "status": "draft|in_progress|complete",
  "articles_processed": [],
  "processes": [
    {
      "article": "Гроші в банку",
      "responsible": "Бухгалтер",
      "frequency": "щомісяця",
      "data_source": "Банківська виписка",
      "deadline": "1-го числа"
    }
  ],
  "confirmed": false
}
</balance_process_session>
[Текст для користувача]

Коли підтверджено — маркер [COMPLETE]`;

const GREETING = `⚖️ Урок 5.3 — Процес заповнення балансу

Останній крок: визначимо, хто і коли оновлює кожну статтю балансу.

Це стане частиною загальної системи обліку і доповнить team_instructions.

Починаємо! Розкажи: хто в тебе відповідає за фінансовий облік загалом?`;

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

function buildDocument(s) {
    s = s || {};
    const date = new Date().toISOString().slice(0, 10);
    const rows = (s.processes || []).map(p =>
        `| ${p.article} | ${p.responsible || '—'} | ${p.frequency || '—'} | ${p.data_source || '—'} | ${p.deadline || '—'} |`
    ).join('\n');

    return [
        '# Процес заповнення балансу',
        `**Дата:** ${date}`,
        '',
        '| Стаття | Відповідальний | Частота | Джерело даних | Дедлайн |',
        '|---|---|---|---|---|',
        rows || '| — | — | — | — | — |',
        '',
        '## Загальні правила',
        '- Баланс складається щомісяця/щоквартально',
        '- Перевірка рівності: Активи = Зобов\'язання + Власний капітал',
        '- Дані вносяться до 5-го числа наступного місяця',
    ].join('\n');
}

class Bot53Handler {
    async start(user, chatId, bot) {
        const [balanceFile, bpV2File, teamFile] = await Promise.all([
            FileStorage.getLatest(user.id, 'balance_articles'),
            FileStorage.getLatest(user.id, 'business_process_v2'),
            FileStorage.getLatest(user.id, 'team_instructions'),
        ]);

        const session = await SessionService.getOrCreate(user.id, bot.id, 'interviewing');
        await SessionService.updateState(session.id, 'interviewing', {
            balanceArticles: balanceFile?.content || '',
            businessProcessV2: bpV2File?.content || '',
            teamInstructions: teamFile?.content || '',
            interviewSession: {
                status: 'draft', articles_processed: [], processes: [], confirmed: false,
            },
        });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);
        logger.info('Bot 5.3 started', { userId: user.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Цей урок вже завершено. Файл balance_processes.md збережено.');
            return;
        }

        await MessageService.save(session.id, 'user', text);
        const context = session.context || {};
        const dbMessages = await MessageService.getHistory(session.id);

        const systemPrompt = SYSTEM_PROMPT
            .replace('{{balance_articles}}', (context.balanceArticles || '').slice(0, 2000))
            .replace('{{business_process_v2}}', (context.businessProcessV2 || '').slice(0, 1500))
            .replace('{{team_instructions}}', (context.teamInstructions || '').slice(0, 1000))
            .replace('{{session_json}}', JSON.stringify(context.interviewSession || {}, null, 2));

        let responseText;
        try {
            responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages: dbMessages.map(m => ({ role: m.role, content: m.content })),
            });
        } catch (err) {
            logger.error('Bot 5.3 Claude error', { error: err.message });
            await sendMessage(chatId, '⚠️ Помилка. Спробуй ще раз.');
            return;
        }

        const updatedSession = extractTag(responseText, 'balance_process_session');
        const botText = stripTags(responseText, 'balance_process_session');
        const isComplete = responseText.includes('[COMPLETE]') || updatedSession?.confirmed;

        const contextPatch = { ...context, interviewSession: updatedSession || context.interviewSession || {} };

        if (!isComplete) {
            await MessageService.save(session.id, 'assistant', botText);
            await SessionService.updateState(session.id, 'interviewing', contextPatch);
            if (botText) await sendMessage(chatId, botText);
            return;
        }

        const docContent = buildDocument(updatedSession || context.interviewSession);
        const bot = await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
        await FileStorage.save({
            userId: user.id, botId: bot?.id, sessionId: session.id,
            fileType: 'balance_processes', content: docContent, projectSlug: 'finance-course',
        });
        await SessionService.complete(session.id);
        await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
        if (botText) await sendMessage(chatId, botText);
        await sendMessage(chatId,
            '🎉 *Вітаємо! Фінансову систему бізнесу завершено!*\n\n' +
            'Ти пройшов усі 5 блоків курсу та отримав повний пакет фінансових інструментів:\n' +
            '✅ Бізнес-процес\n✅ Cashflow + P&L\n✅ Таблиці в Google Sheets\n✅ Баланс\n✅ Інструкції команді\n\n' +
            'Файл *balance_processes.md* збережено.',
            { parse_mode: 'Markdown' }
        );
    }
}

function getHandler() {
    return new Bot53Handler();
}

module.exports = { getHandler };
