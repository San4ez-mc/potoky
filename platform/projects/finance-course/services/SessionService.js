'use strict';

const { db } = require('@platform/db');
const logger = require('@platform/logger');

class SessionService {
    /**
     * Get or create active session for user+bot.
     * If existing session is completed, creates new one.
     */
    static async getOrCreate(userId, botId, initialState = 'started') {
        const existing = await db.session.findFirst({
            where: { userId, botId, isActive: true },
            orderBy: { startedAt: 'desc' },
        });

        if (existing) {
            await db.session.update({
                where: { id: existing.id },
                data: { lastActive: new Date() },
            });
            return existing;
        }

        const session = await db.session.create({
            data: { userId, botId, state: initialState, context: { currentNode: initialState } },
        });

        logger.info('Session created', { sessionId: session.id, userId, botId });
        return session;
    }

    static async getActive(userId, botId) {
        return db.session.findFirst({
            where: { userId, botId, isActive: true },
            orderBy: { startedAt: 'desc' },
        });
    }

    static async updateState(sessionId, state, contextPatch = {}) {
        const session = await db.session.findUnique({ where: { id: sessionId } });
        const nextNode = contextPatch.currentNode || contextPatch.currentNodeId || state;
        const newContext = { ...session.context, ...contextPatch, currentNode: nextNode };

        return db.session.update({
            where: { id: sessionId },
            data: { state, context: newContext, lastActive: new Date() },
        });
    }

    static async complete(sessionId) {
        return db.session.update({
            where: { id: sessionId },
            data: { isActive: false, completedAt: new Date() },
        });
    }

    static async getById(sessionId) {
        return db.session.findUnique({
            where: { id: sessionId },
            include: { user: true, bot: true },
        });
    }
}

module.exports = { SessionService };
