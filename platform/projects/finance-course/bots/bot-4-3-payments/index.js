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
Збери всі регулярні платежі бізнесу — ті що повторюються кожного місяця/кварталу/року.

## СТАТТІ ВИТРАТ
{{expense_articles}}

## ТИПИ РЕГУЛЯРНИХ ПЛАТЕЖІВ
- Оренда (офіс, склад, обладнання)
- Підписки (SaaS, сервіси, ліцензії)
- Кредити і лізинг
- Інтернет, зв'язок, комунальні
- Бухгалтерія, юрист, аутсорс
- Реклама з фіксованою платою
- Страхування

## ЩО ЗІБРАТИ ПО КОЖНОМУ
1. Назва платежу
2. Сума (або діапазон)
3. Periodичність: щомісяця / щоквартально / щороку
4. Дата платежу (число місяця)
5. Постачальник / отримувач
6. Спосіб оплати: рахунок / автосписання / картка

## ПРАВИЛА ДІАЛОГУ
- Запропонуй перелік типових платежів для цього типу бізнесу
- Для кожного: "Є? Яка сума?" 
- Якщо не актуально — "Немає, пропускаємо"

## ПОТОЧНИЙ СТАН
{{session_json}}

## ФОРМАТ ВІДПОВІДІ
<payment_session>
{
  "status": "draft|in_progress|complete",
  "payments": [
    {
      "name": "Оренда офісу",
      "amount": 15000,
      "frequency": "monthly|quarterly|annual",
      "day_of_month": 1,
      "vendor": "ФОП Іваненко",
      "payment_method": "invoice|auto|card"
    }
  ],
  "confirmed": false
}
</payment_session>
[Текст для користувача]

Коли підтверджено — маркер [COMPLETE]`;

const GREETING = `🔄 Урок 4.3 — Регулярні платежі

Зараз задокументуємо всі платежі що повторюються кожного місяця або рідше: оренда, підписки, кредити, ліцензії.

Це основа для прогнозування Cash Flow і уникнення касових розривів.

Почнемо! Є орендовані приміщення або обладнання?`;

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

function buildDocument(paymentSession) {
    const s = paymentSession || {};
    const date = new Date().toISOString().slice(0, 10);
    const freqLabel = { monthly: 'щомісяця', quarterly: 'щоквартально', annual: 'щорічно' };
    const payments = (s.payments || []).map(p =>
        `### ${p.name}\n` +
        `- Сума: ${p.amount ? `${p.amount} грн` : 'не вказано'}\n` +
        `- Periodичність: ${freqLabel[p.frequency] || p.frequency || 'не вказано'}\n` +
        `- Дата: ${p.day_of_month ? `${p.day_of_month}-го числа` : 'не вказано'}\n` +
        `- Постачальник: ${p.vendor || 'не вказано'}\n` +
        `- Оплата: ${p.payment_method || 'не вказано'}`
    ).join('\n\n');

    const totalMonthly = (s.payments || [])
        .filter(p => p.frequency === 'monthly')
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    return [
        '# Регулярні платежі',
        `**Дата:** ${date}`,
        '',
        '## Список платежів',
        payments || '_Немає платежів_',
        '',
        `## Загальна сума щомісячних платежів: ${totalMonthly.toLocaleString('uk-UA')} грн`,
    ].join('\n');
}

class Bot43Handler {
    async start(user, chatId, bot) {
        const cfFile = await FileStorage.getLatest(user.id, 'cashflow_articles');
        const expenseArticles = extractExpenseArticles(cfFile?.content || '');

        const session = await SessionService.getOrCreate(user.id, bot.id, 'interviewing');
        await SessionService.updateState(session.id, 'interviewing', {
            expenseArticles,
            interviewSession: { status: 'draft', payments: [], confirmed: false },
        });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);
        logger.info('Bot 4.3 started', { userId: user.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Цей урок вже завершено. Файл payment_processes.md збережено.');
            return;
        }

        await MessageService.save(session.id, 'user', text);
        const context = session.context || {};
        const dbMessages = await MessageService.getAll(session.id);

        const systemPrompt = SYSTEM_PROMPT
            .replace('{{expense_articles}}', context.expenseArticles || 'Не визначено')
            .replace('{{session_json}}', JSON.stringify(context.interviewSession || {}, null, 2));

        let responseText;
        try {
            responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages: dbMessages.map(m => ({ role: m.role, content: m.content })),
            });
        } catch (err) {
            logger.error('Bot 4.3 error', { error: err.message });
            await sendMessage(chatId, '⚠️ Помилка. Спробуй ще раз.');
            return;
        }

        const updatedSession = extractTag(responseText, 'payment_session');
        const botText = stripTags(responseText, 'payment_session');
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
            fileType: 'payment_processes', content: docContent, projectSlug: 'finance-course',
        });

        await SessionService.complete(session.id);
        await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
        if (botText) await sendMessage(chatId, botText);
        await sendMessage(chatId, '✅ Файл *payment_processes.md* збережено!\n\nПереходьте до уроку 4.4 ✅', { parse_mode: 'Markdown' });
    }
}

function extractExpenseArticles(content) {
    if (!content) return '';
    return content.split('\n').filter(l => /^###/.test(l)).join('\n');
}

function getHandler() {
    return new Bot43Handler();
}

module.exports = { getHandler };
