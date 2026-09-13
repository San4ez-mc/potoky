'use strict';
/**
 * shopAgent/policy.js — детермінована політика ходу. Одна функція, один прохід по стадіях.
 * Стадія виводиться зі СТАНУ (context), а не зберігається як «поточна нода» — тому будь-яке
 * повідомлення клієнта (навіть не по порядку: «185/79 сірий, наложка») просувається одразу на
 * стільки кроків, скільки даних у ньому є, а вже відоме ніколи не перепитується.
 */
const T = require('./tools');
const { compose } = require('./compose');
const { messageText, messageTextMultiline, nodeData, norm } = require('./lib');

const TRUST_STEP1 = 'Накладний платіж у нас із частковою передплатою 200 грн.\n\nЯкщо прийдете на пошту і вам щось не підійде — ми повернемо ці 200 грн одразу.\n\nРаніше відправляли без передплати, і більшість людей просто не приходили на пошту.\n\nДля нас 200 грн — це гарантія, що:\n1) ви не чат-бот 🙂\n2) ви не передумаєте завтра\n3) ви прийдете на пошту\n\nОформимо замовлення із частковою передплатою 200 грн?';
const TRUST_STEP2 = 'Якщо зробимо виняток і відправимо без передплати — обіцяєте, що завтра не передумаєте і що справді прийдете на пошту?';
const HANDOFF_TEXT = 'Добре, зараз покличу менеджера 🙂 Незабаром вам відповість жива людина — дякую за терпіння 💛';
const STAGES = { presented: ['Презентація товару', 1], params: ['Написав параметри', 2], color: ['Написав параметри та колір', 3], awaiting: ['Очікуємо дані та оплату', 4], accepted: ['Замовлення прийняте', 5], supplier: ['Замовлення оформлене в постачальника', 6] };
const RE_UNKNOWN_Q = /гарант|знижк|пошит|оптом|розстроч|кредит|сертифік|повернен|обмін/i;

function P(ctx) { return ctx.product && ctx.product.sku ? ctx.product : null; }
function addressComplete(od) { return !!(od && od.phone && od.fullName && od.city && od.branch); }
function firstPhotoUrls(p) { const u = Array.isArray(p.imageUrls) ? p.imageUrls.filter((x) => /^https?:/.test(String(x))) : []; if (!u.length && /^https?:/.test(String(p.photoUrl || ''))) u.push(p.photoUrl); return u.slice(0, 10); }
function matchColor(p, want) {
    if (!p || !want) return null; const list = Array.isArray(p.colorsList) && p.colorsList.length ? p.colorsList : String(p.colors || '').split(',').map((s) => s.trim()).filter(Boolean);
    const w = norm(want).toLowerCase(); if (!w) return null;
    const exact = list.find((c) => c.toLowerCase() === w); if (exact) return exact;
    const stem = w.replace(/(ий|а|е|у|ого|им|ому|ої|ою|их)$/u, '').slice(0, 5);
    const cand = list.filter((c) => c.toLowerCase().includes(stem) || w.includes(c.toLowerCase().slice(0, 5)));
    return cand.length === 1 ? cand[0] : null;
}
function ttnIn(text) { const m = String(text || '').match(/(?<!\d)\d{14}(?!\d)/); return m ? m[0] : ''; }

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
        await T.alert(A, { title: '❓ Клієнт спитав те, чого бот не знає', main: 'Бот продовжує діалог; відповідь допишіть у чат — вона також потрапить у Базу знань CRM.', details: '💬 «' + u.questions[0].slice(0, 200) + '»' });
    }
    const txt = await compose(A, { questions: u.questions, ack: o.ack, nextStep: askText ? 'скажи/спитай (можна своїми словами, зміст той самий): «' + askText + '»' : '', kb, availAnswer, fallback: askText });
    return txt || askText;
}
function colorsOf(p) { return String((p && p.colors) || '').trim(); }

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
    const card = messageText(A.assets, 'n_welcome', ctx, A.session.id + ':present');
    A.out.push({ text: greet + card, step: 'present' });
    ctx.productJustPresented = true; ctx.presentedAt = Date.now(); ctx.lastPresentedSku = p.sku; ctx.agent.presentedSku = p.sku;
    ctx.agent.lastAsk = p.followUpQuestion || '';
    await T.funnelStage(A, ...STAGES.presented);
}

