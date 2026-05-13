'use strict';

const { db } = require('@platform/db');
const { callClaude, buildMessages } = require('@platform/claude');
const { sendMessage, sendPhoto } = require('@platform/telegram');
const { FileStorage } = require('@platform/storage');
const { SessionService } = require('../../services/SessionService');
const { MessageService } = require('../../services/MessageService');
const { ProgressService } = require('../../services/ProgressService');
const { MermaidService } = require('../../services/MermaidService');
const logger = require('@platform/logger');
const BOT_CONFIG = require('./bot.config');
const { INTERVIEW_PROMPT, VALIDATOR_PROMPT, MERMAID_PROMPT } = require('./prompts');

const MAX_VALIDATION_ATTEMPTS = 3;

const GREETING = `Привіт! 👋 Зараз ми побудуємо схему твого бізнес-процесу — від того як клієнт дізнається про тебе до моменту отримання оплати.

Я буду задавати питання по одному і в кінці сформую візуальну схему у форматі swimlane.

Почнемо? Розкажи коротко — чим займається твоя компанія?`;

const COMPLETION_MESSAGE = `Відмінно! Ось схема бізнес-процесу твоєї компанії 👆

Зверніть увагу на ролі в лівій колонці — ми будемо використовувати цю схему на всіх наступних уроках.

На наступному кроці переходьте до уроку 2.1 ✅`;

function extractTag(text, tag) {
    const strict = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (strict) {
        try { return JSON.parse(strict[1].trim()); } catch { /* fall through */ }
    }
    // tolerant: find opening tag and grab balanced JSON
    const openTag = `<${tag}>`;
    const idx = text.toLowerCase().indexOf(openTag);
    if (idx < 0) return null;
    const after = text.slice(idx + openTag.length);
    const startBrace = after.indexOf('{');
    if (startBrace < 0) return null;
    const chunk = after.slice(startBrace);
    const balanced = extractBalancedJson(chunk);
    if (!balanced) return null;
    try { return JSON.parse(balanced); } catch { return null; }
}

function extractBalancedJson(input) {
    let depth = 0, inStr = false, escaped = false, started = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (!started) { if (ch === '{') { started = true; depth = 1; } continue; }
        if (inStr) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) return input.slice(input.indexOf('{'), i + 1);
    }
    return '';
}

function stripTags(text, ...tags) {
    let result = text;
    for (const tag of tags) {
        result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
        result = result.replace(new RegExp(`<${tag}>[\\s\\S]*`, 'i'), '');
    }
    return result.replace(/\[COMPLETE\]/g, '').replace(/```json[\s\S]*?```/gi, '').trim();
}

function buildInterviewPrompt(context) {
    const processModel = context.processModel || {};
    return INTERVIEW_PROMPT
        .replace('{{process_model_json}}', JSON.stringify(processModel, null, 2))
        .replace('{{current_block}}', String(context.currentBlock || 0))
        .replace('{{completed_blocks}}', (context.completedBlocks || []).join(', ') || 'жоден');
}

