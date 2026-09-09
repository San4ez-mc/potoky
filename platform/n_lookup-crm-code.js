// n_lookup — версія для НОВОЇ Fineko CRM (заміна n_lookup-code.js, який ходив у KeyCRM).
// Джерело даних: GET {CRM_API_BASE}/products (+ /suppliers, /categories) з Bearer CRM_API_KEY
// (per-bot funnelKey, tenant.apiKey нової CRM — окремий на goverla_shop і covercar_ua).
//
// Пріоритети матчингу — ТІ САМІ, що в n_lookup-code.js (KeyCRM), просто джерело даних інше,
// ПЛЮС новий найвищий пріоритет 0 (вимога власника, механізм уже готовий у CRM):
//   0) РУЧНА прив'язка Ad.externalId → Ad.productId (CRM, сторінка «Рекламні витрати»,
//      inline-редагування — рядки без товару підсвічені). externalId = mediaId БУДЬ-ЯКОГО
//      поста/рілса чи ad_id платної реклами, не лише платних кампаній. Це пряме рішення
//      власника, надійніше за будь-яке автоматичне вгадування нижче — якщо збіг є, решту
//      пріоритетів НЕ пробуємо.
//   1) ad_id/post_id — тепер це просто product.adMatchTokens[] (масив, а не CT_1001-кастомполе).
//   2) Артикул з тексту клієнта / підпису поста / adTitle — проти product.sku,
//      product.supplierArticle, offer.sku (той самий підхід, що matchArticle+offer-SKU
//      у KeyCRM-версії, лише поля прямі, без custom_fields-розкопок).
//   3) Keyword-overlap підпису проти product.displayName, тай-брейк за ціною (аудит 2026-08-29,
//      перенесено 1:1 з KeyCRM-версії — та сама логіка виявилась потрібна і тут).
//   4) Gemini-візія проти каталогу displayName — 1:1 як у KeyCRM-версії.
//   ОСТАННІЙ РЕЗЕРВ DEFAULT_AD_ID/демо-товар — СВІДОМО НЕ переносимо (антипатерн A1,
//   fineko-funnel-standard §4: демо-фолбек у проді підставляв реальним клієнтам не той
//   товар). Немає збігу — чесно productUnknown:true, без вгадування.
//
// Нове порівняно з KeyCRM-версією (нова CRM дає це "з коробки", без ручного парсингу):
//   - isSet/setComponents — вже структуровані поля Product, не треба розбирати CT_1005-рядок;
//   - companionProductIds — вже масив id, не треба шукати токени в CT_1002;
//   - sizeChartData/sizeChartImage/aiNotes/bulkPricing — прямі поля, не CT_1010/1011/1012;
//   - product.supplier/{id,name} — повний supplier-запис (mechanism/логін/aiNotes/telegram)
//     довантажуємо окремим GET /suppliers один раз і кладемо в product.supplierInfo (§4 ТЗ);
//   - product.category/{id,name} — requiredParams категорії довантажуємо GET /categories один
//     раз і кладемо в product.categoryParams (§3 ТЗ) — n_size сам перекладає їх у питання,
//     без хардкоду "зріст/вага" в коді ноди.
//
// ⚠️ displayName (=customerName||name) — це те, що бачить клієнт. Внутрішнє product.name
// лишається тільки для полів, які клієнт не читає напряму (розширений матчинг/лог).
// 2026-09-08 (скан 367 сесій: картка двічі у 12 розмовах — пост, а за кілька секунд «Яка ціна кофти?» окремим повідомленням):
// ранній вихід «товар той самий» має нести skipPresentation, інакше лишається старе false з першого показу → картка знову.
if (context.product && context.product._source === 'crm' && (String(context.product._matchKey) === String(context.entryAd || context.__lk || '') || !context.hasFreshSignalThisTurn)) return { skipPresentation: !!(context.product.sku && context.presentedAt && (Date.now() - Number(context.presentedAt)) < 30 * 60 * 1000) };

function fallback(reason) {
  var o = { product: null, productUnknown: true, productUnknownReason: reason || '' };
  // конфлікт привʼязки реклами (список категорії замість хибної картки) теж має піти менеджеру — n_ad_conflict_cond
  if (context.adLinkMismatch && context.adLinkMismatch !== context.adLinkMismatchSeen) { o.adLinkMismatchAt = Date.now(); o.adLinkMismatchSeen = context.adLinkMismatch; }
  return o;
}

