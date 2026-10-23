'use strict';
// Клонування ШІ-продавця під експерта + оновлення всіх клонів з шаблону. Запуск НА СЕРВЕРІ з кореня platform/ (параметри лише через env, токен не потрапляє в аргументи/лог):
//
//   Новий клон:     EXPERT_PROJECT_ID=<id проєкту в content2> EXPERT_BOT_TOKEN=<токен з BotFather> [SELLER_SLUG=seller-x] [DRY_RUN=1] \
//                   PLATFORM_ROOT=$PWD node scripts/clone-expert-seller.js
//   Оновити всі:    REFRESH_ALL=1 [DRY_RUN=1] PLATFORM_ROOT=$PWD node scripts/clone-expert-seller.js
//
// Що робить клон: перевіряє токен (Telegram getMe), бере бриф у content2, створює збережений Telegram-конектор і воронку «Продавець — <експерт>»
// у проєкті «Продавці експертів» з графом шаблону (tpl-expert-seller), ставить ключі, реєструє вебхук бота ЕКСПЕРТА (його власний токен,
// вебхуки інших ботів не чіпає) і записує привʼязку (funnelBotId, версія шаблону) у налаштування продавця в content2.
// Клон стартує у статусі, який стоїть у налаштуваннях content2 (за замовчуванням draft): реальним людям не відповідає, доки власник не перемкне в «Тест»/«У роботі».
// Оновлення шаблону: REFRESH_ALL переписує граф у всіх клонах; дані, ключі й налаштування експерта не чіпає.

const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');
const { TEMPLATE_VERSION, validateFlow } = require('./tpl-expert-seller/flow.js');

const TEMPLATE_SLUG = 'tpl-expert-seller';
const PROJECT_SLUG = 'expert-sellers';
const DRY = !!process.env.DRY_RUN;
const log = (...a) => console.log(...a);

async function templateFlow() {
    const tpl = await db.bot.findFirst({ where: { slug: TEMPLATE_SLUG } });
    if (!tpl) throw new Error('шаблон ' + TEMPLATE_SLUG + ' не знайдено (спершу build-tpl-expert-seller)');
    const fd = await db.flowDefinition.findUnique({ where: { botId: tpl.id } });
    const flow = { nodes: fd.nodes, edges: fd.edges };
    const errs = validateFlow(flow);
    if (errs.length) throw new Error('граф шаблону невалідний: ' + errs.join('; '));
    return { tpl, flow };
}
const withTrigger = (nodes, slug) => nodes.map((n) => (n.type === 'start' ? { ...n, data: { ...n.data, trigger: '/start ' + slug } } : n));
const key = (botId, k, value, label, isSecret = false) => (DRY ? Promise.resolve() : callTool('update_funnel_key', { botId, key: k, value: String(value), label, isSecret }));

