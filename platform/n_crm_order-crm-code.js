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
  if (!od.phone) return {}; // адресу/телефон ще не зібрано — цей крок ще не має запускатись

  var phone = String(od.phone).replace(/[^0-9]/g, '');
  var hdr = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Accept: 'application/json' };

  // 1) buyer find-or-create (дедуп за телефоном, §1 ТЗ)
  var buyerId = context.crmClientId || null;
  if (!buyerId) {
    try {
      var br = await fetch(base + '/buyers/find-or-create', { method: 'POST', headers: hdr, body: JSON.stringify({ phone: phone, fullName: (od.fullName || 'Клієнт') }) });
      var bj = await br.json().catch(function () { return {}; });
      if (br.ok && bj && bj.ok && bj.data) buyerId = bj.data.id;
      else return { crmOrderError: 'buyers/find-or-create: ' + ((bj && bj.error && bj.error.message) || ('HTTP ' + br.status)) };
    } catch (e) { return { crmOrderError: 'buyers/find-or-create: ' + e.message }; }
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
  var body = {
    buyerId: buyerId,
    sourceName: 'Instagram' + (shopTag ? (' ' + shopTag) : ''),
    managerComment: 'Товар: ' + (p.customerName || p.name || '') + ' | Розмір: ' + size + ' | Колір: ' + col + ' | Оплата: ' + payTxt + (supplierName ? (' | Постачальник: ' + supplierName) : '') + ' | Перевірити оплату.',
    shipping: { shippingService: 'Нова Пошта', city: (od.city || ''), branch: (od.branch || ''), recipientFullName: (od.fullName || ''), recipientPhone: phone },
    items: [item]
  };

  var r = await fetch(base + '/orders', { method: 'POST', headers: hdr, body: JSON.stringify(body) });
  var d = await r.json().catch(function () { return {}; });
  if (r.ok && d && d.ok && d.data && d.data.id) {
    return { crmOrderId: d.data.id, crmClientId: buyerId, supplier: supplierName, orderSku: (sku || '') };
  }
  return { crmOrderError: ((d && d.error && d.error.message) || (d && d.message) || ('HTTP ' + r.status)) };
} catch (e) { return { crmOrderError: e.message }; }
