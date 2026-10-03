'use strict';
// Patch (source of truth): goverla — крон «Meta Ads Sync — goverla_shop» (бот 800eb6d0, нода n_meta_sync).
// 2026-10-03: крім списку реклам — щоденні витрати/покази/кліки/РОЗМОВИ по кожній рекламі за останні N днів (Meta insights,
// time_increment=1) → CRM POST /ad-spend-daily. Навіщо:
//   • бот, коли Zernio не передав, з якої реклами клієнт (≈22% розмов), бере найімовірніший товар серед активних реклам
//     (CRM GET /ads/active-summary — вага = розмови за 3 дні);
//   • витрати в CRM не оновлювались з 12.09 (аналітика реклам стояла) — тепер оновлюються щоразу.
// N = context.metaSpendDays (ручний догін), інакше 3. Крон — раз на 5 годин (рішення власника 03.10).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-meta-sync-insights-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = '800eb6d0-b29b-4d51-876d-108312667065';
const NODE = 'n_meta_sync';
const MARK = 'ad-spend-daily (insights)';
const ANCHOR = '// 2026-09-13: metaSyncStatus/metaSyncDate/metaSyncAdsCount/metaSyncWritten — контракт, який ВЖЕ';

const BLOCK = `// ── Щоденні метрики по рекламах → CRM ad-spend-daily (insights) — 2026-10-03 ─────────────────────────────────────────
// Витрати/покази/кліки/розмови за останні N днів по кожній рекламі. Розмови = найбільше з messaging_conversation_started*
// (Meta віддає кілька вікон атрибуції). Помилка тут не ламає синк реклам вище.
var spendDays = Math.min(40, Math.max(1, Number(context.metaSpendDays) || 3));
var spendSince = new Date(Date.now() - (spendDays - 1) * 86400000).toISOString().slice(0, 10);
var spendUntil = new Date().toISOString().slice(0, 10);
var spendResults = { rows: 0, written: 0, errors: 0 };
async function syncInsights(acctInfo) {
  var after = null, pages = 0;
  do {
    var iu = 'https://graph.facebook.com/v21.0/' + acctInfo.id + '/insights?level=ad&time_increment=1'
      + '&time_range=' + encodeURIComponent(JSON.stringify({ since: spendSince, until: spendUntil }))
      + '&fields=ad_id,ad_name,spend,impressions,clicks,actions,account_currency&limit=200'
      + (after ? '&after=' + encodeURIComponent(after) : '') + '&access_token=' + encodeURIComponent(token);
    var ij = {};
    try { ij = await (await fetch(iu)).json(); } catch (e) { spendResults.errors++; break; }
    if (ij.error) { spendResults.errors++; break; }
    var rows = Array.isArray(ij.data) ? ij.data : [];
    spendResults.rows += rows.length;
    await Promise.all(rows.map(async function (r) {
      var conv = (r.actions || []).filter(function (x) { return /messaging_conversation_started/.test(String(x.action_type || '')); })
        .reduce(function (m, x) { return Math.max(m, Number(x.value) || 0); }, 0);
      try {
        var pr = await fetch(crmBase + '/ad-spend-daily', { method: 'POST', headers: crmHdr, body: JSON.stringify({
          externalId: String(r.ad_id), name: r.ad_name || null, date: r.date_start, amount: Number(r.spend) || 0,
          currency: r.account_currency || 'UAH', impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
          conversations: conv, adAccountId: acctInfo.id,
        }) });
        if (pr.ok) spendResults.written++; else spendResults.errors++;
      } catch (e) { spendResults.errors++; }
    }));
    after = (ij.paging && ij.paging.cursors && ij.paging.next) ? ij.paging.cursors.after : null;
    pages++;
    if (after) await sleep(300);
  } while (after && pages < 30);
}
try { await Promise.all(accounts.map(syncInsights)); } catch (e) { spendResults.errors++; }
overallResults.spend = spendResults; // ${MARK}

`;

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === NODE);
    if (i < 0) throw new Error('немає ноди ' + NODE);
    let code = String(nodes[i].data.code || '');
    if (code.includes(MARK)) { console.log('already patched'); return; }
    if (code.split(ANCHOR).length !== 2) throw new Error('не знайдено якір (або їх кілька) — код ноди змінився, патч треба оновити');
    code = code.replace(ANCHOR, BLOCK + ANCHOR);
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