function resetForNewProduct(A, sku) {
    const { ctx } = A;
    if (ctx.agent.presentedSku && ctx.agent.presentedSku !== sku) {
        for (const k of ['sizeInput', 'recommendedSize', 'sizeSource', 'sizeReplyText', 'sizeColorFollowup', 'sizeOutOfRange', 'sizeOorReason', 'sizeOorAlternative', 'isSetSizeCalc', 'setSizesText', 'colorChoice', 'available', 'availReason', 'orderUnits', 'orderUnitsText', 'orderUnitsTotal', 'orderQty', 'orderIntent', 'setMode', 'setPick', 'availChecked', 'extraItems', 'extraItemsText', 'extraUnresolved']) delete ctx[k];
        if (!ctx.crmOrderId) for (const k of ['paymentInfo', 'payAmount', 'payLabel', 'orderRef', 'orderRefAt', 'ibanPayUrl', 'ibanInvoiceUid', 'requisitesSentAt']) delete ctx[k];
    }
}

async function sendRequisites(A, u) {
    const { ctx } = A;
    if (Number(ctx.payAmount) === 0) { A.out.push({ text: messageText(A.assets, 'n_trust_confirm_msg', ctx, A.session.id), step: 'trust_confirm' }); ctx.requisitesSentAt = Date.now(); return; }
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
        if (ctx.receiptNew) await T.alert(A, 'n_receipt_alert');
    }
    if ((ctx.payStatus === 'confirmed' || Number(ctx.payAmount) === 0) && !ctx.supplierOrderStatus && !ctx.supplierHandled) {
        await T.supplierRoute(A);
        if (ctx.supplierMechanism && ctx.supplierMechanism !== 'manual') { await T.supplierOrder(A); await T.alert(A, 'n_supplier_notify'); }
        else await T.alert(A, 'n_supplier_manual');
        ctx.supplierHandled = true;
        await T.ttnSync(A);
        await T.funnelStage(A, ...STAGES.supplier);
    }
    await T.confirmPrep(A);
    const key = (ctx.payStatus || '') + ':' + (ctx.supplierTtn || '');
    if (ctx.agent.confirmKey !== key) {
        A.out.push({ text: messageTextMultiline(A.assets, 'n_confirm', ctx, A.session.id), step: 'confirm' });
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
        A.out.push({ text: HANDOFF_TEXT, step: 'handoff' });
        await pause(A, 'handoff', { title: '🙋 Клієнт просить живу людину', main: 'Бот зупинився. Відповідайте в чаті; повернути бота — іконкою в сесії.', details: '💬 «' + text.slice(0, 200) + '»' });
        return;
    }
    if (u.isComplaint && !u.returnRequest) {
        A.out.push({ text: 'Розумію, це неприємно 😔 Передала менеджеру — він розбереться і напише вам сюди найближчим часом 💛', step: 'complaint' });
        await pause(A, 'complaint', { title: '⚠️ Претензія клієнта', main: 'Бот зупинився, відповідайте в чаті.', details: '💬 «' + text.slice(0, 300) + '»' });
        return;
    }
    if (ctx.returnFlow && ctx.returnFlow.stage === 'await_ttn') {
        const ttn = ttnIn(text);
        if (ttn) { ctx.returnFlow = { ...ctx.returnFlow, ttn, stage: 'done' }; ctx.returnTtn = ttn; await T.returnCrmUpdate(A); A.out.push({ text: messageTextMultiline(A.assets, 'n_return_confirm_msg', ctx, A.session.id), step: 'return_confirm' }); await T.alert(A, 'n_return_admin'); return; }
        A.out.push({ text: await answerThenAsk(A, u, 'Щойно відправите посилку — напишіть, будь ласка, номер нової накладної, і ми одразу оформимо обмін/повернення 🤗'), step: 'return_wait' });
        return;
    }
    if (u.returnRequest) {
        A.out.push({ text: messageTextMultiline(A.assets, 'n_return_easy_msg', ctx, A.session.id), step: 'return_easy' });
        ctx.returnFlow = { stage: 'await_ttn', at: Date.now() };
        await T.alert(A, { title: '🔄 Клієнт хоче обмін/повернення', main: 'Бот надіслав інструкцію «Легке повернення» і чекає ТТН. Втручання не потрібне, якщо все штатно.', details: '💬 «' + text.slice(0, 200) + '»' });
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
        if (u.extraProducts || u.alsoWants) {
            A.out.push({ text: 'Гарно, додамо до цієї ж посилки 🙌 Менеджер уточнить деталі й напише сюди 🙂', step: 'post_extra' });
            await T.alert(A, { title: '➕ Клієнт хоче додати товар до оформленого замовлення', main: 'Додайте позицію вручну і напишіть клієнту.', details: '🧾 ' + (ctx.orderRef || ctx.crmOrderId) + '\n💬 «' + text.slice(0, 200) + '»' });
            return;
        }
        const since = Date.now() - Number(ctx.postOrderMsgAt || 0);
        if (u.questions.length && !u.statusQuestion) {
            A.out.push({ text: await answerThenAsk(A, u, 'Ваше замовлення в роботі 💛'), step: 'post_q' });
        } else if (since > 30 * 60 * 1000) {
            A.out.push({ text: messageText(A.assets, 'n_post_order_msg', ctx, A.session.id), step: 'post_order' }); ctx.postOrderMsgAt = Date.now();
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
        await T.alert(A, { title: '🧾 Клієнт пише про оплату до оформлення', main: 'Замовлення в боті ще не оформлене (нема розміру/кольору/адреси) — перевірте вручну, бот продовжує збирати дані.', details: '💬 «' + text.slice(0, 200) + '»' }, { photoUrl: A.turnImage || '' });
    }
    const preNote = (earlyReceipt ? 'Дякую, оплату бачу — звіримо 🙏 Щоб оформити відправку, лишилось кілька кроків. ' : '') + (u.intent === 'wants_requisites' && !(ctx.paymentInfo && ctx.paymentInfo.method) ? 'Реквізити надішлю одразу після підбору розміру і кольору 🙂 ' : '');

    // 2. Товар
    if (!P(ctx) || freshSignal) {
        if (u.productHint.fromList && ctx.catalogHintSkus) {
            const skus = String(ctx.catalogHintSkus).split(',').map((s) => s.trim()).filter(Boolean);
            const hit = skus.find((s) => s.toLowerCase() === String(u.productHint.fromList).toLowerCase()) || skus.find((s) => String(u.productHint.fromList).toLowerCase().includes(s.toLowerCase()));
            if (hit) ctx.catalogHintPick = hit;
        }
        if (u.productHint.article && !/артикул|арт\.|\b[a-z]\d{3,6}\b/i.test(text)) ctx.lastUserMessage = text + ' артикул ' + u.productHint.article;
        const r = await T.resolveProduct(A, { forceSignal: !!(ctx.catalogHintPick || u.productHint.article) });
        if (r.status === 'found') {
            resetForNewProduct(A, P(ctx).sku);
            const samePresented = ctx.agent.presentedSku === P(ctx).sku && ctx.presentedAt && (Date.now() - Number(ctx.presentedAt)) < 6 * 3600 * 1000;
            if (!samePresented) await present(A);
            else if (u.wantsPhoto) { const urls = firstPhotoUrls(P(ctx)); if (urls.length) A.out.push({ photoUrls: urls, caption: '', step: 'photo_again' }); }
            if (ctx.adLinkMismatchAt && !ctx.adLinkMismatchAlertedAt) { await T.alert(A, 'n_ad_conflict_admin'); ctx.adLinkMismatchAlertedAt = Date.now(); }
            // нижче — продовжуємо тим самим ходом (параметри/колір могли бути вже в повідомленні)
        } else if (r.status === 'hint') {
            const photos = Array.isArray(ctx.catalogHintPhotos) ? ctx.catalogHintPhotos.filter((x) => /^https?:/.test(String(x))).slice(0, 4) : [];
            if (photos.length && ctx.agent.hintPhotosFor !== ctx.catalogHintSkus) { A.out.push({ photoUrls: photos, caption: '', step: 'hint_photos' }); ctx.agent.hintPhotosFor = ctx.catalogHintSkus; }
            const list = String(ctx.catalogHint || '');
            const txt = await compose(A, { questions: u.questions, noGreeting: A.botSpokeBefore, extraFacts: 'СПИСОК ТОВАРІВ, ЯКІ ПІДХОДЯТЬ ПІД ЗАПИТ (покажи всі, з цінами, без артикулів у дужках можна):\n' + list, nextStep: 'коротко перелічи ці варіанти з цінами і спитай, який сподобався — по фото чи кольору (артикул просити не треба, фото вже надіслано)', fallback: 'Ось що є у нас у цій категорії:\n' + list + '\n\nЯкий сподобався? 😊' });
            A.out.push({ text: txt, step: 'hint' }); ctx.agent.lastAsk = 'який із показаних товарів цікавить';
            return;
        } else if (!P(ctx)) {
            if (ctx.hasProductSignal && !ctx.unknownNotifiedAt && !ctx.looksLikeReceipt) { ctx.lastCustomerMessage = text; await T.tool(A, 'n_unknown_debug'); await T.alert(A, 'n_unknown_admin', { photoUrl: A.turnImage || '' }); ctx.unknownNotifiedAt = Date.now(); }
            if (ctx.looksLikeReceipt) { A.out.push({ text: 'Дякую! Схоже, це квитанція про оплату 🙏 Передала менеджеру на перевірку — він напише сюди 🙂', step: 'receipt_no_order' }); await T.alert(A, { title: '🧾 Квитанція без оформленого замовлення', main: 'Клієнт надіслав чек, але замовлення в боті нема — перевірте вручну.', details: '💬 «' + text.slice(0, 200) + '»' }, { photoUrl: A.turnImage || '' }); return; }
            const cats = ctx.catalogCategories ? ('Категорії в наявності: ' + ctx.catalogCategories) : 'Категорії: костюми, куртки, бомбери, кофти, футболки, джинси, взуття';
            const txt = await compose(A, { questions: u.questions, noGreeting: A.botSpokeBefore, extraFacts: cats, nextStep: A.turnImage ? 'скажи, що по фото не змогла впізнати модель, і спитай, що саме цікавить: назви категорії; або попроси переслати пост/рілс' : 'спитай, що саме цікавить (назви категорії) або попроси переслати пост/рілс з Instagram', fallback: (A.botSpokeBefore ? '' : 'Вітаю! 💛 ') + 'Підкажіть, що вас цікавить — костюми, куртки, бомбери, кофти, футболки, джинси чи взуття? Або перешліть пост/рілс 🙂' });
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
        else { A.out.push({ text: await answerThenAsk(A, u, preNote + 'Підкажіть, будь ласка, вас цікавить весь комплект чи окремі речі з нього? 🙂\nСклад: ' + (p.setList || p.setComponents)), step: 'set_ask' }); ctx.agent.lastAsk = 'весь комплект чи окремі речі'; return; }
    }
    const pp = P(ctx);

    // 4. Розмір
    const needSize = (pp.isClothing || pp.isSet) && !ctx.recommendedSize && !ctx.isSetSizeCalc && !ctx.sizeOutOfRange;
    if (needSize) {
        const si = { ...(ctx.sizeInput || {}) };
        if (u.height) si.height = u.height; if (u.weight) si.weight = u.weight;
        if (u.clothingSize) si.clothingSize = u.clothingSize; if (u.chest) si.chest = u.chest; if (u.footLength) si.footLength = u.footLength; if (u.waist) si.waist = u.waist; if (u.belly) si.belly = true;
        if (u.colorMatched && !(ctx.colorChoice && ctx.colorChoice.color)) si.color = u.colorMatched;
        if (u.alsoWants) si.alsoWants = u.alsoWants;
        const mem = ctx.customer || {};
        let usedMemory = false;
        if (pp.categoryParamsIsHeightWeight !== 'false' && !si.height && !si.weight && mem.height && mem.weight && !u.clothingSize) { si.height = mem.height; si.weight = mem.weight; usedMemory = true; }
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
            const reply = (usedMemory ? 'Беру ваші параметри з минулого разу (' + si.height + ' см / ' + si.weight + ' кг) 🙂 ' : '') + norm(String(ctx.sizeReplyText || '') + ' ' + String(ctx.sizeColorFollowup || ''));
            const hasColorNow = ctx.colorChoice && ctx.colorChoice.color;
            if (!hasColorNow && pp.colors) { A.out.push({ text: u.questions.length ? await answerThenAsk(A, u, reply) : reply, step: 'size_reply' }); ctx.agent.lastAsk = 'колір'; return; }
            A.out.push({ text: u.questions.length ? await answerThenAsk(A, u, reply) : reply, step: 'size_reply' });
        } else {
            if (u.wantsSizeChart && pp.sizeChartUrl && ctx.agent.chartSentFor !== pp.sku) { A.out.push({ photoUrls: [pp.sizeChartUrl], caption: 'Ось розмірна сітка 📏', step: 'size_chart' }); ctx.agent.chartSentFor = pp.sku; }
            const missing = si.height && !si.weight ? 'вагу' : (!si.height && si.weight ? 'зріст' : '');
            const colorNote = u.color && !u.colorMatched && colorsOf(pp) ? ('Щодо кольору «' + u.color + '»: у цієї моделі є ' + colorsOf(pp) + ' — який ближче? ') : (u.colorMatched ? 'Колір ' + u.colorMatched + ' — записала 🎨 ' : '');
            const ask = pp.categoryParamsIsHeightWeight === 'false'
                ? ('Підкажіть, будь ласка, ' + (pp.categoryParamsPrompt || 'ваш розмір') + ' 🙂')
                : (missing ? 'Дякую! Підкажіть ще ' + missing + ', будь ласка — і одразу підберу розмір 🙂' : 'Підкажіть, будь ласка, ваш зріст і вагу — підберу розмір 📏');
            A.out.push({ text: await answerThenAsk(A, u, preNote + colorNote + ask), step: 'ask_params' }); ctx.agent.lastAsk = 'зріст і вага';
            return;
        }
    }

    // 5. Колір
    if (pp.colors && !(ctx.colorChoice && ctx.colorChoice.color)) {
        const c = u.colorMatched || matchColor(pp, u.color) || (ctx.sizeInput && ctx.sizeInput.color) || matchColor(pp, ctx.agent.pendingColor) || matchColor(pp, ctx.agent.pendingColorRaw) || null;
        if (c) { ctx.colorChoice = { color: c, qty: u.qty || undefined }; delete ctx.agent.pendingColor; delete ctx.agent.pendingColorRaw; }
        else {
            const ask = u.color ? 'Кольору «' + u.color + '» саме у цієї моделі нема 😔 Є: ' + pp.colors + ' — який обираєте?' : 'Який колір обираєте: ' + pp.colors + '? 🎨';
            A.out.push({ text: await answerThenAsk(A, u, preNote + ask), step: 'ask_color' }); ctx.agent.lastAsk = 'колір'; return;
        }
    }

    // 5b. Комплект цілком: побажання щодо складу/кольорів/розмірів позицій — у примітку для CRM/менеджера
    if (pp.isSet && ctx.setMode === 'set') {
        const notes = [u.changeRequest, u.color ? 'колір: ' + u.color : '', u.clothingSize ? 'бажаний розмір: ' + u.clothingSize : ''].filter(Boolean);
        if (notes.length) { const n = 'побажання по комплекту: ' + notes.join(', '); if (!String(ctx.extraProducts || '').includes(n)) ctx.extraProducts = (ctx.extraProducts ? ctx.extraProducts + '; ' : '') + n; ctx.agent.setNoteAck = notes.join(', '); }
        ctx.available = true; ctx.orderUnitsText = ctx.setSizesText || 'весь комплект'; ctx.orderUnitsTotal = Number(pp.price) || undefined; ctx.orderQty = 1; ctx.orderUnits = ctx.orderUnits || [{ color: '', size: '' }];
        if (!ctx.agent.setStageSent) { await T.funnelStage(A, ...STAGES.color); ctx.agent.setStageSent = true; }
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
        if (u.extraProducts || u.alsoWants) { ctx.extraProductMention = u.extraProducts || u.alsoWants; await T.extraResolve(A); }
        if (u.ready === 'no') { A.out.push({ text: messageText(A.assets, 'n_declined_msg', ctx, A.session.id), step: 'declined' }); ctx.declinedAt = Date.now(); ctx.agent.lastAsk = ''; return; }
        const gaveAddress = !!(u.phone || u.city || u.branch || u.fullName);
        if (u.ready === 'yes' || gaveAddress || u.payMethod) {
            ctx.orderIntent = { ready: 'yes', addUpsell: !!u.addUpsell, upsellQty: u.upsellQty || undefined, upsellNote: u.upsellNote || undefined, units: u.units || undefined, qty: u.qty || undefined, extras: undefined, extraProducts: undefined };
            if (gaveAddress) { ctx.orderIntent.prefill = { fullName: u.fullName || undefined, phone: u.phone || undefined, city: u.city || undefined, branch: u.branch || undefined, region: u.region || undefined }; await T.orderPrefill(A); }
            if (pp.upsell && u.addUpsell == null && u.ready === 'yes' && ctx.agent.upsellOffered && !u.upsellNote && !gaveAddress && !u.payMethod) {
                // згода без відповіді на допродаж — одне уточнення
                ctx.orderIntent = null;
                A.out.push({ text: 'Оформляю ' + (pp.customerName || pp.name) + ' 🙌 Додаємо ' + pp.upsell + ' до посилки (яку і скільки) чи без нього?', step: 'upsell_clarify' }); ctx.agent.lastAsk = 'з допродажем чи без'; return;
            }
        } else {
            // підсумок + «Оформляємо?»
            const units = (pp.isSet && ctx.setMode === 'set') ? String(ctx.setSizesText || 'весь комплект').replace(/\s*\n\s*/g, '; ') : (ctx.orderUnitsText || ((ctx.colorChoice && ctx.colorChoice.color ? ctx.colorChoice.color : '') + (ctx.recommendedSize ? ' ' + ctx.recommendedSize : '')));
            const total = (pp.isSet && ctx.setMode === 'set') ? pp.price : (ctx.orderUnitsTotal || pp.price);
            const setAck = ctx.agent.setNoteAck ? 'Записала побажання: ' + ctx.agent.setNoteAck + ' — менеджер врахує при оформленні 📝\n\n' : '';
            ctx.agent.setNoteAck = '';
            if (pp.upsellPhotoUrl && !ctx.agent.upsellPhotoSent) { A.out.push({ photoUrls: [pp.upsellPhotoUrl], caption: '', step: 'upsell_photo' }); ctx.agent.upsellPhotoSent = true; }
            // Підсумок — ДЕТЕРМІНОВАНО (розмір/колір/сума з інструментів, LLM їх не перераховує); LLM лише
            // відповідає на питання клієнта перед підсумком або мʼяко працює з ваганням.
            const summary = 'Ось ваше замовлення 🙌\n' + (pp.customerName || pp.name) + (units ? ' — ' + units : '') + ' — ' + total + ' грн' + (ctx.extraItemsText ? '\n' + ctx.extraItemsText : '') + (ctx.shop && ctx.shop.terms ? '\n' + ctx.shop.terms : '');
            const askLine = pp.upsell ? 'Оформляємо? І підкажіть: додати ще ' + pp.upsell + ' до цієї ж посилки, чи лише основний товар? 🙂' : 'Оформляємо замовлення? 🙂';
            if (pp.upsell) ctx.agent.upsellOffered = true;
            const hesitating = (u.intent === 'hesitate' || u.intent === 'postpone');
            let txt = setAck + summary + '\n\n' + askLine;
            if (ctx.agent.lastAsk === 'оформляємо?' && !u.questions.length && !hesitating) {
                // «Оформляємо?» уже питали, клієнт написав щось без рішення — коротка реакція + те саме питання, без повторного підсумку
                txt = setAck ? (setAck + askLine) : await compose(A, { ack: 'відреагуй одним реченням на репліку клієнта (нічого не обіцяй і не змінюй склад замовлення сама)', nextStep: 'і спитай: «' + askLine + '»', maxSentences: 2, fallback: askLine });
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
        A.out.push({ text: await answerThenAsk(A, u, 'Записала 📝 Ще підкажіть, будь ласка: ' + missing.join(', ')), step: 'ask_address_partial' }); ctx.agent.lastAsk = 'дані доставки: ' + missing.join(', '); return;
    }
    if (!(ctx.paymentInfo && ctx.paymentInfo.method)) {
        if (u.prepaymentObjection && !ctx.trustScriptStep) { A.out.push({ text: TRUST_STEP1, step: 'trust1' }); ctx.trustScriptStep = 1; ctx.agent.lastAsk = 'оформимо з передплатою 200?'; return; }
        if (ctx.trustScriptStep === 1 && (u.prepaymentObjection || u.trustPromise === false || u.ready === 'no')) { A.out.push({ text: TRUST_STEP2, step: 'trust2' }); ctx.trustScriptStep = 2; ctx.agent.lastAsk = 'обіцяєте прийти на пошту?'; return; }
        if (ctx.trustScriptStep === 2 && u.trustPromise === false) { A.out.push({ text: HANDOFF_TEXT, step: 'trust_handoff' }); await pause(A, 'handoff', { title: '🙋 Клієнт не погодився на умови передоплати', main: 'Скрипт довіри пройдено, клієнт відмовляється — потрібне рішення менеджера.', details: '💬 «' + text.slice(0, 200) + '»' }); return; }
        if (ctx.trustScriptStep === 2 && (u.trustPromise === true || u.ready === 'yes')) ctx.paymentInfo = { method: 'cod_trust' };
        else if (ctx.trustScriptStep === 1 && (u.ready === 'yes' || u.payMethod === 'cod')) ctx.paymentInfo = { method: 'cod' };
        else if (u.payMethod) ctx.paymentInfo = { method: u.payMethod, ...(u.country ? { country: u.country } : {}) };
        else {
            const payTpl = messageTextMultiline(A.assets, 'n_pay', ctx, A.session.id + ':pay');
            if (u.questions.length) A.out.push({ text: await compose(A, { questions: u.questions, nextStep: 'потім скажи, що лишилось обрати спосіб оплати (сам список дасть система)', maxSentences: 3, fallback: '' }), step: 'pay_q' });
            const payAck = (u.claimsPaid || u.receiptLink || A.turnImage) ? 'Дякую, бачу квитанцію 🙏 Підкажіть лише, це часткова передплата (200 грн) чи повна оплата — щоб я правильно оформила:\n\n' : ((u.phone || u.fullName || u.city || u.branch) ? 'Дані для відправки записала 📝 Лишилось обрати оплату:\n\n' : (u.addUpsell === false && ctx.agent.upsellOffered ? 'Добре, лише основний товар 🙂\n\n' : ''));
            A.out.push({ text: payAck + payTpl, step: 'pay_options' });
            ctx.agent.lastAsk = 'спосіб оплати 1 чи 2'; return;
        }
        await T.payAmount(A);
        if (ctx.paymentInfo.country) { await T.intlRoute(A); if (ctx.intlStatus === 'unsupported') { A.out.push({ text: messageText(A.assets, 'n_intl_unsupported_msg', ctx, A.session.id), step: 'intl' }); await pause(A, 'intl_unsupported', { title: '🌍 Міжнародна доставка', main: 'Клієнт просить доставку в ' + ctx.intlCountry, details: '' }); return; } }
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
            else if (!ctx.agent.addressConfirmAsked) { ctx.agent.addressConfirmAsked = true; ctx.orderData = od; A.out.push({ text: await answerThenAsk(A, u, 'Минулого разу відправляли на: ' + mem.fullName + ', ' + mem.phone + ', ' + mem.city + ', відділення ' + mem.branch + '. Відправляємо туди ж? Якщо так — напишіть «так», якщо ні — нові дані одним повідомленням 🙂'), step: 'address_confirm' }); ctx.agent.lastAsk = 'ті самі дані доставки?'; return; }
        }
        ctx.orderData = od;
        if (u.wantsManualReq) { await sendManualRequisites(A, true); return; }
        if (u.claimsPaid || u.receiptLink || A.turnImage) await tryReconcile(A);
        if (u.homeAddress) { A.out.push({ text: await answerThenAsk(A, u, 'Ми відправляємо лише Новою Поштою — на відділення або поштомат (доставки додому чи таксі, на жаль, нема) 🙏 Підкажіть, будь ласка, номер відділення або поштомата' + (od.city ? ' у м. ' + od.city : '') + ' 📦'), step: 'home_address' }); ctx.agent.lastAsk = 'номер відділення'; return; }
        if (!addressComplete(od)) {
            const missing = [!od.fullName && 'ПІБ', !od.phone && 'телефон', !od.city && 'місто', !od.branch && '№ відділення або поштомата'].filter(Boolean);
            const ackLine = ctx.payStatus === 'confirmed' ? 'Оплату отримали ✅ ' : (u.claimsPaid || u.receiptLink || A.turnImage ? 'Дякую! Оплату звіримо, щойно надійде 🙏 ' : '');
            A.out.push({ text: await answerThenAsk(A, u, ackLine + 'Напишіть, будь ласка, для відправки Новою Поштою: ' + missing.join(', ') + ' 📦'), step: 'ask_address' }); ctx.agent.lastAsk = 'дані доставки: ' + missing.join(', '); return;
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

module.exports = { runPolicy, addressComplete, matchColor, TRUST_STEP1, TRUST_STEP2, HANDOFF_TEXT };
