<?php
/**
 * Michael Bot — конфігурація
 * ВАЖЛИВО: цей файл має бути ПОЗА public_html або захищений через .htaccess
 *
 * Структура:
 * /home/user/
 * ├── michael-bot/          ← цей код (поза public_html)
 * │   ├── config.php
 * │   └── ...
 * └── public_html/
 *     └── webhook.php       ← симлінк або include до michael-bot/webhook.php
 */

define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'michael_bot');
define('DB_USER', getenv('DB_USER') ?: '');
define('DB_PASSWORD', getenv('DB_PASSWORD') ?: '');
define('DB_CHARSET', 'utf8mb4');

define('TELEGRAM_BOT_TOKEN', getenv('TELEGRAM_BOT_TOKEN') ?: '');
define('TELEGRAM_WEBHOOK_SECRET', getenv('TELEGRAM_WEBHOOK_SECRET') ?: '');
define('ANTHROPIC_API_KEY', getenv('ANTHROPIC_API_KEY') ?: '');
define('FINEKO_API_URL', getenv('FINEKO_API_URL') ?: 'https://tasks.fineko.space/mcp');
define('FINEKO_GOAL_ID', getenv('FINEKO_GOAL_ID') ?: '');
define('OWNER_TELEGRAM_ID', getenv('OWNER_TELEGRAM_ID') ?: '');

define('CLAUDE_MODEL', 'claude-haiku-4-5');
define('CLAUDE_MAX_TOKENS', 1024);
define('CLAUDE_TIMEOUT_S', 30);

define('RATE_LIMIT_PER_MINUTE', 10);

define('ADMIN_USERNAME', getenv('ADMIN_USERNAME') ?: 'admin');
define('ADMIN_PASSWORD_HASH', getenv('ADMIN_PASSWORD_HASH') ?: '');
// Generate: php -r "echo password_hash('yourpassword', PASSWORD_BCRYPT);"

define('APP_ROOT', __DIR__);
