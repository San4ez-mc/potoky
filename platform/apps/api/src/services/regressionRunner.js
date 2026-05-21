'use strict';

const { db } = require('@platform/db');
const { callClaude } = require('@platform/claude');
const {
    startTestSession,
    sendTestMessage,
    getTestSessionState,
    endTestSession,
} = require('./testSession');

function hasUsableAnthropicKey() {
    const key = process.env.ANTHROPIC_API_KEY || '';
    return Boolean(key) && key !== 'placeholder_update_me' && key !== 'ВАШИЙ_КЛЮЧ';
}

async function getSystemClaudeKey() {
    const connector = await db.savedConnector.findFirst({
        where: { type: 'system_claude_api', isActive: true },
        orderBy: { updatedAt: 'desc' },
    });

    const key = connector?.config?.apiKey || '';
    return typeof key === 'string' ? key.trim() : '';
}

async function buildScenarioLegend(bot, claudeApiKey = '') {
    const fallback = {
        source: 'fallback',
        title: `Smoke scenario for ${bot.slug}`,
        messages: [
            'Привіт! Я хочу пройти коротке тестування воронки.',
            'Ми надаємо бухгалтерські послуги для B2B компаній.',
            'Підкажіть наступний крок, щоб продовжити діалог.',
        ],
    };

    if (!claudeApiKey) {
        return fallback;
    }

    try {
        const prompt = [
            'Generate a concise Telegram test scenario as strict JSON only.',
            `Bot name: ${bot.name}`,
            `Bot slug: ${bot.slug}`,
            'Format: {"title":"...","messages":["...","...","..."]}',
            'Rules: exactly 3 user messages, each <= 180 chars, no markdown, Ukrainian language preferred.',
        ].join('\n');

        const response = await callClaude({
            sessionId: null,
            systemPrompt: 'You are a QA assistant that outputs valid JSON only.',
            messages: [{ role: 'user', content: prompt }],
            options: { maxTokens: 400, apiKey: claudeApiKey },
        });

        const parsed = JSON.parse(response.trim());
        const messages = Array.isArray(parsed.messages)
            ? parsed.messages.filter((item) => typeof item === 'string').slice(0, 3)
            : [];

        if (messages.length !== 3) {
            return fallback;
        }

        return {
            source: 'ai',
            title: typeof parsed.title === 'string' ? parsed.title : fallback.title,
            messages,
        };
    } catch (_error) {
        return fallback;
    }
}

// Markers that indicate Den has shown the presentation (offer slide)
const SALES_PRESENTATION_MARKERS = [
    'Ось що відбувається на розборі',
    'Готовий записатись?',
    'посилання для оплати',
    'WayForPay',
    'payment_url',
];

function isSalesPresentation(text) {
    if (!text || typeof text !== 'string') return false;
    return SALES_PRESENTATION_MARKERS.some((marker) => text.includes(marker));
}

async function generateProspectReply(botMessage, conversationHistory, claudeApiKey) {
    const fallbackReplies = [
        'Так, у нас є такі проблеми з ручними процесами.',
        'Менеджери витрачають багато часу на рутину, хочемо це виправити.',
        'Цікавить ваша консультація, розкажіть детальніше.',
    ];

    if (!claudeApiKey) {
        return fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];
    }

    try {
        const historyText = Array.isArray(conversationHistory)
            ? conversationHistory.slice(-6).map((m) => `${m.role === 'assistant' ? 'Ден' : 'Клієнт'}: ${m.content}`).join('\n')
            : '';

        const response = await callClaude({
            sessionId: null,
            systemPrompt: [
                'Ти — підприємець, власник компанії з логістики та оптової торгівлі, 10-15 людей у команді.',
                'Є реальні проблеми: менеджери ведуть замовлення в Excel, передають через Viber/Telegram, часто плутають адреси, губляться документи.',
                'Ти зацікавлений в автоматизації, але хочеш спершу зрозуміти деталі.',
                'Відповідай КОРОТКО — 1-2 речення, природно, без формальностей, на "ти".',
                'Говори тільки українською. Тільки відповідь, без пояснень.',
            ].join(' '),
            messages: [
                ...(historyText ? [{ role: 'user', content: `Контекст розмови:\n${historyText}` }, { role: 'assistant', content: 'Зрозумів контекст.' }] : []),
                { role: 'user', content: `Ден написав: "${botMessage}"\nЯк відповіси?` },
            ],
            options: { maxTokens: 120, apiKey: claudeApiKey },
        });

        return response.trim() || fallbackReplies[0];
    } catch (_error) {
        return fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];
    }
}

