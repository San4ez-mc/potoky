'use strict';
/*
 * Патч воронки «covercar_ua — тестовий магазин (Zernio)» (bot cc03657f-9e72-46e5-a16d-88826e70c2ee)
 *   Дублювання фічі "міжнародна доставка + виняток довіри" з goverla_shop
 *   (див. patch-goverla-intl-and-trust.js) — запит користувача 2026-08-27.
 *
 *   Структура нод n_pay/n_pay_collect/n_pay_amount/n_iban_invoice/n_collect у covercar
 *   ІДЕНТИЧНА goverla_shop (covercar — клон goverla), тож нові ноди і ребра — 1:1 та сама
 *   схема. Єдина відмінність від goverla-версії: covercar вже має власну конвенцію
 *   notifyTg-сигналу менеджеру ПЕРЕД кожною паузою (n_unknown_admin, n_size_oor_admin,
 *   n_pay_notfound_admin) — тому тут ДОДАНО notifyTg-ноду n_intl_unsupported_admin перед
 *   паузою (у goverla-версії такої ноди не було; тут — для консистентності з рештою
 *   covercar-воронки).
 *
 *   1) n_pay — текст натякає на міжнародну доставку.
 *   2) n_pay_collect — повний промпт (метод оплати + країна + 3-крокова обробка відмови
 *      від передоплати + виняток довіри cod_trust) — той самий текст, що на goverla.
 *   3) n_intl_route (js) — звіряє country з funnelKey NOVA_POSHTA_INTL_COUNTRIES.
 *   4) n_intl_unsupported_cond → n_intl_unsupported_msg → n_intl_unsupported_admin
 *      (notifyTg, НОВЕ порівняно з goverla) → n_intl_unsupported_stop (adminEngaged +
 *      testRestartAfter).
 *   5) n_pay_amount — обробляє method==='cod_trust' → payAmount:0.
 *   6) n_skip_payment_cond → n_trust_confirm_msg → n_collect (пропуск оплати для cod_trust).
 *
 * ЗАПУСК:  node patch-covercar-intl-and-trust.js            (dry-run)
 *          node patch-covercar-intl-and-trust.js --apply    (записує у БД, створює
 *          funnelKey NOVA_POSHTA_INTL_COUNTRIES якщо нема)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const { computeAutoLayout } = require('@platform/flow-layout');

const BOT_ID = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

const INTL_COUNTRIES = ['Польща', 'Чехія', 'Німеччина', 'Литва', 'Латвія', 'Естонія', 'Нідерланди', 'Австрія', 'Франція', 'Іспанія', 'Італія', 'Велика Британія', 'Румунія', 'Молдова', 'Словаччина', 'Угорщина', 'Фінляндія'];

const N_PAY_TEXT = "Клас, оформлюємо! 🎉 Оберіть спосіб оплати:\n\n1️⃣ Часткова передплата 200 грн, решта — накладним платежем (комісія пошти: 20 грн + 2% від суми).\n2️⃣ Повна передплата — оплата всієї суми зараз.\n\nНапишіть 1 або 2 👇\n\n🌍 Доставка за кордон? Напишіть, будь ласка, у яку країну — підкажу умови.";

const N_PAY_COLLECT_PROMPT = `Клієнту показали 2 способи оплати (1 — часткова передоплата 200 грн, 2 — повна). Визнач вибір.
«1»/«часткова»/«післяплата»/«наложка»/«200» → cod. «2»/«повна»/«передоплата»/«зараз»/«повністю» → full.
Якщо вибір ЗРОЗУМІЛИЙ — поверни ТІЛЬКИ json_output {"method":"cod"} або {"method":"full"} — БЕЗ видимого тексту (клієнту напише наступний крок).
ЯКЩО клієнт називає КРАЇНУ доставки (не Україна) — це важливо, додай у ТОЙ САМИЙ json_output ще й поле "country":"<назва країни українською>" (разом з method, якщо метод теж зрозумілий; якщо метод ще не називав — просто {"country":"<країна>"} окремо, наступний крок сам розбереться з оплатою для міжнародної доставки).
Якщо клієнт замість вибору ставить ІНШЕ питання (доставка, термін, гарантія тощо) — коротко тепло відповідай ЗВИЧАЙНИМ ТЕКСТОМ (без JSON) і в кінці знову спитай «Який спосіб оплати оберете — 1 чи 2?».
Якщо клієнт ЗАПЕРЕЧУЄ проти передоплати (каже «тільки накладений», «не хочу передоплату», «оплата лише при отриманні», погрожує скасувати через це) — це НЕ привід одразу відмовляти чи скасовувати замовлення.
КРОК 1 заперечення: тепло поясни ЗВИЧАЙНИМ ТЕКСТОМ (без JSON): «Ми працюємо з оплатою при отриманні — передоплата 200 грн це лише невелика гарантія доставки з нашого боку, і ми гарантуємо обмін та повернення протягом 14 днів, якщо щось не підійде.» Після цього знову м'яко запитай, чи готовий клієнт оформити з передоплатою 200 грн (спосіб 1), чи все ж хоче повну передоплату (спосіб 2).
КРОК 2 (ЯКЩО клієнт після КРОКУ 1 все одно відмовляється) — НЕ переходь одразу до handoff: тепло і без тиску запитай ЧОМУ саме він проти передоплати (напр.: «Розумію ваше занепокоєння 🙂 Підкажіть, будь ласка, що саме бентежить — може, зможу допомогти?»).
КРОК 3: коли клієнт пояснює причину:
- ЯКЩО причина — недовіра/страх шахрайства («мене вже кидали», «боюсь що обманете», «не довіряю передоплаті», «звідки я знаю що ви не шахраї» тощо) — запропонуй виняток ЗВИЧАЙНИМ ТЕКСТОМ (без JSON): «Розумію занепокоєння, це справедливо 🙏 Ми на ринку більше 10 років і можемо піти назустріч — відправимо БЕЗ передоплати взагалі, накладним платежем повністю. Єдине прохання — обов'язково заберіть посилку на пошті, щоб нам не довелось оплачувати повернення з власної кишені 🙏 Домовились?». ЯКЩО клієнт погоджується (так/домовились/добре/ок) — поверни РІВНО json_output {"method":"cod_trust"}. ЯКЩО клієнт НЕ погоджується або далі заперечує — поверни json_output {"handoff":true}.
- ЯКЩО причина ІНША (не про довіру/шахрайство — напр. просто "дорого", "не хочу і все") — тепло відповідай зрозумінням, але передоплату не скасовуй; якщо клієнт продовжує наполягати — поверни json_output {"handoff":true} (нехай менеджер вирішує).
Якщо клієнт ЯВНО просить живу людину/менеджера — поверни json_output {"handoff":true}.
Інших способів оплати не вигадуй.`;

const N_INTL_ROUTE_CODE = `// Перевірка міжнародної доставки (аудит 2026-08-27, продубльовано з goverla_shop).
// Список країн — funnelKey NOVA_POSHTA_INTL_COUNTRIES, комами; редагується власником
// без зміни коду. Якщо країна НЕ в списку і НЕ Україна — не вигадуємо, чи Нова Пошта
// туди возить, кличемо менеджера.
var country = (context.paymentInfo && context.paymentInfo.country) || '';
country = String(country).trim();
var isUkraine = !country || /україн|ukraine|ukrain/i.test(country);
if (isUkraine) return { intlStatus: 'domestic' };
var list = String(keys.NOVA_POSHTA_INTL_COUNTRIES || '').split(',').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean);
var supported = list.some(function(c){ return c && (country.toLowerCase().indexOf(c) >= 0 || c.indexOf(country.toLowerCase()) >= 0); });
if (!supported) return { intlStatus: 'unsupported', intlCountry: country };
var pi = context.paymentInfo || {};
return { intlStatus: 'supported', intlCountry: country, paymentInfo: Object.assign({}, pi, { method: 'full', country: country }) };`;

const N_PAY_AMOUNT_CODE = `var method=(context.paymentInfo&&context.paymentInfo.method)||'cod'; var qty=Number((context.orderIntent&&context.orderIntent.qty)||1); if(!(qty>=1)) qty=1; var qp=(context.product&&context.product.qtyPrices)||{}; var tierPrice=qp[String(qty)]; var unit=(context.product&&context.product.price)||0; var full=tierPrice!=null?Number(tierPrice):(unit*qty); var ref=String(context.orderRef||'').trim(); if(!ref){ ref=('GOV'+((Number((user&&user.telegramId)||0)).toString(36).slice(-4)+Date.now().toString(36).slice(-4))).toUpperCase(); }
if(method==='cod_trust') return { payAmount:0, payLabel:'без передоплати (виняток за домовленістю, накладений платіж повністю)', orderRef:ref, orderQty:qty };
return { payAmount: method==='cod'?200:full, payLabel: method==='cod'?'передоплата 200 грн, решта при отриманні':'повна оплата', orderRef: ref, orderQty: qty };`;

async function main() {
    [N_INTL_ROUTE_CODE, N_PAY_AMOUNT_CODE].forEach((code) => {
        new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
            'return (async function(){"use strict";\n' + code + '\n})();');
    });

    const key = await db.funnelKey.findUnique({ where: { botId_key: { botId: BOT_ID, key: 'NOVA_POSHTA_INTL_COUNTRIES' } } }).catch(() => null);
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }

    const already = flow.nodes.some((n) => n.id === 'n_intl_route');
    if (already && key) { console.log('ALREADY_APPLIED'); process.exit(0); }

    console.log('Буде створено funnelKey =', !key, '; додано 7 нод гілки оплати =', !already);
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    if (!key) {
        await db.funnelKey.create({
            data: { botId: BOT_ID, key: 'NOVA_POSHTA_INTL_COUNTRIES', value: INTL_COUNTRIES.join(', '), label: 'Країни міжнародної доставки Нової Пошти (ПЕРЕВІР на novaposhtaglobal.ua!)', isSecret: false },
        });
    }

    if (!already) {
        let nodes = flow.nodes.map((n) => ({ ...n }));
        let edges = flow.edges.map((e) => ({ ...e }));

        nodes = nodes.map((n) => n.id === 'n_pay' ? { ...n, data: { ...n.data, text: N_PAY_TEXT } } : n);
        nodes = nodes.map((n) => n.id === 'n_pay_collect' ? { ...n, data: { ...n.data, systemPrompt: N_PAY_COLLECT_PROMPT } } : n);
        nodes = nodes.map((n) => n.id === 'n_pay_amount' ? { ...n, data: { ...n.data, code: N_PAY_AMOUNT_CODE } } : n);

        nodes.push({ id: 'n_intl_route', type: 'js', position: { x: 0, y: 0 }, data: { label: '10.2 Перевірка міжнародної доставки', code: N_INTL_ROUTE_CODE, description: 'Звіряє country з NOVA_POSHTA_INTL_COUNTRIES. Україна/не назвав → domestic. Підтримується → форсує full. Не підтримується → unsupported → хендоф.' } });
        nodes.push({ id: 'n_intl_unsupported_cond', type: 'condition', position: { x: 0, y: 0 }, data: { label: '10.3 Країна не підтримується?', condition: "context.intlStatus === 'unsupported'", description: 'TRUE — кличемо менеджера уточнити альтернативу.' } });
        nodes.push({ id: 'n_intl_unsupported_msg', type: 'message', position: { x: 0, y: 0 }, data: { label: '10.4 Повідомити про непідтримувану країну', text: 'На жаль, за нашими даними Нова Пошта поки не доставляє в {{context.intlCountry}} 🙏 Зараз покличу менеджера — можливо, є альтернативний варіант доставки. Дякую за терпіння!' } });
        nodes.push({ id: 'n_intl_unsupported_admin', type: 'notifyTg', position: { x: 0, y: 0 }, data: { label: '10.45 Сигнал: країна не підтримується', text: '🌍 {{context.intlCountry}} — Нова Пошта не доставляє. Клієнт: {{user.firstName}} {{user.username}}. Товар: {{context.product.name}}. Потрібна ручна перевірка альтернативи доставки.' } });
        nodes.push({ id: 'n_intl_unsupported_stop', type: 'js', position: { x: 0, y: 0 }, data: { label: '10.5 Пауза (менеджер: країна)', code: "return { adminEngaged: true, handoffReason: 'Міжнародна доставка: країна ' + (context.intlCountry||'') + ' не в списку підтримуваних' };", testRestartAfter: true } });
        nodes.push({ id: 'n_skip_payment_cond', type: 'condition', position: { x: 0, y: 0 }, data: { label: '10.6 Оплата не потрібна (виняток довіри)?', condition: 'context.payAmount === 0', description: 'TRUE — cod_trust, пропускаємо посилання на оплату.' } });
        nodes.push({ id: 'n_trust_confirm_msg', type: 'message', position: { x: 0, y: 0 }, data: { label: '10.7 Підтвердження без передоплати', text: 'Домовились! 🤝 Оформлюємо без передоплати, накладним платежем повністю при отриманні. Дякуємо за довіру — тепер лишились дані для відправки 📦' } });

        edges = edges.map((e) => (e.source === 'n_pay_collect' && e.target === 'n_pay_amount') ? { ...e, target: 'n_intl_route' } : e);
        edges.push({ id: 'e_intl_route_cond', source: 'n_intl_route', target: 'n_intl_unsupported_cond' });
        edges.push({ id: 'e_intl_cond_true', source: 'n_intl_unsupported_cond', target: 'n_intl_unsupported_msg', sourceHandle: 'true' });
        edges.push({ id: 'e_intl_msg_admin', source: 'n_intl_unsupported_msg', target: 'n_intl_unsupported_admin' });
        edges.push({ id: 'e_intl_admin_stop', source: 'n_intl_unsupported_admin', target: 'n_intl_unsupported_stop' });
        edges.push({ id: 'e_intl_cond_false', source: 'n_intl_unsupported_cond', target: 'n_pay_amount', sourceHandle: 'false' });

        edges = edges.map((e) => (e.source === 'n_pay_amount' && e.target === 'n_iban_invoice') ? { ...e, target: 'n_skip_payment_cond' } : e);
        edges.push({ id: 'e_skip_pay_true', source: 'n_skip_payment_cond', target: 'n_trust_confirm_msg', sourceHandle: 'true' });
        edges.push({ id: 'e_trust_msg_collect', source: 'n_trust_confirm_msg', target: 'n_collect' });
        edges.push({ id: 'e_skip_pay_false', source: 'n_skip_payment_cond', target: 'n_iban_invoice', sourceHandle: 'false' });

        nodes = computeAutoLayout(nodes, edges);
        await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes, edges } });
    }

    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
