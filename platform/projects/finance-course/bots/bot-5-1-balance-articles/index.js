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
Твоя задача — зібрати статті балансу бізнесу.

## КОНТЕКСТ
Статті Cashflow: {{cashflow_articles}}
Статті P&L: {{pl_articles}}
Бізнес-процес: {{business_process}}

## СТРУКТУРА БАЛАНСУ
Баланс = Активи = Зобов'язання + Власний капітал

### БЛОКИ ОПИТУВАННЯ
- **A: Оборотні активи** — гроші, дебіторка, запаси, передоплати видані
- **B: Необоротні активи** — обладнання, нерухомість, нематеріальні активи
- **C: Поточні зобов'язання** — кредиторка, аванси отримані, кредити до 1 року
- **D: Довгострокові зобов'язання** — кредити понад 1 рік, лізинг, облігації
- **E: Власний капітал** — статутний капітал, нерозподілений прибуток, резерви

## ПРАВИЛА ДІАЛОГУ
- Задавай ОДНЕ питання за раз по черзі в кожному блоці
- Для кожної статті: "Є у вас [стаття]? Якщо так — яка приблизна сума?"
- Якщо нема — пропускаємо
- Після кожного блоку: показуй підсумок

## ПОТОЧНИЙ СТАН
{{session_json}}

## ФОРМАТ ВІДПОВІДІ
<balance_session>
{
  "status": "draft|in_progress|complete",
  "current_block": "A|B|C|D|E|done",
  "completed_blocks": [],
  "current_assets": [{ "name": "", "typical_amount": "" }],
  "non_current_assets": [{ "name": "", "typical_amount": "" }],
  "current_liabilities": [{ "name": "", "typical_amount": "" }],
  "long_term_liabilities": [{ "name": "", "typical_amount": "" }],
  "equity": [{ "name": "", "typical_amount": "" }],
  "confirmed": false
}
</balance_session>
[Текст для користувача]

Коли підтверджено — маркер [COMPLETE]`;

const GREETING = `⚖️ Урок 5.1 — Статті балансу

Баланс — це знімок фінансового стану бізнесу на конкретний момент.

Ми зберемо статті в 5 блоках:
📦 Оборотні активи → 🏭 Необоротні активи → 💳 Поточні зобов'язання → 🏦 Довгострокові зобов'язання → 💼 Власний капітал

Почнемо з блоку A. Є гроші на рахунках і в касі?`;

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
    const section = (title, items) => {
        if (!items || !items.length) return `## ${title}\n_Немає статей_`;
        const rows = items.map(i => `### ${i.name}\nСума: ${i.typical_amount || 'не вказано'}`).join('\n\n');
        return `## ${title}\n${rows}`;
    };
    return [
        '# Статті балансу',
        `**Дата:** ${date}`,
        '',
        section('Оборотні активи', s.current_assets),
        '',
        section('Необоротні активи', s.non_current_assets),
        '',
        section('Поточні зобов\'язання', s.current_liabilities),
        '',
        section('Довгострокові зобов\'язання', s.long_term_liabilities),
        '',
        section('Власний капітал', s.equity),
        '',
        '## Формула перевірки',
        'Активи = Зобов\'язання + Власний капітал',
    ].join('\n');
}

class Bot51Handler {
    async start(user, chatId, bot) {
        const [cfFile, plFile, bpFile] = await Promise.all([
            FileStorage.getLatest(user.id, 'cashflow_articles'),
            FileStorage.getLatest(user.id, 'pl_articles'),
            FileStorage.getLatest(user.id, 'business_process'),
        ]);

        const session = await SessionService.getOrCreate(user.id, bot.id, 'interviewing');
        await SessionService.updateState(session.id, 'interviewing', {
            cashflowArticles: cfFile?.content || '',
            plArticles: plFile?.content || '',
            businessProcess: bpFile?.content || '',
            interviewSession: {
                status: 'draft', current_block: 'A', completed_blocks: [],
                current_assets: [], non_current_assets: [], current_liabilities: [],
                long_term_liabilities: [], equity: [], confirmed: false,
            },
        });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);
        logger.info('Bot 5.1 started', { userId: user.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Цей урок вже завершено. Файл balance_articles.md збережено.');
            return;
        }

        await MessageService.save(session.id, 'user', text);
        const context = session.context || {};
        const dbMessages = await MessageService.getAll(session.id);

        const systemPrompt = SYSTEM_PROMPT
            .replace('{{cashflow_articles}}', (context.cashflowArticles || '').slice(0, 1500))
            .replace('{{pl_articles}}', (context.plArticles || '').slice(0, 1500))
            .replace('{{business_process}}', (context.businessProcess || '').slice(0, 1000))
            .replace('{{session_json}}', JSON.stringify(context.interviewSession || {}, null, 2));

        let responseText;
        try {
            responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages: dbMessages.map(m => ({ role: m.role, content: m.content })),
            });
        } catch (err) {
            logger.error('Bot 5.1 error', { error: err.message });
            await sendMessage(chatId, '⚠️ Помилка. Спробуй ще раз.');
            return;
        }

        const updatedSession = extractTag(responseText, 'balance_session');
        const botText = stripTags(responseText, 'balance_session');
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
            fileType: 'balance_articles', content: docContent, projectSlug: 'finance-course',
        });
        await SessionService.complete(session.id);
        await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
        if (botText) await sendMessage(chatId, botText);
        await sendMessage(chatId, '✅ Файл *balance_articles.md* збережено!\n\nПереходьте до уроку 5.2 ✅', { parse_mode: 'Markdown' });
    }
}

function getHandler() {
    return new Bot51Handler();
}

module.exports = { getHandler };
