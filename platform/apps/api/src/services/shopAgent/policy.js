'use strict';
/**
 * shopAgent/policy.js — детермінована політика ходу. Одна функція, один прохід по стадіях.
 * Стадія виводиться зі СТАНУ (context), а не зберігається як «поточна нода» — тому будь-яке
 * повідомлення клієнта (навіть не по порядку: «185/79 сірий, наложка») просувається одразу на
 * стільки кроків, скільки даних у ньому є, а вже відоме ніколи не перепитується.
 */
const T = require('./tools');
const { compose } = require('./compose');
const { messageText, messageTextMultiline, nodeData, norm, loadCategories, loadCatalog } = require('./lib');
const { dispatchOrder } = require('./supplierDispatch');
const { hasCategoryWord, categoryWordIsUpsell, categoryWordIsSetComponent, categoryWordIsMain } = require('./signal');
const { resolveColorMention } = require('./cart');

// 2026-09-14 (власник: "я взагалі проти будь-якого хардкоду... все в ноди перенеси"): TRUST_STEP1/2,
// HANDOFF_TEXT та решта клієнтських/менеджерських текстів цього файлу БУЛИ тут як JS-константи —
// перенесено у звичайні message/notifyTg ноди flowDefinition бота (n_agent_*), редаговані у Flows
// UI так само, як n_welcome/n_pay/n_confirm. РІШЕННЯ який вузол показати й коли — лишається тут
// (детерміновану політику ходу свідомо НЕ повертаємо в граф-маршрутизацію — джерело R1-R7).
const STAGES = { presented: ['Презентація товару', 1], params: ['Написав параметри', 2], color: ['Написав параметри та колір', 3], awaiting: ['Очікуємо дані та оплату', 4], accepted: ['Замовлення прийняте', 5], supplier: ['Замовлення оформлене в постачальника', 6] };

function P(ctx) { return ctx.product && ctx.product.sku ? ctx.product : null; }
function addressComplete(od) { return !!(od && od.phone && od.fullName && od.city && od.branch); }
function firstPhotoUrls(p) { const u = Array.isArray(p.imageUrls) ? p.imageUrls.filter((x) => /^https?:/.test(String(x))) : []; if (!u.length && /^https?:/.test(String(p.photoUrl || ''))) u.push(p.photoUrl); return u.slice(0, 10); }
// 2026-09-15 (живий кейс, власник підтвердив загальне питання: "траплятимуться клієнти, які
// писатимуть російською не тільки кольори"): цей словник закриває ДЕТЕРМІНОВАНИЙ шлях
// (matchColor на сирому тексті сегментів комплекту, БЕЗ виклику LLM) — паралельно з правкою
// в understand.js (для шляху через LLM-розуміння). Тут лише корені, де слово РІЗНЕ між мовами
// (черный/чорний), а не просто відмінкове закінчення — де корінь однаковий (синий/синій,
// зеленый/зелений), існуюче стемінг-зіставлення нижче й так спрацьовує без словника.
const RU_UA_COLOR_ROOTS = [
    ['черн', 'чорний'], ['бел', 'білий'], ['сер', 'сірий'], ['красн', 'червоний'],
    ['жёлт', 'жовтий'], ['желт', 'жовтий'], ['розов', 'рожевий'], ['голуб', 'блакитний'],
    ['фиолет', 'фіолетовий'], ['бирюз', 'бірюзовий'], ['хаки', 'хакі'], ['графит', 'графітовий'],
];
function ruToUaColorWord(w) {
    for (const [root, ua] of RU_UA_COLOR_ROOTS) if (w.indexOf(root) === 0) return ua;
    return w;
}
function matchColor(p, want) {
    if (!p || !want) return null; const list = Array.isArray(p.colorsList) && p.colorsList.length ? p.colorsList : String(p.colors || '').split(',').map((s) => s.trim()).filter(Boolean);
    const w = norm(want).toLowerCase(); if (!w) return null;
    const exact = list.find((c) => c.toLowerCase() === w); if (exact) return exact;
    // 2026-09-15 (живий кейс, Вячеслав Радецький: «Чорний та коричневий» — ОБИДВА кольори реально
    // в наявності): стара логіка рахувала стем усієї фрази цілком, знаходила 2 кандидати (обидва
    // слова-кольори збігались десь у фразі) і тому здавалась (cand.length===1 інакше null) — бот
    // казав клієнту «нема», хоча один із названих кольорів точно є. Якщо у фразі є сполучник
    // (та/і/й/чи/або/,/) — пробуємо КОЖНЕ слово-колір окремо, а не всю фразу разом.
    // JS \b не бачить межу слова навколо кирилиці (\w — лише латиниця/цифри), тож ділимо просто
    // за пробілами/комами і відкидаємо самі сполучники як окремі токени.
    const CONJ = { та: 1, і: 1, й: 1, чи: 1, або: 1, и: 1 };
    const parts = w.split(/[\s,/]+/u).filter((t) => t && !CONJ[t]);
    const words = parts.length > 1 ? parts : [w];
    for (const rawOne of words) {
        // 2026-09-15: клієнт міг написати колір російською («черный», «серый») — корінь відрізняється
        // від українського каталогу (чорний, сірий), тож звичайний стемінг нижче (розрахований на
        // українські відмінки) сам по собі це не зловить. ruToUaColorWord підміняє РОСІЙСЬКЕ слово
        // на УКРАЇНСЬКЕ ще ДО стемінгу — далі вся логіка нижче працює як завжди, без дублювання.
        const one = ruToUaColorWord(rawOne);
        // 2026-09-15 (живий кейс, власник: «чорні джинси» не матчилось, «Чорні» окремо теж) —
        // «і» (закінчення множини прикметника: чорний→чорні, синій→сині) не відсікалось, тому
        // стем лишався 5-символьним «чорні» й не збігався підрядком із каталожним «чорний»
        // (5-та літера и/і різна). Додано «і» до відсічуваних закінчень.
        const stem = one.replace(/(ий|а|е|у|ого|им|ому|ої|ою|их|і)$/u, '').slice(0, 5);
        if (!stem) continue;
        let cand = list.filter((c) => c.toLowerCase().includes(stem) || one.includes(c.toLowerCase().slice(0, 5)));
        // 2026-09-15 (живий кейс, власник: «джинси сині» не матчилось): «сині» — узгоджена форма
        // прикметника з «джинси» (множина), не «синій» як у каталозі. Стем-пошук підрядком тому
        // знаходить одразу «Синій», «Світло-синій» і «Темно-синій» (усі містять «сині» підрядком) —
        // неоднозначність, де стара логіка здавалась. Коли серед кандидатів є РІВНО один без дефіса
        // (сам базовий колір, не «Модифікатор-Колір») — це і є те, що клієнт мав на увазі; складені
        // варіанти клієнт завжди називає явно («темно-синій», «світло-синій»).
        if (cand.length > 1) {
            const plain = cand.filter((c) => !c.includes('-'));
            if (plain.length === 1) cand = plain;
        }
        if (cand.length === 1) return cand[0];
    }
    return null;
}
// 2026-09-15 (власник: "додай нумерування... щоб людина могла цифру написати") — відповідь
// на "виберіть колір" номером (цифрою чи словом-числівником), а не лише назвою кольору.
// Порядкова прив'язка до item.colors — того самого масиву, з якого рендериться нумерований
// список у setColorAskList, тож "2" завжди означає другу позицію в ЦЬОМУ конкретному списку.
const NUM_WORDS = { 'один': 1, 'одна': 1, 'одне': 1, 'перший': 1, 'перша': 1, 'два': 2, 'дві': 2, 'другий': 2, 'друга': 2, 'три': 3, 'третій': 3, 'третя': 3, 'чотири': 4, 'четвертий': 4, 'четверта': 4, "п'ять": 5, 'пять': 5, "п'ятий": 5, 'пятий': 5, 'шість': 6, 'шостий': 6, 'сім': 7, 'сьомий': 7, 'вісім': 8, 'восьмий': 8, "дев'ять": 9, 'девять': 9, "дев'ятий": 9, 'девятий': 9, 'десять': 10, 'десятий': 10 };
function matchColorByPosition(item, text) {
    if (!item || !Array.isArray(item.colors) || !item.colors.length) return null;
    const t = norm(text || '').toLowerCase();
    const numHit = t.match(/\d+/);
    let n = numHit ? parseInt(numHit[0], 10) : 0;
    if (!n) { for (const w in NUM_WORDS) { if (new RegExp('(^|\\s)' + w + '(\\s|$|[.,!?])', 'u').test(t)) { n = NUM_WORDS[w]; break; } } }
    return (n >= 1 && n <= item.colors.length) ? item.colors[n - 1] : null;
}
function ttnIn(text) { const m = String(text || '').match(/(?<!\d)\d{14}(?!\d)/); return m ? m[0] : ''; }
// 2026-09-15: hideLinks() переїхав у lib.js і застосовується ЦЕНТРАЛЬНО в tools.js:alert() для
// КОЖНОГО сповіщення — тут його викликати більше не треба (і не можна: подвійне застосування
// зламало б уже приховані посилання). Див. коментар над buildAdminAlert(...) у tools.js.

// ── Склад комплекту: редагування з перерахунком ────────────────────────────────────────────────
// Рішення власника 2026-09-14: бот сам реагує на «без взуття» / «додайте джинси» / «дві футболки»
// перерахунком складу і суми, а не приміткою для менеджера. ctx.setSelection — робочий список
// позицій комплекту (підмножина/надмножина pp.setItems); джерело істини для суми й для CRM/
// постачальника (через ctx.orderExtras, який споживають уже наявні n_pay_amount/n_crm_order/
// brewdrop/easydrop коди нод без жодних змін у них).
function initSetSelection(pp) {
    // fixedColor — нове поле CRM (ProductSetComponent.fixedColor, 2026-09-15): власник фіксує
    // колір позиції САМЕ В МЕЖАХ цього комплекту (напр. джинси завжди сині для цього набору) —
    // тоді бот ніколи не питає й не вгадує, бере готове значення з CRM.
    return (pp.setItems || []).map((it) => ({ article: it.article, id: it.id, name: it.name, price: Number(it.price) || 0, supplier: it.supplier || '', supplierArticle: it.supplierArticle || '', colors: it.colors || [], colorPhotos: it.colorPhotos || {}, sizes: (Array.isArray(it.sizes) && it.sizes.length) ? it.sizes : ((Array.isArray(it.structuredSizes) && it.structuredSizes.length) ? it.structuredSizes : ((it.sizeChartData && Array.isArray(it.sizeChartData.sizes)) ? it.sizeChartData.sizes : [])), qty: 1, color: it.fixedColor || '', size: '' }));
}
function stemsOf(name) {
    return String(name || '').toLowerCase().replace(/[«»().,]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !/^(чоловіч|жіноч|дитяч|артикул|комплект)/.test(w)).map((w) => w.slice(0, 5));
}
// 2026-09-14 (власник: "я взагалі проти будь-якого хардкоду... якщо ти щось захардкодив —
// скоріш за все це баг"): ТУТ раніше був ручний список синонімів категорій (взуття→лофер/
// кросівки/черевики/...) — рівно те, що власник уже ЗАБОРОНЯВ у goverla раніше (Edits
// 4c55a087, "НЕ хардкодимо список матеріалів — переиспользуємо загальний текстовий пошук").
// Замінено на дані з CRM: «взуття» матчиться, бо це буквально НАЗВА КАТЕГОРІЇ товару в CRM
// (categoryNames, з resolveSetParams) — жодного власноруч написаного списку слів.
/** Зіставляє вільний текст («без взуття», «додайте джинси») з позицією комплекту: спершу за
 * артикулом, потім за назвою КАТЕГОРІЇ товару з CRM (дані, не хардкод), і насамкінець — за
 * словами з власної назви товару (stemsOf, як і для звичайного пошуку по каталогу). */
function matchSetItem(text, items, categoryNames) {
    const t = String(text || '').toLowerCase(); if (!t.trim()) return null;
    for (const it of items) if (it.article && t.includes(String(it.article).toLowerCase())) return it;
    if (categoryNames) {
        for (const it of items) {
            const catName = String(categoryNames[it.article] || '').toLowerCase().trim();
            const stem = catName.length > 5 ? catName.slice(0, catName.length - 2) : catName; // рід./множина: "взуття"→"взутт"
            if (stem && stem.length >= 4 && t.includes(stem)) return it;
        }
    }
    let best = null, bestScore = 0;
    for (const it of items) { const score = stemsOf(it.name).filter((s) => t.includes(s)).length; if (score > bestScore) { bestScore = score; best = it; } }
    return best;
}
function setSelectionTotal(sel) { return sel.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0); }
// Форма n_extra_resolve.extraItems (НЕ orderExtras!) — n_pay_amount рахує orderTotal/extrasSum
// САМЕ з context.extraItems (свій резолвер), тому синтетичний orderExtras воно ігнорує й
// перезаписує власним (тоді extrasSum=0 і сума комплекту губиться, «решта −200 грн»).
function setSelectionToExtraItems(sel) { return sel.map((it) => ({ id: it.id, sku: it.article, name: it.name, price: it.price, qtyPrices: {}, color: it.color, size: it.size, qty: it.qty, colorsList: it.colors || [], sizes: it.sizes || [], supplier: it.supplier, supplierArticle: it.supplierArticle, offers: [] })); }
/** Склад точно збігається з офіційно визначеним комплектом (той самий набір артикулів, по 1 шт) — лише тоді працює знижка комплекту. */
function setMatchesOriginal(sel, original) {
    if (!original || sel.length !== original.length) return false;
    if (sel.some((s) => (Number(s.qty) || 1) !== 1)) return false;
    return sel.map((s) => s.article).sort().join('|') === original.map((o) => o.article).sort().join('|');
}
/** Рахує ціну і формує позиції для CRM/постачальника відповідно до поточного складу. Рішення
 * власника 2026-09-14: знижка комплекту — ЛИШЕ коли склад точно той, що визначено в CRM; щойно
 * клієнт щось прибрав/додав/змінив кількість — рахуємо чесно, сумою реальних цін позицій. */
function applySetPricing(ctx, pp) {
    const sel = ctx.setSelection;
    // Розміри позицій із n_calc (setSizeMap) — у структуру замовлення для CRM/постачальника.
    if (ctx.setSizeMap && Array.isArray(sel)) for (const it of sel) if (!it.size && ctx.setSizeMap[it.article]) it.size = ctx.setSizeMap[it.article];
    if (setMatchesOriginal(sel, ctx.agent.setOriginal)) {
        // 2026-09-24 (FunnelTest 37, «решта −200 грн»): у CRM ціна комплекту = 0 (вона лише в тексті картки «Комплект (4 в 1): 5290 ₴»),
        // тож n_pay_amount, що бере ціну з product.price, рахував суму 0. Беремо рекламовану ціну з тексту, інакше суму позицій,
        // і записуємо її в product.price — для оплати, CRM і постачальника.
        let total = Number(pp.price) > 0 ? Number(pp.price) : 0;
        if (!total) {
            for (const v of Object.values(pp)) {
                if (typeof v !== 'string') continue;
                const m = v.match(/Комплект[^:\n]{0,20}:\s*(\d[\d\s]{2,6})\s*(?:₴|грн)/i);
                if (m) { total = Number(m[1].replace(/\s/g, '')); if (total > 0) break; }
            }
        }
        if (!total) total = setSelectionTotal(sel);
        if (ctx.product && !(Number(ctx.product.price) > 0)) ctx.product.price = total;
        ctx.orderExtras = []; ctx.extraItems = []; ctx.orderUnitsTotal = total; ctx.orderUnits = [{ color: '', size: '' }]; ctx.orderUnitsText = ctx.setSizesText || 'весь комплект';
        ctx.agent.setPricing = { total, edited: false };
        return ctx.agent.setPricing;
    }
    // extraItems (не orderExtras!) — n_pay_amount рахує звідси, а вже його результат (orderExtras
    // з offerId) споживають n_crm_order і supplierDispatch. orderExtras тут лише як фолбек, доки
    // T.payAmount ще не викликаний цього ходу (напр. підсумок «Оформляємо?» ще до оплати).
    ctx.extraItems = setSelectionToExtraItems(sel);
    ctx.orderExtras = ctx.extraItems.map((it) => ({ id: it.id, sku: it.sku, name: it.name, price: it.price, color: it.color, size: it.size, qty: it.qty, supplier: it.supplier, supplierArticle: it.supplierArticle, sum: it.price * it.qty, offers: [] }));
    ctx.orderUnitsTotal = 0; ctx.orderUnits = [{ color: '', size: '' }]; ctx.orderUnitsText = '';
    // Склад змінено: ціна комплекту більше не діє — n_pay_amount не має додавати її до суми позицій (інакше подвійний підрахунок).
    if (ctx.product && ctx.product.isSet) ctx.product.price = 0;
    const total = setSelectionTotal(sel);
    ctx.agent.setPricing = { total, edited: true };
    return ctx.agent.setPricing;
}
/** Застосувати правку складу з розуміння ходу. Повертає true, якщо щось реально змінилось. */
async function applySetEdit(A, u, pp) {
    const { ctx } = A; const sel = ctx.setSelection; const original = ctx.agent.setOriginal;
    const catNames = (ctx.agent.setParams && ctx.agent.setParams.categoryNames) || null;
    const notes = []; let changed = false;
    if (u.removeItem) {
        const hit = matchSetItem(u.removeItem, sel, catNames);
        if (hit) { ctx.setSelection = sel.filter((x) => x !== hit); notes.push('прибрала: ' + hit.name); changed = true; }
        else notes.push('не знайшла в комплекті «' + u.removeItem + '» — менеджер уточнить, коли зверне увагу');
    }
    if (u.addItem) {
        const already = matchSetItem(u.addItem, ctx.setSelection, catNames);
        if (!already) {
            const hit = matchSetItem(u.addItem, original, catNames);
            if (hit) { ctx.setSelection = [...ctx.setSelection, { ...hit }]; notes.push('додала: ' + hit.name); changed = true; }
            else {
                // не частина цього комплекту — окремий товар із каталогу (той самий резолвер, що для допродажів)
                ctx.extraProductMention = u.addItem; await T.extraResolve(A);
                const added = (ctx.extraItems || []).filter((e) => !ctx.setSelection.some((s) => s.article === e.sku));
                for (const e of added) ctx.setSelection.push({ article: e.sku, id: e.id, name: e.name, price: e.price, supplier: e.supplier, supplierArticle: e.supplierArticle, colors: e.colorsList || [], sizes: e.sizes || [], qty: e.qty || 1, color: e.color || '', size: e.size || '' });
                if (added.length) { notes.push('додала: ' + added.map((a) => a.name).join(', ')); changed = true; }
                else if (ctx.extraUnresolved) notes.push(ctx.extraUnresolved);
                ctx.extraItems = []; ctx.extraProductMention = ''; ctx.extraUnresolved = '';
            }
        }
    }
    if (u.changeRequest) {
        const hit = matchSetItem(u.changeRequest, ctx.setSelection);
        if (hit) {
            const c = matchColor({ colors: hit.colors.join(',') }, u.colorMatched) || matchColor({ colors: hit.colors.join(',') }, u.color) || matchColor({ colors: hit.colors.join(',') }, u.changeRequest);
            if (c && c !== hit.color) { hit.color = c; notes.push(hit.name + ' — колір ' + c); changed = true; }
            const qtyM = String(u.changeRequest).match(/(\d+)\s*(шт|штук|пар)/i);
            if (qtyM && Number(qtyM[1]) !== hit.qty) { hit.qty = Number(qtyM[1]) || 1; notes.push(hit.name + ' — ' + hit.qty + ' шт'); changed = true; }
        } else notes.push(u.changeRequest);
    }
    ctx.agent.setEditNote = notes.join('; ');
    if (changed) applySetPricing(ctx, pp);
    return changed;
}

