'use strict';
// Автоматичне створення ШІ-продавця (клона tpl-expert-seller) для експерта, чий онбординг завершено.
// Те саме, що робить scripts/clone-expert-seller.js у режимі спільного бота, але викликається з API (воронка онбордингу,
// кнопка на сторінці «ШІ-продавці»). Рішення власника 24.10: поки всі продавці живуть на спільному боті (Ден), окремий бот на експерта потім.
//
// Безпека: клон стартує у статусі, який стоїть у content2 (за замовчуванням «Чернетка»): реальним людям не відповідає,
// доки власник не перемкне статус. Вебхук Telegram не чіпаємо: належить бойовим воронкам Дена. Ідемпотентно: другий виклик
// для того ж експерта повертає наявний клон і нічого не створює.

const path = require('path');

const SHARED_CONNECTOR_ID = process.env.SELLER_SHARED_CONNECTOR_ID || '1cd281cb-1bcc-4210-8f64-1dfca80c0af9'; // Telegram — Ден (den_fineko_bot)
const DEN_WEBHOOK_BOT_ID = process.env.SELLER_SHARED_WEBHOOK_BOT_ID || '3131ff8f-f341-48dd-a1aa-a3cf816185cd'; // воронка, якій належить вебхук цього бота
const TEMPLATE_SLUG = 'tpl-expert-seller';

const TR = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'e', ъ: '' };
function slugify(s) {
    return String(s || '').toLowerCase().split('').map((ch) => (TR[ch] !== undefined ? TR[ch] : ch)).join('')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

async function c2Creds(db) {
    const onboard = await db.bot.findFirst({ where: { slug: 'onboard' }, select: { id: true } });
    const rows = onboard ? await db.funnelKey.findMany({ where: { botId: onboard.id, key: { in: ['CONTENT2_URL', 'CONTENT2_WEBHOOK_SECRET'] } }, select: { key: true, value: true } }) : [];
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!m.CONTENT2_URL || !m.CONTENT2_WEBHOOK_SECRET) throw new Error('у воронці onboard нема CONTENT2_URL / CONTENT2_WEBHOOK_SECRET');
    return { url: String(m.CONTENT2_URL).replace(/\/$/, ''), secret: m.CONTENT2_WEBHOOK_SECRET };
}

