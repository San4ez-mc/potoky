'use strict';

const { PrismaClient } = require('./node_modules/@prisma/client');
const db = new PrismaClient();
const BOT_ID = '7e713383-336a-42d3-bfed-3f49af436836';

async function main() {
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    const nodes = [...flow.nodes];
    const edges = [...flow.edges];

    // ── Fix CTA buttons: add callback_data ──────────────────────────────────
    const ctaNode = nodes.find(n => n.id === 'node_1779990879114');
    if (ctaNode) {
        ctaNode.data = {
            ...ctaNode.data,
            buttons: [
                [
                    { text: '📞 Хочу демо-дзвінок', callback_data: 'cta:demo' },
                    { text: '💻 Хочу потестувати', callback_data: 'cta:test' },
                ],
                [
                    { text: '❓ Більше питань', callback_data: 'cta:questions' },
                ],
            ],
        };
        console.log('Fixed CTA buttons');
    }

    // ── Add final conversion cycle ───────────────────────────────────────────
    const newNodes = [
        {
            id: 'node_final_claude',
            type: 'claude',
            position: { x: 3200, y: 800 },
            data: {
                mode: 'dialog',
                label: 'Фінальна конверсія',
                model: '{{env.AI_MODEL}}',
                outputVar: 'context.final_lead',
                connectorId: '{{env.AI_CONNECTOR_ID}}',
                systemPrompt: [
                    'Ти — Олександр Мацук, автор Task Tracker. Пишеш людині після 2 тижнів прогріву.',
                    '',
                    'АЛГОРИТМ',
                    '1. Скажи що бачиш інтерес і хочеш зрозуміти чи є сенс поговорити.',
                    '2. Якщо людина готова — дізнайся: ім\'я, скільки людей у команді, зручний контакт.',
                    '3. Якщо "не зараз" — скажи що завжди доступний і залиш контакти.',
                    '4. Збережи в JSON: { "name": "", "team_size": "", "contact": "", "intent": "" }',
                    '',
                    'КОНТАКТИ',
                    'Telegram: @olexandrmatsuk | Instagram: @matsukoleksandr',
                ].join('\n'),
                exitCondition: 'GAVE_CONTACT || SAID_LATER',
                maxTurns: 5,
            },
        },
        {
            id: 'node_final_notify',
            type: 'notifyAdmin',
            position: { x: 3500, y: 800 },
            data: {
                label: 'Фінальна заявка (сиквенс)',
                message: '💼 Фінальна заявка Task Tracker\n\nІм\'я: {{context.final_lead.name}}\nКоманда: {{context.final_lead.team_size}} осіб\nКонтакт: {{context.final_lead.contact}}\nІнтенція: {{context.final_lead.intent}}\n\nTelegram: {{user.telegramId}}',
                targetKey: 'ADMIN_TELEGRAM_ID',
            },
        },
        {
            id: 'node_final_close',
            type: 'message',
            position: { x: 3800, y: 800 },
            data: {
                label: 'Закриття сиквенсу',
                text: 'Дякую! ✌️\n\nОлександр зв\'яжеться з тобою найближчим часом.\n\nА поки можеш подивитись більше про Task Tracker:\n📸 Instagram: @matsukoleksandr\n✈️ Telegram: @olexandrmatsuk',
            },
        },
    ];

    const newEdges = [
        { id: 'edge_final_1', source: 'node_1779991655004', target: 'node_final_claude' },
        { id: 'edge_final_2', source: 'node_final_claude', target: 'node_final_notify' },
        { id: 'edge_final_3', source: 'node_final_notify', target: 'node_final_close' },
    ];

    // Check for duplicates
    const existingIds = new Set(nodes.map(n => n.id));
    for (const n of newNodes) {
        if (!existingIds.has(n.id)) {
            nodes.push(n);
            console.log('Added node:', n.id, n.type);
        }
    }

    const existingEdgeIds = new Set(edges.map(e => e.id));
    for (const e of newEdges) {
        if (!existingEdgeIds.has(e.id)) {
            edges.push(e);
            console.log('Added edge:', e.id, e.source, '->', e.target);
        }
    }

    await db.flowDefinition.update({
        where: { botId: BOT_ID },
        data: { nodes, edges },
    });

    console.log('Done! Total nodes:', nodes.length, '| edges:', edges.length);
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e.message); process.exit(1); })
    .finally(() => db.$disconnect());
