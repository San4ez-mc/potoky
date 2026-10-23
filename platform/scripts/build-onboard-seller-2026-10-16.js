'use strict';
// Воронка «Онбординг експерта (ШІ-продавець)» (slug onboard-seller, проєкт content-platform-sales).
// Spec: Контент платформа/документація/ОНБОРДИНГ_експерта_питання_v2.md (19 питань, 11 критичних полів, картка запуску).
// Агент веде адаптивний діалог → пише досьє через /api/seller-dossier (таблиця files, нічого не пише в content2 до «ок» власника)
// → js-нода збирає «Картку запуску» → notifyTg шле її власнику → експерту фінальне повідомлення.
// Джерела істини: scripts/onboard-seller/system-prompt.md, scripts/onboard-seller/card-node-code.js. Ідемпотентний.
// Запуск на сервері:  node scripts/build-onboard-seller-2026-10-16.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

const SLUG = 'onboard-seller';
const PROJECT_SLUG = 'content-platform-sales';
// 2026-10-19: онбординг живе на боті Дена (@den_fineko_bot, вебхук належить bot-sales-automation 3131ff8f).
// Маршрут /start <слаг> шукає воронку ЛИШЕ в проєкті воронки з вебхуком, тому onboard-seller перенесено в її проєкт
// (/autonatisations_sales). FUNNEL_CHANNELS цій воронці НЕ ставимо: інакше channelSync перебʼє вебхук Дена.
const TELEGRAM_CONNECTOR_ID = '1cd281cb-1bcc-4210-8f64-1dfca80c0af9';
const DEN_WEBHOOK_BOT_ID = '3131ff8f-f341-48dd-a1aa-a3cf816185cd';
const CLAUDE_CONNECTOR_ID = '4f9fbe29-e85a-40dd-93ed-4ed1b5f9fba6';
const ADMIN_TELEGRAM_ID = '345126254';
const read = (f) => fs.readFileSync(path.join(__dirname, 'onboard-seller', f), 'utf8');

const QA_AGENT =
    'Агент онбордингу експерта: українською на «ти», 2-4 речення, одне питання за повідомлення з прикладом; матеріали питає рівно раз; ' +
    'НЕ перепитує вже закрите; на розмиту відповідь просить одне конкретне уточнення; ніколи не вигадує ціни, кейси, цифри, результати; ' +
    'ціну, оплату, повернення й обіцянки з сайту завжди перепитує; НЕ показує експерту коди K1-K11, слова «статус», «архетип», «SPIN»; ' +
    'не просить і не записує токени, паролі, ключі; щоразу записує нове у досьє (set_fields) до відповіді.';

const SECRET_HDR = { 'X-Search-Secret': '{{env.SEARCH_SECRET}}' };
const dossierTool = (name, route, description, schema) => ({
    name, description, method: 'POST', headers: SECRET_HDR,
    url: '{{env.SELLER_DOSSIER_URL}}/' + route + '?sessionId={{session.id}}',
    inputSchema: schema || { type: 'object', properties: {} },
});

const FIELD_ITEM = {
    type: 'object', required: ['id', 'status'],
    properties: {
        id: { type: 'string', description: 'K1…K11 (критичні), O3/O4/O10/O11/O12/O13/O15/O16/O19 (додаткові), T1/T2 (технічні)' },
        status: { type: 'string', description: 'confirmed | from_materials | conflict | not_applicable | missing' },
        value: { type: 'string', description: 'що записано, 1-3 речення' },
        source: { type: 'string', description: 'expert | site | file | chat_logs | default | agent_draft' },
        quote: { type: 'string', description: 'ДОСЛІВНІ слова експерта (обовʼязково для confirmed і not_applicable)' },
        conflict: { type: 'string', description: 'у чому суперечність між джерелами' },
        note: { type: 'string', description: 'пояснення (обовʼязково для not_applicable)' },
    },
};

