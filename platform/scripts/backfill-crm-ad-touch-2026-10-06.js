#!/usr/bin/env node
'use strict';
/**
 * Бекфіл реклами (першого/останнього дотику) для карток і замовлень CRM з історії розмов Flows — 2026-10-06.
 *
 * З 13.09 агент не передавав у CRM, з якої реклами прийшла людина: за весь час лише 13 замовлень мали firstTouchAdId.
 * Новий код (shopAgent/index.js ctx.adTouch → tools.funnelStage/adTouchSync → CRM lib/adAttribution) робить це для нових
 * розмов; цей скрипт відновлює дотики для вже наявних карток із metadata.adId повідомлень клієнта (та ctx.entryAdId).
 * Ідемпотентний: CRM не перезаписує вже встановлений перший дотик і не відкочує останній на старіший.
 *
 *   node scripts/backfill-crm-ad-touch-2026-10-06.js [botId] [--since=2026-09-09] [--dry]
 */
const path = require('path');
process.env.NODE_PATH = path.join(__dirname, '..', 'node_modules'); require('module').Module._initPaths();
const { db, crmFetch } = require('../apps/api/src/services/shopAgent/lib');

const BOT = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const SINCE = new Date(((process.argv.find((a) => a.startsWith('--since=')) || '').split('=')[1]) || '2026-09-09');
const DRY = process.argv.includes('--dry');

(async () => {
    const keys = Object.fromEntries((await db.funnelKey.findMany({ where: { botId: BOT } })).map((k) => [k.key, k.value]));
    if (!keys.CRM_API_KEY) { console.log('нема CRM_API_KEY у воронки'); process.exit(1); }
    const sessions = await db.session.findMany({ where: { botId: BOT, isTest: false, startedAt: { gte: SINCE } }, select: { id: true, context: true } });
    let withAd = 0, sent = 0, updated = 0, noOrder = 0, failed = 0;
    for (const s of sessions) {
        const msgs = await db.message.findMany({ where: { sessionId: s.id, role: 'user' }, orderBy: { createdAt: 'asc' }, select: { metadata: true, createdAt: true } });
        const touches = msgs.filter((m) => m.metadata && m.metadata.adId).map((m) => ({ externalId: String(m.metadata.adId), at: m.createdAt.toISOString() }));
        const c = s.context || {};
        if (!touches.length && c.entryAdId) touches.push({ externalId: String(c.entryAdId), at: (msgs[0] ? msgs[0].createdAt : new Date()).toISOString() });
        if (!touches.length) continue;
        withAd++;
        const body = { sessionId: s.id, firstTouch: { ...touches[0], name: c.adTitle || null }, lastTouch: touches[touches.length - 1] };
        if (DRY) continue;
        const r = await crmFetch(keys, '/orders/attribution-by-session', { method: 'POST', body: JSON.stringify(body) }, 10000);
        sent++;
        if (!r.ok) failed++;
        else if (r.json && r.json.reason === 'no_order_for_session') noOrder++;
        else if (r.data && !r.data.unchanged) updated++;
        if (sent % 200 === 0) console.log('…', sent, 'оновлено', updated);
    }
    console.log(JSON.stringify({ sessions: sessions.length, withAd, sent, updated, noOrder, failed, dry: DRY }));
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
