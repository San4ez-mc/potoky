'use strict';
/*
 * Регресійний прогін 2026-09-03 (фінальна перевірка перед свапом трафіку на нову CRM),
 * сценарій "isSet-товар, клієнт бере ОКРЕМУ позицію з набору" — знайшов, що n_set_apply
 * НІКОЛИ не був перенесений на нову Fineko CRM разом з n_lookup/n_crm_order/n_supplier_route
 * (patch-clone-crm-integration.js, 2026-09-02): він і досі ходить у KEYCRM_API_BASE з
 * KeyCRM Bearer-токеном, передаючи ЯК product_id — UUID нової CRM (setComponents[].productId,
 * підставлений n_lookup-crm-code.js). Запит до KeyCRM з чужим ID мовчки провалюється
 * (порожній try/catch) → colors/sizes/offers/photo/isClothing/categoryParams для ОКРЕМО
 * вибраної позиції набору лишаються ПОРОЖНІМИ. Живий наслідок: клієнт, що каже "беру
 * окрему кофту з набору", ніколи не бачить вибору кольору (n_has_colors бачить порожній
 * colors → пропускає крок) і НІКОЛИ не отримує питання зросту/ваги (isClothing:
 * sizes.length>0 завжди false), хоча товар одяг і потребує розміру — реальний ризик
 * оформити замовлення БЕЗ кольору/розміру.
 *
 * Фікс (n_set_apply-crm-code.js) — той самий підхід, що n_lookup вже використовує для
 * setItems: GET {CRM_API_BASE}/products/:id (offers/фото) + GET {CRM_API_BASE}/categories/:id
 * (requiredParams → isClothing/categoryParamsPrompt/categoryParamsIsHeightWeight), Bearer
 * CRM_API_KEY — замість KeyCRM.
 *
 * Ідемпотентний (точна рівність коду). ЗАПУСК:
 *   node patch-set-apply-crm.js            (dry-run)
 *   node patch-set-apply-crm.js --apply    (записує у БД)
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const BOTS = {
    goverlaClone: 'fcdee415-bef2-4a74-a650-e6e4b5a12322',
    covercarClone: 'a2d5ba79-f87b-48f2-8301-56292cdf3972',
};

const NEW_CODE = fs.readFileSync(path.join(__dirname, 'n_set_apply-crm-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }
    const node = flow.nodes.find((n) => n.id === 'n_set_apply');
    if (!node) { console.log(name, 'ERROR: n_set_apply not found'); return; }

    const done = (node.data.code || '') === NEW_CODE;
    console.log(name, botId, done ? 'ALREADY_APPLIED' : 'WILL_PATCH');
    if (!APPLY || done) return;

    const nodes = flow.nodes.map((n) => n.id === 'n_set_apply' ? { ...n, data: { ...n.data, code: NEW_CODE } } : n);
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
