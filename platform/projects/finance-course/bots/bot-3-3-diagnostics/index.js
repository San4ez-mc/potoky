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
const { DIAGNOSTICS_PROMPT } = require('./prompts');

const GREETING = `🔍 Урок 3.3 — Діагностика фінансової механіки

Я завантажив твої файли з попередніх уроків і зараз проведу діагностику того, як саме гроші рухаються в твоєму бізнесі.

Ми пройдемо по блоках: зарплата → власник → аванси → проєкти → склад (якщо є) → кредити (якщо є) → великі витрати.

Почнемо з блоку A. Як виплачується зарплата команді — раз на місяць, двічі, по-різному?`;

function extractTag(text, tag) {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match) { try { return JSON.parse(match[1].trim()); } catch { return null; } }
    // tolerant
    const openTag = `<${tag}>`;
    const idx = text.toLowerCase().indexOf(openTag);
    if (idx < 0) return null;
    const after = text.slice(idx + openTag.length);
    const startBrace = after.indexOf('{');
    if (startBrace < 0) return null;
    return tryParseBalanced(after.slice(startBrace));
}

function tryParseBalanced(input) {
    let depth = 0, inStr = false, escaped = false, started = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (!started) { if (ch === '{') { started = true; depth = 1; } continue; }
        if (inStr) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) { try { return JSON.parse(input.slice(input.indexOf('{'), i + 1)); } catch { return null; } }
    }
    return null;
}

function stripTags(text, ...tags) {
    let result = text;
    for (const tag of tags) result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    return result.replace(/\[COMPLETE\]/g, '').trim();
}

function buildDocument(fm, businessType, articles) {
    const s = fm || {};
    const date = new Date().toISOString().slice(0, 10);
    const sp = s.salary_payouts || {};
    const op = s.owner_payouts || {};
    const pp = s.prepayments || {};
    const pr = s.projects || {};
    const inv = s.inventory || {};
    const ln = s.loans || {};
    const oe = s.one_off_expenses || {};

    return [
        '# Діагностика фінансової механіки',
        `**Бізнес:** ${businessType || 'не вказано'}`,
        `**Дата:** ${date}`,
        '',
        '## Зарплата і виплати',
        `- Periodичність: ${sp.period || 'не вказано'}`,
        `- Структура: ${sp.structure || 'не вказано'}`,
        `- Бонуси: ${sp.bonuses || 'не вказано'}`,
        `- Підрядники: ${sp.contractors || 'не вказано'}`,
        '',
        '## Власник',
        `- Спосіб виплати: ${op.method || 'не вказано'}`,
        `- Periodичність: ${op.frequency || 'не вказано'}`,
        `- Ринкова вартість роботи власника: ${op.market_owner_salary || 'не визначено'}`,
        '',
        '## Аванси і передоплати',
        `- Від клієнтів: ${pp.from_clients || 'не вказано'}`,
        `- Підрядникам: ${pp.to_contractors || 'не вказано'}`,
        `- Середній термін авансу: ${pp.average_gap_days || 'не вказано'}`,
        '',
        '## Проекти і напрямки',
        `- P&L по проектах: ${pr.project_pl_required || 'не вказано'}`,
        `- Кількість напрямків: ${pr.active_directions_count || 'не вказано'}`,
        `- Розподіл спільних витрат: ${pr.shared_cost_method || 'не вказано'}`,
        '',
        '## Склад і закупки',
        `- Є склад: ${inv.has_inventory || 'не вказано'}`,
        `- Модель закупки: ${inv.procurement_model || 'не вказано'}`,
        `- Середній термін зберігання: ${inv.average_storage_days || 'не вказано'}`,
        '',
        '## Кредити і відсотки',
        `- Є зобов\'язання: ${ln.has_liabilities || 'не вказано'}`,
        `- Щомісячні виплати: ${ln.monthly_payment || 'не вказано'}`,
        `- Відсоткова ставка: ${ln.interest_rate || 'не вказано'}`,
        '',
        '## Великі разові витрати',
        `- Є активи: ${oe.has_assets || 'не вказано'}`,
        `- Перелік: ${oe.assets_list || 'не вказано'}`,
        `- Плановані великі витрати: ${oe.planned_big_expenses || 'не вказано'}`,
        '',
        '## Рекомендований метод P&L',
        s.recommended_pl_method || 'Потребує уточнення.',
    ].join('\n');
}