/** Нормалізує питання для дедупу ескалацій (щоб той самий буквальний повтор не спамив Telegram). */
function normQ(q) { return String(q || '').trim().toLowerCase().replace(/\s+/g, ' '); }
/** 2026-09-17 (власник: універсальний фолбек для питань "не по скрипту" — "кожне" питання без
 * чесної відповіді з ФАКТІВ/KB веде на ескалацію, без жодного regex/списку тем — те, чи бот
 * реально відповів, каже сама compose() через resolved:false, а не вгадування за текстом).
 * Дедуп лише за буквальним повтором питання в межах сесії — щоб не спамити тим самим двічі.
 * Позначає A._unresolvedThisTurn=true (для лічильника "наполягає" в runPolicy) — НЕЗАЛЕЖНО від
 * дедупу за буквальним текстом: клієнт формулює те саме питання РІЗНИМИ словами щоразу (живий
 * кейс e77af3b9: "Штани звужені?" → "Уточніть покрій" → "Мені треба знати покрій" — 7 разів,
 * жодного буквального повтору), тож лічильник наполегливості не може залежати від дедуп-списку. */
async function escalateUnresolved(A, question) {
    A._unresolvedThisTurn = true;
    const nq = normQ(question); if (!nq) return;
    const seen = A.ctx.agent.escalatedQuestions || [];
    if (seen.includes(nq)) return;
    // Те саме питання іншими словами («не обтягуватимуть?» / «як сидять?» про той самий крій) — менеджеру вже пішов алерт, вдруге не спамимо.
    const stemsQ = (t) => String(t).toLowerCase().split(/[^a-zа-яіїєґ0-9]+/i).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
    const mine = stemsQ(nq);
    if (seen.length && mine.length && seen.some((q) => stemsQ(q).filter((w) => mine.includes(w)).length >= 1)) { A.ctx.agent.escalatedQuestions = seen.concat(nq).slice(-20); return; }
    A.ctx.agent.escalatedQuestions = seen.concat(nq).slice(-20);
    await T.kbAsk(A, question);
    await T.alert(A, 'n_agent_unknown_question_admin', { details: '💬 «' + String(question).slice(0, 200) + '»' });
}

async function answerThenAsk(A, u, askText, o = {}) {
    // askText — ГОТОВИЙ текст для клієнта (не інструкція). Без питань клієнта він іде як є;
    // з питаннями → факти (KB, наявність) → одна відповідь + той самий крок своїми словами.
    if (u.intent === 'greeting' && !o.ack) o = { ...o, ack: 'коротко привітайся у відповідь (тим самим часом доби, якщо клієнт його назвав)' };
    if (!u.questions.length && !o.ack) return askText;
    A._questionEngaged = true;
    let kb = []; let availAnswer = '';
    try { kb = await T.kbContext(A); } catch (e) { /* best-effort */ }
    if (/наявн|є в наявн|залишил|є ще|маєте ще|чи є/i.test(String(A.turnText || ''))) { A.ctx.lastCustomerMessage = A.turnText; await T.availSearch(A); availAnswer = A.ctx.availAnswer || ''; }
    // Живий кейс 2026-09-14 (Василенко): картка щойно сама попросила зріст/вагу; askText тут
    // порожній навмисно (нічого повторно просити не треба), АЛЕ без явної заборони LLM (compose)
    // сама, за власною ініціативою, дописувала «підкажіть зріст і вагу» вдруге в кінці відповіді
    // на питання клієнта — типова для продажного тону звичка закінчувати заклик до дії. Заборона —
    // явним nextStep, а не сподівання, що модель здогадається з відсутності інструкції.
    // Клієнт вдруге наполягає на питанні, про яке менеджеру вже пішов алерт — не тиснемо «дайте зріст/вагу», лише підтверджуємо, що менеджер відповість.
    const _stq = (t) => String(t).toLowerCase().split(/[^a-zа-яіїєґ0-9]+/i).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
    const _prevEsc = (A.ctx.agent.escalatedQuestions || []);
    const repeatOfEscalated = u.questions.length && _prevEsc.length && u.questions.some((q) => { const m = _stq(q); return m.length && _prevEsc.some((e) => _stq(e).some((w) => m.includes(w))); });
    if (repeatOfEscalated || A.ctx.funnelPaused) askText = ''; // після передачі менеджеру («Зараз покличу менеджера») не тиснемо «Оформляємо?»/«дайте дані»
    const nextStep = askText ? 'скажи/спитай (можна своїми словами, зміст той самий): «' + askText + '»' : 'НІЧОГО більше не питай і не пропонуй наступний крок — просто дай коротку відповідь на питання клієнта, без заклику до дії в кінці.';
    const { text, resolved } = await compose(A, { questions: u.questions, ack: o.ack, nextStep, kb, availAnswer, fallback: askText });
    if (!resolved && u.questions.length) await escalateUnresolved(A, u.questions[0]);
    return text || askText;
}
function colorsOf(p) { return String((p && p.colors) || '').trim(); }
/** Клієнт зволікає/відкладає («поки не треба», «просто дивлюсь», «подумаю») — не наполягати на
 * тому самому питанні ще раз, дати мʼяко відступити (живий кейс 2026-09-14, Володимир: бот
 * тричі поспіль повторив «дайте зріст і вагу» після явного «поки не потрібно»). */
function isSoftDecline(u) { return u.intent === 'hesitate' || u.intent === 'postpone'; }
/** Людський (не технічний) список позицій комплекту — без дублювання «Артикул: X» і без «;». */
function humanSetList(pp) { return (pp.setItems || []).map((it) => '• ' + it.name + (it.price ? (' — ' + it.price + ' грн') : '')).join('\n'); }
/** Обʼєднані параметри підбору розміру для КОМПЛЕКТУ — union CRM Category.requiredParams усіх
 * категорій КОМПОНЕНТІВ, з дедублікацією за назвою (не параметри самого комплекту — set-товар у
 * CRM зазвичай без власної категорії, categoryId=null). Живий кейс 2026-09-14 (власник, скрін
 * налаштувань категорії): бот мав зайти в категорію КОЖНОГО товару в розмові й запитати РАЗОМ усі
 * потрібні параметри — а не хардкодити «зріст і вагу» незалежно від складу (set1112 містить
 * лофери з категорії «Взуття», якій потрібен окремий параметр «Розмір взуття», не зріст/вага). */
async function resolveSetParams(A, pp) {
    if (!Array.isArray(pp.setItems) || !pp.setItems.length) return { params: [], prompt: '', isOnlyHW: false, categoryNames: {} };
    let categories = []; try { categories = await loadCategories(A.botId, A.keys); } catch (e) { categories = []; }
    const byId = new Map(categories.map((c) => [c.id, c]));
    const seen = new Map(); const categoryNames = {};
    for (const it of pp.setItems) {
        const cat = it.categoryId && byId.get(it.categoryId);
        if (cat && it.article) categoryNames[it.article] = cat.name || '';
        for (const p of ((cat && Array.isArray(cat.requiredParams)) ? cat.requiredParams : [])) {
            const key = String(p.name || '').toLowerCase().trim(); if (key && !seen.has(key)) seen.set(key, p);
        }
    }
    const params = [...seen.values()];
    const isOnlyHW = params.length > 0 && params.every((p) => /зріст|ріст|height|вага|weight/i.test(p.name || ''));
    const prompt = params.map((p) => p.name + (p.unit ? ' (' + p.unit + ')' : '')).join(', ');
    return { params, prompt, isOnlyHW, categoryNames };
}

async function pause(A, reason, alertNode, extraDetails) {
    A.ctx.funnelPaused = true; A.ctx.pausedBy = reason; A.ctx.pausedAt = new Date().toISOString(); A.ctx.adminEngaged = true; A.ctx.handoffKind = reason;
    if (alertNode) await T.alert(A, alertNode, { details: extraDetails });
}

/** Презентація товару: альбом фото + картка (n_welcome) у тому ж ході. */
async function present(A) {
    const { ctx } = A; const p = P(ctx);
    const urls = firstPhotoUrls(p);
    if (urls.length) A.out.push({ photoUrls: urls, caption: '', step: 'present_photo' });
    const greet = A.botSpokeBefore ? '' : ('Вітаю! 💛 Я ' + (A.keys.PERSONA_NAME || 'Оля') + ' з ' + (A.keys.SHOP_TAG || 'магазину') + '.\n');
    const card = messageTextMultiline(A.assets, 'n_welcome', ctx, A.session.id + ':present');
    A.out.push({ text: greet + card, step: 'present' });
    ctx.productJustPresented = true; ctx.presentedAt = Date.now(); ctx.lastPresentedSku = p.sku; ctx.agent.presentedSku = p.sku;
    ctx.agent.lastAsk = p.followUpQuestion || '';
    A.justPresented = true; // картка (n_welcome) сама закінчується проханням дати параметри/колір —
    // цього ж ходу питати вдруге не треба (живий кейс 2026-09-14, Устим/Юлія: два майже
    // однакових повідомлення поспіль, «дайте зріст і вагу» одразу після картки, де це прохання
    // вже є останнім рядком)
    await T.funnelStage(A, ...STAGES.presented);
}

function resetForNewProduct(A, sku) {
    const { ctx } = A;
    if (ctx.agent.presentedSku && ctx.agent.presentedSku !== sku) {
        for (const k of ['sizeInput', 'recommendedSize', 'sizeSource', 'sizeReplyText', 'sizeColorFollowup', 'sizeOutOfRange', 'sizeOorReason', 'sizeOorAlternative', 'isSetSizeCalc', 'setSizesText', 'colorChoice', 'available', 'availReason', 'orderUnits', 'orderUnitsText', 'orderUnitsTotal', 'orderQty', 'orderIntent', 'setMode', 'setPick', 'setSelection', 'availChecked', 'extraItems', 'extraItemsText', 'extraUnresolved', 'orderExtras']) delete ctx[k];
        for (const k of ['setOriginal', 'setPricing', 'setStageSent', 'setEditNote', 'setParams', 'upsellOffered', 'upsellPhotoSent', 'availKey']) delete ctx.agent[k];
        if (!ctx.crmOrderId) for (const k of ['paymentInfo', 'payAmount', 'payLabel', 'orderRef', 'orderRefAt', 'ibanPayUrl', 'ibanInvoiceUid', 'requisitesSentAt']) delete ctx[k];
    }
}

async function sendRequisites(A, u) {
    const { ctx } = A;
    if (Number(ctx.payAmount) === 0) { A.out.push({ text: messageTextMultiline(A.assets, 'n_trust_confirm_msg', ctx, A.session.id), step: 'trust_confirm' }); ctx.requisitesSentAt = Date.now(); return; }
    if (ctx.agent.paidBeforeInvoice && !ctx.requisitesSentAt) {
        // 2026-09-25 (FunnelTest 18): клієнт уже сплатив 200 грн ДО вибору способу — нове посилання не видаємо, дякуємо й збираємо дані.
        A.out.push({ text: 'Дякую! Бачу, що ви вже переказали 200 грн — щойно платіж надійде, звірю 🙏 Щоб оформити відправку, напишіть, будь ласка: ПІБ, телефон, місто та № відділення або поштомата 📦', step: 'paid_before_invoice' });
        ctx.requisitesSentAt = Date.now(); ctx.agent.lastAsk = 'дані для відправки Новою Поштою: ПІБ, телефон, місто, № відділення';
        await T.alert(A, 'n_agent_early_payment_admin', { details: '💬 Клієнт написав, що оплатив 200 грн до видачі реквізитів: «' + String(A.turnText || '').slice(0, 200) + '»', photoUrl: A.turnImage || '' });
        return;
    }
    await T.createInvoice(A);
    if (ctx.ibanPayUrl) A.out.push({ text: messageTextMultiline(A.assets, 'n_requisites', ctx, A.session.id + ':req'), step: 'requisites' });
    else { A.out.push({ text: messageTextMultiline(A.assets, 'n_req_fallback_msg', ctx, A.session.id), step: 'requisites_fallback' }); await sendManualRequisites(A, false); }
    ctx.requisitesSentAt = Date.now();
    ctx.agent.lastAsk = 'дані для відправки Новою Поштою: ПІБ, телефон, місто, № відділення';
}
async function sendManualRequisites(A, withIntro = true) {
    const { ctx } = A;
    if (!ctx.fop) await T.payAmount(A);
    if (withIntro) A.out.push({ text: messageText(A.assets, 'n_req_manual', ctx, A.session.id), step: 'req_manual' });
    // noMerge:true — навмисно окремі повідомлення (кожне значення копіюється дотиком без зайвого
    // тексту навколо); загальний mergeConsecutiveTextOutputs (index.js) інакше склеїв би їх усі в
    // одну стіну тексту, роблячи копіювання незручним — саме це і сталось (живий кейс 15.09).
    for (const id of ['n_req_iban_l', 'n_req_iban_v', 'n_req_code_l', 'n_req_code_v', 'n_req_name_l', 'n_req_name_v', 'n_req_ref_l', 'n_req_ref_v', 'n_req_sum']) { const t = messageTextMultiline(A.assets, id, ctx, A.session.id); if (t) A.out.push({ text: t, step: id, noMerge: true }); }
}
// 2026-09-17 (власник: "спочатку посилання IBAN, потім реквізити ФОП, і тільки якщо людина і тут
// відмовляється — тоді карта. Тобто 3 варіант, а не 2"): картка — ОСТАННІЙ, третій рівень ескалації
// оплати, не альтернатива, яку показуємо одразу з посиланням. Раніше {{context.cardLine}} сидів
// прямо в дефолтному n_requisites (перший-таки крок) і йшов КОЖНОМУ клієнту з заповненою карткою
// ФОП у CRM — звідси повторювані скарги (Oleksii, живий кейс bf149a35: "картку не треба писати").
async function sendCard(A) {
    const { ctx } = A;
    if (!ctx.fop) await T.payAmount(A);
    if (ctx.fop && ctx.fop.cardNumber) A.out.push({ text: messageText(A.assets, 'n_req_card', ctx, A.session.id), step: 'req_card' });
    else await sendManualRequisites(A, true); // немає картки в CRM — чесний фолбек на реквізити, а не вигадана картка
}

async function afterOrderAccepted(A) {
    // Створення замовлення в CRM → постачальник (якщо оплата є) → підтвердження клієнту.
    const { ctx } = A;
    if (!ctx.crmOrderId) {
        await T.crmOrder(A);
        if (!ctx.crmOrderId || ctx.crmOrderError) {
            await pause(A, 'crm_order_failed', 'n_crm_order_failed_admin');
            A.out.push({ text: 'Дякую! Усі дані отримала 🙏 Менеджер зараз завершить оформлення і напише вам сюди 💛', step: 'crm_failed' });
            return 'paused';
        }
        await T.alert(A, 'n_create');
        await T.funnelStage(A, ...(ctx.payStatus === 'confirmed' || Number(ctx.payAmount) === 0 ? STAGES.accepted : STAGES.awaiting));
    } else if (ctx.repeatPass || ctx.payStatus === 'confirmed') {
        await T.crmOrder(A); // повторний прохід: оплата в журнал + стадія
        if (ctx.receiptNew) await T.alert(A, 'n_receipt_alert', { photoUrl: ctx.lastReceiptImageUrl || '' });
    }
    if ((ctx.payStatus === 'confirmed' || Number(ctx.payAmount) === 0) && !ctx.supplierHandled) {
        // Цикл по постачальниках (рішення власника 2026-09-14): кожна позиція йде своєму
        // постачальнику окремо (BrewDrop/EasyDrop — різні системи, реально різні посилки);
        // вручну лишається лише те, для чого механізм справді не налаштований у CRM.
        const dispatch = await dispatchOrder(A);
        ctx.parcelCount = dispatch.groups.length; ctx.multiParcel = dispatch.multiParcel;
        for (const g of dispatch.groups) {
            const itemsLine = g.items.map((l) => l.name + (l.color ? ' ' + l.color : '') + (l.size ? ' ' + l.size : '') + (l.qty > 1 ? ' ×' + l.qty : '')).join(', ');
            ctx.agent.supplierName = g.supplier;
            if (g.needsManual) {
                await T.alert(A, 'n_agent_supplier_manual_admin', { details: '🏭 ' + g.supplier + ' (' + g.mechanism + ')\n🛍️ ' + itemsLine + (g.result ? '\n' + g.result : '') + '\n👤 ' + (ctx.senderName || '') + ' — https://instagram.com/' + (ctx.igUsername || '') });
            } else {
                ctx.agent.supplierResult = g.result || ('Оформлено (' + g.status + ').');
                await T.alert(A, 'n_agent_supplier_ordered_admin', { details: '👤 ' + (ctx.senderName || '') + ' — https://instagram.com/' + (ctx.igUsername || '') + (g.ttn ? '\n📦 ТТН: ' + g.ttn : '') });
            }
        }
        ctx.supplierOrderStatus = dispatch.groups.map((g) => g.status).join(',') || 'manual';
        ctx.supplierTtn = dispatch.groups.map((g) => g.ttn).filter(Boolean).join(', ');
        ctx.supplierOrderResult = dispatch.groups.map((g) => g.supplier + ': ' + (g.result || g.status)).join('\n');
        ctx.supplierHandled = true;
        await T.ttnSync(A);
        await T.funnelStage(A, ...STAGES.supplier);
    }
    await T.confirmPrep(A);
    const key = (ctx.payStatus || '') + ':' + (ctx.supplierTtn || '');
    if (ctx.agent.confirmKey !== key) {
        const parcelNote = ctx.multiParcel ? '\n\n📦 Ваше замовлення поїде ' + ctx.parcelCount + ' окремими посилками (позиції від різних постачальників) — накладну на кожну надішлемо сюди.' : '';
        A.out.push({ text: messageTextMultiline(A.assets, 'n_confirm', ctx, A.session.id) + parcelNote, step: 'confirm' });
        ctx.agent.confirmKey = key; ctx.agent.lastAsk = '';
        // 2026-09-22 (живі кейси Edits 777d0482/e209cf3a/9a00f981/7dfecd94: "двічі написав той
        // самий текст" — n_confirm тут і "Ваше замовлення в роботі" нижче, з тим самим ТТН, за
        // секунди одне за одним): ctx.postOrderMsgAt раніше ставився лише в самій "post order"
        // гілці, тож перший-же наступний хід після confirm (як от повторна доставка того самого
        // вебхука від Zernio) бачив since=Infinity і одразу дублював підтвердження. Стартуємо
        // 30-хвилинний кулдаун тут, у момент реального підтвердження.
        ctx.postOrderMsgAt = Date.now();
    }
    return 'done';
}

