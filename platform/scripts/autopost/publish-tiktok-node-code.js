return (async () => {
  // Публікація відео в TikTok через Content Posting API (FILE_UPLOAD: не потребує верифікації домену на відміну від PULL_FROM_URL).
  // Ключі воронки: TIKTOK_ACCESS_TOKEN (обовʼязково) АБО TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET + TIKTOK_REFRESH_TOKEN
  // (тоді токен доступу оновлюється при кожній публікації — він живе лише 24 год). Вхід: videoUrl, title|content, privacy?, postGroupId, callbackUrl.
  // УВАГА: поки додаток TikTok не пройшов аудит, API дозволяє лише privacy SELF_ONLY (приватно) — це не помилка коду.
  var k = (typeof keys !== 'undefined' && keys) ? keys : {};
  var cb = context.callbackUrl || '';
  var API = 'https://open.tiktokapis.com';
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function done(res) {
    if (cb) {
      try {
        await fetch(cb, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          postGroupId: context.postGroupId || null, status: res.publishError ? 'failed' : 'published', platform: 'tiktok',
          externalId: res.publishId || null, error: res.publishError || null }) });
      } catch (e) {}
    }
    return res;
  }
  async function jpost(path, token, body) {
    var r = await fetch(API + path, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body || {}) });
    var j = await r.json().catch(function () { return {}; });
    return { status: r.status, json: j };
  }

  if (!context.videoUrl) return await done({ platform: 'tiktok', publishError: 'NO_VIDEO_URL' });

  // 1) токен доступу
  var token = k.TIKTOK_ACCESS_TOKEN || '';
  var rotated = false;
  if (k.TIKTOK_CLIENT_KEY && k.TIKTOK_CLIENT_SECRET && k.TIKTOK_REFRESH_TOKEN) {
    var tr = await fetch(API + '/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_key=' + encodeURIComponent(k.TIKTOK_CLIENT_KEY) + '&client_secret=' + encodeURIComponent(k.TIKTOK_CLIENT_SECRET) +
        '&grant_type=refresh_token&refresh_token=' + encodeURIComponent(k.TIKTOK_REFRESH_TOKEN) });
    var tj = await tr.json().catch(function () { return {}; });
    if (!tj.access_token) return await done({ platform: 'tiktok', publishError: 'TOKEN_REFRESH_FAILED ' + JSON.stringify(tj).slice(0, 300) });
    token = tj.access_token;
    rotated = !!(tj.refresh_token && tj.refresh_token !== k.TIKTOK_REFRESH_TOKEN);
    // TikTok може видати НОВИЙ refresh-токен — без збереження наступне оновлення впаде. Пишемо його у ключі цієї воронки.
    if (rotated && k.MCP_SECRET && k.SELF_BOT_ID) {
      try {
        await fetch('https://flows.fineko.space/api/mcp-edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k.MCP_SECRET },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_funnel_key', arguments: { botId: k.SELF_BOT_ID, key: 'TIKTOK_REFRESH_TOKEN', value: tj.refresh_token, label: 'TikTok refresh token (~365 днів)', isSecret: true } } }) });
      } catch (e) {}
    }
  }
  if (!token) return await done({ platform: 'tiktok', publishError: 'NEED_TIKTOK_KEYS: TIKTOK_ACCESS_TOKEN або CLIENT_KEY+CLIENT_SECRET+REFRESH_TOKEN' });

  // 2) дозволені рівні приватності акаунта
  var ci = await jpost('/v2/post/publish/creator_info/query/', token, {});
  var cie = ci.json && ci.json.error && ci.json.error.code;
  if (cie && cie !== 'ok') return await done({ platform: 'tiktok', publishError: 'CREATOR_INFO ' + JSON.stringify(ci.json.error).slice(0, 300) });
  var allowed = (ci.json && ci.json.data && ci.json.data.privacy_level_options) || ['SELF_ONLY'];
  var want = context.privacy || 'PUBLIC_TO_EVERYONE';
  var privacy = allowed.indexOf(want) >= 0 ? want : (allowed.indexOf('SELF_ONLY') >= 0 ? 'SELF_ONLY' : allowed[0]);

  // 3) відео в памʼять (ролики ≤ ~30 МБ) і ініціалізація завантаження одним чанком
  var vr = await fetch(context.videoUrl);
  if (!vr.ok) return await done({ platform: 'tiktok', publishError: 'VIDEO_DOWNLOAD ' + vr.status });
  var buf = Buffer.from(await vr.arrayBuffer());
  var size = buf.length;
  var title = String(context.title || context.content || context.text || '').slice(0, 2200);
  var init = await jpost('/v2/post/publish/video/init/', token, {
    post_info: { title: title, privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
  });
  var ie = init.json && init.json.error && init.json.error.code;
  var pid = init.json && init.json.data && init.json.data.publish_id;
  var uploadUrl = init.json && init.json.data && init.json.data.upload_url;
  if ((ie && ie !== 'ok') || !pid || !uploadUrl) return await done({ platform: 'tiktok', publishError: 'INIT_FAILED ' + JSON.stringify(init.json).slice(0, 400) });

  // 4) завантаження
  var up = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': 'bytes 0-' + (size - 1) + '/' + size }, body: buf });
  if (!(up.status === 200 || up.status === 201 || up.status === 206)) return await done({ platform: 'tiktok', publishId: pid, publishError: 'UPLOAD_FAILED HTTP ' + up.status });

  // 5) статус публікації (до ~2 хв)
  var final = null;
  for (var i = 0; i < 24; i++) {
    await sleep(5000);
    var st = await jpost('/v2/post/publish/status/fetch/', token, { publish_id: pid });
    var d = st.json && st.json.data;
    if (d && (d.status === 'PUBLISH_COMPLETE' || d.status === 'FAILED')) { final = d; break; }
    if (d && d.status === 'SEND_TO_USER_INBOX') { final = d; break; }
  }
  var err = null;
  if (!final) err = 'STATUS_TIMEOUT (публікація могла завершитись пізніше, publish_id ' + pid + ')';
  else if (final.status === 'FAILED') err = 'PUBLISH_FAILED ' + (final.fail_reason || '');
  var res = { platform: 'tiktok', publishId: pid, privacy: privacy, tiktokStatus: final && final.status, tiktokRefreshRotated: rotated, publishError: err };
  if (privacy === 'SELF_ONLY' && !err) res.note = 'Опубліковано ПРИВАТНО (SELF_ONLY): додаток TikTok ще не пройшов аудит публічних постів.';
  return await done(res);
})();
