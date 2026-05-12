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

async function buildScenarioLegend(bot) {
    const fallback = {
        source: 'fallback',
        title: `Smoke scenario for ${bot.slug}`,
        messages: [
            'Привіт! Я хочу пройти коротке тестування воронки.',
            'Ми надаємо бухгалтерські послуги для B2B компаній.',
            'Підкажіть наступний крок, щоб продовжити діалог.',
        ],
    };

    if (!hasUsableAnthropicKey()) {
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
            options: { maxTokens: 400 },
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

async function runBotRegression(botId) {
    const bot = await db.bot.findUnique({ where: { id: botId }, include: { project: true } });
    if (!bot) {
        throw new Error('Bot not found');
    }

    const legend = await buildScenarioLegend(bot);

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
