'use strict';
/*
 * Аудит воронки goverla_shop [КЛОН → Fineko CRM] (fcdee415) від 2026-09-03/04 — ВСІ фікси в
 * одному ідемпотентному патчі. ДЖЕРЕЛО ІСТИНИ для постійних змін (fineko-funnel-standard §8,
 * корінь 5). Разом із ним у репо: зміни двигуна (testSession.js: colorUnavailable-only не
 * завершує ноду; HARD/SOFT handoff-regex + data.softHandoffOff; тиха пауза product_unknown;
 * {"productMismatch":true}; вужчий return-regex до замовлення) і worker (VOLATILE_CONTEXT_KEYS).
 *
 * Що робить (нумерація = пункти звіту аудиту):
 *  К1 гейт оплати перед постачальником: n_create → n_supplier_pay_gate → (confirmed | 0 грн)
 *     n_supplier_route, інакше n_supplier_hold (алерт) → n_confirm_prep.
 *  К2 квитанція до адреси: n_del_invoice / n_pay_notfound_msg → n_has_address_cond → n_crm_order
 *     або n_collect; n_reconcile не звіряє двічі; n_crm_order без телефону = явна причина.
 *  К3 cod_trust / уже підтверджена оплата: n_np_gate[false] → n_pay_check_cond → минаємо Mono.
 *  К4 нагадування після покупки: n_followup_* видалено (таймер wait ніколи не спрацьовував, а
 *     будь-яке повідомлення покупця тригерило "ще актуально?"); n_order_cond[false] →
 *     n_declined_msg. Нагадування живуть у worker (checkZernioReminders).
 *  К5 фолбеки постачальників (перший результат по артикулу/місту/відділенню/розміру) прибрано —
 *     код із brewdrop-supplier-code.js / easydrop-offline-code.js / easydrop-cart-code.js.
 *  К6 n_calc: розмір клієнта / числова сітка / дефолт "M" → чесна ескалація (n_calc-code.js),
 *     sizeReplyText залежить від джерела розміру.
 *  В7 петля "З поверненням": n_welcome_back → claude dialog + n_welcome_back_cond → n_is_set або
 *     n_welcome_back_clear; n_post_order_cond для клієнта з оформленим замовленням.
 *  В8 тихі кроки: speakFirst на n_order_intent/n_collect; n_upsell_cond/n_upsell_msg злито в
 *     перше повідомлення n_order_intent; n_np_ask видалено (уточнення каже n_collect);
 *     підпис у n_size_photo.
 *  В9 colorUnavailable — двигун. В10 softHandoffOff на n_pay_collect. В11 n_unknown_admin раз
 *     на сесію (n_unknown_once_cond). В12 matchNote/productMismatch (n_lookup-crm-code.js +
 *     промпти). С14 фолбек презентації (n_lookup). С15 текст про авто в n_set_choice прибрано,
 *     опис бота оновлено. С16 порядок ТТН/подяк: n_ttn_cond/n_ttn_client/n_final видалено,
 *     n_confirm_prep рахує confirmLead/ttnLine. С17 чесний n_upsell2_wait без "акційної ціни".
 *     С19 n_pay: рядок про закордон у всіх варіантах; n_pay_collect: country лише з method;
 *     orderRef з SHOP_TAG (n_pay_amount-code.js). С23 n_reconcile: лише платежі після
 *     orderRefAt, слабкий збіг за сумою тільки після слів "оплатив" і при одному кандидаті.
 *     С24 Haiku на n_pay_collect/n_collect/n_recall_confirm/n_upsell2_wait/n_welcome_back.
 *     С25 розкладка: funnelStage-ноди й нові ноди на вільних клітинках; ключі DRY_RUN=1,
 *     мертві порожні ключі видалено. n_avail: товар без кольорів теж перевіряється
 *     (n_avail_kind_cond → n_avail_stock_*).
 *
 * ЗАПУСК:  node patch-goverla-crm-audit-2026-09-04.js            (dry-run, друкує план)
 *          node patch-goverla-crm-audit-2026-09-04.js --apply    (записує у БД)
 *          node patch-goverla-crm-audit-2026-09-04.js --dump <file.json>  (трансформація дампу
 *                                                      get_funnel → stdout JSON, для тестів)
 * Ідемпотентний (маркер: нода n_supplier_pay_gate). Лише fcdee415 (goverla CRM-клон).
 */
const fs = require('fs');
const path = require('path');

// Обидва CRM-клони: графи однакові (різні лише ключі); covercar продає накидки на авто, тому
// текст про "яке авто / весь салон" у n_set_choice для нього лишається (keepCarText).
const BOTS = {
    goverlaCrmClone: { botId: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', keepCarText: false, shop: 'GOVERLA' },
    covercarCrmClone: { botId: 'a2d5ba79-f87b-48f2-8301-56292cdf3972', keepCarText: true, shop: 'covercar' },
};
const BOT_ID = BOTS.goverlaCrmClone.botId;
function optsForBot(botId) { return Object.values(BOTS).find((b) => b.botId === botId) || BOTS.goverlaCrmClone; }
const CLAUDE_SONNET = '2ec53ba5-144e-463b-9758-c217c4a69b0e';
const CLAUDE_HAIKU = '4a8000aa-837f-4a73-bf5c-224949ebaf9a';

function readCode(f) { return fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, ''); }
const CODE = {
    n_lookup: () => readCode('n_lookup-crm-code.js'),
    n_calc: () => readCode('n_calc-code.js'),
    n_pay_amount: () => readCode('n_pay_amount-code.js'),
    n_reconcile: () => readCode('n_reconcile-code.js'),
    n_crm_order: () => readCode('n_crm_order-crm-code.js'),
    n_avail: () => readCode('n_avail-code.js'),
    n_supplier_order: () => readCode('brewdrop-supplier-code.js'),
    n_supplier_order_ed: () => readCode('easydrop-offline-code.js'),
    n_supplier_order_cart: () => readCode('easydrop-cart-code.js'),
    n_catalog_hint: () => readCode('n_catalog_hint-code.js'),
};

const MATCH_NOTE_OLD = '⚠️ Товар вище вже ОДНОЗНАЧНО підтверджено системою за артикулом/кодом, який назвав клієнт — НІКОЛИ не пиши, що товар/артикул "не знайдено" чи "немає в каталозі", навіть якщо точний код не видно в описі нижче. Завжди довіряй даним про товар вище.';
const MATCH_NOTE_NEW = '{{context.product.matchNote}}';

const SET_CHOICE_CAR_OLD = 'Якщо клієнт задав РОЗМИТЕ питання про ціну (просто "скільки коштує?" без деталей) — ПЕРШИМ ділом коротко уточни: яке авто/модель і чи потрібен весь салон чи окремі сидіння, тоді відповідай конкретно. Не вивалюй одразу весь прайс-лист без контексту.';
const SET_CHOICE_CAR_NEW = 'Якщо клієнт задав РОЗМИТЕ питання про ціну (просто "скільки коштує?") — назви ціну всього комплекту і по-товарні ціни позицій з опису вище (коротко, без зайвого), тоді спитай, весь комплект чи окрема позиція.';

const PAY_INTL_LINE = '\n\n🌍 Доставка за кордон? Напишіть, будь ласка, у яку країну — підкажу умови.';

