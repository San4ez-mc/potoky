'use strict';

const { createClient } = require('redis');
const { RedisStore } = require('connect-redis');
const logger = require('@platform/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redisClient = createClient({ url: REDIS_URL });

redisClient.on('error', (error) => {
    logger.error('Redis session client error', {
        message: error.message,
    });
});

const redisConnectPromise = redisClient.connect()
    .then(() => {
        logger.info('Redis session client connected', { redis: REDIS_URL });
    })
    .catch((error) => {
        logger.error('Failed to connect Redis session client', {
            redis: REDIS_URL,
            message: error.message,
        });
        throw error;
    });

const sessionStore = new RedisStore({
    client: redisClient,
    prefix: 'platform:session:',
});

module.exports = {
    REDIS_URL,
    redisClient,
    redisConnectPromise,
    sessionStore,
};
