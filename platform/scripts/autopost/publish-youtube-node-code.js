return (async () => {
  // Публікація відео як YouTube Shorts через YouTube Data API v3 (resumable upload).
  // Ключі воронки: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN. Вхід: videoUrl, title|hook, description|content, privacy?, postGroupId, callbackUrl.
  // УВАГА: для проєктів Google Cloud, що не пройшли аудит YouTube API, завантажені відео примусово стають private — це не помилка коду.
  var k = (typeof keys !== 'undefined' && keys) ? keys : {};
  var cb = context.callbackUrl || '';
  async function done(res) {
    if (cb) {
      try {
        await fetch(cb, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          postGroupId: context.postGroupId || null, status: res.publishError ? 'failed' : 'published', platform: 'youtube',
          externalId: res.videoId || null, url: res.url || null, error: res.publishError || null }) });
      } catch (e) {}
    }
    return res;
  }
  if (!k.YT_CLIENT_ID || !k.YT_CLIENT_SECRET || !k.YT_REFRESH_TOKEN) return await done({ platform: 'youtube', publishError: 'NEED_YT_KEYS: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN' });
  if (!context.videoUrl) return await done({ platform: 'youtube', publishError: 'NO_VIDEO_URL' });

  // 1) refresh -> access token
  var tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=' + encodeURIComponent(k.YT_CLIENT_ID) + '&client_secret=' + encodeURIComponent(k.YT_CLIENT_SECRET) + '&refresh_token=' + encodeURIComponent(k.YT_REFRESH_TOKEN) + '&grant_type=refresh_token' });
  var tj = await tr.json().catch(function () { return {}; });
  if (!tj.access_token) return await done({ platform: 'youtube', publishError: 'TOKEN_FAILED ' + JSON.stringify(tj).slice(0, 300) });
  var at = tj.access_token;

  // 2) метадані: назва ≤100 без переносів, #Shorts в описі, теги з хештегів підпису
  var raw = String(context.description || context.content || context.text || '');
  var firstLine = raw.split('\n')[0];
  var title = String(context.title || context.hook || firstLine || 'Shorts').replace(/\s+/g, ' ').replace(/#\S+/g, '').trim().slice(0, 95) || 'Shorts';
  var tags = (raw.match(/#[\p{L}\p{N}_]+/gu) || []).map(function (t) { return t.slice(1); }).slice(0, 10);
  var desc = (raw + (/#shorts/i.test(raw) ? '' : '\n\n#Shorts')).slice(0, 4900);
  var meta = { snippet: { title: title, description: desc, categoryId: '22', tags: tags }, status: { privacyStatus: context.privacy || 'public', selfDeclaredMadeForKids: false } };

  var init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST',
    headers: { 'Authorization': 'Bearer ' + at, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4' }, body: JSON.stringify(meta) });
  var loc = init.headers.get('location');
  if (!loc) return await done({ platform: 'youtube', publishError: 'INIT_FAILED HTTP ' + init.status + ' ' + (await init.text()).slice(0, 300) });

  // 3) відео в памʼять і PUT
  var vr = await fetch(context.videoUrl);
  if (!vr.ok) return await done({ platform: 'youtube', publishError: 'VIDEO_DOWNLOAD ' + vr.status });
  var buf = Buffer.from(await vr.arrayBuffer());
  var up = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length) }, body: buf });
  var uj = await up.json().catch(function () { return {}; });
  var vid = uj && uj.id;
  if (!vid) {
    var reason = uj && uj.error && ((uj.error.errors && uj.error.errors[0] && uj.error.errors[0].reason) || uj.error.message);
    return await done({ platform: 'youtube', publishError: 'UPLOAD_FAILED ' + (reason || JSON.stringify(uj).slice(0, 300)) });
  }
  var priv = uj.status && uj.status.privacyStatus;
  var res = { platform: 'youtube', videoId: vid, url: 'https://youtube.com/shorts/' + vid, privacy: priv || meta.status.privacyStatus, publishError: null };
  if (priv && priv !== 'public' && (context.privacy || 'public') === 'public') res.note = 'YouTube залишив відео приватним (' + priv + '): проєкт Google Cloud ще не пройшов аудит YouTube API.';
  return await done(res);
})();
