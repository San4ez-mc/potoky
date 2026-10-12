return (async () => {
  // Воронка threads-insights (раз на добу з серверного cron): (1) за потреби оновлює 60-денний токен Threads,
  // (2) збирає метрики опублікованих постів (перегляди, лайки, відповіді, репости, цитування, поширення) і пише їх
  // у content2 (PostGroup.scores) — звідти їх беруть /api/patterns і контент-менеджер, (3) знімає кількість підписників.
  // Ключі: THREADS_USER_ID, THREADS_ACCESS_TOKEN, PUBLISH_THREADS_BOT_ID, SELF_BOT_ID, MCP_SECRET, CONTENT2_URL, CONTENT2_TOKEN.
  // Результат: threadsInsightsMessage — не порожній ЛИШЕ коли є про що повідомити власнику (помилка / токен оновлено).
  var k = (typeof keys !== 'undefined' && keys) ? keys : {};
  var G = 'https://graph.threads.net/v1.0/';
  var out = { collected: 0, updated: 0, skipped: 0, followers: null, refreshed: false, threadsInsightsMessage: '' };
  function fail(text) { out.threadsInsightsMessage = '⚠️ Збір метрик Threads: ' + text; return out; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  if (!k.THREADS_USER_ID || !k.THREADS_ACCESS_TOKEN) return fail('не заповнено THREADS_USER_ID / THREADS_ACCESS_TOKEN у ключах воронки threads-insights.');
  if (!k.CONTENT2_TOKEN) return fail('не заповнено CONTENT2_TOKEN.');
  var c2 = String(k.CONTENT2_URL || 'https://content2.fineko.space').replace(/\/$/, '');
  var token = k.THREADS_ACCESS_TOKEN;

  async function writeKey(botId, key, value, label) {
    var r = await fetch('https://flows.fineko.space/api/mcp-edit', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k.MCP_SECRET },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_funnel_key', arguments: { botId: botId, key: key, value: String(value), label: label, isSecret: true } } }) });
    if (!r.ok) throw new Error('mcp-edit ' + key + ' HTTP ' + r.status);
  }

  // ── 1. Токен: оновлюємо, коли лишилось < 30 днів (long-lived живе 60 днів; refresh дає ще 60) ───────────
  try {
    var dj = await (await fetch(G.replace('/v1.0/', '/v1.0/') + 'debug_token?input_token=' + encodeURIComponent(token) + '&access_token=' + encodeURIComponent(token))).json();
    var exp = dj && dj.data && dj.data.expires_at ? Number(dj.data.expires_at) * 1000 : 0;
    if (dj && dj.data && dj.data.is_valid === false) return fail('токен Threads недійсний — пройди авторизацію kiro-threads-oauth ще раз.');
    if (exp && exp - Date.now() < 30 * 86400000) {
      var rj = await (await fetch('https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=' + encodeURIComponent(token))).json();
      if (rj && rj.access_token) {
        token = rj.access_token;
        if (k.MCP_SECRET && k.PUBLISH_THREADS_BOT_ID) {
          await writeKey(k.PUBLISH_THREADS_BOT_ID, 'THREADS_ACCESS_TOKEN', token, 'Threads long-lived access token (оновлюється автоматично)');
          if (k.SELF_BOT_ID) await writeKey(k.SELF_BOT_ID, 'THREADS_ACCESS_TOKEN', token, 'Threads long-lived access token');
        }
        out.refreshed = true;
        out.threadsInsightsMessage = '🔄 Токен Threads автоматично оновлено ще на ~60 днів.';
      } else {
        out.threadsInsightsMessage = '⚠️ Не вдалось оновити токен Threads (лишилось менше 30 днів): ' + JSON.stringify(rj).slice(0, 200);
      }
    }
  } catch (e) { /* перевірка токена не критична — продовжуємо збір */ }
  var qs = 'access_token=' + encodeURIComponent(token);

  // ── 2. Які пости опитувати ─────────────────────────────────────────────────────────────────────────
  var days = Math.min(90, Math.max(1, Number(context.days) || 30));
  var lr = await fetch(c2 + '/api/webhooks/post-metrics?token=' + encodeURIComponent(k.CONTENT2_TOKEN) + '&platform=threads&days=' + days);
  if (!lr.ok) return fail('content2 повернув HTTP ' + lr.status + ' на список постів.');
  var posts = (await lr.json()).posts || [];
  out.collected = posts.length;

  // ── 3. Метрики кожного поста (пачками по 8, щоб вкластись у ліміт часу вузла) ────────────────────────
  var metrics = [], lastErr = '';
  async function one(p) {
    try {
      var r = await fetch(G + encodeURIComponent(p.externalId) + '/insights?metric=views,likes,replies,reposts,quotes,shares&' + qs);
      var j = await r.json();
      if (!r.ok || !j.data) { lastErr = (j && j.error && j.error.message) || ('HTTP ' + r.status); out.skipped++; return null; }
      var m = { postGroupId: p.postGroupId };
      j.data.forEach(function (x) { var v = x.values && x.values[0] && x.values[0].value; if (v == null && x.total_value) v = x.total_value.value; m[x.name] = Number(v) || 0; });
      return m;
    } catch (e) { lastErr = e.message; out.skipped++; return null; }
  }
  for (var i = 0; i < posts.length; i += 8) {
    var batch = await Promise.all(posts.slice(i, i + 8).map(one));
    batch.forEach(function (m) { if (m) metrics.push(m); });
    if (i + 8 < posts.length) await sleep(300);
  }
  if (posts.length && !metrics.length) return fail('Threads не віддав метрики жодного поста (' + lastErr + '). Перевір право threads_manage_insights і токен.');

  // ── 4. Запис у content2 ──────────────────────────────────────────────────────────────────────────
  if (metrics.length) {
    var wr = await fetch(c2 + '/api/webhooks/post-metrics?token=' + encodeURIComponent(k.CONTENT2_TOKEN), { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metrics: metrics }) });
    var wj = await wr.json().catch(function () { return {}; });
    if (!wr.ok) return fail('content2 не прийняв метрики (HTTP ' + wr.status + ').');
    out.updated = wj.updated || 0;
  }

  // ── 5. Підписники акаунта (необов'язково; помилка тут не ламає збір постів) ─────────────────────────
  try {
    var ar = await fetch(G + encodeURIComponent(k.THREADS_USER_ID) + '/threads_insights?metric=followers_count&' + qs);
    var aj = await ar.json();
    var fc = aj && aj.data && aj.data[0] && (aj.data[0].total_value ? aj.data[0].total_value.value : (aj.data[0].values && aj.data[0].values[0] && aj.data[0].values[0].value));
    if (fc != null) out.followers = Number(fc);
  } catch (e) { /* ignore */ }

  return out;
})();
