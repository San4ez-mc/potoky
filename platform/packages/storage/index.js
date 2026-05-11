'use strict';

const path = require('path');
const fs = require('fs/promises');
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { StorageError } = require('@platform/errors');

const BASE_PATH = process.env.FILES_BASE_PATH || '/data/files';

class FileStorage {
    /**
     * Save a file to disk + DB. Auto-increments version.
     */
    static async save({ userId, botId, sessionId, fileType, content, projectSlug = 'default' }) {
        try {
            const latest = await this.getLatest(userId, fileType);
            const version = (latest?.version || 0) + 1;

            const fileName = `${fileType}_v${version}.md`;
            const dirPath = path.join(BASE_PATH, projectSlug, userId);
            const filePath = path.join(dirPath, fileName);

            await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');

            const file = await db.file.create({
                data: {
                    userId,
                    botId,
                    sessionId,
                    fileType,
                    fileName,
                    filePath,
                    content,
                    version,
                },
            });

            logger.info('File saved', { userId, fileType, version, filePath });
            return file;
        } catch (error) {
            logger.error('FileStorage.save failed', { userId, fileType, error: error.message });
            throw new StorageError(`Failed to save file: ${error.message}`, { userId, fileType });
        }
    }

    /**
     * Get the latest version of a file for a user.
     */
    static async getLatest(userId, fileType) {
        try {
            return await db.file.findFirst({
                where: { userId, fileType },
                orderBy: { version: 'desc' },
            });
        } catch (error) {
            logger.error('FileStorage.getLatest failed', { userId, fileType, error: error.message });
            throw new StorageError(`Failed to get file: ${error.message}`, { userId, fileType });
        }
    }

    /**
     * Get all file types that exist for a user.
     */
    static async getAllTypes(userId) {
        try {
            const files = await db.file.findMany({
                where: { userId },
                select: { fileType: true },
                distinct: ['fileType'],
            });
            return files.map(f => f.fileType);
        } catch (error) {
            logger.error('FileStorage.getAllTypes failed', { userId, error: error.message });
            throw new StorageError(`Failed to get file types: ${error.message}`, { userId });
        }
    }

    /**
     * Get all files for a user (latest version per type).
     */
    static async getAllLatest(userId) {
        try {
            const fileTypes = await this.getAllTypes(userId);
            const files = await Promise.all(
                fileTypes.map(ft => this.getLatest(userId, ft))
            );
            return files.filter(Boolean);
        } catch (error) {
            logger.error('FileStorage.getAllLatest failed', { userId, error: error.message });
            throw new StorageError(`Failed to get all files: ${error.message}`, { userId });
        }
    }

    /**
     * Get all versions of a file type for a user.
     */
    static async getVersions(userId, fileType) {
        try {
            return await db.file.findMany({
                where: { userId, fileType },
                orderBy: { version: 'desc' },
            });
        } catch (error) {
            logger.error('FileStorage.getVersions failed', { userId, fileType, error: error.message });
            throw new StorageError(`Failed to get file versions: ${error.message}`, { userId, fileType });
        }
    }
}

module.exports = { FileStorage };
