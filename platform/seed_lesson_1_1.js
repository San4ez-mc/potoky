const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    // Create or get project
    const project = await prisma.project.upsert({
        where: { slug: 'finance-course' },
        update: { isActive: true },
        create: {
            name: 'Finance Course',
            slug: 'finance-course',
            description: 'Finance course with onboarding',
            isActive: true,
            settings: {},
        },
    });

    // Create lesson 1.1 onboarding bot
    const bot = await prisma.bot.upsert({
        where: { projectId_slug: { projectId: project.id, slug: 'bot-1-1-onboarding' } },
        update: { name: 'Bot 1.1 Onboarding', isActive: true },
        create: {
            projectId: project.id,
            name: 'Bot 1.1 Onboarding',
            slug: 'bot-1-1-onboarding',
            description: 'First lesson - user onboarding and data collection',
            isActive: true,
            settings: {
                type: 'telegram',
                channels: ['telegram'],
            },
        },
    });

    // Create flow definition with nodes - matching existing bot structure
    const nodes = [
        {
            id: 'start_onboarding',
            type: 'start',
            data: {
                label: 'Start Lesson 1.1',
                trigger: '/start lesson_1_1'
            },
            position: { x: 80, y: 80 },
        },
        {
            id: 'msg_greeting',
            type: 'message',
            data: {
                label: 'Привіт! 👋',
                text: 'Привіт! 👋\n\nДобро пожалувати до курсу фінансового управління.\n\nДокупи розберемось як керувати фінансами бізнесу.\n\nСпершу мені потрібна інформація про вас.'
            },
            position: { x: 80, y: 240 },
        },
        {
            id: 'msg_ask_name',
            type: 'message',
            data: {
                label: 'Як до вас звертатись?',
                text: 'Як до вас звертатись? (Введіть ваше ім\'я)'
            },
            position: { x: 80, y: 420 },
        },
        {
            id: 'msg_ask_role',
            type: 'message',
            data: {
                label: 'Яку роль ви виконуєте?',
                text: 'Яку роль ви виконуєте в компанії?\n\nНаприклад: Власник, CFO, Бухгалтер, Менеджер'
            },
            position: { x: 80, y: 600 },
        },
        {
            id: 'msg_ask_company',
            type: 'message',
            data: {
                label: 'Що робит ваша компанія?',
                text: 'Що робить ваша компанія? Яка область діяльності?'
            },
            position: { x: 80, y: 780 },
        },
        {
            id: 'msg_ask_problem',
            type: 'message',
            data: {
                label: 'Яка головна проблема?',
                text: 'Яка ваша найбільша проблема з фінансами?\n\nНаприклад: Кассові розриви, Непередбачені витрати, Низькі продажи'
            },
            position: { x: 80, y: 960 },
        },
        {
            id: 'save_user_data',
            type: 'saveFile',
            data: {
                label: 'Зберегти дані користувача',
                fileType: 'user_onboarding_data',
                contentVar: 'context.userData'
            },
            position: { x: 80, y: 1140 },
        },
        {
            id: 'msg_complete',
            type: 'message',
            data: {
                label: 'Завершення',
                text: '✅ Дякую! Ваші дані збережені.\n\nТеперь приступаємо до дослідження фінансової системи компанії.\n\nНаступний урок розпочнеться на уроку 1.2'
            },
            position: { x: 80, y: 1320 },
        },
    ];

    const edges = [
        { id: 'e-start-greeting', source: 'start_onboarding', target: 'msg_greeting' },
        { id: 'e-greeting-name', source: 'msg_greeting', target: 'msg_ask_name' },
        { id: 'e-name-role', source: 'msg_ask_name', target: 'msg_ask_role' },
        { id: 'e-role-company', source: 'msg_ask_role', target: 'msg_ask_company' },
        { id: 'e-company-problem', source: 'msg_ask_company', target: 'msg_ask_problem' },
        { id: 'e-problem-save', source: 'msg_ask_problem', target: 'save_user_data' },
        { id: 'e-save-complete', source: 'save_user_data', target: 'msg_complete' },
    ];

    // Create or update flow definition
    const flowDef = await prisma.flowDefinition.upsert({
        where: { botId: bot.id },
        update: {
            nodes: nodes,
            edges: edges,
        },
        create: {
            botId: bot.id,
            nodes: nodes,
            edges: edges,
            viewport: { x: 0, y: 0, zoom: 1 },
        },
    });

    console.log(
        JSON.stringify({
            ok: true,
            project: { id: project.id, slug: project.slug },
            bot: { id: bot.id, slug: bot.slug },
            flowDef: { id: flowDef.id, nodesCount: nodes.length },
        }, null, 2)
    );
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
