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
if (context.product && context.product._source === 'crm' && (String(context.product._matchKey) === String(context.entryAd || context.__lk || '') || !context.hasFreshSignalThisTurn)) return {};

function fallback(reason) { return { product: null, productUnknown: true, productUnknownReason: reason || '' }; }

var apiKey = (keys.CRM_API_KEY || '').trim();
var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var publicBase = (keys.CRM_PUBLIC_BASE || 'https://pcrm.fineko.space').replace(/\/$/, '');
if (!apiKey) return fallback('CRM_API_KEY не заповнено');
function hdr() { return { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' }; }
function resolveUrl(u) { if (!u) return ''; return /^https?:\/\//i.test(u) ? u : (publicBase + (u.charAt(0) === '/' ? u : '/' + u)); }

function extractArticles(txt) {
  if (!txt) return [];
  var s = String(txt); var out = []; var m;
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

  // ПРІОРИТЕТ 2: артикул (з тексту клієнта / підпису поста / adTitle)
  if (!found) {
    var fromUser = extractArticles(context.lastUserMessage || input || '');
    var cands = fromUser.concat(extractArticles((context.sharedPost && context.sharedPost.caption) || '')).concat(extractArticles(context.adTitle || ''));
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
  if (!found && context.sharedPost && context.sharedPost.caption) {
    var STOPWORDS_KW = { 'та': 1, 'і': 1, 'й': 1, 'на': 1, 'до': 1, 'за': 1, 'від': 1, 'для': 1, 'або': 1, 'це': 1, 'вже': 1, 'ще': 1, 'як': 1, 'що': 1, 'по': 1, 'при': 1, 'без': 1, 'між': 1 };
    function tokenizeKW(s) { return String(s || '').toLowerCase().replace(/[^\wа-яіїєґ\s]/gi, ' ').split(/\s+/).filter(function (w) { return w.length >= 4 && !STOPWORDS_KW[w]; }); }
    var capWordsKW = tokenizeKW(context.sharedPost.caption);
    if (capWordsKW.length) {
      var capSetKW = {}; for (var wi = 0; wi < capWordsKW.length; wi++) capSetKW[capWordsKW[wi]] = 1;
      var scoredKW = [];
      for (var pi3 = 0; pi3 < all.length; pi3++) {
        var pnameWordsKW = tokenizeKW(all[pi3].displayName || all[pi3].name);
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
  var __visionUrl = context.lastUserImageUrl || (!found && context.sharedPost && context.sharedPost.url) || '';
  if (!found && __visionUrl && keys.GEMINI_API_KEY) {
    function imgOk(u) { try { var h = new URL(u).hostname.toLowerCase(); if (h === 'api.telegram.org') return true; return ['cdninstagram.com', 'fbcdn.net', 'fbsbx.com', 'lookaside.fbsbx.com'].some(function (d) { return h === d || h.endsWith('.' + d); }); } catch (e) { return false; } }
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
  function upname(prod) { var up = Number(prod.price) || 0; var nm = prod.customerName || (!looksLikeSpecLine(prod.displayName) && prod.displayName) || prod.name || 'Товар'; return nm + (up ? (' — ' + up + ' грн') : ''); }
  var compIds = Array.isArray(found.companionProductIds) ? found.companionProductIds : [];
  for (var ui = 0; ui < compIds.length && upsell.length < 3; ui++) {
    var cprod = all.filter(function (x) { return String(x.id) === String(compIds[ui]) && String(x.id) !== String(found.id); })[0];
    if (!cprod) continue;
    upsell.push(upname(cprod));
    upsellItems.push({ id: cprod.id, name: upname(cprod).replace(/\s—\s\d+ грн$/, ''), price: Number(cprod.price) || 0 });
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
    setItems.push({
      article: comp.sku || '', id: comp.productId, name: comp.name || '',
      price: compFull ? (Number(compFull.price) || 0) : null,
      supplier: (compFull && compFull.supplier && compFull.supplier.name) || '',
      supplierArticle: (compFull && compFull.supplierArticle) || '',
      photoUrl: cImgs[0] || '', imageUrls: cImgs.slice(0, 5)
    });
  }
  var setList = setItems.map(function (x) { return x.name + (x.price ? (' — ' + x.price + ' грн') : '') + ' [арт. ' + x.article + ']'; }).join('; ');

  // ── взуття/крихкі категорії — окрема примітка доставки (евристика за назвою категорії,
  //    без прив'язки до конкретного числового categoryId — категорії різні в кожного tenant) ──
  var __footwearNote = (categoryFull && /взутт/i.test(categoryFull.name || '')) ? '\n\n👟 Важливо: взуття відправляється окремою посилкою з іншого міста (не разом з одягом) — якщо у вас є ще одне замовлення одягу, воно приїде окремо.' : '';

  // ── §3 ТЗ: isClothing — тепер ЦІЛКОМ ДАНІ, не хардкод-масив category_id.
  //    Категорія "потребує підбору розміру" ⇔ в CRM у неї заповнено requiredParams. ──
  var __isClothing = categoryParams.length > 0;
  var __paramsPrompt = categoryParams.map(function (p) { return '- ' + p.name + (p.unit ? (' (' + p.unit + ')') : '') + (p.hint ? (': ' + p.hint) : ''); }).join('\n');
  var __paramNames = categoryParams.map(function (p) { return String(p.name || '').toLowerCase(); });
  var __isHeightWeight = __paramNames.some(function (n) { return /зріст|height|ріст/.test(n); }) && __paramNames.some(function (n) { return /вага|weight/.test(n); });

  // ── customerName / desc — presentationText з CRM пишеться ГОТОВОЮ презентацією (як
  //    KeyCRM-опис у старій версії) — надсилаємо дослівно (n_welcome), обрізаючи лише
  //    службові нотатки-рядки, що починаються з ℹ️ (внутрішні нотатки адміна). ──
  var __descClean = String(found.presentationText || '').split('\n').filter(function (ln) { return !/^\s*ℹ️/.test(ln); }).join('\n').trim();
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
      sizeChartUrl: __sizeChartUrl, aiInfo: __aiInfo, sizeChartNote: __sizeChartNote, sizeChartData: __sizeChartData,
      // §3 ТЗ — динамічні параметри підбору розміру з CRM Category.requiredParams:
      categoryParams: categoryParams, categoryParamsPrompt: __paramsPrompt, categoryParamsIsHeightWeight: __isHeightWeight
    }
  };
  if (preColor && preFromUser) { result.colorChoice = { color: preColor, _pre: true }; }
  if (preColor) result.product.preColor = preColor;
  if (preSize) { result.product.preSize = preSize; }
  if (__earlyBuyerId && !context.crmClientId) result.crmClientId = __earlyBuyerId;
  return result;
} catch (e) { return fallback('EXCEPTION: ' + e.message); }
