'use strict';
// Patch (source of truth): goverla — звірка оплати за скріншотом (аудит B14, 14.10).
//
// Що було: n_reconcile сам слав скріншот у Gemini ЛИШЕ з ключем воронки GEMINI_API_KEY; з 29.09 той ключ відповідав 402 «credits
// depleted», помилка ковталась — скріншоти оплати не розпізнавались узагалі (vita.zayika, korotich394, _artem_0503), і ніхто не знав.
// До того ж «наша квитанція, але платника не знайдено» зараховувала НАЙСВІЖІШИЙ платіж цієї суми — при 63 платежах по 200 грн
// це чужі гроші.
// Тепер:
//   1) скріншот розпізнає tools.reconcile через спільну чергу ключів (geminiKey.js: ключ воронки → конектор → Claude; сповіщення в
//      групу, коли ключ відмовляє) і кладе результат у context.receiptVision — нода лише звіряє;
//   2) квитанція «наша» — IBAN/код ФОП на ній АБО код замовлення в призначенні;
//   3) платіж зараховуємо лише однозначно: код замовлення в коментарі платежу (крок 1) або ЄДИНИЙ платіж цієї суми від цього платника.
// n_confirm_prep: оформлено без оплати — просимо скріншот оплати (Артем: бот не попросив, менеджер просив за 9 хв).
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-goverla-reconcile-vision-2026-10-14.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const MARK = 'receiptVision (14.10)';

const STRICT = `// Однозначний платіж (${MARK}): ЄДИНИЙ незарахований платіж цієї суми, чий платник збігається з ПІБ на квитанції. Інакше — нічого.
function samePerson(a,b){ var aa=normName(a).split(' ').filter(function(x){return x.length>2;}); var bb=normName(b).split(' '); var n=0, seen={}; for(var i=0;i<aa.length;i++){ if(!seen[aa[i]] && bb.indexOf(aa[i])>=0){ n++; seen[aa[i]]=1; } } return n>=2; }
function matchStrict(amount, payer){ if(!amount||!payer)return null; var c=[]; for(var i=0;i<stmt.length;i++){ var t=stmt[i]; if(!isC(t.id) && Math.abs(Number(t.amountUah)-amount)<0.01 && samePerson(payer,(t.counterName||'')+' '+(t.description||''))) c.push(t); } return c.length===1?c[0]:null; }
var found = matchByRef();`;

const VISION_NEW = `// Крок 3: скріншот (${MARK}). Розпізнає tools.reconcile через спільну чергу ключів (ключ воронки → конектор → Claude, сповіщення
// в групу, коли ключ відмовляє) → context.receiptVision. Квитанція наша — IBAN/код ФОП або код замовлення в призначенні.
var rv = context.receiptVision;
if(!found && rv && typeof rv==='object' && rv.url && rv.url===context.lastReceiptImageUrl){
  var okRec3 = (EXPECTED_IBAN && String(rv.iban||'').replace(/\\s/g,'').indexOf(EXPECTED_IBAN)>=0) || (EXPECTED_CODE && String(rv.recipientCode||'').replace(/\\D/g,'').indexOf(EXPECTED_CODE)>=0) || (orderRef && String(rv.purpose||'').toUpperCase().indexOf(orderRef)>=0);
  var amt3 = Number(rv.amount)||parseAmount(rv.amount)||expected;
  if(okRec3){ found = matchStrict(amt3, rv.payerName); if(found) via='mono:ai'; }
}
`;

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    let changed = 0;

    const i = nodes.findIndex((n) => n.id === 'n_reconcile');
    if (i < 0) throw new Error('немає n_reconcile');
    let code = String(nodes[i].data.code || '');
    if (code.includes(MARK)) console.log('n_reconcile already patched');
    else {
        if (!code.includes('var found = matchByRef();')) throw new Error('n_reconcile: не знайдено «var found = matchByRef();»');
        code = code.replace('var found = matchByRef();', STRICT);
        // Крок 2 (посилання на квитанцію): той самий суворий збіг замість «найсвіжіший платіж цієї суми».
        const L_OLD = "if(okRec){ found = matchByAmount(amt||expected, { payerName:payer }); if(found) via='mono:link'; }";
        if (!code.includes(L_OLD)) throw new Error('n_reconcile: крок 2 змінено вручну');
        code = code.replace(L_OLD, "if(okRec && EXPECTED_IBAN){ found = matchStrict(amt||expected, payer); if(found) via='mono:link'; }");
        const a = code.indexOf('// Крок 3: скрін'); const b = code.indexOf('// Крок 4:');
        if (a < 0 || b < 0 || b < a) throw new Error('n_reconcile: не знайдено блок кроку 3');
        code = code.slice(0, a) + VISION_NEW + code.slice(b);
        nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
        changed++; console.log('patched n_reconcile');
    }

    const j = nodes.findIndex((n) => n.id === 'n_confirm_prep');
    if (j < 0) throw new Error('немає n_confirm_prep');
    let cp = String(nodes[j].data.code || '');
    const CP_MARK = '// скріншот оплати (14.10)';
    if (cp.includes(CP_MARK)) console.log('n_confirm_prep already patched');
    else {
        const ANCHOR = '// Строк відправки';
        if (!cp.includes(ANCHOR)) throw new Error('n_confirm_prep: не знайдено якір');
        cp = cp.replace(ANCHOR, CP_MARK + ': оформлено, а оплату ще не бачимо — просимо скріншот (бот раніше не просив, просили менеджери).\n' +
            "if (!paid && Number(context.payAmount) > 0 && !context.lastReceiptImageUrl) lead = lead + '\\nЯкщо вже оплатили — надішліть, будь ласка, сюди скріншот оплати 🙏';\n" + ANCHOR);
        nodes[j] = { ...nodes[j], data: { ...nodes[j].data, code: cp } };
        changed++; console.log('patched n_confirm_prep');
    }

    if (changed) await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
