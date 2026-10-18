// Запуск: node scripts/qa/kb-match-compare-2026-10-18.js (з робочої копії — з посиланням node_modules/@platform/claude на свою копію пакета)
// kbMatch: Haiku 4.5 проти Haiku 5.5 на реальних питаннях клієнтів (agent_turns.understanding.questions) — збіг вибору запису бази знань.
process.chdir(require('path').join(__dirname, '..', '..'));
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const SA = require('path').join(__dirname, '../../apps/api/src/services/shopAgent/') + '/';
const { db, loadAssets } = require(SA + 'lib');
const { kbMatch } = require(SA + 'kbMatch');
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
(async () => {
    const assets = await loadAssets(BOT);
    const rows = await db.$queryRawUnsafe(`SELECT "sessionId", understanding, "ctxBefore" FROM agent_turns WHERE "botId"=$1 AND "createdAt" > now() - interval '2 days' AND jsonb_array_length(coalesce(understanding->'questions','[]'::jsonb)) > 0 ORDER BY random() LIMIT 30`, BOT);
    let same = 0, n = 0; const diff = [];
    for (const r of rows) {
        const q = String(((r.understanding || {}).questions || [])[0] || ''); if (!q) continue;
        const ctx = r.ctxBefore || {}; ctx.agent = ctx.agent || {};
        const mk = (model) => ({ botId: BOT, assets, keys: { ...assets.keys, KB_MATCH_MODEL: model }, session: { id: r.sessionId }, ctx, out: [] });
        const a = await kbMatch(mk('claude-haiku-4-5'), q).catch((e) => ({ err: e.message }));
        const b = await kbMatch(mk('claude-haiku-5-5'), q).catch((e) => ({ err: e.message }));
        const key = (x) => JSON.stringify(x && (x.entry ? (x.entry.q || x.entry.id) : x.match ?? null)) + '/' + (x && x.scope) + '/' + (x && x.kind);
        n++; if (key(a) === key(b)) same++; else diff.push('«' + q.slice(0, 60) + '»\n     4.5: ' + key(a).slice(0, 110) + '\n     5.5: ' + key(b).slice(0, 110));
    }
    console.log('збіг вибору: ' + same + ' з ' + n);
    diff.forEach((d) => console.log('  ' + d));
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
