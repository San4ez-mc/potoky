module.exports = {
    apps: [
        {
            name: 'platform-api',
            script: 'apps/api/src/index.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '2048M',
            env_production: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'platform-worker',
            script: 'apps/worker/src/index.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '800M',
            env_production: {
                NODE_ENV: 'production',
            },
        },
        {
            // Рендер коротких відео без обличчя (fal.ai + ffmpeg); слухає лише 127.0.0.1:3016
            name: 'short-video',
            script: 'apps/short-video/src/index.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '700M',
            env_production: {
                NODE_ENV: 'production',
                PORT: 3016,
            },
        },
        {
            name: 'platform-mcp',
            script: 'apps/mcp/src/index.js',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '200M',
            env_production: {
                NODE_ENV: 'production',
            },
        },
    ],
};
