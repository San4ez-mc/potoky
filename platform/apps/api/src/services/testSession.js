'use strict';

const { db } = require('@platform/db');
const { BOT_REQUIREMENTS } = require('../../../../projects/finance-course/config/prerequisites');

const { handleTelegramUpdate } = require('../../../../projects/finance-course/src/telegramHandler');

const MAX_SAFE_TELEGRAM_ID = 9007199254740991;

function toSafeNumberTelegramId(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || !Number.isSafeInteger(num)) {
        throw new Error('User telegramId is not a safe integer for test delivery');
    }
    return num;
}

function buildSyntheticTelegramIdentity(botSlug) {
    const base = 700000000;
    const random = Math.floor(Math.random() * 100000000);
    const telegramId = base + random;
    return {
        telegramId,
        username: `test_${botSlug}_${Date.now()}`,
        firstName: 'Test',
        lastName: 'Runner',
        languageCode: 'uk',
    };
}

function buildUpdate(identity, text) {
    const now = Date.now();
    return {
        update_id: now,
        message: {
            message_id: now,
            from: {
                id: identity.telegramId,
                is_bot: false,
                first_name: identity.firstName || 'Test',
                last_name: identity.lastName || '',
                username: identity.username || null,
                language_code: identity.languageCode || 'uk',
            },
            chat: {
                id: identity.telegramId,
                type: 'private',
            },
            date: Math.floor(now / 1000),
            text,
        },
    };
}

async function resolveBot({ botId, botSlug }) {
    if (!botId && !botSlug) {
        throw new Error('Provide botId or botSlug');
    }

    const bot = await db.bot.findFirst({
        where: botId ? { id: botId } : { slug: botSlug },
        include: { project: true },
    });

    if (!bot) {
        throw new Error('Bot not found');
    }

    if (bot.project?.slug !== 'finance-course') {
        throw new Error('Test session currently supports finance-course bots only');
    }

    return bot;
}

async function resolveIdentity(userId, botSlug) {
    if (!userId) {
        return buildSyntheticTelegramIdentity(botSlug);
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new Error('User not found');
    }

    return {
        telegramId: toSafeNumberTelegramId(user.telegramId),
        username: user.username || `test_user_${user.id.slice(0, 8)}`,
        firstName: user.firstName || 'Test',
        lastName: user.lastName || '',
        languageCode: user.languageCode || 'uk',
    };
}

async function getLatestAssistantMessage(sessionId) {
    return db.message.findFirst({
        where: { sessionId, role: 'assistant' },
        orderBy: { createdAt: 'desc' },
    });
}

async function findLatestSession(userId, botId) {
    return db.session.findFirst({
        where: { userId, botId },
        orderBy: { startedAt: 'desc' },
    });
}

async function ensurePrerequisiteFiles(userId, bot) {
    const requirements = BOT_REQUIREMENTS[bot.slug] || { files: [] };

    for (const fileType of requirements.files || []) {
        const latest = await db.file.findFirst({
            where: { userId, fileType },
            orderBy: { version: 'desc' },
        });

        if (latest) {
            continue;
        }

        await db.file.create({
            data: {
                userId,
                botId: bot.id,
                fileType,
                fileName: `${fileType}_seed_v1.md`,
                filePath: `/tmp/test-seed/${userId}/${fileType}_v1.md`,
                content: `Seed file for automated regression: ${fileType}`,
                version: 1,
            },
        });
    }
}

async function startTestSession({ botId, botSlug, userId }) {
    const bot = await resolveBot({ botId, botSlug });
    const identity = await resolveIdentity(userId, bot.slug);

    let warning = null;
    const attempts = [
        `/start ${bot.slug}`,
        '/start',
        'Привіт',
    ];

    for (const message of attempts) {
        try {
            await handleTelegramUpdate(buildUpdate(identity, message));
        } catch (error) {
            warning = error.message;
        }

        const existingUser = await db.user.findUnique({ where: { telegramId: BigInt(identity.telegramId) } });
        if (!existingUser) continue;

        await ensurePrerequisiteFiles(existingUser.id, bot);

        const existingSession = await findLatestSession(existingUser.id, bot.id);
        if (existingSession) break;
    }

    const user = await db.user.findUnique({ where: { telegramId: BigInt(identity.telegramId) } });
    if (!user) {
        throw new Error('Test user was not created by handler');
    }

    const session = await findLatestSession(user.id, bot.id);

    if (!session) {
        throw new Error('Test session was not created');
    }

    const firstMessage = await getLatestAssistantMessage(session.id);

    return {
        sessionId: session.id,
        firstMessage: firstMessage?.content || null,
        currentState: session.state,
        contextSnapshot: session.context,
        slotsSnapshot: session.context?.slots || {},
        testUser: {
            id: user.id,
            telegramId: identity.telegramId,
            username: identity.username,
        },
        warning,
    };
}

async function sendTestMessage({ sessionId, message }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: { user: true, bot: { include: { project: true } } },
    });

    if (!session) {
        throw new Error('Session not found');
    }

    if (session.bot.project?.slug !== 'finance-course') {
        throw new Error('Test session currently supports finance-course bots only');
    }

    const identity = {
        telegramId: toSafeNumberTelegramId(session.user.telegramId),
        username: session.user.username || `test_user_${session.user.id.slice(0, 8)}`,
        firstName: session.user.firstName || 'Test',
        lastName: session.user.lastName || '',
        languageCode: session.user.languageCode || 'uk',
    };

    let warning = null;
    try {
        await handleTelegramUpdate(buildUpdate(identity, message));
    } catch (error) {
        warning = error.message;
    }

    const latestAssistantMessage = await getLatestAssistantMessage(session.id);
    const updatedSession = await db.session.findUnique({ where: { id: session.id } });

    return {
        sessionId: session.id,
        botResponse: latestAssistantMessage?.content || null,
        currentState: updatedSession?.state || session.state,
        contextSnapshot: updatedSession?.context || session.context,
        slotsSnapshot: (updatedSession?.context || session.context)?.slots || {},
        warning,
    };
}

async function getTestSessionState({ sessionId }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: {
            user: { select: { id: true, firstName: true, username: true, telegramId: true } },
            bot: { select: { id: true, name: true, slug: true } },
            messages: { orderBy: { createdAt: 'asc' }, take: 200 },
            files: { orderBy: { createdAt: 'desc' }, take: 100 },
        },
    });

    if (!session) {
        throw new Error('Session not found');
    }

    return {
        sessionId: session.id,
        bot: session.bot,
        user: session.user,
        isActive: session.isActive,
        currentState: session.state,
        currentNode: session.context?.currentNode || null,
        context: session.context,
        slots: session.context?.slots || {},
        history: session.messages,
        files: session.files,
    };
}

async function endTestSession({ sessionId }) {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: {
            _count: { select: { messages: true, apiCalls: true, files: true } },
        },
    });

    if (!session) {
        throw new Error('Session not found');
    }

    const updatedSession = session.isActive
        ? await db.session.update({
            where: { id: sessionId },
            data: { isActive: false, completedAt: new Date(), lastActive: new Date() },
        })
        : session;

    return {
        sessionId,
        summary: {
            isActive: updatedSession.isActive,
            completedAt: updatedSession.completedAt,
            state: updatedSession.state,
        },
        nodesVisited: null,
        filesCreated: session._count.files,
        messagesCount: session._count.messages,
        apiCallsCount: session._count.apiCalls,
        slotsSet: Object.keys(updatedSession.context?.slots || {}).length,
    };
}

module.exports = {
    startTestSession,
    sendTestMessage,
    getTestSessionState,
    endTestSession,
};
