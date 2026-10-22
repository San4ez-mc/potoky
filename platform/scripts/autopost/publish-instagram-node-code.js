return (async () => {
  // Публікація в Instagram через Instagram API (вхід через Instagram, без Facebook-сторінки): Reels (відео), одне фото, карусель (2–10 фото).
  // Ключі воронки: IG_USER_ID, IG_ACCESS_TOKEN (60-денний; сам оновлюється, коли минуло > 30 днів), IG_TOKEN_ISSUED_AT (мс),
  //   SELF_BOT_ID, MCP_SECRET (для запису оновленого токена), CONTENT2_URL (для конвертації PNG→JPEG; Instagram приймає лише JPEG).
  // Вхід: items[] (перший item: text = підпис, videoUrl або imageUrl; наступні item-и з imageUrl — сторінки каруселі), postGroupId, callbackUrl.
  // Правила Instagram: підпис ≤ 2200 символів і ≤ 30 хештегів; без медіа публікація неможлива; Reels 9:16, 3 с – 15 хв; ліміт 100 публікацій / 24 год.
  // Результат: publishedMessage (HTML для Telegram: посилання сховане за словами «Опубліковано в Instagram»), permalink, mediaId, publishError.
  var k = (typeof keys !== 'undefined' && keys) ? keys : {};
  var G = 'https://graph.instagram.com/v21.0/';
  var cb = context.callbackUrl || '';
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  async function done(res) {
    if (cb) {
      try {
        await fetch(cb, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          postGroupId: context.postGroupId || null, status: res.publishError ? 'failed' : 'published', platform: 'instagram',
          externalId: res.mediaId || null, url: res.permalink || null, error: res.publishError || null }) });
      } catch (e) {}
    }
    return res;
  }
  async function fail(msg) { return await done({ platform: 'instagram', publishError: msg }); }
  if (!k.IG_USER_ID || !k.IG_ACCESS_TOKEN) return await fail('NEED_INSTAGRAM_KEYS: підключи акаунт через воронку oauth-video ({"platform":"instagram"}).');
  var token = k.IG_ACCESS_TOKEN;

  async function writeKey(botId, key, value, label) {
    var r = await fetch('https://flows.fineko.space/api/mcp-edit', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k.MCP_SECRET },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_funnel_key', arguments: { botId: botId, key: key, value: String(value), label: label, isSecret: key !== 'IG_TOKEN_ISSUED_AT' } } }) });
    if (!r.ok) throw new Error('mcp-edit ' + key + ' HTTP ' + r.status);
  }

  // ── токен: оновлюємо, якщо йому > 30 днів (долгоживучий токен діє 60 днів; refresh дає ще 60) ──────────
  var issued = Number(k.IG_TOKEN_ISSUED_AT) || 0;
  if (k.SELF_BOT_ID && k.MCP_SECRET && (!issued || Date.now() - issued > 30 * 86400000)) {
    try {
      var rr = await fetch('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(token));
      var rj = await rr.json().catch(function () { return {}; });
      if (rj && rj.access_token) {
        token = rj.access_token;
        await writeKey(k.SELF_BOT_ID, 'IG_ACCESS_TOKEN', token, 'Instagram long-lived access token (оновлюється автоматично)');
        await writeKey(k.SELF_BOT_ID, 'IG_TOKEN_ISSUED_AT', Date.now(), 'Коли токен Instagram видано/оновлено (мс)');
      }
    } catch (e) { /* не критично: публікуємо старим токеном */ }
  }
  var qs = 'access_token=' + encodeURIComponent(token);
  var base = G + encodeURIComponent(k.IG_USER_ID);

  // ── що публікуємо ───────────────────────────────────────────────────────────────────────────────────
  var items = (Array.isArray(context.items) && context.items.length) ? context.items
    : [{ text: context.text || context.content || '', imageUrl: context.imageUrl, videoUrl: context.videoUrl }];
  var first = items[0] || {};
  var caption = String(first.text || '').trim().slice(0, 2200);
  var c2 = String(k.CONTENT2_URL || 'https://content2.fineko.space').replace(/\/$/, '');
  // Instagram приймає лише JPEG: наші картинки лежать у PNG — віддаємо через конвертер content2
  function jpegUrl(u) {
    u = String(u || '');
    if (!u || /\.(jpe?g)(\?|$)/i.test(u)) return u;
    var m = u.match(/^https?:\/\/[^/]+(\/uploads\/[^?#]+)/i);
    return m ? (c2 + '/api/public-jpeg?p=' + encodeURIComponent(m[1])) : u;
  }
  var images = items.map(function (x) { return x && x.imageUrl ? jpegUrl(x.imageUrl) : ''; }).filter(Boolean).slice(0, 10);
  var video = first.videoUrl || '';
  if (!video && !images.length) return await fail('NO_MEDIA: Instagram не публікує текст без медіа — потрібне відео (Reels) або фото. Додай медіа до поста.');

  function errText(j) {
    var e = j && j.error;
    if (!e) return JSON.stringify(j || {}).slice(0, 300);
    return (e.error_user_title ? e.error_user_title + ': ' : '') + (e.error_user_msg || e.message || '') + ' (code ' + e.code + (e.error_subcode ? '/' + e.error_subcode : '') + ')';
  }
  async function post(path, params) {
    var body = Object.keys(params).map(function (p) { return p + '=' + encodeURIComponent(params[p]); }).join('&') + '&' + qs;
    var r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body });
    var j = await r.json().catch(function () { return {}; });
    return { ok: r.ok && !(j && j.error), json: j };
  }
  // чекаємо, поки Instagram обробить контейнер (відео — до ~4 хв, фото — ~20 с)
  async function waitReady(id, isVideo) {
    var tries = isVideo ? 48 : 12;
    for (var w = 0; w < tries; w++) {
      await sleep(isVideo ? 5000 : 2000);
      try {
        var sr = await fetch(G + encodeURIComponent(id) + '?fields=status_code,status&' + qs);
        var sj = await sr.json();
        if (sj && sj.status_code === 'FINISHED') return null;
        if (sj && (sj.status_code === 'ERROR' || sj.status_code === 'EXPIRED')) return sj.status_code + ' ' + (sj.status || '');
      } catch (e) {}
    }
    return 'MEDIA_NOT_READY: контейнер ' + id + ' не став FINISHED вчасно';
  }

  var creation = null;
  if (video) {
    var rc = await post('/media', { media_type: 'REELS', video_url: video, caption: caption, share_to_feed: 'true' });
    if (!rc.ok || !rc.json.id) return await fail('CONTAINER_FAILED ' + errText(rc.json));
    var re = await waitReady(rc.json.id, true);
    if (re) return await fail('MEDIA_FAILED ' + re);
    creation = rc.json.id;
  } else if (images.length === 1) {
    var ri = await post('/media', { image_url: images[0], caption: caption });
    if (!ri.ok || !ri.json.id) return await fail('CONTAINER_FAILED ' + errText(ri.json));
    var rie = await waitReady(ri.json.id, false);
    if (rie) return await fail('MEDIA_FAILED ' + rie);
    creation = ri.json.id;
  } else {
    var kids = [];
    for (var i = 0; i < images.length; i++) {
      var rk = await post('/media', { image_url: images[i], is_carousel_item: 'true' });
      if (!rk.ok || !rk.json.id) return await fail('CAROUSEL_ITEM_FAILED (' + (i + 1) + '/' + images.length + ') ' + errText(rk.json));
      var rke = await waitReady(rk.json.id, false);
      if (rke) return await fail('CAROUSEL_ITEM_MEDIA_FAILED (' + (i + 1) + ') ' + rke);
      kids.push(rk.json.id);
    }
    var rp = await post('/media', { media_type: 'CAROUSEL', children: kids.join(','), caption: caption });
    if (!rp.ok || !rp.json.id) return await fail('CONTAINER_FAILED ' + errText(rp.json));
    var rpe = await waitReady(rp.json.id, false);
    if (rpe) return await fail('MEDIA_FAILED ' + rpe);
    creation = rp.json.id;
  }

  // ── публікація (тимчасові помилки «медіа ще не доступне» — повторюємо) ───────────────────────────────
  var pub = null;
  for (var a = 0; a < 4; a++) {
    pub = await post('/media_publish', { creation_id: creation });
    if (pub.ok && pub.json.id) break;
    var pe = pub.json && pub.json.error;
    if (pe && (pe.code === 2 || pe.code === 1 || pe.error_subcode === 2207027 || pe.code === 9007)) { await sleep(6000); continue; }
    break;
  }
  if (!pub || !pub.ok || !pub.json.id) return await fail('PUBLISH_FAILED ' + errText(pub && pub.json));
  var mediaId = pub.json.id;

  var permalink = null;
  try {
    var pl = await (await fetch(G + encodeURIComponent(mediaId) + '?fields=permalink&' + qs)).json();
    permalink = (pl && pl.permalink) || null;
  } catch (e) {}

  var kind = video ? 'Reels' : (images.length > 1 ? 'карусель (' + images.length + ')' : 'фото');
  var head = permalink ? '✅ <a href="' + String(permalink).replace(/"/g, '&quot;') + '">Опубліковано в Instagram</a> (' + kind + ')' : '✅ Опубліковано в Instagram (' + kind + ')';
  var publishedMessage = head + (caption ? '\n\n' + esc(caption).slice(0, 1500) : '');
  return await done({ platform: 'instagram', mediaId: mediaId, permalink: permalink, kind: kind, publishError: null, publishedMessage: publishedMessage });
})();
