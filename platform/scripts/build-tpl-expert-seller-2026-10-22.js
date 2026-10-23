'use strict';
// Створює/оновлює воронку-ШАБЛОН «ШІ-продавець експерта» (slug tpl-expert-seller). Ідемпотентний. Граф живе в tpl-expert-seller/flow.js.
// Запуск на сервері з кореня platform/ (PLATFORM_ROOT=$PWD node scripts/build-tpl-expert-seller-2026-10-22.js)
// Шаблон сам не відповідає реальним людям: у нього нема Telegram-конектора; клони робить clone-expert-seller.js.

const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');
const { TEMPLATE_VERSION, buildFlow, validateFlow } = require('./tpl-expert-seller/flow.js');

const SLUG = 'tpl-expert-seller';
const PROJECT_SLUG = 'content-platform-sales';
const CLAUDE_CONNECTOR_ID = '2ec53ba5-144e-463b-9758-c217c4a69b0e'; // Claude Sonnet для воронок
const OWNER_TG = '345126254';

async function key(botId, k, value, label, isSecret = false) { await callTool('update_funnel_key', { botId, key: k, value, label, isSecret }); }

async function main() {
    const flow = buildFlow();
    const errs = validateFlow(flow);
    if (errs.length) throw new Error('граф шаблону невалідний:\n' + errs.join('\n'));

    let bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) {
        await callTool('new_bot', {
            projectSlug: PROJECT_SLUG, name: 'Шаблон: ШІ-продавець експерта', slug: SLUG, trigger: '/start ' + SLUG, isActive: true,
            description: 'ШАБЛОН воронки ШІ-продавця експерта. Нічого не знає про конкретного експерта: на початку розмови бере бриф (послуга, ціна, кейси, правила, тексти) з content2, перевіряє, чи можна цій людині говорити з продавцем, веде коротку розмову, пропонує запис (або запис з оплатою), передає гарячого ліда експерту. Не запускати як є: клонується скриптом clone-expert-seller.js.',
            goal: 'Довести людину, якій підходить послуга експерта, до запису на консультацію (або оплати вперед), не вигадуючи фактів про експерта; гарячих лідів і складні запити передавати експерту.',
        });
        bot = await db.bot.findFirst({ where: { slug: SLUG } });
        console.log('шаблон створено', bot.id);
    }
    await db.flowDefinition.update({ where: { botId: bot.id }, data: { nodes: flow.nodes, edges: flow.edges } });

    await key(bot.id, 'TEMPLATE_VERSION', TEMPLATE_VERSION, 'Версія шаблону');
    await key(bot.id, 'CLAUDE_CONNECTOR_ID', CLAUDE_CONNECTOR_ID, 'Claude Sonnet для воронок');
    await key(bot.id, 'ADMIN_TELEGRAM_ID', OWNER_TG, 'Власник: алерти про збої');
    await key(bot.id, 'HANDOFF_TELEGRAM_ID', OWNER_TG, 'Кому слати гарячих лідів (у клоні: Telegram експерта)');
    const onboard = await db.bot.findFirst({ where: { slug: 'onboard' } });
    for (const k of ['CONTENT2_URL', 'CONTENT2_WEBHOOK_SECRET']) {
        const row = onboard && await db.funnelKey.findUnique({ where: { botId_key: { botId: onboard.id, key: k } } });
        if (row && row.value) await key(bot.id, k, row.value, k === 'CONTENT2_URL' ? 'Content2 (бриф експерта)' : 'Content2 webhook-секрет', k === 'CONTENT2_WEBHOOK_SECRET');
    }
    console.log(JSON.stringify({ ok: true, botId: bot.id, slug: SLUG, version: TEMPLATE_VERSION, nodes: flow.nodes.length, edges: flow.edges.length }));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
