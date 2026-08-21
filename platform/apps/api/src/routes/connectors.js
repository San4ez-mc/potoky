'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { authMiddleware } = require('../middleware/auth');
const { validateParams } = require('../middleware/validateParams');
const { NotFoundError } = require('@platform/errors');

const router = Router();
router.use(authMiddleware);

const BUILTIN_CONNECTORS = [
    {
        // Один ключ Anthropic на всі моделі — Haiku/Sonnet/Opus обираються на рівні
        // ноди (data.model), а не ключа/конектора. Раніше було 3 окремих типи
        // (claude_haiku/claude_sonnet/claude_opus) з ІДЕНТИЧНИМ ключем у кожному —
        // штучне дублення, злито в один 2026-08-21.
        type: 'claude',
        name: 'Claude',
        description: 'Anthropic Claude — один ключ на всі моделі (Haiku/Sonnet/Opus обираються на ноді).',
        icon: '🎭',
        color: '#7C3AED',
        schema: { fields: [{ key: 'api_key', label: 'Anthropic API Key', secret: true }] },
    },
    {
        type: 'openai_gpt4',
        name: 'OpenAI GPT-4',
        description: 'OpenAI GPT-4o - мультимодальна модель OpenAI.',
        icon: '🤖',
        color: '#059669',
        schema: { fields: [{ key: 'api_key', label: 'OpenAI API Key', secret: true }] },
    },
    {
        type: 'telegram_bot',
        name: 'Telegram Bot',
        description: 'Telegram Bot API - повідомлення та медіа через Telegram.',
        icon: '✈️',
        color: '#0088CC',
        schema: { fields: [{ key: 'token', label: 'Bot Token', secret: true }] },
    },
    {
        type: 'google_sheets',
        name: 'Google Sheets',
        description: 'Google Sheets API через Service Account.',
        icon: '📊',
        color: '#1E7E34',
        schema: {
            fields: [
                { key: 'service_account_json', label: 'Service Account JSON', secret: true, multiline: true },
                { key: 'spreadsheet_id', label: 'Spreadsheet ID', secret: false },
            ],
        },
    },
    {
        type: 'apps_script',
        name: 'Google Apps Script',
        description: 'Виклик Google Apps Script Web App.',
        icon: '📝',
        color: '#3B82F6',
        schema: { fields: [{ key: 'url', label: 'Web App URL', secret: false }] },
    },
    {
        type: 'webhook_generic',
        name: 'Generic Webhook',
        description: 'Довільний HTTP endpoint для інтеграцій.',
        icon: '🔗',
        color: '#6B7280',
        schema: {
            fields: [
                { key: 'url', label: 'URL ендпоінта', secret: false },
                { key: 'secret_header', label: 'Secret Header', secret: true },
            ],
        },
    },
    {
        type: 'ibanoplata',
        name: 'IbanOplata',
        description: 'IbanOplata API — генерація IBAN-посилань на оплату (orderRef у призначенні). Ліміт ~20 активних посилань — видаляються після оплати/24 год.',
        icon: '💳',
        color: '#16A34A',
        schema: {
            fields: [
                { key: 'api_key', label: 'API Key (X-Api-Key)', secret: true },
                { key: 'organization_name', label: 'Юр. назва / ФОП', secret: false },
                { key: 'identification_code', label: 'ЄДРПОУ / РНОКПП', secret: false },
                { key: 'iban', label: 'IBAN одержувача', secret: false },
                { key: 'expiration_hours', label: 'Термін дії посилання, год (дефолт 24)', secret: false },
            ],
        },
    },
    {
        type: 'monobank',
        name: 'Monobank ФОП',
        description: 'Monobank personal API — виписка ФОП для звірки оплат (пошук orderRef у призначенні). Ліміт 1 запит виписки / 60 c.',
        icon: '🐈‍⬛',
        color: '#000000',
        schema: {
            fields: [
                { key: 'token', label: 'X-Token (api.monobank.ua)', secret: true },
                { key: 'account_id', label: 'ID рахунку (дефолт 0)', secret: false },
            ],
        },
    },
    {
        type: 'browser_agent',
        name: 'Browser Agent',
        description: 'Мікросервіс веб-автоматизації: replay (детермінований сценарій), agent (ШІ веде браузер), read (парсинг). Для замовлень постачальникам + соц-метрик.',
        icon: '🕹️',
        color: '#7C3AED',
        schema: {
            fields: [
                { key: 'base_url', label: 'URL сервісу (дефолт http://127.0.0.1:8091)', secret: false },
                { key: 'secret', label: 'X-Agent-Secret', secret: true },
            ],
        },
    },
];

// GET /api/connectors — list all active connectors
router.get('/', asyncHandler(async (_req, res) => {
    const connectorsFromDb = await db.connectorDef.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
    });

    const mapByType = new Map(BUILTIN_CONNECTORS.map((item) => [item.type, { ...item, isActive: true, isBuiltin: true }]));
    for (const item of connectorsFromDb) {
        mapByType.set(item.type, item);
    }

    const connectors = Array.from(mapByType.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    res.json({ ok: true, data: connectors });
}));

// GET /api/connectors/:id
router.get('/:id',
    validateParams({ params: z.object({ id: z.string().uuid() }) }),
    asyncHandler(async (req, res) => {
        const c = await db.connectorDef.findUnique({ where: { id: req.params.id } });
        if (!c) throw new NotFoundError('Connector', req.params.id);
        res.json({ ok: true, data: c });
    })
);

module.exports = router;
