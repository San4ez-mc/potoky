'use strict';
/**
 * Seed ConnectorDef types — системні шаблони конекторів.
 * Запуск: node scripts/seed_connector_defs.js
 */
const { db } = require('@platform/db');

const connectorDefs = [
    {
        type: 'claude_haiku',
        name: 'Claude Haiku',
        description: 'Anthropic Claude Haiku — швидка, дешева модель. Підходить для класифікації та простих відповідей.',
        icon: '⚡',
        color: '#D4A800',
        schema: {
            model: 'claude-haiku-4-5',
            max_tokens: 4096,
            api_url: 'https://api.anthropic.com/v1/messages',
            docs_url: 'https://docs.anthropic.com/en/api/messages',
            fields: [
                { key: 'api_key', label: 'Anthropic API Key', secret: true, placeholder: 'sk-ant-api03-...' },
            ],
        },
    },
    {
        type: 'claude_sonnet',
        name: 'Claude Sonnet',
        description: 'Anthropic Claude Sonnet — баланс між якістю та швидкістю. Основна модель для складних задач.',
        icon: '🎭',
        color: '#7C3AED',
        schema: {
            model: 'claude-sonnet-4-5',
            max_tokens: 8192,
            api_url: 'https://api.anthropic.com/v1/messages',
            docs_url: 'https://docs.anthropic.com/en/api/messages',
            fields: [
                { key: 'api_key', label: 'Anthropic API Key', secret: true, placeholder: 'sk-ant-api03-...' },
            ],
        },
    },
    {
        type: 'claude_opus',
        name: 'Claude Opus',
        description: 'Anthropic Claude Opus — найпотужніша модель. Для складного аналізу та генерації контенту.',
        icon: '🧠',
        color: '#5B21B6',
        schema: {
            model: 'claude-opus-4-5',
            max_tokens: 16384,
            api_url: 'https://api.anthropic.com/v1/messages',
            docs_url: 'https://docs.anthropic.com/en/api/messages',
            fields: [
                { key: 'api_key', label: 'Anthropic API Key', secret: true, placeholder: 'sk-ant-api03-...' },
            ],
        },
    },
    {
        type: 'openai_gpt4',
        name: 'OpenAI GPT-4',
        description: 'OpenAI GPT-4o — потужна мультимодальна модель OpenAI.',
        icon: '🤖',
        color: '#059669',
        schema: {
            model: 'gpt-4o',
            api_url: 'https://api.openai.com/v1/chat/completions',
            docs_url: 'https://platform.openai.com/docs/api-reference/chat',
            fields: [
                { key: 'api_key', label: 'OpenAI API Key', secret: true, placeholder: 'sk-...' },
            ],
        },
    },
    {
        type: 'telegram_bot',
        name: 'Telegram Bot',
        description: 'Telegram Bot API — відправка повідомлень, кнопок, медіа через Telegram бота.',
        icon: '✈️',
        color: '#0088CC',
        schema: {
            api_url: 'https://api.telegram.org/bot{token}/sendMessage',
            docs_url: 'https://core.telegram.org/bots/api',
            fields: [
                { key: 'token', label: 'Bot Token', secret: true, placeholder: '1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ' },
            ],
        },
    },
    {
        type: 'google_sheets',
        name: 'Google Sheets',
        description: 'Google Sheets API через Service Account — читання та запис таблиць.',
        icon: '📊',
        color: '#1E7E34',
        schema: {
            api_url: 'https://sheets.googleapis.com/v4/spreadsheets',
            docs_url: 'https://developers.google.com/sheets/api/reference/rest',
            fields: [
                { key: 'service_account_json', label: 'Service Account JSON', secret: true, placeholder: '{"type":"service_account","project_id":"..."}', multiline: true },
                { key: 'spreadsheet_id', label: 'Spreadsheet ID (необов\'язково)', secret: false, placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms' },
            ],
        },
    },
    {
        type: 'apps_script',
        name: 'Google Apps Script',
        description: 'Google Apps Script Web App — виклик скриптів для автоматизації (таблиці, пошта, Calendar).',
        icon: '📝',
        color: '#3B82F6',
        schema: {
            docs_url: 'https://developers.google.com/apps-script/guides/web',
            fields: [
                { key: 'url', label: 'Web App URL', secret: false, placeholder: 'https://script.google.com/macros/s/.../exec' },
            ],
        },
    },
    {
        type: 'wayforpay',
        name: 'WayForPay',
        description: 'WayForPay API — створення інвойсів та обробка webhook подій оплати.',
        icon: '💳',
        color: '#2563EB',
        schema: {
            api_url: 'https://api.wayforpay.com/api',
            docs_url: 'https://wiki.wayforpay.com/en/view/852131',
            actions: ['create_invoice'],
            fields: [
                { key: 'merchant_account', label: 'Merchant Account (логін)', secret: false, placeholder: 'merchant_account' },
                { key: 'merchant_secret', label: 'Secret Key (секретний ключ)', secret: true, placeholder: '********' },
                { key: 'merchant_domain', label: 'Домен магазину (yourdomain.com)', secret: false, placeholder: 'yourdomain.com' },
                { key: 'merchant_name', label: 'Назва магазину (відображається покупцю)', secret: false, placeholder: 'FINEKO' },
            ],
        },
    },
    {
        type: 'fal_ai',
        name: 'Fal.ai',
        description: 'Fal.ai API — генерація зображень і відео через FLUX, Kling, Ideogram, Recraft та інші моделі.',
        icon: '🎨',
        color: '#8B5CF6',
        schema: {
            api_url: 'https://fal.run',
            docs_url: 'https://fal.ai/docs',
            fields: [
                { key: 'api_key', label: 'Fal.ai API Key', secret: true, placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
            ],
        },
    },
    {
        type: 'webhook_generic',
        name: 'Generic Webhook',
        description: 'HTTP запит на довільний URL — POST/GET з JSON body. Для інтеграцій з будь-якими API.',
        icon: '🔗',
        color: '#6B7280',
        schema: {
            docs_url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
            fields: [
                { key: 'url', label: 'URL ендпоінта', secret: false, placeholder: 'https://example.com/webhook' },
                { key: 'secret_header', label: 'Secret Header (необов\'язково)', secret: true, placeholder: 'Bearer abc123' },
            ],
        },
    },
];

async function main() {
    let upserted = 0;
    for (const def of connectorDefs) {
        await db.connectorDef.upsert({
            where: { type: def.type },
            update: {
                name: def.name,
                description: def.description,
                icon: def.icon,
                color: def.color,
                schema: def.schema,
                isActive: true,
            },
            create: {
                ...def,
                isBuiltin: true,
                isActive: true,
            },
        });
        upserted++;
        console.log(`  ✓ ${def.icon} ${def.name} (${def.type})`);
    }
    console.log(`\nUpserted ${upserted} connector definitions.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect());
