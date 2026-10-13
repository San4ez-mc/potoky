return (async () => {
  // Воронка plan-watch (щодня з серверного cron): питає content2, чи є пости на найближчі дні в мережах з автопублікацією.
  // Повідомлення непорожнє ЛИШЕ коли є прогалини → notifyTg надішле його власнику; інакше воронка мовчить.
  var k = (typeof keys !== 'undefined' && keys) ? keys : {};
  var base = String(k.CONTENT2_URL || 'https://content2.fineko.space').replace(/\/$/, '');
  if (!k.CONTENT2_TOKEN) return { planWatchMessage: '⚠️ plan-watch: не заповнено CONTENT2_TOKEN у ключах воронки.' };
  try {
    var r = await fetch(base + '/api/webhooks/plan-watch?token=' + encodeURIComponent(k.CONTENT2_TOKEN));
    if (!r.ok) return { planWatchMessage: '⚠️ plan-watch: content2 відповів HTTP ' + r.status + ' — перевір, чи працює контент-платформа.' };
    var j = await r.json();
    return { planWatchMessage: String(j.message || ''), planWatchGaps: j.gaps || [] };
  } catch (e) {
    return { planWatchMessage: '⚠️ plan-watch: не вдалось звернутись до content2 (' + String(e.message).slice(0, 120) + ').' };
  }
})();