async function c2Post(c2, route, body, fetchImpl) {
    const res = await fetchImpl(c2.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': c2.secret }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) throw new Error(route + ': ' + (j.error || 'HTTP ' + res.status));
    return j;
}

/** Клон експерта, якщо вже є: { botId, slug, link, status? } */
async function findClone(db, projectId) {
    const k = await db.funnelKey.findFirst({ where: { key: 'EXPERT_PROJECT_ID', value: projectId }, select: { botId: true } });
    if (!k) return null;
    const bot = await db.bot.findUnique({ where: { id: k.botId }, select: { id: true, slug: true } });
    if (!bot || bot.slug === TEMPLATE_SLUG) return null;
    const un = await db.funnelKey.findFirst({ where: { botId: bot.id, key: 'TELEGRAM_BOT_USERNAME' }, select: { value: true } });
    return { botId: bot.id, slug: bot.slug, link: un ? 'https://t.me/' + un.value + '?start=' + bot.slug : '' };
}

async function provisionSeller({ db, callTool, projectId, fetchImpl = fetch }) {
    projectId = String(projectId || '').trim();
    if (!/^[a-z0-9]{10,40}$/i.test(projectId)) throw new Error('некоректний projectId');
    const existing = await findClone(db, projectId);
    const c2 = await c2Creds(db);
    if (existing) {
        const brief0 = await c2Post(c2, '/api/webhooks/seller-brief', { projectId }, fetchImpl).catch(() => ({}));
        return { ok: true, created: false, ...existing, status: brief0.status || '' };
    }

    const brief = await c2Post(c2, '/api/webhooks/seller-brief', { projectId }, fetchImpl);
    const tpl = await db.bot.findFirst({ where: { slug: TEMPLATE_SLUG } });
    if (!tpl) throw new Error('шаблон ' + TEMPLATE_SLUG + ' не знайдено');
    const fd = await db.flowDefinition.findUnique({ where: { botId: tpl.id } });
    const { TEMPLATE_VERSION, validateFlow } = require(path.join(__dirname, '../../../../scripts/tpl-expert-seller/flow.js'));
    const errs = validateFlow({ nodes: fd.nodes, edges: fd.edges });
    if (errs.length) throw new Error('граф шаблону невалідний: ' + errs.join('; '));

    const conn = await db.savedConnector.findFirst({ where: { id: SHARED_CONNECTOR_ID, type: 'telegram_bot', isActive: true } });
    if (!conn) throw new Error('спільний Telegram-конектор не знайдено');
    const username = (conn.config || {}).username;
    if (!username) throw new Error('у спільного конектора нема username');
    const denBot = await db.bot.findUnique({ where: { id: DEN_WEBHOOK_BOT_ID }, select: { project: { select: { slug: true } } } });
    const projectSlug = denBot && denBot.project && denBot.project.slug;
    if (!projectSlug) throw new Error('не знайдено проєкт воронки з вебхуком спільного бота');

    const base = 'sell-' + (slugify(brief.projectName) || projectId.slice(-6));
    let slug = base; let n = 1;
    while (await db.bot.findFirst({ where: { slug } })) slug = base + '-' + (++n);

    await callTool('new_bot', {
        projectSlug, name: 'Продавець — ' + brief.projectName, slug, trigger: '/start ' + slug, isActive: true,
        description: 'ШІ-продавець експерта ' + brief.projectName + ' (клон шаблону tpl-expert-seller). Бере бриф із content2, веде розмову з лідами, пропонує запис, передає гарячих експерту.',
        goal: 'Довести людину, якій підходить послуга експерта, до запису на консультацію, не вигадуючи фактів; гарячих лідів передавати експерту.',
    });
    const bot = await db.bot.findFirst({ where: { slug } });
    const nodes = fd.nodes.map((nd) => (nd.type === 'start' ? { ...nd, data: { ...nd.data, trigger: '/start ' + slug } } : nd));
    await db.flowDefinition.update({ where: { botId: bot.id }, data: { nodes, edges: fd.edges } });

    const key = (k, value, label, isSecret = false) => callTool('update_funnel_key', { botId: bot.id, key: k, value: String(value), label, isSecret });
    const claude = await db.funnelKey.findFirst({ where: { botId: tpl.id, key: 'CLAUDE_CONNECTOR_ID' } });
    const admin = await db.funnelKey.findFirst({ where: { botId: tpl.id, key: 'ADMIN_TELEGRAM_ID' } });
    await key('TELEGRAM_CONNECTOR_ID', conn.id, 'Telegram-бот експерта');
    await key('TELEGRAM_BOT_USERNAME', username, 'Telegram Bot Username');
    await key('EXPERT_PROJECT_ID', projectId, 'Проєкт експерта в content2');
    await key('CONTENT2_URL', c2.url, 'Content2 (бриф експерта)');
    await key('CONTENT2_WEBHOOK_SECRET', c2.secret, 'Content2 webhook-секрет', true);
    await key('CLAUDE_CONNECTOR_ID', claude ? claude.value : '2ec53ba5-144e-463b-9758-c217c4a69b0e', 'Claude Sonnet для воронок');
    await key('ADMIN_TELEGRAM_ID', admin ? admin.value : '345126254', 'Власник платформи: алерти про збої');
    await key('HANDOFF_TELEGRAM_ID', (brief.expert && brief.expert.handoffTelegramId) || (admin ? admin.value : '345126254'), 'Кому слати гарячих лідів (Telegram експерта)');
    await key('TEMPLATE_VERSION', TEMPLATE_VERSION, 'Версія шаблону');

    await c2Post(c2, '/api/webhooks/seller-config', { projectId, funnelBotId: bot.id, templateVersion: TEMPLATE_VERSION }, fetchImpl);
    return { ok: true, created: true, botId: bot.id, slug, link: 'https://t.me/' + username + '?start=' + slug, status: brief.status || 'draft', ready: !!(brief.readiness && brief.readiness.ready), missing: (brief.readiness && brief.readiness.missing) || [] };
}

module.exports = { provisionSeller, findClone, slugify };
