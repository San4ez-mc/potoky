return (async () => {
  // Підключення TikTok / YouTube до автопостингу: два кроки (OAuth, як для Threads).
  //  1) POST { platform: "tiktok"|"youtube", mode: "url" }  → у Telegram приходить посилання для авторизації акаунта;
  //  2) після згоди браузер перенаправить на redirect URI з ?code=… — скопіюй code з адресного рядка і надішли
  //     POST { platform, code } → код міняється на токени, які самі записуються у ключі воронок publish-tiktok / publish-youtube-shorts.
  // Ключі цієї воронки: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, YT_CLIENT_ID, YT_CLIENT_SECRET, OAUTH_REDIRECT_URI,
  // PUBLISH_TIKTOK_BOT_ID, PUBLISH_YOUTUBE_BOT_ID, MCP_SECRET.
  var k = (typeof keys !== 'undefined' && keys) ? keys : {};
  var platform = String(context.platform || '').toLowerCase();
  var redirect = k.OAUTH_REDIRECT_URI || 'https://flows.fineko.space/webhook/bot/oauth-video';
  function msg(text, extra) { return Object.assign({ oauthMessage: text }, extra || {}); }

  async function writeKey(botId, key, value, label, isSecret) {
    var r = await fetch('https://flows.fineko.space/api/mcp-edit', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k.MCP_SECRET },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_funnel_key', arguments: { botId: botId, key: key, value: String(value), label: label, isSecret: !!isSecret } } }) });
    if (!r.ok) throw new Error('mcp-edit ' + key + ' HTTP ' + r.status);
    return true;
  }

  if (platform !== 'tiktok' && platform !== 'youtube' && platform !== 'instagram') return msg('⚠️ OAuth: вкажи platform = "tiktok", "youtube" або "instagram".', { oauthOk: false });

  // ── Instagram (Instagram API with Instagram Login): публікація фото/каруселей/Reels ───────────────
  // Ключі цієї воронки: IG_APP_ID, IG_APP_SECRET (Meta for Developers → додаток → Instagram → API setup with Instagram login),
  // PUBLISH_INSTAGRAM_BOT_ID. Токен: код → короткий токен → довгий (60 днів); публікатор сам його оновлює.
  if (platform === 'instagram') {
    var igRedirect = k.IG_REDIRECT_URI || redirect;
    if (!context.code) {
      if (!k.IG_APP_ID) return msg('⚠️ Instagram OAuth: спершу впиши IG_APP_ID і IG_APP_SECRET у ключі воронки oauth-video (Meta for Developers → додаток → Instagram → API setup with Instagram login).', { oauthOk: false });
      var iu = 'https://www.instagram.com/oauth/authorize?client_id=' + encodeURIComponent(k.IG_APP_ID) + '&redirect_uri=' + encodeURIComponent(igRedirect) +
        '&response_type=code&scope=' + encodeURIComponent('instagram_business_basic,instagram_business_content_publish') + '&state=kiro';
      return msg('🔗 Instagram: відкрий посилання в браузері, де виконано вхід в акаунт Instagram, який публікуватиме (професійний: Business або Creator), і дай згоду. Потім скопіюй з адресного рядка значення code= (без #_ наприкінці) і надішли його мені.\n' + iu, { oauthOk: true, oauthStep: 'url' });
    }
    var icode = String(context.code).replace(/#_$/, '').replace(/#.*$/, '');
    try { icode = decodeURIComponent(icode); } catch (e) {}
    try {
      var sr = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_id=' + encodeURIComponent(k.IG_APP_ID) + '&client_secret=' + encodeURIComponent(k.IG_APP_SECRET) + '&grant_type=authorization_code&redirect_uri=' + encodeURIComponent(igRedirect) + '&code=' + encodeURIComponent(icode) });
      var sj = await sr.json().catch(function () { return {}; });
      var short = (sj && sj.data && sj.data[0]) ? sj.data[0] : sj;          // Meta віддає або {access_token,user_id}, або {data:[{…}]}
      if (!short || !short.access_token) return msg('⚠️ Instagram OAuth: не вдалось обміняти code (він одноразовий і живе кілька хвилин).\n' + JSON.stringify(sj).slice(0, 400), { oauthOk: false });
      var lr = await fetch('https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=' + encodeURIComponent(k.IG_APP_SECRET) + '&access_token=' + encodeURIComponent(short.access_token));
      var lj = await lr.json().catch(function () { return {}; });
      if (!lj.access_token) return msg('⚠️ Instagram OAuth: не вдалось отримати довгий токен.\n' + JSON.stringify(lj).slice(0, 400), { oauthOk: false });
      var mr = await fetch('https://graph.instagram.com/v21.0/me?fields=user_id,username,account_type&access_token=' + encodeURIComponent(lj.access_token));
      var mj = await mr.json().catch(function () { return {}; });
      var igId = String(mj.user_id || short.user_id || '');
      if (!igId) return msg('⚠️ Instagram OAuth: токен є, але не вдалось дізнатись id акаунта. ' + JSON.stringify(mj).slice(0, 200), { oauthOk: false });
      var ib = k.PUBLISH_INSTAGRAM_BOT_ID;
      await writeKey(ib, 'IG_USER_ID', igId, 'Instagram user id', false);
      await writeKey(ib, 'IG_ACCESS_TOKEN', lj.access_token, 'Instagram long-lived access token (оновлюється автоматично)', true);
      await writeKey(ib, 'IG_TOKEN_ISSUED_AT', Date.now(), 'Коли токен Instagram видано/оновлено (мс)', false);
      var warn = (mj.account_type && mj.account_type !== 'BUSINESS' && mj.account_type !== 'MEDIA_CREATOR') ? '\n⚠️ Акаунт має тип ' + mj.account_type + ' — для публікації потрібен професійний (Business або Creator).' : '';
      return msg('✅ Instagram підключено: @' + (mj.username || '?') + ' (' + (mj.account_type || 'тип невідомий') + '). Токен записано у воронку publish-instagram (діє ~60 днів, оновлюється автоматично).' + warn, { oauthOk: true, oauthStep: 'done' });
    } catch (e) {
      return msg('⚠️ OAuth instagram: ' + String(e.message).slice(0, 300), { oauthOk: false });
    }
  }

  // ── крок 1: посилання для авторизації ───────────────────────────────────
  if (!context.code) {
    if (platform === 'tiktok') {
      if (!k.TIKTOK_CLIENT_KEY) return msg('⚠️ TikTok OAuth: спершу впиши TIKTOK_CLIENT_KEY і TIKTOK_CLIENT_SECRET у ключі воронки oauth-video (з TikTok for Developers → твій додаток).', { oauthOk: false });
      var u1 = 'https://www.tiktok.com/v2/auth/authorize/?client_key=' + encodeURIComponent(k.TIKTOK_CLIENT_KEY) + '&scope=' + encodeURIComponent('user.info.basic,video.publish') +
        '&response_type=code&redirect_uri=' + encodeURIComponent(redirect) + '&state=kiro';
      return msg('🔗 TikTok: відкрий посилання, увійди в потрібний акаунт і дай згоду. Потім скопіюй з адресного рядка значення code= і надішли його мені.\n' + u1, { oauthOk: true, oauthStep: 'url' });
    }
    if (!k.YT_CLIENT_ID) return msg('⚠️ YouTube OAuth: спершу впиши YT_CLIENT_ID і YT_CLIENT_SECRET у ключі воронки oauth-video (Google Cloud → Credentials → OAuth client).', { oauthOk: false });
    var u2 = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + encodeURIComponent(k.YT_CLIENT_ID) + '&redirect_uri=' + encodeURIComponent(redirect) +
      '&response_type=code&access_type=offline&prompt=consent&scope=' + encodeURIComponent('https://www.googleapis.com/auth/youtube.upload');
    return msg('🔗 YouTube: відкрий посилання, обери акаунт каналу й дай згоду. Потім скопіюй з адресного рядка значення code= і надішли його мені.\n' + u2, { oauthOk: true, oauthStep: 'url' });
  }

  // ── крок 2: обмін code на токени і запис у воронки-публікатори ──────────
  var code = String(context.code);
  try { code = decodeURIComponent(code); } catch (e) {}   // код у адресі приходить URL-закодованим (TikTok: %2A…)
  try {
    if (platform === 'tiktok') {
      var tr = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_key=' + encodeURIComponent(k.TIKTOK_CLIENT_KEY) + '&client_secret=' + encodeURIComponent(k.TIKTOK_CLIENT_SECRET) + '&code=' + encodeURIComponent(code) + '&grant_type=authorization_code&redirect_uri=' + encodeURIComponent(redirect) });
      var tj = await tr.json().catch(function () { return {}; });
      if (!tj.access_token || !tj.refresh_token) return msg('⚠️ TikTok OAuth: не вдалось обміняти code.\n' + JSON.stringify(tj).slice(0, 400), { oauthOk: false });
      var b = k.PUBLISH_TIKTOK_BOT_ID;
      await writeKey(b, 'TIKTOK_CLIENT_KEY', k.TIKTOK_CLIENT_KEY, 'TikTok client key');
      await writeKey(b, 'TIKTOK_CLIENT_SECRET', k.TIKTOK_CLIENT_SECRET, 'TikTok client secret', true);
      await writeKey(b, 'TIKTOK_REFRESH_TOKEN', tj.refresh_token, 'TikTok refresh token (~365 днів)', true);
      await writeKey(b, 'TIKTOK_ACCESS_TOKEN', tj.access_token, 'TikTok access token (24 год; оновлюється автоматично)', true);
      return msg('✅ TikTok підключено (open_id ' + tj.open_id + ', права: ' + tj.scope + '). Токени записано у воронку publish-tiktok. Поки додаток не пройшов аудит TikTok, публікація можлива лише приватно (SELF_ONLY).', { oauthOk: true, oauthStep: 'done' });
    }
    var gr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'code=' + encodeURIComponent(code) + '&client_id=' + encodeURIComponent(k.YT_CLIENT_ID) + '&client_secret=' + encodeURIComponent(k.YT_CLIENT_SECRET) + '&redirect_uri=' + encodeURIComponent(redirect) + '&grant_type=authorization_code' });
    var gj = await gr.json().catch(function () { return {}; });
    if (!gj.refresh_token) return msg('⚠️ YouTube OAuth: не отримано refresh_token (' + (gj.error_description || gj.error || JSON.stringify(gj).slice(0, 200)) + '). Відкрий посилання знову з prompt=consent і не пропускай екран згоди.', { oauthOk: false });
    var yb = k.PUBLISH_YOUTUBE_BOT_ID;
    await writeKey(yb, 'YT_CLIENT_ID', k.YT_CLIENT_ID, 'Google OAuth client id');
    await writeKey(yb, 'YT_CLIENT_SECRET', k.YT_CLIENT_SECRET, 'Google OAuth client secret', true);
    await writeKey(yb, 'YT_REFRESH_TOKEN', gj.refresh_token, 'YouTube refresh token', true);
    return msg('✅ YouTube підключено. Refresh token записано у воронку publish-youtube-shorts. Поки проєкт Google Cloud не пройшов аудит YouTube API, відео лишаються приватними.', { oauthOk: true, oauthStep: 'done' });
  } catch (e) {
    return msg('⚠️ OAuth ' + platform + ': ' + String(e.message).slice(0, 300), { oauthOk: false });
  }
})();