var apiKey = (keys.CRM_API_KEY || '').trim();
var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var publicBase = (keys.CRM_PUBLIC_BASE || 'https://pcrm.fineko.space').replace(/\/$/, '');
if (!apiKey) return fallback('CRM_API_KEY не заповнено');
function hdr() { return { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' }; }
function resolveUrl(u) { if (!u) return ''; return /^https?:\/\//i.test(u) ? u : (publicBase + (u.charAt(0) === '/' ? u : '/' + u)); }

// 2026-09-08 (mashavoloshka: «артикул А0182» з кириличною «А» → товар не перемкнувся): схожі кириличні літери перед цифрами → латиниця.
function latinizeLookalikes(x) { var M = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'н': 'h', 'і': 'i', 'к': 'k', 'м': 'm', 'о': 'o', 'р': 'p', 'т': 't', 'х': 'x', 'у': 'y' }; return String(x || '').replace(/[АВСЕНІКМОРТХУавсенікмортху]{1,4}(?=\d{2,8})/g, function (seq) { return seq.split('').map(function (ch) { return M[ch] || ch; }).join(''); }); }
function extractArticles(txt) {
  if (!txt) return [];
  var s = latinizeLookalikes(String(txt)); var out = []; var m;
  var re1 = /(?:артикул|арт\.?|art|код|sku|#|№)\s*[:#№.\-]?\s*([A-Za-zА-Яа-яІЇЄҐіїєґ]{0,5}\d{2,8})/gi; while ((m = re1.exec(s))) { out.push(m[1].toUpperCase()); }
  var re2 = /\b([A-Za-z]\d{3,6})\b/g; while ((m = re2.exec(s))) { out.push(m[1].toUpperCase()); }
  var re3 = /\b(\d{4,8})\b/g; while ((m = re3.exec(s))) { out.push(m[1]); }
  var seen = {}, res = []; for (var i = 0; i < out.length; i++) { if (!seen[out[i]]) { seen[out[i]] = 1; res.push(out[i]); } } return res;
}
function matchByAdToken(all, adId) {
  if (!adId) return null;
  var A = String(adId).trim();
  for (var i = 0; i < all.length; i++) { var toks = all[i].adMatchTokens || []; for (var j = 0; j < toks.length; j++) { if (String(toks[j]).trim() === A) return all[i]; } }
  return null;
}
function matchArticle(all, art) {
  if (!art) return null; var A = String(art).toUpperCase().trim();
  for (var i = 0; i < all.length; i++) {
    var p = all[i];
    if (p.sku && String(p.sku).toUpperCase().trim() === A) return p;
    if (p.supplierArticle && String(p.supplierArticle).toUpperCase().trim() === A) return p;
    var offs = p.offers || [];
    for (var j = 0; j < offs.length; j++) { if (offs[j].sku && String(offs[j].sku).toUpperCase().trim() === A) return p; }
  }
  return null;
}
function offerPreColorSize(all, art) {
  var A = String(art).toUpperCase().trim();
  for (var i = 0; i < all.length; i++) {
    var offs = all[i].offers || [];
    // Живий прогін covercar 2026-09-04: у CRM перший offer часто має sku = sku самого товару
    // ("40001" = і товар, і варіант "Світло-сірий") — клієнт написав артикул ТОВАРУ, а бот мовчки
    // "обирав" колір і пропускав крок вибору. Товарний sku НЕ рахуємо як вибір варіанта.
    if (all[i].sku && String(all[i].sku).toUpperCase().trim() === A) continue;
    for (var j = 0; j < offs.length; j++) {
      if (offs[j].sku && String(offs[j].sku).toUpperCase().trim() === A) {
        var props = offs[j].properties || []; var color = '', size = '';
        for (var k = 0; k < props.length; k++) { var nm = String(props[k].name || '').toLowerCase(); if (nm.indexOf('колір') >= 0 || nm.indexOf('цвет') >= 0) color = props[k].value; if (nm.indexOf('розмір') >= 0 || nm.indexOf('размер') >= 0) size = props[k].value; }
        return { product: all[i], color: color, size: size };
      }
    }
  }
  return null;
}

try {
  var __apiCalls = await Promise.all([
    fetch(base + '/products?take=300', { headers: hdr() }),
    fetch(base + '/ads?take=300', { headers: hdr() })
  ]);
  var pr = __apiCalls[0], adsR = __apiCalls[1];
  if (!pr.ok) return fallback('CRM /products HTTP ' + pr.status);
  var pd = await pr.json();
  var all = (pd && pd.data) || [];
  if (!all.length) return fallback('Каталог CRM порожній');
  var adsList = [];
  if (adsR && adsR.ok) { try { var adsJ = await adsR.json(); adsList = (adsJ && adsJ.data) || []; } catch (e) { } }

  var found = null, via = '', mk = '', preColor = '', preSize = '', preFromUser = false;

  // ПРІОРИТЕТ 0 (найвищий — прямо за вимогою власника): РУЧНА прив'язка Ad.externalId →
  // Ad.productId у CRM (сторінка «Рекламні витрати», inline-редагування — рядки без товару
  // підсвічені). externalId — mediaId БУДЬ-ЯКОГО поста/рілса чи ad_id платної реклами, не лише
  // платних кампаній. Це пряме рішення власника — надійніше за будь-яке автоматичне вгадування
  // нижче (артикул/keyword/vision), тож якщо знайдено — ЖОДНОГО іншого матчингу далі не робимо.
  var __adExternalId = String(context.entryAd || (context.sharedPost && context.sharedPost.mediaId) || '').trim();
  if (__adExternalId && adsList.length) {
    var __adHit = adsList.filter(function (a) { return String(a.externalId || '').trim() === __adExternalId && a.productId; })[0];
    if (__adHit) {
      var __byAdProd = all.filter(function (x) { return String(x.id) === String(__adHit.productId); })[0];
      if (__byAdProd) { found = __byAdProd; via = 'ad_manual_link'; mk = 'adlink_' + __adExternalId; }
    }
  }

  // ПРІОРИТЕТ 1: ad_id/post_id — авто-теги на товарі (adMatchTokens), коли ручної прив'язки
  // в Ad (Пріоритет 0) для цього mediaId ще нема.
  if (!found && context.entryAd) { found = matchByAdToken(all, String(context.entryAd)); if (found) { via = 'ad_id'; mk = String(context.entryAd); } }

  // ПРІОРИТЕТ 1.5 (тест Олексія 2026-09-04 22:27, «Яка ціна кофти?» як відповідь на рекламу): ad_id
  // 120250805751140329 ще не був синхронізований у CRM, але НАЗВА реклами («Допис в Instagram:
  // Вʼязана чоловіча кофта...._Group_1») збігається з іншими вже привʼязаними рекламами тієї ж
  // кампанії. Якщо всі реклами з такою назвою ведуть на ОДИН товар — беремо його (це рішення
  // менеджера про привʼязку, лише перенесене на новий ad_id).
  function __normAdName(s) { return String(s || '').toLowerCase().replace(/_group_\d+/g, '').replace(/^допис в instagram:\s*/i, '').replace(/[.…]+$/g, '').replace(/[^\wа-яіїєґ\s]/gi, ' ').replace(/\s+/g, ' ').trim(); }
  if (!found && context.adTitle && adsList.length) {
    var __adT = __normAdName(context.adTitle);
    if (__adT.length >= 8) {
      var __adProds = {};
      adsList.forEach(function (a) { if (a.productId && __normAdName(a.name) === __adT) __adProds[String(a.productId)] = 1; });
      var __adProdIds = Object.keys(__adProds);
      if (__adProdIds.length === 1) {
        var __byTitle = all.filter(function (x) { return String(x.id) === __adProdIds[0]; })[0];
        if (__byTitle) { found = __byTitle; via = 'ad_title'; mk = 'adtitle_' + __adProdIds[0]; }
      }
    }
  }

  // ПРІОРИТЕТ 1.7 (2026-09-04, питання власника «а отримати повний текст реклами ще одним запитом?»):
  // так — за post_id/ad_id з referral тягнемо через Graph API повний підпис поста (там є артикул)
  // і картинку креативу. Ключі: INSTAGRAM_ACCESS_TOKEN (медіа IG), META_SYSTEM_USER_TOKEN (креатив
  // реклами) — беруться з ключів воронки, якщо є. Best-effort, 4 с на запит.
  var __adCaption = String(context.adCaption || '');
  var __adImage = '';
  // 2026-09-07 (Віталій, реклама 120250869745720329): ручна привʼязка в CRM вела на 234286, а в пості реклами
  // «Артикул: sh667999» — бот показав не той товар. Текст реклами тягнемо і коли товар знайдено ЧЕРЕЗ рекламу,
  // щоб звірити артикул (див. override нижче).
  var __viaAd = /^ad_/.test(via);
  if ((!found || __viaAd) && !__adCaption) {
    try {
      var __acd0 = (context.lastReferral && context.lastReferral.ads_context_data) || {};
      var __pid = String(__acd0.post_id || context.postId || '').trim();
      var __aid = String(context.entryAd || '').trim();
      var __igTok = String(keys.INSTAGRAM_ACCESS_TOKEN || '').trim();
      var __muTok = String(keys.META_SYSTEM_USER_TOKEN || '').trim();
      var __gErr = [];
      async function __gget(path, tok) { var acg = new AbortController(); var tog = setTimeout(function () { try { acg.abort(); } catch (e) {} }, 4000); try { var rg = await fetch('https://graph.facebook.com/v21.0/' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + encodeURIComponent(tok), { signal: acg.signal }); var jg = await rg.json().catch(function () { return {}; }); if (!rg.ok) { __gErr.push(path.split('?')[0] + ': ' + rg.status + ' ' + String((jg.error && jg.error.message) || '').slice(0, 160)); return null; } return jg; } catch (e) { __gErr.push(path.split('?')[0] + ': ' + e.message); return null; } finally { clearTimeout(tog); } }
      if (__pid && __igTok) {
        var __m = await __gget(__pid + '?fields=caption,media_url,thumbnail_url,permalink', __igTok);
        if (__m && (__m.caption || __m.media_url)) { __adCaption = String(__m.caption || ''); __adImage = String(__m.thumbnail_url || __m.media_url || ''); }
      }
      // 2026-09-05: системний токен (з CRM, має instagram_basic) — фолбек для post_id, коли IG-токена нема або він невалідний.
      if (!__adCaption && __pid && __muTok) {
        var __m2 = await __gget(__pid + '?fields=caption,media_url,thumbnail_url', __muTok);
        if (__m2 && (__m2.caption || __m2.media_url)) { __adCaption = String(__m2.caption || ''); __adImage = String(__m2.thumbnail_url || __m2.media_url || ''); }
        // post_id з referral буває постом Facebook-сторінки (не IG-медіа): «nonexisting field (caption)» → message/full_picture
        if (!__adCaption) { var __m3 = await __gget(__pid + '?fields=message,full_picture', __muTok); if (__m3 && (__m3.message || __m3.full_picture)) { __adCaption = String(__m3.message || ''); __adImage = __adImage || String(__m3.full_picture || ''); } }
      }
      // 2026-09-08 (_sergey_nesteruk: entryAd=18089766755652603 — це IG-медіа, не реклама): спершу пробуємо як медіа.
      if (!__adCaption && __aid && /^1[78]\d{14,16}$/.test(__aid) && __muTok) {
        var __mm = await __gget(__aid + '?fields=caption,media_url,thumbnail_url,permalink', __muTok);
        if (__mm && (__mm.caption || __mm.media_url)) { __adCaption = String(__mm.caption || ''); __adImage = String(__mm.thumbnail_url || __mm.media_url || ''); }
      }
      if (!__adCaption && __aid && __muTok) {
        var __ad = await __gget(__aid + '?fields=creative{effective_object_story_id,body,thumbnail_url,object_story_spec}', __muTok);
        var __cr = (__ad && __ad.creative) || null;
        if (__cr) {
          __adCaption = String(__cr.body || ((__cr.object_story_spec || {}).video_data || {}).message || ((__cr.object_story_spec || {}).link_data || {}).message || '');
          __adImage = String(__cr.thumbnail_url || '');
          if (!__adCaption && __cr.effective_object_story_id) { var __st = await __gget(__cr.effective_object_story_id + '?fields=message,full_picture', __muTok); if (__st) { __adCaption = String(__st.message || ''); __adImage = __adImage || String(__st.full_picture || ''); } }
        }
      }
    } catch (e) { __adCaption = __adCaption || ''; }
    if (__adCaption) context.adCaption = __adCaption;
    if (__adImage) context.adImage = __adImage;
    if (typeof __gErr !== 'undefined' && __gErr.length) context.adCaptionError = __gErr.join(' | ').slice(0, 400);
    if (__adCaption) context.adCaptionError = ''; // текст отримано — старі помилки проміжних запитів не показуємо
    if (!__igTok && !__muTok) context.adCaptionError = 'немає META_SYSTEM_USER_TOKEN (задається в CRM → Автоматизації, передається у воронку автоматично)';
  }

  // Звірка привʼязки реклами з артикулом у самому пості/рілсі: артикул із тексту реклами або пересланого поста
  // сильніший за ручну привʼязку (це те, що клієнт реально бачив). Розбіжність → context.adLinkMismatch (менеджеру).
  if (found && __viaAd) {
    var __capArts = extractArticles(__adCaption || '').concat(extractArticles((context.sharedPost && context.sharedPost.caption) || ''));
    for (var __ca = 0; __ca < __capArts.length; __ca++) {
      var __capProd = matchArticle(all, __capArts[__ca]);
      if (__capProd && String(__capProd.id) !== String(found.id)) {
        // 2026-09-08: Босий 14:24 — у CRM привʼязка C0043 вірна, у тексті поста A0187 помилково; Tyurin 19:01 — навпаки: привʼязка A0182
        // (куртка) хибна, у тексті D0050 (кофта) вірно. Арбітр — слова клієнта: категорія з його повідомлення («ціна КОФТИ»)
        // збігається лише з одним із двох → беремо його. Без категорії або збіг в обох → привʼязка CRM (рішення власника).
        // Розбіжність у будь-якому разі йде менеджеру (adLinkMismatch). Нові реклами n_lookup не привʼязує сам (productId:null).
        var __ovTxt = String(context.lastUserMessage || input || '').replace(/\[переслав[^\]]*\][^\n]*/gi, ' ').toLowerCase();
        var __ovStemM = __ovTxt.match(/(кофт|светр|футболк|джинс|бомбер|куртк|вітровк|костюм|штан|лофер|кросівк|черевик|худі|шапк|туфл|кед|накидк|підголівник)/); var __ovStem = __ovStemM ? __ovStemM[1] : '';
        var __ovSyn = { 'куртк': ['куртк', 'вітровк'], 'вітровк': ['вітровк', 'куртк'], 'светр': ['светр', 'кофт'], 'штан': ['штан', 'джинс'], 'кед': ['кед', 'кросівк'] };
        var __ovHas = function (p) { var h = (String(p.customerName || '') + ' ' + String(p.name || '')).toLowerCase(); return (__ovSyn[__ovStem] || [__ovStem]).some(function (x) { return h.indexOf(x) >= 0; }); };
        var __capWins = !!(__ovStem && __ovHas(__capProd) && !__ovHas(found));
        if (__capWins) {
          context.adLinkMismatch = 'реклама ' + (context.entryAd || __adExternalId || '') + ' у CRM привʼязана до ' + (found.sku || found.name) + ', а в тексті поста артикул ' + __capArts[__ca] + ' — клієнт питав про «' + __ovStem + '», показано ' + (__capProd.sku || __capProd.name) + ' за текстом поста; перевірте привʼязку в CRM';
          found = __capProd; via = 'ad_caption_override:' + __capArts[__ca]; mk = 'art_' + __capArts[__ca];
        } else {
          context.adLinkMismatch = 'реклама ' + (context.entryAd || __adExternalId || '') + ' у CRM привʼязана до ' + (found.sku || found.name) + ', а в тексті поста артикул ' + __capArts[__ca] + ' — показано товар за привʼязкою CRM; якщо помилка — перепривʼяжіть';
        }
        break;
      }
      if (false) {
        context.adLinkMismatch = 'реклама ' + (context.entryAd || __adExternalId || '') + ' у CRM привʼязана до ' + (found.sku || found.name) + ', а в тексті поста артикул ' + __capArts[__ca] + ' — показано товар за артикулом; перевірте привʼязку в CRM';
        found = __capProd; via = 'ad_caption_override:' + __capArts[__ca]; mk = 'art_' + __capArts[__ca];
        break;
      }
      if (__capProd) break; // артикул у пості збігається з привʼязкою — все гаразд
    }
  }

  // ПРІОРИТЕТ 2: артикул (з тексту клієнта / підпису поста / adTitle / повного тексту реклами)
  if (!found) {
    var fromUser = extractArticles(context.lastUserMessage || input || '');
    var cands = fromUser.concat(extractArticles((context.sharedPost && context.sharedPost.caption) || '')).concat(extractArticles(__adCaption || '')).concat(extractArticles(context.adTitle || ''));
    // 2026-09-08 (vadim.lutchenko + 19 з 22 коментаторів за добу): товар, який Zernio-автоматизація презентувала в DM
    // після коментаря (handleCommentReceived → commentProductArticle). Найнижчий пріоритет серед артикулів, діє 72 год.
    // n_catalog_hint визначив товар за назвою зі списку/каталогу (catalogHintPick) → перший кандидат.
    if (context.catalogHintPick) { cands = [String(context.catalogHintPick).toUpperCase()].concat(cands); context.catalogHintPick = ''; }
    var __commentArt = ''; var __commentAge = Date.now() - (Date.parse(context.commentProductAt || '') || 0);
    // 2026-09-08 (Maltsev: менеджер «готовою відповіддю» показав картку з «Артикул: A0187», бот після відновлення товару не знав):
    // артикул з останнього повідомлення менеджера (managerArticleHint, zernioHandler) — як підказка з коментаря.
    var __mgrAge = Date.now() - (Date.parse(context.managerArticleAt || '') || 0);
    if (context.managerArticleHint && __mgrAge < 6 * 3600 * 1000 && (!context.commentProductArticle || __mgrAge < __commentAge)) { context.commentProductArticle = context.managerArticleHint; __commentAge = __mgrAge; }
    if (context.commentProductArticle && __commentAge < 72 * 3600 * 1000) { __commentArt = String(context.commentProductArticle).toUpperCase(); if (!cands.length || cands.map(function (x) { return String(x).toUpperCase(); }).indexOf(__commentArt) < 0) cands = cands.concat([__commentArt]); }
    var seen = {}, cc = []; for (var ci = 0; ci < cands.length; ci++) { if (!seen[cands[ci]]) { seen[cands[ci]] = 1; cc.push(cands[ci]); } } cc = cc.slice(0, 8);
    // 2a) offer-SKU → товар + колір/розмір цього оферу
    for (var a = 0; a < cc.length && !found; a++) {
      var hit = offerPreColorSize(all, cc[a]);
      if (hit) { found = hit.product; via = 'offer:' + cc[a]; mk = 'art_' + cc[a]; preColor = hit.color; preSize = hit.size; preFromUser = (fromUser.indexOf(cc[a]) >= 0); }
    }
    // 2b) артикул на рівні товару (sku / supplierArticle / будь-який offer.sku)
    if (!found) { for (var b = 0; b < cc.length && !found; b++) { var pm = matchArticle(all, cc[b]); if (pm) { found = pm; via = 'article:' + cc[b]; mk = 'art_' + cc[b]; } } }
  }

  // ПРІОРИТЕТ 2.5: keyword-overlap підпису проти displayName, тай-брейк за ціною
  // Джерело слів: підпис пересланого поста, а якщо його нема — назва реклами (відповідь на рекламу
  // без синхронізованого ad_id, 2026-09-04).
  var __kwSource = (context.sharedPost && context.sharedPost.caption) || __adCaption || (context.adTitle ? __normAdName(context.adTitle) : '');
  if (!found && __kwSource) {
    var STOPWORDS_KW = { 'та': 1, 'і': 1, 'й': 1, 'на': 1, 'до': 1, 'за': 1, 'від': 1, 'для': 1, 'або': 1, 'це': 1, 'вже': 1, 'ще': 1, 'як': 1, 'що': 1, 'по': 1, 'при': 1, 'без': 1, 'між': 1 };
    // 2026-09-08: слова порівнюємо за 5-літерним коренем («замшевий»≈«замш», «вʼязана»≈«вязан»); джерело назв — name + customerName + displayName
    // (mykola: підпис поста комплекту «кофта, джинси, футболка, лофери» не збігався з displayName «Комплект 4 в 1»).
    function tokenizeKW(s) { return String(s || '').toLowerCase().replace(/[’'`ʼ]/g, '').replace(/[^\wа-яіїєґ\s]/gi, ' ').split(/\s+/).filter(function (w) { return w.length >= 4 && !STOPWORDS_KW[w]; }).map(function (w) { return w.slice(0, 5); }); }
    var capWordsKW = tokenizeKW(__kwSource);
    if (capWordsKW.length) {
      var capSetKW = {}; for (var wi = 0; wi < capWordsKW.length; wi++) capSetKW[capWordsKW[wi]] = 1;
      var scoredKW = [];
      for (var pi3 = 0; pi3 < all.length; pi3++) {
        var pnameWordsKW = tokenizeKW([all[pi3].name, all[pi3].customerName, all[pi3].displayName].filter(Boolean).join(' ')); pnameWordsKW = pnameWordsKW.filter(function (w, i) { return pnameWordsKW.indexOf(w) === i; });
        var overlapKW = 0; for (var wj = 0; wj < pnameWordsKW.length; wj++) { if (capSetKW[pnameWordsKW[wj]]) overlapKW++; }
        if (overlapKW > 0) scoredKW.push({ p: all[pi3], score: overlapKW });
      }
      scoredKW.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        var ap = Number(a.p.price) || 0, bp = Number(b.p.price) || 0;
        return (bp > 0 ? 1 : 0) - (ap > 0 ? 1 : 0);
      });
      if (scoredKW.length && scoredKW[0].score >= 2) {
        var __topScore = scoredKW[0].score;
        var __topPrice = Number(scoredKW[0].p.price) || 0;
        var __tiedRivals = scoredKW.filter(function (x, xi) { return xi > 0 && x.score === __topScore; });
        var __ambiguous = __tiedRivals.some(function (x) { var xp = Number(x.p.price) || 0; return (__topPrice > 0) === (xp > 0); });
        if (!__ambiguous) { found = scoredKW[0].p; via = 'keyword:' + __topScore; mk = 'kw_' + scoredKW[0].p.id; }
      }
    }
  }

  // ПРІОРИТЕТ 2.9: Gemini-візія проти каталогу (скрін клієнта або обкладинка пересланого поста)
  // Картинка реклами з referral (ads_context_data.photo_url / video_url → facebook.com/ads/image) —
  // ще одне джерело для візії, коли клієнт відповів на рекламу без поста й артикулу (2026-09-04).
  var __refImg = '';
  try { var __acd = (context.lastReferral && context.lastReferral.ads_context_data) || {}; __refImg = String(__acd.photo_url || __acd.image_url || __acd.video_url || ''); } catch (e) { __refImg = ''; }
  var __visionUrl = context.lastUserImageUrl || (!found && context.sharedPost && context.sharedPost.url) || (!found && __adImage) || (!found && __refImg) || '';
  if (!found && __visionUrl && keys.GEMINI_API_KEY) {
    function imgOk(u) { try { var h = new URL(u).hostname.toLowerCase(); if (h === 'api.telegram.org') return true; return ['cdninstagram.com', 'fbcdn.net', 'fbsbx.com', 'lookaside.fbsbx.com', 'facebook.com'].some(function (d) { return h === d || h.endsWith('.' + d); }); } catch (e) { return false; } }
    if (imgOk(__visionUrl)) {
      var acp = new AbortController(); var top = setTimeout(function () { try { acp.abort(); } catch (e) { } }, 10000);
      try {
        var irp = await fetch(__visionUrl, { signal: acp.signal });
        var abp = await irp.arrayBuffer();
        if (abp.byteLength <= 8000000) {
          var b64p = Buffer.from(abp).toString('base64');
          var mimepRaw = (irp.headers.get('content-type') || '').split(';')[0];
          var mimep = (!mimepRaw || mimepRaw === 'application/octet-stream') ? 'image/jpeg' : mimepRaw;
          var catList = all.map(function (p, i) { return i + ': ' + (p.displayName || p.name || ''); }).join('\n').slice(0, 6000);
          var promptp = 'Це фото (скріншот, або обкладинка допису/рілсу), яке клієнт показав — ймовірно, товар з нашого магазину. Опиши коротко, що на фото (тип товару, колір, помітний текст/бренд). Потім знайди НАЙБЛИЖЧИЙ відповідник у каталозі нижче (формат: індекс: назва). Якщо жодного релевантного немає — bestMatchIndex null. Поверни ЛИШЕ JSON {"description":"...","bestMatchIndex":число_або_null}.\nКаталог:\n' + catList;
          var grp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(keys.GEMINI_API_KEY), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: promptp }, { inline_data: { mime_type: mimep, data: b64p } }] }] }) });
          var gjp = await grp.json();
          var tp = ((((gjp.candidates || [])[0] || {}).content || {}).parts || [{}])[0].text || '';
          var mmp = tp.match(/\{[\s\S]*\}/);
          if (mmp) { var fp = JSON.parse(mmp[0]); if (fp.bestMatchIndex != null && all[fp.bestMatchIndex]) { found = all[fp.bestMatchIndex]; via = 'photo'; mk = 'photo_' + fp.bestMatchIndex; } }
        }
      } catch (e) { } finally { clearTimeout(top); }
    }
  }

  // Реєструємо НОВУ рекламу в CRM (ad_id, якого ще нема в /ads): з товаром, якщо визначили, або без —
  // тоді рядок підсвітиться менеджеру на сторінці «Рекламні витрати» для ручної привʼязки. Best-effort.
  if (context.entryAd && !context.testMode && !adsList.some(function (a) { return String(a.externalId || '') === String(context.entryAd); })) {
    try {
      var __campaign = (context.lastReferral && context.lastReferral.ads_context_data) || {};
      await fetch(base + '/ads', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr()), body: JSON.stringify({
        externalId: String(context.entryAd), name: String(context.adTitle || __campaign.ad_title || 'Реклама ' + context.entryAd).slice(0, 200),
        productId: null, campaignName: String(context.adTitle || '').replace(/_group_\d+/i, '').slice(0, 200) || null,
      }) });
    } catch (e) { /* best-effort */ }
  }

  // ── Намір клієнта за категорією (бойовий старт 2026-09-07): Артур з реклами комплекту «кофта, джинси…»
  // (привʼязка → джинси) написав «Цікавить кофта»; Ігор без ad_id/рілса написав «Яка ціна куртки?».
  // Слово-категорія з повідомлення клієнта звіряється з назвою знайденого товару.
  context.setComponentHint = '';
  try {
    var __stemRe2 = /(кофт|футболк|джинс|бомбер|куртк|вітровк|костюм|штан|лофер|кросівк|худі|светр|шапк|туфл|черевик|кед|накидк|підголівник)/i;
    var __uTxt = String(context.lastUserMessage || input || '').replace(/\[переслав[^\]]*\][^\n]*/gi, ' ');
    var __uStemM = __uTxt.match(__stemRe2); var __uStem = __uStemM ? __uStemM[1].toLowerCase() : '';
    var __SYN2 = { 'куртк': ['куртк', 'вітровк'], 'вітровк': ['вітровк', 'куртк'], 'светр': ['светр', 'кофт'], 'штан': ['штан', 'джинс'], 'кед': ['кед', 'кросівк'] };
    function __hasStem(p, s) { var h = (String(p.customerName || '') + ' ' + String(p.name || '')).toLowerCase(); return (__SYN2[s] || [s]).some(function (x) { return h.indexOf(x) >= 0; }); }
    function __compId(c) { return String(c.productId || c.componentProductId || c.componentId || ''); }
    if (__uStem && found && /^ad_/.test(via) && !__hasStem(found, __uStem)) {
      // реклама комплекту/колажу: компоненти наборів, що містять знайдений товар, з категорії, яку назвав клієнт
      var __comp = [];
      all.forEach(function (s) {
        if (!s.isSet) return;
        var cs = s.setComponents || s.setOf || [];
        if (!cs.some(function (c) { return __compId(c) === String(found.id) || (c.sku && found.sku && String(c.sku).toUpperCase() === String(found.sku).toUpperCase()); })) return;
        cs.forEach(function (c) { var cp = all.filter(function (x) { return String(x.id) === __compId(c) || (c.sku && x.sku && String(x.sku).toUpperCase() === String(c.sku).toUpperCase()); })[0]; if (cp && !cp.isSet && __hasStem(cp, __uStem) && __comp.indexOf(cp) < 0) __comp.push(cp); });
      });
      if (__comp.length === 1) { context.adSetNote = 'реклама комплекту (привʼязка ' + (found.sku || '') + '), клієнт спитав про «' + __uStem + '» → показано ' + __comp[0].sku; found = __comp[0]; via = 'ad_set_component'; mk = 'setcomp_' + String(found.sku || found.id); }
      else if (__comp.length > 1) {
        context.setComponentHint = __comp.slice(0, 4).map(function (p) { return (p.sku ? ('Артикул ' + p.sku + ' — ') : '') + String(p.customerName || p.name || '').replace(/\.?\s*Артикул:.*$/i, '').trim() + (Number(p.price) ? (' — ' + Number(p.price) + ' грн') : ''); }).join('\n');
        found = null; via = ''; mk = '';
      } else if (!found.isSet && !__comp.length) {
        // 2026-09-08 19:01 (Tyurin: реклама привʼязана до куртки A0182, клієнт питає «Яка ціна КОФТИ?», тексту поста нема):
        // товар з привʼязки не з тієї категорії, що просить клієнт → не показуємо його, а даємо список категорії (n_catalog_hint).
        context.adLinkMismatch = 'реклама ' + (context.entryAd || '') + ' у CRM привʼязана до ' + (found.sku || found.name) + ', а клієнт питає про «' + __uStem + '» — показано список категорії; перевірте привʼязку в CRM';
        found = null; via = ''; mk = '';
      }
    } else if (__uStem && !found) {
      var __byStem = all.filter(function (p) { return !p.isSet && __hasStem(p, __uStem); });
      if (__byStem.length === 1) { found = __byStem[0]; via = 'user_keyword:' + __uStem; mk = 'kw_' + String(found.sku || found.id); }
    }
    // 2026-09-08 04:54 (_grigoriy_): бот показав список костюмів, клієнт відповів «надішліть зображення костюму (мажор)» —
    // «Мажор» є і в костюма A0114, і в кофти D0050, тож за назвою не визначили. Слово з повідомлення звіряємо СПОЧАТКУ
    // з товарами щойно показаного списку (context.catalogHintSkus від n_catalog_hint), потім — з усім каталогом; беремо,
    // лише коли збіг рівно один. Знайдений товар презентується з фото — це й відповідь на «надішліть зображення».
    if (!found) {
      var __STOPW = { 'надіслати': 1, 'надішліть': 1, 'зображення': 1, 'могли': 1, 'можете': 1, 'будь': 1, 'ласка': 1, 'дякую': 1, 'ціна': 1, 'ціну': 1, 'розмір': 1, 'колір': 1, 'фото': 1, 'скиньте': 1, 'скинути': 1, 'підберіть': 1, 'зріст': 1, 'вага': 1, 'чорний': 1, 'чорну': 1, 'сірий': 1, 'білий': 1, 'синій': 1, 'хочу': 1, 'цікавить': 1, 'артикул': 1, 'костюм': 1, 'костюму': 1, 'кофта': 1, 'кофту': 1, 'куртка': 1, 'куртку': 1, 'бомбер': 1, 'джинси': 1, 'футболка': 1, 'лофери': 1, 'товар': 1, 'товару': 1, 'пост': 1, 'який': 1, 'яка': 1, 'можна': 1, 'вітаю': 1, 'привіт': 1, 'добрий': 1, 'день': 1, 'вечір': 1, 'ранок': 1, 'наявності': 1, 'наявність': 1 };
      var __uw = __uTxt.toLowerCase().replace(/[^a-zа-яіїєґ0-9\s]/gi, ' ').split(/\s+/).filter(function (w) { return w.length >= 4 && !__STOPW[w]; });
      function __nameHits(list) { return list.filter(function (p) { var h = (String(p.name || '') + ' ' + String(p.customerName || '')).toLowerCase(); return __uw.some(function (w) { return h.indexOf(w) >= 0; }); }); }
      if (__uw.length) {
        var __hintSkus = String(context.catalogHintSkus || '').toUpperCase().split(',').filter(Boolean);
        var __hintProds = __hintSkus.length ? all.filter(function (p) { return __hintSkus.indexOf(String(p.sku || '').toUpperCase()) >= 0; }) : [];
        var __nh = __nameHits(__hintProds);
        if (__nh.length === 1) { found = __nh[0]; via = 'user_name_from_list'; mk = 'kw_' + String(found.sku || found.id); }
        else if (!__nh.length) {
          var __na = __nameHits(all.filter(function (p) { return !p.isSet; }));
          // «костюм мажор» / «кофта мажор»: кілька збігів за словом → звужуємо категорією з повідомлення
          if (__na.length > 1 && __uStem) __na = __na.filter(function (p) { return __hasStem(p, __uStem); });
          if (__na.length === 1) { found = __na[0]; via = 'user_name'; mk = 'kw_' + String(found.sku || found.id); }
        }
      }
    }
  } catch (e) { context.__dbg = 'category-intent: ' + String(e && e.message); }

  if (!found) return fallback('Жоден пріоритет матчингу не спрацював (ad_id/артикул/keyword/vision)');

  // Аудит 2026-09-04: впевненість матчингу → у промпти діалогових нод через
  // {{context.product.matchNote}}. Раніше всі промпти казали "товар ОДНОЗНАЧНО підтверджено,
  // НІКОЛИ не пиши, що не знайдено" навіть для keyword/photo-збігу — і модель наполягала на
  // не тому товарі. Низька впевненість дозволяє моделі визнати помилку через
  // json_output {"productMismatch":true} (двигун скидає товар і просить пост/артикул).
  var __lowConfidence = /^(keyword|photo)/.test(via);
  var __matchNote = __lowConfidence
    ? '⚠️ Товар вище підібрано АВТОМАТИЧНО за схожістю (' + (via.indexOf('photo') === 0 ? 'за фото' : 'за описом поста') + '), без точного артикулу. Якщо клієнт каже, що це не той товар, описує явно інший, або сумнівається — НЕ наполягай: коротко вибачся, попроси скинути пост/рілс або назвати артикул і поверни json_output {"productMismatch":true}. Якщо клієнт підтверджує або просто продовжує розмову про цей товар — працюй як завжди.'
    : '⚠️ Товар вище вже ОДНОЗНАЧНО підтверджено системою за артикулом/кодом/рекламою, які назвав чи відкрив клієнт — НІКОЛИ не пиши, що товар/артикул "не знайдено" чи "немає в каталозі", навіть якщо точний код не видно в описі нижче. Завжди довіряй даним про товар вище.';

  // ── Довантажуємо supplier (mechanism/логін/aiNotes/telegram, §4 ТЗ) і category (requiredParams, §3 ТЗ) ──
  var supplierInfo = null;
  if (found.supplier && found.supplier.id) {
    try {
      var sr = await fetch(base + '/suppliers/' + found.supplier.id, { headers: hdr() });
      if (sr.ok) { var sj = await sr.json(); if (sj && sj.ok) supplierInfo = sj.data; }
    } catch (e) { }
  }
  var categoryParams = [];
  var categoryFull = null;
  if (found.category && found.category.id) {
    try {
      var crq = await fetch(base + '/categories/' + found.category.id, { headers: hdr() });
      if (crq.ok) { var crj = await crq.json(); if (crj && crj.ok) { categoryFull = crj.data; categoryParams = Array.isArray(crj.data.requiredParams) ? crj.data.requiredParams : []; } }
    } catch (e) { }
  }

  // ── offers → sizes/colors ──
  var sizes = [], colors = [], offers = found.offers || [];
  for (var k = 0; k < offers.length; k++) {
    var propsK = offers[k].properties || [];
    for (var mm = 0; mm < propsK.length; mm++) {
      var nmK = String(propsK[mm].name || '').toLowerCase();
      if ((nmK.indexOf('розмір') >= 0 || nmK.indexOf('размер') >= 0) && sizes.indexOf(propsK[mm].value) < 0) sizes.push(propsK[mm].value);
      if ((nmK.indexOf('колір') >= 0 || nmK.indexOf('цвет') >= 0) && colors.indexOf(propsK[mm].value) < 0) colors.push(propsK[mm].value);
    }
  }

  // ── upsell (companionProductIds — вже прямі id, без CT_1002-парсингу) ──
  // upsellItems — структуровані {id,name,price}, потрібні n_crm_order, щоб реально
  // ДОДАТИ погоджений допродаж другою позицією в замовлення (не лише згадати текстом).
  var upsell = [], upsellItems = [], __upsellPhoto = '';
  // Живий прогін 2026-09-04: displayName супутнього товару з CRM виявився рядком специфікації
  // ("Матеріал: двухнитка (100% бавовна)"), бо його presentationText починається зі спец-рядка,
  // а customerName порожній. Для допродажу беремо назву, що не схожа на "Підпис: значення".
  function looksLikeSpecLine(s) { s = String(s || '').trim(); return !s || s.length < 4 || /:$/.test(s) || /^[^:]{1,30}:\s/.test(s) || /^(в\s*наявност|наявніст|кольор|розмір|матеріал|ціна\b|акці|сезон)/i.test(s); }
  function upname(prod) {
    var up = Number(prod.price) || 0; var nm = (!looksLikeSpecLine(prod.customerName) && prod.customerName) || (!looksLikeSpecLine(prod.displayName) && prod.displayName) || prod.name || 'Товар';
    // v3: акція за кількість і кольори допродажу в текст пропозиції (реальний кейс: "Так Біла-1 Чорна-1", 2 шт = 799)
    var bp = (Array.isArray(prod.bulkPricing) ? prod.bulkPricing : []).filter(function (b) { return b && b.quantity && b.price; }).map(function (b) { return b.quantity + ' шт — ' + Number(b.price) + ' грн'; });
    var cols = [...new Set((prod.offers || []).flatMap(function (o) { return (o.properties || []).filter(function (q) { return /кол|цвет/i.test(q.name || ''); }).map(function (q) { return q.value; }); }))];
    return nm + (up ? (' — ' + up + ' грн') : '') + (bp.length ? (' (' + bp.join(', ') + ')') : '') + (cols.length ? ('; кольори: ' + cols.join(', ')) : '');
  }
  var compIds = Array.isArray(found.companionProductIds) ? found.companionProductIds : [];
  // v2 (2026-09-04): ОДИН допродаж, не три — n_pay_amount/n_crm_order додають лише upsellItems[0],
  // а n_order_intent пропонував "ці аксесуари" списком: клієнт погоджувався на три, платив за один.
  for (var ui = 0; ui < compIds.length && upsell.length < 1; ui++) {
    var cprod = all.filter(function (x) { return String(x.id) === String(compIds[ui]) && String(x.id) !== String(found.id); })[0];
    if (!cprod) continue;
    upsell.push(upname(cprod));
    var __cq = {}; (Array.isArray(cprod.bulkPricing) ? cprod.bulkPricing : []).forEach(function (b) { if (b && b.quantity && b.price) __cq[String(b.quantity)] = Number(b.price); });
    upsellItems.push({ id: cprod.id, sku: cprod.sku || '', supplierArticle: cprod.supplierArticle || '', name: upname(cprod).replace(/\s—\s\d+ грн$/, ''), price: Number(cprod.price) || 0, qtyPrices: __cq, colors: [...new Set((cprod.offers || []).flatMap(function (o) { return (o.properties || []).filter(function (q) { return /кол|цвет/i.test(q.name || ''); }).map(function (q) { return q.value; }); }))].join(', ') });
    if (!__upsellPhoto) { __upsellPhoto = resolveUrl(cprod.thumbnailUrl || (cprod.images || [])[0] || ''); }
  }
  var __upsellPhotoNote = __upsellPhoto
    ? 'Фото товару(-ів) з допродажу Є — якщо клієнт попросить показати, скажи що зараз надішлеш.'
    : 'Фото товару(-ів) з допродажу поки НЕМА під рукою — якщо клієнт попросить, чесно скажи що зараз немає, запропонуй подивитись каталог.';

  // ── фото товару ──
  var imgs = []; if (found.thumbnailUrl) imgs.push(resolveUrl(found.thumbnailUrl));
  var rawImgs = found.images || []; for (var x = 0; x < rawImgs.length; x++) { var uu = resolveUrl(rawImgs[x]); if (uu && imgs.indexOf(uu) < 0) imgs.push(uu); }
  var img = imgs[0] || '';
  var price = Number(found.price) || 0;

  // ── розмірна сітка / AI-нотатки — прямі поля (без CT_1010/1011/1012) ──
  var __sizeChartUrl = resolveUrl(found.sizeChartImage || '');
  var __sizeChartData = found.sizeChartData || null;
  var __aiInfo = found.aiNotes || '';
  // 2026-09-08 (Vyacheslav: замість сітки прийшов колаж товару — у CRM як «картинка сітки» завантажено фото): текстова
  // таблиця з sizeChartData іде РАЗОМ із картинкою (або замість неї), щоб клієнт завжди отримав точні цифри.
  var __sizeChartText = '';
  try {
    var __scd = __sizeChartData || {}; var __scs = Array.isArray(__scd.sizes) ? __scd.sizes : []; var __scm = __scd.measurements || {};
    var __scKeys = Object.keys(__scm).filter(function (k) { return Array.isArray(__scm[k]) && __scm[k].length === __scs.length; });
    if (__scs.length && __scKeys.length) {
      __sizeChartText = '📏 Розмірна сітка' + (__scd.title ? ' — ' + __scd.title : '') + ' (' + (__scd.unit || 'см') + '):\n' + __scs.map(function (s, i) { return s + ' — ' + __scKeys.map(function (k) { return k.toLowerCase() + ' ' + __scm[k][i]; }).join(', '); }).join('\n');
    }
  } catch (e) { __sizeChartText = ''; }
  var __sizeChartNote = __sizeChartUrl
    ? 'Розмірна сітка для цього товару Є — якщо клієнт попросить, скажи що зараз покажеш.'
    : (__sizeChartData
      ? 'Картинки розмірної сітки НЕМА, але є точні цифри по кожному розміру (нижче) — якщо клієнт попросить сітку, НЕ обіцяй фото, а назви ці цифри словами.'
      : 'Розмірної сітки для цього товару ПОКИ НЕМА в системі — якщо клієнт попросить, чесно скажи, що зараз немає під рукою, і запропонуй підібрати розмір за параметрами нижче.');

  // ── акції за кількість (bulkPricing — прямий масив, без CT_1007/1008/1009) ──
  var __qtyPromoParts = [];
  var bulk = Array.isArray(found.bulkPricing) ? found.bulkPricing : [];
  var __qtyPrices = {};
  for (var bi = 0; bi < bulk.length; bi++) { var bp2 = bulk[bi]; if (bp2 && bp2.quantity && bp2.price) { __qtyPrices[String(bp2.quantity)] = Number(bp2.price); __qtyPromoParts.push(bp2.quantity + ' шт — ' + Number(bp2.price) + ' грн'); } }
  // v8.1 (прогін 2026-09-06: дві кофти A0187 порахувались 2558, хоча в описі «(2 шт: 2199 ₴)»): якщо в CRM
  // bulkPricing не заповнено, а в описі/презентації є «N шт: ЦІНА ₴/грн» — беремо звідти (це той самий текст,
  // який бот показує клієнту, тож ціна в підсумку/інвойсі збігається з обіцянкою). Власнику варто заповнити
  // «Акції за кількість» у картці товару — тоді описовий фолбек не потрібен.
  if (!__qtyPromoParts.length) {
    var __promoSrc = String(found.presentationText || '') + '\n' + String(found.description || '');
    var __promoRe = /(\d{1,2})\s*шт\.?\s*[:—–-]\s*(\d[\d\s]{2,7})\s*(?:₴|грн)/gi; var __pm;
    while ((__pm = __promoRe.exec(__promoSrc))) { var __pq = Number(__pm[1]); var __pp = Number(String(__pm[2]).replace(/\s/g, '')); if (__pq > 1 && __pp > 0 && !__qtyPrices[String(__pq)]) { __qtyPrices[String(__pq)] = __pp; __qtyPromoParts.push(__pq + ' шт — ' + __pp + ' грн'); } }
  }
  var __qtyPromoText = __qtyPromoParts.length ? ('Акція за кількість: ' + __qtyPromoParts.join(', ') + '.') : '';

  // ── набір: setComponents вже структуровані (productId/name/sku/qty) — довантажуємо
  //    фото/ціну/постачальника кожного компонента окремими GET /products/:id (не більше
  //    ~10, наборів рідко буває багато елементів) — потрібно для §5 п.3 (фото КОМПОНЕНТА,
  //    не колажу всього набору).
  var setItems = [];
  var rawComponents = Array.isArray(found.setComponents) ? found.setComponents : [];
  for (var si = 0; si < rawComponents.length && setItems.length < 10; si++) {
    var comp = rawComponents[si];
    var compFull = null;
    try { var cr = await fetch(base + '/products/' + comp.productId, { headers: hdr() }); if (cr.ok) { var cj = await cr.json(); if (cj && cj.ok) compFull = cj.data; } } catch (e) { }
    var cImgs = [];
    if (compFull) { if (compFull.thumbnailUrl) cImgs.push(resolveUrl(compFull.thumbnailUrl)); var cRaw = compFull.images || []; for (var cx = 0; cx < cRaw.length; cx++) { var cuu = resolveUrl(cRaw[cx]); if (cuu && cImgs.indexOf(cuu) < 0) cImgs.push(cuu); } }
    // 2026-09-08 (t_ilich_k, _vlad_838: «які джинси в комплекті, 6 варіантів?», «кофта в графітовому є?» → бот не знав):
    // кольори й розміри компонента з його оферів — у setList, щоб n_set_choice відповідав сам.
    var cColors = [], cSizes = [];
    if (compFull) { var cOffs = compFull.offers || []; for (var co = 0; co < cOffs.length; co++) { var cps = cOffs[co].properties || []; for (var cq = 0; cq < cps.length; cq++) { var cnm = String(cps[cq].name || '').toLowerCase(); var cv = String(cps[cq].value || '').trim(); if (!cv) continue; if ((cnm.indexOf('колір') >= 0 || cnm.indexOf('цвет') >= 0) && cColors.indexOf(cv) < 0) cColors.push(cv); if ((cnm.indexOf('розмір') >= 0 || cnm.indexOf('размер') >= 0) && cSizes.indexOf(cv) < 0) cSizes.push(cv); } } }
    setItems.push({
      article: comp.sku || '', id: comp.productId, name: comp.name || '',
      price: compFull ? (Number(compFull.price) || 0) : null,
      supplier: (compFull && compFull.supplier && compFull.supplier.name) || '',
      supplierArticle: (compFull && compFull.supplierArticle) || '',
      colors: cColors, sizes: cSizes,
      photoUrl: cImgs[0] || '', imageUrls: cImgs.slice(0, 5)
    });
  }
  var setList = setItems.map(function (x) { return x.name + (x.price ? (' — ' + x.price + ' грн') : '') + ' [арт. ' + x.article + ']' + (x.colors && x.colors.length ? ' (кольори: ' + x.colors.join(', ') + ')' : '') + (x.sizes && x.sizes.length ? ' (розміри: ' + x.sizes.join(', ') + ')' : ''); }).join('; ');

  // ── взуття/крихкі категорії — окрема примітка доставки (евристика за назвою категорії,
  //    без прив'язки до конкретного числового categoryId — категорії різні в кожного tenant) ──
  var __footwearNote = (categoryFull && /взутт/i.test(categoryFull.name || '')) ? '\n\n👟 Важливо: взуття відправляється окремою посилкою з іншого міста (не разом з одягом) — якщо у вас є ще одне замовлення одягу, воно приїде окремо.' : '';

  // ── §3 ТЗ: isClothing — тепер ЦІЛКОМ ДАНІ, не хардкод-масив category_id.
  //    Категорія "потребує підбору розміру" ⇔ в CRM у неї заповнено requiredParams. ──
  var __isClothing = categoryParams.length > 0;
  var __paramsPrompt = categoryParams.map(function (p) { return '- ' + p.name + (p.unit ? (' (' + p.unit + ')') : '') + (p.hint ? (': ' + p.hint) : ''); }).join('\n');
  var __paramNames = categoryParams.map(function (p) { return String(p.name || '').toLowerCase(); });
  var __isHeightWeight = __paramNames.some(function (n) { return /зріст|height|ріст/.test(n); }) && __paramNames.some(function (n) { return /вага|weight/.test(n); });
  // 2026-09-09 (фідбек власника): коли розмірної сітки НЕМА взагалі (ні картинки, ні цифр) і
  // категорія міряється зростом/вагою — раніше __sizeChartNote лишав це на розсуд AI ("чесно
  // скажи, що немає під рукою"), відповіді виходили різні щоразу. Тепер — готовий скрипт
  // дослівно, AI лише підставляє його замість вигадування власного тексту. Список параметрів —
  // ДИНАМІЧНО з categoryParams (CRM Category.requiredParams), як і __paramsPrompt вище, а НЕ
  // хардкод "зріст/вага" — щоб той самий текст працював і для категорій з іншими параметрами.
  if (!__sizeChartUrl && !__sizeChartData && __isHeightWeight) {
    var __noteParamsList = categoryParams.map(function (p, i) { return (i + 1) + ') ' + p.name + (p.unit ? ' (' + p.unit + ')' : ''); }).join('\n');
    __sizeChartNote = 'Розмірної сітки для цього товару НЕМА в системі. Якщо клієнт попросить сітку/таблицю розмірів — НЕ вибачайся і не кажи "зараз нема під рукою", а дай РІВНО цю відповідь (можеш злегка адаптувати вітання під контекст діалогу, суть і структуру не міняй, а список параметрів нижче лиши як є):\n"Для цієї моделі розмір підбираємо індивідуально за зростом та вагою — так виходить навіть точніше, ніж лише по стандартній розмірній сітці 😊\n\nМи вже добре знаємо посадку цієї моделі та допоможемо підібрати оптимальний розмір.\n\nНапишіть, будь ласка:\n' + __noteParamsList + '\n\nІ ми одразу підкажемо, який розмір Вам найкраще підійде ✅"\nПісля цього далі веди звичайний збір параметрів як завжди — не додавай wantsSizeChart.';
  }

  // ── customerName / desc — presentationText з CRM пишеться ГОТОВОЮ презентацією (як
  //    KeyCRM-опис у старій версії) — надсилаємо дослівно (n_welcome), обрізаючи лише
  //    службові нотатки-рядки, що починаються з ℹ️ (внутрішні нотатки адміна). ──
  var __descClean = String(found.presentationText || '').split('\n').filter(function (ln) { return !/^\s*ℹ️/.test(ln); }).join('\n').trim();
  // 2026-09-08 (set1112: «Комплект 4 в 1 (кофта…)» і одразу «Комплект 4 в 1. Артикул: set1112» — назва двічі): якщо перший
  // рядок презентації = назва товару, а далі йде рядок з артикулом — перший рядок прибираємо.
  try {
    var __dl = __descClean.split('\n'); var __first = String(__dl[0] || '').trim().toLowerCase(); var __nm = String(found.customerName || found.name || '').trim().toLowerCase();
    var __second = (__dl.slice(1).find(function (l) { return l.trim(); }) || '').toLowerCase();
    if (__dl.length > 2 && __nm && __first === __nm && /артикул/.test(__second)) __descClean = __dl.slice(1).join('\n').trim();
  } catch (e) { }
  var __rawFirstLine = (__descClean.split('\n')[0] || '').trim();
  var __looksLikeHeading = /:$/.test(__rawFirstLine) || /^[^:]{1,30}:\s/.test(__rawFirstLine) || /^(в\s*наявност|наявніст|кольор|розмір|матеріал|ціна\b|акці|сезон)/i.test(__rawFirstLine) || __rawFirstLine.length < 4;
  // customerName у CRM covercar = речення-специфікація ("Матеріал накидок - алькантара. Він дуже…") —
  // модель губилась, який це товар. Довге речення без слова "артикул" — не назва; беремо name.
  var __cnRaw = String(found.customerName || '').trim();
  var __cnIsSpec = !__cnRaw || (__cnRaw.length > 55 && !/артикул/i.test(__cnRaw)) || /^[^:]{1,30}:\s/.test(__cnRaw);
  var __customerName = (!__cnIsSpec && __cnRaw) || (!__looksLikeHeading && __rawFirstLine.length <= 55 && __rawFirstLine) || found.name || 'Товар';
  // Аудит 2026-09-04: presentationText у новій CRM може бути порожнім — тоді n_welcome слав
  // лише "👉 Зараз підберемо..." без назви й ціни. Мінімальний чесний фолбек з даних картки.
  if (!__descClean) {
    __descClean = __customerName + (price ? (' — ' + price + ' грн') : '')
      + (colors.length ? ('\nКольори: ' + colors.join(', ')) : '')
      + (sizes.length ? ('\nРозміри: ' + sizes.join(', ')) : '');
  } else if (__descClean.toLowerCase().indexOf(String(__customerName).toLowerCase().slice(0, 25)) < 0) {
    // v2: презентація без назви товару (covercar: текст починається зі специфікації) — заголовок з назвою і ціною.
    __descClean = __customerName + (price ? (' — ' + price + ' грн') : '') + '\n\n' + __descClean;
  }
  // Аудит 2026-09-01 (patch-size-followup-dedup.js, вже застосований на клонах): followUpQuestion
  // НЕ дублює конкретне питання (n_size сама питає, з динамічними параметрами §3 ТЗ) —
  // лише нейтральний перехід, інакше клієнт бачить питання двічі поспіль.
  // Аудит 2026-09-04: n_size тепер має waitAfterPresentation (двигун) — у ході презентації
  // модель НЕ викликається (це і давало "дубль опису"), тож конкретне питання про параметри
  // ставить сама презентація, з назв параметрів категорії в CRM.
  var __paramAsk = categoryParams.map(function (p) { return String(p.name || '').toLowerCase(); }).filter(Boolean).join(' і ');
  var __followUpQuestion = __isClothing
    ? ('👉 Підкажіть, будь ласка, ' + (__paramAsk || 'зріст і вагу') + ' — підберу ідеальний розмір 😊')
    : 'Цікавить? 😊';

  // Рекомендація власника (озвучена під час роботи над цим ТЗ): один структурований
  // об'єкт стану діалогу замість розкиданих окремих прапорців — щоб діалогові ноди мали
  // компактну ситуативну картину. Заведено тут як конвенцію (n_lookup — природне єдине
  // місце запису, бо саме тут стає відомим товар/категорія на цьому ході): dialogState
  // (структура, для майбутніх нод) + dialogStateText (готовий КОРОТКИЙ текстовий рядок,
  // без сирого JSON — навчений уроком CLAUDE.md §15.7 про 429 від занадто великого
  // контексту в claude-ноді). ВАЖЛИВО: це ДОПОВНЕННЯ (м'який контекст для моделі), а НЕ
  // єдиний захист від дублів — жорсткі гейти (чи вже питали розмір тощо) лишаються
  // детермінованими в коді/умовах (sizeAskedFor + n_is_clothing, як вище), бо модель
  // може прочитати навіть повний прапорець неправильно (це вже було з productJustPresented).
  // ⚠️ Повністю НЕ пропагувалось у решту 50+ нод флоу (n_color/n_collect/n_order_intent
  // тощо) — це свідомо залишено як TODO/рекомендація власнику в фінальному звіті, а не
  // мовчки недороблено: пріоритет цієї сесії — 10-діалоговий живий прогін (нижче).
  var dialogState = {
    productPresented: !!context.productJustPresented,
    productId: found.id, productName: __customerName,
    knownColor: (context.colorChoice && context.colorChoice.color) || preColor || '',
    knownSize: context.recommendedSize || preSize || '',
    sizeAsked: context.sizeAskedFor === found.categoryId,
    orderStatus: context.crmOrderId ? ('створено #' + context.crmOrderId) : (context.orderData ? 'збираємо адресу' : 'ще не оформлено')
  };
  var dialogStateText = 'Товар у розмові: ' + dialogState.productName + (dialogState.knownColor ? (', колір ' + dialogState.knownColor) : '') + (dialogState.knownSize ? (', розмір/параметр ' + dialogState.knownSize) : '') + '. Презентація щойно показана: ' + (dialogState.productPresented ? 'так' : 'ні') + '. Розмір/параметри вже питали цього товару: ' + (dialogState.sizeAsked ? 'так' : 'ні') + '. Замовлення: ' + dialogState.orderStatus + '.';

  // Завдання «памʼять вимірів клієнта» (Buyer.knownMeasurements, нова CRM): впізнаємо
  // покупця РАНІШЕ, ніж дізнаємось телефон — Instagram дає igUsername із першого дотику,
  // а phone стає відомим лише на кроці оформлення (n_crm_order). Спрацьовує ЛИШЕ якщо
  // товар потребує підбору розміру (categoryParams непорожній) і в CRM вже є Buyer з
  // УСІМА потрібними параметрами САМЕ ЦІЄЇ категорії — інакше мовчки нічого не готуємо
  // (n_size питає як завжди). Ключі knownMeasurements — ТІ САМІ назви, що
  // categoryParams[].name (жодного фаззі-мапінгу, той самий формат що Category.requiredParams).
  // Це ДОПОВНЕННЯ (готує компактний текст для промпту n_size) — саме підтвердження і
  // рішення "довіряти клієнту чи ні" лишається за моделлю в n_size, не мовчазна підстановка тут.
  var knownMeasurementsText = '';
  var __earlyBuyerId = '';
  if (categoryParams.length) {
    var __idIg = String(context.igUsername || '').trim();
    var __idPhone = String((context.orderData && context.orderData.phone) || '').replace(/[^0-9]/g, '');
    if (__idIg || __idPhone) {
      try {
        var __lookupQs = (__idIg ? ('igUsername=' + encodeURIComponent(__idIg)) : '') + (__idPhone ? ((__idIg ? '&' : '') + 'phone=' + encodeURIComponent(__idPhone)) : '');
        var __blr = await fetch(base + '/buyers/lookup?' + __lookupQs, { headers: hdr() });
        if (__blr.ok) {
          var __blj = await __blr.json().catch(function () { return {}; });
          var __buyer = (__blj && __blj.ok) ? __blj.data : null;
          if (__buyer && __buyer.id) {
            __earlyBuyerId = __buyer.id;
            var __km = __buyer.knownMeasurements || {};
            var __allKnown = categoryParams.every(function (p) { return __km[p.name] !== undefined && __km[p.name] !== null && String(__km[p.name]).trim() !== ''; });
            if (__allKnown) knownMeasurementsText = categoryParams.map(function (p) { return p.name + ': ' + __km[p.name]; }).join(', ');
          }
        }
      } catch (e) { /* best-effort, не блокуємо підбір товару */ }
    }
  }

  var result = {
    dialogState: dialogState, dialogStateText: dialogStateText,
    knownMeasurementsText: knownMeasurementsText,
    supplier: (found.supplier && found.supplier.name) || '',
    product: {
      _source: 'crm', supplier: (found.supplier && found.supplier.name) || '', supplierId: (found.supplier && found.supplier.id) || '',
      supplierInfo: supplierInfo, // {mechanism, loginUsername, loginPassword, aiNotes, telegramGroupId, website, contactInfo, description} — §4 ТЗ
      setComponents: rawComponents.map(function (c) { return c.sku; }).join(', '), isSet: !!found.isSet, setItems: setItems, setList: setList,
      matchNote: __matchNote, matchConfidence: __lowConfidence ? 'low' : 'high',
      _matchKey: mk, _via: via, _matchedSharedPostId: (context.sharedPost && context.sharedPost.mediaId) ? String(context.sharedPost.mediaId) : '', _matchedEntryAd: String(context.entryAd || context.entryAdId || ''),
      id: found.id, sku: found.sku || '', article: found.sku || '', categoryId: found.categoryId, categoryName: (categoryFull && categoryFull.name) || '',
      name: found.name || 'Товар', customerName: __customerName, desc: __descClean, followUpQuestion: __followUpQuestion,
      price: price, currency: 'UAH', photoUrl: img, imageUrls: imgs.slice(0, 5),
      colors: colors.join(', '), colorsList: colors, sizes: sizes, offers: offers,
      upsell: upsell.join('; '), upsellItems: upsellItems, upsellPhotoUrl: __upsellPhoto, upsellPhotoNote: __upsellPhotoNote,
      isClothing: __isClothing, supplierArticle: found.supplierArticle || '', footwearNote: __footwearNote,
      qtyPrices: __qtyPrices, qtyPromoText: __qtyPromoText,
      // v10 (CRM 2026-09-07): «доступно завжди» і кількості по розмірах — n_avail читає ці прапорці
      // CRM f50aba5: Product.alwaysAvailable (дефолт true) — кількості враховуються ЛИШЕ коли вимкнено; offer.inStock рахує бекенд.
      alwaysAvailable: found.alwaysAvailable !== false,
      stockTracked: found.alwaysAvailable === false && (Array.isArray(found.offers) ? found.offers : []).some(function (o) { return o && o.quantity !== null && o.quantity !== undefined; }),
      sizeChartUrl: __sizeChartUrl, sizeChartText: __sizeChartText, aiInfo: __aiInfo, sizeChartNote: __sizeChartNote, sizeChartData: __sizeChartData,
      // §3 ТЗ — динамічні параметри підбору розміру з CRM Category.requiredParams:
      categoryParams: categoryParams, categoryParamsPrompt: __paramsPrompt, categoryParamsIsHeightWeight: __isHeightWeight
    }
  };
  // 2026-09-07 («джинси 31 і кофта М, футболку білу S»): інші речі з першого повідомлення запамʼятовуємо в
  // context.alsoWants — n_size/n_color/n_order_intent їх не ігнорують (допродаж включається одразу, решту додає менеджер).
  try {
    var __itemRe = /(кофт\w*|футболк\w*|джинс\w*|бомбер\w*|куртк\w*|костюм\w*|штан\w*|лофер\w*|кросівк\w*|худі|светр\w*|вітровк\w*|шапк\w*|туфл\w*|черевик\w*|кед\w*|накидк\w*|підголівник\w*)/i;
    var __firstText = String(context.lastUserMessage || input || '').replace(/\[переслав[^\]]*\][^\n]*/gi, ' ');
    var __ownWords = (String(found.customerName || '') + ' ' + String(found.name || '') + ' ' + String((categoryFull && categoryFull.name) || '')).toLowerCase();
    var __segs = __firstText.split(/[\n,;]+|\s+(?:і|та|и|а також|також|плюс|ще)\s+/i).map(function (s) { return s.trim(); }).filter(Boolean);
    var __also = [];
    for (var __si = 0; __si < __segs.length; __si++) {
      var __m = __segs[__si].match(__itemRe); if (!__m) continue;
      var __stem = __m[1].toLowerCase().slice(0, 5);
      if (__ownWords.indexOf(__stem) >= 0) continue;
      __also.push(__segs[__si].replace(/[?!.]+$/, '').replace(/^(добрий день|доброго дня|привіт|здравствуйте|добрый день)[,!.\s]*/i, '').trim());
    }
    result.alsoWants = __also.filter(Boolean).slice(0, 4).join('; ');
  } catch (e) { result.alsoWants = ''; }
  // Той самий товар уже презентували < 30 хв тому (коментар → приватна відповідь, потім DM з реклами; Купцова 21:44):
  // n_presented_recently_cond пропускає фото+картку, далі одразу крок розміру.
  // 2026-09-08 19:31 (twisti13.14, yevgeniybey: пост без реферала → картка; за хвилину «Яка ціна кофти?» ПРИЙШЛО з рефералом
  // реклами → двигун побачив «новий entryAd ≠ _matchedEntryAd», стер context.product і перезапустив воронку → картка вдруге).
  // Двигун product стирає, але lastPresentedSku/presentedAt лишає — звіряємось і з ними; знімок prevProductSnapshot повертає
  // розмір/колір, якщо це той самий товар.
  var __prevSku = String((context.product && context.product.sku) || context.lastPresentedSku || ''); var __prevAt = Number(context.presentedAt) || 0;
  result.skipPresentation = !!(__prevSku && found.sku && __prevSku.toUpperCase() === String(found.sku).toUpperCase() && (Date.now() - __prevAt) < 30 * 60 * 1000);
  result.presentedAt = result.skipPresentation ? __prevAt : Date.now(); // для ignoreRightAfterPresentationRe у n_size
  try {
    var __snap = context.prevProductSnapshot;
    if (__snap && found.sku && String(__snap.sku || '').toUpperCase() === String(found.sku).toUpperCase() && (Date.now() - Number(__snap.at || 0)) < 6 * 3600 * 1000) {
      if (__snap.recommendedSize && !context.recommendedSize) result.recommendedSize = __snap.recommendedSize;
      if (__snap.sizeInput && !context.sizeInput) result.sizeInput = __snap.sizeInput;
      if (__snap.colorChoice && __snap.colorChoice.color && !(context.colorChoice && context.colorChoice.color)) result.colorChoice = __snap.colorChoice;
      result.prevProductSnapshot = null;
    }
  } catch (e) { }
  result.lastPresentedSku = String(found.sku || ''); // n_presented_recently_cond звіряє й напряму (Софія 11:20: картка вдруге за 16 хв)
  // Товар визначено ЛИШЕ за артикулом з коментар-автоматизації (клієнт не називав його сам, у пості його нема) і
  // автоматизація презентувала його < 6 год тому → картку не дублюємо, одразу крок розміру.
  try {
    var __viaCommentOnly = !!(__commentArt && String(mk || '').toUpperCase() === ('ART_' + __commentArt) && fromUser.map(function (x) { return String(x).toUpperCase(); }).indexOf(__commentArt) < 0 && extractArticles((context.sharedPost && context.sharedPost.caption) || '').map(function (x) { return String(x).toUpperCase(); }).indexOf(__commentArt) < 0);
    if (__viaCommentOnly && __commentAge < 6 * 3600 * 1000) { result.skipPresentation = true; result.presentedAt = Date.now() - __commentAge; result.product._via = 'comment_automation:' + __commentArt; }
  } catch (e) { }
  if (preColor && preFromUser) { result.colorChoice = { color: preColor, _pre: true }; }
  // 2026-09-08 (Родіонова: «хочу замовити (графітову) кофту, розмір XXL» — бот потім перепитав колір): колір із першого
  // повідомлення клієнта, якщо він рівно один і є у списку кольорів товару → colorChoice одразу.
  try {
    if (!(result.colorChoice && result.colorChoice.color) && !(context.colorChoice && context.colorChoice.color)) {
      var __umsg = String(context.lastUserMessage || input || '').replace(/\[переслав[^\]]*\][^\n]*/gi, ' ').toLowerCase();
      var __clist = (result.product && result.product.colorsList) || [];
      var __hitC = __clist.filter(function (cn) { var st = String(cn).toLowerCase().replace(/ий$|а$|у$|ого$|ому$/,'').slice(0, 6); return st.length >= 4 && __umsg.indexOf(st) >= 0; });
      if (__hitC.length === 1) result.colorChoice = { color: __hitC[0], _fromFirstMsg: true };
      // 2026-09-08 (власник, F0029 шкіряний бомбер лише чорний): один колір — не питаємо, фіксуємо одразу.
      if (!(result.colorChoice && result.colorChoice.color) && __clist.length === 1) result.colorChoice = { color: __clist[0], _single: true };
    }
  } catch (e) { }
  if (preColor) result.product.preColor = preColor;
  if (preSize) { result.product.preSize = preSize; }
  if (__earlyBuyerId && !context.crmClientId) result.crmClientId = __earlyBuyerId;
  // 2026-09-08 (власник: «конфлікт привʼязки реклами і артикулу — присилай сповіщення в Telegram»): нова розбіжність →
  // adLinkMismatchAt; n_ad_conflict_cond шле алерт один раз на кожен НОВИЙ текст розбіжності (не на кожен хід).
  if (context.adLinkMismatch && context.adLinkMismatch !== context.adLinkMismatchSeen) { result.adLinkMismatchAt = Date.now(); result.adLinkMismatchSeen = context.adLinkMismatch; }
  return result;
} catch (e) { return fallback('EXCEPTION: ' + e.message); }
