// n_crm_order → CRM: спосіб оплати в полях замовлення (18.10). CRM підмінена (нічого не створюється): ловимо тіло POST /orders.
//   CODE=/tmp/n_crm_order.patched.js node scripts/qa/test-crm-order-payment-2026-10-18.js
process.chdir(require('path').join(__dirname, '..', '..'));
const path = require('path');
const fs = require('fs');
const { loadAssets, runNodeCode } = require(path.join(__dirname, '../../apps/api/src/services/shopAgent/lib'));
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
let posts = []; let reject400 = false;
global.fetch = async (url, opts = {}) => {
    const u = String(url); const m = (opts.method || 'GET').toUpperCase();
    const ok = (data) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (m === 'POST' && /\/orders$/.test(u)) {
        const b = JSON.parse(opts.body); posts.push(b);
        if (reject400 && b.paymentType) return new Response(JSON.stringify({ ok: false, error: { code: 'VALIDATION', message: 'Передплата більша за суму' } }), { status: 400 });
        return ok({ id: 'ORDER-' + posts.length });
    }
    if (/buyers\/find-or-create/.test(u)) return ok({ id: 'BUYER-1' });
    if (/\/pipelines/.test(u)) return ok([]);
    if (/\/ads/.test(u)) return ok([]);
    return ok({});
};
const CASES = [
    // [назва, method, payAmount, ціна, кількість, очікуваний paymentType, очікувана передплата]
    ['часткова 200 (накладений + передоплата)', 'cod', 200, 1199, 1, 'partial', 200],
    ['повна передплата', 'full', 1199, 1199, 1, 'full', undefined],
    ['без передоплати (виняток)', 'cod_trust', 0, 1199, 1, 'cod', undefined],
    ['дешевий товар: бот бере всю суму', 'cod', 180, 180, 1, 'full', undefined],
    ['2 шт, часткова', 'cod', 200, 899, 2, 'partial', 200],
    ['спосіб ще не відомий', '', 0, 1199, 1, undefined, undefined],
];
(async () => {
    const assets = await loadAssets(BOT);
    const code = fs.readFileSync(process.env.CODE, 'utf8');
    let fail = 0;
    for (const [name, method, pa, price, qty, wantType, wantAmt] of CASES) {
        posts = []; reject400 = false;
        const units = Array.from({ length: qty }, () => ({ color: 'чорний', size: 'L' }));
        const ctx = { product: { id: 'P1', sku: 'A0187', name: 'Кофта', price, supplier: 'BrewDrop' }, orderUnits: units, recommendedSize: 'L', colorChoice: { color: 'чорний' },
            orderData: { phone: '380000000000', fullName: 'Тест Тестович', city: 'Київ', branch: '1' }, paymentInfo: { method }, payAmount: pa, payStatus: 'pending', agent: {} };
        await runNodeCode(code, { ctx, keys: { ...assets.keys, CRM_API_BASE: 'http://crm.mock/api' }, user: {}, session: { id: 'test-pay' }, input: '', label: 'n_crm_order' });
        const b = posts[0] || {};
        const good = b.paymentType === wantType && b.prepaymentAmount === wantAmt && posts.length === 1 && ctx.crmOrderId === 'ORDER-1';
        if (!good) fail++;
        console.log((good ? '✅ ' : '❌ ') + name + ': paymentType=' + b.paymentType + ', передплата=' + b.prepaymentAmount + (good ? '' : ' (очікую ' + wantType + '/' + wantAmt + '; POST ' + posts.length + ', order ' + ctx.crmOrderId + ')'));
    }
    // CRM відхилила поля оплати → замовлення все одно створюється (другий POST без них)
    posts = []; reject400 = true;
    const ctx = { product: { id: 'P1', sku: 'A0187', name: 'Кофта', price: 1199 }, orderUnits: [{ color: 'чорний', size: 'L' }], orderData: { phone: '380000000000', fullName: 'Т', city: 'Київ', branch: '1' }, paymentInfo: { method: 'cod' }, payAmount: 200, agent: {} };
    await runNodeCode(code, { ctx, keys: { ...assets.keys, CRM_API_BASE: 'http://crm.mock/api' }, user: {}, session: { id: 'test-pay2' }, input: '', label: 'n_crm_order' });
    const ok2 = posts.length === 2 && !posts[1].paymentType && ctx.crmOrderId === 'ORDER-2';
    if (!ok2) fail++;
    console.log((ok2 ? '✅ ' : '❌ ') + 'CRM відхилила оплату → замовлення створено без неї (POST ' + posts.length + ', order ' + ctx.crmOrderId + ')');
    console.log(fail ? '❌ провалено: ' + fail : '✅ усі перевірки пройшли');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
