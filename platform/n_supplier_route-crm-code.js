// n_supplier_route — версія для НОВОЇ Fineko CRM (§4 ТЗ: заміна SUPPLIER_MAP/SUPPLIER_CONFIG
// funnelKey-хардкоду на дані з product.supplierInfo, довантажені n_lookup-crm-code.js з
// GET /suppliers/:id — loginUsername/loginPassword/aiNotes/mechanism/telegramGroupId).
//
// Технічні інтеграційні параметри, яких CRM-схема Supplier НЕ моделює (напр. числовий
// catalogId/categories easydrop.one — це деталі конкретного зовнішнього кабінету
// постачальника, не загальне поле "постачальник") — читаємо з supplierInfo.aiNotes, ЯКЩО
// там лежить JSON {"easydrop":{"catalogId":"...","categories":[...]}} (власник може перенести
// їх туди через CRM UI без змін коду); інакше — фолбек на legacy SUPPLIER_CONFIG funnelKey
// (та сама структура, що й раніше), щоб уже налаштовані інтеграції (catalogId/categories
// easydrop) не зламались, поки власник не перенесе їх у CRM. Решта supplier-логіки
// (n_supplier_order/_ed/_cart, n_supplier_notify) — БЕЗ ЗМІН, як просило ТЗ.
var supInfo = (context.product && context.product.supplierInfo) || null;
var supName = String((context.product && context.product.supplier) || context.supplier || '').trim();

var legacyCfg = {}; try { legacyCfg = JSON.parse(keys.SUPPLIER_CONFIG || '{}'); } catch (e) { }
function pickLegacy() {
  if (!supName) return null;
  if (legacyCfg[supName]) return legacyCfg[supName];
  var lo = supName.toLowerCase();
  for (var k in legacyCfg) { if (String(k).toLowerCase() === lo) return legacyCfg[k]; }
  for (var k2 in legacyCfg) { if (lo.indexOf(String(k2).toLowerCase()) >= 0) return legacyCfg[k2]; }
  return null;
}
var legacy = pickLegacy() || {};

// mechanism: з CRM supplierInfo.mechanism (вільний текст, введений власником у CRM) — та сама
// нечітка нормалізація, що й раніше (KeyCRM-версія SUPPLIER_CONFIG.mechanism), бо власник
// пише "BrewDrop"/"ручне" своїми словами, а движку треба один із трьох внутрішніх токенів.
var mechRaw = String((supInfo && supInfo.mechanism) || legacy.mechanism || '').trim();
var mech = mechRaw && /^(brewdrop|easydrop_offline|easydrop_cart|manual)$/.test(mechRaw) ? mechRaw : '';
if (!mech) {
  var lo2 = (mechRaw || supName).toLowerCase();
  mech = lo2.indexOf('brewdrop') >= 0 ? 'brewdrop' : (/easydrop|zahid|zaxid/.test(lo2) ? 'easydrop_cart' : 'manual');
}

// catalogId/categories (easydrop) — CRM aiNotes JSON має пріоритет над legacy funnelKey.
var easydropCfg = {};
try { var an = JSON.parse((supInfo && supInfo.aiNotes) || '{}'); if (an && an.easydrop) easydropCfg = an.easydrop; } catch (e) { }
var cfg = {
  mechanism: mech,
  catalogId: easydropCfg.catalogId || legacy.catalogId || '',
  categories: easydropCfg.categories || legacy.categories || [],
  loginUsername: (supInfo && supInfo.loginUsername) || '',
  loginPassword: (supInfo && supInfo.loginPassword) || '',
  telegramGroupId: (supInfo && supInfo.telegramGroupId) || ''
};

// Комплект: компоненти можуть бути від РІЗНИХ постачальників -> менеджеру йде розкладка (без змін логіки).
var items = (context.product && context.product.setItems) || [];
if (context.setMode === 'set' && items.length) {
  var brk = items.map(function (x) { return '- ' + x.name + ' (арт. ' + x.article + ') -> ' + (x.supplier || 'постачальник не вказаний'); }).join(String.fromCharCode(10));
  return { supplierMechanism: 'manual', supplierCfg: cfg, supplierSetBreakdown: brk };
}
return { supplierMechanism: cfg.mechanism, supplierCfg: cfg, supplierSetBreakdown: '' };
