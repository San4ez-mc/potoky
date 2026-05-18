'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const TARGET_BOT_SLUGS_V15 = [
    'bot-2-2-cashflow-table',
    'bot-2-3-payment-calendar',
    'bot-3-2-pl-table',
    'bot-4-4-combined-table',
    'bot-5-2-balance-table',
];

const TARGET_BOT_SLUGS_ALL = [
    'bot-2-1-articles',
    'bot-2-2-cashflow-table',
    'bot-2-3-payment-calendar',
    'bot-3-2-pl-table',
    'bot-3-3-diagnostics',
    'bot-4-1-process-update',
    'bot-4-2-salaries',
    'bot-4-3-payments',
    'bot-4-4-combined-table',
    'bot-4-5-team-instructions',
    'bot-5-1-balance-articles',
    'bot-5-2-balance-table',
    'bot-5-3-balance-process',
];

function getCliUrlArg() {
    const arg = process.argv.find((v) => v.startsWith('--url='));
    if (!arg) return null;
    return arg.slice('--url='.length).trim() || null;
}

function getTargetSlugs() {
    return process.argv.includes('--all') ? TARGET_BOT_SLUGS_ALL : TARGET_BOT_SLUGS_V15;
}

async function main() {
    const appsScriptUrl = getCliUrlArg() || process.env.APPS_SCRIPT_URL || 'REPLACE_AFTER_DEPLOY';
    const targetSlugs = getTargetSlugs();

    const project = await prisma.project.findUnique({
        where: { slug: 'finance-course' },
        select: { id: true, slug: true },
    });

    if (!project) {
        throw new Error('Project finance-course not found');
    }

    const bots = await prisma.bot.findMany({
        where: {
            projectId: project.id,
            slug: { in: targetSlugs },
        },
        select: { id: true, slug: true, name: true },
        orderBy: { slug: 'asc' },
    });

    let updated = 0;
    for (const bot of bots) {
        await prisma.funnelKey.upsert({
            where: {
                botId_key: {
                    botId: bot.id,
                    key: 'APPS_SCRIPT_URL',
                },
            },
            update: {
                value: appsScriptUrl,
                label: 'Google Apps Script Webhook URL',
                isSecret: false,
            },
            create: {
                botId: bot.id,
                key: 'APPS_SCRIPT_URL',
                value: appsScriptUrl,
                label: 'Google Apps Script Webhook URL',
                isSecret: false,
            },
        });
        updated += 1;
        console.log(`OK: ${bot.slug} -> APPS_SCRIPT_URL`);
    }

    const missingSlugs = targetSlugs.filter((slug) => !bots.some((b) => b.slug === slug));

    console.log(JSON.stringify({
        ok: true,
        project: project.slug,
        mode: process.argv.includes('--all') ? 'all' : 'v15-default',
        appsScriptUrlSetTo: appsScriptUrl,
        botsUpdated: updated,
        targetSlugs,
        missingSlugs,
    }, null, 2));
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
