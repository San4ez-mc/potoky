'use strict';
// «Ден — Карта автоматизації + Продаж» (bot-karta-sales): ціна консультації 2500 → 1500 грн (ключі, промпт діалогу, текст
// фінального follow-up, опис воронки) + бічний етап «Мовчав 24 год» для статистики конверсії (основні 6 етапів вже розставлені 27.10).
// Ідемпотентний. Запуск з кореня platform/:  PLATFORM_ROOT=$PWD node scripts/patch-karta-price-1500-2026-11-03.js  (DRY_RUN=1 — лише показати)
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const DRY = !!process.env.DRY_RUN;
const SLUG = 'bot-karta-sales';
const OLD = /2500(\s*грн)/g;

(async () => {
    const bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) throw new Error('воронка ' + SLUG + ' не знайдена');
    const botId = bot.id;
    let f = await callTool('get_funnel', { botId });
    console.log('ключі воронки беруться з:', JSON.stringify(f.keySource));

    // 1) ключі
    for (const [key, value] of [['CONSULT_PRICE', '1500 грн'], ['CONSULT_PRICE_INT', '1500']]) {
        const cur = (f.keys || []).find((k) => k.key === key);
        if (cur && cur.value === value) { console.log('  =', key, 'вже', value); continue; }
        console.log('  ✔', key, ':', cur && cur.value, '→', value);
        if (!DRY) await callTool('update_funnel_key', { botId, key, value, label: cur && cur.label || undefined });
    }

    // 2) тексти нод (рядкові поля data, де лишилось «2500 грн»)
    for (const n of f.nodes || []) {
        const upd = {};
        for (const [k, v] of Object.entries(n.data || {})) if (typeof v === 'string' && OLD.test(v)) { OLD.lastIndex = 0; upd[k] = v.replace(OLD, '1500$1'); } else OLD.lastIndex = 0;
        if (!Object.keys(upd).length) continue;
        console.log('  ✔ нода «' + ((n.data && n.data.label) || n.id) + '»: ' + Object.keys(upd).join(', '));
        if (!DRY) await callTool('update_node', { botId, nodeId: n.id, data: upd });
    }
    if (/2500/.test(bot.description || '')) {
        console.log('  ✔ опис воронки');
        if (!DRY) await callTool('update_bot', { botId, description: bot.description.replace(OLD, '1500$1') });
    }

    // 3) бічний етап «Мовчав 24 год»: wait24h → етап → follow-up 1
    f = await callTool('get_funnel', { botId });
    const wait = f.nodes.find((n) => n.data && n.data.label === 'Чекаємо 24год — чи відповів');
    const fu1 = f.nodes.find((n) => n.data && n.data.label === 'Follow-up 1 — вартість рутини');
    if (!wait || !fu1) throw new Error('не знайдено wait/follow-up 1');
    if (f.nodes.some((n) => n.type === 'flowStage' && n.data.stageName === 'Мовчав 24 год')) console.log('  = етап «Мовчав 24 год» вже є');
    else {
        console.log('  ✔ додаю бічний етап «Мовчав 24 год» (order 14)');
        if (!DRY) {
            const r = await callTool('add_node', { botId, type: 'flowStage', position: { x: wait.position.x, y: wait.position.y + 120 }, data: { label: 'Етап: Мовчав 24 год', stageName: 'Мовчав 24 год', stageOrder: 14, side: true } });
            const sid = r.added.id;
            for (const e of f.edges.filter((x) => x.source === wait.id && x.target === fu1.id)) await callTool('delete_edge', { botId, edgeId: e.id });
            await callTool('create_edge', { botId, source: wait.id, target: sid });
            await callTool('create_edge', { botId, source: sid, target: fu1.id });
        }
    }
    console.log('Готово' + (DRY ? ' (dry-run)' : ''));
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
