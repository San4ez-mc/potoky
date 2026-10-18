// Автооформлення вимкнено (SUPPLIER_ORDERS_DISABLED=1), оплата одразу: «НОВЕ ЗАМОВЛЕННЯ» з кнопкою вже сказав «оформіть» —
// другий алерт «оформіть постачальнику вручну» в тому ж ході не йде (Edits b5fb5867). Оплата ПІЗНІШЕ (окремий хід) — алерт з кнопкою йде.
// Алерти й запис у CRM підмінені — у Telegram і CRM нічого не потрапляє.
//   node scripts/qa/test-manual-supplier-alert-once-2026-10-18.js
process.chdir(require('path').join(__dirname, '..', '..'));
const path = require('path');
const SA = path.join(__dirname, '../../apps/api/src/services/shopAgent/');
const { loadAssets } = require(SA + 'lib');
const T = require(SA + 'tools');
const P = require(SA + 'policy');
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
(async () => {
    const assets = await loadAssets(BOT);
    let alerts = [];
    T.alert = async (A, id, extra) => { alerts.push({ id, buttons: ((extra && extra.buttons) || []).length }); };
    T.ttnSync = async () => {}; T.funnelStage = async () => {};
    const mk = (flag) => ({
        botId: BOT, assets, keys: { ...assets.keys, SUPPLIER_ORDERS_DISABLED: '1' }, session: { id: 'qa-manual-once' }, out: [], createAlertCoversManual: flag,
        ctx: { product: { id: 'P1', sku: 'A0187', name: 'Кофта', price: 1279, supplier: 'brewdrop.in.ua' }, orderUnits: [{ color: 'Чорний', size: 'L' }], recommendedSize: 'L', colorChoice: { color: 'Чорний' },
            payStatus: 'confirmed', payAmount: 200, orderUnitsTotal: 1279, crmOrderId: 'ORDER-QA', agent: {}, senderName: 'QA', igUsername: 'qa' },
    });
    let fail = 0;
    alerts = []; await P.runSupplierDispatch(mk(true));
    const sameTurn = alerts.filter((a) => a.id === 'n_agent_supplier_manual_admin').length;
    console.log((sameTurn === 0 ? '✅' : '❌') + ' оплата одразу (НОВЕ ЗАМОВЛЕННЯ з кнопкою вже пішло): алертів «оформіть вручну» — ' + sameTurn + ' (очікую 0)'); if (sameTurn) fail++;
    alerts = []; await P.runSupplierDispatch(mk(false));
    const later = alerts.filter((a) => a.id === 'n_agent_supplier_manual_admin');
    const okLater = later.length === 1 && later[0].buttons > 0;
    console.log((okLater ? '✅' : '❌') + ' оплата пізніше (окремий хід): алертів «оформіть вручну» — ' + later.length + ', з кнопкою: ' + (later[0] ? later[0].buttons > 0 : false) + ' (очікую 1 з кнопкою)'); if (!okLater) fail++;
    // не вказано колір → окремий алерт лишається навіть після НОВЕ ЗАМОВЛЕННЯ
    const A3 = mk(true); A3.ctx.orderUnits = [{ color: '', size: 'L' }]; delete A3.ctx.colorChoice;
    alerts = []; await P.runSupplierDispatch(A3);
    const inc = alerts.filter((a) => a.id === 'n_agent_supplier_manual_admin').length;
    console.log((inc === 1 ? '✅' : '❌') + ' бракує кольору: окремий алерт — ' + inc + ' (очікую 1)'); if (inc !== 1) fail++;
    console.log(fail ? '❌ провалено: ' + fail : '✅ усі перевірки пройшли');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
