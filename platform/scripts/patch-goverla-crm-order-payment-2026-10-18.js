'use strict';
// n_crm_order: спосіб оплати — у поля замовлення CRM (paymentType/prepaymentAmount, 18.10), а не лише текстом у коментарі менеджера.
// Відповідність способів бота: full → «Повна передплата»; cod (передоплата PREPAY_AMOUNT, решта накладеним) → «Часткова передплата»
// з сумою payAmount, а якщо сума ≥ суми замовлення (дешевий товар — бот бере всю суму) → «Повна»; cod_trust (без передоплати) → «Накладений».
// Постачальника позицій CRM ставить сама з товару каталогу (той самий, що бачить бот). Якщо CRM відхилить поля оплати (400) —
// замовлення створюється без них: оформлення клієнта важливіше за поле.
//   node scripts/patch-goverla-crm-order-payment-2026-10-18.js [--in=<файл>] [--out=<файл>] [--apply]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { db } = require(path.join(__dirname, '..', 'apps', 'api', 'src', 'services', 'shopAgent', 'lib'));
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const MARK = '/*crm-payment-type-2026-10-18*/';
const A1 = '    items: items\n  };\n';
const B1 = A1 +
    '  ' + MARK + '\n' +
    '  (function () {\n' +
    '    var __tot = items.reduce(function (s, it) { return s + (Number(it.price) || 0) * (Number(it.quantity) || 1); }, 0);\n' +
    '    var __pa = Number(context.payAmount) || 0;\n' +
    "    if (method === 'full') body.paymentType = 'full';\n" +
    "    else if (method === 'cod_trust') body.paymentType = 'cod';\n" +
    "    else if (method === 'cod' && __pa > 0) { if (__tot > 0 && __pa >= __tot) body.paymentType = 'full'; else { body.paymentType = 'partial'; body.prepaymentAmount = __pa; } }\n" +
    '  })();\n';
const A2 = "  var r = await fetch(base + '/orders', { method: 'POST', headers: hdr, body: JSON.stringify(body) });\n";
const B2 = A2 + "  if (!r.ok && r.status === 400 && body.paymentType) { delete body.paymentType; delete body.prepaymentAmount; r = await fetch(base + '/orders', { method: 'POST', headers: hdr, body: JSON.stringify(body) }); }\n";
const A3 = "  var payTxt = (method === 'cod') ? 'накладений + 200 передоплата' : (method === 'full' ? 'повна передоплата' : '—');";
const B3 = "  var payTxt = (method === 'cod') ? ('накладений + ' + (Number(context.payAmount) || 200) + ' передоплата') : (method === 'full' ? 'повна передоплата' : (method === 'cod_trust' ? 'накладений без передоплати' : '—'));";
(async () => {
    const apply = process.argv.includes('--apply');
    const inF = (process.argv.find((a) => a.startsWith('--in=')) || '').slice(5);
    const out = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
    const f = await db.flowDefinition.findFirst({ where: { botId: BOT } });
    const nodes = f.nodes; const n = nodes.find((x) => x.id === 'n_crm_order');
    let code = inF ? fs.readFileSync(inF, 'utf8') : String((n.data || {}).code || '');
    if (code.includes(MARK)) { console.log('вже застосовано'); if (out) fs.writeFileSync(out, code); process.exit(0); }
    for (const a of [A1, A2, A3]) if (code.split(a).length - 1 !== 1) { console.log('якір не однозначний:', a.slice(0, 70)); process.exit(1); }
    code = code.replace(A1, B1).replace(A2, B2).replace(A3, B3);
    if (out) fs.writeFileSync(out, code);
    if (apply) {
        n.data = { ...(n.data || {}), code };
        await db.flowDefinition.update({ where: { id: f.id }, data: { nodes } });
        console.log('застосовано: вузол n_crm_order');
    } else console.log('перевірка (без --apply нічого не записано)');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
