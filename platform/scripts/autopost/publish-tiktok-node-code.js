return (async () => {
  // Публікація відео в TikTok через Content Posting API (FILE_UPLOAD: не потребує верифікації домену на відміну від PULL_FROM_URL).
  // Ключі воронки: TIKTOK_ACCESS_TOKEN (обовʼязково) АБО TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET + TIKTOK_REFRESH_TOKEN
  // (тоді токен доступу оновлюється при кожній публікації — він живе лише 24 год). Вхід: videoUrl, title|content, privacy?, postGroupId, callbackUrl.
  // Два режими (context.action):
  //   'creator_info' — лише запит інформації про акаунт для вікна публікації в content2 (нік, дозволена приватність, заборони
  //                    коментарів/дует/стіч, макс. тривалість); результат іде callback-ом {requestId, ok, creator|error}, публікації нема.
  //   інакше         — публікація. Якщо є context.tiktok (вибір користувача у вікні публікації: privacy_level, title, allow_comment/duet/stitch,
  //                    brand_organic/brand_content, is_aigc) — він застосовується як є; без нього (автопостинг за розкладом) — старі значення за замовчуванням.
  // УВАГА: поки додаток TikTok не пройшов аудит, API дозволяє лише privacy SELF_ONLY (приватно) — це не помилка коду.
  // Ліміт TikTok: 6 запитів на хвилину на токен користувача — опитування статусу не частіше ніж раз на 15 с.
  var k = (typeof keys !== 'undefined' && keys) ? keys : {};
  var cb = context.callbackUrl || '';
  var isInfo = context.action === 'creator_info';
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
  async function infoDone(payload) {
    if (cb) {
      try {
        await fetch(cb, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ requestId: context.requestId || null }, payload)) });
      } catch (e) {}
    }
    return { platform: 'tiktok', action: 'creator_info', creatorInfoOk: !!payload.ok };
  }
  async function fail(msg) { return isInfo ? await infoDone({ ok: false, error: msg }) : await done({ platform: 'tiktok', publishError: msg }); }
  async function jpost(path, token, body) {
    var r = await fetch(API + path, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body || {}) });
    var j = await r.json().catch(function () { return {}; });
    return { status: r.status, json: j };
  }

  if (!isInfo && !context.videoUrl) return await fail('NO_VIDEO_URL');

  // 1) токен доступу
  var token = k.TIKTOK_ACCESS_TOKEN || '';
  var rotated = false;
  if (k.TIKTOK_CLIENT_KEY && k.TIKTOK_CLIENT_SECRET && k.TIKTOK_REFRESH_TOKEN) {
    var tr = await fetch(API + '/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_key=' + encodeURIComponent(k.TIKTOK_CLIENT_KEY) + '&client_secret=' + encodeURIComponent(k.TIKTOK_CLIENT_SECRET) +
        '&grant_type=refresh_token&refresh_token=' + encodeURIComponent(k.TIKTOK_REFRESH_TOKEN) });
    var tj = await tr.json().catch(function () { return {}; });
    if (!tj.access_token) return await fail('TOKEN_REFRESH_FAILED ' + JSON.stringify(tj).slice(0, 300));
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
  if (!token) return await fail('NEED_TIKTOK_KEYS: TIKTOK_ACCESS_TOKEN або CLIENT_KEY+CLIENT_SECRET+REFRESH_TOKEN');

  // 2) інформація про акаунт: дозволені рівні приватності, нік, заборони
  var ci = await jpost('/v2/post/publish/creator_info/query/', token, {});
  var cie = ci.json && ci.json.error && ci.json.error.code;
  if (cie && cie !== 'ok') return await fail('CREATOR_INFO ' + JSON.stringify(ci.json.error).slice(0, 300));
  var cd = (ci.json && ci.json.data) || {};

  if (isInfo) {
    return await infoDone({ ok: true, creator: {
      nickname: cd.creator_nickname || '', username: cd.creator_username || '', avatarUrl: cd.creator_avatar_url || '',
      privacyLevelOptions: cd.privacy_level_options || ['SELF_ONLY'],
      commentDisabled: !!cd.comment_disabled, duetDisabled: !!cd.duet_disabled, stitchDisabled: !!cd.stitch_disabled,
      maxVideoPostDurationSec: cd.max_video_post_duration_sec || 0 } });
  }

  var allowed = cd.privacy_level_options || ['SELF_ONLY'];
  var opt = (context.tiktok && typeof context.tiktok === 'object') ? context.tiktok : null;
  var privacy;
  if (opt) {
    // вибір користувача застосовуємо як є; не дозволений акаунтом рівень — помилка, а не мовчазна підміна
    if (allowed.indexOf(opt.privacy_level) < 0) return await done({ platform: 'tiktok', publishError: 'PRIVACY_NOT_ALLOWED ' + opt.privacy_level + ' (дозволено: ' + allowed.join(',') + ')' });
    privacy = opt.privacy_level;
  } else {
    var want = context.privacy || 'PUBLIC_TO_EVERYONE';
    privacy = allowed.indexOf(want) >= 0 ? want : (allowed.indexOf('SELF_ONLY') >= 0 ? 'SELF_ONLY' : allowed[0]);
  }

  // 3) відео в памʼять (ролики ≤ ~30 МБ) і ініціалізація завантаження одним чанком
  var vr = await fetch(context.videoUrl);
  if (!vr.ok) return await done({ platform: 'tiktok', publishError: 'VIDEO_DOWNLOAD ' + vr.status });
  var buf = Buffer.from(await vr.arrayBuffer());
  var size = buf.length;
  var title = String((opt ? opt.title : (context.title || context.content || context.text)) || '').slice(0, 2200);
  var postInfo = opt
    ? { title: title, privacy_level: privacy, disable_comment: !opt.allow_comment, disable_duet: !opt.allow_duet, disable_stitch: !opt.allow_stitch,
        brand_content_toggle: !!opt.brand_content, brand_organic_toggle: !!opt.brand_organic, is_aigc: !!opt.is_aigc }
    : { title: title, privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false };
  var init = await jpost('/v2/post/publish/video/init/', token, {
    post_info: postInfo,
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
  });
  var ie = init.json && init.json.error && init.json.error.code;
  var pid = init.json && init.json.data && init.json.data.publish_id;
  var uploadUrl = init.json && init.json.data && init.json.data.upload_url;
  if ((ie && ie !== 'ok') || !pid || !uploadUrl) return await done({ platform: 'tiktok', publishError: 'INIT_FAILED ' + JSON.stringify(init.json).slice(0, 400) });

  // 4) завантаження
  var up = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': 'bytes 0-' + (size - 1) + '/' + size }, body: buf });
  if (!(up.status === 200 || up.status === 201 || up.status === 206)) return await done({ platform: 'tiktok', publishId: pid, publishError: 'UPLOAD_FAILED HTTP ' + up.status });

  // 5) статус публікації (до ~4 хв, раз на 15 с — ліміт TikTok 6 запитів/хв на токен)
  var final = null;
  for (var i = 0; i < 16; i++) {
    await sleep(15000);
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