class Bot33Handler {
    async start(user, chatId, bot) {
        const cfFile = await FileStorage.getLatest(user.id, 'cashflow_articles');
        const plFile = await FileStorage.getLatest(user.id, 'pl_articles');
        const bpFile = await FileStorage.getLatest(user.id, 'business_process');

        const session = await SessionService.getOrCreate(user.id, bot.id, 'interviewing');
        await SessionService.updateState(session.id, 'interviewing', {
            cashflowArticles: cfFile?.content || '',
            plArticles: plFile?.content || '',
            businessProcess: bpFile?.content || '',
            fm: {
                status: 'draft',
                current_block: 'A',
                completed_blocks: [],
                skips: { E: false, F: false },
                salary_payouts: { period: '', structure: '', bonuses: '', contractors: '' },
                owner_payouts: { method: '', frequency: '', partners: '', market_owner_salary: '' },
                prepayments: { from_clients: '', to_contractors: '', average_gap_days: '' },
                projects: { project_pl_required: '', active_directions_count: '', shared_cost_method: '' },
                inventory: { has_inventory: '', procurement_model: '', average_storage_days: '' },
                loans: { has_liabilities: '', monthly_payment: '', interest_rate: '', investors_terms: '' },
                one_off_expenses: { has_assets: '', assets_list: '', planned_big_expenses: '' },
                recommended_pl_method: '',
            },
        });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);
        logger.info('Bot 3.3 started', { userId: user.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Діагностику вже завершено. Файл financial_mechanics.md збережено.');
            return;
        }

        await MessageService.save(session.id, 'user', text);

        const context = session.context || {};
        const dbMessages = await MessageService.getAll(session.id);

        const systemPrompt = DIAGNOSTICS_PROMPT
            .replace('{{business_process_context}}', (context.businessProcess || '').slice(0, 3000))
            .replace('{{articles_context}}', ((context.cashflowArticles || '') + '\n\n' + (context.plArticles || '')).slice(0, 3000))
            .replace('{{financial_mechanics_session_json}}', JSON.stringify(context.fm || {}, null, 2));

        let responseText;
        try {
            responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages: buildMessages(dbMessages),
            });
        } catch (err) {
            logger.error('Bot 3.3 Claude error', { error: err.message });
            await sendMessage(chatId, '⚠️ Помилка ШІ. Спробуй ще раз.');
            return;
        }

        const updatedFm = extractTag(responseText, 'financial_mechanics_session');
        const botText = stripTags(responseText, 'financial_mechanics_session');
        const isComplete = responseText.includes('[COMPLETE]') || (updatedFm?.status === 'complete' && updatedFm?.current_block === 'done');

        const contextPatch = {
            ...context,
            fm: updatedFm || context.fm || {},
        };

        if (!isComplete) {
            await MessageService.save(session.id, 'assistant', botText);
            await SessionService.updateState(session.id, 'interviewing', contextPatch);
            if (botText) await sendMessage(chatId, botText);
            return;
        }

        // Generate document
        const fm = updatedFm || context.fm || {};
        const businessType = extractBusinessType(context.businessProcess);
        const docContent = buildDocument(fm, businessType);

        const bot = await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
        await FileStorage.save({
            userId: user.id,
            botId: bot?.id,
            sessionId: session.id,
            fileType: 'financial_mechanics',
            content: docContent,
            projectSlug: 'finance-course',
        });

        await SessionService.complete(session.id);
        await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');

        if (botText) await sendMessage(chatId, botText);
        await sendMessage(chatId,
            `✅ Діагностику завершено!\n\n📄 Файл *financial_mechanics.md* збережено.\n\nУ ньому: методи обліку, аванси, зарплати, рекомендований метод P&L.\n\nПереходьте до блоку 4 ✅`,
            { parse_mode: 'Markdown' }
        );
    }
}

function extractBusinessType(businessProcessContent) {
    if (!businessProcessContent) return 'Бізнес';
    const match = businessProcessContent.match(/"business_type"\s*:\s*"([^"]+)"/);
    return match ? match[1] : 'Бізнес';
}

function getHandler() {
    return new Bot33Handler();
}

module.exports = { getHandler };
