const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const bots = [
    { slug: 'bot-1-2-business-process', name: 'Bot 1.2 Business Process' },
    { slug: 'bot-2-1-articles', name: 'Bot 2.1 Articles' },
    { slug: 'bot-2-2-cashflow-table', name: 'Bot 2.2 Cashflow Table' },
    { slug: 'bot-2-3-payment-calendar', name: 'Bot 2.3 Payment Calendar' },
    { slug: 'bot-3-2-pl-table', name: 'Bot 3.2 P&L Table' },
    { slug: 'bot-3-3-diagnostics', name: 'Bot 3.3 Diagnostics' },
    { slug: 'bot-4-1-process-update', name: 'Bot 4.1 Process Update' },
    { slug: 'bot-4-2-salaries', name: 'Bot 4.2 Salaries' },
    { slug: 'bot-4-3-payments', name: 'Bot 4.3 Payments' },
    { slug: 'bot-4-4-combined-table', name: 'Bot 4.4 Combined Table' },
    { slug: 'bot-4-5-team-instructions', name: 'Bot 4.5 Team Instructions' },
    { slug: 'bot-5-1-balance-articles', name: 'Bot 5.1 Balance Articles' },
    { slug: 'bot-5-2-balance-table', name: 'Bot 5.2 Balance Table' },
    { slug: 'bot-5-3-balance-process', name: 'Bot 5.3 Balance Process' },
];

async function main() {
    const project = await prisma.project.upsert({
        where: { slug: 'finance-course' },
        update: { name: 'Finance Course', isActive: true },
        create: {
            name: 'Finance Course',
            slug: 'finance-course',
            description: 'Finance course bots',
            isActive: true,
            settings: {},
        },
    });

    for (const bot of bots) {
        await prisma.bot.upsert({
            where: { projectId_slug: { projectId: project.id, slug: bot.slug } },
            update: { name: bot.name, isActive: true },
            create: {
                projectId: project.id,
                name: bot.name,
                slug: bot.slug,
                description: bot.name,
                isActive: true,
                settings: {},
            },
        });
    }

    const botsCount = await prisma.bot.count({ where: { projectId: project.id } });
    console.log(JSON.stringify({ ok: true, projectId: project.id, botsCount }));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
