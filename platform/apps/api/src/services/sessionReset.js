'use strict';
/**
 * sessionReset.js — коли пам'ять розмови про МИНУЛЕ замовлення вже не актуальна. 2026-10-12.
 *
 * Помилка: Олексій оформив замовлення 07.09, а 12.10 переслав рілс з іншою кофтою і спитав ціну — бот відповів «додатковий
 * товар до вже оформленого замовлення передаю менеджеру» замість картки з ціною. Пам'ять розмови (ctx.crmOrderId і весь стан
 * продажу) жила 35 днів: фонова чистка (worker resetStaleOrCompletedSessions) брала 300 будь-яких сесій платформи, з них ~273
 * уже чищених, і не чіпала сесії на паузі менеджера — на goverla лишилось 460 сесій зі старим замовленням.
 *
 * Правило (одне для ходу агента і для фонової чистки):
 *  • замовлення старше ORDER_STALE_MS (30 днів) — архівуємо завжди;
 *  • старше ORDER_FRESH_MS (2 доби) і клієнт приніс НОВИЙ товар (пересланий пост, нова реклама, інший артикул) — архівуємо:
 *    це нова покупка, а не «додати до посилки»;
 *  • свіже замовлення (до 2 діб) не чіпаємо: «а ще джинси» — справді до цієї посилки, питання про оплату/відправку — до нього.
 * Архівування = забути стан минулого продажу, але не людину: ідентичність, ПІБ/телефон/адреса, зріст/вага, паузи менеджера,
 * рекламні дотики для CRM лишаються; саме замовлення — коротким записом у ctx.previousOrders.
 */
const ORDER_FRESH_MS = 48 * 3600 * 1000;
const ORDER_STALE_MS = 30 * 24 * 3600 * 1000;

// Що лишається після архівування (усе інше — стан минулого продажу).
const KEEP_ALWAYS = [
    // хто це і де розмова
    'channel', 'contactId', 'conversationId', 'psid', 'senderName', 'igUsername', 'customer', 'crmClientId', 'shop',
    // керування людьми і службове
    'funnelPaused', 'pausedBy', 'pausedAt', 'adminEngaged', 'resumedBy', 'resumedAt', 'managerOutreachAt', 'testMode',
    'zernioNextCheckAt', 'metaRetry', 'flowRuntime', 'currentNode', 'adTouch', 'previousOrders', 'returnFlow', 'returnTtn',
    // поточне повідомлення (ставиться на початку ходу)
    'lastUserMessage', 'lastCustomerMessage', 'lastUserTs', 'lastUserImageUrl', 'lastUserImageUrls', 'recentUserImageUrl', 'recentUserImageAt',
];
// Сигнали товару ЦЬОГО ходу — лишаються, лише якщо прийшли саме зараз (інакше це сигнал минулого продажу).
const SIGNAL_KEYS = {
    sharedPost: ['sharedPost', 'hasFreshSignalThisTurn'],
    entryAd: ['entryAdId', 'entryAd', 'adTitle', 'lastReferral'],
    story: ['storyId', 'storyFrames'],
    comment: ['commentId', 'commentText', 'commentMediaId', 'commentReplyText', 'commentReplyPosted', 'commentCategory', 'commentPublicReplies', 'entryAd'],
};

function orderPlacedAt(ctx) {
    const c = ctx || {};
    const t = Number(c.orderRefAt || c.requisitesSentAt || c.postOrderMsgAt || 0);
    return t > 0 ? t : null;
}

/** Причина архівувати минуле замовлення, або null. newProductSignal — клієнт цього ходу приніс новий товар. */
function shouldArchiveOrder(ctx, { newProductSignal = false, now = Date.now() } = {}) {
    const c = ctx || {};
    if (!c.crmOrderId) return null;
    if (c.returnFlow && !/^(done|expired)$/.test(String(c.returnFlow.stage || ''))) return null; // повернення/обмін у процесі — замовлення ще потрібне
    const at = orderPlacedAt(c);
    if (!at) return null; // не знаємо, коли оформлено, — не ризикуємо
    const age = now - at;
    if (age > ORDER_STALE_MS) return 'order_older_30d';
    if (newProductSignal && age > ORDER_FRESH_MS) return 'new_product_after_48h';
    return null;
}

/** Архівує минуле замовлення В МІСЦІ (той самий об'єкт ctx — на нього вже посилається хід). signals: які сигнали прийшли цим ходом. */
function archiveOrderInPlace(ctx, { reason, signals = {}, now = Date.now() } = {}) {
    const keep = new Set(KEEP_ALWAYS);
    for (const [k, on] of Object.entries(signals)) if (on && SIGNAL_KEYS[k]) SIGNAL_KEYS[k].forEach((x) => keep.add(x));
    const od = ctx.orderData || {};
    const body = ctx.sizeInput && ctx.sizeInput.height && ctx.sizeInput.weight
        ? { height: ctx.sizeInput.height, weight: ctx.sizeInput.weight, ...(ctx.sizeInput.belly ? { belly: true } : {}), ...(ctx.sizeInput.shoeSize ? { shoeSize: ctx.sizeInput.shoeSize } : {}) } : null;
    const prev = {
        crmOrderId: ctx.crmOrderId || null, orderRef: ctx.orderRef || null, at: orderPlacedAt(ctx),
        sku: (ctx.product && ctx.product.sku) || ctx.orderSku || null, name: (ctx.product && (ctx.product.customerName || ctx.product.name)) || null,
        ttn: ctx.supplierTtn || ctx.ttn || null, payStatus: ctx.payStatus || null,
        ...(od.fullName || od.phone ? { orderData: { fullName: od.fullName || null, phone: od.phone || null, city: od.city || null, branch: od.branch || null } } : {}),
        archivedAt: now, reason: reason || null,
    };
    const agent = ctx.agent || {};
    for (const k of Object.keys(ctx)) if (!keep.has(k)) delete ctx[k];
    ctx.agent = { version: agent.version || 2, turns: agent.turns || 0, ...(agent.seenEntryAd ? { seenEntryAd: agent.seenEntryAd } : {}) };
    if (body) ctx.sizeInput = body;
    ctx.previousOrders = [...(Array.isArray(ctx.previousOrders) ? ctx.previousOrders : []), prev].slice(-5);
    // Дані людини з минулого замовлення — у пам'ять клієнта (наступне оформлення підставить ПІБ/телефон/адресу, зріст/вагу).
    ctx.customer = { ...(ctx.customer || {}),
        ...(prev.orderData && prev.orderData.phone && prev.orderData.fullName && prev.orderData.city && prev.orderData.branch ? prev.orderData : {}),
        ...(body ? { height: Number(body.height), weight: Number(body.weight) } : {}),
        ...(prev.sku ? { lastSku: prev.sku } : {}), ...(prev.orderRef ? { lastOrderRef: prev.orderRef } : {}) };
    ctx.resetAt = now; ctx.resetReason = reason || 'order_archived';
    return ctx;
}

module.exports = { ORDER_FRESH_MS, ORDER_STALE_MS, orderPlacedAt, shouldArchiveOrder, archiveOrderInPlace };
