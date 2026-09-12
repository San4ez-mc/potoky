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

// 2026-09-13 (власник: "це я хочу вибирати на сторінці", не хардкодити один акаунт у funnelKey):
// пріоритет вибору кабінету(-ів) для ЦЬОГО проходу:
//   1) context.metaAdAccountIds (масив) — ручний запуск із кнопки "Отримати дані зараз" на сторінці
//      Оголошення, власник сам обрав кабінет(и) у мультивиборі (CRM POST /ad-spend/sync-now
//      прокидає це через contextOverride при старті тестової сесії).
//   2) funnelKey META_AD_ACCOUNT_ID (явний override, кома-розділений список) — для щоденного крону.
//   3) інакше — auto-discovery через /me/adaccounts (усі кабінети, які бачить токен ЗАРАЗ).
var accounts = []; // [{id, name}]
if (Array.isArray(context.metaAdAccountIds) && context.metaAdAccountIds.length) {
  accounts = context.metaAdAccountIds.map(function (id) { return { id: String(id), name: null }; });
} else {
  var configuredAccts = (keys.META_AD_ACCOUNT_ID || '').trim();
  if (configuredAccts && configuredAccts.toLowerCase() !== 'auto') {
    accounts = configuredAccts.split(',').map(function (s) { return { id: s.trim(), name: null }; }).filter(function (a) { return a.id; });
  } else {
    try {
      var acctRes = await fetch('https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_status&limit=100&access_token=' + encodeURIComponent(token));
      var acctJson = await acctRes.json().catch(function () { return {}; });
      if (acctJson.error) { return { metaSyncStatus: 'error', metaSyncError: 'Meta API (me/adaccounts): ' + (acctJson.error.message || JSON.stringify(acctJson.error)) }; }
      accounts = (Array.isArray(acctJson.data) ? acctJson.data : []).map(function (a) { return { id: a.id, name: a.name || null }; });
    } catch (e) { return { metaSyncStatus: 'error', metaSyncError: 'не вдалось отримати список рекламних кабінетів: ' + e.message }; }
  }
}
if (!accounts.length) { return { metaSyncStatus: 'error', metaSyncError: 'жодного рекламного кабінету не знайдено (перевір права токена або вибір на сторінці)' }; }

var overallResults = { accountsChecked: accounts.length, fetched: 0, created: 0, updated: 0, errors: 0, byAccount: {} };

// 2026-09-13 (2-й таймаут 60с підряд): з ДВОМА кабінетами послідовний for-цикл сумарно
// перевищив ліміт (кожен окремо вкладався, разом — ні). Кабінети незалежні одне від одного —
// синкаємо всі ПАРАЛЕЛЬНО (Promise.all), час обмежує НАЙПОВІЛЬНІШИЙ кабінет, не сума всіх.
async function syncAccount(acctInfo) {
  var acct = acctInfo.id;
  var acctName = acctInfo.name;
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

  return { acct: acct, results: results };
}

var perAccount = await Promise.all(accounts.map(syncAccount));
perAccount.forEach(function (r) {
  overallResults.byAccount[r.acct] = r.results;
  overallResults.fetched += r.results.fetched;
  overallResults.created += r.results.created;
  overallResults.updated += r.results.updated;
  overallResults.errors += r.results.errors;
});

// 2026-09-13: metaSyncStatus/metaSyncDate/metaSyncAdsCount/metaSyncWritten — контракт, який ВЖЕ
// очікує CRM-кнопка "Отримати дані зараз" (apps/api/src/routes/ads.js POST /ad-spend/sync-now,
// існувала з 2026-09-01, чекала на бота, якого досі не було). metaSyncResult — повний деталізований
// об'єкт для власне debug/логів, лишаємо для сумісності з попередніми живими тестами цього крону.
return {
  metaSyncStatus: overallResults.errors > 0 && overallResults.fetched === 0 ? 'error' : 'ok',
  metaSyncDate: new Date().toISOString().slice(0, 10),
  metaSyncAdsCount: overallResults.fetched,
  metaSyncWritten: overallResults.created + overallResults.updated,
  metaSyncError: null,
  metaSyncResult: overallResults,
  metaSyncAt: new Date().toISOString(),
};
