// n_set_apply — версія для НОВОЇ Fineko CRM (заміна старого фетчу через KeyCRM openapi).
// Аудит 2026-09-03 (живий регресійний прогін перед свапом трафіку): стара версія ходила
// в KEYCRM_API_BASE/KEYCRM_API_TOKEN з ID компонента (it.id), який тепер — UUID нової CRM,
// а НЕ числовий KeyCRM product_id. Запит мовчки провалювався (catch ковтав помилку), тож
// colors/sizes/offers/photo для окремо вибраної позиції набору лишались ПОРОЖНІМИ —
// клієнт, що обрав окрему річ із комплекту, ніколи не бачив вибору кольору чи фото, а
// isClothing:sizes.length>0 завжди був false, тож і питання зросту/ваги пропускалось,
// навіть коли товар його реально потребує. Джерело даних тепер — те саме, що й n_lookup
// (CRM_API_BASE/CRM_API_KEY): GET /products/:id (offers/фото) + GET /categories/:id
// (requiredParams — та сама логіка isClothing/categoryParamsPrompt, що й n_lookup).
var ch = context.setPick || {}; var p = context.product || {};
if (String(ch.setChoice) !== 'item' || !ch.article) return { setMode: 'set' };
var it = (p.setItems || []).filter(function (x) { return String(x.article).toUpperCase() === String(ch.article).toUpperCase(); })[0];
if (!it) return { setMode: 'set' };

var apiKey = (keys.CRM_API_KEY || '').trim();
var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var publicBase = (keys.CRM_PUBLIC_BASE || 'https://pcrm.fineko.space').replace(/\/$/, '');
function hdr() { return { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' }; }
function resolveUrl(u) { if (!u) return ''; return /^https?:\/\//i.test(u) ? u : (publicBase + (u.charAt(0) === '/' ? u : '/' + u)); }

var colors = [], sizes = [], offers = [], imgs = [], img = '';
var categoryParams = [], isHeightWeight = false, paramsPrompt = '', sizeChartNote = 'Розмірної сітки для цього товару поки нема в системі — якщо клієнт попросить, чесно скажи що зараз немає під рукою.', sizeChartData = null, categoryId = null;

if (apiKey) {
  try {
    var rp = await fetch(base + '/products/' + encodeURIComponent(it.id), { headers: hdr() });
    if (rp.ok) {
      var pd = await rp.json();
      var found = (pd && pd.ok && pd.data) ? pd.data : null;
      if (found) {
        offers = found.offers || [];
        for (var k = 0; k < offers.length; k++) {
          var propsK = offers[k].properties || [];
          for (var mm = 0; mm < propsK.length; mm++) {
            var nmK = String(propsK[mm].name || '').toLowerCase();
            if ((nmK.indexOf('розмір') >= 0 || nmK.indexOf('размер') >= 0) && sizes.indexOf(propsK[mm].value) < 0) sizes.push(propsK[mm].value);
            if ((nmK.indexOf('колір') >= 0 || nmK.indexOf('цвет') >= 0) && colors.indexOf(propsK[mm].value) < 0) colors.push(propsK[mm].value);
          }
        }
        if (found.thumbnailUrl) { var tu = resolveUrl(found.thumbnailUrl); if (tu) imgs.push(tu); }
        var rawImgs = found.images || []; for (var x = 0; x < rawImgs.length; x++) { var uu = resolveUrl(rawImgs[x]); if (uu && imgs.indexOf(uu) < 0) imgs.push(uu); }
        img = imgs[0] || '';
        sizeChartData = found.sizeChartData || null;
        var sizeChartUrl = resolveUrl(found.sizeChartImage || '');
        sizeChartNote = sizeChartUrl
          ? 'Розмірна сітка для цього товару Є — якщо клієнт попросить, скажи що зараз покажеш.'
          : (sizeChartData
            ? 'Картинки розмірної сітки НЕМА, але є точні цифри по кожному розміру — якщо клієнт попросить сітку, НЕ обіцяй фото, а назви ці цифри словами.'
            : sizeChartNote);
        categoryId = found.categoryId || (found.category && found.category.id) || null;
        if (categoryId) {
          try {
            var crq = await fetch(base + '/categories/' + encodeURIComponent(categoryId), { headers: hdr() });
            if (crq.ok) { var crj = await crq.json(); if (crj && crj.ok && crj.data) categoryParams = Array.isArray(crj.data.requiredParams) ? crj.data.requiredParams : []; }
          } catch (e) { /* best-effort */ }
        }
        var paramNames = categoryParams.map(function (cp) { return String(cp.name || '').toLowerCase(); });
        isHeightWeight = paramNames.some(function (n) { return /зріст|height|ріст/.test(n); }) && paramNames.some(function (n) { return /вага|weight/.test(n); });
        paramsPrompt = categoryParams.map(function (cp) { return '- ' + cp.name + (cp.unit ? (' (' + cp.unit + ')') : '') + (cp.hint ? (': ' + cp.hint) : ''); }).join('\n');
      }
    }
  } catch (e) { /* best-effort — якщо CRM недоступна, лишаємось з даними з setItems (ціна/назва/фото зі списку набору) */ }
}

return { setMode: 'item', setParent: { id: p.id, name: p.name, price: p.price },
  supplier: it.supplier || context.supplier,
  colorChoice: null,
  product: Object.assign({}, p, { id: it.id, name: it.name, price: it.price, sku: it.article, article: it.article,
    supplier: it.supplier || '', isSet: false, setComponents: '', setItems: [], setList: '',
    colors: colors.join(', '), colorsList: colors, sizes: sizes, offers: offers,
    isClothing: categoryParams.length > 0, categoryId: categoryId, categoryParams: categoryParams,
    categoryParamsPrompt: paramsPrompt, categoryParamsIsHeightWeight: isHeightWeight,
    sizeChartData: sizeChartData, sizeChartNote: sizeChartNote,
    photoUrl: img || it.photoUrl || '', imageUrls: (imgs.length ? imgs.slice(0, 5) : (it.imageUrls || [])), preColor: '', upsell: '' }) };