class Bot12Handler {
    async start(user, chatId, bot) {
        const session = await SessionService.getOrCreate(user.id, bot.id, 'interviewing');
        await SessionService.updateState(session.id, 'interviewing', {
            processModel: {},
            currentBlock: 0,
            completedBlocks: [],
            validationAttempts: 0,
        });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING, { parse_mode: 'Markdown' });
        logger.info('Bot 1.2 started', { userId: user.id, sessionId: session.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Ти вже завершив цей урок. Схему бізнес-процесу збережено. Використай /files щоб переглянути.');
            return;
        }

        await MessageService.save(session.id, 'user', text);

        const context = session.context || {};
        const dbMessages = await MessageService.getAll(session.id);
        const messages = buildMessages(dbMessages);

        const systemPrompt = buildInterviewPrompt(context);

        let responseText;
        try {
            responseText = await callClaude({ sessionId: session.id, systemPrompt, messages });
        } catch (err) {
            logger.error('Bot 1.2 Claude error', { error: err.message });
            await sendMessage(chatId, '⚠️ Не вдалося отримати відповідь. Спробуй ще раз.');
            return;
        }

        const updatedModel = extractTag(responseText, 'process_model');
        const botText = stripTags(responseText, 'process_model');
        const isComplete = responseText.includes('[COMPLETE]');

        const contextPatch = {
            processModel: updatedModel || context.processModel || {},
            currentBlock: context.currentBlock || 0,
            completedBlocks: context.completedBlocks || [],
        };

        if (!isComplete) {
            await MessageService.save(session.id, 'assistant', botText);
            await SessionService.updateState(session.id, 'interviewing', contextPatch);
            if (botText) await sendMessage(chatId, botText);
            return;
        }

        // Interview complete — validate the model
        const validationAttempts = (context.validationAttempts || 0);
        if (validationAttempts < MAX_VALIDATION_ATTEMPTS) {
            let validationResult = { valid: true, errors: [] };
            try {
                const validationResponse = await callClaude({
                    sessionId: session.id,
                    systemPrompt: VALIDATOR_PROMPT,
                    messages: [{ role: 'user', content: JSON.stringify(contextPatch.processModel) }],
                    options: { maxTokens: 512 },
                });
                validationResult = JSON.parse(validationResponse.trim());
            } catch { /* ignore validation errors */ }

            if (!validationResult.valid && validationResult.errors?.length) {
                const errorEntry = validationResult.errors[0];
                if (errorEntry.question_to_ask) {
                    const replyText = `Майже готово! Уточни, будь ласка:\n\n${errorEntry.question_to_ask}`;
                    await MessageService.save(session.id, 'assistant', replyText);
                    await SessionService.updateState(session.id, 'interviewing', {
                        ...contextPatch,
                        validationAttempts: validationAttempts + 1,
                    });
                    await sendMessage(chatId, replyText);
                    return;
                }
            }
        }

        // Generate Mermaid and finalize
        await this._finalize(user, chatId, session, contextPatch);
    }

    async _finalize(user, chatId, session, context) {
        const processModel = context.processModel;

        // Generate Mermaid code
        let mermaidCode = '';
        try {
            mermaidCode = await callClaude({
                sessionId: session.id,
                systemPrompt: MERMAID_PROMPT,
                messages: [{ role: 'user', content: JSON.stringify(processModel) }],
                options: { maxTokens: 2048 },
            });
        } catch (err) {
            logger.error('Mermaid generation failed', { error: err.message });
        }

        // Build markdown artifact
        const businessType = processModel.business_type || 'Бізнес';
        const lanes = processModel.lanes || [];
        const rolesSection = lanes.map(l => `- **${l.role}**: ${l.responsible || 'не вказано'}`).join('\n');

        const markdownContent = [
            `# Бізнес-процес: ${businessType}`,
            '',
            '## Ролі в компанії',
            rolesSection,
            '',
            '## JSON модель процесу',
            '```json',
            JSON.stringify(processModel, null, 2),
            '```',
            '',
            mermaidCode ? '## Mermaid-схема' : '',
            mermaidCode ? '```mermaid' : '',
            mermaidCode || '',
            mermaidCode ? '```' : '',
        ].filter(l => l !== undefined).join('\n').trim();

        // Save file
        const bot = await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });
        await FileStorage.save({
            userId: user.id,
            botId: bot?.id,
            sessionId: session.id,
            fileType: 'business_process',
            content: markdownContent,
            projectSlug: 'finance-course',
        });

        // Complete session
        await SessionService.complete(session.id);
        await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');

        // Try to render and send diagram image
        if (mermaidCode) {
            const pngBuffer = await MermaidService.renderMermaid(mermaidCode);
            if (pngBuffer) {
                try {
                    await sendPhoto(chatId, pngBuffer, COMPLETION_MESSAGE);
                    return;
                } catch (err) {
                    logger.warn('Failed to send mermaid PNG', { error: err.message });
                }
            }
        }

        // Fallback: send text only
        await sendMessage(chatId, COMPLETION_MESSAGE);
        if (mermaidCode) {
            await sendMessage(chatId, `📊 Mermaid-схема збережена у файлі бізнес-процесу.`);
        }
    }
}

function getHandler() {
    return new Bot12Handler();
}

module.exports = { getHandler };
