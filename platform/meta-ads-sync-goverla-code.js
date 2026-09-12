// Крон-бот "Meta Ads Sync — goverla_shop" — раніше цей бот мав 0 нод (справжній стаб, знайдено
// при розслідуванні 2026-09-13: crontab б'є щодня, webhook.js бачить порожній flow і мовчки
// нічого не робить). Живий баг власника: "ід реклами, які відображаються на pcrm.fineko.space/ads
// не співпадають з тими, які він бачить в Meta" + "деякі реклами приходять безфото" +
// "реклами приходять по кілька разів".
//
// Контракт Meta Graph API перевірено ЖИВИМ викликом (2026-09-13) реальним токеном/кабінетом —
// не вигадано: GET /{ad_account}/ads?fields=id,name,campaign{id,name},adset{id,name},
// creative{thumbnail_url} повертає РЕАЛЬНИЙ Ad ID, Campaign ID, Ad Set ID і фото ОДНИМ викликом.
//
// Дублі-фікс (окремий коміт, crm-repo c9c02a2 + platform 2e6aa34) уже покриває органічну
// реєстрацію; цей крон — джерело ПОВНИХ і ТОЧНИХ даних (усі 3 ID + campaign/adset назви +
// фото) для ВСІХ платних кампаній, включно з тими, що органічна реєстрація вже створила
// НЕПОВНИМИ (POST /ads тепер findFirst-or-update — цей крон їх ДОПОВНЮЄ, не дублює).

var token = (keys.META_SYSTEM_USER_TOKEN || '').trim();
var acct = (keys.META_AD_ACCOUNT_ID || '').trim();
var crmBase = (keys.CRM_API_URL || 'https://pcrm.fineko.space').replace(/\/$/, '') + '/api';
var crmKey = (keys.CRM_API_KEY || '').trim();
if (!token || !acct || !crmKey) {
  return { metaSyncError: 'META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID або CRM_API_KEY не заповнено' };
}
var crmHdr = { Authorization: 'Bearer ' + crmKey, 'Content-Type': 'application/json', Accept: 'application/json' };

var results = { fetched: 0, created: 0, updated: 0, errors: 0 };
var after = null;
var pages = 0;

function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

do {
  var url = 'https://graph.facebook.com/v21.0/' + acct + '/ads'
    + '?fields=id,name,effective_status,campaign{id,name},adset{id,name},creative{thumbnail_url}'
    + '&limit=50' + (after ? '&after=' + encodeURIComponent(after) : '')
    + '&access_token=' + encodeURIComponent(token);
  var metaRes;
  try {
    metaRes = await fetch(url);
  } catch (e) { results.errors++; break; }
  var metaJson = await metaRes.json().catch(function () { return {}; });
  if (metaJson.error) { return { metaSyncError: 'Meta API: ' + (metaJson.error.message || JSON.stringify(metaJson.error)) }; }
  var ads = Array.isArray(metaJson.data) ? metaJson.data : [];
  results.fetched += ads.length;

  for (var i = 0; i < ads.length; i++) {
    var a = ads[i];
    try {
      var body = {
        externalId: String(a.id),
        name: String(a.name || '').slice(0, 200),
        campaignId: a.campaign && a.campaign.id ? String(a.campaign.id) : null,
        campaignName: a.campaign && a.campaign.name ? String(a.campaign.name).slice(0, 200) : null,
        adSetId: a.adset && a.adset.id ? String(a.adset.id) : null,
        adSetName: a.adset && a.adset.name ? String(a.adset.name).slice(0, 200) : null,
        adAccountId: acct,
        thumbnailUrl: (a.creative && a.creative.thumbnail_url) ? String(a.creative.thumbnail_url) : null,
      };
      var crmRes = await fetch(crmBase + '/ads', { method: 'POST', headers: crmHdr, body: JSON.stringify(body) });
      var crmJson = await crmRes.json().catch(function () { return {}; });
      if (crmJson && crmJson.reused) results.updated++; else if (crmJson && crmJson.ok) results.created++; else results.errors++;
    } catch (e) { results.errors++; }
    await sleep(120); // best-effort, не б'ємо CRM чергою без пауз
  }

  after = (metaJson.paging && metaJson.paging.cursors && metaJson.paging.next) ? metaJson.paging.cursors.after : null;
  pages++;
} while (after && pages < 40); // guard — до 2000 оголошень за прохід

return { metaSyncResult: results, metaSyncAt: new Date().toISOString() };
