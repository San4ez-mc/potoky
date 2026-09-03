// n_crm_order — версія для НОВОЇ Fineko CRM (заміна виклику KeyCRM POST /order).
// Контракт нової CRM (apps/api/src/routes/orders.js, buyers.js — прочитано напряму з сервера):
//   1) POST /buyers/find-or-create {phone, fullName} → { ok:true, data:{ id, ... } }  (дедуп за телефоном)
//   2) POST /orders { buyerId, sourceName, managerComment, shipping, items:[{productId,offerId,name,price,quantity,properties,isUpsell}] }
//      → { ok:true, data:{ id, ... } }  (stageId необов'язковий — бекенд бере першу стадію першого pipeline)
// testMode — та сама поведінка, що в KeyCRM-версії (n_crm_order-code.js): фейковий TEST-... id,
// реального виклику немає (правило §0.8 fineko-funnel-standard: зовнішні мутації під testMode-гард).
if (context.testMode) return { crmOrderId: ('TEST-' + Date.now()), orderSku: '', supplier: '' };
try {
  var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
  var apiKey = (keys.CRM_API_KEY || '').trim();
  if (!apiKey) return { crmOrderError: 'CRM_API_KEY не заповнено' };
  if (context.crmOrderId) return {}; // вже створено цього ходу/раніше — не дублюємо

  var p = context.product || {}; var od = context.orderData || {};
  var col = (context.colorChoice && context.colorChoice.color) || '';
  var size = context.recommendedSize || '';
  var method = (context.paymentInfo && context.paymentInfo.method) || '';
  // Аудит 2026-09-04: раніше `return {}` без пояснення → n_crm_order_cond бачив порожній
  // crmOrderId і слав менеджеру "ПОМИЛКА CRM" з порожньою причиною. Штатно сюди без адреси
  // не заходимо (n_has_address_cond перед цією нодою), але якщо все ж — причина явна.
  if (!od.phone) return { crmOrderError: 'адресу/телефон ще не зібрано (n_collect не пройдено)' };

  var phone = String(od.phone).replace(/[^0-9]/g, '');
  var hdr = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Accept: 'application/json' };

  // 1) buyer find-or-create (дедуп за телефоном, §1 ТЗ)
  var buyerId = context.crmClientId || null;
  if (!buyerId) {
    try {
      var br = await fetch(base + '/buyers/find-or-create', { method: 'POST', headers: hdr, body: JSON.stringify({ phone: phone, fullName: (od.fullName || 'Клієнт'), igUsername: context.igUsername || undefined }) });
      var bj = await br.json().catch(function () { return {}; });
      if (br.ok && bj && bj.ok && bj.data) buyerId = bj.data.id;
      else return { crmOrderError: 'buyers/find-or-create: ' + ((bj && bj.error && bj.error.message) || ('HTTP ' + br.status)) };
    } catch (e) { return { crmOrderError: 'buyers/find-or-create: ' + e.message }; }
  }

  // Завдання «памʼять вимірів клієнта»: якщо цієї сесії зібрали параметри розміру
  // (context.knownMeasurementsToSave з n_calc) — персистимо на Buyer (merge по ключах на
  // бекенді, не overwrite), best-effort, не блокує оформлення замовлення при помилці.
  if (buyerId && context.knownMeasurementsToSave) {
    try {
      await fetch(base + '/buyers/' + buyerId, { method: 'PATCH', headers: hdr, body: JSON.stringify({ knownMeasurements: context.knownMeasurementsToSave }) });
    } catch (e) { /* best-effort */ }
  }

  // 2) підбір offerId за обраним кольором/розміром (той самий принцип, що KeyCRM-версія)
  var offerId = null, sku = null; var offers = p.offers || [];
  for (var i = 0; i < offers.length; i++) {
    var props = offers[i].properties || [];
    var okC = !col || props.some(function (x) { return String(x.value) === String(col); });
    var hasSizeProp = props.some(function (x) { return /розмір|размер/i.test(String(x.name || '')); });
    var okS = !size || !hasSizeProp || props.some(function (x) { return /розмір|размер/i.test(String(x.name || '')) && String(x.value) === String(size); });
    if (okC && okS) { offerId = offers[i].id; sku = offers[i].sku; break; }
  }

  var propsOut = []; if (size) propsOut.push({ name: 'Розмір', value: size }); if (col) propsOut.push({ name: 'Колір', value: col });
  var payTxt = (method === 'cod') ? 'накладений + 200 передоплата' : (method === 'full' ? 'повна передоплата' : '—');
  var supplierName = (p.supplier || '').trim() || (context.supplier || '').trim() || '';
  var shopTag = (keys.SHOP_TAG || '').trim();

  var item = { productId: p.id || null, offerId: offerId, name: (p.customerName || p.name || 'Товар'), price: (p.price || 0), quantity: 1, properties: propsOut.length ? propsOut : null, isUpsell: false };
  var items = [item];
  // Допродаж: клієнт погодився в n_order_intent (json_output {"addUpsell":true}) — додаємо
  // ДРУГОЮ позицією замовлення (структуровано, isUpsell:true), а не лише текстом у коментарі.
  var upItems = (p.upsellItems || []);
  if (context.orderIntent && context.orderIntent.addUpsell && upItems.length) {
    var up0 = upItems[0];
    items.push({ productId: up0.id || null, offerId: null, name: up0.name || 'Допродаж', price: up0.price || 0, quantity: 1, properties: null, isUpsell: true });
  }
  var body = {
    buyerId: buyerId,
    sourceName: 'Instagram' + (shopTag ? (' ' + shopTag) : ''),
    managerComment: 'Товар: ' + (p.customerName || p.name || '') + ' | Розмір: ' + size + ' | Колір: ' + col + ' | Оплата: ' + payTxt + (supplierName ? (' | Постачальник: ' + supplierName) : '') + (items.length > 1 ? (' | + допродаж: ' + items[1].name) : '') + ' | Перевірити оплату.',
    shipping: { shippingService: 'Нова Пошта', city: (od.city || ''), branch: (od.branch || ''), recipientFullName: (od.fullName || ''), recipientPhone: phone },
    items: items
  };

  var r = await fetch(base + '/orders', { method: 'POST', headers: hdr, body: JSON.stringify(body) });
  var d = await r.json().catch(function () { return {}; });
  if (r.ok && d && d.ok && d.data && d.data.id) {
    return { crmOrderId: d.data.id, crmClientId: buyerId, supplier: supplierName, orderSku: (sku || '') };
  }
  return { crmOrderError: ((d && d.error && d.error.message) || (d && d.message) || ('HTTP ' + r.status)) };
} catch (e) { return { crmOrderError: e.message }; }