async function runSalesDialogRegression(bot, claudeApiKey) {
    const started = await startTestSession({ botId: bot.id });
    const outputs = [{ message: '[START]', botResponse: started.firstMessage, currentState: started.currentState }];
    let sessionId = started.sessionId;
    let lastBotMessage = started.firstMessage;
    let conversationHistory = [];
    const MAX_TURNS = 15;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        let userMessage;

        if (isSalesPresentation(lastBotMessage)) {
            // Bot showed presentation — confirm booking
            userMessage = 'Так, давай! Хочу записатись на консультацію.';
        } else {
            userMessage = await generateProspectReply(lastBotMessage, conversationHistory, claudeApiKey);
        }

        const step = await sendTestMessage({ sessionId, message: userMessage });
        conversationHistory.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: step.botResponse || '' },
        );

        outputs.push({
            message: userMessage,
            botResponse: step.botResponse,
            currentState: step.currentState,
            hasBotResponse: Boolean(step.botResponse),
            warning: step.warning || null,
            isPresentation: isSalesPresentation(lastBotMessage),
        });

        lastBotMessage = step.botResponse || '';

        // Stop after confirming booking (presentation received + reply sent)
        if (isSalesPresentation(outputs[outputs.length - 2]?.botResponse || '')) break;
        // Stop if session completed or reached payment wait
        if (!step.botResponse || step.currentState === 'completed') break;
    }

    const state = await getTestSessionState({ sessionId });
    const ended = await endTestSession({ sessionId });
    const reachedPresentation = outputs.some((s) => isSalesPresentation(s.botResponse || ''));

    return {
        bot: { id: bot.id, name: bot.name, slug: bot.slug, project: bot.project?.slug || null },
        legend: { source: 'dynamic-sales', title: 'Dynamic SPIN sales simulation' },
        sessionId,
        startedState: started.currentState,
        steps: outputs,
        finalState: state.currentState,
        historyCount: Array.isArray(state.history) ? state.history.length : 0,
        ended: !ended.summary.isActive,
        filesCreated: ended.filesCreated,
        reachedPresentation,
        warnings: outputs.map((item) => item.warning).filter(Boolean),
    };
}

async function runBotRegression(botId) {
    const bot = await db.bot.findUnique({ where: { id: botId }, include: { project: true } });
    if (!bot) {
        throw new Error('Bot not found');
    }

    const systemClaudeKey = await getSystemClaudeKey();
    const effectiveClaudeKey = systemClaudeKey || (hasUsableAnthropicKey() ? process.env.ANTHROPIC_API_KEY : '');

    // Den sales bot gets a dynamic SPIN conversation instead of 3 static messages
    if (bot.slug === 'bot-sales-automation' || bot.slug === 'bot-sales-spin') {
        return runSalesDialogRegression(bot, effectiveClaudeKey);
    }

    const legend = await buildScenarioLegend(bot, effectiveClaudeKey);

    const started = await startTestSession({ botId: bot.id });
    const outputs = [];

    for (const message of legend.messages) {
        const step = await sendTestMessage({ sessionId: started.sessionId, message });
        outputs.push({
            message,
            currentState: step.currentState,
            hasBotResponse: Boolean(step.botResponse),
            warning: step.warning || null,
        });
    }

    const state = await getTestSessionState({ sessionId: started.sessionId });
    const ended = await endTestSession({ sessionId: started.sessionId });

    return {
        bot: {
            id: bot.id,
            name: bot.name,
            slug: bot.slug,
            project: bot.project?.slug || null,
        },
        legend,
        sessionId: started.sessionId,
        startedState: started.currentState,
        steps: outputs,
        finalState: state.currentState,
        historyCount: Array.isArray(state.history) ? state.history.length : 0,
        ended: !ended.summary.isActive,
        filesCreated: ended.filesCreated,
        warnings: outputs.map((item) => item.warning).filter(Boolean),
    };
}

async function runProjectRegressions(projectSlug = 'finance-course') {
    const bots = await db.bot.findMany({
        where: { project: { slug: projectSlug } },
        orderBy: { name: 'asc' },
        include: { project: true },
    });

    const results = [];
    for (const bot of bots) {
        try {
            const report = await runBotRegression(bot.id);
            results.push({ ok: true, report });
        } catch (error) {
            results.push({
                ok: false,
                bot: { id: bot.id, name: bot.name, slug: bot.slug },
                error: error.message,
            });
        }
    }

    return {
        projectSlug,
        botsTotal: bots.length,
        passed: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
        results,
    };
}

module.exports = {
    buildScenarioLegend,
    runBotRegression,
    runProjectRegressions,
};
