'use strict';
/*
 * Завдання 1 (сесія «памʼять вимірів клієнта» — Buyer.knownMeasurements, нова CRM):
 * патчить КЛОНИ (не старі живі боти!) fcdee415-... (goverla) і a2d5ba79-... (covercar) —
 *
 *   §1 n_lookup — впізнає покупця РАНІШЕ, ніж дізнаємось телефон (GET /buyers/lookup?
 *      igUsername=/phone=), готує context.knownMeasurementsText, якщо в CRM УЖЕ є Buyer
 *      з УСІМА потрібними параметрами САМЕ ЦІЄЇ категорії. Джерело — n_lookup-crm-code.js
 *      (оновлений локальний файл, exact-equality idempotency, той самий підхід що
 *      patch-clone-crm-integration.js).
 *   §2 n_size — якщо context.knownMeasurementsText непорожній, ставить КОРОТКЕ
 *      підтвердження замість повного питання (анкор-патч, .includes() ідемпотентність
 *      на унікальному маркері).
 *   §3 n_calc — рахує context.knownMeasurementsToSave = {[paramName]: value} (ключі —
 *      ТІ САМІ, що categoryParams[].name) для ВСІХ 3 виходів; якщо buyer вже відомий
 *      (context.crmClientId — рано впізнаний у n_lookup) — зберігає одразу (best-effort),
 *      не чекаючи оформлення замовлення (щоб "клієнт сказав ні, тепер інакше" не загубилось,
 *      якщо він так і не дійде до чекауту).
 *   §4 n_crm_order — (а) передає igUsername у buyers/find-or-create (щоб НОВОГО покупця
 *      можна було впізнати по igUsername наступного разу), (б) PATCH knownMeasurements
 *      на щойно знайденого/створеного buyer — головний шлях збереження для НОВИХ клієнтів
 *      (Buyer.phone required — не можна створити Buyer раніше, ніж дізнаємось телефон).
 *
 * ЗАПУСК:  node patch-buyer-known-measurements.js            (dry-run)
 *          node patch-buyer-known-measurements.js --apply    (записує у БД)
 *
 * Ідемпотентний (маркер/exact-equality на кожен анкор окремо). НЕ чіпає старі живі боти
 * 5bdb3e38.../cc03657f... (SKIP за конструкцією — BOTS нижче містить лише КЛОНИ).
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const BOTS = {
    goverlaClone: { botId: 'fcdee415-bef2-4a74-a650-e6e4b5a12322' },
    covercarClone: { botId: 'a2d5ba79-f87b-48f2-8301-56292cdf3972' },
};

const LOOKUP_CODE = fs.readFileSync(path.join(__dirname, 'n_lookup-crm-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

// §2 n_size — анкор точно на кінці існуючого рядка dialogStateText (спільний для обох ботів).
const SIZE_OLD = 'КОРОТКИЙ СТАН ДІАЛОГУ (додатковий контекст для орієнтації — НЕ заміняє прапорці й правила вище/нижче, вони точніші): {{context.dialogStateText}}\n';
const SIZE_NEW = SIZE_OLD
    + '🔁 ПОПЕРЕДНІ ЗНАЧЕННЯ ПАРАМЕТРІВ (якщо клієнт уже писав їх раніше САМЕ для цієї категорії товару — рядок нижче НЕ порожній; якщо порожній — даних нема або вони неповні, працюй як завжди): {{context.knownMeasurementsText}}\n'
    + 'ЯКЩО рядок вище НЕ порожній — НЕ стався звичайне повне питання. Постав ЛИШЕ ОДНЕ коротке підтвердження, напр.: «Ви раніше писали {{context.knownMeasurementsText}} — це ще актуально?». Якщо клієнт підтверджує (так/да/актуально/вірно/ага/без змін тощо) — одразу поверни json_output із цими самими значеннями у ТОМУ Ж форматі, що описано нижче (height/weight, якщо прапорець ЗРІСТ_І_ВАГА="true", інакше clothingSize) — БЕЗ додаткового питання. Якщо клієнт каже, що щось змінилось, або одразу дає нові цифри — прийми саме ці НОВІ значення як звичайний збір нижче.\n';
const SIZE_DONE_MARKER = 'ПОПЕРЕДНІ ЗНАЧЕННЯ ПАРАМЕТРІВ';

// §3 n_calc — обчислення knownMeasurementsToSave один раз (доступне для всіх виходів) +
// негайне best-effort збереження, якщо buyer вже відомий рано (context.crmClientId).
const CALC_ANCHOR_OLD = 'var s0 = context.sizeInput || {};';
const CALC_ANCHOR_NEW = `var s0 = context.sizeInput || {};
// Завдання «памʼять вимірів клієнта»: готуємо {[paramName]: value} для збереження на Buyer —
// ключі СУВОРО ті самі, що categoryParams[].name (без фаззі-мапінгу), щоб знак рівності
// спрацював при наступному підборі розміру для товару тієї ж категорії. Рахуємо ОДИН раз тут
// (доступно для ВСІХ виходів нижче — exact-measurement/oor/звичайний), а не в кожному return.
var __kmCatParams = (context.product && context.product.categoryParams) || [];
var __kmIsHW = !!(context.product && context.product.categoryParamsIsHeightWeight);
var __kmSave = null;
if (__kmCatParams.length) {
  var __kmNameH = null, __kmNameW = null;
  for (var __kmi = 0; __kmi < __kmCatParams.length; __kmi++) {
    var __kmLn = String(__kmCatParams[__kmi].name || '').toLowerCase();
    if (/зріст|height|ріст/.test(__kmLn)) __kmNameH = __kmCatParams[__kmi].name;
    if (/вага|weight/.test(__kmLn)) __kmNameW = __kmCatParams[__kmi].name;
  }
  if (__kmIsHW && __kmNameH && __kmNameW && (s0.height || s0.weight)) {
    __kmSave = {};
    if (s0.height) __kmSave[__kmNameH] = String(s0.height);
    if (s0.weight) __kmSave[__kmNameW] = String(s0.weight);
  } else if (!__kmIsHW && s0.clothingSize) {
    __kmSave = {};
    if (__kmCatParams.length === 1) {
      __kmSave[__kmCatParams[0].name] = String(s0.clothingSize).trim();
    } else {
      var __kmParts = String(s0.clothingSize).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      for (var __kmj = 0; __kmj < __kmCatParams.length && __kmj < __kmParts.length; __kmj++) { __kmSave[__kmCatParams[__kmj].name] = __kmParts[__kmj]; }
    }
  }
}
// Клієнт уже впізнаний РАНІШЕ (n_lookup через igUsername/phone, context.crmClientId) — не
// чекаємо на n_crm_order (сесія може так і не дійти до оформлення), зберігаємо одразу,
// best-effort (не блокує підбір розміру при помилці мережі/CRM).
if (__kmSave && context.crmClientId && !context.testMode) {
  try {
    var __kmBase = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\\/$/, '');
    var __kmKey = (keys.CRM_API_KEY || '').trim();
    if (__kmKey) {
      await fetch(__kmBase + '/buyers/' + context.crmClientId, { method: 'PATCH', headers: { Authorization: 'Bearer ' + __kmKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ knownMeasurements: __kmSave }) });
    }
  } catch (e) { /* best-effort */ }
}`;
const CALC_DONE_MARKER = 'knownMeasurementsToSave';

const CALC_RETURNS = [
    {
        old: "return { recommendedSize: exactSize, sizeOutOfRange: false, sizeMatchedBy: 'exact_measurement', sizeColorFollowup: __sizeColorFollowup, sizeAskedFor: (context.product && context.product.categoryId) || true };",
        new: "return { recommendedSize: exactSize, sizeOutOfRange: false, sizeMatchedBy: 'exact_measurement', sizeColorFollowup: __sizeColorFollowup, sizeAskedFor: (context.product && context.product.categoryId) || true, knownMeasurementsToSave: __kmSave };",
    },
    {
        old: "return { sizeOutOfRange: true, sizeOorReason: (oorH?('зріст '+h+' см поза сіткою ('+hMin+'-'+hMax+')'):'') + (oorH&&oorW?'; ':'') + (oorW?('вага '+w+' кг поза сіткою ('+wMin+'-'+wMax+')'):''), recommendedSize: size || '', sizeAskedFor: (context.product && context.product.categoryId) || true };",
        new: "return { sizeOutOfRange: true, sizeOorReason: (oorH?('зріст '+h+' см поза сіткою ('+hMin+'-'+hMax+')'):'') + (oorH&&oorW?'; ':'') + (oorW?('вага '+w+' кг поза сіткою ('+wMin+'-'+wMax+')'):''), recommendedSize: size || '', sizeAskedFor: (context.product && context.product.categoryId) || true, knownMeasurementsToSave: __kmSave };",
    },
    {
        old: "return { recommendedSize: size, sizeOutOfRange: false, sizeColorFollowup: __sizeColorFollowup, sizeAskedFor: (context.product && context.product.categoryId) || true };",
        new: "return { recommendedSize: size, sizeOutOfRange: false, sizeColorFollowup: __sizeColorFollowup, sizeAskedFor: (context.product && context.product.categoryId) || true, knownMeasurementsToSave: __kmSave };",
    },
];

// §4 n_crm_order — igUsername у find-or-create + PATCH knownMeasurements на buyer.
const ORDER_FOC_OLD = "var br = await fetch(base + '/buyers/find-or-create', { method: 'POST', headers: hdr, body: JSON.stringify({ phone: phone, fullName: (od.fullName || 'Клієнт') }) });";
const ORDER_FOC_NEW = "var br = await fetch(base + '/buyers/find-or-create', { method: 'POST', headers: hdr, body: JSON.stringify({ phone: phone, fullName: (od.fullName || 'Клієнт'), igUsername: context.igUsername || undefined }) });";

const ORDER_SAVE_ANCHOR_OLD = `    } catch (e) { return { crmOrderError: 'buyers/find-or-create: ' + e.message }; }
  }

  // 2) підбір offerId за обраним кольором/розміром (той самий принцип, що KeyCRM-версія)`;