/** Рядок про терміни відправки в підсумку замовлення (умови з налаштувань магазину, якщо є; інакше стандартний). */
function shipTerms(ctx) {
    return (ctx.shop && ctx.shop.terms) || 'Одяг шиється під замовлення: відправка протягом 5 робочих днів (субота й неділя — вихідні) 📦';
}

/** Допродаж без розміру («ще дві білі футболки»): беремо розмір клієнта, якщо допродаж його має (за офферами товару). */
function fillUpsellSize(ctx) {
    const oi = ctx.orderIntent; const upI = ctx.product && Array.isArray(ctx.product.upsellItems) && ctx.product.upsellItems[0];
    if (!oi || !oi.addUpsell || !Array.isArray(oi.upsellUnits) || !oi.upsellUnits.length || !ctx.recommendedSize || !upI) return;
    const upSizes = new Set((upI.offers || []).flatMap((o) => (o.properties || []).filter((q) => /розм|size/i.test(q.name || '')).map((q) => String(q.value).toUpperCase().trim())));
    // Офери допродажу часто без властивості «Розмір» (лише колір) — літерний розмір клієнта тоді вважаємо застосовним (одяг).
    const letter = /^(XXXL|XXL|XL|XS|S|M|L)$/i.test(String(ctx.recommendedSize));
    if (upSizes.has(String(ctx.recommendedSize).toUpperCase()) || (!upSizes.size && letter)) oi.upsellUnits = oi.upsellUnits.map((x) => ({ ...x, size: x.size || ctx.recommendedSize }));
}

