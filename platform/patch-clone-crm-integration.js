'use strict';
/*
 * ТЗ «goverla_shop/covercar_ua → нова Fineko CRM»: переписує КЛОНИ (не старі живі боти!)
 * fcdee415-... (goverla) і a2d5ba79-... (covercar) так, щоб n_lookup/n_crm_order/n_supplier_route
 * ходили в нову CRM (http://127.0.0.1:4700/api, Bearer tenant.apiKey) замість KeyCRM.
 *
 * §1 — n_lookup: нова логіка матчингу (n_lookup-crm-code.js), джерело істини.
 * §2 — n_crm_order: buyers/find-or-create → POST /orders (n_crm_order-crm-code.js).
 * §3 — n_size: systemPrompt тепер бере параметри підбору розміру з
 *      context.product.categoryParams (CRM Category.requiredParams), а не з хардкоду
 *      "зріст і вага" в тексті ноди — працює для будь-якої категорії.
 * §4 — n_supplier_route: mechanism/логін/aiNotes постачальника — з CRM supplierInfo
 *      (n_supplier_route-crm-code.js), а не з SUPPLIER_MAP/SUPPLIER_CONFIG funnelKey
 *      (legacy SUPPLIER_CONFIG лишається лише фолбеком для easydrop catalogId/categories,
 *      яких CRM-схема Supplier поки не моделює — див. коментар у файлі).
 * Ключі: CRM_API_BASE (спільний, локальний internal URL) + CRM_API_KEY (per-bot,
 *   tenant.apiKey нової CRM) + CRM_PUBLIC_BASE (публічний origin для /uploads-фото).
 *
 * ЗАПУСК:  node patch-clone-crm-integration.js            (dry-run)
 *          node patch-clone-crm-integration.js --apply    (записує у БД)
 *
 * Ідемпотентний. НЕ чіпає старі живі боти 5bdb3e38.../cc03657f... (SKIP за конструкцією —
 * BOTS нижче містить лише КЛОНИ).
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const BOTS = {
    goverlaClone: { botId: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', crmApiKey: '7c5a086f-ec52-44d2-bd82-e315a2a793c8' },
    covercarClone: { botId: 'a2d5ba79-f87b-48f2-8301-56292cdf3972', crmApiKey: '01d34bfd-1c1f-428d-a10b-ab4b281c75a4' },
};
const CRM_API_BASE = 'http://127.0.0.1:4700/api';
const CRM_PUBLIC_BASE = 'https://pcrm.fineko.space';

const LOOKUP_CODE = fs.readFileSync(path.join(__dirname, 'n_lookup-crm-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
const CRM_ORDER_CODE = fs.readFileSync(path.join(__dirname, 'n_crm_order-crm-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
const SUPPLIER_ROUTE_CODE = fs.readFileSync(path.join(__dirname, 'n_supplier_route-crm-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

// §3 ТЗ — n_size systemPrompt, узагальнений під CRM Category.requiredParams замість
// хардкоду "зріст і вага". Базується на актуальному (сьогоднішньому, після
// patch-size-followup-dedup.js + patch-size-productjustpresented.js) промпті —
// зберігає весь анти-дубль контракт (productJustPresented), лише узагальнює ЦІЛЬ кроку.
const NEW_SIZE_PROMPT = `Ти — {{env.PERSONA_NAME}}, жива тепла продавчиня-консультантка {{env.SHOP_TAG}}. Українською, з турботою, доречні емодзі.
ТОВАР: {{context.product.customerName}} — {{context.product.price}} грн. {{context.product.desc}}. Кольори: {{context.product.colors}}.
⚠️ Товар вище вже ОДНОЗНАЧНО підтверджено системою за артикулом/кодом, який назвав клієнт — НІКОЛИ не пиши, що товар/артикул "не знайдено" чи "немає в каталозі", навіть якщо точний код не видно в описі нижче. Завжди довіряй даним про товар вище.
ВАЖЛИВІ НЮАНСИ ЦЬОГО ТОВАРУ (лише для тебе, НІКОЛИ не цитуй клієнту дослівно як список — вплети природно, якщо доречно): {{context.product.aiInfo}}
❌ КЛІЄНТА ВЖЕ ПРИВІТАЛИ секунду тому — НІКОЛИ не пиши "Привіт"/"Вітаю"/"Доброго дня" знову.
🚫 ПРАПОРЕЦЬ ТОВАР_ЩОЙНО_ПОКАЗАНО (виставляє КОД, не вгадуй сам): "{{context.productJustPresented}}". Якщо тут "true" — секунду тому, В ЦЬОМУ Ж ХОДІ, клієнту ВЖЕ показали ПОВНУ картку товару (назва, матеріал, кольори, розміри, ціна). ЦЕ СТОСУЄТЬСЯ І ТОГО ВИПАДКУ, коли клієнт написав лише ГОЛИЙ артикул/код товару (напр. "C0043") — це НЕ "новий запит", товар ЩОЙНО показано, тому в своєму повідомленні НЕ повторюй ЖОДНОГО з цих фактів (ні назву, ні матеріал, ні кольори, ні розміри, ні ціну) — одразу переходь до збору параметрів нижче або дай пряму відповідь на конкретне питання клієнта.
Коли прапорець НЕ "true" (порожньо) — презентації щойно не було, працюй за рештою правил нижче як завжди.
КОРОТКИЙ СТАН ДІАЛОГУ (додатковий контекст для орієнтації — НЕ заміняє прапорці й правила вище/нижче, вони точніші): {{context.dialogStateText}}

ЦІЛЬ кроку: зібрати параметри, потрібні для підбору розміру САМЕ ЦЬОГО товару — вони визначені в картці категорії товару в CRM (динамічно, різні для різних категорій, НЕ хардкод):
ПОТРІБНІ ПАРАМЕТРИ: {{context.product.categoryParamsPrompt}}
🚩 ПРАПОРЕЦЬ ЗРІСТ_І_ВАГА (виставляє КОД, не вгадуй сам): "{{context.product.categoryParamsIsHeightWeight}}"

ЯКЩО прапорець ЗРІСТ_І_ВАГА = "true" (потрібні параметри — саме зріст і вага, звичний одяг):
1. Клієнт може написати як завгодно: «181 71», «зріст 181 вага 71», «мій ріст 181, 71 кг», «71кг 181см», «180/70». САМ визнач де зріст (150–210 см), де вага (40–160 кг).
2. Якщо чогось бракує — тепло попроси саме те, чого нема (напр.: «Підкажіть, будь ласка, ще вагу 🙂»). Пиши живо, не сухо.
3. КОЛИ Є І ЗРІСТ, І ВАГА — поверни РІВНО один JSON у json_output: {"height": <см>, "weight": <кг>} і БІЛЬШЕ НІЧОГО (жодного тексту, НЕ називай і НЕ вгадуй розмір — його порахує система далі). Якщо клієнт сам наполіг на конкретному розмірі — додай "clothingSize".
3b. ЦЕ СТОСУЄТЬСЯ І "НЕЗВИЧНИХ" ЦИФР: навіть якщо зріст/вага здаються тобі екстремальними чи нереальними — ВСЕ ОДНО поверни РІВНО той самий JSON {"height":<см>,"weight":<кг>}, БЕЗ жодного тексту від себе. НІКОЛИ сам не пиши "не підійде за розміром", "виходить за межі сітки" чи не пропонуй менеджера — чи це поза сіткою, вирішує СИСТЕМА (наступний крок), не ти.
3c. Якщо клієнт ОДРАЗУ назвав готовий розмір (S/M/L/XL/XXL) БЕЗ зросту й ваги — НЕ приймай одразу: у різних моделей різна посадка (є маломірні), тому ввічливо все одно попроси зріст і вагу (напр. «У нас деякі моделі маломірять, тому підкажіть, будь ласка, ще зріст і вагу — так точно не помилимось із розміром 🙂»). ЛИШЕ якщо клієнт після цього прохання все одно наполягає і не називає зріст/вагу (повторює розмір або просить "просто дайте [розмір]") — тоді поверни РІВНО {"clothingSize":"<РОЗМІР>"} і більше нічого.
3d. Якщо клієнт замість зросту й ваги сам ДОБРОВІЛЬНО назвав ТОЧНИЙ обхват грудей ("обхват грудей 104", "груди 104 см") — це сильніший сигнал, ніж зріст/вага: додай у json_output поле "chest": <см> (можна разом з height/weight, якщо він і їх назвав). НЕ питай обхват грудей сам — тільки якщо клієнт озвучив його першим. Точні виміри цього товару по розмірах (якщо є): {{context.product.sizeChartData}} — якщо клієнт питає конкретну цифру ("який обхват грудей у L?"), відповідай РІВНО з цих даних, не вигадуй і не округлюй на око. Якщо тут порожньо/null — чесно скажи, що точних цифр по цій моделі поки нема.

ЯКЩО прапорець ЗРІСТ_І_ВАГА = "false" (інші параметри — наприклад розмір ноги, діаметр, довжина тощо):
1. Постав ОДНЕ живе питання, що просить ВСІ параметри з переліку "ПОТРІБНІ ПАРАМЕТРИ" вище одразу (використовуй їхні назви й підказки дослівно, як орієнтир клієнту, а не сухий список).
2. Якщо клієнт відповів не на всі параметри одразу — тепло допитай ті, яких бракує, так само по одному ходу.
3. КОЛИ ВСІ параметри з переліку є — поверни РІВНО один JSON у json_output: {"clothingSize":"<значення параметра(-ів), як назвав клієнт; якщо параметрів кілька — через кому>"} і БІЛЬШЕ НІЧОГО.
4. Не вигадуй параметри, яких нема у переліку "ПОТРІБНІ ПАРАМЕТРИ", і не проси зріст/вагу, якщо їх там нема.

ЯКЩО перелік "ПОТРІБНІ ПАРАМЕТРИ" вище ПОРОЖНІЙ — цей крок не мав запускатись без причини; постав загальне питання "Який розмір вас цікавить?" і прийми відповідь клієнта як є, поверни {"clothingSize":"<як назвав клієнт>"}.

СПІЛЬНІ ПРАВИЛА (незалежно від того, які саме параметри збираєш):
- На питання про матеріал/ціну/доставку/колір — коротко відповідай з даних вище, тоді м'яко повертай до збору параметрів.
- Якщо клієнт просить розмірну сітку/таблицю розмірів ("скиньте сітку", "є розмірна таблиця?") — {{context.product.sizeChartNote}} Якщо сітка Є і ти обіцяєш показати — обов'язково додай у json_output поле "wantsSizeChart":true (можна разом з іншими полями в тому самому json_output). Якщо сітки НЕМА — просто чесно скажи це текстом, wantsSizeChart НЕ додавай.
- Не вигадуй товарів/кольорів/параметрів, яких нема вище.`;

// Побажання координатора (додано під час роботи, ДО фіксації n_size): один спільний
// прапорець "чи вже питали розмір/параметри для ЦІЄЇ категорії товару в цій сесії" —
// замість ad-hoc перевірок у кожному місці. Ставиться в n_calc (єдине місце, куди
// стікаються ВСІ шляхи виходу з n_size — exact-measurement/oor/звичайний), звіряється
// в n_is_clothing (єдина умова, що вирішує "питати чи ні"). Прив'язка саме до
// categoryId (не просто true/false) — щоб повторний захід з ІНШИМ товаром іншої
// категорії (інші requiredParams) знову спитав актуальні параметри, а не мовчки
// пропустив крок через застарілий прапорець від попереднього товару в тій самій сесії.
const CALC_RETURNS = [
    {
        old: "return { recommendedSize: exactSize, sizeOutOfRange: false, sizeMatchedBy: 'exact_measurement', sizeColorFollowup: __sizeColorFollowup };",
        new: "return { recommendedSize: exactSize, sizeOutOfRange: false, sizeMatchedBy: 'exact_measurement', sizeColorFollowup: __sizeColorFollowup, sizeAskedFor: (context.product && context.product.categoryId) || true };",
    },
    {
        old: "return { sizeOutOfRange: true, sizeOorReason: (oorH?('зріст '+h+' см поза сіткою ('+hMin+'-'+hMax+')'):'') + (oorH&&oorW?'; ':'') + (oorW?('вага '+w+' кг поза сіткою ('+wMin+'-'+wMax+')'):''), recommendedSize: size || '' };",
        new: "return { sizeOutOfRange: true, sizeOorReason: (oorH?('зріст '+h+' см поза сіткою ('+hMin+'-'+hMax+')'):'') + (oorH&&oorW?'; ':'') + (oorW?('вага '+w+' кг поза сіткою ('+wMin+'-'+wMax+')'):''), recommendedSize: size || '', sizeAskedFor: (context.product && context.product.categoryId) || true };",
    },
    {
        old: 'return { recommendedSize: size, sizeOutOfRange: false, sizeColorFollowup: __sizeColorFollowup };',
        new: "return { recommendedSize: size, sizeOutOfRange: false, sizeColorFollowup: __sizeColorFollowup, sizeAskedFor: (context.product && context.product.categoryId) || true };",
    },
];
const IS_CLOTHING_OLD = 'context.product && context.product.isClothing';
const IS_CLOTHING_NEW = 'context.product && context.product.isClothing && context.sizeAskedFor !== context.product.categoryId';

async function patchBot(name, cfg) {
    const { botId, crmApiKey } = cfg;
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    const nCrmOrder = flow.nodes.find((n) => n.id === 'n_crm_order');
    const nSupplierRoute = flow.nodes.find((n) => n.id === 'n_supplier_route');
    const nSize = flow.nodes.find((n) => n.id === 'n_size');
    const nCalc = flow.nodes.find((n) => n.id === 'n_calc');
    const nIsClothing = flow.nodes.find((n) => n.id === 'n_is_clothing');
    if (!nLookup || !nCrmOrder || !nSupplierRoute || !nSize || !nCalc || !nIsClothing) { console.log(name, 'ERROR: якась з нод n_lookup/n_crm_order/n_supplier_route/n_size/n_calc/n_is_clothing не знайдена'); return; }

    const lookupDone = (nLookup.data.code || '').includes('keys.CRM_API_KEY');
    const orderDone = (nCrmOrder.data.code || '').includes('buyers/find-or-create');
    const routeDone = (nSupplierRoute.data.code || '').includes('supplierInfo');
    const sizeDone = (nSize.data.systemPrompt || '').includes('categoryParamsPrompt');
    const calcDone = (nCalc.data.code || '').includes('sizeAskedFor');
    const isClothingDone = (nIsClothing.data.condition || '').includes('sizeAskedFor');

    console.log(name, {
        n_lookup: lookupDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
        n_crm_order: orderDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
        n_supplier_route: routeDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
        n_size: sizeDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
        n_calc_sizeAskedFor: calcDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
        n_is_clothing_sizeAskedFor: isClothingDone ? 'ALREADY_APPLIED' : 'WILL_PATCH',
    });
    if (!calcDone) {
        for (const r of CALC_RETURNS) { if (!(nCalc.data.code || '').includes(r.old)) console.log(name, 'WARNING: n_calc — анкор не знайдено:', r.old.slice(0, 60) + '...'); }
    }
    if (!isClothingDone && (nIsClothing.data.condition || '') !== IS_CLOTHING_OLD) {
        console.log(name, 'WARNING: n_is_clothing — умова відрізняється від очікуваного анкора, пропускаю (перевір вручну). Поточна:', nIsClothing.data.condition);
    }

    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_lookup' && !lookupDone) return { ...n, data: { ...n.data, code: LOOKUP_CODE } };
        if (n.id === 'n_crm_order' && !orderDone) return { ...n, data: { ...n.data, code: CRM_ORDER_CODE } };
        if (n.id === 'n_supplier_route' && !routeDone) return { ...n, data: { ...n.data, code: SUPPLIER_ROUTE_CODE } };
        if (n.id === 'n_size' && !sizeDone) return { ...n, data: { ...n.data, systemPrompt: NEW_SIZE_PROMPT } };
        if (n.id === 'n_calc' && !calcDone) {
            let code = n.data.code || '';
            for (const r of CALC_RETURNS) { if (code.includes(r.old)) code = code.split(r.old).join(r.new); }
            return { ...n, data: { ...n.data, code } };
        }
        if (n.id === 'n_is_clothing' && !isClothingDone && (n.data.condition || '') === IS_CLOTHING_OLD) {
            return { ...n, data: { ...n.data, condition: IS_CLOTHING_NEW } };
        }
        return n;
    });
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });

    // funnelKeys: CRM_API_BASE / CRM_API_KEY / CRM_PUBLIC_BASE (per-bot; raw ключ у funnelKey —
    // допустимий виняток §0.2 fineko-funnel-standard, бо ключ використовується в ОДНІЙ воронці).
    const keyRows = [
        { key: 'CRM_API_BASE', value: CRM_API_BASE, label: 'Base URL нової Fineko CRM (internal)' },
        { key: 'CRM_API_KEY', value: crmApiKey, label: 'Bearer tenant.apiKey нової Fineko CRM', isSecret: true },
        { key: 'CRM_PUBLIC_BASE', value: CRM_PUBLIC_BASE, label: 'Публічний origin CRM (для /uploads-фото)' },
    ];
    for (const row of keyRows) {
        await db.funnelKey.upsert({
            where: { botId_key: { botId, key: row.key } },
            update: { value: row.value, label: row.label },
            create: { botId, key: row.key, value: row.value, label: row.label, isSecret: !!row.isSecret },
        });
    }
    console.log(name, 'APPLIED (nodes + funnelKeys CRM_API_BASE/CRM_API_KEY/CRM_PUBLIC_BASE).');
}

async function main() {
    for (const [name, cfg] of Object.entries(BOTS)) await patchBot(name, cfg);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