const ORDER_INTENT_PROMPT = `Ти — {{env.PERSONA_NAME}}, тепла консультантка {{env.SHOP_TAG}}. Товар: {{context.product.customerName}} (артикул {{context.product.sku}}) — {{context.product.price}} грн. Це ТОЙ САМИЙ товар, який клієнт назвав/відкрив — він уже визначений системою, не шукай його і не пиши "не знаходжу". Опис (для контексту, не цитуй списком): {{context.product.desc}}
Колір, ЯКЩО узгоджено: «{{context.colorChoice.color}}» (порожньо = у товару нема вибору кольору, просто не згадуй). Розмір, ЯКЩО визначено: «{{context.recommendedSize}}» (порожньо = не згадуй).
{{context.product.matchNote}}
{{context.product.qtyPromoText}}
ВАЖЛИВІ НЮАНСИ ТОВАРУ (лише для тебе, не цитуй списком): {{context.product.aiInfo}}
КОРОТКИЙ СТАН ДІАЛОГУ: {{context.dialogStateText}}
ДОПРОДАЖ (порожньо = нема): «{{context.product.upsell}}». {{context.product.upsellPhotoNote}}

УМОВИ (додай ОДНИМ рядком у підсумок, дослівно): {{env.ORDER_TERMS_LINE}}

ТВОЯ ЗАДАЧА: підвести до оформлення. Коли ти починаєш першою (система просить "почни діалог сам"): ОДНЕ повідомлення — короткий підсумок (товар, колір/розмір якщо є, ціна, рядок УМОВ) і РІВНО ОДНЕ питання, яке ОБОВʼЯЗКОВО містить слово «Оформляємо»:
- ДОПРОДАЖ порожній → «Оформляємо замовлення? 🙂»
- ДОПРОДАЖ є → «Оформляємо? І підкажіть: додати ще {{context.product.upsell}} до цієї ж посилки, чи лише основний товар?» (одне рішення з двома варіантами, НЕ два окремі питання).
Акцію за кількість (якщо рядок вище непорожній і клієнт не називав кількість) згадай ОДИН раз у підсумку, ненав'язливо. Розмір у підсумку лише називай — НЕ пояснюй заново, чому саме такий (це вже сказано попереднім повідомленням).
ЯКЩО клієнт погоджується на допродаж: коли він назвав кількість/кольори («так, біла 1 і чорна 1», «дві футболки») — додай "upsellQty":<число> і "upsellNote":"<як сказав клієнт: кольори/розміри>" (ціну за кількість порахує система за акцією). Коли допродаж має кольори, а клієнт їх не назвав — РІВНО ОДНЕ уточнення одним реченням («Яку футболку додати — білу чи чорну, і скільки?»), БЕЗ JSON; після відповіді — {"ready":"yes","addUpsell":true,"upsellQty":…,"upsellNote":"…"}. Якщо клієнт на уточнення каже «будь-яку/на ваш розсуд/не важливо» — беремо 1 шт, upsellNote:"колір на розсуд менеджера", далі ready:yes.
ЯКЩО клієнт замість відповіді одразу надсилає дані доставки (є телефон / місто / відділення / ПІБ) — це ЗГОДА, НЕ перепитуй «оформляємо?» і НЕ пиши тексту: поверни ТІЛЬКИ json_output {"ready":"yes","prefill":{"fullName":"...","phone":"...","city":"...","branch":"..."}} (лише ті поля, що є). Дані не губляться — наступні кроки їх підхоплять.
Ти НЕ вітаєшся («Привіт», «Доброго дня») — клієнта вже привітали. Розмір/параметри згадуй ЛИШЕ з поля «Розмір» вище; якщо воно порожнє — не пиши розмір узагалі (не бери цифри з повідомлень клієнта). Якщо клієнт надіслав фото (текст "[фото]") — одне речення: для оформлення фото не потрібне, і знову «Оформляємо?».
ДОВІДКА МАГАЗИНУ (відповідай з неї на питання про виробника, склад, примірку, терміни): {{env.SHOP_FAQ}}
Якщо питання є в даних вище або в ДОВІДЦІ — відповідай сам. Якщо відповіді НЕМА (нестандартне питання, індивідуальне пошиття, знижка, претензія) — НЕ handoff: чесно скажи «уточню в менеджера і напишу сюди», додай json_output {"askManager":"<питання клієнта>"} і повертайся до «Оформляємо?». handoff — ЛИШЕ коли клієнт явно просить живу людину.

ФОРМАТ json_output (СУВОРО, лише коли клієнт ВІДПОВІВ на твоє питання):
- Явна згода (так/да/давай/оформляй/+/ок/хочу/беру, «так, з допродажем», «тільки основний») → ТІЛЬКИ json_output {"ready":"yes"} БЕЗ жодного тексту (наступний крок сам покаже підсумок і оплату — не дублюй). Якщо клієнт погодився ДОДАТИ допродаж → {"ready":"yes","addUpsell":true}. Якщо називав кількість → додай "qty":<число>.
- Явна остаточна відмова (ні/не хочу/не буду/скасуйте/не треба) → ТІЛЬКИ json_output {"ready":"no"} БЕЗ тексту (прощання напише наступний крок).
- Вагається («подумаю», «пізніше», «пораджусь», «якщо встигнете відправити») — це НЕ відмова: БЕЗ JSON, тепло наведи ОДИН реальний аргумент оформити сьогодні (черга на відправку, раніше отримаєте, акція діє зараз) і знову спитай «Оформляємо сьогодні?».
- Інше питання (доставка, склад, розмір, оплата) → відповідай ЗВИЧАЙНИМ ТЕКСТОМ з даних вище, потім знову «Оформляємо?». Без JSON.
- Просить фото допродажу → {"wantsUpsellPhoto":true} (можна разом з іншими полями), лише якщо фото є за нотаткою вище.
ЗАБОРОНЕНО писати {"ready":"pending"}, {"ready":"waiting"} чи інші значення ready — їх не існує. Коротке «так/+» у відповідь на «Оформляємо?» = yes.
Про СПОСІБ оплати відповідай РІВНО одним реченням, без списку й цифр: «Оплата гнучка — можна частину зараз і решту при отриманні, або одразу повністю; на наступному кроці зручно оберете 🙂». Деталі дає наступний крок.
Просить живу людину/менеджера явно («покличте менеджера», «ви бот?») → {"handoff":true} (без ready). Міжнародна доставка → відповідай, що підкажеш умови на кроці оплати (там є вибір країни).
НЕ вигадуй розміри/характеристики/колір, яких немає вище. Не згадуй сайтів/кошиків. Кожне повідомлення закінчуй питанням або чітким наступним кроком. Українською, на «ви», тепло і по справі.`;

const COLLECT_PROMPT = `Ти — {{env.PERSONA_NAME}}, консультантка {{env.SHOP_TAG}}. Збери дані доставки Новою Поштою: ПІБ (2 слова достатньо, по-батькові НЕ вимагай), ТЕЛЕФОН, МІСТО, № ВІДДІЛЕННЯ або поштомата.
КОРОТКИЙ СТАН ДІАЛОГУ: {{context.dialogStateText}}
ВЖЕ ВІДОМО (порожнє = ще нема, не вигадуй): ПІБ «{{context.orderData.fullName}}», телефон «{{context.orderData.phone}}», місто «{{context.orderData.city}}», відділення «{{context.orderData.branch}}».
СТАТУС ОПЛАТИ (виставляє код): «{{context.payStatus}}» — "confirmed" = оплату вже отримали; порожньо або not_found = ще не бачимо. Сума: {{context.payAmount}} грн ({{context.payLabel}}).
УТОЧНЕННЯ ВІД НОВОЇ ПОШТИ (порожньо = нема): «{{context.np.askMsg}}»

Посилання на оплату, реквізити (IBAN/ЄДРПОУ/назва), суму і прохання написати дані система ВЖЕ надіслала окремими повідомленнями ДО тебе — ти їх НІКОЛИ не пишеш, не повторюєш і не вигадуєш (ніяких «UA1234…», «12345678», «ПриватБанк», «надішле окремим повідомленням»). Твоя робота — лише прийняти дані доставки.
Одне повідомлення — одне прохання. Якщо чогось бракує — тепло попроси саме це (лише відсутні поля).
Коли відомі ВСІ 4 поля (з повідомлення клієнта або з блоку ВЖЕ ВІДОМО плюс його відповідь) — НЕ перепитуй підтвердження, НЕ пиши видимого тексту, одразу поверни ТІЛЬКИ json_output {"fullName":"...","phone":"...","city":"...","branch":"..."}; якщо клієнт назвав область — додай "region":"...". Відповідь на УТОЧНЕННЯ (область / точна назва / номер) → той самий JSON з оновленими city/region/branch.
Просить реквізити вручну (IBAN/ЄДРПОУ/«як оплатити вручну») → РІВНО {"wantsManualReq":true}, без тексту.
Пише, що оплатив, або описує чек текстом → подякуй, скажи, що звіримо після отримання даних, і попроси відсутні поля (без JSON, поки полів бракує).
Передумав спосіб оплати («краще 1», «хочу повністю», «краще накладений») → РІВНО {"paymentMethodChange":"cod"} або {"paymentMethodChange":"full"}, БЕЗ тексту. НІКОЛИ не вигадуй посилання на оплату, суми чи реквізити — нове посилання надішле система сама.
Інше питання → коротко відповідай текстом з відомих даних, потім знову попроси відсутні поля.
Явно просить живу людину → {"handoff":true}. Не згадуй сайтів. Українською, на «ви», тепло.`;

const WELCOME_BACK_PROMPT = `Ти — {{env.PERSONA_NAME}}, консультантка {{env.SHOP_TAG}}. Клієнт повернувся після паузи. Раніше він цікавився: {{context.product.customerName}} (артикул {{context.product.sku}}) — {{context.product.price}} грн. {{context.product.matchNote}}
КОРОТКИЙ СТАН ДІАЛОГУ: {{context.dialogStateText}}
Відповідай на його повідомлення по суті (коротко, з даних вище) і зʼясуй одне: цей товар ще актуальний чи цікавить щось інше. Якщо з повідомлення це вже зрозуміло — НЕ перепитуй.
json_output (СУВОРО, лише коли зрозуміло):
- товар актуальний / хоче продовжити (так, актуально, хочу замовити, який розмір є, скільки коштує, а є в наявності) → {"stillInterested":true}
- не актуально / інший товар / просто прощається → {"stillInterested":false}; у тексті попроси скинути пост або артикул, якщо цікавить щось інше.
- просить живу людину/менеджера → {"handoff":true}
Не вигадуй товарів, кольорів, цін. Одне питання за раз. Українською, на «ви», тепло.`;

const UPSELL2_PROMPT = `Клієнт щойно оформив замовлення ({{context.product.customerName}}). Ти — {{env.PERSONA_NAME}}, {{env.SHOP_TAG}}. Це ОДНА коротка відповідь на його повідомлення, не діалог.
- Дякує / прощається → щиро подякуй за замовлення й побажай гарного дня.
- Питає про статус, ТТН, терміни → ТТН надішлемо в цей чат після відправки; терміни — за Новою Поштою; не вигадуй дат.
- Хоче додати ще товар → попроси скинути пост/рілс або артикул: менеджер додасть до цієї ж посилки, якщо ще не відправили.
- Пише про оплату/чек → подякуй, команда звірить і напише; НЕ стверджуй «підтверджено», «зарахували» — ти цього не бачиш.
ЗАВЖДИ додай json_output рівно {"done":true}. Виняток: просить живу людину → ТІЛЬКИ {"handoff":true}. Українською, на «ви», одним-двома реченнями. Жодних службових токенів.`;

const PAY_COLLECT_COUNTRY_OLD = 'ЯКЩО клієнт називає КРАЇНУ доставки (не Україна) — це важливо, додай у ТОЙ САМИЙ json_output ще й поле "country":"<назва країни українською>" (разом з method, якщо метод теж зрозумілий; якщо метод ще не називав — просто {"country":"<країна>"} окремо, наступний крок сам розбереться з оплатою для міжнародної доставки).';
const PAY_COLLECT_COUNTRY_NEW = 'ЯКЩО клієнт називає КРАЇНУ доставки за кордон (НЕ Україну — Україна/укр. міста це не "country", поле не додавай) — додай у ТОЙ САМИЙ json_output поле "country":"<назва країни українською>" РАЗОМ з method. Для закордону доступна лише повна передоплата — тому якщо клієнт назвав країну, але не спосіб, поверни {"method":"full","country":"<країна>"} і НЕ перепитуй спосіб. Ніколи не повертай JSON лише з country без method.';

const CONFIRM_TEXT = `{{context.confirmLead}}

{{context.np.summary}}{{context.ttnLine}}
Якщо захочете додати щось до цієї ж посилки — напишіть до відправки, підкажу 😊{{context.product.footwearNote}}`;

const CONFIRM_PREP_CODE = `// n_confirm_prep — рахує вступ n_confirm залежно від статусу оплати і рядок про ТТН
// (аудит 2026-09-04: раніше "посилка вже їде, ТТН" йшло ПЕРЕД "ТТН надішлемо пізніше",
// а "ми вже оформили" — навіть коли оплату не знайдено).
function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
var paid = context.payStatus === 'confirmed' || Number(context.payAmount) === 0;
var lead = paid
  ? pick(['Дякуємо за замовлення — ви супер! 🎉 Ми вже його оформили 💛', 'Дякуємо за замовлення! 🎉 Уже все оформили 💛', 'Ура, замовлення оформлене! 🎉 Дякуємо, що обрали нас 💛'])
  : pick(['Дякуємо! 🎉 Замовлення зафіксували — щойно побачимо оплату, одразу передамо у відправку 💛', 'Дякуємо! 🎉 Дані отримали, замовлення в системі — після підтвердження оплати одразу відправляємо 💛']);
var ttn = String(context.supplierTtn || '');
var ttnLine = ttn.length > 3
  ? '🚚 Посилка вже в дорозі! Номер накладної (ТТН): ' + ttn + ' — відстежити можна на Новій Пошті 📦'
  : 'Номер накладної (ТТН) надішлемо прямо сюди, щойно передамо посилку Новій Пошті 📦';
return { confirmLead: lead, ttnLine: ttnLine };`;

