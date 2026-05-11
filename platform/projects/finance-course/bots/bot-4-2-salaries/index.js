'use strict';

const { callClaude, buildMessages: buildMsgs } = require('@platform/claude');
const { sendMessage } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { db } = require('@platform/db');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');

const SYSTEM_PROMPT = `Ти — ШІ-асистент курсу "Фінансова система малого бізнесу".
Збери структуровану інформацію про зарплати і виплати у бізнесі.

## СТАТТІ CASHFLOW ПОВ'ЯЗАНІ ЗІ ЗАРПЛАТОЮ
{{salary_articles}}

## ЩО ЗІБРАТИ
По кожній ролі або типу виплати:
1. Хто отримує (роль або ім'я)
2. Тип: ставка / відсоток від виручки / погодинно / підрядник
3. Periodичність виплати
4. Дата виплати (1-го, 10-го, двічі на місяць...)
5. Бонуси: є, які умови?
6. Власник: як бере гроші (зарплата / дивіденди / змішано)?

## ПРАВИЛА ДІАЛОГУ
- Задавай ОДНЕ питання за раз
- Пропонуй варіанти відповідей де можливо
- Якщо роль очевидна з артикулів — підтверди і не запитуй двічі

## ПОТОЧНИЙ СТАН
{{session_json}}

## ФОРМАТ ВІДПОВІДІ
<salary_session>
{
  "status": "draft|in_progress|complete",
  "employees": [
    {
      "role": "Менеджер продажів",
      "pay_type": "salary|percent|hourly|contractor",
      "amount_or_rate": "",
      "pay_frequency": "monthly|biweekly|weekly",
      "pay_day": "",
      "has_bonus": false,
      "bonus_conditions": ""
    }
  ],
  "owner_payout": { "method": "salary|dividends|mixed", "frequency": "", "amount": "" },
  "confirmed": false
}
</salary_session>
[Текст для користувача]

Коли підтверджено — маркер [COMPLETE]`;

const GREETING = `💰 Урок 4.2 — Зарплати і виплати

Зараз ми задокументуємо як виплачується зарплата в твоєму бізнесі: хто, скільки, коли і яким способом.

Це дасть нам чіткий процес обліку виплат у Cashflow.

Почнемо! Скільки людей у команді і які ролі є?`;

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

function buildDocument(salarySession) {
    const s = salarySession || {};
    const date = new Date().toISOString().slice(0, 10);
    const employees = (s.employees || []).map(e =>
        `### ${e.role}\n` +
        `- Тип: ${e.pay_type}\n` +
        `- Розмір: ${e.amount_or_rate || 'не вказано'}\n` +
        `- Periodичність: ${e.pay_frequency}\n` +
        `- Дата: ${e.pay_day || 'не вказано'}\n` +
        `- Бонус: ${e.has_bonus ? e.bonus_conditions : 'немає'}`
    ).join('\n\n');

    const op = s.owner_payout || {};
    return [
        '# Зарплати і виплати',
        `**Дата:** ${date}`,
        '',
        '## Співробітники',
        employees || '_Немає даних_',
        '',
        '## Виплата власнику',
        `- Спосіб: ${op.method || 'не вказано'}`,
        `- Periodичність: ${op.frequency || 'не вказано'}`,
        `- Розмір: ${op.amount || 'не вказано'}`,
    ].join('\n');
}

class Bot42Handler {
    async start(user, chatId, bot) {
        const cfFile = await FileStorage.getLatest(user.id, 'cashflow_articles');
        const salaryArticles = extractSalaryArticles(cfFile?.content || '');

        const session = await SessionService.getOrCreate(user.id, bot.id, 'interviewing');
        await SessionService.updateState(session.id, 'interviewing', {
            salaryArticles,
            interviewSession: { status: 'draft', employees: [], owner_payout: {}, confirmed: false },
        });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);
        logger.info('Bot 4.2 started', { userId: user.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Цей урок вже завершено. Файл salary_processes.md збережено.');
            return;
        }

        await MessageService.save(session.id, 'user', text);
        const context = session.context || {};
        const dbMessages = await MessageService.getHistory(session.id);

        const systemPrompt = SYSTEM_PROMPT
            .replace('{{salary_articles}}', context.salaryArticles || 'Не визначено')
            .replace('{{session_json}}', JSON.stringify(context.interviewSession || {}, null, 2));

        let responseText;
        try {
            responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages: dbMessages.map(m => ({ role: m.role, content: m.content })),
            });
        } catch (err) {
            logger.error('Bot 4.2 error', { error: err.message });
            await sendMessage(chatId, '⚠️ Помилка. Спробуй ще раз.');
            return;
        }

        const updatedSession = extractTag(responseText, 'salary_session');
        const botText = stripTags(responseText, 'salary_session');
        const isComplete = responseText.includes('[COMPLETE]') || (updatedSession?.confirmed);

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
            fileType: 'salary_processes', content: docContent, projectSlug: 'finance-course',
        });

        await SessionService.complete(session.id);
        await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
        if (botText) await sendMessage(chatId, botText);
        await sendMessage(chatId, '✅ Файл *salary_processes.md* збережено!\n\nПереходьте до уроку 4.3 ✅', { parse_mode: 'Markdown' });
    }
}

function extractSalaryArticles(content) {
    if (!content) return '';
    const lines = content.split('\n');
    const salaryLines = lines.filter(l =>
        /зарплат|оклад|виплат|персонал|команд|співробітн/i.test(l)
    );
    return salaryLines.join('\n') || 'Статті зарплат не виявлено';
}

function getHandler() {
    return new Bot42Handler();
}

module.exports = { getHandler };
