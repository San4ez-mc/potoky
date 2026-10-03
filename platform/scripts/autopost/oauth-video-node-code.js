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

  if (platform !== 'tiktok' && platform !== 'youtube') return msg('⚠️ OAuth відео: вкажи platform = "tiktok" або "youtube".', { oauthOk: false });

  // ── крок 1: посилання для авторизації ───────────────────────────────────
  if (!context.code) {
    if (platform === 'tiktok') {
      if (!k.TIKTOK_CLIENT_KEY) return msg('⚠️ TikTok OAuth: спершу впиши TIKTOK_CLIENT_KEY і TIKTOK_CLIENT_SECRET у ключі воронки oauth-video (з TikTok for Developers → твій додаток).', { oauthOk: false });
      var u1 = 'https://www.tiktok.com/v2/auth/authorize/?client_key=' + encodeURIComponent(k.TIKTOK_CLIENT_KEY) + '&scope=' + encodeURIComponent('user.info.basic,video.upload,video.publish') +
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
