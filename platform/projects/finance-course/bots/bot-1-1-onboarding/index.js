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

const SESSION_TAG = 'onboarding_session';

const SYSTEM_PROMPT = `Ти - дружній AI-куратор курсу "Фінансова система малого бізнесу".
Твоя задача - делікатно дозібрати профіль студента.

Потрібні поля:
1) name - як звертатись
2) role - роль у компанії
3) company - чим займається компанія
4) financialProblem - головний фінансовий біль

ВАЖЛИВО:
- Питай тільки те, чого ще НЕ вистачає.
- Якщо поле вже є в session_json або existing_profile - НЕ перепитуй.
- Якщо користувач в одному повідомленні дав одразу кілька полів, заповни всі.
- Тон: теплий, простий, людяний, без канцеляризмів.
- Одне коротке запитання за раз.
- Коли всі 4 поля заповнені: коротко підсумуй і попроси підтвердження "підтверджую".
- Після підтвердження постав [COMPLETE].

## existing_profile
{{existing_profile_json}}

## session_json
{{session_json}}

Формат відповіді ОБОВ'ЯЗКОВИЙ:
<onboarding_session>
{
  "name": "",
  "role": "",
  "company": "",
  "financialProblem": "",
  "readyToComplete": false,
  "confirmed": false,
  "missing": ["name", "role", "company", "financialProblem"]
}
</onboarding_session>
[текст для користувача]

Коли confirmed=true, додай [COMPLETE].`;

const GREETING = `Привіт! 👋 Радий знайомству.

Щоб наступні уроки були максимально корисними, я коротко зберу ваш профіль.

Як до вас звертатись?`;

function extractTag(text, tag) {
    const strict = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (strict) {
        try {
            return JSON.parse(strict[1].trim());
        } catch {
            return null;
        }
    }
    return null;
}

function stripTags(text, ...tags) {
    let result = text;
    for (const tag of tags) {
        result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    }
    return result.replace(/\[COMPLETE\]/g, '').trim();
}

function normalizeSession(raw) {
    const s = raw || {};
    const normalized = {
        name: typeof s.name === 'string' ? s.name.trim() : '',
        role: typeof s.role === 'string' ? s.role.trim() : '',
        company: typeof s.company === 'string' ? s.company.trim() : '',
        financialProblem: typeof s.financialProblem === 'string' ? s.financialProblem.trim() : '',
        readyToComplete: Boolean(s.readyToComplete),
        confirmed: Boolean(s.confirmed),
        missing: Array.isArray(s.missing) ? s.missing : [],
    };

    const computedMissing = [];
    if (!normalized.name) computedMissing.push('name');
    if (!normalized.role) computedMissing.push('role');
    if (!normalized.company) computedMissing.push('company');
    if (!normalized.financialProblem) computedMissing.push('financialProblem');
    normalized.missing = computedMissing;
    normalized.readyToComplete = computedMissing.length === 0;

    return normalized;
}

function buildOnboardingFile(data) {
    const safe = normalizeSession(data);
    return [
        '# Профіль студента (онбординг 1.1)',
        `Дата: ${new Date().toISOString()}`,
        '',
        `- Ім'я: ${safe.name || '-'}`,
        `- Роль: ${safe.role || '-'}`,
        `- Компанія: ${safe.company || '-'}`,
        `- Головна фінансова проблема: ${safe.financialProblem || '-'}`,
    ].join('\n');
}

function mergeProfile(base, next) {
    const b = normalizeSession(base);
    const n = normalizeSession(next);
    return normalizeSession({
        ...b,
        name: n.name || b.name,
        role: n.role || b.role,
        company: n.company || b.company,
        financialProblem: n.financialProblem || b.financialProblem,
        confirmed: n.confirmed || b.confirmed,
    });
}