const ORDER_SAVE_ANCHOR_NEW = `    } catch (e) { return { crmOrderError: 'buyers/find-or-create: ' + e.message }; }
  }

  // Завдання «памʼять вимірів клієнта»: якщо цієї сесії зібрали параметри розміру
  // (context.knownMeasurementsToSave з n_calc) — персистимо на Buyer (merge по ключах на
  // бекенді, не overwrite), best-effort, не блокує оформлення замовлення при помилці.
  if (buyerId && context.knownMeasurementsToSave) {
    try {
      await fetch(base + '/buyers/' + buyerId, { method: 'PATCH', headers: hdr, body: JSON.stringify({ knownMeasurements: context.knownMeasurementsToSave }) });
    } catch (e) { /* best-effort */ }
  }

  // 2) підбір offerId за обраним кольором/розміром (той самий принцип, що KeyCRM-версія)`;
const ORDER_DONE_MARKER = 'context.knownMeasurementsToSave) {';

async function patchBot(name, cfg) {
    const { botId } = cfg;
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    const nSize = flow.nodes.find((n) => n.id === 'n_size');
    const nCalc = flow.nodes.find((n) => n.id === 'n_calc');
    const nCrmOrder = flow.nodes.find((n) => n.id === 'n_crm_order');
    if (!nLookup || !nSize || !nCalc || !nCrmOrder) { console.log(name, 'ERROR: якась з нод n_lookup/n_size/n_calc/n_crm_order не знайдена'); return; }

    const lookupDone = (nLookup.data.code || '') === LOOKUP_CODE;
    const sizeDone = (nSize.data.systemPrompt || '').includes(SIZE_DONE_MARKER);
    const calcDone = (nCalc.data.code || '').includes(CALC_DONE_MARKER);
    const orderFocDone = (nCrmOrder.data.code || '').includes('igUsername: context.igUsername || undefined');
    const orderSaveDone = (nCrmOrder.data.code || '').includes(ORDER_DONE_MARKER);

    console.log(name, {
        n_lookup: lookupDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
        n_size: sizeDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
        n_calc: calcDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
        n_crm_order_igUsername: orderFocDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
        n_crm_order_save: orderSaveDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
    });

    if (!sizeDone && !(nSize.data.systemPrompt || '').includes(SIZE_OLD)) console.log(name, 'WARNING: n_size — анкор не знайдено, пропускаю.');
    if (!calcDone) {
        if (!(nCalc.data.code || '').includes(CALC_ANCHOR_OLD)) console.log(name, 'WARNING: n_calc — головний анкор не знайдено, пропускаю.');
        for (const r of CALC_RETURNS) { if (!(nCalc.data.code || '').includes(r.old)) console.log(name, 'WARNING: n_calc — return-анкор не знайдено:', r.old.slice(0, 60) + '...'); }
    }
    if (!orderFocDone && !(nCrmOrder.data.code || '').includes(ORDER_FOC_OLD)) console.log(name, 'WARNING: n_crm_order — find-or-create анкор не знайдено, пропускаю.');
    if (!orderSaveDone && !(nCrmOrder.data.code || '').includes(ORDER_SAVE_ANCHOR_OLD)) console.log(name, 'WARNING: n_crm_order — save анкор не знайдено, пропускаю.');

    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_lookup' && !lookupDone) return { ...n, data: { ...n.data, code: LOOKUP_CODE } };
        if (n.id === 'n_size' && !sizeDone && (n.data.systemPrompt || '').includes(SIZE_OLD)) {
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.split(SIZE_OLD).join(SIZE_NEW) } };
        }
        if (n.id === 'n_calc' && !calcDone) {
            let code = n.data.code || '';
            if (code.includes(CALC_ANCHOR_OLD)) code = code.split(CALC_ANCHOR_OLD).join(CALC_ANCHOR_NEW);
            for (const r of CALC_RETURNS) { if (code.includes(r.old)) code = code.split(r.old).join(r.new); }
            return { ...n, data: { ...n.data, code } };
        }
        if (n.id === 'n_crm_order' && (!orderFocDone || !orderSaveDone)) {
            let code = n.data.code || '';
            if (!orderFocDone && code.includes(ORDER_FOC_OLD)) code = code.split(ORDER_FOC_OLD).join(ORDER_FOC_NEW);
            if (!orderSaveDone && code.includes(ORDER_SAVE_ANCHOR_OLD)) code = code.split(ORDER_SAVE_ANCHOR_OLD).join(ORDER_SAVE_ANCHOR_NEW);
            return { ...n, data: { ...n.data, code } };
        }
        return n;
    });
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, cfg] of Object.entries(BOTS)) await patchBot(name, cfg);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
