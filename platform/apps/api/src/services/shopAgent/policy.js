'use strict';
/**
 * shopAgent/policy.js — детермінована політика ходу. Одна функція, один прохід по стадіях.
 * Стадія виводиться зі СТАНУ (context), а не зберігається як «поточна нода» — тому будь-яке
 * повідомлення клієнта (навіть не по порядку: «185/79 сірий, наложка») просувається одразу на
 * стільки кроків, скільки даних у ньому є, а вже відоме ніколи не перепитується.
 */
const T = require('./tools');
const { compose } = require('./compose');
const { messageText, messageTextMultiline, nodeData, norm, loadCategories } = require('./lib');
const { dispatchOrder } = require('./supplierDispatch');

// 2026-09-14 (власник: "я взагалі проти будь-якого хардкоду... все в ноди перенеси"): TRUST_STEP1/2,
// HANDOFF_TEXT та решта клієнтських/менеджерських текстів цього файлу БУЛИ тут як JS-константи —
// перенесено у звичайні message/notifyTg ноди flowDefinition бота (n_agent_*), редаговані у Flows
// UI так само, як n_welcome/n_pay/n_confirm. РІШЕННЯ який вузол показати й коли — лишається тут
// (детерміновану політику ходу свідомо НЕ повертаємо в граф-маршрутизацію — джерело R1-R7).
const STAGES = { presented: ['Презентація товару', 1], params: ['Написав параметри', 2], color: ['Написав параметри та колір', 3], awaiting: ['Очікуємо дані та оплату', 4], accepted: ['Замовлення прийняте', 5], supplier: ['Замовлення оформлене в постачальника', 6] };
const RE_UNKNOWN_Q = /гарант|знижк|пошит|оптом|розстроч|кредит|сертифік|повернен|обмін/i;

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
    return (pp.setItems || []).map((it) => ({ article: it.article, id: it.id, name: it.name, price: Number(it.price) || 0, supplier: it.supplier || '', supplierArticle: it.supplierArticle || '', colors: it.colors || [], colorPhotos: it.colorPhotos || {}, sizes: it.sizes || [], qty: 1, color: it.fixedColor || '', size: '' }));
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
    if (setMatchesOriginal(sel, ctx.agent.setOriginal)) {
        const total = Number(pp.price) > 0 ? Number(pp.price) : setSelectionTotal(sel);
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

async function answerThenAsk(A, u, askText, o = {}) {
    // askText — ГОТОВИЙ текст для клієнта (не інструкція). Без питань клієнта він іде як є;
    // з питаннями → факти (KB, наявність) → одна відповідь + той самий крок своїми словами.
    if (u.intent === 'greeting' && !o.ack) o = { ...o, ack: 'коротко привітайся у відповідь (тим самим часом доби, якщо клієнт його назвав)' };
    if (!u.questions.length && !o.ack) return askText;
    let kb = []; let availAnswer = '';
    try { kb = await T.kbSearch(A, u.questions[0]); } catch (e) { /* best-effort */ }
    if (/наявн|є в наявн|залишил|є ще|маєте ще|чи є/i.test(String(A.turnText || ''))) { A.ctx.lastCustomerMessage = A.turnText; await T.availSearch(A); availAnswer = A.ctx.availAnswer || ''; }
    if (!kb.length && u.questions.some((q) => RE_UNKNOWN_Q.test(q)) && !A.ctx.agent.askManagerAt) {
        A.ctx.agent.askManagerAt = Date.now(); await T.kbAsk(A, u.questions[0]);
        await T.alert(A, 'n_agent_unknown_question_admin', { details: '💬 «' + u.questions[0].slice(0, 200) + '»' });
    }
    // Живий кейс 2026-09-14 (Василенко): картка щойно сама попросила зріст/вагу; askText тут
    // порожній навмисно (нічого повторно просити не треба), АЛЕ без явної заборони LLM (compose)
    // сама, за власною ініціативою, дописувала «підкажіть зріст і вагу» вдруге в кінці відповіді
    // на питання клієнта — типова для продажного тону звичка закінчувати заклик до дії. Заборона —
    // явним nextStep, а не сподівання, що модель здогадається з відсутності інструкції.
    const nextStep = askText ? 'скажи/спитай (можна своїми словами, зміст той самий): «' + askText + '»' : 'НІЧОГО більше не питай і не пропонуй наступний крок — просто дай коротку відповідь на питання клієнта, без заклику до дії в кінці.';
    const txt = await compose(A, { questions: u.questions, ack: o.ack, nextStep, kb, availAnswer, fallback: askText });
    return txt || askText;
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
    for (const id of ['n_req_iban_l', 'n_req_iban_v', 'n_req_code_l', 'n_req_code_v', 'n_req_name_l', 'n_req_name_v', 'n_req_ref_l', 'n_req_ref_v', 'n_req_sum']) { const t = messageTextMultiline(A.assets, id, ctx, A.session.id); if (t) A.out.push({ text: t, step: id }); }
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
    }
    return 'done';
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
async function runPolicy(A, u) {
    const { ctx } = A; ctx.agent = ctx.agent || {};
    const text = String(A.turnText || '');
    const freshSignal = !!(A.turnSharedPost || A.newEntryAd || u.productHint.article || u.productHint.fromList || (A.turnImage && !u.claimsPaid && !u.receiptLink && !(ctx.paymentInfo && ctx.paymentInfo.method) ));

    // 0. Людина / претензія / повернення
    if (u.wantsHuman) {
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
            A.out.push({ text: messageText(A.assets, 'n_post_order_receipt_msg', ctx, A.session.id), step: 'post_receipt' });
            if (A.turnImage) ctx.receiptNew = true;
            await T.alert(A, 'n_receipt_alert', { photoUrl: A.turnImage || '' });
            return;
        }
        if (u.wantsManualReq && ctx.payStatus !== 'confirmed' && Number(ctx.payAmount) > 0) {
            // Живий кейс 2026-09-14 (Валерій): оплата за посиланням уже надіслана раніше, клієнт
            // хоче реквізити вручну — бот відповідав шаблонним «замовлення в роботі», ігноруючи
            // прохання. Секція «Після оформленого замовлення» не перевіряла wantsManualReq взагалі.
            await sendManualRequisites(A, true);
            return;
        }
        if (u.extraProducts || u.alsoWants) {
            A.out.push({ text: messageText(A.assets, 'n_agent_post_extra_ack', ctx, A.session.id), step: 'post_extra' });
            ctx.agent.orderRefDisplay = ctx.orderRef || ctx.crmOrderId;
            await T.alert(A, 'n_agent_post_extra_admin', { details: '💬 «' + text.slice(0, 200) + '»' });
            return;
        }
        const since = Date.now() - Number(ctx.postOrderMsgAt || 0);
        if (u.questions.length && !u.statusQuestion) {
            A.out.push({ text: await answerThenAsk(A, u, 'Ваше замовлення в роботі 💛'), step: 'post_q' });
        } else if (since > 30 * 60 * 1000) {
            A.out.push({ text: messageTextMultiline(A.assets, 'n_post_order_msg', ctx, A.session.id), step: 'post_order' }); ctx.postOrderMsgAt = Date.now();
        }
        if (since > 30 * 60 * 1000 || u.statusQuestion) await T.alert(A, 'n_post_order_admin');
        return;
    }

    // 1b. Раннє захоплення даних доставки і чеків — незалежно від стадії (клієнт може написати
    //     адресу чи скинути чек ще до підбору розміру; нічого не губимо і не перепитуємо потім).
    if ((u.phone || u.fullName || u.city || u.branch) && !u.homeAddress) {
        ctx.orderData = { ...(ctx.orderData || {}), ...(u.fullName ? { fullName: u.fullName } : {}), ...(u.phone ? { phone: u.phone } : {}), ...(u.city ? { city: u.city } : {}), ...(u.region ? { region: u.region } : {}), ...(u.branch ? { branch: u.branch } : {}) };
    }
    // 1c. Раннє захоплення параметрів розміру і кольору — теж незалежно від стадії (клієнт міг назвати
    //     зріст/вагу, поки бот ще питав про комплект чи колір): нічого не губиться, потім не перепитується.
    if (u.height || u.weight || u.clothingSize || u.chest || u.footLength || u.waist || u.belly) {
        const si = { ...(ctx.sizeInput || {}) };
        if (u.height) si.height = u.height; if (u.weight) si.weight = u.weight; if (u.clothingSize) si.clothingSize = u.clothingSize; if (u.chest) si.chest = u.chest; if (u.footLength) si.footLength = u.footLength; if (u.waist) si.waist = u.waist; if (u.belly) si.belly = true;
        ctx.sizeInput = si;
    }
    if (u.colorMatched) ctx.agent.pendingColor = u.colorMatched; else if (u.color) ctx.agent.pendingColorRaw = u.color;
    const earlyReceipt = (u.receiptLink || u.claimsPaid || (A.turnImage && addressComplete(ctx.orderData))) && !ctx.crmOrderId && !(ctx.paymentInfo && ctx.paymentInfo.method);
    if (earlyReceipt && !ctx.agent.receiptEarlyAlertAt) {
        ctx.agent.receiptEarlyAlertAt = Date.now();
        await T.alert(A, 'n_agent_early_payment_admin', { details: '💬 «' + text.slice(0, 200) + '»', photoUrl: A.turnImage || '' });
    }
    const preNote = (earlyReceipt ? 'Дякую, оплату бачу — звіримо 🙏 Щоб оформити відправку, лишилось кілька кроків. ' : '') + (u.intent === 'wants_requisites' && !(ctx.paymentInfo && ctx.paymentInfo.method) ? 'Реквізити надішлю одразу після підбору розміру і кольору 🙂 ' : '');

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
    if (!P(ctx) || freshSignal) {
        if (u.productHint.fromList && ctx.catalogHintSkus) {
            const skus = String(ctx.catalogHintSkus).split(',').map((s) => s.trim()).filter(Boolean);
            const hit = skus.find((s) => s.toLowerCase() === String(u.productHint.fromList).toLowerCase()) || skus.find((s) => String(u.productHint.fromList).toLowerCase().includes(s.toLowerCase()));
            if (hit) ctx.catalogHintPick = hit;
        }
        if (u.productHint.article && !/артикул|арт\.|\b[a-z]\d{3,6}\b/i.test(text)) ctx.lastUserMessage = text + ' артикул ' + u.productHint.article;
        const r = await T.resolveProduct(A, { forceSignal: !!(ctx.catalogHintPick || u.productHint.article) });
        const swappedToOwnSetComponent = r.status === 'found' && __setBeforeProduct && __setBeforeProduct.isSet && Array.isArray(__setBeforeSelection)
            && P(ctx).sku !== __setBeforeProduct.sku && __setBeforeSelection.some((it) => it.article === P(ctx).sku);
        if (swappedToOwnSetComponent) {
            // Повертаємо комплект як активний товар і НІЧОГО не скидаємо — далі хід обробить
            // секція комплекту (5b) так само, якби productHint не спрацював.
            ctx.product = __setBeforeProduct;
            ctx.setSelection = __setBeforeSelection;
        } else if (r.status === 'found') {
            resetForNewProduct(A, P(ctx).sku);
            const samePresented = ctx.agent.presentedSku === P(ctx).sku && ctx.presentedAt && (Date.now() - Number(ctx.presentedAt)) < 6 * 3600 * 1000;
            if (!samePresented) await present(A);
            else if (u.wantsPhoto && !A.turnImage && (Date.now() - Number(ctx.presentedAt)) > 2 * 60 * 1000) { const urls = firstPhotoUrls(P(ctx)); if (urls.length) A.out.push({ photoUrls: urls, caption: '', step: 'photo_again' }); }
            if (ctx.adLinkMismatchAt && !ctx.adLinkMismatchAlertedAt) { await T.alert(A, 'n_ad_conflict_admin'); ctx.adLinkMismatchAlertedAt = Date.now(); }
            // нижче — продовжуємо тим самим ходом (параметри/колір могли бути вже в повідомленні)
        } else if (r.status === 'hint') {
            const photos = Array.isArray(ctx.catalogHintPhotos) ? ctx.catalogHintPhotos.filter((x) => /^https?:/.test(String(x))).slice(0, 4) : [];
            if (photos.length && ctx.agent.hintPhotosFor !== ctx.catalogHintSkus) { A.out.push({ photoUrls: photos, caption: '', step: 'hint_photos' }); ctx.agent.hintPhotosFor = ctx.catalogHintSkus; }
            const list = String(ctx.catalogHint || '');
            ctx.agent.hintList = list;
            const txt = await compose(A, { questions: u.questions, noGreeting: A.botSpokeBefore, extraFacts: 'СПИСОК ТОВАРІВ, ЯКІ ПІДХОДЯТЬ ПІД ЗАПИТ (вже пронумеровано, кожен товар — своя позиція):\n' + list, nextStep: 'наведи ЦЕЙ список рівно так, як він є — кожен номер на своєму рядку, з порожнім рядком між позиціями, без артикулів у дужках, ціни лишити — і спитай, який сподобався (можна відповісти номером, фото чи кольором; артикул просити не треба, фото вже надіслано)', fallback: messageTextMultiline(A.assets, 'n_agent_catalog_hint_fallback', ctx, A.session.id) });
            A.out.push({ text: txt, step: 'hint' }); ctx.agent.lastAsk = 'який із показаних товарів цікавить';
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
            const txt = await compose(A, { questions: u.questions, noGreeting: A.botSpokeBefore, extraFacts: cats, nextStep: A.turnImage ? 'скажи, що по фото не змогла впізнати модель, і спитай, що саме цікавить: назви категорії; або попроси переслати пост/рілс' : 'спитай, що саме цікавить (назви категорії) або попроси переслати пост/рілс з Instagram', fallback: (A.botSpokeBefore ? '' : 'Вітаю! 💛 ') + messageText(A.assets, 'n_agent_unknown_fallback', ctx, A.session.id) });
            A.out.push({ text: txt, step: 'unknown' }); ctx.agent.lastAsk = 'що цікавить';
            return;
        }
    }
    const p = P(ctx);

    // 3. Комплект
    if (p.isSet && !ctx.setMode) {
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
        else { ctx.agent.preNote = preNote; ctx.agent.setAskList = humanSetList(p); A.out.push({ text: await answerThenAsk(A, u, messageTextMultiline(A.assets, 'n_agent_set_ask', ctx, A.session.id)), step: 'set_ask' }); ctx.agent.lastAsk = 'весь комплект чи окремі речі'; return; }
    }
    const pp = P(ctx);

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
                A.out.push({ text: messageText(A.assets, 'n_size_oor_msg', ctx, A.session.id), step: 'size_oor' });
                await pause(A, 'size_oor', 'n_size_oor_admin');
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
            if (u.wantsSizeChart && pp.sizeChartUrl && ctx.agent.chartSentFor !== pp.sku) { A.out.push({ photoUrls: [pp.sizeChartUrl], caption: messageText(A.assets, 'n_agent_size_chart_caption', ctx, A.session.id), step: 'size_chart' }); ctx.agent.chartSentFor = pp.sku; }
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
            A.out.push({ text: await answerThenAsk(A, u, preNote + colorNote + ask), step: 'ask_params' }); ctx.agent.lastAsk = paramsPrompt || 'зріст і вага';
            return;
        }
    }

    // 5. Колір
    if (pp.colors && !(ctx.colorChoice && ctx.colorChoice.color)) {
        const c = u.colorMatched || matchColor(pp, u.color) || (ctx.sizeInput && ctx.sizeInput.color) || matchColor(pp, ctx.agent.pendingColor) || matchColor(pp, ctx.agent.pendingColorRaw) || null;
        if (c) { ctx.colorChoice = { color: c, qty: u.qty || undefined }; delete ctx.agent.pendingColor; delete ctx.agent.pendingColorRaw; }
        else if (isSoftDecline(u)) { A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_soft_decline_color', ctx, A.session.id)), step: 'ask_color_soft' }); return; }
        else {
            ctx.agent.wantColor = u.color || '';
            const ask = u.color ? messageText(A.assets, 'n_agent_ask_color_specific', ctx, A.session.id) : messageText(A.assets, 'n_agent_ask_color_generic', ctx, A.session.id);
            A.out.push({ text: await answerThenAsk(A, u, preNote + ask), step: 'ask_color' }); ctx.agent.lastAsk = 'колір'; return;
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
        }
        // 2026-09-15 (власник: "якого кольору джинси ми тепер оформимо?"): раніше колір позицій
        // комплекту НІКОЛИ не резолвився й не питався — замовлення йшло з порожнім кольором для
        // багатоколірних позицій. Однокольорові підтягуються автоматично (нема сенсу питати);
        // клієнт МІГ уже назвати колір(и) прямо в цьому повідомленні ("джинси сині, кофта чорна")
        // — розбираємо по позиціях тим самим matchSetItem/matchColor, що вже є для applySetEdit;
        // лишається неоднозначність — питаємо ОДНИМ повідомленням саме ці позиції, не всі одразу.
        if (!ctx.agent.setColorsResolved) {
            const catNamesSet = ctx.agent.setParams && ctx.agent.setParams.categoryNames;
            const segments = text.split(/[,;\n]|\bі\b|\bта\b/iu).map((s) => s.trim()).filter(Boolean);
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
                if (colorPhotoUrls.length) A.out.push({ photoUrls: colorPhotoUrls.slice(0, 10), caption: '', step: 'set_color_ask_photos' });
                A.out.push({ text: await answerThenAsk(A, u, messageTextMultiline(A.assets, 'n_agent_set_color_ask', ctx, A.session.id)), step: 'set_color_ask' });
                ctx.agent.lastAsk = 'колір позицій комплекту';
                return;
            }
            ctx.agent.setColorsResolved = true;
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
        if ((u.extraProducts || u.alsoWants) && !(pp.isSet && ctx.setMode === 'set')) { ctx.extraProductMention = u.extraProducts || u.alsoWants; await T.extraResolve(A); }
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
            ctx.orderIntent = { ready: 'yes', addUpsell: addUpsellFinal, upsellQty: u.upsellQty || upsellQtyFallback || undefined, upsellNote: u.upsellNote || (answeringUpsellClarify && addUpsellFinal ? text : undefined), units: u.units || undefined, qty: u.qty || undefined, extras: undefined, extraProducts: undefined };
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
                ? messageText(A.assets, 'n_agent_order_summary_header', ctx, A.session.id) + '\n' + (pp.customerName || pp.name) + '\n\n' + ctx.setSelection.map((it) => '• ' + it.name + (it.color ? ' (' + it.color + ')' : '') + (it.qty > 1 ? ' ×' + it.qty : '') + ' — ' + (it.price * it.qty) + ' грн').join('\n') + '\n\nРазом: ' + total + ' грн' + (ctx.shop && ctx.shop.terms ? '\n' + ctx.shop.terms : '')
                : (() => { const units = ctx.orderUnitsText || ((ctx.colorChoice && ctx.colorChoice.color ? ctx.colorChoice.color : '') + (ctx.recommendedSize ? ' ' + ctx.recommendedSize : '')); return messageText(A.assets, 'n_agent_order_summary_header', ctx, A.session.id) + '\n' + (pp.customerName || pp.name) + (units ? ' — ' + units : '') + ' — ' + total + ' грн' + (ctx.extraItemsText ? '\n' + ctx.extraItemsText : '') + (ctx.shop && ctx.shop.terms ? '\n' + ctx.shop.terms : ''); })();
            const askLine = (!isSetFull && pp.upsell) ? messageText(A.assets, 'n_agent_order_ask_upsell', ctx, A.session.id) : messageText(A.assets, 'n_agent_order_ask_plain', ctx, A.session.id);
            if (!isSetFull && pp.upsell) ctx.agent.upsellOffered = true;
            const hesitating = (u.intent === 'hesitate' || u.intent === 'postpone');
            let txt = summary + '\n\n' + askLine;
            if (ctx.agent.lastAsk === 'оформляємо?' && !u.questions.length && !hesitating) {
                // «Оформляємо?» уже питали, клієнт написав щось без рішення — коротка реакція + те саме питання, без повторного підсумку
                txt = await compose(A, { ack: 'відреагуй одним реченням на репліку клієнта (нічого не обіцяй і не змінюй склад замовлення сама)', nextStep: 'і спитай: «' + askLine + '»', maxSentences: 2, fallback: askLine });
                A.out.push({ text: txt, step: 'order_intent_repeat' }); return;
            }
            if (u.questions.length || hesitating) {
                const pre = await compose(A, { questions: u.questions, nextStep: hesitating ? 'клієнт вагається — без тиску наведи ОДИН реальний аргумент оформити сьогодні (раніше отримає, черга на відправку) і заверши питанням «Оформляємо сьогодні?»' : 'заверши коротким переходом до підсумку (без самого підсумку — його додасть система)', maxSentences: 3, fallback: '' });
                txt = (pre ? pre + '\n\n' : '') + (hesitating ? summary : txt);
            }
            A.out.push({ text: txt, step: 'order_intent' });
            ctx.agent.lastAsk = 'оформляємо?'; return;
        }
    }

    // 8. Спосіб оплати (якщо клієнт саме зараз надсилає дані доставки частинами — спершу дозбираємо адресу)
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
        if (ctx.trustScriptStep === 2 && (u.trustPromise === true || u.ready === 'yes')) ctx.paymentInfo = { method: 'cod_trust' };
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
            if (u.questions.length) A.out.push({ text: await compose(A, { questions: u.questions, nextStep: 'потім скажи, що лишилось обрати спосіб оплати (сам список дасть система)', maxSentences: 3, fallback: '' }), step: 'pay_q' });
            const payAck = (u.claimsPaid || u.receiptLink || A.turnImage) ? messageTextMultiline(A.assets, 'n_agent_pay_ack_receipt', ctx, A.session.id) + '\n\n' : ((u.phone || u.fullName || u.city || u.branch) ? messageTextMultiline(A.assets, 'n_agent_pay_ack_address', ctx, A.session.id) + '\n\n' : (u.addUpsell === false && ctx.agent.upsellOffered ? messageTextMultiline(A.assets, 'n_agent_pay_ack_no_upsell', ctx, A.session.id) + '\n\n' : ''));
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
        if (u.fullName) od.fullName = u.fullName; if (u.phone) od.phone = u.phone; if (u.city) od.city = u.city; if (u.region) od.region = u.region; if (u.branch && !u.homeAddress) od.branch = u.branch;
        if (u.paymentMethodChange && u.paymentMethodChange !== ctx.paymentInfo.method) { ctx.paymentInfo = { ...ctx.paymentInfo, method: u.paymentMethodChange }; ctx.orderRef = ''; await T.payAmount(A); ctx.orderData = od; await sendRequisites(A, u); return; }
        const mem = ctx.customer || {};
        if (!od.phone && !od.fullName && mem.phone && mem.fullName && mem.city && mem.branch) {
            if (ctx.agent.addressConfirmAsked && (u.ready === 'yes' || /^(так|да|ті ?самі|те ?саме|ок|окей|на ті|актуальн)/i.test(text.trim()))) { Object.assign(od, { fullName: mem.fullName, phone: mem.phone, city: mem.city, branch: mem.branch }); }
            else if (!ctx.agent.addressConfirmAsked) { ctx.agent.addressConfirmAsked = true; ctx.orderData = od; A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_address_confirm_reuse', ctx, A.session.id)), step: 'address_confirm' }); ctx.agent.lastAsk = 'ті самі дані доставки?'; return; }
        }
        ctx.orderData = od;
        if (u.wantsManualReq) { await sendManualRequisites(A, true); return; }
        if (u.claimsPaid || u.receiptLink || A.turnImage) await tryReconcile(A);
        if (u.homeAddress) { ctx.agent.cityNote = od.city ? ' у м. ' + od.city : ''; A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_home_address_reject', ctx, A.session.id)), step: 'home_address' }); ctx.agent.lastAsk = 'номер відділення'; return; }
        if (!addressComplete(od)) {
            const missing = [!od.fullName && 'ПІБ', !od.phone && 'телефон', !od.city && 'місто', !od.branch && '№ відділення або поштомата'].filter(Boolean);
            ctx.agent.ackLine = ctx.payStatus === 'confirmed' ? 'Оплату отримали ✅ ' : (u.claimsPaid || u.receiptLink || A.turnImage ? 'Дякую! Оплату звіримо, щойно надійде 🙏 ' : '');
            ctx.agent.missingFields = missing.join(', ');
            A.out.push({ text: await answerThenAsk(A, u, messageText(A.assets, 'n_agent_ask_address', ctx, A.session.id)), step: 'ask_address' }); ctx.agent.lastAsk = 'дані доставки: ' + missing.join(', '); return;
        }
        await T.npCheck(A);
        if (ctx.np && ctx.np.ask) { A.out.push({ text: messageText(A.assets, 'n_np_ask', ctx, A.session.id), step: 'np_ask' }); ctx.agent.lastAsk = 'уточнення адреси НП'; ctx.orderData = { ...od, branch: od.branch }; return; }
    } else if (u.paymentMethodChange && u.paymentMethodChange !== ctx.paymentInfo.method && !ctx.crmOrderId) {
        ctx.paymentInfo = { ...ctx.paymentInfo, method: u.paymentMethodChange }; ctx.orderRef = ''; await T.payAmount(A); await sendRequisites(A, u); return;
    } else if (u.wantsManualReq && !ctx.crmOrderId) { await sendManualRequisites(A, true); return; }

    // 10. Звірка оплати (перед створенням замовлення — щоб стадія була правильна)
    if (Number(ctx.payAmount) > 0 && ctx.payStatus !== 'confirmed' && (u.claimsPaid || u.receiptLink || A.turnImage || !ctx.payCheckedAt)) await tryReconcile(A);

    // 11–13. CRM → постачальник → підтвердження
    const res = await afterOrderAccepted(A);
    if (res === 'done' && Number(ctx.payAmount) > 0 && ctx.payStatus !== 'confirmed' && (u.claimsPaid || u.receiptLink || A.turnImage) && !ctx.agent.payNotFoundSaid) {
        A.out.push({ text: messageText(A.assets, 'n_pay_notfound_msg', ctx, A.session.id), step: 'pay_notfound' }); ctx.agent.payNotFoundSaid = true;
        if (!ctx.payNotFoundNotified) { ctx.payNotFoundNotified = true; }
    }
}

module.exports = { runPolicy, addressComplete, matchColor };