function tools() {
    return [
        dossierTool('get_dossier', 'get', 'Поточний стан досьє: що закрито (✅), що з матеріалів (🟡), чого бракує, типові тексти для K9/K10. Викликай на початку й коли треба звіритись.'),
        dossierTool('set_fields', 'set-many',
            'Записати поля досьє (одне чи кілька). Відповідь без ok:true — виправ виклик і повтори, не кажи експерту «записав». confirmed лише з quote (дослівні слова експерта). Дані з сайту/файлів/переписок — from_materials.',
            { type: 'object', required: ['fields'], properties: {
                fields: { type: 'array', items: FIELD_ITEM },
                materials: { type: 'array', description: 'що експерт надіслав: [{kind: site|file|chat_logs|voice|text, ref: назва чи посилання}]', items: { type: 'object' } },
            } }),
        dossierTool('confirm_all', 'confirm-all',
            'Експерт підтвердив усю картку («усе вірно»): усі 🟡 стають ✅, крім K4 і K9 (їх підтверджують окремо). quote — його дослівні слова підтвердження.',
            { type: 'object', required: ['quote'], properties: { quote: { type: 'string' } } }),
        dossierTool('expert_card', 'expert-card', 'Картка «ось що я зрозумів» простою мовою для експерта + що ще бракує (stillNeeded). Показуй її наприкінці.'),
        {
            name: 'fetch_page', description: 'Відкрити сторінку за URL (сайт, соцмережа експерта) і повернути її текст. JS-важкі сторінки можуть бути порожніми — тоді попроси вставити текст.',
            method: 'POST', headers: SECRET_HDR, url: '{{env.FETCH_PAGE_URL}}',
            inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, maxChars: { type: 'number' } } },
        },
        {
            name: 'finish_onboarding',
            description: 'Завершити онбординг: усі критичні поля закриті АБО експерт хоче зупинитись (тоді картка піде власнику з відміткою «не готово»).',
            inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'одне речення: що зібрано і чого бракує' } } },
        },
    ];
}

async function ensureNode(botId, existing, label, type, position, data) {
    const found = existing.find((n) => n.data && n.data.label === label);
    if (found) { await callTool('update_node', { botId, nodeId: found.id, data }); return found.id; }
    const r = await callTool('add_node', { botId, type, position, data: { label, ...data } });
    return r.added.id;
}

