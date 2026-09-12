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
// 2026-09-13 (живий баг, Олексій: "я не знаю, звідки підтягнуло ці рекламні оголошення... може з
// якогось із попередніх, інших адс менеджерів"): раніше синк бив лише в ОДИН акаунт із статичного
// funnelKey META_AD_ACCOUNT_ID — а токен насправді бачить ДЕКІЛЬКА рекламних кабінетів (перевірено
// живим викликом /me/adaccounts: act_1034845985392821 "RK, 02, 13/08" ТА act_1076632877911189
// "RK, 02.2, 20/08", обидва account_status=1 активні). Статичний ключ зі старим одним акаунтом —
// сам по собі корінь плутанини "чому тут стара реклама". Тепер: якщо META_AD_ACCOUNT_ID НЕ
// заповнено (або задано спеціальне значення "auto") — синкаємо З УСІХ акаунтів, які реально бачить
// токен ЗАРАЗ (жива перевірка щоразу, не застигла копія). Явний список через кому в
// META_AD_ACCOUNT_ID — досі підтримується як override, якщо власник захоче звузити.
var crmBase = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var crmKey = (keys.CRM_API_KEY || '').trim();
if (!token || !crmKey) {
  return { metaSyncError: 'META_SYSTEM_USER_TOKEN або CRM_API_KEY не заповнено' };
}
var crmHdr = { Authorization: 'Bearer ' + crmKey, 'Content-Type': 'application/json', Accept: 'application/json' };

function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

var configuredAccts = (keys.META_AD_ACCOUNT_ID || '').trim();
var accounts = []; // [{id, name}]
if (configuredAccts && configuredAccts.toLowerCase() !== 'auto') {
  accounts = configuredAccts.split(',').map(function (s) { return { id: s.trim(), name: null }; }).filter(function (a) { return a.id; });
} else {
  try {
    var acctRes = await fetch('https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_status&limit=100&access_token=' + encodeURIComponent(token));
    var acctJson = await acctRes.json().catch(function () { return {}; });
    if (acctJson.error) { return { metaSyncError: 'Meta API (me/adaccounts): ' + (acctJson.error.message || JSON.stringify(acctJson.error)) }; }
    accounts = (Array.isArray(acctJson.data) ? acctJson.data : []).map(function (a) { return { id: a.id, name: a.name || null }; });
  } catch (e) { return { metaSyncError: 'не вдалось отримати список рекламних кабінетів: ' + e.message }; }
}
if (!accounts.length) { return { metaSyncError: 'жодного рекламного кабінету не знайдено (перевір права токена)' }; }

var overallResults = { accountsChecked: accounts.length, fetched: 0, created: 0, updated: 0, errors: 0, byAccount: {} };

for (var ai = 0; ai < accounts.length; ai++) {
  var acct = accounts[ai].id;
  var acctName = accounts[ai].name;
  var results = { fetched: 0, created: 0, updated: 0, errors: 0 };
  var after = null;
  var pages = 0;
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
    if (metaJson.error) { results.errors++; break; } // один кабінет може впасти — не зупиняємо решту
    var ads = Array.isArray(metaJson.data) ? metaJson.data : [];
    results.fetched += ads.length;

    // Паралельно в межах сторінки (CRM тепер локальний виклик — швидко й безпечно робити
    // одразу пачкою, а не по одному послідовно; це й було причиною таймауту 60с раніше).
    await Promise.all(ads.map(async function (a) {
      try {
        var body = {
          externalId: String(a.id),
          name: String(a.name || '').slice(0, 200),
          campaignId: a.campaign && a.campaign.id ? String(a.campaign.id) : null,
          campaignName: a.campaign && a.campaign.name ? String(a.campaign.name).slice(0, 200) : null,
          adSetId: a.adset && a.adset.id ? String(a.adset.id) : null,
          adSetName: a.adset && a.adset.name ? String(a.adset.name).slice(0, 200) : null,
          adAccountId: acct,
          adAccountName: acctName,
          thumbnailUrl: (a.creative && a.creative.thumbnail_url) ? String(a.creative.thumbnail_url) : null,
        };
        var crmRes = await fetch(crmBase + '/ads', { method: 'POST', headers: crmHdr, body: JSON.stringify(body) });
        var crmJson = await crmRes.json().catch(function () { return {}; });
        if (crmJson && crmJson.reused) results.updated++; else if (crmJson && crmJson.ok) results.created++; else results.errors++;
      } catch (e) { results.errors++; }
    }));

    after = (metaJson.paging && metaJson.paging.cursors && metaJson.paging.next) ? metaJson.paging.cursors.after : null;
    pages++;
    if (after) await sleep(300); // пауза лише МІЖ сторінками Meta API (rate-limit), не на кожен ad
  } while (after && pages < 40); // guard — до 2000 оголошень за прохід на кабінет

  overallResults.byAccount[acct] = results;
  overallResults.fetched += results.fetched;
  overallResults.created += results.created;
  overallResults.updated += results.updated;
  overallResults.errors += results.errors;
}

return { metaSyncResult: overallResults, metaSyncAt: new Date().toISOString() };
