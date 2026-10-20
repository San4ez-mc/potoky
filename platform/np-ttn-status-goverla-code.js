// Крон-бот "NP — статус посилок (goverla)". Викликається щогодини через POST /webhook/bot/<slug> (crontab на сервері).
//
// 2026-10-20 (власник: «нехай не бот бере, а СРМ, щоб статус одразу в СРМ оновився, бот має брати тільки звідти»):
// Нову пошту питає сама CRM (`POST /orders/ttn-sync`, crm-repo apps/api/src/lib/novaPoshta.js) — статус, очікувана дата
// доставки, етап (лише вперед). Цей вузол лише запускає її раз на годину й шле менеджерам підсумок змін.
// Стара версія питала НП сама, але брала лише 500 останніх рядків /orders (здебільшого картки розмов) і пропускала
// «оформлене в постачальника» — 97 зі 168 замовлень з ТТН за 14 днів лишались без статусу.

var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var crmKey = (keys.CRM_API_KEY || '').trim();
if (!crmKey) return { npSyncError: 'CRM_API_KEY не заповнено' };

var r;
try {
  var resp = await fetch(base + '/orders/ttn-sync', { method: 'POST', headers: { Authorization: 'Bearer ' + crmKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
  var j = await resp.json().catch(function () { return {}; });
  if (!j || !j.ok) return { npSyncError: 'CRM ttn-sync: ' + ((j && j.error && j.error.message) || ('HTTP ' + resp.status)) };
  r = j.data || {};
} catch (e) { return { npSyncError: 'CRM ttn-sync недоступна: ' + e.message }; }

var lines = [];
(r.moved || []).forEach(function (m) {
  var who = m.name || String(m.orderId).slice(0, 8);
  if (m.to === 'picked') lines.push('✅ ' + who + ' — забрав (' + m.ttn + ')');
  else if (m.to === 'arrived') lines.push('⏳ ' + who + ' — на відділенні, не забрав (' + m.ttn + ')');
});

// Підсумок менеджерам — лише коли щось реально змінилось («Відправлено» не шлемо — це щоденна рутина).
if (lines.length && keys.ADMIN_TELEGRAM_ID && keys.TELEGRAM_BOT_TOKEN) {
  try {
    var txt = '📦 <b>НП: статуси посилок оновлено</b>\n\n' + lines.slice(0, 20).join('\n') + (lines.length > 20 ? '\n… ще ' + (lines.length - 20) : '');
    await fetch('https://api.telegram.org/bot' + keys.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(keys.ADMIN_TELEGRAM_ID), text: txt, parse_mode: 'HTML' }),
    }).catch(function () {});
  } catch (e) { /* best-effort */ }
}

return { npSyncResult: { checked: r.checked || 0, updated: r.updated || 0, moved: (r.moved || []).length, skipped: r.skipped || null }, npSyncAt: new Date().toISOString() };
