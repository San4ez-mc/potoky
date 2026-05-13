'use strict';

/**
 * Generic interview bot handler factory.
 * Drives a Claude conversation with a session JSON tracked in <session_tag>.
 * On [COMPLETE] marker, calls onComplete(user, chatId, session, context) to save artifacts.
 */
function createInterviewHandler({ botConfig, systemPromptFn, sessionTag, greeting, onComplete }) {
    const { callClaude, buildMessages } = require('@platform/claude');
    const { sendMessage } = require('@platform/telegram');
    const { SessionService } = require('../../services/SessionService');
    const { MessageService } = require('../../services/MessageService');
    const logger = require('@platform/logger');

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

    class Handler {
        async start(user, chatId, bot) {
            const session = await SessionService.getOrCreate(user.id, bot.id, 'interviewing');
            await SessionService.updateState(session.id, 'interviewing', {
                interviewSession: {},
            });

            const greetText = typeof greeting === 'function'
                ? await greeting(user, session)
                : greeting;

            await MessageService.save(session.id, 'assistant', greetText);
            await sendMessage(chatId, greetText);
            logger.info(`${botConfig.slug} started`, { userId: user.id });
        }

        async handleMessage(user, chatId, text, session) {
            if (session.state === 'completed') {
                await sendMessage(chatId, '✅ Цей урок вже завершено.');
                return;
            }

            await MessageService.save(session.id, 'user', text);

            const context = session.context || {};
            const dbMessages = await MessageService.getAll(session.id);
            const systemPrompt = await systemPromptFn(context, user);

            let responseText;
            try {
                responseText = await callClaude({
                    sessionId: session.id,
                    systemPrompt,
                    messages: buildMessages(dbMessages),
                });
            } catch (err) {
                logger.error(`${botConfig.slug} Claude error`, { error: err.message });
                await sendMessage(chatId, '⚠️ Не вдалося отримати відповідь. Спробуй ще раз.');
                return;
            }

            const updatedSession = extractTag(responseText, sessionTag);
            const botText = stripTags(responseText, sessionTag);
            const isComplete = responseText.includes('[COMPLETE]');

            const contextPatch = {
                ...context,
                interviewSession: updatedSession || context.interviewSession || {},
            };

            if (!isComplete) {
                await MessageService.save(session.id, 'assistant', botText);
                await SessionService.updateState(session.id, 'interviewing', contextPatch);
                if (botText) await sendMessage(chatId, botText);
                return;
            }

            await onComplete(user, chatId, session, contextPatch, botText);
        }
    }

    return new Handler();
}

module.exports = { createInterviewHandler };