function extractName(text) {
    const patterns = [
        /мене\s+звати\s+([A-Za-zА-Яа-яІіЇїЄє'`\-\s]{2,40})/i,
        /(?:я|це)\s*[-:]\s*([A-Za-zА-Яа-яІіЇїЄє'`\-\s]{2,40})/i,
        /(?:звертай(?:те)?сь\s+до\s+мене\s+як)\s+([A-Za-zА-Яа-яІіЇїЄє'`\-\s]{2,40})/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1].trim().replace(/[.,!?;:]+$/g, '');
        }
    }
    return '';
}

function extractRole(text) {
    const lower = text.toLowerCase();
    const roles = [
        'власник',
        'керівник',
        'директор',
        'співвласник',
        'фінансовий директор',
        'бухгалтер',
        'менеджер',
        'підприємець',
        'ceo',
        'cfo',
    ];
    const found = roles.find((r) => lower.includes(r));
    return found || '';
}

function extractCompany(text) {
    const patterns = [
        /(?:компані[яї][^.!?\n]{0,40}?займа(?:є|єть)ся\s*)([^.!?\n]{3,120})/i,
        /(?:компані[яї]\s*(?:займається|робить|працює\s*в)\s*)([^.!?\n]{3,120})/i,
        /(?:ми\s+займаємось\s*)([^.!?\n]{3,120})/i,
        /(?:у\s+нас\s+)([^.!?\n]{3,120})/i,
        /(?:бізнес\s*(?:у|в)\s*сфері\s*)([^.!?\n]{3,120})/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1].trim().replace(/[.,!?;:]+$/g, '');
        }
    }
    return '';
}

function extractFinancialProblem(text) {
    const patterns = [
        /(?:проблема|біль|складність|болить|турбує)\s*[:\-]?\s*([^.!?\n]{3,160})/i,
        /(?:касов[іи]\s+розрив[иів])/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1].trim().replace(/[.,!?;:]+$/g, '');
        }
        if (match && !match[1]) {
            return match[0].trim();
        }
    }
    return '';
}

function extractHeuristicSession(text) {
    return normalizeSession({
        name: extractName(text),
        role: extractRole(text),
        company: extractCompany(text),
        financialProblem: extractFinancialProblem(text),
    });
}

function nextQuestion(sessionData) {
    const missing = sessionData.missing || [];
    if (missing.includes('name')) return 'Супер. Як до вас звертатись?';
    if (missing.includes('role')) return 'Яка ваша роль у компанії?';
    if (missing.includes('company')) return 'Чим займається ваша компанія?';
    if (missing.includes('financialProblem')) return 'Який головний фінансовий біль у бізнесі зараз?';
    return '';
}

function buildConfirmationPrompt(sessionData) {
    return [
        'Підсумую, чи все вірно:',
        `- Ім\'я: ${sessionData.name}`,
        `- Роль: ${sessionData.role}`,
        `- Компанія: ${sessionData.company}`,
        `- Головний фінансовий біль: ${sessionData.financialProblem}`,
        '',
        'Якщо все вірно, напишіть «підтверджую».',
    ].join('\n');
}

class Bot11OnboardingHandler {
    async start(user, chatId, bot) {
        let existingUserData = null;
        if (db.userData?.findUnique) {
            existingUserData = await db.userData.findUnique({
                where: { userId_botId: { userId: user.id, botId: bot.id } },
            });
        }

        const initialSession = normalizeSession({
            name: existingUserData?.name,
            role: existingUserData?.role,
            company: existingUserData?.company,
            financialProblem: existingUserData?.financialProblem,
            confirmed: false,
        });

        const session = await SessionService.getOrCreate(user.id, bot.id, 'interviewing');
        await SessionService.updateState(session.id, 'interviewing', {
            interviewSession: initialSession,
            existingProfile: initialSession,
        });

        await MessageService.save(session.id, 'assistant', GREETING);
        await sendMessage(chatId, GREETING);
        logger.info('Bot 1.1 started', { userId: user.id, sessionId: session.id });
    }

    async handleMessage(user, chatId, text, session) {
        if (session.state === 'completed') {
            await sendMessage(chatId, '✅ Урок 1.1 вже завершено. Профіль збережено.');
            return;
        }

        await MessageService.save(session.id, 'user', text);

        const context = session.context || {};
        const currentSession = normalizeSession(context.interviewSession || {});
        const existingProfile = normalizeSession(context.existingProfile || {});
        const dbMessages = await MessageService.getAll(session.id);

        const bigIntReplacer = (key, value) => {
            if (typeof value === 'bigint') return value.toString();
            return value;
        };

        const systemPrompt = SYSTEM_PROMPT
            .replace('{{existing_profile_json}}', JSON.stringify(existingProfile, bigIntReplacer, 2))
            .replace('{{session_json}}', JSON.stringify(currentSession, bigIntReplacer, 2));

        let responseText;
        let merged;
        let botText;
        let isComplete = false;
        try {
            responseText = await callClaude({
                sessionId: session.id,
                systemPrompt,
                messages: buildMessages(dbMessages),
            });

            const parsedSession = extractTag(responseText, SESSION_TAG);
            merged = mergeProfile(currentSession, parsedSession || {});
            botText = stripTags(responseText, SESSION_TAG);
            isComplete = responseText.includes('[COMPLETE]') || (merged.readyToComplete && merged.confirmed);
        } catch (err) {
            logger.error('Bot 1.1 Claude error', { error: err.message, sessionId: session.id });

            const patch = extractHeuristicSession(text);
            merged = mergeProfile(currentSession, patch);
            const confirmedByUser = /(^|\s)(підтверджую|підтверджую\.|так,?\s*підтверджую)(\s|$)/i.test(text);
            if (merged.readyToComplete && confirmedByUser) {
                merged = normalizeSession({ ...merged, confirmed: true });
                isComplete = true;
                botText = 'Чудово, дякую за підтвердження.';
            } else if (merged.readyToComplete) {
                botText = buildConfirmationPrompt(merged);
            } else {
                botText = nextQuestion(merged);
            }
        }

        if (!isComplete) {
            await SessionService.updateState(session.id, 'interviewing', {
                ...context,
                interviewSession: merged,
                existingProfile,
            });
            if (botText) {
                await MessageService.save(session.id, 'assistant', botText);
                await sendMessage(chatId, botText);
            }
            return;
        }

        const botEntity = await db.bot.findFirst({ where: { slug: BOT_CONFIG.slug } });

        if (db.userData?.upsert) {
            await db.userData.upsert({
                where: { userId_botId: { userId: user.id, botId: botEntity.id } },
                update: {
                    telegramId: user.telegramId,
                    name: merged.name,
                    role: merged.role,
                    company: merged.company,
                    financialProblem: merged.financialProblem,
                    metadata: {
                        source: 'bot-1-1-onboarding',
                        sessionId: session.id,
                    },
                },
                create: {
                    userId: user.id,
                    botId: botEntity.id,
                    telegramId: user.telegramId,
                    name: merged.name,
                    role: merged.role,
                    company: merged.company,
                    financialProblem: merged.financialProblem,
                    metadata: {
                        source: 'bot-1-1-onboarding',
                        sessionId: session.id,
                    },
                },
            });
        }

        await FileStorage.save({
            userId: user.id,
            botId: botEntity.id,
            sessionId: session.id,
            fileType: 'user_onboarding_data',
            content: buildOnboardingFile(merged),
            projectSlug: 'finance-course',
        });

        await SessionService.complete(session.id);

        try {
            if (typeof ProgressService.markComplete === 'function') {
                await ProgressService.markComplete(user.id, BOT_CONFIG.lessonNumber, 'finance-course');
            } else if (typeof ProgressService.markCompleted === 'function') {
                const project = await db.project.findFirst({ where: { slug: 'finance-course' } });
                if (project) {
                    await ProgressService.markCompleted(user.id, project.id, BOT_CONFIG.lessonNumber, botEntity.id);
                }
            }
        } catch (progressErr) {
            logger.error('Bot 1.1 progress update failed', {
                error: progressErr.message,
                sessionId: session.id,
                userId: user.id,
            });
        }

        if (botText) {
            await MessageService.save(session.id, 'assistant', botText);
            await sendMessage(chatId, botText);
        }

        await sendMessage(
            chatId,
            '✅ Супер, дякую! Профіль збережено. На наступних уроках я вже врахую ваш контекст і не буду перепитувати базові речі.'
        );
    }
}

function getHandler() {
    return new Bot11OnboardingHandler();
}

module.exports = { getHandler };
