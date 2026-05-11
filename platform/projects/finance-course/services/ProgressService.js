'use strict';

const { db } = require('@platform/db');
const { FileStorage } = require('@platform/storage');
const logger = require('@platform/logger');
const { BLOCK_STATUSES } = require('../constants');

const BLOCK_UNLOCK_CONDITIONS = {
    1: () => true,
    2: (files) => files.has('business_process'),
    3: (files) => files.has('cashflow_articles') && files.has('pl_articles'),
    4: (files) => files.has('cashflow_articles') && files.has('pl_articles'),
    5: (files) => files.has('balance_articles'),
};

class ProgressService {
    static async checkBlockAccess(userId, blockNumber) {
        const userFileTypes = await FileStorage.getAllTypes(userId);
        const filesSet = new Set(userFileTypes);
        const condition = BLOCK_UNLOCK_CONDITIONS[blockNumber];
        if (!condition) return true;
        return condition(filesSet);
    }

    static async getProgress(userId, projectId) {
        return db.userProgress.findMany({
            where: { userId, projectId },
            orderBy: [{ blockNumber: 'asc' }, { lessonNumber: 'asc' }],
            include: { bot: { select: { name: true, slug: true } } },
        });
    }

    static async markCompleted(userId, projectId, lessonNumber, botId, artifactFileId = null) {
        const existing = await db.userProgress.findFirst({
            where: { userId, projectId, lessonNumber },
        });

        if (existing) {
            return db.userProgress.update({
                where: { id: existing.id },
                data: {
                    status: BLOCK_STATUSES.COMPLETED,
                    completedAt: new Date(),
                    artifactFileId,
                },
            });
        }

        const blockNumber = parseInt(lessonNumber.split('.')[0], 10);
        return db.userProgress.create({
            data: {
                userId,
                projectId,
                blockNumber,
                lessonNumber,
                botId,
                status: BLOCK_STATUSES.COMPLETED,
                completedAt: new Date(),
                artifactFileId,
            },
        });
    }
}

module.exports = { ProgressService };
