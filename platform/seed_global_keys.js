'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Seed глобальные ключи проекта из реальных ботов
 * 
 * Источники:
 * - Google Service Account: ultra-surfer-492920-a5-cd1642cd832a.json
 * - Telegram боты: fineko_processes_bot, fineko_bot (и другие)
 * - Apps Script URLs: из боти/*/src/config.js или deploy.md
 */
async function main() {
    const project = await prisma.project.findUnique({
        where: { slug: 'finance-course' },
    });

    if (!project) {
        throw new Error('Project finance-course not found');
    }

    // Глобальные ключи проекта
    const globalKeys = [
        {
            key: 'APPS_SCRIPT_URL',
            label: 'Google Apps Script Webhook URL',
            value: process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/d/YOUR_DEPLOYMENT_ID/usercurrent',
            isSecret: false,
            description: 'Webhook для Apps Script (Financial Reports Builder)',
        },
        {
            key: 'TELEGRAM_BOT_TOKEN',
            label: 'Telegram Bot Token (Main)',
            value: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE',
            isSecret: true,
            description: 'Токен основного Telegram бота (fineko_bot)',
        },
        {
            key: 'TELEGRAM_PROCESSES_BOT_TOKEN',
            label: 'Telegram Bot Token (Processes)',
            value: process.env.TELEGRAM_PROCESSES_BOT_TOKEN || 'YOUR_PROCESSES_BOT_TOKEN_HERE',
            isSecret: true,
            description: 'Токен бота для бізнес-процесів (fineko_processes_bot)',
        },
        {
            key: 'INSTAGRAM_ACCESS_TOKEN',
            label: 'Instagram Business Access Token',
            value: process.env.INSTAGRAM_ACCESS_TOKEN || 'YOUR_INSTAGRAM_TOKEN_HERE',
            isSecret: true,
            description: 'Access token для Instagram Business Account',
        },
        {
            key: 'GOOGLE_SERVICE_ACCOUNT_JSON',
            label: 'Google Service Account (base64)',
            value: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || 'eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6InVsdHJhLXN1cmZlci00OTI5MjAtYTUiLCJwcml2YXRlX2tleV9pZCI6ImNkMTY0MmNkODMyYTBkNGNmZGE2ODM3NjkxY2FhZDlmNWEwNTI3MmUifQ==',
            isSecret: true,
            description: 'Google Service Account для таблиц (закодовано в base64)',
        },
        {
            key: 'ANTHROPIC_API_KEY',
            label: 'Anthropic API Key (Claude)',
            value: process.env.ANTHROPIC_API_KEY || 'sk-ant-YOUR_KEY_HERE',
            isSecret: true,
            description: 'API ключ для Claude AI',
        },
        {
            key: 'WAYFORPAY_MERCHANT_ID',
            label: 'WayForPay Merchant ID',
            value: process.env.WAYFORPAY_MERCHANT_ID || 'YOUR_MERCHANT_ID',
            isSecret: false,
            description: 'Merchant ID для платежей WayForPay',
        },
        {
            key: 'WAYFORPAY_SECRET_KEY',
            label: 'WayForPay Secret Key',
            value: process.env.WAYFORPAY_SECRET_KEY || 'YOUR_SECRET_KEY',
            isSecret: true,
            description: 'Secret ключ для WayForPay',
        },
    ];

    let created = 0;
    for (const key of globalKeys) {
        const existing = await prisma.globalKey.findUnique({
            where: { key: key.key },
        });

        if (!existing) {
            await prisma.globalKey.create({
                data: {
                    projectId: project.id,
                    key: key.key,
                    label: key.label,
                    value: key.value,
                    isSecret: key.isSecret,
                    description: key.description,
                },
            });
            created += 1;
            console.log(`✓ Created global key: ${key.key}`);
        } else {
            console.log(`⊘ Global key already exists: ${key.key}`);
        }
    }

    console.log(JSON.stringify({
        ok: true,
        project: project.slug,
        globalKeysCreated: created,
        message: 'Global keys seeded successfully. Update .env with real values.',
    }, null, 2));
}

main()
    .catch((err) => {
        console.error('Error seeding global keys:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
