'use strict';

const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { PROJECT_SLUG } = require('../constants');

class UserService {
    /**
     * Find or create a user from Telegram update data.
     */
    static async findOrCreate(telegramFrom) {
        const { id: telegramId, username, first_name: firstName, last_name: lastName, language_code: languageCode } = telegramFrom;

        const project = await db.project.findUnique({ where: { slug: PROJECT_SLUG } });
        if (!project) throw new Error(`Project '${PROJECT_SLUG}' not found in DB`);

        const existing = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } });

        if (existing) {
            await db.user.update({
                where: { id: existing.id },
                data: { username, firstName, lastName, languageCode, updatedAt: new Date() },
            });
            return existing;
        }

        const user = await db.user.create({
            data: {
                telegramId: BigInt(telegramId),
                username,
                firstName,
                lastName,
                languageCode,
                projectId: project.id,
            },
        });

        logger.info('New user created', { userId: user.id, telegramId });
        return user;
    }

    static async findByTelegramId(telegramId) {
        return db.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    }
}

module.exports = { UserService };
