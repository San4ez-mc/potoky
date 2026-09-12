// Крон-бот "NP — статус посилок (goverla)" — власник: "статус відправлено, відповідно воронку
// отримання статусу посилки по ТТН теж додай в проект флоус і зроби її по крону".
// Викликається щогодини через POST /webhook/bot/<slug> (crontab на сервері, той самий патерн,
// що meta-ads-sync-goverla). Один прохід = одна перевірка всіх активних ТТН.
//
// Контракт NP API перевірено ЖИВИМ викликом (2026-09-12) на реальних ТТН, не вигадано:
//   TrackingDocument.getStatusDocuments → StatusCode, RecipientDateTime, ActualDeliveryDate,
//   DateReturnCargo. RecipientDateTime непорожній АБО StatusCode==="9" → клієнт забрав.
//   StatusCode==="7" (і подібні "прибув у відділення") + RecipientDateTime порожній → чекає забору.
//   Менші коди (1-6) → в дорозі/обробка → "Відправлено".
//
// Обсяг НАВМИСНО простий (одна нода, без надмірної інженерії): жодних нових CRM-сутностей,
// лише PATCH існуючих /orders/:id (stageId) і /orders/:id/ttn-status (контракт вже був
// в CRM заздалегідь — "Flows-крон опитує Нову Пошту і пише сюди статус").

var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
var crmKey = (keys.CRM_API_KEY || '').trim();
var npKey = (keys.NOVAPOSHTA_API_KEY || '').trim();
if (!crmKey || !npKey) {
  return { npSyncError: 'CRM_API_KEY або NOVAPOSHTA_API_KEY не заповнено' };
}
var hdr = { Authorization: 'Bearer ' + crmKey, Accept: 'application/json' };

// 1) Тягнемо всі стадії pipeline один раз — щоб мапити назва → id.
var stagesById = {};
var stageIdByName = {};
try {
  var pr = await fetch(base + '/pipelines', { headers: hdr });
  var pj = await pr.json().catch(function () { return {}; });
  if (pj && pj.ok && Array.isArray(pj.data)) {
    pj.data.forEach(function (pl) {
      (pl.stages || []).forEach(function (s) {
        stagesById[s.id] = s.name;
        var key = String(s.name || '').trim().toLowerCase();
        if (!stageIdByName[key]) stageIdByName[key] = s.id;
      });
    });
  }
} catch (e) { return { npSyncError: 'не вдалось отримати pipelines: ' + e.message }; }

var STAGE_SENT = stageIdByName['відправлено'];
var STAGE_NOT_PICKED = stageIdByName['не забрав на пошті'];
var STAGE_PICKED = stageIdByName['клієнт забрав на пошті'];
if (!STAGE_SENT || !STAGE_NOT_PICKED || !STAGE_PICKED) {
  return { npSyncError: 'не знайдено одну з трьох стадій НП (Відправлено/Не забрав на пошті/Клієнт забрав на пошті) — перевір patch-np-ttn-stages' };
}
// Термінальні стадії — далі НЕ чіпаємо (вже забрав, повернення, дропшип-стадія постачальника не наша зона).
var SKIP_STAGE_IDS = {};
Object.keys(stageIdByName).forEach(function (k) {
  if (/клієнт забрав на пошті|повернення|обмін|оформлене в постачальника|не відписали/i.test(k)) SKIP_STAGE_IDS[stageIdByName[k]] = true;
});

// 2) Тягнемо замовлення з непорожнім ttn[], не в термінальних стадіях.
var orders = [];
try {
  var take = 500;
  var orr = await fetch(base + '/orders?take=' + take, { headers: hdr });
  var orj = await orr.json().catch(function () { return {}; });
  orders = (orj && orj.ok && Array.isArray(orj.data)) ? orj.data : [];
} catch (e) { return { npSyncError: 'не вдалось отримати orders: ' + e.message }; }

var candidates = orders.filter(function (o) {
  return Array.isArray(o.ttn) && o.ttn.length > 0 && !SKIP_STAGE_IDS[o.stageId];
});

var results = { checked: 0, movedToSent: 0, movedToNotPicked: 0, movedToPicked: 0, errors: 0 };
var notifyLines = [];

function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

for (var i = 0; i < candidates.length; i++) {
  var order = candidates[i];
  var ttn = order.ttn[order.ttn.length - 1]; // остання/найновіша накладна
  try {
    var npRes = await fetch('https://api.novaposhta.ua/v2.0/json/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: npKey, modelName: 'TrackingDocument', calledMethod: 'getStatusDocuments', methodProperties: { Documents: [{ DocumentNumber: ttn, Phone: '' }] } }),
    });
    var npJson = await npRes.json().catch(function () { return {}; });
    var d = npJson && Array.isArray(npJson.data) ? npJson.data[0] : null;
    if (!d) { results.errors++; continue; }
    results.checked++;

    var picked = !!(d.RecipientDateTime && String(d.RecipientDateTime).trim()) || String(d.StatusCode) === '9';
    var arrived = String(d.StatusCode) === '6' || String(d.StatusCode) === '7';
    var targetStageId = picked ? STAGE_PICKED : (arrived ? STAGE_NOT_PICKED : STAGE_SENT);

    if (targetStageId !== order.stageId) {
      await fetch(base + '/orders/' + order.id, { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr), body: JSON.stringify({ stageId: targetStageId }) });
      if (targetStageId === STAGE_PICKED) { results.movedToPicked++; notifyLines.push('✅ ' + (order.buyer && order.buyer.fullName || order.id.slice(0, 8)) + ' — забрав (' + ttn + ')'); }
      else if (targetStageId === STAGE_NOT_PICKED) { results.movedToNotPicked++; notifyLines.push('⏳ ' + (order.buyer && order.buyer.fullName || order.id.slice(0, 8)) + ' — на відділенні, не забрав (' + ttn + ')'); }
      else { results.movedToSent++; }
    }
    // Окремо синхронізуємо сирий текстовий статус НП (контракт /ttn-status вже був у CRM заздалегідь).
    await fetch(base + '/orders/' + order.id + '/ttn-status', { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr), body: JSON.stringify({ ttnStatus: String(d.Status || '') }) }).catch(function () {});
  } catch (e) { results.errors++; }
  await sleep(350); // NP API rate-limit — не б'ємо чергою без пауз
}

// Best-effort сповіщення адміну підсумком (лише якщо щось реально змінилось).
if (notifyLines.length && keys.ADMIN_TELEGRAM_ID && keys.TELEGRAM_BOT_TOKEN) {
  try {
    var txt = '📦 <b>НП: статуси посилок оновлено</b>\n\n' + notifyLines.slice(0, 20).join('\n') + (notifyLines.length > 20 ? '\n… ще ' + (notifyLines.length - 20) : '');
    await fetch('https://api.telegram.org/bot' + keys.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(keys.ADMIN_TELEGRAM_ID), text: txt, parse_mode: 'HTML' }),
    }).catch(function () {});
  } catch (e) { /* best-effort */ }
}

return { npSyncResult: Object.assign({ candidates: candidates.length }, results), npSyncAt: new Date().toISOString() };
