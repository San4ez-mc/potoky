// n_shop_profile — джерело істини (CRM-клони, patch-goverla-crm-audit-2026-09-04.js, v7).
// Профіль магазину з бази знань CRM (GET /knowledge/profile): виробник, відправка, примірка, оплата,
// умови. Кладемо в context.shop.{faq,terms,...}; промпти беруть {{context.shop.faq}} і
// {{context.shop.terms}} замість ключів воронки SHOP_FAQ / ORDER_TERMS_LINE (2026-09-05, ТЗ §3).
// Кеш 10 хв на сесію. Без CRM — порожні рядки (модель тоді не вигадує, а каже «уточню»).
var prev = context.shop || {};
if (prev.at && Date.now() - Number(prev.at) < 10 * 60 * 1000 && prev.loaded) return {};
var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var apiKey = (keys.CRM_API_KEY || '').trim();
var shop = { faq: '', terms: '', producer: '', shipping: '', fitting: '', payment: '', loaded: false, at: Date.now() };
if (!apiKey) return { shop: shop };
try {
  var ac = new AbortController(); var to = setTimeout(function () { try { ac.abort(); } catch (e) {} }, 3000);
  try {
    var r = await fetch(base + '/knowledge/profile', { headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' }, signal: ac.signal });
    var j = r.ok ? await r.json().catch(function () { return {}; }) : {};
    var p = (j && j.data) || {};
    shop.producer = String(p.producerLine || '').trim();
    shop.shipping = String(p.shippingLine || '').trim();
    shop.fitting = String(p.fittingLine || '').trim();
    shop.payment = String(p.paymentLine || '').trim();
    shop.terms = String(p.termsLine || '').trim();
    shop.faq = [shop.producer, shop.shipping, shop.fitting, shop.payment].filter(Boolean).join(' ');
    shop.loaded = r.ok;
  } finally { clearTimeout(to); }
} catch (e) { /* best-effort */ }
return { shop: shop };
