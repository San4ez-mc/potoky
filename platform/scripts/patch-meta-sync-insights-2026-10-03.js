'use strict';
// Patch (source of truth): goverla — крон «Meta Ads Sync — goverla_shop» (бот 800eb6d0).
// 2026-10-03: окремий вузол n_meta_spend ПІСЛЯ n_meta_sync — щоденні витрати/покази/кліки/РОЗМОВИ по кожній рекламі за останні
// N днів (Meta insights, time_increment=1) → CRM POST /ad-spend-daily. Окремим вузлом, бо разом із синком 1500 реклам прохід
// займав 63 с, а рушій обриває js-вузол через 60 с. Навіщо:
//   • бот, коли Zernio не передав, з якої реклами клієнт (≈22% розмов), бере найімовірніший товар серед активних реклам
//     (CRM GET /ads/active-summary — вага = розмови за 3 дні);
//   • витрати в CRM не оновлювались з 12.09 (аналітика реклам стояла).
// N = context.metaSpendDays (ручний догін), інакше 3. Крон — раз на 5 годин (рішення власника 03.10).
// Перша версія цього патча вставляла блок прямо в n_meta_sync — тут він прибирається (ідемпотентно).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-meta-sync-insights-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = '800eb6d0-b29b-4d51-876d-108312667065';
const SYNC = 'n_meta_sync';
const SPEND = 'n_meta_spend';
const OLD_START = '// ── Щоденні метрики по рекламах → CRM ad-spend-daily (insights) — 2026-10-03';
const OLD_END = 'overallResults.spend = spendResults; // ad-spend-daily (insights)\n\n';

const SPEND_CODE = `// n_meta_spend — щоденні метрики по рекламах → CRM ad-spend-daily (2026-10-03, scripts/patch-meta-sync-insights-2026-10-03.js).
// Витрати/покази/кліки/розмови за останні N днів по кожній рекламі. Розмови = найбільше з messaging_conversation_started*
// (Meta віддає кілька вікон атрибуції). Кабінети — ті самі правила, що в n_meta_sync (ручний вибір → ключ → усі, що бачить токен).
var token = (keys.META_SYSTEM_USER_TOKEN || '').trim();
var crmBase = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\\/$/, '');
var crmKey = (keys.CRM_API_KEY || '').trim();
if (!token || !crmKey) return { metaSpendError: 'META_SYSTEM_USER_TOKEN або CRM_API_KEY не заповнено' };
var crmHdr = { Authorization: 'Bearer ' + crmKey, 'Content-Type': 'application/json', Accept: 'application/json' };
function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
var accounts = [];
if (Array.isArray(context.metaAdAccountIds) && context.metaAdAccountIds.length) accounts = context.metaAdAccountIds.map(String);
else {
  var conf = (keys.META_AD_ACCOUNT_ID || '').trim();
  if (conf && conf.toLowerCase() !== 'auto') accounts = conf.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  else {
    try { var aj = await (await fetch('https://graph.facebook.com/v21.0/me/adaccounts?fields=id&limit=100&access_token=' + encodeURIComponent(token))).json(); accounts = (aj.data || []).map(function (a) { return a.id; }); }
    catch (e) { return { metaSpendError: 'не вдалось отримати кабінети: ' + e.message }; }
  }
}
var days = Math.min(40, Math.max(1, Number(context.metaSpendDays) || 3));
var since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
var until = new Date().toISOString().slice(0, 10);
var res = { accounts: accounts.length, days: days, rows: 0, written: 0, errors: 0 };
async function syncInsights(acct) {
  var after = null, pages = 0;
  do {
    var iu = 'https://graph.facebook.com/v21.0/' + acct + '/insights?level=ad&time_increment=1'
      + '&time_range=' + encodeURIComponent(JSON.stringify({ since: since, until: until }))
      + '&fields=ad_id,ad_name,spend,impressions,clicks,actions,account_currency&limit=200'
      + (after ? '&after=' + encodeURIComponent(after) : '') + '&access_token=' + encodeURIComponent(token);
    var ij = {};
    try { ij = await (await fetch(iu)).json(); } catch (e) { res.errors++; break; }
    if (ij.error) { res.errors++; break; }
    var rows = Array.isArray(ij.data) ? ij.data : [];
    res.rows += rows.length;
    await Promise.all(rows.map(async function (r) {
      var conv = (r.actions || []).filter(function (x) { return /messaging_conversation_started/.test(String(x.action_type || '')); })
        .reduce(function (m, x) { return Math.max(m, Number(x.value) || 0); }, 0);
      try {
        var pr = await fetch(crmBase + '/ad-spend-daily', { method: 'POST', headers: crmHdr, body: JSON.stringify({
          externalId: String(r.ad_id), name: r.ad_name || null, date: r.date_start, amount: Number(r.spend) || 0,
          currency: r.account_currency || 'UAH', impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
          conversations: conv, adAccountId: acct,
        }) });
        if (pr.ok) res.written++; else res.errors++;
      } catch (e) { res.errors++; }
    }));
    after = (ij.paging && ij.paging.cursors && ij.paging.next) ? ij.paging.cursors.after : null;
    pages++;
    if (after) await sleep(300);
  } while (after && pages < 30);
}
await Promise.all(accounts.map(syncInsights));
return { metaSpendResult: res, metaSpendAt: new Date().toISOString() };
`;

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice(); const edges = (flow.edges || []).slice();
    let changed = false;
    // 1) прибрати блок першої версії з n_meta_sync
    const si = nodes.findIndex((n) => n.id === SYNC);
    if (si < 0) throw new Error('немає ноди ' + SYNC);
    let code = String(nodes[si].data.code || '');
    const a = code.indexOf(OLD_START);
    if (a >= 0) {
        const b = code.indexOf(OLD_END, a);
        if (b < 0) throw new Error('кінець старого блоку не знайдено — прибрати вручну');
        code = code.slice(0, a) + code.slice(b + OLD_END.length);
        nodes[si] = { ...nodes[si], data: { ...nodes[si].data, code } };
        changed = true; console.log('removed inline block from', SYNC);
    }
    // 2) окремий вузол + звʼязок
    const pi = nodes.findIndex((n) => n.id === SPEND);
    const node = { id: SPEND, type: 'js', position: { x: 640, y: 0 }, data: { label: 'Метрики реклам → CRM (витрати, розмови)', description: 'Щоденні витрати/покази/кліки/розмови по рекламах за 3 дні → CRM /ad-spend-daily (вага для бота, коли Zernio не передав рекламу).', code: SPEND_CODE } };
    if (pi < 0) { nodes.push(node); changed = true; console.log('added', SPEND); }
    else if (nodes[pi].data.code !== SPEND_CODE) { nodes[pi] = { ...nodes[pi], data: { ...nodes[pi].data, code: SPEND_CODE } }; changed = true; console.log('updated', SPEND); }
    if (!edges.some((e) => e.source === SYNC && e.target === SPEND)) { edges.push({ id: 'edge_spend', source: SYNC, target: SPEND }); changed = true; console.log('added edge', SYNC, '→', SPEND); }
    if (changed) await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes, edges } });
    else console.log('already patched');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