// ── розкладка: сітка 360×200, нові/переміщені ноди на вільних клітинках ──
const GX = 360, GY = 200;
function makePlacer(nodes) {
    const occ = new Map();
    const key = (n) => Math.round(n.position.x / GX) + ':' + Math.round(n.position.y / GY);
    nodes.forEach((n) => occ.set(key(n), (occ.get(key(n)) || 0) + 1));
    return {
        free(id) { const n = nodes.find((x) => x.id === id); if (!n) return; const k = key(n); const c = (occ.get(k) || 0) - 1; if (c <= 0) occ.delete(k); else occ.set(k, c); },
        place(x, y) {
            const cx = Math.round(x / GX), cy = Math.round(y / GY);
            for (let r = 0; r < 12; r++) {
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const k = (cx + dx) + ':' + (cy + dy);
                    if (!occ.has(k) && cx + dx >= 0 && cy + dy >= 0) { occ.set(k, 1); return { x: (cx + dx) * GX, y: (cy + dy) * GY }; }
                }
            }
            return { x, y };
        },
    };
}

// Правка промпту n_color (живий прогін 2026-09-04: після назви кольору модель сама питала
// "Оформлюємо?" і розповідала про оплату — це робота наступного кроку n_order_intent, який
// тепер speakFirst; виходило два питання поспіль і "два голоси").
const COLOR_CONFIRM_OLD = 'Відповідай ОДНИМ коротким дружнім реченням і ЗАВЖДИ закінчуй питанням, яке веде далі (ніколи не закінчуй просто похвалою).\nКоли клієнт назвав колір із наявних — підтверди його і ЗАВЖДИ додай у json_output рівно {"color":"<колір>"}. Жодних службових токенів.';
const COLOR_CONFIRM_NEW = 'Поки колір НЕ обрано — відповідай ОДНИМ коротким дружнім реченням і закінчуй питанням про колір.\nКоли клієнт назвав колір із наявних — підтверди його ОДНИМ реченням БЕЗ жодного питання (НЕ питай "оформляємо?", НЕ розповідай про оплату/адресу — це зробить наступний крок) і ЗАВЖДИ додай у json_output рівно {"color":"<колір>"}. Жодних службових токенів.\nЯКЩО в контексті вище є список кольорів, яких НЕМАЄ, і клієнт замість нового кольору пише "оформляємо"/"беру"/"давайте" — колір ще не обрано: коротко нагадай, що цього кольору нема, назви наявні і спитай, який брати; color у json НЕ повертай.';

// Сесія власника c4e10092 (старий бот, 2026-09-01): n_pay_collect не віддала JSON на "200 грн",
// лишилась активною і ВИГАДАЛА номер картки, "підтвердила оплату" й зібрала адресу. Жорстка
// заборона + однозначне правило виходу.
const PAY_COLLECT_GUARD = '\nЗАБОРОНЕНО: вигадувати реквізити, номери карток, посилання, підтверджувати "оплату отримано/замовлення активовано", збирати ПІБ/адресу — ти цього НЕ робиш і НЕ маєш реквізитів; усе це дає НАСТУПНИЙ крок системи одразу після твого json_output. Будь-яке повідомлення, з якого зрозумілий спосіб ("1", "2", "200", "перший", "часткова", "повна", "наложка", "повністю") → ТІЛЬКИ json_output {"method":"cod"} або {"method":"full"}, без слів. Якщо клієнт пише "чекаю"/"де реквізити" — це означає, що спосіб уже названо: поверни json_output з останнім зрозумілим method.';
function applyPayCollectGuard(node) { if (node && !String(node.data.systemPrompt || '').includes('вигадувати реквізити, номери карток')) node.data.systemPrompt = String(node.data.systemPrompt || '') + PAY_COLLECT_GUARD; }

