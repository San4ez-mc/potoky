'use strict';

const { db } = require('@platform/db');
const logger = require('@platform/logger');

class MessageService {
    static async save(sessionId, role, content, metadata = {}) {
        return db.message.create({
            data: { sessionId, role, content, metadata },
        });
    }

    static async getHistory(sessionId) {
        return MessageService.getAll(sessionId);
    }

    static async getAll(sessionId) {
        return db.message.findMany({
            where: { sessionId },
            orderBy: { createdAt: 'asc' },
        });
    }
}

module.exports = { MessageService };
