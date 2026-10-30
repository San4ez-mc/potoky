'use strict';
// Сповіщення «Нова розмова з продавцем» тепер показує, в яку воронку потрапив лід ({{bot.name}}).
// Застосувати ПІСЛЯ деплою (старий рушій не знає змінної bot). Ідемпотентно.
//   PLATFORM_ROOT=$PWD node scripts/patch-lead-notice-funnel-name-2026-10-30.js   (DRY_RUN=1 — лише показати)
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const DRY = !!process.env.DRY_RUN;
const MARK = 'Воронка: {{bot.name}}';

(async () => {
    const bots = await db.bot.findMany({ where: { OR: [{ slug: 'tpl-expert-seller' }, { slug: { startsWith: 'sell-' } }] }, select: { id: true, slug: true } });
    let changed = 0;
    for (const b of bots) {
        const f = await callTool('get_funnel', { botId: b.id });
        const n = (f.nodes || []).find((x) => x.data && x.data.label === 'Новий лід' && x.type === 'notifyTg');
        if (!n) { console.log('  —', b.slug, ': нода «Новий лід» не знайдена'); continue; }
        const msg = String(n.data.message || '');
        if (msg.includes(MARK)) { console.log('  =', b.slug, ': вже оновлено'); continue; }
        const next = msg.replace('Нова розмова з продавцем', 'Нова розмова з продавцем\n🎯 Воронка: {{bot.name}}');
        if (next === msg) { console.log('  ?', b.slug, ': незвичний текст, пропущено'); continue; }
        if (!DRY) await callTool('update_node', { botId: b.id, nodeId: n.id, data: { message: next } });
        console.log('  ✔', b.slug, DRY ? '(dry-run)' : 'оновлено'); changed++;
    }
    console.log('Готово, змін:', changed);
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