// ── v2 (другий прохід архітектора після живих прогонів 2026-09-04) ──
// 1) n_color: при названому кольорі — ТІЛЬКИ json, без тексту (підсумок пише n_order_intent speakFirst;
//    інакше "Графітовий — чудовий вибір!" + одразу підсумок = два повідомлення підряд).
const COLOR_CONFIRM_V2 = 'Поки колір НЕ обрано — відповідай ОДНИМ коротким дружнім реченням і закінчуй питанням про колір.\nКоли клієнт назвав колір із наявних — поверни ТІЛЬКИ json_output {"color":"<колір>"} БЕЗ жодного тексту (підтвердження і підсумок напише наступний крок — не дублюй). Жодних службових токенів.\nЯКЩО в контексті вище є список кольорів, яких НЕМАЄ, і клієнт замість нового кольору пише "оформляємо"/"беру"/"давайте" — колір ще не обрано: коротко нагадай, що цього кольору нема, назви наявні і спитай, який брати; color у json НЕ повертай.';
// 2) "подумаю/пізніше" на кроках розміру/кольору — не допитувати "над чим саме?"
const DEFER_RULE = '\nЯКЩО клієнт відкладає («подумаю», «пізніше», «напишу потім», «дякую, поки ні») — НЕ допитуй, над чим саме: одне мʼяке речення без тиску («Добре, без поспіху 🙂 Коли будете готові — напишіть зріст і вагу / колір, і продовжимо») і чекай. Без JSON.';
// 3) артикул у промптах n_size/n_color — модель сумнівалась у товарі, бо в назві нема коду.
const SKU_IN_PROMPT_OLD = 'Товар: {{context.product.customerName}}';
const SKU_IN_PROMPT_NEW = 'Товар: {{context.product.customerName}} (артикул {{context.product.sku}})';
// 4) n_collect без speakFirst: після реквізитів модель "починала першою" і ВИГАДАЛА IBAN/ЄДРПОУ.
//    Прохання написати адресу — детерміновано в текстах n_requisites / n_req_sum / n_trust_confirm_msg /
//    n_np_ask / n_collect_ask; n_collect лише реагує.
const ADDRESS_ASK = '\n\n📦 Дані для відправки (ПІБ, телефон, місто, № відділення або поштомата Нової Пошти) можна написати прямо зараз одним повідомленням 🙂';
// v3 (реальні переписки 2026-09-04): параметри/колір у першому ж повідомленні ("Чорний колір Параметри 182/100",
// "яка ціна кофти Параметри ріст 167 Вага 75", "Потрібен розмір S в графітному") — не перепитувати; "1,78" = 178 см;
// фото своєї речі посеред підбору не скидає товар; адреса "наперед" не губиться; умови в підсумку.
const SIZE_FIRST_MSG_RE = '\\d{2,3}\\s*[\\/,\\s\\-]\\s*\\d{2,3}|зр[іо]ст|ріст|ваг[аи]|\\bсм\\b|\\bкг\\b|розмір\\s*[SMLX]{1,4}\\b|\\b[SMLX]{1,4}\\s*розмір';
const SIZE_PROMPT_V3 = '\nДОДАТКОВО: (а) зріст у метрах («1,78», «1.78 м») = 178 см — переводь сам; (б) якщо клієнт разом із параметрами назвав КОЛІР зі списку кольорів товару («чорний 182/100», «S в графітному») — додай у той самий json_output поле "color":"<колір як у списку>", щоб не перепитувати; (в) якщо клієнт надіслав фото (текст "[фото]") — по фото розмір не визначаю, скажи це одним реченням і попроси зріст і вагу (товар НЕ змінюй); (г) якщо клієнт назвав власні заміри (плечі/рукав/ширина) — подякуй і скажи, що підбір іде за зростом і вагою, попроси їх.';
const ORDER_TERMS_DEFAULT = 'Обмін/повернення 14 днів ✅ Відправка Новою поштою 📦 Відправка до 5 робочих днів 🚚';
// Довідка магазину — з реальних відповідей менеджерів (2026-09-04); власник редагує ключ у налаштуваннях воронки.
const SHOP_FAQ_DEFAULT = {
    GOVERLA: 'Виробник — Україна. Відправка зі складу в Харкові Новою Поштою, до 5 робочих днів. Примірка/самовивіз неможливі — але є обмін/повернення 14 днів. Розмір підбираємо за зростом і вагою; при сумнівах між двома розмірами радимо більший. Оплата: 200 грн передоплата + решта при отриманні, або повна.',
    covercar: 'Накидки від виробника (м. Дніпро), відправка Новою Поштою до 5 робочих днів. Примірка/самовивіз неможливі — є обмін/повернення 14 днів. Накидки універсальні, підходять на будь-які сидіння. Оплата: 200 грн передоплата + решта при отриманні, або повна.',
};
// Заміна "поза даними → handoff" на askManager у n_size/n_color (бот не спиняється, менеджер отримує питання).
const ASK_MANAGER_RULE = '\nДОВІДКА МАГАЗИНУ (відповідай з неї на питання про виробника, склад, примірку, терміни): {{env.SHOP_FAQ}}\nЯКЩО питання поза даними товару і ДОВІДКОЮ (гарантія, індивідуальне пошиття, знижки, нестандартна оплата) — НЕ клич менеджера: чесно скажи «уточню в менеджера і напишу сюди», додай json_output {"askManager":"<питання клієнта>"} і повертайся до питання цього кроку. handoff — ЛИШЕ на явне прохання живої людини, претензію чи скаргу.';
const HANDOFF_UNKNOWN_OLD_COLOR = 'ЯКЩО питання поза твоїми даними (гарантія, доставка за кордон, нестандартна оплата, знижки, претензія) — НЕ вигадуй: поверни json_output {"handoff":true}.';
const HANDOFF_UNKNOWN_OLD_SET = 'ЯКЩО питання СПРАВДІ поза твоїми даними (гарантія на ІНШИЙ товар не з нашого каталогу, доставка за кордон, нестандартна оплата, знижки, претензія, скарга) — поверни json_output {"handoff":true}.';
const PREFILL_CODE = `// n_order_prefill (v3): клієнт надіслав дані доставки ще на кроці "Оформляємо?" — n_order_intent
// поклав їх у orderIntent.prefill. Переносимо в orderData; якщо є всі 4 поля — n_collect пропускається
// (recalledDeliveryReady, той самий шлях, що для повторного клієнта).
var pf = (context.orderIntent && context.orderIntent.prefill) || null;
if (!pf || typeof pf !== 'object') return {};
var od = Object.assign({}, context.orderData || {});
['fullName', 'phone', 'city', 'branch'].forEach(function (k) { if (pf[k] && String(pf[k]).trim()) od[k] = String(pf[k]).trim(); });
var ready = !!(od.fullName && od.phone && od.city && od.branch);
return { orderData: od, recalledDeliveryReady: ready };`;
function applyV3(nodes, edges, notes) {
    const byId = () => Object.fromEntries(nodes.map((n) => [n.id, n]));
    const has = (id) => !!byId()[id];
    const pos = (id) => (byId()[id] || { position: { x: 0, y: 0 } }).position;
    const placer = makePlacer(nodes);
    if (has('n_size')) { const n = byId().n_size; n.data.waitAfterPresentationUnless = SIZE_FIRST_MSG_RE; n.data.keepProductOnImage = true; if (!String(n.data.systemPrompt || '').includes('зріст у метрах')) n.data.systemPrompt = String(n.data.systemPrompt || '') + SIZE_PROMPT_V3; }
    ['n_color', 'n_set_choice'].forEach((id) => { if (has(id)) byId()[id].data.keepProductOnImage = true; });
    if (has('n_welcome_back')) byId().n_welcome_back.data.keepUserMessageOnExit = true;
    // Етапи аналітики: "Замовлення прийняте" (n_fs5) настає РАНІШЕ за "оформлене в постачальника" (n_fs6)
    // у відсотках воронки CRM (постачальник — лише для авто-механізмів) → порядок 5/6, а не 6/5.
    if (has('n_fs5')) byId().n_fs5.data.stageOrder = 5;
    if (has('n_fs6')) byId().n_fs6.data.stageOrder = 6;
    for (const id of ['n_size', 'n_color', 'n_set_choice']) {
        const n = byId()[id]; if (!n) continue; let sp = String(n.data.systemPrompt || '');
        if (sp.includes(HANDOFF_UNKNOWN_OLD_COLOR)) sp = sp.split(HANDOFF_UNKNOWN_OLD_COLOR).join('');
        if (sp.includes(HANDOFF_UNKNOWN_OLD_SET)) sp = sp.split(HANDOFF_UNKNOWN_OLD_SET).join('');
        if (!sp.includes('askManager')) sp += ASK_MANAGER_RULE;
        n.data.systemPrompt = sp;
    }
    if (!has('n_order_prefill')) {
        nodes.push({ id: 'n_order_prefill', type: 'js', position: placer.place(pos('n_order_cond').x - GX, pos('n_order_cond').y + GY), data: { label: '9.6 Адреса, надіслана наперед', code: PREFILL_CODE, description: 'Переносить orderIntent.prefill (дані доставки, надіслані замість "так") у orderData; повний набір → n_collect пропускається.' } });
        notes.push('+ нода n_order_prefill');
        edges.forEach((e) => { if (e.source === 'n_order_cond' && e.target === 'n_pay' && (e.sourceHandle || null) === 'true') e.target = 'n_order_prefill'; });
        edges.push({ id: 'e_n_order_prefill_n_pay', source: 'n_order_prefill', target: 'n_pay' });
    }
    return { nodes, edges };
}
// v4 (живий тест Олексія 2026-09-04, сесія 5a542121): (1) МОДЕЛІ — двигун бере модель з data.model
// ноди або дефолту CLAUDE_MODEL=haiku; connectorId дає лише ключ. Тож усі "Sonnet"-ноди насправді
// працювали на Haiku (звідси вигадані реквізити, зайві уточнення). Ставимо data.model явно.
// (2) рядок "Доставка за кордон?" у меню оплати читався як "бот вирішив, що за кордон" — прибрано;
// країну бот і так розуміє з відповіді. (3) призначення платежу для ручної оплати — готовий рядок
// для копіювання. (4) сигнал "товар не визначено" не шлемо на голе привітання; без тест-рестарту.
// (5) "Оплату поки не бачу" — один раз, повторна звірка мовчки йде далі.
const MODEL_STRONG = 'claude-sonnet-4-6';
const STRONG_NODES = ['n_size', 'n_color', 'n_set_choice', 'n_order_intent', 'n_collect'];
const GREETING_RE = "/^\\s*(добр(ий|ого|е)\\s*(день|вечір|ранок|дня)?|привіт|вітаю|здрастуйте|hi|hello|хай)[\\s!)🙂😊👋.]*$/i";
function applyV4(nodes, edges, notes) {
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    for (const id of STRONG_NODES) { if (byId[id] && byId[id].data.model !== MODEL_STRONG) { byId[id].data.model = MODEL_STRONG; notes.push('model ' + id + '=' + MODEL_STRONG); } }
    if (byId.n_unknown_msg) delete byId.n_unknown_msg.data.model; // фіксована фраза — дефолт (Haiku)
    // Взуття: клієнт часто каже довжину стопи/устілки в см ("стелька 27,5") — окреме поле footLength,
    // n_calc підбирає по sizeChartData (Довжина стопи). Раніше це йшло як clothingSize і летіло до менеджера.
    if (byId.n_size && /поверни json_output \{"footLength"/.test(byId.n_size.data.systemPrompt || '')) {
        byId.n_size.data.systemPrompt = byId.n_size.data.systemPrompt.replace('поверни json_output {"footLength":<число см, крапка як роздільник>} (можна разом із color)', 'поверни ТІЛЬКИ json_output {"footLength":<число см, крапка як роздільник>} без жодного тексту (можна разом із color)');
        notes.push('n_size footLength rule (no-text)');
    }
    if (byId.n_size && !/"footLength"/.test(byId.n_size.data.systemPrompt || '')) {
        byId.n_size.data.systemPrompt = String(byId.n_size.data.systemPrompt || '') + '\nЯКЩО це взуття і клієнт назвав довжину стопи або устілки в сантиметрах («стелька 27,5», «стопа 27 см») — поверни ТІЛЬКИ json_output {"footLength":<число см, крапка як роздільник>} без жодного тексту (можна разом із color); розмір НЕ вгадуй сам — його порахує система за сіткою товару. Якщо назвав розмір взуття цифрою («42») — це clothingSize.';
        notes.push('n_size footLength rule');
    }
    if (byId.n_size && byId.n_size.data.useKb !== false) { byId.n_size.data.useKb = false; notes.push('n_size useKb=false'); }
    if (byId.n_pay) { const strip = (t) => String(t || '').replace(/\n*🌍 Доставка за кордон\?[^\n]*/g, '').replace(/\s+$/, ''); byId.n_pay.data.text = strip(byId.n_pay.data.text); byId.n_pay.data.variants = (byId.n_pay.data.variants || []).map(strip); }
    if (byId.n_req_ref_l) { byId.n_req_ref_l.data.text = '📌 Призначення платежу — скопіюйте як є, так ми одразу знайдемо вашу оплату 👇'; byId.n_req_ref_l.data.variants = []; }
    if (byId.n_req_ref_v) { byId.n_req_ref_v.data.text = 'Оплата за товар {{context.orderRef}}'; byId.n_req_ref_v.data.variants = []; }
    if (byId.n_unknown_once_cond) byId.n_unknown_once_cond.data.condition = '!context.unknownNotifiedAt && !' + GREETING_RE + '.test(String(context.lastUserMessage || \'\'))';
    if (byId.n_unknown_stop) byId.n_unknown_stop.data.testRestartAfter = false;
    edges = edges.map((e) => (e.source === 'n_pay_notfound_once_cond' && (e.sourceHandle || null) === 'false' && e.target === 'n_pay_notfound_msg') ? { ...e, target: 'n_has_address_cond' } : e);
    return { nodes, edges };
}

// v5 (тест Олексія 2026-09-04 19:27, «Яка ціна кофти?» без артикулу → «покажіть товар» + алерт):
// перед n_unknown_msg — js-нода n_catalog_hint: за словом-категорією підбирає з CRM до 4 товарів
// (артикул, назва, ціна); n_unknown_msg їх показує і питає, який саме; алерт менеджеру в такому
// разі не шлемо (клієнт не завис, він обирає).
const UNKNOWN_PROMPT_V5 = `Ти — {{env.PERSONA_NAME}}, продавчиня {{env.SHOP_TAG}}. Товар ще НЕ визначено. Діалог міг початися не з поста, а з привітання, питання чи назви категорії — твоя робота відкрити розмову і підвести до конкретного товару.
Повідомлення клієнта: «{{context.flowRuntime.lastUserMessage}}»
КАТЕГОРІЇ МАГАЗИНУ з CRM (з кількістю товарів; порожньо = недоступно): {{context.catalogCategories}}
ПІДКАЗКА З КАТАЛОГУ (порожньо = нема; це РЕАЛЬНІ товари, знайдені системою за категорією з повідомлення):
{{context.catalogHint}}
ДОВІДКА МАГАЗИНУ: {{env.SHOP_FAQ}}

Це повідомлення №{{context.unknownTurns}} у цій розмові без визначеного товару. Вітайся ЛИШЕ якщо це №1 або клієнт сам щойно привітався; інакше без «Привіт», одразу по суті.
ПРАВИЛА (одне коротке повідомлення, 2-4 речення, закінчується питанням):
1. Якщо ПІДКАЗКА НЕ порожня — привітайся у тон клієнта і перелічи ці товари РІВНО як у підказці (артикул, назва, ціна; нічого не змінюй і не додавай), потім спитай: «Який цікавить? Напишіть артикул або скиньте пост 😊».
2. Інакше якщо це просто привітання чи «хочу щось замовити» — привітайся, назвись одним словом і запропонуй категорії з блоку КАТЕГОРІЇ (лише назви, без кількостей у дужках, якщо їх більше 5 — перші 5), спитай, що цікавить, або хай скине пост/рілс/артикул.
3. Інакше якщо це загальне питання (доставка, оплата, обмін, виробник, примірка) — відповідай ОДНИМ-двома реченнями строго з ДОВІДКИ, потім спитай, який товар цікавить (категорії або пост/артикул).
4. Інакше (клієнт має на увазі конкретний товар, якого ти не знаєш) — тепло скажи, що не впевнена, про який саме товар мова, і попроси скинути пост чи рілс з Instagram або назвати артикул.

СУВОРО ЗАБОРОНЕНО вигадувати товари, ціни, наявність, умови поза підказкою і довідкою. Без JSON, без службових токенів.`;
function applyV5(nodes, edges, notes) {
    const byId = () => Object.fromEntries(nodes.map((n) => [n.id, n]));
    if (!byId().n_unknown_msg) return { nodes, edges };
    if (!byId().n_catalog_hint) {
        const placer = makePlacer(nodes);
        const u = byId().n_unknown_msg;
        const p = placer.place(u.position.x - GX, u.position.y);
        nodes.push({ id: 'n_catalog_hint', type: 'js', position: p, data: { label: '1a. Підказка з каталогу за категорією', code: CODE.n_catalog_hint(), description: 'Товар не визначено, але названо категорію («кофта», «лофери») → до 4 товарів із CRM у context.catalogHint для n_unknown_msg.' } });
        edges = edges.map((e) => (e.target === 'n_unknown_msg' ? { ...e, target: 'n_catalog_hint' } : e));
        edges.push({ id: 'e_n_catalog_hint_n_unknown_msg', source: 'n_catalog_hint', target: 'n_unknown_msg' });
        notes.push('+ нода n_catalog_hint @' + p.x + ',' + p.y);
    } else { byId().n_catalog_hint.data.code = CODE.n_catalog_hint(); }
    byId().n_unknown_msg.data.systemPrompt = UNKNOWN_PROMPT_V5;
    // 2026-09-05 (Олексій не отримував відповіді): single-нода без exitCondition вважається json_output
    // і двигун зберігає її текст як hidden (щоб не показувати сирий JSON) — клієнт не бачив відповіді.
    byId().n_unknown_msg.data.exitCondition = 'none';
    if (byId().n_create && !/createAlertTitle/.test(byId().n_create.data.message || '')) byId().n_create.data.message = String(byId().n_create.data.message || '').replace('<b>НОВЕ ЗАМОВЛЕННЯ #', '<b>{{context.createAlertTitle}} #');
    // Гейт постачальника: n_crm_order при першому створенні (crmOrderId ще нема) залежить від n_crm_order_cond → n_create; при повторному проході (оплата пізніше) — теж n_create з іншим заголовком.
    if (byId().n_supplier_hold) byId().n_supplier_hold.data.message = '⏸ <b>Постачальнику НЕ відправлено — оплата ще не підтверджена</b>\n\n🧾 Замовлення: {{context.orderRef}}\n🗂 CRM: {{context.crmOrderId}}\n💰 Сума: {{context.payAmount}} грн ({{context.payLabel}})\n\n🛍️ Товар: {{context.product.name}}\n📏 Розмір: {{context.recommendedSize}} | 🎨 Колір: {{context.colorChoice.color}}\n\n👤 {{context.orderData.fullName}}, {{context.orderData.phone}}\n📍 {{context.orderData.city}}, НП {{context.orderData.branch}}\n\n➡️ Після надходження оплати оформіть постачальнику вручну.';
    byId().n_unknown_msg.data.description = 'Товар не визначено: якщо є catalogHint — перелічує реальні товари категорії і питає артикул; інакше просить пост/артикул.';
    // Алерт менеджеру лише коли клієнт ЯВНО посилався на товар (пост/артикул/фото), а n_lookup не знайшов;
    // привітання, категорії, загальні питання бот тепер обробляє сам.
    if (byId().n_unknown_once_cond) byId().n_unknown_once_cond.data.condition = '!context.unknownNotifiedAt && !context.catalogHint && context.hasProductSignal === true';
    return { nodes, edges };
}

function applyV2(nodes, edges, notes) {
    const byId = () => Object.fromEntries(nodes.map((n) => [n.id, n]));
    const has = (id) => !!byId()[id];
    const pos = (id) => (byId()[id] || { position: { x: 0, y: 0 } }).position;
    const placer = makePlacer(nodes);
    const addEdge = (s, t, h) => { if (edges.some((e) => e.source === s && e.target === t && (e.sourceHandle || null) === (h || null))) return; const e = { id: 'e_' + s + '_' + t + (h ? '_' + h : ''), source: s, target: t }; if (h) e.sourceHandle = h; edges.push(e); };
    const retarget = (s, oldT, newT, h) => { edges.forEach((e) => { if (e.source === s && e.target === oldT && (h === undefined || (e.sourceHandle || null) === h)) e.target = newT; }); };
    // v3.3: рядок динамічний ({{context.addressAskLine}}, ставить n_pay_amount) — якщо адресу вже дали наперед
    // (prefill/повторний клієнт), просимо не «напишіть дані», а показуємо «дані вже є ✅».
    const ASK_PH = '\n\n{{context.addressAskLine}}';
    const appendAsk = (id) => { const n = byId()[id]; if (!n) return; const app = (t) => { let s = String(t || ''); if (s.includes(ADDRESS_ASK)) s = s.split(ADDRESS_ASK).join(ASK_PH); return s.includes('{{context.addressAskLine}}') ? s : s + ASK_PH; }; n.data.text = app(n.data.text); if (Array.isArray(n.data.variants) && n.data.variants.length) n.data.variants = n.data.variants.map(app); };
    ['n_requisites', 'n_req_sum', 'n_trust_confirm_msg'].forEach(appendAsk);
    if (has('n_collect')) Object.assign(byId().n_collect.data, { speakFirst: false, connectorId: CLAUDE_SONNET, description: 'Реактивний збір адреси (без speakFirst — прохання ставлять message-ноди перед нею). Sonnet: Haiku двічі вигадувала реквізити/посилання. json: 4 поля (+region), wantsManualReq, paymentMethodChange (+regex у двигуні), handoff.' });
    if (!has('n_np_ask')) {
        nodes.push({ id: 'n_np_ask', type: 'message', position: placer.place(pos('n_np_gate').x - GX, pos('n_np_gate').y + GY), data: { label: '12.63 Уточнити адресу (НП)', text: '{{context.np.askMsg}}', variants: [], description: 'Уточнення від перевірки Нової Пошти (неоднозначне місто / не знайдено відділення). Далі n_collect приймає відповідь.' } });
        notes.push('+ нода n_np_ask');
    }
    retarget('n_np_gate', 'n_collect', 'n_np_ask', 'true');
    retarget('n_np_ask', 'n_collect_skip_cond', 'n_collect');
    addEdge('n_np_ask', 'n_collect');
    if (!has('n_collect_ask')) {
        nodes.push({ id: 'n_collect_ask', type: 'message', position: placer.place(pos('n_has_address_cond').x - GX, pos('n_has_address_cond').y + GY), data: { label: '12.97 Попросити адресу (оплата прийшла раніше)', text: '{{context.payConfirmedLine}}Тепер напишіть, будь ласка, дані для відправки Новою Поштою одним повідомленням: ПІБ, телефон, місто, № відділення або поштомата 📦', variants: [], description: 'Квитанція/адреса: оплату звірено раніше за адресу — просимо дані (payConfirmedLine ставить n_reconcile).' } });
        notes.push('+ нода n_collect_ask');
    }
    retarget('n_has_address_cond', 'n_collect', 'n_collect_ask', 'false');
    addEdge('n_collect_ask', 'n_collect');
    for (const id of ['n_size', 'n_color']) {
        const n = byId()[id]; if (!n) continue; let sp = String(n.data.systemPrompt || '');
        if (!/артикул \{\{context\.product\.sku\}\}/.test(sp)) sp = sp.replace(/(Товар|ТОВАР): \{\{context\.product\.customerName\}\}/, '$1: {{context.product.customerName}} (артикул {{context.product.sku}})');
        if (!sp.includes('клієнт відкладає')) sp += DEFER_RULE;
        if (id === 'n_color') { if (sp.includes(COLOR_CONFIRM_OLD)) sp = sp.split(COLOR_CONFIRM_OLD).join(COLOR_CONFIRM_V2); if (sp.includes(COLOR_CONFIRM_NEW)) sp = sp.split(COLOR_CONFIRM_NEW).join(COLOR_CONFIRM_V2); if (!sp.includes('ТІЛЬКИ json_output {"color"')) notes.push('⚠️ n_color: фрагмент підтвердження не знайдено'); }
        n.data.systemPrompt = sp;
    }
    return { nodes, edges };
}

// --refresh: коли структура вже застосована (маркер n_supplier_pay_gate) — оновити лише код нод
// із файлів і промпти/тексти (ітерації після живих прогонів), без змін графа.
function refresh(flow, opts) {
    opts = opts || {};
    const notes = [];
    const nodes = flow.nodes.map((n) => ({ ...n, data: { ...n.data } }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    for (const [id, get] of Object.entries(CODE)) { if (byId[id]) { byId[id].data.code = get(); notes.push('code ' + id); } }
    if (byId.n_order_intent) byId.n_order_intent.data.systemPrompt = ORDER_INTENT_PROMPT;
    if (byId.n_collect) { byId.n_collect.data.systemPrompt = COLLECT_PROMPT; byId.n_collect.data.detectPaymentChange = true; }
    if (byId.n_welcome_back && byId.n_welcome_back.type === 'claude') byId.n_welcome_back.data.systemPrompt = WELCOME_BACK_PROMPT;
    if (byId.n_upsell2_wait) byId.n_upsell2_wait.data.systemPrompt = UPSELL2_PROMPT;
    if (byId.n_size) byId.n_size.data.waitAfterPresentation = true;
    applyPayCollectGuard(byId.n_pay_collect);
    const v2 = applyV2(nodes, flow.edges.map((e) => ({ ...e })), notes);
    const v3raw = applyV3(v2.nodes, v2.edges, notes);
    const v4 = applyV4(v3raw.nodes, v3raw.edges, notes);
    const v3 = applyV5(v4.nodes, v4.edges, notes);
    return { nodes: v3.nodes, edges: v3.edges, notes, keyUpdates: [
        { key: 'ORDER_TERMS_LINE', value: ORDER_TERMS_DEFAULT, label: 'Рядок умов у підсумку перед "Оформляємо?" (n_order_intent)', onlyIfMissing: true },
        { key: 'SHOP_FAQ', value: SHOP_FAQ_DEFAULT[opts.shop] || SHOP_FAQ_DEFAULT.GOVERLA, label: 'Довідка магазину для бота (виробник, склад, примірка, терміни) — редагуй тут', onlyIfMissing: true },
    ] };
}

function transform(flow, keysMap, opts) {
    opts = opts || {};
    const notes = [];
    let nodes = flow.nodes.map((n) => ({ ...n, data: { ...n.data } }));
    let edges = flow.edges.map((e) => ({ ...e }));
    if (nodes.some((n) => n.id === 'n_supplier_pay_gate')) return { alreadyApplied: true };

    const byId = () => Object.fromEntries(nodes.map((n) => [n.id, n]));
    const pos = (id) => (byId()[id] || { position: { x: 0, y: 0 } }).position;
    const removeNode = (id) => { nodes = nodes.filter((n) => n.id !== id); edges = edges.filter((e) => e.source !== id && e.target !== id); notes.push('− нода ' + id); };
    const removeEdge = (s, t, h) => { edges = edges.filter((e) => !(e.source === s && e.target === t && (h === undefined || (e.sourceHandle || null) === h))); };
    const addEdge = (s, t, h) => { const e = { id: 'e_' + s + '_' + t + (h ? '_' + h : ''), source: s, target: t }; if (h) e.sourceHandle = h; edges.push(e); };
    const retarget = (s, oldT, newT, h) => { let hit = 0; edges = edges.map((e) => { if (e.source === s && e.target === oldT && (h === undefined || (e.sourceHandle || null) === h)) { hit++; return { ...e, target: newT }; } return e; }); if (!hit) notes.push('⚠️ ребро не знайдено: ' + s + ' → ' + oldT); };
    const setData = (id, patch) => { const n = byId()[id]; if (!n) { notes.push('⚠️ нода відсутня: ' + id); return; } Object.assign(n.data, patch); };
    const replaceInPrompt = (id, oldS, newS, label) => { const n = byId()[id]; if (!n) return; const sp = String(n.data.systemPrompt || ''); if (!sp.includes(oldS)) { if (label === 'matchNote' && !sp.includes(newS)) { n.data.systemPrompt = sp.replace(/\n/, '\n' + newS + '\n'); notes.push('ℹ️ ' + id + ': matchNote додано рядком (старий фрагмент не знайдено)'); return; } notes.push('⚠️ ' + id + ': не знайдено фрагмент ' + (label || '')); return; } n.data.systemPrompt = sp.split(oldS).join(newS); };

    // ── видалення: ноди прибираємо НАПРИКІНЦІ (щоб retarget бачив старі ребра); placer їх не рахує ──
    const REMOVE = ['n_followup_wait', 'n_followup_guard', 'n_followup_cond', 'n_followup_msg', 'n_followup_skip', 'n_upsell_cond', 'n_upsell_msg', 'n_ttn_cond', 'n_ttn_client', 'n_final'];

    const placer = makePlacer(nodes.filter((n) => !REMOVE.includes(n.id)));
    const addNode = (id, type, data, nearX, nearY) => { const p = placer.place(nearX, nearY); nodes.push({ id, type, position: p, data }); notes.push('+ нода ' + id + ' @' + p.x + ',' + p.y); return p; };

    // ── коди нод із файлів ──
    for (const [id, get] of Object.entries(CODE)) { if (byId()[id]) setData(id, { code: get() }); }
    setData('n_lookup', { label: '1. Товар по ad-id / артикулу / фото (Fineko CRM)' });
    setData('n_crm_order', { label: '12.5 Створити замовлення у Fineko CRM' });

    // ── К1 гейт оплати перед постачальником ──
    retarget('n_create', 'n_supplier_route', 'n_supplier_pay_gate');
    addNode('n_supplier_pay_gate', 'condition', {
        label: '13.3 Оплата підтверджена (або 0 грн)?',
        condition: "context.payStatus === 'confirmed' || Number(context.payAmount) === 0",
        description: 'TRUE → авто-замовлення постачальнику. FALSE (оплату у виписці не знайдено) → постачальнику НЕ шлемо, сигнал менеджеру, клієнту — підтвердження без "вже оформили".',
    }, pos('n_supplier_route').x - GX, pos('n_supplier_route').y);
    addEdge('n_supplier_pay_gate', 'n_supplier_route', 'true');
    addNode('n_supplier_hold', 'notifyTg', {
        label: '13.3b Постачальнику НЕ відправлено — чекаємо оплату',
        targetKey: 'ADMIN_TELEGRAM_ID',
        message: '⏸ <b>Постачальнику НЕ відправлено — оплата ще не підтверджена</b>\n\n🧾 Замовлення: {{context.orderRef}} | CRM: {{context.crmOrderId}} | сума {{context.payAmount}} грн ({{context.payLabel}})\n🛍️ Товар: {{context.product.name}} | 📏 {{context.recommendedSize}} | 🎨 {{context.colorChoice.color}}\n👤 {{context.orderData.fullName}}, {{context.orderData.phone}} — {{context.orderData.city}}, НП {{context.orderData.branch}}\n\n➡️ Після надходження оплати оформіть постачальнику вручну.',
        description: 'Замовлення в CRM створено як неоплачене; постачальнику нічого не пішло (гейт n_supplier_pay_gate).',
    }, pos('n_supplier_route').x - GX, pos('n_supplier_route').y + GY);
    addEdge('n_supplier_pay_gate', 'n_supplier_hold', 'false');

    // ── С16 підтвердження: n_confirm_prep перед n_confirm; ТТН-ноди й n_final прибрано ──
    addNode('n_confirm_prep', 'js', { label: '13.85 Вступ підтвердження + рядок ТТН', code: CONFIRM_PREP_CODE, description: 'confirmLead (оплачено / чекаємо оплату) і ttnLine (ТТН є / надішлемо) для n_confirm.' }, pos('n_confirm').x - GX, pos('n_confirm').y);
    addEdge('n_supplier_hold', 'n_confirm_prep');
    retarget('n_ttn_sync_crm', 'n_ttn_cond', 'n_confirm_prep');
    retarget('n_supplier_manual', 'n_confirm', 'n_confirm_prep');
    addEdge('n_confirm_prep', 'n_confirm');
    setData('n_confirm', { text: CONFIRM_TEXT, variants: [], description: 'Підсумкове підтвердження: вступ залежить від статусу оплати (confirmLead), рядок ТТН — від наявності ТТН (ttnLine). Без обіцянок "акційної ціни".' });
    removeEdge('n_confirm', 'n_upsell2_wait');
    addEdge('n_confirm', 'n_fs5');
    addEdge('n_fs5', 'n_upsell2_wait');
    setData('n_upsell2_wait', { systemPrompt: UPSELL2_PROMPT, connectorId: CLAUDE_HAIKU, label: '15. Після замовлення — одна відповідь', description: 'Одна чесна відповідь після оформлення (статус/ТТН/додати товар/чек). Термінальна: далі клієнт потрапляє в n_post_order_cond.' });

    // ── К2/К3 оплата ↔ адреса ──
    addNode('n_pay_check_cond', 'condition', {
        label: '12.65 Оплату вже підтверджено або 0 грн?',
        condition: "context.payStatus === 'confirmed' || Number(context.payAmount) === 0",
        description: 'TRUE (квитанція вже звірена раніше, або виняток довіри без передоплати) → минаємо виписку Mono. FALSE → звірка як завжди.',
    }, pos('n_mono_fetch').x - GX, pos('n_mono_fetch').y);
    retarget('n_np_gate', 'n_mono_fetch', 'n_pay_check_cond', 'false');
    addEdge('n_pay_check_cond', 'n_mono_fetch', 'false');
    addNode('n_has_address_cond', 'condition', {
        label: '12.96 Адреса вже зібрана?',
        condition: 'context.orderData && context.orderData.phone && context.orderData.fullName && context.orderData.city',
        description: 'TRUE → створюємо замовлення в CRM. FALSE (квитанція прийшла раніше за адресу) → n_collect збирає дані, потім повертаємось сюди через n_np_gate/n_pay_check_cond.',
    }, pos('n_crm_order').x - GX, pos('n_crm_order').y);
    addEdge('n_pay_check_cond', 'n_has_address_cond', 'true');
    retarget('n_del_invoice', 'n_crm_order', 'n_has_address_cond');
    retarget('n_pay_notfound_msg', 'n_crm_order', 'n_has_address_cond');
    addEdge('n_has_address_cond', 'n_crm_order', 'true');
    addEdge('n_has_address_cond', 'n_collect', 'false');
    // n_pay_notfound_admin — раз на сесію
    retarget('n_pay_status_cond', 'n_pay_notfound_admin', 'n_pay_notfound_once_cond', 'false');
    addNode('n_pay_notfound_once_cond', 'condition', { label: '12.955 Сигнал про ненайдену оплату ще не слали?', condition: '!context.payNotFoundNotified', description: 'TRUE → алерт менеджеру (один раз). FALSE → лише повідомлення клієнту.' }, pos('n_pay_notfound_admin').x + GX, pos('n_pay_notfound_admin').y - GY);
    addEdge('n_pay_notfound_once_cond', 'n_pay_notfound_admin', 'true');
    addEdge('n_pay_notfound_once_cond', 'n_pay_notfound_msg', 'false');
    retarget('n_pay_notfound_admin', 'n_pay_notfound_msg', 'n_pay_notfound_mark');
    addNode('n_pay_notfound_mark', 'js', { label: '12.965 Позначити: сигнал надіслано', code: 'return { payNotFoundNotified: true };', description: 'Щоб повторна звірка (після адреси/чека) не дублювала алерт.' }, pos('n_pay_notfound_admin').x + GX, pos('n_pay_notfound_admin').y);
    addEdge('n_pay_notfound_mark', 'n_pay_notfound_msg');
    setData('n_pay_notfound_admin', {
        message: '⚠️ <b>Оплату поки не знайдено у виписці Mono</b>\n\n🧾 Замовлення: {{context.orderRef}} | сума {{context.payAmount}} грн ({{context.payLabel}})\n👤 Клієнт: {{context.senderName}} ({{context.igUsername}})\n🛍️ Товар: {{context.product.name}} / {{context.recommendedSize}} / {{context.colorChoice.color}}\n💬 Останнє: «{{context.lastCustomerMessage}}»\n\n🔍 Якщо клієнт скине чек — звірка повториться сама. Постачальнику без оплати не піде (гейт).',
        description: 'Оплату не знайдено (клієнт дав адресу або чек, у виписці збігу нема) — один раз на сесію.',
    });
    setData('n_pay_notfound_msg', { text: 'Дякую! 🙌 Оплату поки не бачу у виписці — щойно надійде, підтверджу і передам у відправку. Якщо вже оплатили — скиньте, будь ласка, чек або скрін, так швидше 🙂', description: 'Клієнту: оплату ще не бачимо (чесно, без "перевіряємо вручну" як факту).' });
    setData('n_pay_status_cond', { description: 'Оплату знайдено у виписці? TRUE → антидубль, видалення лінка, далі адреса/CRM. FALSE → сигнал (раз) + повідомлення клієнту, далі адреса/CRM без постачальника.' });
    setData('n_trust_confirm_msg', { text: 'Домовились! 🤝 Оформлюємо без передоплати — накладним платежем повністю при отриманні. Дякуємо за довіру 💛' });

    // ── К4 нагадування/відмова ──
    retarget('n_order_cond', 'n_followup_wait', 'n_declined_msg', 'false');
    addNode('n_declined_msg', 'message', { label: '9.5 Відмова — без тиску', text: 'Добре, без тиску 🙂 Якщо передумаєте або зʼявляться питання щодо «{{context.product.customerName}}» — просто напишіть, я поруч 💛', variants: [], description: 'Термінальна. Наступне повідомлення клієнта піде через n_welcome_back (claude) — "ще актуально?". Нагадування — worker checkZernioReminders.' }, pos('n_order_cond').x, pos('n_order_cond').y + GY);
    removeEdge('n_fs5', 'n_followup_wait');

    // ── В8 допродаж у першому повідомленні n_order_intent; speakFirst ──
    retarget('n_avail_cond', 'n_upsell_cond', 'n_order_intent', 'true');
    setData('n_order_intent', { systemPrompt: ORDER_INTENT_PROMPT, speakFirst: true, messagesTemplate: '', label: '9. Підсумок + допродаж + намір замовити', description: 'speakFirst: сама підсумовує і питає "Оформляємо?" (з допродажем як одним рішенням). json: ready yes/no (+addUpsell, qty), wantsUpsellPhoto, handoff.' });
    setData('n_collect', { systemPrompt: COLLECT_PROMPT, speakFirst: true, detectPaymentChange: true, connectorId: CLAUDE_HAIKU, label: '12. Збір адреси (speakFirst, знає статус оплати)', description: 'speakFirst: одразу просить відсутні поля; знає статус оплати та уточнення НП (np.askMsg). json: 4 поля (+region), wantsManualReq, paymentMethodChange, handoff.' });
    retarget('n_np_ask', 'n_collect_skip_cond', 'n_collect');
    setData('n_np_gate', { description: 'Місто/відділення неоднозначні? TRUE → n_collect (speakFirst озвучить np.askMsg і прийме відповідь); FALSE → перевірка оплати.' });
    setData('n_size', { waitAfterPresentation: true });
    replaceInPrompt('n_color', COLOR_CONFIRM_OLD, COLOR_CONFIRM_NEW, 'підтвердження кольору');
    { const n = byId()['n_color']; if (n && !/"size":"<РОЗМІР>"/.test(n.data.systemPrompt || '')) n.data.systemPrompt = String(n.data.systemPrompt || '') + '\nЯКЩО клієнт на цьому кроці ЯВНО називає ІНШИЙ розмір, ніж рекомендований («я ношу L», «дайте M») — не сперечайся: у json_output разом із color додай "size":"<РОЗМІР>" (великими літерами, лише з розмірів товару: {{context.product.sizes}}); якщо кольору ще не назвав — лише {"size":"<РОЗМІР>"} НЕ повертай, спершу спитай колір і поверни обидва разом.'; }
    setData('n_req_iban_v', { text: '{{context.fop.iban}}', description: 'IBAN активного ФОП з CRM (context.fop, ставить n_pay_amount; фолбек — funnelKey FOP_IBAN).' });
    setData('n_req_code_v', { text: '{{context.fop.code}}', description: 'ЄДРПОУ/ІПН активного ФОП з CRM (context.fop).' });
    setData('n_req_name_v', { text: '{{context.fop.name}}', description: 'Назва активного ФОП з CRM (context.fop).' });
    { const n = byId()['n_requisites']; if (n) { const AMT = '💰 До сплати зараз: {{context.payAmount}} грн ({{context.payLabel}}).\n\n'; n.data.text = AMT + String(n.data.text || ''); n.data.variants = (n.data.variants || []).map((v) => (v.includes('До сплати зараз') ? v : AMT + v)); } }
    setData('n_size_photo', { caption: 'Ось розмірна сітка 📏 Якщо потрібно, підкажіть зріст і вагу — підберу точно 🙂' });
    setData('n_size_reply', { text: '{{context.sizeReplyText}}{{context.sizeColorFollowup}}', variants: [], description: 'Текст готує n_calc (sizeReplyText: за сіткою / клієнт назвав сам / точний вимір) + питання про колір, якщо є вибір.' });

    // ── В7 повернення / після замовлення ──
    setData('n_welcome_back', { label: '1.95 Повернення: ще актуально? (claude)', mode: 'dialog', systemPrompt: WELCOME_BACK_PROMPT, exitCondition: 'json_output', outputVar: 'welcomeBack', connectorId: CLAUDE_HAIKU, temperature: 0.3, speakFirst: true, description: 'Клієнт повернувся без нового сигналу товару: відповідає по суті, зʼясовує актуальність. json: stillInterested true/false, handoff.' });
    { const n = byId()['n_welcome_back']; if (n) { n.type = 'claude'; delete n.data.text; delete n.data.variants; } }
    addNode('n_welcome_back_cond', 'condition', { label: '1.96 Товар ще актуальний?', condition: 'context.welcomeBack && context.welcomeBack.stillInterested === true', description: 'TRUE → продовжуємо з того ж товару (n_is_set → розмір/колір/оформлення). FALSE → скидаємо товар, чекаємо пост/артикул.' }, pos('n_welcome_back').x, pos('n_welcome_back').y + GY);
    addEdge('n_welcome_back', 'n_welcome_back_cond');
    addEdge('n_welcome_back_cond', 'n_is_set', 'true');
    addNode('n_welcome_back_clear', 'js', { label: '1.97 Товар не актуальний — скинути', code: "return { product: null, sharedPost: null, entryAd: '', entryAdId: '', colorChoice: null, sizeInput: null, recommendedSize: '', orderIntent: null, welcomeBack: null, adminEngaged: true, handoffKind: 'product_unknown' };", description: 'Скидає товарний скоуп; стан як після n_unknown_stop — наступний пост/артикул підхопиться зі старту.' }, pos('n_welcome_back').x + GX, pos('n_welcome_back').y + GY);
    addEdge('n_welcome_back_cond', 'n_welcome_back_clear', 'false');
    retarget('n_lookup', 'n_returning_check', 'n_post_order_cond');
    addNode('n_post_order_cond', 'condition', { label: '1.85 Пише після оформленого замовлення?', condition: 'context.crmOrderId && !context.hasFreshSignalThisTurn', description: 'TRUE → статус + сигнал менеджеру (не питаємо "ще актуально?" у покупця). FALSE → звичайний шлях.' }, pos('n_lookup').x + GX, pos('n_lookup').y);
    addEdge('n_post_order_cond', 'n_returning_check', 'false');
    addNode('n_post_order_msg', 'message', { label: '1.86 Замовлення в роботі', text: 'Ваше замовлення в роботі 💛 {{context.ttnLine}}\nПередала ваше повідомлення менеджеру — відповість найближчим часом. Якщо хочете щось додати до посилки — скиньте пост або артикул 🙂', variants: [], description: 'Клієнт написав після оформлення (до автоскидання сесії воркером).' }, pos('n_lookup').x + 2 * GX, pos('n_lookup').y);
    addEdge('n_post_order_cond', 'n_post_order_msg', 'true');
    addNode('n_post_order_admin', 'notifyTg', { label: '1.87 Сигнал: клієнт пише після замовлення', targetKey: 'ADMIN_TELEGRAM_ID', message: '💬 <b>Клієнт написав після оформлення</b> — замовлення {{context.orderRef}} (CRM {{context.crmOrderId}})\n\n👤 {{context.senderName}} ({{context.igUsername}})\n💬 «{{context.lastCustomerMessage}}»', description: 'Термінальна після повідомлення: менеджер відповідає в Instagram.' }, pos('n_lookup').x + 3 * GX, pos('n_lookup').y);
    addEdge('n_post_order_msg', 'n_post_order_admin');

    // ── В11 сигнал про невідомий товар — раз на сесію ──
    retarget('n_unknown_notify_gate', 'n_unknown_admin', 'n_unknown_once_cond', 'true');
    addNode('n_unknown_once_cond', 'condition', { label: '1c.6 Сигнал ще не слали?', condition: '!context.unknownNotifiedAt', description: 'TRUE → алерт менеджеру (один на сесію). FALSE → тихо в паузу.' }, pos('n_unknown_admin').x - GX, pos('n_unknown_admin').y);
    addEdge('n_unknown_once_cond', 'n_unknown_admin', 'true');
    addEdge('n_unknown_once_cond', 'n_unknown_stop', 'false');
    retarget('n_unknown_admin', 'n_unknown_stop', 'n_unknown_mark');
    addNode('n_unknown_mark', 'js', { label: '1c.7 Позначити: сигнал надіслано', code: 'return { unknownNotifiedAt: new Date().toISOString() };' }, pos('n_unknown_admin').x - GX, pos('n_unknown_admin').y + GY);
    addEdge('n_unknown_mark', 'n_unknown_stop');

    // ── n_avail: товар без кольорів закінчився ──
    retarget('n_avail_cond', 'n_avail_no', 'n_avail_kind_cond', 'false');
    addNode('n_avail_kind_cond', 'condition', { label: '6.55 Закінчився сам товар (не колір)?', condition: "context.availReason === 'no_stock'", description: 'TRUE → товар без варіантів кольору розпродано: менеджер. FALSE → нема кольору: просимо інший (n_avail_no).' }, pos('n_avail_no').x - GX, pos('n_avail_no').y);
    addEdge('n_avail_kind_cond', 'n_avail_no', 'false');
    addNode('n_avail_stock_msg', 'message', { label: '6.56 Товар закінчився', text: 'Ой, саме цей товар зараз закінчився 😔 Покличу менеджера — він уточнить, коли буде поставка, і напише сюди. Якщо тим часом цікавить щось інше — скиньте пост або артикул 🙂', variants: [] }, pos('n_avail_no').x - 2 * GX, pos('n_avail_no').y);
    addEdge('n_avail_kind_cond', 'n_avail_stock_msg', 'true');
    addNode('n_avail_stock_admin', 'notifyTg', { label: '6.57 Сигнал: товар закінчився', targetKey: 'ADMIN_TELEGRAM_ID', message: '📦 <b>ТОВАР ЗАКІНЧИВСЯ</b> (за залишками offers у CRM) — клієнт чекає\n\n👤 {{context.senderName}} ({{context.igUsername}})\n🛍️ {{context.product.name}} | розмір {{context.recommendedSize}}' }, pos('n_avail_no').x - 2 * GX, pos('n_avail_no').y + GY);
    addEdge('n_avail_stock_msg', 'n_avail_stock_admin');
    addNode('n_avail_stock_stop', 'js', { label: '6.58 Пауза бота', code: "return { adminEngaged: true, handoffReason: 'no_stock' };" }, pos('n_avail_no').x - 2 * GX, pos('n_avail_no').y + 2 * GY);
    addEdge('n_avail_stock_admin', 'n_avail_stock_stop');
    setData('n_avail_cond', { description: 'Товар у наявності? TRUE → підсумок і намір замовити (n_order_intent). FALSE → n_avail_kind_cond (колір / весь товар).' });

    // ── промпти: matchNote, авто в n_set_choice, n_pay_collect ──
    ['n_size', 'n_color', 'n_set_choice'].forEach((id) => replaceInPrompt(id, MATCH_NOTE_OLD, MATCH_NOTE_NEW, 'matchNote'));
    if (!opts.keepCarText) replaceInPrompt('n_set_choice', SET_CHOICE_CAR_OLD, SET_CHOICE_CAR_NEW, 'авто/салон');
    replaceInPrompt('n_pay_collect', PAY_COLLECT_COUNTRY_OLD, PAY_COLLECT_COUNTRY_NEW, 'country');
    applyPayCollectGuard(byId()['n_pay_collect']);
    setData('n_pay_collect', { softHandoffOff: true, connectorId: CLAUDE_HAIKU, description: 'Визначає спосіб оплати (1/2, country лише з method). softHandoffOff: слова "обман/шахраї/не прийшло" не перехоплює двигун — нода веде сценарій винятку довіри (cod_trust).' });
    setData('n_recall_confirm', { connectorId: CLAUDE_HAIKU });
    // covercar-клон: n_intl_unsupported_admin без targetKey (сповіщення йшло б у системний чат — антипатерн A6)
    if (byId()['n_intl_unsupported_admin']) setData('n_intl_unsupported_admin', { targetKey: 'ADMIN_TELEGRAM_ID' });
    { const n = byId()['n_pay']; if (n) { n.data.variants = (n.data.variants || []).map((v) => (v.includes('Доставка за кордон') ? v : v + PAY_INTL_LINE)); } }
    setData('n_create', { message: '🎉 <b>НОВЕ ЗАМОВЛЕННЯ #{{context.crmOrderId}}</b>\n\n🛍️ Товар: {{context.product.name}}\n🔖 Артикул: {{context.orderSku}}\n📏 Розмір: {{context.recommendedSize}} | 🎨 Колір: {{context.colorChoice.color}}\n💳 Оплата: {{context.payLabel}} — статус у виписці: {{context.payStatus}}\n\n👤 Клієнт: {{context.senderName}} — https://instagram.com/{{context.igUsername}}\n📦 Отримувач: {{context.orderData.fullName}}, {{context.orderData.phone}}\n📍 Адреса: {{context.orderData.city}}, НП {{context.orderData.branch}}\n🏭 Постачальник: {{context.supplier}}' });

    // ── розкладка funnelStage-нод (лежали поверх інших) ──
    [['n_fs1', 'n_welcome'], ['n_fs2', 'n_calc'], ['n_fs3', 'n_color'], ['n_fs4', 'n_pay_collect'], ['n_fs5', 'n_confirm'], ['n_fs6', 'n_supplier_notify']].forEach(([fs, near]) => {
        const n = byId()[fs]; if (!n) return; placer.free(fs); const p = placer.place(pos(near).x + GX, pos(near).y); n.position = p; notes.push('↔ ' + fs + ' → ' + p.x + ',' + p.y);
    });
    { const n = byId()['n_ttn_sync_crm']; if (n) { placer.free('n_ttn_sync_crm'); n.position = placer.place(n.position.x, n.position.y); } }

    REMOVE.forEach(removeNode);
    { const v2 = applyV2(nodes, edges, notes); const v3 = applyV3(v2.nodes, v2.edges, notes); const v4 = applyV4(v3.nodes, v3.edges, notes); const v5 = applyV5(v4.nodes, v4.edges, notes); nodes = v5.nodes; edges = v5.edges; }

    // ── ключі ──
    const keyUpdates = [
        { key: 'BREWDROP_DRY_RUN', value: '1', label: 'DRY-RUN замовлень brewdrop (1 = не відправляти; у бій лише з дозволу власника)' },
        { key: 'EASYDROP_DRY_RUN', value: '1', label: 'DRY-RUN easydrop офлайн-форма' },
        { key: 'EASYDROP_CART_DRY_RUN', value: '1', label: 'DRY-RUN easydrop-кошик' },
        { key: 'ORDER_TERMS_LINE', value: ORDER_TERMS_DEFAULT, label: 'Рядок умов у підсумку перед "Оформляємо?" (n_order_intent)', onlyIfMissing: true },
        { key: 'SHOP_FAQ', value: SHOP_FAQ_DEFAULT[opts.shop] || SHOP_FAQ_DEFAULT.GOVERLA, label: 'Довідка магазину для бота (виробник, склад, примірка, терміни) — редагуй тут', onlyIfMissing: true },
    ];
    const keyDeletes = ['DEFAULT_AD_ID', 'EASYDROP_SUPPLIER_ID', 'EASYDROP_SUPPLIER_NAME'].filter((k) => keysMap && k in keysMap && !String(keysMap[k] || '').trim());

    const description = 'Instagram/Zernio-воронка продажів (' + (opts.shop || 'GOVERLA') + '), переведена на нову Fineko CRM (ключі CRM_API_*). Станом на 2026-09-04 ще НЕ підключений до реального трафіку; постачальники у DRY-RUN (BREWDROP_DRY_RUN / EASYDROP_*_DRY_RUN = 1) до явного дозволу власника. Аудит-фікси 2026-09-04 (patch-goverla-crm-audit-2026-09-04.js): гейт оплати перед постачальником, квитанція до адреси, cod_trust без звірки, нагадування після покупки прибрано, петля «З поверненням», тихі кроки (speakFirst), colorUnavailable, розмір поза літерною сіткою, фолбеки постачальників.';

    return { nodes, edges, keyUpdates, keyDeletes, description, notes };
}

async function main() {
    const argv = process.argv.slice(2);
    const dumpIdx = argv.indexOf('--dump');
    if (dumpIdx >= 0) {
        const d = JSON.parse(fs.readFileSync(argv[dumpIdx + 1], 'utf8'));
        const keysMap = Object.fromEntries((d.keys || []).map((k) => [k.key, k.value]));
        const r = transform({ nodes: d.nodes, edges: d.edges }, keysMap, optsForBot(d.bot && d.bot.id));
        process.stdout.write(JSON.stringify(r));
        return;
    }
    const APPLY = argv.includes('--apply');
    const { db } = require('@platform/db');
    for (const [name, cfg] of Object.entries(BOTS)) { console.log('\n=== ' + name + ' ' + cfg.botId + ' ==='); await patchBot(db, cfg, APPLY); }
    if (!APPLY) console.log('\nDRY-RUN — запусти з --apply.');
    process.exit(0);
}

async function patchBot(db, cfg, APPLY) {
    const BOT_ID = cfg.botId;
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: flow not found for', BOT_ID); return; }
    const keyRows = await db.funnelKey.findMany({ where: { botId: BOT_ID }, select: { key: true, value: true } });
    const keysMap = Object.fromEntries(keyRows.map((k) => [k.key, k.value]));
    let r = transform({ nodes: flow.nodes, edges: flow.edges }, keysMap, cfg);
    if (r.alreadyApplied) {
        if (!process.argv.includes('--refresh')) { console.log('ALREADY_APPLIED (для оновлення коду/промптів: --refresh --apply)'); return; }
        r = refresh({ nodes: flow.nodes, edges: flow.edges }, cfg);
        console.log('REFRESH: ' + r.notes.join(', '));
        if (!APPLY) return;
        await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes: r.nodes, edges: r.edges } });
        for (const row of (r.keyUpdates || [])) {
            if (row.onlyIfMissing && keysMap[row.key] !== undefined && String(keysMap[row.key] || '').trim()) continue;
            await db.funnelKey.upsert({ where: { botId_key: { botId: BOT_ID, key: row.key } }, update: { value: row.value, label: row.label }, create: { botId: BOT_ID, key: row.key, value: row.value, label: row.label, isSecret: false } });
            console.log('  key', row.key, '=', row.value.slice(0, 40));
        }
        console.log('REFRESHED');
        return;
    }
    console.log(r.notes.join('\n'));
    console.log('nodes', flow.nodes.length, '→', r.nodes.length, '| edges', flow.edges.length, '→', r.edges.length);
    console.log('keys update:', r.keyUpdates.map((k) => k.key + '=' + k.value).join(', '), '| delete:', r.keyDeletes.join(', ') || '—');
    if (!APPLY) return;
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    fs.writeFileSync(path.join(backupDir, 'flow-' + BOT_ID + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'), JSON.stringify({ nodes: flow.nodes, edges: flow.edges, keys: keyRows }, null, 1));
    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes: r.nodes, edges: r.edges } });
    for (const row of r.keyUpdates) {
        if (row.onlyIfMissing && keysMap[row.key] !== undefined && String(keysMap[row.key] || '').trim()) continue;
        await db.funnelKey.upsert({ where: { botId_key: { botId: BOT_ID, key: row.key } }, update: { value: row.value, label: row.label }, create: { botId: BOT_ID, key: row.key, value: row.value, label: row.label, isSecret: false } });
    }
    for (const k of r.keyDeletes) await db.funnelKey.deleteMany({ where: { botId: BOT_ID, key: k } });
    await db.bot.update({ where: { id: BOT_ID }, data: { description: r.description } }).catch((e) => console.log('bot.description not updated:', e.message));
    console.log('APPLIED (бекап у backups/).');
}

module.exports = { transform, refresh, BOT_ID, BOTS, optsForBot };
if (require.main === module) main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