async function main() {
    let bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) {
        await callTool('new_bot', {
            projectSlug: PROJECT_SLUG, name: 'Онбординг експерта (ШІ-продавець)', slug: SLUG,
            description: 'Адаптивний онбординг експерта-консультанта для ШІ-продавця його консультацій: приймає матеріали (сайт, файли, переписки, голосові), сам розкладає їх по полях, питає лише недостатнє, збирає «Картку запуску» з 11 критичних полів і статусами підтвердження й надсилає її власнику.',
            goal: 'Отримати від експерта достатнє й підтверджене досьє для налаштування ШІ-продавця, мінімізуючи його зусилля; власник за 2-3 хвилини бачить, чи готово до запуску.',
            trigger: '/start ' + SLUG, isActive: true,
        });
        bot = await db.bot.findFirst({ where: { slug: SLUG } });
        console.log('bot created', bot.id);
    }
    const botId = bot.id;
    // слаг-маршрутизація працює лише в проєкті бота з вебхуком Дена — тримаємо воронку там
    const den = await db.bot.findUnique({ where: { id: DEN_WEBHOOK_BOT_ID }, select: { projectId: true } });
    if (den && bot.projectId !== den.projectId) await db.bot.update({ where: { id: botId }, data: { projectId: den.projectId } });

    const keys = [
        ['CLAUDE_CONNECTOR_ID', CLAUDE_CONNECTOR_ID, 'Claude для контент-платформи', false],
        ['TELEGRAM_CONNECTOR_ID', TELEGRAM_CONNECTOR_ID, 'Telegram — Ден (den_fineko_bot)', false],
        ['TELEGRAM_BOT_USERNAME', 'den_fineko_bot', 'Telegram Bot Username', false],
        ['ADMIN_TELEGRAM_ID', ADMIN_TELEGRAM_ID, 'Кому слати картку запуску (власник)', false],
        ['SELLER_DOSSIER_URL', 'http://127.0.0.1:3000/api/seller-dossier', 'Сховище досьє експерта (Flows API)', false],
        ['FETCH_PAGE_URL', 'http://127.0.0.1:3000/api/websearch/page', 'Роут читання сторінки в текст', false],
    ];
    if (process.env.SEARCH_SECRET) keys.push(['SEARCH_SECRET', process.env.SEARCH_SECRET, 'Секрет роутів пошуку/досьє у Flows', true]);
    else console.warn('SEARCH_SECRET відсутній у .env: інструменти працюватимуть лише якщо секрет не вимагається');
    for (const [key, value, label, isSecret] of keys) await callTool('update_funnel_key', { botId, key, value, label, isSecret });

    let f = await callTool('get_funnel', { botId });
    if (f.nodes.some((n) => n.id === 'msg_intro')) { await callTool('delete_node', { botId, nodeId: 'msg_intro' }); f = await callTool('get_funnel', { botId }); }
    const start = f.nodes.find((n) => n.type === 'start');
    await callTool('update_node', { botId, nodeId: start.id, data: { label: 'Старт /start ' + SLUG, trigger: '/start ' + SLUG } });

    // з 2026-10-22 до промпту додається розділ про режими розмови (edit-mode-prompt.md), а граф має режими й умову:
    // коли воронка вже в новому вигляді (є нода «Стан досьє»), цей скрипт оновлює лише тексти й НЕ чіпає ребра.
    const NEW_GRAPH = f.nodes.some((n) => n.data && n.data.label === 'Стан досьє');
    const prompt = read('system-prompt.md').trim() + '\n\n' + read('edit-mode-prompt.md').trim();
    const cardCode = read('card-node-code.js');
    new (Object.getPrototypeOf(async function () {}).constructor)('context', 'user', 'session', 'keys', 'fetch', cardCode); // синтаксис

    const nodes = f.nodes;
    const agentId = await ensureNode(botId, nodes, 'Онбординг-агент експерта', 'agent', { x: 200, y: 160 }, {
        model: 'claude-sonnet-4-6', connectorId: '{{env.CLAUDE_CONNECTOR_ID}}', systemPrompt: prompt, tools: tools(),
        dialogMode: true, finishTool: 'finish_onboarding', outputVar: 'context.sellerResult', maxTokens: 8192, maxIterations: 10,
        startTrigger: 'Режим розмови: {{context.dossierMode}}. Виклич get_dossier, привітайся (імʼя в Telegram: {{user.firstName}}) і дій за правилами цього режиму.',
        messagesTemplate: '{{conversationHistory}}', qaExpectation: QA_AGENT,
    });
    const cardId = await ensureNode(botId, nodes, 'Зібрати картку запуску', 'js', { x: 200, y: 320 }, {
        code: cardCode,
        qaExpectation: 'Після завершення діалогу ownerCardText містить вердикт «Готово до запуску: N/11» або «Не готово» і таблицю K1-K11 зі статусами; помилка збору не валить сесію.',
    });
    const n1 = await ensureNode(botId, nodes, 'Картка запуску власнику', 'notifyTg', { x: 200, y: 460 }, { targetKey: 'ADMIN_TELEGRAM_ID', message: '{{context.ownerCardText}}' });
    const n2 = await ensureNode(botId, nodes, 'Повні відповіді власнику (1)', 'notifyTg', { x: 200, y: 580 }, { targetKey: 'ADMIN_TELEGRAM_ID', message: '{{context.ownerFull1}}' });
    const n3 = await ensureNode(botId, nodes, 'Повні відповіді власнику (2)', 'notifyTg', { x: 200, y: 700 }, { targetKey: 'ADMIN_TELEGRAM_ID', message: '{{context.ownerFull2}}' });
    const doneId = await ensureNode(botId, nodes, 'Експерту: що далі', 'message', { x: 200, y: 820 }, {
        text: 'Дякую! Усе, що ми зібрали, я передав Олександру. Він перегляне картку й напише тобі, що далі: зробимо тестову версію продавця, а ти перевіриш, як він відповідає. Якщо щось згадаєш чи захочеш виправити, просто напиши сюди.',
        qaExpectation: 'Експерт бачить коротке повідомлення про наступні кроки без обіцянок щодо термінів запуску.',
    });

    const f2 = await callTool('get_funnel', { botId });
    const has = (a, b) => f2.edges.some((e) => e.source === a && e.target === b);
    const chain = [start.id, agentId, cardId, n1, n2, n3, doneId];
    if (NEW_GRAPH) console.log('граф з режимами (patch-onboard-seller-edit-2026-10-22): ребра не чіпаю, оновлено лише тексти й ноди');
    else for (let i = 0; i < chain.length - 1; i++) if (!has(chain[i], chain[i + 1])) await callTool('create_edge', { botId, source: chain[i], target: chain[i + 1] });
    try { await callTool('auto_layout', { botId }); } catch (e) { /* косметика */ }
    console.log(JSON.stringify({ ok: true, botId, slug: SLUG, deepLink: 'https://t.me/fineko_content_bot?start=' + SLUG, nodes: chain.length }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