async function tryReconcile(A) {
    const { ctx } = A;
    if (Number(ctx.payAmount) === 0 || ctx.payStatus === 'confirmed') return;
    if (A.turnImage) ctx.lastReceiptImageUrl = A.turnImage;
    await T.monoStatement(A);
    ctx.lastUserMessage = A.turnText || '';
    await T.reconcile(A);
    if (ctx.payStatus === 'confirmed') { await T.markConsumed(A); await T.deleteInvoice(A); }
    ctx.payCheckedAt = Date.now();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2026-09-17 (власник: "людина веде себе хаотично... а коли питає щось не по скрипту бот зразу
// губиться" — універсальний фолбек ПІСЛЯ будь-якої секції каскаду): 58 місць у каскаді щось
// кажуть клієнту, але лише частина з них проводить u.questions через KB (answerThenAsk чи прямий
// compose з questions) — решта секцій просто штовхають шаблонний текст, ІГНОРУЮЧИ питання клієнта,
// а якщо взагалі ЖОДНА секція не спрацювала — клієнт отримував повну тишу. runPolicy обгортає
// внутрішній каскад у try/finally: незалежно від того, яка секція відпрацювала (чи не відпрацювала
// жодна) і з якого return вона вийшла, finally завжди перевіряє — чи лишилось невідповіджене
// питання — і, якщо так, дає відповідь БЕЗ втрати запланованого продовження скрипту.
async function runPolicy(A, u) {
    // finally, не catch: якщо каскад кинув виняток — стан A.out частковий/непередбачуваний, тому
    // фолбек НЕ втручається, і виняток пробрасуємо як є (index.js сам покаже стандартне вибачення).
    let threw = false;
    try { await runPolicyInner(A, u); }
    catch (e) { threw = true; throw e; }
    finally { if (!threw) { await universalQuestionFallback(A, u); await enforceInsistLimit(A); } }
}

/** 2026-09-17 (власник: "те, що ми сьогодні робили вже гарно спрацювало... але давай перевірку
 * додамо: якщо людина 2 рази наполягає що спершу хоче відповідь — тоді бота зупиняємо. Бо люди
 * дратуються. Якщо людина продовжує діалог і відповідає на питання — то продовжуй"). Живий кейс
 * e77af3b9: клієнт 7 разів різними словами наполягав "уточніть покрій штанів" ("Штани звужені?" →
 * "Уточніть покрій" → "Мені треба знати покрій" → "Так мені нізащо давати дані" — жодного
 * буквального повтору, тож дедуп в escalateUnresolved тут не рятує), а бот щоразу відповідав
 * "уточню і повернусь" + повторював заклик дати адресу — до відкритого роздратування клієнта
 * ("щоб я його вам назад не відправляв") і втручання менеджера вручну.
 * Лічильник: якщо ЦЕЙ хід знову не дав чесної відповіді (A._unresolvedThisTurn, viставляє
 * escalateUnresolved) І ПОПЕРЕДНІЙ хід теж — досить редиректити в скрипт, кличемо людину.
 * Скидається БУДЬ-яким ходом без нової ескалації (клієнт відповів на питання скрипту чи зрештою
 * отримав відповідь) — саме "продовжує діалог" з прохання власника. */
async function enforceInsistLimit(A) {
    const { ctx } = A;
    if (ctx.funnelPaused) { ctx.agent.unresolvedStreak = 0; return; }
    if (!A._unresolvedThisTurn) { ctx.agent.unresolvedStreak = 0; return; }
    ctx.agent.unresolvedStreak = (ctx.agent.unresolvedStreak || 0) + 1;
    if (ctx.agent.unresolvedStreak < 2) return;
    ctx.agent.unresolvedStreak = 0;
    A.out = [{ text: messageText(A.assets, 'n_agent_insist_handoff', ctx, A.session.id), step: 'insist_handoff' }];
    await pause(A, 'unresolved_insist', 'n_agent_insist_handoff_admin', '💬 клієнт наполягає на відповіді, яку бот не може дати — передано менеджеру');
}

/** Останній рубіж: якщо клієнт про щось запитав, а ЖОДНА секція каскаду не провела це питання
 * через KB цього ходу (A._questionEngaged лишився falsy) — відповідаємо тут, все одно повертаючи
 * в скрипт те, що каскад уже вирішив сказати (A.out), а якщо каскад взагалі нічого не сказав
 * (порожній A.out) — реконструюємо продовження з ctx.agent.lastAsk, щоб клієнт ніколи не отримав
 * повну тишу. Під час handoff/паузи (менеджера вже покликано) фолбек НЕ втручається.
 *
 * 2026-09-22 (живі скріни власника — Maxim Hodak/Vlad Kravchuk/Artem Demianenko/sanya_okstenti
 * та ін.: картка товару (present()) уже містить ціну, кольори, розміри і закінчується проханням
 * зросту/ваги — а якщо повідомлення клієнта, що показало картку, САМЕ ПО СОБІ містило питання
 * (напр. "яка ціна?", прийшло разом із фото/постом), universalQuestionFallback бачив
 * u.questions.length і A._questionEngaged=falsy (present() його не ставить) і ДОДАВАВ ще одне
 * повідомлення — переказ тієї самої ціни СВОЇМИ словами і ПОВТОРНЕ "підкажіть зріст і вагу" з
 * ctx.agent.lastAsk, який present() щойно виставив тим самим текстом. Той самий принцип, що вже
 * застосований для розділу "4. Розмір" і секції "3. Комплект" (A.justPresented — картка вже все
 * сказала, вдруге не питаємо) — тут його не було. Картка не завжди покриває геть усе, що міг
 * запитати клієнт, але власник послідовно (в кожному з цих кейсів) просив саме "нічого не
 * дописувати поверх щойно показаної картки", а не намагатись вгадати, чи компенсувати рідкісний
 * пропуск. */
async function universalQuestionFallback(A, u) {
    if (!u || !u.questions || !u.questions.length || A._questionEngaged || A.ctx.funnelPaused || A.justPresented) return;
    const { ctx } = A;
    let kb = []; try { kb = await T.kbContext(A); } catch (e) { /* best-effort */ }
    const textItems = A.out.filter((o) => o.text);
    const existingText = textItems.map((o) => o.text).join(' ').trim();
    const askText = existingText || String(ctx.agent.lastAsk || '');
    const nextStep = askText ? 'скажи/спитай (можна своїми словами, зміст той самий): «' + askText + '»' : 'НІЧОГО більше не питай — просто дай коротку відповідь на питання клієнта.';
    const { text, resolved } = await compose(A, { questions: u.questions, nextStep, kb, fallback: askText });
    if (!resolved) await escalateUnresolved(A, u.questions[0]);
    if (!text) return;
    if (textItems.length) {
        A.out = A.out.filter((o) => !o.text || o === textItems[0]);
        const idx = A.out.indexOf(textItems[0]);
        A.out[idx] = { ...textItems[0], text };
    } else {
        A.out.push({ text, step: 'question_fallback' });
    }
}

async function runPolicyInner(A, u) {
    const { ctx } = A; ctx.agent = ctx.agent || {};
    const text = String(A.turnText || '');
    // Літерний розмір (S/M/L) для товару з числовою сіткою (джинси 29–36): не зберігаємо як розмір замовлення — відповідаємо, що розміри числові.
    const _szRaw = ctx.product ? ((ctx.product.sizes && ctx.product.sizes.length) ? ctx.product.sizes : (ctx.product.structuredSizes && ctx.product.structuredSizes.length ? ctx.product.structuredSizes : (ctx.product.sizeChartData && ctx.product.sizeChartData.sizes) || ((String(ctx.product.desc || '').match(/Розміри:\s*([^\n]+)/i) || [])[1] || ''))) : '';
    const _szl = ctx.product ? (Array.isArray(_szRaw) ? _szRaw : String(_szRaw || '').split(/[,;\s]+/)).map((z) => String(z).trim()).filter(Boolean) : [];
    if (u.clothingSize && /(?<![A-Za-z])(XXXL|XXL|XL|XS|S|M|L)(?![A-Za-z])/i.test(text) && _szl.length && _szl.every((z) => /^\d+$/.test(z)) && /^(XXXL|XXL|XL|XS|S|M|L)$/i.test(String(u.clothingSize).trim())) {
        if ((ctx.agent.upsellOffered || /допродаж|оформляємо/i.test(String(ctx.agent.lastAsk || ''))) && ctx.product && ctx.product.upsellItems && ctx.product.upsellItems.length && !ctx.crmOrderId) {
            // Питання про літерний розмір одразу після пропозиції футболки: чесно розводимо — джинси числові, літерні розміри стосуються футболки.
            A.out.push({ text: 'Для цих джинсів розміри числові: ' + _szl.join(', ') + ' — літерні S/M/L бувають лише у футболки 🙂 Розмір джинсів у нас уже зафіксований. Додати футболку до замовлення (підберемо їй розмір окремо) чи оформляємо лише джинси?', step: 'letter_size_numeric' });
            return;
        }
        if (!Array.isArray(u.questions) || !u.questions.length) u.questions = ['Чи є розмір ' + String(u.clothingSize).toUpperCase() + '? (у цього товару розміри числові: ' + _szl.join(', ') + ')'];
        u.clothingSize = null;
    }
    // 2026-09-25 (FunnelTest 32): фото БЕЗ тексту у відповідь на питання про колір — це зразок кольору, а не новий товар:
    // не перезапускаємо розпізнавання (раніше перемикало на іншу кофту), просимо співставити з палітрою товару.
    if (ctx.product && ctx.product.sku && A.turnImage && /колір/i.test(String(ctx.agent.lastAsk || '')) && !ctx.crmOrderId && !String(text).replace(/\[фото\]/gi, '').trim() && ctx.product.colors) {
        A.out.push({ text: 'Дякую за фото! 🎨 У цієї моделі є кольори: ' + ctx.product.colors + '. Який із них найближчий до вашого зразка? Напишіть назву, і я одразу зафіксую 🙂', step: 'color_sample_ask' });
        ctx.agent.colorSampleAsked = true;
        ctx.agent.colorAskCount = (ctx.agent.colorAskCount || 0) + 1;
        ctx.agent.lastAsk = 'колір';
        return;
    }
    // Питання про відтінок після фото-зразка («Такий колір є?», «Це який колір?»): за фото відтінок не визначаємо — чесно, без вигаданого «схожий є».
    if (ctx.product && ctx.product.sku && ctx.agent.colorSampleAsked && /колір/i.test(String(ctx.agent.lastAsk || '')) && !ctx.crmOrderId && !A.turnImage && /(такий|схожий|цей|це\s+який|який\s+це|який\s+саме)[^?]{0,20}(колір|відтін)|(колір|відтін)[^?]{0,15}(є|такий|схожий)/i.test(String(text)) && ctx.product.colors) {
        ctx.agent.colorSampleReplies = (ctx.agent.colorSampleReplies || 0) + 1;
        const t1 = 'За фото я не можу точно визначити відтінок 🙈 У цієї моделі є: ' + ctx.product.colors + '. Напишіть, будь ласка, який із них вам ближчий, — або я уточню у менеджера 🙂';
        const t2 = 'Точно порівняти відтінок за фото не вийде — орієнтуйтесь на назви: ' + ctx.product.colors + '. Якщо сумніваєтесь, передам питання менеджеру 💛';
        A.out.push({ text: ctx.agent.colorSampleReplies % 2 ? t1 : t2, step: 'color_sample_honest' });
        ctx.agent.colorAskCount = (ctx.agent.colorAskCount || 0) + 1;
        return;
    }
    // 2026-09-23 (FunnelTest 1): у відповіді на допродаж («так, 2 футболки…») understand() ставить
    // productHint.article на артикул ДОПРОДАЖУ — freshSignal підміняв ним головний товар (кофту).
    // Артикул саме запропонованого допродажу — це не новий головний товар.
    {
        const upS = ctx.product && Array.isArray(ctx.product.upsellItems) && ctx.product.upsellItems[0];
        const pa = u.productHint && (u.productHint.article || u.productHint.fromList);
        if (upS && ctx.agent.upsellOffered && pa && String(pa).toLowerCase() === String(upS.sku || '').toLowerCase()) u.productHint = { ...u.productHint, article: null, fromList: null };
    }
    const freshSignal = !!(A.turnSharedPost || A.newEntryAd || u.productHint.article || u.productHint.fromList || (A.turnImage && !u.claimsPaid && !u.receiptLink && !(ctx.paymentInfo && ctx.paymentInfo.method) ));

    // 2026-09-24 (FunnelTest 16): «Не відкривається посилання» LLM не завжди відносила до wantsManualReq —
    // детермінований страхувальний розбір: скарга на посилання оплати → одразу ручні реквізити.
    if (!u.wantsManualReq && /(не\s+(?:відкрива|відкрит|працю|грузит|вантаж)[^.!?]{0,40}(?:посилан|лінк|ссылк))|((?:посилан|лінк|ссылк)[^.!?]{0,40}не\s+(?:відкрива|відкрит|працю|грузит|вантаж))/i.test(text)) u.wantsManualReq = true;
    // Клієнт стверджує, що він не бот («Я не бот, я людина») — не підігруємо, коротко й чесно.
    if (/я\s+не\s+бот|я\s+(?:жива\s+)?людина/i.test(text) && !/[?]/.test(text)) {
        A.out.push({ text: 'Розумію 🙂 Я віртуальна помічниця магазину, а жива людина — наш менеджер, він підключиться до розмови, щойно буде вільний 💛', step: 'not_bot_reply' });
        return;
    }
    // 2026-09-24 (FunnelTest 40): на пряме «Ви бот?» бот чесно каже, що він віртуальна помічниця; жива людина — за проханням.
    if (/(^|[^а-яіїєґ])(ви|ти|це)\s+(?:просто\s+)?(?:чат[\s-]?)?бот[іи]?[\s?!.]*$|бот\s+чи\s+(?:людина|живий)|(?:людина|живий)\s+чи\s+бот/i.test(text) && !/я\s+не\s+бот/i.test(text)) {
        ctx.agent.botQuestionCount = (ctx.agent.botQuestionCount || 0) + 1;
        A.out.push({ text: 'Я віртуальна помічниця магазину 🙂 Допомагаю з підбором і оформленням, а якщо потрібна жива людина — скажіть, і я одразу покличу менеджера 💛', step: 'bot_honest' });
        if (!/менеджер|людин|живий|покличте/i.test(text.replace(/бот\s+чи\s+(?:людина|живий)|(?:людина|живий)\s+чи\s+бот/ig, ''))) return;
    }
    // 2026-09-24 (FunnelTest 28): «Поміняю відділення, напишу номер» — клієнт змінює адресу; бот чекає номер, а не питає про колір.
    if (!u.branch && /(поміня|зміни|змінюю|інше|інший|друге)\S*\s+(?:відділенн|поштомат)/i.test(text)) {
        if (ctx.orderData) delete ctx.orderData.branch;
        delete ctx.np;
        if (ctx.crmOrderId) { A.out.push({ text: 'Звісно 🙂 Напишіть, будь ласка, номер нового відділення чи поштомата — передам менеджеру, щоб змінили адресу до відправки.', step: 'branch_change_post' }); await T.alert(A, 'n_agent_post_extra_admin', { details: '📍 Клієнт хоче змінити відділення після оформлення: «' + text.slice(0, 200) + '»' }); return; }
        A.out.push({ text: 'Звісно 🙂 Напишіть, будь ласка, номер нового відділення чи поштомата Нової пошти.', step: 'branch_change' }); ctx.agent.lastAsk = 'дані доставки: № відділення або поштомата'; return;
    }
    // 0. Людина / претензія / повернення
    if (u.wantsHuman) {
        ctx.agent.handoffAsked = (ctx.agent.handoffAsked || 0) + 1;
        if (ctx.agent.handoffAsked > 1) { A.out.push({ text: 'Менеджер уже підключається 🙏 Дякую за терпіння — відповість сюди найближчим часом 💛', step: 'handoff_again' }); return; }
        A.out.push({ text: messageText(A.assets, 'n_agent_handoff', ctx, A.session.id), step: 'handoff' });
        await pause(A, 'handoff', 'n_agent_handoff_admin', '💬 «' + text.slice(0, 200) + '»');
        return;
    }
    if (u.isComplaint && !u.returnRequest) {
        A.out.push({ text: messageText(A.assets, 'n_agent_complaint_ack', ctx, A.session.id), step: 'complaint' });
        await pause(A, 'complaint', 'n_agent_complaint_admin', '💬 «' + text.slice(0, 300) + '»');
        return;
    }
    if (ctx.returnFlow && ctx.returnFlow.stage === 'await_ttn') {
        const ttn = ttnIn(text);
        if (ttn) { ctx.returnFlow = { ...ctx.returnFlow, ttn, stage: 'done' }; ctx.returnTtn = ttn; await T.returnCrmUpdate(A); A.out.push({ text: messageTextMultiline(A.assets, 'n_return_confirm_msg', ctx, A.session.id), step: 'return_confirm' }); await T.alert(A, 'n_return_admin'); return; }
        A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_return_wait_ask', ctx, A.session.id)), step: 'return_wait' });
        return;
    }
    if (u.returnRequest) {
        A.out.push({ text: messageTextMultiline(A.assets, 'n_return_easy_msg', ctx, A.session.id), step: 'return_easy' });
        ctx.returnFlow = { stage: 'await_ttn', at: Date.now() };
        await T.alert(A, 'n_agent_return_request_admin', { details: '💬 «' + text.slice(0, 200) + '»' });
        return;
    }

    // 1. Після оформленого замовлення
    if (ctx.crmOrderId && !freshSignal) {
        if ((u.claimsPaid || u.receiptLink || A.turnImage) && ctx.payStatus !== 'confirmed' && Number(ctx.payAmount) > 0) {
            await tryReconcile(A);
            if (ctx.payStatus === 'confirmed') { await afterOrderAccepted(A); return; }
            if (!u.receiptLink && !A.turnImage) {
                // «Відправив»/«Оплатив» текстом — не доказ оплати (FunnelTest 13): просимо квитанцію, не підтверджуємо.
                A.out.push({ text: 'Дякую! Щоб звірити оплату, скиньте, будь ласка, скріншот або посилання на квитанцію 🙏', step: 'post_receipt_ask' });
                await T.alert(A, 'n_receipt_alert', { photoUrl: '' });
                return;
            }
            A.out.push({ text: messageText(A.assets, 'n_post_order_receipt_msg', ctx, A.session.id), step: 'post_receipt' });
            if (A.turnImage) ctx.receiptNew = true;
            await T.alert(A, 'n_receipt_alert', { photoUrl: A.turnImage || '' });
            return;
        }
        if (u.wantsCard && ctx.payStatus !== 'confirmed' && Number(ctx.payAmount) > 0) { await sendCard(A); return; }
        if (u.wantsManualReq && ctx.payStatus !== 'confirmed' && Number(ctx.payAmount) > 0) {
            // Живий кейс 2026-09-14 (Валерій): оплата за посиланням уже надіслана раніше, клієнт
            // хоче реквізити вручну — бот відповідав шаблонним «замовлення в роботі», ігноруючи
            // прохання. Секція «Після оформленого замовлення» не перевіряла wantsManualReq взагалі.
            await sendManualRequisites(A, true);
            return;
        }
        // 2026-09-23 (FunnelTest 11, відтворено): замовлення в CRM створюється ще ДО оплати, тож
        // «а можна краще повну передплату?» після видачі посилання потрапляло сюди й бот мовчав.
        // Оплата ще не підтверджена і постачальнику не пішло — спокійно перемикаємо спосіб і
        // перевидаємо реквізити; інакше (уже сплачено/відправлено) — передаємо менеджеру.
        if (u.paymentMethodChange && ctx.paymentInfo && u.paymentMethodChange !== ctx.paymentInfo.method) {
            const canSwitch = ctx.payStatus !== 'confirmed' && !ctx.supplierHandled;
            await T.alert(A, 'n_agent_post_extra_admin', { details: '💳 Клієнт просить змінити спосіб оплати на «' + (u.paymentMethodChange === 'full' ? 'повна передплата' : 'передплата 200 + накладений') + '»' + (canSwitch ? ' (бот перевидав реквізити, замовлення ' + (ctx.crmOrderId || '') + ' — перевірте суму в CRM)' : ' — оплата вже підтверджена/замовлення передано, потрібна ваша участь') + '. 💬 «' + text.slice(0, 200) + '»' });
            if (canSwitch) {
                ctx.paymentInfo = { ...ctx.paymentInfo, method: u.paymentMethodChange }; ctx.orderRef = ''; await T.payAmount(A); await sendRequisites(A, u);
            } else {
                A.out.push({ text: messageText(A.assets, 'n_agent_post_extra_ack', ctx, A.session.id), step: 'post_extra' });
            }
            return;
        }
        if (u.extraProducts || u.alsoWants) {
            A.out.push({ text: messageText(A.assets, 'n_agent_post_extra_ack', ctx, A.session.id), step: 'post_extra' });
            ctx.agent.orderRefDisplay = ctx.orderRef || ctx.crmOrderId;
            await T.alert(A, 'n_agent_post_extra_admin', { details: '💬 «' + text.slice(0, 200) + '»' });
            return;
        }
        // 2026-09-17 (живий кейс, Юрій Карталєв: "Дякую." після оформлення — Zernio позначив
        // розмову як "бот не веде далі, відповідайте в чаті"): "дякую"/"буду чекати"/"ок" — це
        // ПРИРОДНИЙ кінець розмови, не збій. understand() вже класифікує це як intent:'thanks' —
        // просто ніде не перевірялось, тож хід або мовчав (в межах 30 хв від n_post_order_msg),
        // або за 30+ хв повторно вивалював важкий "Ваше замовлення в роботі". Коротка тепла
        // відповідь, БЕЗ повтору статусу і БЕЗ сповіщення менеджеру — ескалювати нічого.
        if (u.intent === 'thanks' && !u.questions.length) {
            A.out.push({ text: messageText(A.assets, 'n_agent_post_order_thanks', ctx, A.session.id), step: 'post_order_thanks' });
            ctx.postOrderMsgAt = Date.now();
            return;
        }
        const since = Date.now() - Number(ctx.postOrderMsgAt || 0);
        if (!u.clothingSize) { const sm = text.match(/(?:змін|поміня|заміни|переробі|краще|давайте)\S*[^.!?]{0,25}?(?:розмір|размер|на)\s+(XXXL|XXL|XL|XS|S|M|L)(?![A-Za-z])/i); if (sm) u.clothingSize = sm[1]; }
        if (u.clothingSize && !ctx.supplierTtn && !ctx.ttn && !u.statusQuestion) {
            // 2026-09-24 (FunnelTest 28): зміна розміру після оформлення — чітке підтвердження + сигнал менеджеру, а не «в роботі 💛».
            { const ns = String(u.clothingSize).toUpperCase(); delete ctx.agent.pairSizes; ctx.recommendedSize = ns; if (Array.isArray(ctx.orderUnits)) ctx.orderUnits = ctx.orderUnits.map((x) => ({ ...x, size: ns })); if (ctx.colorChoice) ctx.colorChoice = { ...ctx.colorChoice, size: ns }; }
            A.out.push({ text: 'Звісно, змінила на ' + String(u.clothingSize).toUpperCase() + ' 👍 Передаю менеджеру, щоб виправили розмір у замовленні до відправки.', step: 'post_size_change' });
            await T.alert(A, 'n_agent_post_extra_admin', { details: '📏 Клієнт просить змінити розмір на ' + String(u.clothingSize).toUpperCase() + ' після оформлення: «' + text.slice(0, 200) + '»' });
            return;
        }
        if (u.statusQuestion && !ctx.supplierTtn && !ctx.ttn) {
            // 2026-09-24 (FunnelTest 44): «коли відправка / чому не відправили» до ТТН — стандартні терміни, а не вигадана причина.
            A.out.push({ text: 'Одяг шиється під замовлення: відправка протягом 5 робочих днів з моменту оформлення (субота й неділя — вихідні). Номер накладної (ТТН) надішлемо сюди одразу після відправки 📦', step: 'post_status_terms' });
        } else if (u.questions.length && !u.statusQuestion) {
            A.out.push({ text: await answerThenAsk(A, u, 'Ваше замовлення в роботі 💛'), step: 'post_q' });
        } else if (since > 30 * 60 * 1000) {
            A.out.push({ text: messageTextMultiline(A.assets, 'n_post_order_msg', ctx, A.session.id), step: 'post_order' }); ctx.postOrderMsgAt = Date.now();
        } else if (hasCategoryWord(text) && /(додай|ще\s|також|плюс|хочу\s|дода[тй])/i.test(text)) {
            // «Додайте ще футболку білу» після оформлення — це додатковий товар, а не «так, оформляйте» (FunnelTest 44).
            A.out.push({ text: messageText(A.assets, 'n_agent_post_extra_ack', ctx, A.session.id), step: 'post_extra' });
            ctx.agent.orderRefDisplay = ctx.orderRef || ctx.crmOrderId;
            await T.alert(A, 'n_agent_post_extra_admin', { details: '💬 «' + text.slice(0, 200) + '»' });
        } else if (Number(ctx.payAmount) > 0 && ctx.payStatus !== 'confirmed') {
            // 2026-09-23 (FunnelTest, інваріант I1 «бот не мовчить»): клієнт відповідає «так, оформляйте» вже ПІСЛЯ
            // видачі посилання на оплату — раніше бот мовчав (30 хв після post_order), і Zernio позначав розмову
            // як «бот не веде далі». Коротке нагадування замість тиші.
            A.out.push({ text: 'Дякую! 🙌 Чекаю на оплату за посиланням вище — щойно побачу її, одразу передам замовлення у відправку 💛', step: 'post_pay_reminder' });
        }
        if (since > 30 * 60 * 1000 || u.statusQuestion) await T.alert(A, 'n_post_order_admin');
        return;
    }

    // 1b. Раннє захоплення даних доставки і чеків — незалежно від стадії (клієнт може написати
    //     адресу чи скинути чек ще до підбору розміру; нічого не губимо і не перепитуємо потім).
    // 2026-09-23 (FunnelTest, «перше відділення»): слово-числівник LLM не завжди повертає числом —
    // страхуємо детермінованим розбором, щоб номер не губився.
    // Квитанція чи «оплатив 200» до вибору способу оплати = варіант 1 (200 грн передоплата).
    if ((u.claimsPaid || u.receiptLink || A.turnImage || /оплатив|сплатив|переказав|скинув\s+(?:квитанц|чек)|ось\s+(?:квитанц|чек)/i.test(text)) && /(^|\D)200(\D|$)/.test(text) && !(ctx.paymentInfo && ctx.paymentInfo.method) && !ctx.crmOrderId) { u.payMethod = 'cod'; ctx.agent.paidBeforeInvoice = true; }
    if (!u.branch && !u.homeAddress) {
        const ORD = { 'перш': 1, 'друг': 2, 'трет': 3, 'четверт': 4, 'п’ят': 5, "п'ят": 5, 'шост': 6, 'сьом': 7, 'восьм': 8, 'дев’ят': 9, "дев'ят": 9, 'десят': 10 };
        const om = text.toLowerCase().match(/(перш|друг|трет|четверт|п[’']ят|шост|сьом|восьм|дев[’']ят|десят)\S*\s+(?:відділенн|віділен|нп|нової\s+пошти)/);
        if (om) u.branch = String(ORD[om[1].replace('’', "'")] || ORD[om[1]] || '');
    }
    // 2026-09-23 (FunnelTest 31): 11 цифр («09912448883») LLM мовчки обрізала до 10 і оформлення йшло далі
    // з чужим номером. Телефон приймаємо лише якщо в тексті є рівно 10 цифр з 0 (або 380 + 9); інакше просимо виправити.
    let __phoneNote = '';
    if (u.phone) {
        const runs = String(text).replace(/[\s\-()+.]/g, '').match(/\d{9,13}/g) || [];
        if (runs.length && !runs.some((r) => /^0\d{9}$/.test(r) || /^380\d{9}$/.test(r))) { u.phone = null; __phoneNote = 'Номер телефону виглядає некоректно — напишіть, будь ласка, 10 цифр, наприклад 0501234567 📱 '; }
    }
    const __dataThisTurn = !!((u.phone || u.fullName || u.city || u.branch) && !u.homeAddress);
    if (__dataThisTurn) {
        ctx.orderData = { ...(ctx.orderData || {}), ...(u.fullName ? { fullName: u.fullName } : {}), ...(u.phone ? { phone: u.phone } : {}), ...(u.city ? { city: u.city } : {}), ...(u.region ? { region: u.region } : {}), ...(u.branch ? { branch: u.branch } : {}) };
    }
    // 1c. Раннє захоплення параметрів розміру і кольору — теж незалежно від стадії (клієнт міг назвати
    //     зріст/вагу, поки бот ще питав про комплект чи колір): нічого не губиться, потім не перепитується.
    if (u.height || u.weight || u.clothingSize || u.chest || u.footLength || u.waist || u.belly) {
        const si = { ...(ctx.sizeInput || {}) };
        if (u.height) si.height = u.height; if (u.weight) si.weight = u.weight; if (u.clothingSize) si.clothingSize = u.clothingSize; if (u.chest) si.chest = u.chest; if (u.footLength) si.footLength = u.footLength; if (u.waist) si.waist = u.waist; if (u.belly) si.belly = true;
        ctx.sizeInput = si;
    }
    // 2026-09-24 (FunnelTest 23): два одержувачі в одному повідомленні («185/58 темно-сіру, 187/100 чорну») — рахуємо розмір
    // для кожної пари окремо й збираємо дві одиниці, а не питаємо зріст/вагу заново.
    {
        const prs = [...String(text).matchAll(/(\d{3})\s*(?:см)?\s*[\/,\s]\s*(\d{2,3})\s*(?:кг)?/gi)].map((m) => ({ h: Number(m[1]), w: Number(m[2]) })).filter((x) => x.h >= 140 && x.h <= 220 && x.w >= 35 && x.w <= 200);
        if (prs.length < 2) {
            // Формат словами: «185 см зросту, десь 58 кг … 187 см, 100 кг» — зрости й ваги по порядку.
            const hs = [...String(text).matchAll(/(\d{3})\s*см/gi)].map((m) => Number(m[1]));
            const ws = [...String(text).matchAll(/(\d{2,3})\s*кг/gi)].map((m) => Number(m[1]));
            if (hs.length >= 2 && ws.length >= 2) { prs.length = 0; prs.push({ h: hs[0], w: ws[0] }, { h: hs[1], w: ws[1] }); }
        }
        if (prs.length >= 2 && ctx.product && !ctx.product.isSet && !ctx.crmOrderId) {
            const sizes = [];
            for (const pr of prs.slice(0, 2)) { ctx.recommendedSize = null; ctx.sizeOutOfRange = false; ctx.sizeInput = { ...(ctx.sizeInput || {}), height: pr.h, weight: pr.w, clothingSize: undefined }; await T.calcSize(A); sizes.push(ctx.recommendedSize); }
            if (sizes.every(Boolean)) {
                const cols = (u.units || []).map((x) => x && x.color);
                u.units = sizes.map((sz, i) => ({ color: cols[i] || '', size: sz }));
                u.qty = sizes.length; ctx.recommendedSize = sizes[0]; ctx.agent.pairSizes = sizes;
            }
        }
    }
    if (u.colorMatched) ctx.agent.pendingColor = u.colorMatched; else if (u.color) ctx.agent.pendingColorRaw = u.color;
    // 2026-09-23 (FunnelTest 4: «джинси хочу чорні» до підбору розміру губилось — секція кольорів
    // комплекту виконується лише ПІСЛЯ розміру і бачила тільки текст свого ходу): запамʼятовуємо
    // сирі повідомлення з кольором, поки комплект активний, і розбираємо їх по позиціях пізніше.
    if (ctx.product && ctx.product.isSet && (ctx.setMode === 'set' || (Array.isArray(ctx.setSelection) && ctx.setSelection.length)) && !ctx.agent.setColorsResolved) {
        ctx.agent.setColorHints = (ctx.agent.setColorHints || []).concat(text).slice(-5);
    }
    const earlyReceipt = (u.receiptLink || u.claimsPaid || (A.turnImage && addressComplete(ctx.orderData))) && !ctx.crmOrderId && !(ctx.paymentInfo && ctx.paymentInfo.method);
    if (earlyReceipt && !ctx.agent.receiptEarlyAlertAt) {
        ctx.agent.receiptEarlyAlertAt = Date.now();
        await T.alert(A, 'n_agent_early_payment_admin', { details: '💬 «' + text.slice(0, 200) + '»', photoUrl: A.turnImage || '' });
    }
    const preNote = __phoneNote + (__dataThisTurn && !addressComplete(ctx.orderData) ? 'Дані доставки записала 📝 ' : '') + (earlyReceipt ? ((u.receiptLink || A.turnImage) ? 'Дякую, оплату бачу — звіримо 🙏 Щоб оформити відправку, лишилось кілька кроків. ' : 'Дякую! Щоб звірити оплату, скиньте, будь ласка, скріншот або посилання на квитанцію 🙏 ') : '') + (u.intent === 'wants_requisites' && !(ctx.paymentInfo && ctx.paymentInfo.method) ? 'Реквізити надішлю одразу після підбору розміру і кольору 🙂 ' : '');

    // 2. Товар
    // 2026-09-15 (живий кейс: у комплекті клієнт написав "чорні джинси"/"Чорний" — понял() LLM
    // побачив productHint на артикул джинсів j0032, freshSignal=true, resolveProduct переключив
    // ctx.product на ОКРЕМИЙ товар-компонент і resetForNewProduct стер ВЕСЬ прогрес комплекту
    // (setSelection, sizeInput...) — клієнту вилізла картка джинсів і ПОВТОРНЕ "зріст і вага?",
    // хоча все це вже дано для комплекту. Компонент комплекту, який клієнт і так купує, — не
    // новий товар: якщо ми зараз усередині активного комплекту, запам'ятовуємо його "на всяк
    // випадок" і після resolveProduct перевіряємо, чи не підмінили товар на власний компонент.
    const __setBeforeProduct = ctx.product;
    const __setBeforeSelection = ctx.setSelection;
    // 2026-09-22 (архітектурний аудит product-recognition, критична знахідка): freshSignal вище
    // визнавав лише пост/рекламу/артикул/фото — гола категорія словами ("а є джинси?", "хочу
    // кофту чорну") НІКОЛИ не відкривала цю секцію повторно, поки товар уже підтверджено, тож
    // n_lookup навіть не викликався для таких повідомлень. Дозволяємо категорійне слово теж
    // відкрити повторний матчинг — АЛЕ тільки до оформлення замовлення (crmOrderId), щоб не
    // зачепити вже перевірену поведінку "після оформлення — лише хендофф менеджеру" (розділ 1).
    const categorySignal = !ctx.crmOrderId && hasCategoryWord(text) && !categoryWordIsUpsell(text, ctx) && !categoryWordIsSetComponent(text, ctx) && !categoryWordIsMain(text, ctx) && !u.wantsSizeChart;
    if (!P(ctx) || freshSignal || categorySignal) {
        if (u.productHint.fromList && ctx.catalogHintSkus) {
            const skus = String(ctx.catalogHintSkus).split(',').map((s) => s.trim()).filter(Boolean);
            const hit = skus.find((s) => s.toLowerCase() === String(u.productHint.fromList).toLowerCase()) || skus.find((s) => String(u.productHint.fromList).toLowerCase().includes(s.toLowerCase()));
            // «2,4» — два пункти списку одразу (FunnelTest 34): перший стає основним, другий — окремою позицією.
            const mm = text.match(/^\s*(\d)\s*(?:,|і|та|и|\+|\s)\s*(\d)\s*$/);
            if (mm && skus[Number(mm[1]) - 1] && skus[Number(mm[2]) - 1] && mm[1] !== mm[2]) {
                ctx.catalogHintPick = skus[Number(mm[1]) - 1]; ctx.agent.multiPickExtra = skus[Number(mm[2]) - 1];
                u.productHint = { ...u.productHint, fromList: ctx.catalogHintPick };
            } else
            if (hit) ctx.catalogHintPick = hit;
            else if (skus.length) {
                // 2026-09-23 (FunnelTest 2: «так, першу» після списку футболок — LLM віддала fromList зі
                // СТАРОГО списку костюмів → куртка D0005). Вибір не з поточного списку: порядковий
                // числівник/«так» звужуємо до поточного списку, а сміттєвий fromList відкидаємо.
                const ORD = [/перш|^\s*1/i, /друг|^\s*2/i, /трет|^\s*3/i, /четверт|^\s*4/i, /п[’']ят|^\s*5/i];
                const oi = ORD.findIndex((re) => re.test(text));
                if (oi >= 0 && skus[oi]) ctx.catalogHintPick = skus[oi];
                else if (skus.length === 1 && /^\s*(так|да|ага|ок|давайте|це|її|його)/i.test(text)) ctx.catalogHintPick = skus[0];
                if (!ctx.catalogHintPick) u.productHint = { ...u.productHint, fromList: null };
                else u.productHint = { ...u.productHint, fromList: ctx.catalogHintPick };
            }
        }
        if (u.productHint.article && !/артикул|арт\.|\b[a-z]\d{3,6}\b/i.test(text)) ctx.lastUserMessage = text + ' артикул ' + u.productHint.article;
        const r = await T.resolveProduct(A, u);
        const swappedToOwnSetComponent = r.status === 'found' && __setBeforeProduct && __setBeforeProduct.isSet && Array.isArray(__setBeforeSelection)
            && P(ctx).sku !== __setBeforeProduct.sku && __setBeforeSelection.some((it) => it.article === P(ctx).sku);
        // 2026-09-23 (FunnelTest 4, вхід з реклами): реклама щоразу повертає ПОВНИЙ комплект, і він
        // перезаписував уже звужену вибірку («лише кофта і джинси») — розмір питали по всіх 4 позиціях.
        const setNarrowedLost = r.status === 'found' && __setBeforeProduct && __setBeforeProduct.isSet && ctx.product && ctx.product.isSet
            && ctx.product.sku === __setBeforeProduct.sku && Array.isArray(ctx.setSelection) && Array.isArray(__setBeforeProduct.setItems)
            && Array.isArray(ctx.product.setItems) && __setBeforeProduct.setItems.length < ctx.product.setItems.length;
        if (setNarrowedLost) {
            ctx.product = __setBeforeProduct;
        } else if (swappedToOwnSetComponent) {
            // Повертаємо комплект як активний товар і НІЧОГО не скидаємо — далі хід обробить
            // секція комплекту (5b) так само, якби productHint не спрацював.
            ctx.product = __setBeforeProduct;
            ctx.setSelection = __setBeforeSelection;
        } else if (r.status === 'found') {
            resetForNewProduct(A, P(ctx).sku);
            const samePresented = ctx.agent.presentedSku === P(ctx).sku && ctx.presentedAt && (Date.now() - Number(ctx.presentedAt)) < 6 * 3600 * 1000;
            if (!samePresented) {
                await present(A);
                // «2,4»: після картки першого варіанту коротко показуємо й другий, обраний одночасно (FunnelTest 34).
                if (ctx.agent.multiPickExtra) {
                    try {
                        const catX = await loadCatalog(A.botId, A.keys);
                        const px = catX.products.find((x) => String(x.sku).toUpperCase() === String(ctx.agent.multiPickExtra).toUpperCase());
                        if (px) A.out.push({ text: 'І другий обраний варіант 👌 ' + (px.customerName || px.name).split('\n')[0] + ' — ' + px.price + ' грн. Додати його до замовлення окремою позицією чи оформляємо тільки перший? 🙂', step: 'multi_pick_second' });
                    } catch (e) { /* best-effort */ }
                    if (ctx.agent.multiPickExtra) ctx.agent.pendingSecondPick = ctx.agent.multiPickExtra;
                    delete ctx.agent.multiPickExtra;
                }
                // 2026-09-23 (FunnelTest 6: «яка ціна?» разом із постом — картка ВЖЕ містить ціну, а
                // compose відповідав на питання ще раз і навіть озвучив службову примітку «клієнт щойно
                // переслав пост…»). Запитання про ціну, на яке щойно відповіла картка, знімаємо.
                if (A.justPresented && Array.isArray(u.questions) && u.questions.length) {
                    u.questions = u.questions.filter((q) => !/(ціна|ціну|цін[иі]|скільки\s+кошту|вартіст|почім|прайс)/i.test(String(q)));
                }
            }
            else if (u.wantsPhoto && !A.turnImage && (Date.now() - Number(ctx.presentedAt)) > 2 * 60 * 1000) { const urls = firstPhotoUrls(P(ctx)); if (urls.length) A.out.push({ photoUrls: urls, caption: '', step: 'photo_again' }); }
            if (ctx.adLinkMismatchAt && !ctx.adLinkMismatchAlertedAt) { await T.alert(A, 'n_ad_conflict_admin'); ctx.adLinkMismatchAlertedAt = Date.now(); }
            // нижче — продовжуємо тим самим ходом (параметри/колір могли бути вже в повідомленні)
        } else if (r.status === 'hint') {
            const photos = Array.isArray(ctx.catalogHintPhotos) ? ctx.catalogHintPhotos.filter((x) => /^https?:/.test(String(x))).slice(0, 4) : [];
            if (photos.length && ctx.agent.hintPhotosFor !== ctx.catalogHintSkus) { A.out.push({ photoUrls: photos, caption: '', step: 'hint_photos' }); ctx.agent.hintPhotosFor = ctx.catalogHintSkus; }
            const list = String(ctx.catalogHint || '');
            ctx.agent.hintList = list;
            A._questionEngaged = true;
            // Розмір із показаних товарів: клієнт назвав розмір, якого нема — чесно одразу, з альтернативою.
            let sizeFact = '';
            try {
                const catH = await loadCatalog(A.botId, A.keys);
                const hs = new Set([...(ctx.catalogHintSkus || []), ...[...list.matchAll(/артикул\s+([A-Za-z0-9_-]+)/gi)].map((m) => m[1])].map((x) => String(x).toUpperCase()));
                const nums = [];
                for (const pr of catH.products) if (hs.has(String(pr.sku).toUpperCase()) && pr.sizeChartData && Array.isArray(pr.sizeChartData.sizes)) pr.sizeChartData.sizes.forEach((z) => { const n = Number(String(z).replace(/\D/g, '')); if (n) nums.push(n); });
                if (nums.length) {
                    const lo = Math.min(...nums), hi = Math.max(...nums);
                    sizeFact = '\nРозміри показаних товарів у наявності: ' + lo + '–' + hi + '. Якщо клієнт назвав розмір поза цим діапазоном — ОДРАЗУ, у цьому ж повідомленні, чесно скажи, що такого розміру немає (є ' + lo + '–' + hi + '), і ОБОВʼЯЗКОВО запропонуй оформити замовлення без цього товару, а також підібрати інший варіант або покликати менеджера.';
                }
            } catch (e) { /* best-effort */ }
            const { text: txt, resolved: hintResolved } = await compose(A, { questions: u.questions, noGreeting: A.botSpokeBefore, extraFacts: 'СПИСОК ТОВАРІВ, ЯКІ ПІДХОДЯТЬ ПІД ЗАПИТ (вже пронумеровано, кожен товар — своя позиція):\n' + list + sizeFact, nextStep: 'наведи ЦЕЙ список рівно так, як він є — кожен номер на своєму рядку, з порожнім рядком між позиціями, без артикулів у дужках, ціни лишити — і спитай, який сподобався (можна відповісти номером, фото чи кольором; артикул просити не треба, фото вже надіслано)', fallback: messageTextMultiline(A.assets, 'n_agent_catalog_hint_fallback', ctx, A.session.id) });
            if (!hintResolved && u.questions.length) await escalateUnresolved(A, u.questions[0]);
            A.out.push({ text: txt, step: 'hint' }); ctx.agent.lastAsk = 'який із показаних товарів цікавить';
            return;
        } else if (!P(ctx) && ctx.agent.hintList && /^[\s?!.…]*$|^\s*(ау|алло|ало|ей|еу|ну)[\s?!.]*$/i.test(text.trim())) {
            // 2026-09-24 (FunnelTest 41): «?»/«Ау» після показаного списку — нетерплячка, а не новий запит; показуємо
            // список ще раз замість скидання в «що вас цікавить».
            ctx.agent.hintRepeatCount = (ctx.agent.hintRepeatCount || 0) + 1;
            A.out.push({ text: ctx.agent.hintRepeatCount % 2 ? ('Я тут 🙂 Оберіть, будь ласка, номер варіанту зі списку вище' + ((ctx.sizeInput && ctx.sizeInput.height && !ctx.sizeInput.weight) ? ' і напишіть вагу — підберу розмір.' : ' — і одразу підберу розмір.')) : 'Тут-тут 💛 Напишіть номер або колір із показаного списку, і рухаємось далі.', step: 'hint_repeat' });
            ctx.agent.lastAsk = 'який із показаних товарів цікавить';
            return;
        } else if (!P(ctx)) {
            if (ctx.hasProductSignal && !ctx.unknownNotifiedAt && !ctx.looksLikeReceipt) { ctx.lastCustomerMessage = text; await T.tool(A, 'n_unknown_debug'); await T.alert(A, 'n_unknown_admin', { photoUrl: A.turnImage || '' }); ctx.unknownNotifiedAt = Date.now(); }
            if (ctx.looksLikeReceipt) {
                // 2026-09-15 (живий баг, знайдено аудитом реплеїв — ustym_m4): n_lookup СВІДОМО
                // переносить цей прапор із ходу в хід, поки товар не визначено (щоб не загубити
                // сигнал «це квитанція» за кілька повідомлень), але ТУТ ми його ніколи не гасили —
                // тому одна квитанція на початку розмови змушувала бота відповідати цим самим
                // канонічним текстом на БУДЬ-яке наступне повідомлення без товару («Дякую», «А
                // звідки відправка?»), ігноруючи реальний зміст. Гасимо одразу після одноразового
                // сповіщення менеджеру — новий сигнал «це квитанція» n_lookup виставить заново сам.
                ctx.looksLikeReceipt = false;
                A.out.push({ text: messageText(A.assets, 'n_agent_receipt_no_order', ctx, A.session.id), step: 'receipt_no_order' });
                await T.alert(A, 'n_agent_receipt_no_order_admin', { details: '💬 «' + text.slice(0, 200) + '»', photoUrl: A.turnImage || '' });
                return;
            }
            // Категорії — з CRM (ctx.catalogCategories); рядок нижче — лише останній фолбек, якщо
            // CRM взагалі не повернула жодної категорії (порожній каталог), не хардкод-заміна CRM.
            ctx.agent.categoriesList = ctx.catalogCategories || 'костюми, куртки, бомбери, кофти, футболки, джинси, взуття';
            const cats = ctx.catalogCategories ? ('Категорії в наявності: ' + ctx.catalogCategories) : 'Категорії: ' + ctx.agent.categoriesList;
            A._questionEngaged = true;
            const { text: txt, resolved: unkResolved } = await compose(A, { questions: u.questions, noGreeting: A.botSpokeBefore, extraFacts: cats, nextStep: A.turnImage ? 'скажи, що по фото не змогла впізнати модель, і спитай, що саме цікавить: назви категорії; або попроси переслати пост/рілс' : 'спитай, що саме цікавить (назви категорії) або попроси переслати пост/рілс з Instagram', fallback: (A.botSpokeBefore ? '' : 'Вітаю! 💛 ') + messageText(A.assets, 'n_agent_unknown_fallback', ctx, A.session.id) });
            if (!unkResolved && u.questions.length) await escalateUnresolved(A, u.questions[0]);
            A.out.push({ text: txt, step: 'unknown' }); ctx.agent.lastAsk = 'що цікавить';
            return;
        }
    }
    const p = P(ctx);

    // 3. Комплект
    if (p.isSet && !ctx.setMode) {
        // 2026-09-18 (живий кейс, Roman/tovstanovskiy_, сесія 20af04a6: "Кофта и лоферы" / "5934
        // А0187" / "Отдельно" — клієнт тричі поспіль називав ОДРАЗУ КІЛЬКА окремих позицій
        // комплекту, а setChoice/setArticle (нижче) вміють розпізнати лише ОДНУ позицію за раз —
        // бот тричі перепитав те саме "весь комплект чи окремі речі?", клієнт розлютився й пішов
        // ("Вы на приколе?"). Той самий baг у 4d43e173 (S., "Це не моє замовлення"). Перевіряємо
        // НЕЗАЛЕЖНО від того, що зрозумів understand() — чи повідомлення прямим текстом називає
        // 2+ РІЗНІ позиції з setItems. Якщо так — заводимо часткову вибірку через ТОЙ САМИЙ
        // механізм, що й повний комплект (5b: ctx.setSelection з ціною/кольором/розміром по
        // кожній позиції), просто звузивши pp.setItems до вибраних — так Section 4 (розмір) і
        // resolveSetParams питають параметри ЛИШЕ для вибраних позицій, а не для всіх чотирьох.
        // ВАЖЛИВО: `\b` у JS-регексах визначається через `\w` (лише [A-Za-z0-9_]), тому `\bі\b`/
        // `\bта\b` НІКОЛИ не спрацьовує всередині чисто кириличного тексту (немає ЖОДНОЇ позиції,
        // де одна сторона \w, а інша — ні) — розбиваємо на сполучники "і/та/и/й" через пробіли з
        // обох боків (\s+…\s+), а не межі слова.
        let multiHandled = false;
        if (Array.isArray(p.setItems) && p.setItems.length > 1) {
            const allItems = initSetSelection(p);
            const segs = text.split(/\s*[,;\n+]\s*|\s+(?:і|та|и|й)\s+/giu).map((s) => s.trim()).filter(Boolean);
            const matched = [];
            for (const seg of segs) {
                const hit = matchSetItem(seg, allItems, null);
                if (hit && !matched.some((m) => m.article === hit.article)) matched.push(hit);
            }
            if (matched.length > 1 && matched.length < allItems.length) {
                const matchedArticles = new Set(matched.map((m) => m.article));
                ctx.agent.setOriginal = allItems;
                ctx.product = { ...p, setItems: p.setItems.filter((it) => matchedArticles.has(it.article)) };
                ctx.setSelection = initSetSelection(ctx.product);
                ctx.setMode = 'set';
                multiHandled = true;
            }
        }
        if (!multiHandled) {
        // Клієнт дав параметри/колір/згоду або просить змінити склад, не обравши окрему річ → хоче весь комплект
        const impliedSet = !u.setChoice && !u.setArticle && (u.height || u.weight || u.clothingSize || u.ready === 'yes' || u.changeRequest || u.colorMatched || u.color);
        if (u.setChoice === 'item' && u.setArticle) { ctx.setPick = { setChoice: 'item', article: u.setArticle }; await T.setApply(A); }
        else if (u.setChoice === 'set' || impliedSet) { ctx.setPick = { setChoice: 'set' }; await T.setApply(A); ctx.setMode = 'set'; }
        else if (isSoftDecline(u)) { A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_soft_decline_set', ctx, A.session.id)), step: 'set_ask_soft' }); return; }
        // 2026-09-15 (живий кейс, власник: «зразу наш любимий баг, 2 рази відправилось повідомлення»
        // — set1113 через хвилини після деплою): картка товару (n_welcome) для set-товарів САМА вже
        // закінчується цим самим питанням («...Підкажіть, вас цікавить весь комплект, чи окремі
        // товари з нього?» — з CRM-опису товару), тому одразу друге, окреме повідомлення з тим самим
        // питанням виглядало як збій. Той самий принцип, що вже застосований нижче для розміру
        // (A.justPresented) — тут його раніше не було.
        else if (A.justPresented && !u.questions.length) { ctx.agent.lastAsk = 'весь комплект чи окремі речі'; return; }
        else {
            ctx.agent.preNote = preNote; ctx.agent.setAskList = humanSetList(p);
            // 2026-09-17 (живий кейс, Степанович/_ilya.tishkun_: "Яка ціна товарів?" одразу ПІСЛЯ
            // того, як present() ЦИМ ЖЕ ХОДОМ показав картку set1112 — вона вже закінчується "чи
            // весь комплект, чи окремі товари?" (той самий n_welcome CRM-опис, що й вище), а сюди
            // ДОДАВАВСЯ ще один, окремий n_agent_set_ask-текст, і compose() (не знаючи, що ціни вже
            // щойно прозвучали в ЦЬОМУ Ж повідомленні — це не "історія діалогу", historia будується
            // ДО цього ходу) чесно переказав ті самі ціни СВОЇМИ словами вдруге). Коли картку щойно
            // показано — не тулимо typed n_agent_set_ask поверх (вона вже питає те саме); просто
            // даємо compose() відповісти на питання БЕЗ додаткового заклику в кінці.
            const setAsk = A.justPresented ? '' : messageTextMultiline(A.assets, 'n_agent_set_ask', ctx, A.session.id);
            A.out.push({ text: await answerThenAsk(A, u, preNote + setAsk), step: 'set_ask' });
            ctx.agent.lastAsk = 'весь комплект чи окремі речі'; return;
        }
        }
    }
    const pp = P(ctx);

    // 2026-09-18 (живий кейс, LaT1K/C0043: "можна розмірну сітку?" / "не бачу фото" / "чекаю
    // фото" — 3 РАЗИ поспіль, і жодного разу фото не пішло, хоча sizeChartRuleFor() чесно каже
    // LLM, що сітка для цього товару Є і можна сказати "надсилаю окремим фото". Причина: реальна
    // відправка (нижче, крок "4. Розмір") гейтиться ВСЕРЕДИНІ needSize-блоку — а розмір тут уже
    // порахований з першого повідомлення (зріст/вага), тож needSize=false і той код більше НІКОЛИ
    // не виконується для цього товару. LLM продовжує чесно обіцяти фото (бо URL є), а код його
    // просто не надсилає. Обробляємо повторний запит сітки ОКРЕМО від секції розміру — щоб він
    // спрацьовував і після того, як розмір уже відомий.
    // «Не бачу фото» одразу після надісланої сітки — клієнт не отримав зображення: шлемо ще раз (LLM не завжди ставить wantsSizeChart).
    if (!u.wantsSizeChart && pp.sizeChartUrl && ctx.agent.chartSentFor === pp.sku && /не\s+(бачу|відкрива\S*|завантаж\S*)\s+(фото|сітк\S*|картинк\S*|зображенн\S*)/i.test(String(A.turnText || ''))) u.wantsSizeChart = true;
    if (u.wantsSizeChart && (ctx.recommendedSize || ctx.agent.chartSentFor === pp.sku) && pp.sizeChartUrl && !A._chartSent) { // явне повторне прохання сітки — надсилаємо знову (FunnelTest 27: обіцяли «ще раз» без вкладення)
        A.out.push({ photoUrls: [pp.sizeChartUrl], caption: messageText(A.assets, 'n_agent_size_chart_caption', ctx, A.session.id), step: 'size_chart' });
        ctx.agent.chartSentFor = pp.sku; A._chartSent = true;
        if (Array.isArray(u.questions)) u.questions = u.questions.filter((q) => !/(сітк|заміри|таблиц)/i.test(String(q))); // відповідь уже пішла фото — compose не має «обіцяти» її вдруге
    }

    // 2026-09-18 (живий кейс, LaT1K/C0043: клієнт явно написав "мені потрібен M розмір
    // графітовий" ПІСЛЯ того, як система вже порахувала розмір L за зростом/вагою — але
    // ctx.recommendedSize вже стоїть, needSize=false, тож замовлення оформилось з L, яке
    // порахувала система, а НЕ з розміром, який клієнт явно назвав. compose.js навіть прямо
    // забороняє LLM озвучувати інший розмір, поки ctx.recommendedSize є — тож явний запит
    // клієнта на конкретний розмір має ПЕРЕЗАПИСУВАТИ вже порахований розмір, а не тихо
    // ігноруватись. Скидаємо порахований розмір і даємо секції "4. Розмір" порахувати заново
    // вже з явним clothingSize клієнта (він має пріоритет над зростом/вагою в T.calcSize).
    if (u.clothingSize && ctx.recommendedSize && String(u.clothingSize).toUpperCase() !== String(ctx.recommendedSize).toUpperCase()) {
        ctx.recommendedSize = null; ctx.isSetSizeCalc = false; ctx.setSizesText = ''; ctx.sizeOutOfRange = false;
        ctx.sizeInput = { ...(ctx.sizeInput || {}), clothingSize: u.clothingSize };
    }

    // 4. Розмір
    const needSize = (pp.isClothing || pp.isSet) && !ctx.recommendedSize && !ctx.isSetSizeCalc && !ctx.sizeOutOfRange;
    if (needSize) {
        // categoryParamsIsHeightWeight — БУЛЕВЕ значення з n_lookup (не рядок 'false'!). Для
        // комплекту беремо union параметрів усіх компонентів (resolveSetParams), бо сам set-товар
        // у CRM без власної категорії — його власні categoryParams завжди порожні.
        if (pp.isSet && !ctx.agent.setParams) ctx.agent.setParams = await resolveSetParams(A, pp);
        const setParams = pp.isSet ? ctx.agent.setParams : null;
        const isHW = setParams ? setParams.isOnlyHW : !!pp.categoryParamsIsHeightWeight;
        const paramsPrompt = setParams ? setParams.prompt : pp.categoryParamsPrompt;
        const si = { ...(ctx.sizeInput || {}) };
        if (u.height) si.height = u.height; if (u.weight) si.weight = u.weight;
        if (u.clothingSize) si.clothingSize = u.clothingSize; if (u.chest) si.chest = u.chest; if (u.footLength) si.footLength = u.footLength; if (u.waist) si.waist = u.waist; if (u.belly) si.belly = true;
        if (u.colorMatched && !(ctx.colorChoice && ctx.colorChoice.color)) si.color = u.colorMatched;
        if (u.alsoWants) si.alsoWants = u.alsoWants;
        const mem = ctx.customer || {};
        let usedMemory = false;
        if (isHW && !si.height && !si.weight && mem.height && mem.weight && !u.clothingSize) { si.height = mem.height; si.weight = mem.weight; usedMemory = true; }
        ctx.sizeInput = si;
        const complete = (si.height && si.weight) || si.clothingSize || si.footLength || (si.chest && pp.sizeChartData);
        if (complete) {
            await T.calcSize(A);
            await T.funnelStage(A, ...STAGES.params);
            if (ctx.sizeOutOfRange) {
                // 2026-09-18 (власник): якщо n_calc не знайшов жодної альтернативи (sizeOorAlternative
                // порожній — тобто товару в такому розмірі справді немає, а не просто "потрібно
                // уточнити"), чесна відповідь — прямо сказати, що такого розміру немає, а не
                // натякати розпливчасто "покличу менеджера, він щось підбере", коли підбирати
                // нічого. Раніше сюди йшов ЛИШЕ n_size_oor_msg (з розрахунком на sizeOorAlternative
                // в шаблоні) для обох випадків. Заразом: pause() раніше викликався БЕЗ extraDetails —
                // адмінське сповіщення показувало порожнє "💬 Клієнту вже сказано:" (менеджер не
                // бачив, що саме бот уже написав клієнту).
                const oorNode = ctx.sizeOorAlternative ? 'n_size_oor_msg' : 'n_size_oor_no_alt_msg';
                const oorText = messageText(A.assets, oorNode, ctx, A.session.id);
                A.out.push({ text: oorText, step: 'size_oor' });
                await pause(A, 'size_oor', 'n_size_oor_admin', '💬 Клієнту вже сказано: «' + oorText + '»');
                return;
            }
            // 2026-09-15 (живий кейс, власник: sizeReplyText для комплекту має переноси рядків по
            // кожній позиції, але norm() стирає ВСІ переноси в один суцільний рядок — та сама вада,
            // що вже була виправлена для картки товару (messageText/messageTextMultiline). Для
            // багаторядкового розбиття (набір рядків із \n) зберігаємо переноси; для звичайного
            // однорядкового тексту (просто товар) norm() як і раніше прибирає зайві пробіли.
            const sizeText = String(ctx.sizeReplyText || '');
            const sizeTextClean = sizeText.includes('\n') ? sizeText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : norm(sizeText);
            const reply = (usedMemory ? 'Беру ваші параметри з минулого разу (' + si.height + ' см / ' + si.weight + ' кг) 🙂 ' : '') + sizeTextClean + (ctx.sizeColorFollowup ? ' ' + norm(String(ctx.sizeColorFollowup)) : '');
            const hasColorNow = ctx.colorChoice && ctx.colorChoice.color;
            if (!hasColorNow && pp.colors) { A.out.push({ text: u.questions.length ? await answerThenAsk(A, u, reply) : reply, step: 'size_reply' }); ctx.agent.lastAsk = 'колір'; return; }
            A.out.push({ text: u.questions.length ? await answerThenAsk(A, u, reply) : reply, step: 'size_reply' });
        } else if (isSoftDecline(u)) {
            // Живий кейс 2026-09-14 (Володимир): «Но я просто цікавлюсь цінами», «Поки не потрібно» —
            // бот тричі поспіль повторив те саме питання про зріст/вагу. Тут — рівно ОДНЕ мʼяке
            // речення без тиску, без повторення прохання; наступний реальний сигнал (параметри,
          // питання) обробиться як завжди.
            A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_soft_decline_size', ctx, A.session.id)), step: 'size_postpone' });
            return;
        } else {
            // 2026-09-22 (живий кейс bf149a35: "два рази написало" — фото сітки з підписом "Ось
            // розмірна сітка" ПЛЮС окремий текст "Звісно, надсилаю розмірну сітку окремим фото"
            // ПЛЮС ще прохання зросту/ваги — три висловлювання про те саме поспіль). Корінь:
            // питання клієнта "можна сітку?" все одно йшло в answerThenAsk → compose(), а
            // compose() чесно "відповідає" на нього своїми словами, не знаючи, що відповідь
            // (фото з підписом) вже щойно пішла окремим виходом цього ж ходу. Той самий принцип,
            // що вже застосований для A.justPresented: якщо відповідь ВЖЕ дана (тут — фото),
            // не даємо compose() дублювати її текстом.
            const chartJustSent = !!(u.wantsSizeChart && pp.sizeChartUrl && !A._chartSent);
            if (chartJustSent) { A._chartSent = true; A.out.push({ photoUrls: [pp.sizeChartUrl], caption: messageText(A.assets, 'n_agent_size_chart_caption', ctx, A.session.id), step: 'size_chart' }); ctx.agent.chartSentFor = pp.sku; }
            let colorNote = '';
            if (u.color && !u.colorMatched && colorsOf(pp)) { ctx.agent.wantColorRaw = u.color; colorNote = messageText(A.assets, 'n_agent_color_note_mismatch', ctx, A.session.id) + ' '; }
            else if (u.colorMatched) { ctx.agent.colorMatchedNote = u.colorMatched; colorNote = messageText(A.assets, 'n_agent_color_note_matched', ctx, A.session.id) + ' '; }
            // Живий кейс 2026-09-14 (Устим, Юлія): картка товару (n_welcome) сама ЗАКІНЧУЄТЬСЯ проханням
            // дати зріст/вагу — одразу після свіжої презентації друге, окреме повідомлення з тим самим
            // проханням виглядало як збій («два рази ціну написав», «два рази питає»). Якщо картку щойно
            // показано і клієнту більше нічого відповісти (нема питання, нема сигналу кольору) — просто
            // чекаємо, не питаємо вдруге.
            if (A.justPresented && !u.questions.length && !colorNote) { ctx.agent.lastAsk = paramsPrompt || 'зріст і вага'; return; }
            const missing = isHW ? (si.height && !si.weight ? 'вагу' : (!si.height && si.weight ? 'зріст' : '')) : '';
            let ask = '';
            if (!A.justPresented) {
                if (isHW) { ctx.agent.missingParam = missing; ask = missing ? messageText(A.assets, 'n_agent_ask_size_missing', ctx, A.session.id) : messageText(A.assets, 'n_agent_ask_size_both', ctx, A.session.id); }
                else { ctx.agent.paramsPromptText = paramsPrompt || 'ваш розмір'; ask = messageText(A.assets, 'n_agent_ask_size_custom', ctx, A.session.id); }
            }
            // Повторне прохання тих самих параметрів (клієнт відповідає про інше) — інакше звучить як збій
            // (інваріант I2: дослівний повтор); перефразовуємо й лишаємо коротко.
            ctx.agent.paramsAskCount = (ctx.agent.paramsAskCount || 0) + 1;
            if (ask && ctx.agent.paramsAskCount > 1 && ctx.agent.lastAsk === (paramsPrompt || 'зріст і вага')) ask = (ctx.agent.paramsAskCount % 2 ? 'Щоб підібрати розмір, лишилось дізнатись зріст і вагу 🙂 Напишіть, будь ласка, скільки у вас — і одразу рухаємось далі.' : 'Мені ще потрібні зріст і вага для підбору розміру 📏 Напишіть їх, будь ласка 🙂');
            A.out.push({ text: chartJustSent ? (preNote + colorNote + ask) : await answerThenAsk(A, u, preNote + colorNote + ask), step: 'ask_params' }); ctx.agent.lastAsk = paramsPrompt || 'зріст і вага';
            return;
        }
    }

    // 5. Колір
    // 2026-09-18 (живий кейс, Oleksii Oleksii: "2 кофти по акції" + "Графітовий і світло сірий" /
    // "Давайте графітовий та світло-сірий" / "Графітовий та світло сіру" — бот перепитував колір
    // 7 РАЗІВ поспіль, ігноруючи, що клієнт щоразу чітко називав ОБИДВА кольори): understand()
    // вже виконує власне правило "хоче ОБИДВА кольори одразу — це units, не colorMatched", але ЦЯ
    // секція перевіряла ЛИШЕ colorMatched/color (одиничний вибір) — u.units для кількох різних
    // кольорів на кілька штук того самого товару НІКОЛИ тут не перевірявся, тож гейт "колір ще не
    // обрано" не знімався, і секція щоразу питала generic-питання про ОДИН колір заново.
    const colorResolved = !!(ctx.colorChoice && (ctx.colorChoice.color || (Array.isArray(ctx.colorChoice.colors) && ctx.colorChoice.colors.length)));
    if (pp.colors && !colorResolved && u.units && u.units.length > 1) {
        const matchedColors = u.units.map((x) => matchColor(pp, x.color) || matchColor(pp, x.colorMatched)).filter(Boolean);
        if (matchedColors.length === u.units.length) ctx.colorChoice = { colors: matchedColors, qty: u.qty || u.units.length };
    }
    if (pp.colors && !(ctx.colorChoice && (ctx.colorChoice.color || (Array.isArray(ctx.colorChoice.colors) && ctx.colorChoice.colors.length)))) {
        const c = u.colorMatched || matchColor(pp, u.color) || (ctx.sizeInput && ctx.sizeInput.color) || matchColor(pp, ctx.agent.pendingColor) || matchColor(pp, ctx.agent.pendingColorRaw) || null;
        if (c) { ctx.colorChoice = { color: c, qty: u.qty || undefined }; delete ctx.agent.pendingColor; delete ctx.agent.pendingColorRaw; }
        else if (ctx.agent.softColorCount > 0 && /^\s*(ок|окей|окей\.|добре|добре\.|гуд|ясно|зрозуміло|угу|ага|👍|🙏|ok|okay)[\s.!]*$/iu.test(String(text))) {
            // «Окей» після м'якого закриття — без повторного питання про колір.
            A.out.push({ text: (['👌', 'Домовились 🙂', 'Добре 💛'])[(ctx.agent.softColorCount || 0) % 3], step: 'ack_after_soft' }); ctx.agent.lastAsk = 'колір'; return;
        }
        else if (isSoftDecline(u) || u.intent === 'thanks') {
            ctx.agent.softColorCount = (ctx.agent.softColorCount || 0) + 1;
            const softTxt = ctx.agent.softColorCount > 1 ? (['Звісно 🙂 Я на звʼязку — напишіть, коли оберете колір.', 'Без проблем 💛 Щойно визначитесь із кольором — одразу продовжимо.'][ctx.agent.softColorCount % 2]) : await answerThenAsk(A, u, messageText(A.assets, 'n_agent_soft_decline_color', ctx, A.session.id));
            A.out.push({ text: softTxt, step: 'ask_color_soft' }); return;
        }
        else {
            ctx.agent.wantColor = u.color || '';
            const ask = u.color ? messageText(A.assets, 'n_agent_ask_color_specific', ctx, A.session.id) : messageText(A.assets, 'n_agent_ask_color_generic', ctx, A.session.id);
            ctx.agent.colorAskCount = (ctx.agent.colorAskCount || 0) + 1;
            const askVar = (ctx.agent.colorAskCount > 1 && ctx.agent.lastAsk === 'колір') ? (['Нагадаю: лишилось обрати колір 🎨 ', 'Ще раз про колір 🎨 ', 'Лишилось лише обрати колір 🎨 '][ctx.agent.colorAskCount % 3] + ask) : ask;
            // Клієнт ставить уточнювальні питання про колір (зразок, відтінок) — після 2-го підряд питання лише відповідаємо, не тиснемо повтором.
            const answerOnly = u.questions.length && ctx.agent.colorAskCount > 2 && ctx.agent.lastAsk === 'колір';
            A.out.push({ text: await answerThenAsk(A, u, answerOnly ? '' : preNote + askVar), step: 'ask_color' }); ctx.agent.lastAsk = 'колір'; return;
        }
    }

    // 5c. Корекція кольору ПІСЛЯ того, як він уже обраний (Б2/Б4, архітектурний аудит
    // product-recognition 2026-09-22): секція 5 вище свідомо НЕ займає colorChoice, якщо він
    // вже є — пізніша згадка кольору раніше просто ІГНОРУВАЛАСЬ (клієнт передумав, "не чорний,
    // а графітовий") або десь нижче (перевірка доступності, гілка u.units) перезаписувалась
    // БЕЗУМОВНО незалежно від релевантності. Тут — звіряємо слово-колір проти РЕАЛЬНОЇ палітри
    // активного товару тим самим matchColor(), що й секція 5, перш ніж або застосувати як
    // корекцію, або (не збіглось НІ З ЧИМ відомим — може, це вже про інший товар) чесно
    // перепитати, а не мовчки ігнорувати чи вгадувати. Multi-unit (кілька кольорів одразу) —
    // окремий, складніший випадок, свідомо поза межами цього фіксу.
    if (pp.colors && ctx.colorChoice && ctx.colorChoice.color && !Array.isArray(ctx.colorChoice.colors) && (u.color || u.colorMatched)) {
        const corrected = matchColor(pp, u.colorMatched || u.color);
        if (corrected && corrected !== ctx.colorChoice.color) {
            ctx.colorChoice = { color: corrected, qty: ctx.colorChoice.qty };
        } else if (!corrected) {
            const elsewhere = resolveColorMention(ctx, u.colorMatched || u.color);
            if (!elsewhere) {
                A.out.push({ text: await answerThenAsk(A, u, 'Уточніть, будь ласка — це колір для «' + (pp.customerName || pp.name || 'товару') + '», чи ви питаєте про щось інше? 😊'), step: 'ask_color_clarify' });
                return;
            }
            // elsewhere.target !== 'main' (допродаж/компонент сету) — свідомо не займаємо тут,
            // відповідні секції нижче обробляють свій колір самостійно (повне зведення в TODO).
        }
    }

    // 5b. Комплект цілком: склад — редагований список (ctx.setSelection), не фіксований набір.
    // «Без взуття» / «додайте джинси» / «дві футболки» перераховують склад і суму одразу, без
    // приміток менеджеру (рішення власника 2026-09-14) — доки замовлення ще не в CRM.
    if (pp.isSet && ctx.setMode === 'set') {
        if (!Array.isArray(ctx.setSelection)) {
            ctx.agent.setOriginal = initSetSelection(pp);
            ctx.setSelection = initSetSelection(pp);
            applySetPricing(ctx, pp);
            if (!ctx.agent.setStageSent) { await T.funnelStage(A, ...STAGES.color); ctx.agent.setStageSent = true; }
        } else if (!ctx.agent.setPricing) {
            // Часткова вибірка з розділу 3 («лише кофта і джинси») створює setSelection одразу, тож
            // гілка вище не виконувалась і ціна не рахувалась: падіння policy (setPricing undefined)
            // та «решта −200 грн» (FunnelTest 4).
            applySetPricing(ctx, pp);
            if (!ctx.agent.setStageSent) { await T.funnelStage(A, ...STAGES.color); ctx.agent.setStageSent = true; }
        }
        // 2026-09-15 (власник: "якого кольору джинси ми тепер оформимо?"): раніше колір позицій
        // комплекту НІКОЛИ не резолвився й не питався — замовлення йшло з порожнім кольором для
        // багатоколірних позицій. Однокольорові підтягуються автоматично (нема сенсу питати);
        // клієнт МІГ уже назвати колір(и) прямо в цьому повідомленні ("джинси сині, кофта чорна")
        // — розбираємо по позиціях тим самим matchSetItem/matchColor, що вже є для applySetEdit;
        // лишається неоднозначність — питаємо ОДНИМ повідомленням саме ці позиції, не всі одразу.
        // 2026-09-24 (аудит постачальників): позиції комплекту з власною сіткою (джинси — талія, футболка, взуття), яких n_calc
        // не підібрав за зростом/вагою, лишались з порожнім size — замовлення й постачальник отримували позицію без розміру.
        // Спершу беремо розмір із тексту клієнта («джинси 32, лофери 43»), інакше питаємо один раз списком.
        if (!ctx.crmOrderId && !ctx.agent.setSizesAsked2) {
            const sizeName = (x) => String((x && (x.name || x.size || x.value)) || x || '').trim();
            const escRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const segsS = text.split(/[,;\n]|\s+(?:і|та|и|й)\s+/iu).map((x) => x.trim()).filter(Boolean);
            for (const seg of segsS) {
                const item = matchSetItem(seg, ctx.setSelection, ctx.agent.setParams && ctx.agent.setParams.categoryNames);
                if (!item || item.size || !Array.isArray(item.sizes)) continue;
                const hit = item.sizes.map(sizeName).find((sz) => sz && new RegExp('(^|[^0-9A-Za-z])' + escRe(sz) + '($|[^0-9A-Za-z])', 'i').test(seg));
                if (hit) item.size = hit;
            }
            // Позиція комплекту без списку розмірів у CRM (джинси): беремо його з рядка «Розміри:» опису самого товару в каталозі.
            if (ctx.setSelection.some((it) => !it.size && (!Array.isArray(it.sizes) || !it.sizes.length))) {
                try {
                    const catS = await loadCatalog(A.botId, A.keys);
                    for (const it of ctx.setSelection) {
                        if (it.size || (Array.isArray(it.sizes) && it.sizes.length)) continue;
                        const cp = catS.products.find((x) => String(x.sku).toUpperCase() === String(it.article).toUpperCase());
                        const line = cp && (String(cp.desc || '').match(/Розміри:\s*([^\n]+)/i) || [])[1];
                        const list = line ? line.split(/[,;]+/).map((z) => z.trim()).filter(Boolean) : [];
                        if (list.length > 1) it.sizes = list;
                    }
                } catch (e) { /* best-effort */ }
            }
            const needSz = ctx.setSelection.filter((it) => !it.size && Array.isArray(it.sizes) && it.sizes.length > 1 && !(ctx.setSizeMap && ctx.setSizeMap[it.article]));
            if (needSz.length) {
                ctx.agent.setSizeAskCount = (ctx.agent.setSizeAskCount || 0) + 1;
                if (ctx.agent.setSizeAskCount <= 2) {
                    const lines = needSz.map((it) => '📏 ' + it.name + '\nДоступні розміри: ' + it.sizes.map(sizeName).join(', ')).join('\n\n');
                    A.out.push({ text: (ctx.agent.setSizeAskCount > 1 ? 'Нагадаю: лишилось обрати розмір 🙂\n\n' : 'Підкажіть, будь ласка, розмір для решти позицій 🙂\n\n') + lines, step: 'set_size_ask' });
                    ctx.agent.lastAsk = 'розміри позицій комплекту'; applySetPricing(ctx, pp); return;
                }
                ctx.agent.setSizesAsked2 = true;
            }
        }
        if (!ctx.agent.setColorsResolved) {
            const catNamesSet = ctx.agent.setParams && ctx.agent.setParams.categoryNames;
            const segments = [...(ctx.agent.setColorHints || []), text].flatMap((tx) => String(tx).split(/[,;\n]|\s+(?:і|та|и|й)\s+/iu)).map((s) => s.trim()).filter(Boolean);
            for (const seg of segments) {
                const item = matchSetItem(seg, ctx.setSelection, catNamesSet);
                if (item && !item.color && Array.isArray(item.colors) && item.colors.length) {
                    const c = matchColor({ colors: item.colors.join(',') }, seg) || matchColorByPosition(item, seg);
                    if (c) item.color = c;
                }
            }
            for (const it of ctx.setSelection) { if (!it.color && Array.isArray(it.colors) && it.colors.length === 1) it.color = it.colors[0]; }
            // 2026-09-15 (живий кейс, власник: "як я чорний написав... а воно не поняло, це баг") —
            // коли лишилась РІВНО ОДНА багатоколірна позиція без кольору (типова ситуація: щойно
            // самі спитали про НЕЇ), відповідь могла бути ГОЛИМ кольором чи номером БЕЗ назви
            // товару ("Чорні", "2") — matchSetItem вище нічого не знайде (нема назви товару в
            // тексті), тому пробуємо весь текст ходу напряму проти кольорів ЄДИНОЇ позиції, що
            // очікує відповіді.
            // 2026-09-15 (живий кейс, власник: "1, 2" на ДВІ позиції одразу — джинси й футболка;
            // "не пропрацював варіант, що товарів 2... відправляй окремими повідомленнями, чекаючи
            // відповіді") — номер сам по собі неоднозначний, коли одночасно чекаємо відповідь про
            // ДВІ+ позиції ("1" — це перший колір джинсів чи перший колір футболки?). Замість
            // крихкого парсингу "хто є хто" в одній відповіді — питаємо РІВНО ПРО ОДНУ позицію за
            // раз і запам'ятовуємо, про яку САМЕ (setColorAskingArticle) — голий колір/номер у
            // відповіді застосовується до ЦІЄЇ позиції, а не до "єдиної, що лишилась" (їх могло
            // лишитись і кілька — ми просто запитали про них по черзі).
            const askingArticle = ctx.agent.setColorAskingArticle;
            const askingItem = askingArticle ? ctx.setSelection.find((it) => it.article === askingArticle && !it.color && Array.isArray(it.colors) && it.colors.length > 1) : null;
            if (askingItem) {
                const c = matchColor({ colors: askingItem.colors.join(',') }, text) || matchColorByPosition(askingItem, text);
                if (c) askingItem.color = c;
            }
            const ambiguous = ctx.setSelection.filter((it) => !it.color && Array.isArray(it.colors) && it.colors.length > 1);
            if (ambiguous.length) {
                const askItem = ambiguous[0];
                ctx.agent.setColorAskingArticle = askItem.article;
                // 2026-09-15 (власник: "додай нормальне форматування, абзаци, смайлики", потім
                // "додай нумерування... щоб людина могла цифру написати") — нумерований список
                // кольорів (той самий порядок, що читає matchColorByPosition) саме ЦІЄЇ позиції.
                ctx.agent.setColorAskList = '🎨 ' + askItem.name + '\nДоступні кольори:\n' + askItem.colors.map((c, i) => (i + 1) + '. ' + c).join('\n');
                // 2026-09-15 (власник: "де 'виберіть колір' треба обов'язково скидати фото цих
                // кольорів") — фото офера кожного доступного кольору ЦІЄЇ позиції (n_lookup вже
                // підвантажує colorPhotos для set-компонентів), альбомом ПЕРЕД текстом питання.
                const colorPhotoUrls = askItem.colors.map((c) => askItem.colorPhotos && askItem.colorPhotos[c]).filter(Boolean);
                // фото кольорів — один раз на позицію, не при кожному нагадуванні
                if (colorPhotoUrls.length && ctx.agent.setColorPhotosFor !== askItem.article) { A.out.push({ photoUrls: colorPhotoUrls.slice(0, 10), caption: '', step: 'set_color_ask_photos' }); ctx.agent.setColorPhotosFor = askItem.article; }
                ctx.agent.setColorAskCount = (ctx.agent.setColorAskCount || 0) + 1;
                const _repeatSet = ctx.agent.setColorAskCount > 1 && ctx.agent.lastAsk === 'колір позицій комплекту';
                const _nm = String(askItem.name).split('\n')[0];
                const _shortSet = _repeatSet && ctx.agent.setColorAskCount > 2 ? ['Ще лишилось обрати колір для «' + _nm + '» 🙂 Напишіть назву або номер зі списку вище.', 'Коли визначитесь із кольором для «' + _nm + '» — напишіть номер чи назву, і оформлюємо 💛'][ctx.agent.setColorAskCount % 2] : '';
                A.out.push({ text: await answerThenAsk(A, u, _shortSet || ((_repeatSet ? 'Нагадаю, лишилось обрати колір 🙂\n\n' : '') + messageTextMultiline(A.assets, 'n_agent_set_color_ask', ctx, A.session.id))), step: 'set_color_ask' });
                ctx.agent.lastAsk = 'колір позицій комплекту';
                return;
            }
            ctx.agent.setColorsResolved = true; applySetPricing(ctx, pp); // кольори позицій вже відомі — переносимо їх у extraItems (для CRM і постачальника)
        }
        if (!ctx.crmOrderId && (u.removeItem || u.addItem || u.changeRequest)) {
            const edited = await applySetEdit(A, u, pp);
            if (edited) {
                const lines = ctx.setSelection.map((it) => it.name + (it.color ? ' (' + it.color + ')' : '') + (it.qty > 1 ? ' ×' + it.qty : '') + ' — ' + (it.price * it.qty) + ' грн').join('\n');
                const total = ctx.agent.setPricing.total;
                const wasReady = ctx.orderIntent && ctx.orderIntent.ready === 'yes';
                if (wasReady) ctx.orderIntent.ready = null; // змінений склад — підтверджуємо ще раз
                ctx.agent.setLines = lines; ctx.agent.setTotal = total;
                ctx.agent.setEditQuestion = ctx.setSelection.length ? 'Оформляємо так? 🙂' : 'Комплект лишився без жодної позиції — що додати?';
                A.out.push({ text: messageTextMultiline(A.assets, 'n_agent_set_edit_confirm', ctx, A.session.id), step: 'set_edit' });
                ctx.agent.lastAsk = 'оформляємо?'; ctx.agent.setEditNote = '';
                return;
            } else if (ctx.agent.setEditNote) {
                A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_set_edit_unclear', ctx, A.session.id)), step: 'set_edit_unclear' });
                return;
            }
        }
    }

    // 6. Наявність
    const availKey = (ctx.colorChoice && ctx.colorChoice.color) + '|' + ctx.recommendedSize + '|' + (u.units ? JSON.stringify(u.units) : '');
    if (ctx.agent.availKey !== availKey && !(pp.isSet && ctx.setMode === 'set')) {
        if (u.units && u.units.length) ctx.colorChoice = { ...(ctx.colorChoice || {}), colors: u.units.map((x) => x.color).filter(Boolean), qty: u.qty || u.units.length };
        await T.checkAvail(A); ctx.agent.availKey = availKey;
        if (ctx.available === false) {
            if (ctx.availReason === 'no_stock') { A.out.push({ text: messageText(A.assets, 'n_avail_stock_msg', ctx, A.session.id), step: 'no_stock' }); await pause(A, 'no_stock', 'n_avail_stock_admin'); return; }
            A.out.push({ text: messageText(A.assets, 'n_avail_no', ctx, A.session.id), step: 'color_unavailable' }); ctx.colorChoice = null; ctx.agent.lastAsk = 'інший колір'; return;
        }
        await T.funnelStage(A, ...STAGES.color);
    }

    // 7. Підсумок і згода
    if (!(ctx.orderIntent && ctx.orderIntent.ready === 'yes')) {
        // 2026-09-22 (архітектурний аудит product-recognition, Д1-Д4): раніше "інший товар
        // мимохідь" розпізнавався ЛИШЕ через u.extraProducts/u.alsoWants (окреме LLM-поле
        // understand.js). resolveShoppingIntent.js тепер додає ще один, детермінований шлях —
        // фото/артикул ІНШОГО товару зі словом-зв'язкою "і ще"/"також" (ADD_EXTRA-рішення
        // reconcile()) — ставить ctx.extraProductMention НАПРЯМУ. Той самий T.extraResolve()
        // (уже перевірений, реально резолвить у офер/ціну), просто ще одне джерело сигналу.
        // «2,4»: відповідь клієнта на нагадування про другий обраний варіант.
        if (ctx.agent.pendingSecondPick && ctx.agent.secondPickAsked) {
            if (/^(так|да|ага|додайте|додай|давайте|обидва|обидві|і другий|плюс)(?=[\s,.!]|$)/iu.test(text.trim()) || u.addUpsell === true) { ctx.extraProductMention = ctx.agent.pendingSecondPick; delete ctx.agent.pendingSecondPick; delete ctx.agent.secondPickAsked; }
            else if (/(лише|тільки)\s+(перш|основн)|без\s+нього|не\s+треба|не\s+потрібн|^ні(?=[\s,.!]|$)/iu.test(text.trim())) { delete ctx.agent.pendingSecondPick; delete ctx.agent.secondPickAsked; }
        }
        if ((u.extraProducts || u.alsoWants || ctx.extraProductMention) && !(pp.isSet && ctx.setMode === 'set')) {
            if (!ctx.extraProductMention) ctx.extraProductMention = u.extraProducts || u.alsoWants;
            await T.extraResolve(A);
        }
        // 7a (перенесено вище підсумку, щоб колір потрапляв у нього). Колір ДОДАТКОВОГО товару («і ще футболку» → extraItems), названий пізніше: «футболка біла».
        if (!ctx.crmOrderId && Array.isArray(ctx.extraItems) && ctx.extraItems.length) {
            const segsX = text.split(/[,;\n]|\s+(?:і|та|и|й)\s+/iu).map((x) => x.trim()).filter(Boolean);
            for (const it of ctx.extraItems) {
                if (it.color || !Array.isArray(it.colorsList) || !it.colorsList.length) continue;
                for (const seg of segsX) {
                    if (!stemsOf(it.name).some((st) => seg.toLowerCase().includes(st))) continue;
                    const c = matchColor({ colors: it.colorsList.join(',') }, seg);
                    if (c) { it.color = c; if (ctx.extraItemsText) ctx.extraItemsText = String(ctx.extraItemsText).split('\n').map((ln) => (stemsOf(it.name).some((st) => ln.toLowerCase().includes(st)) ? ln.replace(/КОЛІР НЕ ОБРАНО \(є:[^)]*\)/, 'колір: ' + c) : ln)).join('\n'); break; }
                }
            }
        }

        // 2026-09-15 (живий кейс, власник: "бот не поняв, які я хочу футболки, це баг") — відповідь
        // САМЕ на наше запитання n_agent_upsell_clarify ("з допродажем чи без") могла бути ГОЛИМ
        // кольором+кількістю ("Чорні, 2") без слова "так" — u.ready лишався не 'yes', тому вся
        // гілка нижче ігнорувалась і бот по колу показував той самий підсумок+запит. Раз ми САМІ
        // щойно поставили це запитання (lastAsk) — будь-яка змістовна відповідь тут і є згода з
        // допродажем; явну відмову розпізнаємо окремо, щоб "ні" саме на ЦЕ питання не читалось як
        // відмова від усього замовлення (яким воно було раніше).
        const answeringUpsellClarify = ctx.agent.lastAsk === 'з допродажем чи без';
        const upsellExplicitNo = answeringUpsellClarify && (u.addUpsell === false || u.ready === 'no' || /^(ні|нєт|без нього|без допродаж|не треба|не потрібно)\b/iu.test(text.trim()));
        // 2026-09-15: LLM теж міг не витягнути кількість із голої відповіді ("Чорні, 2") — рахунок
        // штук тут детермінований (n_crm_order і так вважає upsellQty фолбеком до 1, якщо порожньо).
        const upsellQtyFallback = (() => { if (!answeringUpsellClarify || upsellExplicitNo) return undefined; const m = text.match(/(\d+)\s*(шт|штук|пар)?/iu); return m ? Number(m[1]) : undefined; })();
        if (u.ready === 'no' && !answeringUpsellClarify) { A.out.push({ text: messageText(A.assets, 'n_declined_msg', ctx, A.session.id), step: 'declined' }); ctx.declinedAt = Date.now(); ctx.agent.lastAsk = ''; return; }
        const gaveAddress = !!(u.phone || u.city || u.branch || u.fullName);
        if (u.ready === 'yes' || gaveAddress || u.payMethod || answeringUpsellClarify) {
            const addUpsellFinal = answeringUpsellClarify ? !upsellExplicitNo : !!u.addUpsell;
            ctx.orderIntent = { ready: 'yes', addUpsell: addUpsellFinal, upsellQty: u.upsellQty || upsellQtyFallback || undefined, upsellNote: u.upsellNote || (answeringUpsellClarify && addUpsellFinal ? text : undefined), upsellUnits: u.upsellUnits || undefined, units: u.units || undefined, qty: u.qty || undefined, extras: undefined, extraProducts: undefined };
            fillUpsellSize(ctx);
            if (gaveAddress) { ctx.orderIntent.prefill = { fullName: u.fullName || undefined, phone: u.phone || undefined, city: u.city || undefined, branch: u.branch || undefined, region: u.region || undefined }; await T.orderPrefill(A); }
            if (pp.upsell && u.addUpsell == null && u.ready === 'yes' && ctx.agent.upsellOffered && !u.upsellNote && !gaveAddress && !u.payMethod && !answeringUpsellClarify) {
                // згода без відповіді на допродаж — одне уточнення
                ctx.orderIntent = null;
                ctx.agent.productDisplayName = pp.customerName || pp.name;
                A.out.push({ text: messageText(A.assets, 'n_agent_upsell_clarify', ctx, A.session.id), step: 'upsell_clarify' }); ctx.agent.lastAsk = 'з допродажем чи без'; return;
            }
        } else {
            // підсумок + «Оформляємо?»
            const isSetFull = pp.isSet && ctx.setMode === 'set';
            const total = isSetFull ? ctx.agent.setPricing.total : (ctx.orderUnitsTotal || pp.price);
            if (pp.upsellPhotoUrl && !isSetFull && !ctx.agent.upsellPhotoSent) { A.out.push({ photoUrls: [pp.upsellPhotoUrl], caption: '', step: 'upsell_photo' }); ctx.agent.upsellPhotoSent = true; }
            // Підсумок — ДЕТЕРМІНОВАНО (розмір/колір/сума з інструментів, LLM їх не перераховує); LLM лише
            // відповідає на питання клієнта перед підсумком або мʼяко працює з ваганням.
            // 2026-09-15 (живий кейс, власник: "форматування не застосувалось") — список позицій
            // комплекту йшов одним суцільним рядком через кому; тепер, як і скрізь для комплекту
            // (set_edit_confirm, humanSetList), кожна позиція на своєму рядку з буллетом.
            const summary = isSetFull
                ? messageText(A.assets, 'n_agent_order_summary_header', ctx, A.session.id) + '\n' + (pp.customerName || pp.name) + '\n\n' + ctx.setSelection.map((it) => '• ' + it.name + (it.color ? ' (' + it.color + ')' : '') + (it.qty > 1 ? ' ×' + it.qty : '') + ' — ' + (it.price * it.qty) + ' грн').join('\n') + '\n\nРазом: ' + total + ' грн' + '\n' + shipTerms(ctx)
                : (() => { const units = ctx.orderUnitsText || ((ctx.colorChoice && ctx.colorChoice.color ? ctx.colorChoice.color : '') + (ctx.recommendedSize ? ' ' + ctx.recommendedSize : '')); return messageText(A.assets, 'n_agent_order_summary_header', ctx, A.session.id) + '\n' + (pp.customerName || pp.name) + (units ? ' — ' + units : '') + ' — ' + total + ' грн' + (ctx.extraItemsText ? '\n' + ctx.extraItemsText : '') + '\n' + shipTerms(ctx); })();
            // Допродаж уже доданий клієнтом як додатковий товар («і ще футболку») — не пропонуємо його вдруге.
            const upItem = Array.isArray(pp.upsellItems) && pp.upsellItems[0];
            const upsellAlreadyExtra = !!(pp.upsell && upItem && Array.isArray(ctx.extraItems) && ctx.extraItems.some((x) => x && ((x.id && x.id === upItem.id) || (x.sku && upItem.sku && x.sku === upItem.sku))));
            const askLine = (!isSetFull && pp.upsell && !upsellAlreadyExtra && !(ctx.agent.pendingSecondPick && !ctx.agent.secondPickAsked)) ? messageText(A.assets, 'n_agent_order_ask_upsell', ctx, A.session.id) : messageText(A.assets, 'n_agent_order_ask_plain', ctx, A.session.id);
            if (!isSetFull && pp.upsell && !upsellAlreadyExtra && !(ctx.agent.pendingSecondPick && !ctx.agent.secondPickAsked)) ctx.agent.upsellOffered = true;
            const hesitating = (u.intent === 'hesitate' || u.intent === 'postpone');
            // «2,4»: другий обраний варіант нагадуємо один раз у підсумку (відповідь ловить блок перед extraResolve).
            let secondPickLine = '';
            if (ctx.agent.pendingSecondPick && !ctx.agent.secondPickAsked) { ctx.agent.secondPickAsked = true; secondPickLine = '\n\nВи також обирали другий варіант (арт. ' + ctx.agent.pendingSecondPick + ') — додати його окремою позицією чи лише основний? 🙂'; }
            let txt = summary + '\n\n' + askLine + secondPickLine;
            if (ctx.agent.lastAsk === 'оформляємо?' && !u.questions.length && !hesitating) {
                // «Оформляємо?» уже питали, клієнт написав щось без рішення — коротка реакція + те саме питання, без повторного підсумку
                txt = (await compose(A, { ack: 'відреагуй одним реченням на репліку клієнта (нічого не обіцяй і не змінюй склад замовлення сама)', nextStep: 'і спитай: «' + askLine + '»', maxSentences: 2, fallback: askLine })).text;
                A.out.push({ text: txt, step: 'order_intent_repeat' }); return;
            }
            if (u.questions.length || hesitating) {
                A._questionEngaged = true;
                const { text: pre, resolved: preResolved } = await compose(A, { questions: u.questions, nextStep: hesitating ? 'клієнт вагається — без тиску наведи ОДИН реальний аргумент оформити сьогодні (раніше отримає, черга на відправку) і заверши питанням «Оформляємо сьогодні?»' : 'заверши коротким переходом до підсумку (без самого підсумку — його додасть система)', maxSentences: 3, fallback: '' });
                if (!preResolved && u.questions.length) await escalateUnresolved(A, u.questions[0]);
                // підсумок уже показано — не повторюємо картку з ціною після кожного питання (FunnelTest 43)
                txt = (pre ? pre + '\n\n' : '') + (hesitating ? summary : (ctx.agent.lastAsk === 'оформляємо?' && pre ? messageText(A.assets, 'n_agent_order_ask_plain', ctx, A.session.id) : txt));
            }
            A.out.push({ text: txt, step: 'order_intent' });
            ctx.agent.lastAsk = 'оформляємо?'; return;
        }
    }

    // 7a2. Відмова від допродажу ПІСЛЯ підсумку («Лише основний товар» уже на етапі оплати) — прибираємо його з
    //      замовлення й перераховуємо суму (FunnelTest 20: «решта 2798» рахувалась із відхиленою футболкою).
    if (ctx.orderIntent && ctx.orderIntent.addUpsell && u.addUpsell === false && !ctx.crmOrderId) {
        ctx.orderIntent.addUpsell = false; ctx.orderIntent.upsellUnits = undefined; ctx.orderIntent.upsellQty = undefined; ctx.orderIntent.upsellNote = undefined;
        if (ctx.paymentInfo && ctx.paymentInfo.method) { ctx.orderRef = ''; await T.payAmount(A); await sendRequisites(A, u); return; }
    }

    // 7b. Колір/кількість допродажу, названі ПІЗНІШЕ за підсумок (FunnelTest 9: бот спитав спосіб
    //     оплати, клієнт відповів «одна біла і одна чорна футболка» — orderIntent уже був
    //     зафіксований без цих даних, вони губились, і в замовленні лишалась 1 футболка без кольору).
    if (ctx.orderIntent && ctx.orderIntent.addUpsell && !ctx.crmOrderId && (u.upsellUnits || u.upsellQty || u.upsellNote)) {
        const oi = ctx.orderIntent;
        if (u.upsellUnits) oi.upsellUnits = u.upsellUnits;
        fillUpsellSize(ctx);
        if (u.upsellQty) oi.upsellQty = u.upsellQty;
        if (u.upsellNote) oi.upsellNote = u.upsellNote;
        if (ctx.paymentInfo && ctx.paymentInfo.method) { ctx.orderRef = ''; await T.payAmount(A); await sendRequisites(A, u); return; }
    }

    // 7c. Адресна доставка Новою Поштою (рішення власника 2026-09-23: вона існує, але дуже рідкісна —
    //     система не ігнорує «привезіть додому» і не трактує як відділення мовчки, а перепитує, чи
    //     правильно зрозуміла; після підтвердження передає менеджеру, який уточнює умови й оформлює).
    if (!ctx.crmOrderId) {
        const odH = ctx.orderData || {};
        if (ctx.agent.lastAsk === 'адресна доставка Новою Поштою?') {
            const yes = u.ready === 'yes' || /^\s*(так|да|ага|угу|вірно|правильно|саме\s+так|підтверджую)/i.test(text);
            if (yes && !u.branch) {
                await pause(A, 'home_delivery', 'n_agent_post_extra_admin', '🏠 Клієнт підтвердив АДРЕСНУ доставку Новою Поштою: «' + String(ctx.agent.homeAddressRaw || '').slice(0, 300) + '». Потрібно уточнити умови й оформити вручну.');
                A.out.push({ text: 'Дякую, підтвердили 🙏 Адресну доставку Новою Поштою уточнить і оформить менеджер — напише вам тут найближчим часом 💛', step: 'home_delivery_handoff' });
                ctx.agent.lastAsk = '';
                return;
            }
        } else if (u.homeAddress && !u.branch && !odH.branch) {
            ctx.agent.homeAddressRaw = text;
            A.out.push({ text: await answerThenAsk(A, u, 'Правильно розумію, що вам потрібна адресна доставка Новою Поштою за вказаною адресою (не у відділення)? Якщо так — напишіть «так», а якщо зручніше у відділення чи поштомат — надішліть його номер 🙂'), step: 'home_delivery_confirm' });
            ctx.agent.lastAsk = 'адресна доставка Новою Поштою?';
            return;
        }
    }

    // 8. Спосіб оплати (якщо клієнт саме зараз надсилає дані доставки частинами — спершу дозбираємо адресу)
    if (ctx.agent.paidBeforeInvoice && ctx.requisitesSentAt && !ctx.crmOrderId && /^\s*[12]\s*[.!]?\s*$/.test(text) && !addressComplete(ctx.orderData)) {
        // клієнт підтверджує варіант після того, як уже сплатив і в нього вже попросили дані — не повторюємо прохання
        ctx.paymentInfo = { method: text.trim().startsWith('2') ? 'full' : 'cod' };
        A.out.push({ text: 'Зафіксувала ✅ Варіант 1: передплата 200 грн вже є — щойно надійдуть дані для відправки, одразу оформлю замовлення 💛', step: 'method_confirm_after_paid' });
        return;
    }
    const givingAddressNow = !!(u.phone || u.fullName || u.city || u.branch || u.region) && !addressComplete(ctx.orderData);
    if (!(ctx.paymentInfo && ctx.paymentInfo.method) && givingAddressNow && !u.payMethod && !u.prepaymentObjection) {
        const od = ctx.orderData || {};
        const missing = [!od.fullName && 'ПІБ', !od.phone && 'телефон', !od.city && 'місто', !od.branch && '№ відділення або поштомата'].filter(Boolean);
        ctx.agent.missingFields = missing.join(', ');
        A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_ask_address_partial', ctx, A.session.id)), step: 'ask_address_partial' }); ctx.agent.lastAsk = 'дані доставки: ' + missing.join(', '); return;
    }
    if (!(ctx.paymentInfo && ctx.paymentInfo.method)) {
        if (u.prepaymentObjection && !ctx.trustScriptStep) { A.out.push({ text: messageTextMultiline(A.assets, 'n_agent_trust1', ctx, A.session.id), step: 'trust1' }); ctx.trustScriptStep = 1; ctx.agent.lastAsk = 'оформимо з передплатою 200?'; return; }
        if (ctx.trustScriptStep === 1 && (u.prepaymentObjection || u.trustPromise === false || u.ready === 'no')) { A.out.push({ text: messageText(A.assets, 'n_agent_trust2', ctx, A.session.id), step: 'trust2' }); ctx.trustScriptStep = 2; ctx.agent.lastAsk = 'обіцяєте прийти на пошту?'; return; }
        if (ctx.trustScriptStep === 2 && u.trustPromise === false) { A.out.push({ text: messageText(A.assets, 'n_agent_handoff', ctx, A.session.id), step: 'trust_handoff' }); await pause(A, 'handoff', 'n_agent_trust_declined_admin', '💬 «' + text.slice(0, 200) + '»'); return; }
        if (ctx.trustScriptStep === 2 && (u.trustPromise === true || u.ready === 'yes')) {
            // 2026-09-24 (власник: «чистого накладеного платежу в магазині немає»; FunnelTest T12): бот сам виняток без
            // передоплати НЕ надає — передає менеджеру, який вирішує індивідуально (раніше: method 'cod_trust', оформлення без 200 грн).
            A.out.push({ text: 'Дякую за відповідь 🙏 Передаю ваше питання менеджеру — він напише вам тут найближчим часом 💛', step: 'trust_handoff_manager' });
            await pause(A, 'handoff', 'n_agent_trust_declined_admin', '💬 Клієнт просить виняток без передоплати і обіцяє забрати посилку: «' + text.slice(0, 200) + '»');
            return;
        }
        else if (ctx.trustScriptStep === 1 && (u.ready === 'yes' || u.payMethod === 'cod')) ctx.paymentInfo = { method: 'cod' };
        else if (u.payMethod) ctx.paymentInfo = { method: u.payMethod, ...(u.country ? { country: u.country } : {}) };
        else if (ctx.agent.lastAsk === 'спосіб оплати 1 чи 2' && !u.questions.length) {
            // 2026-09-15 (живий кейс, Владус): клієнт дозбирав адресу окремим повідомленням ПІСЛЯ
            // того, як уже бачив повний список способів оплати (1/2) — цей блок раніше беззастережно
            // ліпив payAck + ПОВНИЙ payTpl знову, тож два ходи поспіль показували клієнту однаковий
            // список. Той самий принцип, що вже є для «оформляємо?» (lastAsk==='оформляємо?' вище):
            // якщо список уже показували й нового питання нема — лише коротко нагадуємо, без повтору.
            const ack = (u.claimsPaid || u.receiptLink || A.turnImage) ? 'Дякую, бачу квитанцію 🙏 ' : ((u.phone || u.fullName || u.city || u.branch) ? 'Дані записала 📝 ' : '');
            A.out.push({ text: ack + messageText(A.assets, 'n_agent_pay_options_repeat', ctx, A.session.id), step: 'pay_options_repeat' });
            return;
        }
        else {
            const payTpl = messageTextMultiline(A.assets, 'n_pay', ctx, A.session.id + ':pay');
            if (u.questions.length) {
                A._questionEngaged = true;
                const { text: payQTxt, resolved: payQResolved } = await compose(A, { questions: u.questions, nextStep: 'потім скажи, що лишилось обрати спосіб оплати (сам список дасть система)', maxSentences: 3, fallback: '' });
                if (!payQResolved) await escalateUnresolved(A, u.questions[0]);
                A.out.push({ text: payQTxt, step: 'pay_q' });
            }
            const payAck = (u.receiptLink || A.turnImage) ? messageTextMultiline(A.assets, 'n_agent_pay_ack_receipt', ctx, A.session.id) + '\n\n' : ((u.phone || u.fullName || u.city || u.branch) ? messageTextMultiline(A.assets, 'n_agent_pay_ack_address', ctx, A.session.id) + '\n\n' : (u.addUpsell === false && ctx.agent.upsellOffered ? messageTextMultiline(A.assets, 'n_agent_pay_ack_no_upsell', ctx, A.session.id) + '\n\n' : ''));
            A.out.push({ text: payAck + payTpl, step: 'pay_options' });
            ctx.agent.lastAsk = 'спосіб оплати 1 чи 2'; return;
        }
        await T.payAmount(A);
        if (ctx.paymentInfo.country) { await T.intlRoute(A); if (ctx.intlStatus === 'unsupported') { A.out.push({ text: messageText(A.assets, 'n_intl_unsupported_msg', ctx, A.session.id), step: 'intl' }); await pause(A, 'intl_unsupported', 'n_agent_intl_admin'); return; } }
        await T.funnelStage(A, ...STAGES.awaiting);
        if (u.questions.length) A.out.push({ text: await answerThenAsk(A, u, ''), step: 'pay_q' });
        await sendRequisites(A, u);
        if (!addressComplete(ctx.orderData)) return;
    }

    // 9. Адреса
    if (!addressComplete(ctx.orderData)) {
        const od = { ...(ctx.orderData || {}) };
        // 2026-09-15 (живий кейс, Edits a651dde5: "Львівська обл. Рудне. Вул Яворницького 95
        // відділення 1" — бот ПРОІГНОРУВАВ явно назване "відділення 1" і перепитав номер) —
        // корінь: `u.branch && !u.homeAddress` викидав номер відділення, якщо ТОЙ САМИЙ ХІД
        // ЩЕ й містив вулицю/будинок (LLM цілком законно ставить homeAddress:true поруч із
        // валідним branch, коли повідомлення описує адресу відділення словами "вулиця X, буд Y,
        // відділення N" — це не прохання доставки додому, а просто повний опис відділення).
        // Перевірка живих даних (356 реальних повідомлень з адресами по всіх сесіях) показала:
        // переважна більшість "адрес без відділення" насправді МАЮТЬ номер, просто в нестандартній
        // формі (НП2, нп 1, Пункт №1, Перше відділення) — і ЦЕЙ бар'єр викидав його щоразу, коли
        // LLM також бачила вулицю в тому ж повідомленні. Номер відділення бере пріоритет ЗАВЖДИ.
        if (u.fullName) od.fullName = u.fullName; if (u.phone) od.phone = u.phone; if (u.city) od.city = u.city; if (u.region) od.region = u.region; if (u.branch) { if (od.branch && String(od.branch) !== String(u.branch)) delete ctx.np; od.branch = u.branch; }
        if (u.paymentMethodChange && u.paymentMethodChange !== ctx.paymentInfo.method) { ctx.paymentInfo = { ...ctx.paymentInfo, method: u.paymentMethodChange }; ctx.orderRef = ''; await T.payAmount(A); ctx.orderData = od; await sendRequisites(A, u); return; }
        const mem = ctx.customer || {};
        if (!od.phone && !od.fullName && mem.phone && mem.fullName && mem.city && mem.branch) {
            if (ctx.agent.addressConfirmAsked && (u.ready === 'yes' || /^(так|да|ті ?самі|те ?саме|ок|окей|на ті|актуальн)/i.test(text.trim()))) { Object.assign(od, { fullName: mem.fullName, phone: mem.phone, city: mem.city, branch: mem.branch }); }
            else if (!ctx.agent.addressConfirmAsked) { ctx.agent.addressConfirmAsked = true; ctx.orderData = od; A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_address_confirm_reuse', ctx, A.session.id)), step: 'address_confirm' }); ctx.agent.lastAsk = 'ті самі дані доставки?'; return; }
        }
        ctx.orderData = od;
        if (u.wantsCard) { await sendCard(A); return; }
        if (u.wantsManualReq) { await sendManualRequisites(A, true); return; }
        if (u.claimsPaid || u.receiptLink || A.turnImage) await tryReconcile(A);
        // Відмовляємо в доставці додому лише коли номера відділення/поштомата дійсно НЕМА (ні
        // з цього ходу, ні з попереднього) — якщо він УЖЕ є в od.branch (щойно взятий вище або
        // з минулого ходу), homeAddress:true просто означає "клієнт заодно описав адресу
        // відділення словами", а не "хоче доставку додому".
        if (u.homeAddress && !od.branch) { ctx.agent.cityNote = od.city ? ' у м. ' + od.city : ''; A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_home_address_reject', ctx, A.session.id)), step: 'home_address' }); ctx.agent.lastAsk = 'номер відділення'; return; }
        if (!addressComplete(od)) {
            const missing = [!od.fullName && 'ПІБ', !od.phone && 'телефон', !od.city && 'місто', !od.branch && '№ відділення або поштомата'].filter(Boolean);
            ctx.agent.ackLine = ctx.payStatus === 'confirmed' ? 'Оплату отримали ✅ ' : (u.claimsPaid || u.receiptLink || (A.turnImage && Number(ctx.payAmount) > 0 && ctx.paymentInfo && ctx.paymentInfo.method) ? 'Дякую! Оплату звіримо, щойно надійде 🙏 ' : '');
            ctx.agent.missingFields = missing.join(', ');
            A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_ask_address', ctx, A.session.id)), step: 'ask_address' }); ctx.agent.lastAsk = 'дані доставки: ' + missing.join(', '); return;
        }
        await T.npCheck(A);
        if (ctx.np && ctx.np.ask) { A.out.push({ text: messageText(A.assets, 'n_np_ask', ctx, A.session.id), step: 'np_ask' }); ctx.agent.lastAsk = 'уточнення адреси НП'; ctx.orderData = { ...od, branch: od.branch }; return; }
    } else if (u.paymentMethodChange && u.paymentMethodChange !== ctx.paymentInfo.method && !ctx.crmOrderId) {
        ctx.paymentInfo = { ...ctx.paymentInfo, method: u.paymentMethodChange }; ctx.orderRef = ''; await T.payAmount(A); await sendRequisites(A, u); return;
    } else if (u.wantsCard && !ctx.crmOrderId) { await sendCard(A); return; }
    else if (u.wantsManualReq && !ctx.crmOrderId) { await sendManualRequisites(A, true); return; }

    // 10. Звірка оплати (перед створенням замовлення — щоб стадія була правильна)
    if (Number(ctx.payAmount) > 0 && ctx.payStatus !== 'confirmed' && (u.claimsPaid || u.receiptLink || A.turnImage || !ctx.payCheckedAt)) await tryReconcile(A);

    // 11–13. CRM → постачальник → підтвердження
    const res = await afterOrderAccepted(A);
    if (res === 'done' && Number(ctx.payAmount) > 0 && ctx.payStatus !== 'confirmed' && (u.claimsPaid || u.receiptLink || A.turnImage) && !ctx.agent.payNotFoundSaid) {
        A.out.push({ text: messageText(A.assets, 'n_pay_notfound_msg', ctx, A.session.id), step: 'pay_notfound' }); ctx.agent.payNotFoundSaid = true;
        if (!ctx.payNotFoundNotified) { ctx.payNotFoundNotified = true; }
    }
}

module.exports = { runPolicy, addressComplete, matchColor, enforceInsistLimit };