async function c2Keys() {
    const onboard = await db.bot.findFirst({ where: { slug: 'onboard' } });
    const get = async (k) => { const r = onboard && await db.funnelKey.findUnique({ where: { botId_key: { botId: onboard.id, key: k } } }); if (!r || !r.value) throw new Error('у воронці onboard нема ключа ' + k); return r.value; };
    return { url: String(await get('CONTENT2_URL')).replace(/\/$/, ''), secret: await get('CONTENT2_WEBHOOK_SECRET') };
}
async function c2Post(c2, route, body) {
    const res = await fetch(c2.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': c2.secret }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) throw new Error(route + ': ' + (j.error || 'HTTP ' + res.status));
    return j;
}

async function refreshAll() {
    const { flow } = await templateFlow();
    const c2 = await c2Keys();
    const rows = await db.funnelKey.findMany({ where: { key: 'EXPERT_PROJECT_ID' }, select: { botId: true, value: true } });
    log('клонів: ' + rows.length + (DRY ? ' (DRY_RUN: нічого не пишу)' : ''));
    for (const r of rows) {
        const bot = await db.bot.findUnique({ where: { id: r.botId }, select: { id: true, slug: true } });
        if (!bot || bot.slug === TEMPLATE_SLUG) continue;
        log(' • ' + bot.slug + ' → ' + TEMPLATE_VERSION);
        if (DRY) continue;
        await db.flowDefinition.update({ where: { botId: bot.id }, data: { nodes: withTrigger(flow.nodes, bot.slug), edges: flow.edges } });
        await key(bot.id, 'TEMPLATE_VERSION', TEMPLATE_VERSION, 'Версія шаблону');
        await c2Post(c2, '/api/webhooks/seller-config', { projectId: r.value, templateVersion: TEMPLATE_VERSION }).catch((e) => log('   ! content2: ' + e.message));
    }
}

async function cloneOne() {
    const projectId = String(process.env.EXPERT_PROJECT_ID || '').trim();
    const token = String(process.env.EXPERT_BOT_TOKEN || '').trim();
    // Спільний бот (напр. бот Дена): клон живе на УЖЕ ІСНУЮЧОМУ Telegram-конекторі, у проєкті воронки з вебхуком цього бота
    // (слаг /start шукається лише в проєкті воронки з вебхуком), вебхук НЕ реєструється і FUNNEL_CHANNELS НЕ ставиться: інакше перебили б вебхук бойових воронок.
    const sharedConnectorId = String(process.env.SHARED_CONNECTOR_ID || '').trim();
    const sharedProjectSlug = String(process.env.SHARED_PROJECT_SLUG || '').trim();
    const shared = !!sharedConnectorId;
    if (!projectId || (!token && !shared)) throw new Error('потрібні EXPERT_PROJECT_ID і (EXPERT_BOT_TOKEN або SHARED_CONNECTOR_ID + SHARED_PROJECT_SLUG + SELLER_SLUG) через env');
    if (shared && (!sharedProjectSlug || !process.env.SELLER_SLUG)) throw new Error('для спільного бота потрібні SHARED_PROJECT_SLUG і SELLER_SLUG');
    if (!shared && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('EXPERT_BOT_TOKEN має вигляд 123456:ABC… (токен з BotFather)');

    const { flow } = await templateFlow();
    const c2 = await c2Keys();
    const brief = await c2Post(c2, '/api/webhooks/seller-brief', { projectId });
    let username;
    let sharedConn = null;
    if (shared) {
        sharedConn = await db.savedConnector.findFirst({ where: { id: sharedConnectorId, type: 'telegram_bot', isActive: true } });
        if (!sharedConn) throw new Error('спільний Telegram-конектор ' + sharedConnectorId + ' не знайдено');
        username = (sharedConn.config || {}).username;
        if (!username) throw new Error('у спільного конектора нема username');
    } else {
        const me = await (await fetch('https://api.telegram.org/bot' + token + '/getMe')).json();
        if (!me.ok) throw new Error('Telegram не прийняв токен: ' + (me.description || 'getMe failed'));
        username = me.result.username;
    }

    const base = String(process.env.SELLER_SLUG || '').trim() || 'seller-' + String(username || projectId).toLowerCase().replace(/_?bot$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let slug = base; let n = 1;
    const existing = await db.bot.findFirst({ where: { slug } });
    if (existing) {
        const k = await db.funnelKey.findUnique({ where: { botId_key: { botId: existing.id, key: 'EXPERT_PROJECT_ID' } } });
        if (k && k.value === projectId) throw new Error('для цього експерта клон уже є (' + slug + '); щоб оновити з шаблону, запусти REFRESH_ALL=1');
        while (await db.bot.findFirst({ where: { slug: base + '-' + (++n) } })) { /* шукаємо вільний слаг */ }
        slug = base + '-' + n;
    }
    log('Експерт: ' + brief.projectName + ' | бот @' + username + ' | слаг ' + slug + ' | режим ' + brief.mode + ' | статус у content2: ' + brief.status);
    log('Готовність: ' + (brief.readiness.ready ? 'готово' : 'бракує: ' + brief.readiness.missing.join('; ')));
    if (!brief.expert.handoffTelegramId) log('УВАГА: не задано Telegram ID для лідів (HANDOFF_TELEGRAM_ID порожній, сповіщення йтимуть нікуди)');
    if (DRY) { log('DRY_RUN: далі створив би конектор, воронку (' + flow.nodes.length + ' нод), ключі, вебхук і запис у content2'); return; }

    const targetProjectSlug = shared ? sharedProjectSlug : PROJECT_SLUG;
    if (shared) { if (!(await db.project.findFirst({ where: { slug: targetProjectSlug } }))) throw new Error('проєкт ' + targetProjectSlug + ' не знайдено'); }
    else if (!(await db.project.findFirst({ where: { slug: PROJECT_SLUG } }))) await callTool('create_project', { name: 'Продавці експертів', slug: PROJECT_SLUG, description: 'Клони ШІ-продавця (tpl-expert-seller) по одному на експерта' });
    const conn = shared ? sharedConn : await db.savedConnector.create({ data: { name: 'Telegram — продавець ' + brief.projectName, type: 'telegram_bot', description: 'Бот експерта ' + brief.projectName, config: { token, api_key: token, username }, isActive: true } });
    await callTool('new_bot', {
        projectSlug: targetProjectSlug, name: 'Продавець — ' + brief.projectName, slug, trigger: '/start ' + slug, isActive: true,
        description: 'ШІ-продавець експерта ' + brief.projectName + ' (клон шаблону tpl-expert-seller). Бере бриф із content2, веде розмову з лідами, пропонує запис, передає гарячих експерту.',
        goal: 'Довести людину, якій підходить послуга експерта, до запису на консультацію, не вигадуючи фактів; гарячих лідів передавати експерту.',
    });
    const bot = await db.bot.findFirst({ where: { slug } });
    await db.flowDefinition.update({ where: { botId: bot.id }, data: { nodes: withTrigger(flow.nodes, slug), edges: flow.edges } });

    const claude = await db.funnelKey.findFirst({ where: { bot: { slug: TEMPLATE_SLUG }, key: 'CLAUDE_CONNECTOR_ID' } });
    const admin = await db.funnelKey.findFirst({ where: { bot: { slug: TEMPLATE_SLUG }, key: 'ADMIN_TELEGRAM_ID' } });
    await key(bot.id, 'TELEGRAM_CONNECTOR_ID', conn.id, 'Telegram-бот експерта');
    await key(bot.id, 'TELEGRAM_BOT_USERNAME', username, 'Telegram Bot Username');
    if (!shared) await key(bot.id, 'FUNNEL_CHANNELS', JSON.stringify(['telegram']), 'Канали запуску воронки');
    await key(bot.id, 'EXPERT_PROJECT_ID', projectId, 'Проєкт експерта в content2');
    await key(bot.id, 'CONTENT2_URL', c2.url, 'Content2 (бриф експерта)');
    await key(bot.id, 'CONTENT2_WEBHOOK_SECRET', c2.secret, 'Content2 webhook-секрет', true);
    await key(bot.id, 'CLAUDE_CONNECTOR_ID', claude ? claude.value : '2ec53ba5-144e-463b-9758-c217c4a69b0e', 'Claude Sonnet для воронок');
    await key(bot.id, 'ADMIN_TELEGRAM_ID', admin ? admin.value : '345126254', 'Власник платформи: алерти про збої');
    await key(bot.id, 'HANDOFF_TELEGRAM_ID', brief.expert.handoffTelegramId || (admin ? admin.value : '345126254'), 'Кому слати гарячих лідів (Telegram експерта)');
    await key(bot.id, 'TEMPLATE_VERSION', TEMPLATE_VERSION, 'Версія шаблону');

    // вебхук саме цього бота (його власний токен): не перехоплює жодного чужого бота
    if (shared) log('вебхук: НЕ чіпаю (спільний бот @' + username + ', вебхук належить іншій воронці)');
    else {
        const { syncChannelsForBot } = require(path.join(ROOT, 'apps/api/src/services/channelSync.js'));
        const sync = await syncChannelsForBot(bot.id);
        log('вебхук: ' + (sync.ok ? 'зареєстровано' : 'ПОМИЛКА ' + JSON.stringify(sync.telegram || sync)));
    }

    await c2Post(c2, '/api/webhooks/seller-config', { projectId, funnelBotId: bot.id, templateVersion: TEMPLATE_VERSION });
    log(JSON.stringify({ ok: true, botId: bot.id, slug, bot: '@' + username, link: shared ? 'https://t.me/' + username + '?start=' + slug : 'https://t.me/' + username, nextSteps: [
        'Експерт відкриває ' + (shared ? 'посилання вище' : 't.me/' + username) + ' і натискає Start (інакше сповіщення від бота йому не дійдуть)',
        'У content2 → «Продавець»: перевірити готовність, додати Telegram ID тестерів, статус «Тест», пройти розмову, потім «У роботі»',
    ] }, null, 2));
}

(process.env.REFRESH_ALL ? refreshAll() : cloneOne()).then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
