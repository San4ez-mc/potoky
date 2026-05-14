'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { db } = require('@platform/db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validateParams } = require('../middleware/validateParams');

const router = Router();

const SYSTEM_KEYS = {
    CLAUDE_API_KEY: {
        label: 'Claude API Key',
        description: 'Anthropic API key for AI-driven regression generation.',
        connectorType: 'system_claude_api',
        configField: 'apiKey',
        extraConfig: { provider: 'anthropic' },
        isSecret: true,
    },
    ADMIN_TELEGRAM_ID: {
        label: 'Admin Telegram ID',
        description: 'Telegram ID адміністратора для системних сповіщень.',
        connectorType: 'system_admin_telegram_id',
        configField: 'value',
        isSecret: false,
    },
    COURSE_PRICE: {
        label: 'Course Price',
        description: 'Текстова ціна курсу для повідомлень (наприклад: 2990 грн).',
        connectorType: 'system_course_price',
        configField: 'value',
        isSecret: false,
    },
    COURSE_PRICE_INT: {
        label: 'Course Price Int',
        description: 'Числова ціна курсу (наприклад: 2990).',
        connectorType: 'system_course_price_int',
        configField: 'value',
        isSecret: false,
    },
};

function mask(value, isSecret = true) {
    if (!value) return '';
    if (!isSecret) return value;
    return '••••••••';
}

async function getStoredSystemKey(keyName) {
    const def = SYSTEM_KEYS[keyName];
    if (!def) return null;

    const connector = await db.savedConnector.findFirst({
        where: { type: def.connectorType },
        orderBy: { updatedAt: 'desc' },
    });

    const config = connector?.config || {};
    const configField = def.configField || 'value';
    const rawValue = config[configField] || '';

    return {
        key: keyName,
        label: connector?.name || def.label,
        description: connector?.description || def.description,
        value: rawValue,
        isSecret: def.isSecret !== false,
        exists: Boolean(rawValue),
        updatedAt: connector?.updatedAt || null,
    };
}

router.get('/', asyncHandler(async (_req, res) => {
    const keys = await Promise.all(Object.keys(SYSTEM_KEYS).map((keyName) => getStoredSystemKey(keyName)));
    res.json({
        ok: true,
        data: keys.filter(Boolean).map((item) => ({
            ...item,
            value: mask(item.value, item.isSecret),
        })),
    });
}));

router.put('/:key',
    validateParams({
        params: z.object({ key: z.string().min(1) }),
        body: z.object({
            value: z.string().min(1),
            label: z.string().optional(),
            description: z.string().optional(),
            isSecret: z.boolean().optional(),
        }),
    }),
    asyncHandler(async (req, res) => {
        const keyName = String(req.params.key || '').toUpperCase();
        const def = SYSTEM_KEYS[keyName];
        if (!def) {
            return res.status(400).json({ ok: false, error: { message: 'Unknown system key' } });
        }

        const { value, label, description } = req.body;
        const existing = await db.savedConnector.findFirst({
            where: { type: def.connectorType },
            orderBy: { updatedAt: 'desc' },
        });

        const configField = def.configField || 'value';
        const payload = {
            name: label || def.label,
            description: description || def.description,
            type: def.connectorType,
            isActive: true,
            config: {
                ...(def.extraConfig || {}),
                [configField]: value,
            },
        };

        const saved = existing
            ? await db.savedConnector.update({ where: { id: existing.id }, data: payload })
            : await db.savedConnector.create({ data: payload });

        res.json({
            ok: true,
            data: {
                key: keyName,
                label: saved.name,
                description: saved.description,
                value: mask(value, def.isSecret !== false),
                isSecret: def.isSecret !== false,
                exists: true,
                updatedAt: saved.updatedAt,
            },
        });
    })
);

router.get('/:key/reveal',
    validateParams({ params: z.object({ key: z.string().min(1) }) }),
    asyncHandler(async (req, res) => {
        const keyName = String(req.params.key || '').toUpperCase();
        const item = await getStoredSystemKey(keyName);
        if (!item || !item.exists) {
            return res.status(404).json({ ok: false, error: { message: 'System key not found' } });
        }
        res.json({ ok: true, data: { key: keyName, value: item.value } });
    })
);

module.exports = router;
