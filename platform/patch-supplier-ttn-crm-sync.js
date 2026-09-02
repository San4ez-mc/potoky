'use strict';
/*
 * ТІЛЬКИ CRM-клони (fcdee415/a2d5ba79) — запит власника (2026-09-02, чекліст перевірки
 * перенесення на нову СРМ, п.7): "Після оформлення в постачальника статус в новій СРМ
 * міняється? ТТН зберігається?" — перевірка показала, що НІ: n_supplier_order(_ed/_cart)
 * записують supplierTtn лише в context сесії (видно у вкладці "Ноди"), але НІЧОГО не
 * пишеться назад у Order.ttn/Order.stageId нової СРМ — власник дивиться в CRM і бачить
 * замовлення без ТТН і в стадії "Новий", хоча воно вже фактично відправлене постачальнику.
 *
 * Новий js-вузол n_ttn_sync_crm, вставлений МІЖ n_supplier_notify і n_ttn_cond (замінює
 * прямий edge): якщо є supplierTtn — PATCH /orders/:id нової СРМ з ttn:[...] і stageId
 * знайденої по назві стадії "Відправлено" (шукаємо по GET /pipelines щоразу — дешевий
 * рідкісний виклик, без хардкоду UUID стадії per-tenant). Best-effort, ніколи не блокує
 * клієнта (catch порожній) — це фонова синхронізація, не критичний для діалогу крок.
 *
 * ЗАПУСК:  node patch-supplier-ttn-crm-sync.js            (dry-run)
 *          node patch-supplier-ttn-crm-sync.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverlaCrmClone: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', covercarCrmClone: 'a2d5ba79-f87b-48f2-8301-56292cdf3972' };
const APPLY = process.argv.includes('--apply');

const NODE_CODE = `// Аудит 2026-09-02 (перевірка перенесення на нову СРМ, п.7 власника): раніше
// supplierTtn/supplierOrderId лишались лише в context сесії — Order у CRM ніколи не
// оновлювався (ні ttn, ні стадія), хоча постачальник уже фактично отримав замовлення.
// Best-effort — жодна помилка тут не має зупиняти чи ламати діалог з клієнтом.
if (context.crmOrderId && context.supplierTtn && String(context.supplierTtn).length > 3 && String(context.crmOrderId).indexOf('TEST-') !== 0) {
  try {
    var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\\/$/, '');
    var apiKey = (keys.CRM_API_KEY || '').trim();
    if (apiKey) {
      var hdr = { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' };
      var pr = await fetch(base + '/pipelines', { headers: hdr });
      var pj = await pr.json().catch(function () { return {}; });
      var stageId = null;
      if (pj && pj.ok && Array.isArray(pj.data)) {
        for (var i = 0; i < pj.data.length && !stageId; i++) {
          var stages = pj.data[i].stages || [];
          var hit = stages.filter(function (s) { return /відправлено/i.test(s.name || ''); })[0];
          if (hit) stageId = hit.id;
        }
      }
      var patchBody = { ttn: [String(context.supplierTtn)] };
      if (stageId) patchBody.stageId = stageId;
      await fetch(base + '/orders/' + context.crmOrderId, { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr), body: JSON.stringify(patchBody) });
    }
  } catch (e) { /* best-effort, не блокуємо клієнта через це */ }
}
return {};`;

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const already = flow.nodes.some((n) => n.id === 'n_ttn_sync_crm');
    if (already) { console.log(name, 'ALREADY_APPLIED'); return; }

    const notifyNode = flow.nodes.find((n) => n.id === 'n_supplier_notify');
    const ttnCondNode = flow.nodes.find((n) => n.id === 'n_ttn_cond');
    const edge = flow.edges.find((e) => e.source === 'n_supplier_notify' && e.target === 'n_ttn_cond');
    if (!notifyNode || !ttnCondNode || !edge) { console.log(name, 'WARNING: очікувані вузли/ребро не знайдені — перевір вручну.'); return; }

    console.log(name, 'буде додано n_ttn_sync_crm між n_supplier_notify і n_ttn_cond.');
    if (!APPLY) return;

    const newNode = {
        id: 'n_ttn_sync_crm',
        type: 'js',
        position: { x: (notifyNode.position.x + ttnCondNode.position.x) / 2, y: (notifyNode.position.y + ttnCondNode.position.y) / 2 + 60 },
        data: { code: NODE_CODE, label: '13.75 Синхронізувати ТТН/стадію в СРМ' },
    };
    const nodes = [...flow.nodes, newNode];
    const edges = flow.edges
        .filter((e) => !(e.source === 'n_supplier_notify' && e.target === 'n_ttn_cond'))
        .concat([
            { id: 'e_n_supplier_notify_n_ttn_sync_crm', source: 'n_supplier_notify', target: 'n_ttn_sync_crm' },
            { id: 'e_n_ttn_sync_crm_n_ttn_cond', source: 'n_ttn_sync_crm', target: 'n_ttn_cond' },
        ]);
    await db.flowDefinition.update({ where: { botId }, data: { nodes, edges } });
    console.log(name, 'APPLIED.');
}

async function main() {
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + NODE_CODE + '\n})();');
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
