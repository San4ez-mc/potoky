'use strict';
/**
 * shopAgent/asks.js — реєстр прохань бота (2026-10-07, архітектурна переробка, погоджено власником; пара до questions.js).
 *
 * Чому: «скільки разів ми вже просили зріст і вагу / колір / оплату» рахували 7 окремих лічильників у секціях policy
 * (paramsAskCount, colorAskCount, setColorAskCount, setSizeAskCount, payRepeatCount, hintRepeatCount…) плюс окремий
 * запобіжник «зациклився». Кожен збільшувався в момент формування тексту — навіть якщо текст потім прибрали як дубль, клієнт
 * його не бачив (пачка повідомлень) або вже відповів (лічильник не скидався). Звідси хибні «зациклився» і повтори.
 *
 * Тепер одне джерело правди, яке пишеться ОДИН раз на хід — на виході (index.js, після всіх фільтрів), по тому, що клієнт
 * реально отримав:
 *   ctx.agent.asks[slot] = { n, at, step } — n = скільки разів клієнт БАЧИВ це прохання й після нього написав не те;
 *   слот заповнено (розмір, колір, адреса, оплата…) — запис зникає;
 *   хід пачки (клієнт написав до того, як побачив попереднє прохання) — n не збільшується.
 * Policy лише ЧИТАЄ: times(A, slot) — для перефразування повтору чи «лише відповісти, не тиснути».
 * Поріг limit — передача менеджеру (policy.breakLoop).
 */

const SLOTS = [
    { slot: 'params', re: /^(ask_params|size_verify_ask|set_size_ask)$/, limit: 4 },
    { slot: 'address', re: /^(ask_address|order_reshow)$/, limit: 4 },
    { slot: 'color', re: /^(set_color_ask|ask_color|color_size_unavailable|set_color_size_unavailable|color_sample_honest)$/, limit: 4 },
    { slot: 'intent', re: /^(order_intent|order_intent_repeat)$/, limit: 4 },
    { slot: 'pay', re: /^(pay_options|pay_options_repeat|pay_options_reshow)$/, limit: 4 },
    { slot: 'set', re: /^(set_ask|set_answer)$/, limit: 4 },
    { slot: 'unknown', re: /^(unknown|hint|hint_repeat)$/, limit: 3 },
    { slot: 'oos', re: /^(out_of_stock)$/, limit: 3 },
];

function filled(ctx, slot) {
    const od = ctx.orderData || {};
    switch (slot) {
        case 'params': return !!(ctx.recommendedSize || ctx.isSetSizeCalc || ctx.sizeOutOfRange);
        case 'color': return !!((ctx.colorChoice && (ctx.colorChoice.color || (Array.isArray(ctx.colorChoice.colors) && ctx.colorChoice.colors.length))) || (ctx.agent && ctx.agent.setColorsResolved));
        case 'address': return !!(od.phone && od.fullName && od.city && od.branch);
        case 'pay': return !!(ctx.paymentInfo && ctx.paymentInfo.method);
        case 'intent': return !!((ctx.orderIntent && ctx.orderIntent.ready === 'yes') || ctx.crmOrderId);
        case 'set': return !!ctx.setMode;
        case 'unknown': return !!(ctx.product && ctx.product.sku);
        default: return false;
    }
}

/** Скільки разів клієнт уже бачив прохання цього слота й не відповів (до поточного ходу). */
function times(A, slot) {
    const r = ((A.ctx.agent || {}).asks || {})[slot];
    return r ? r.n : 0;
}

/** Слот кроку виходу (останній сегмент «pay_q+pay_options» → pay_options). */
function slotOf(step) {
    const last = String(step || '').split('+').pop();
    return SLOTS.find((x) => x.re.test(last)) || null;
}

/**
 * Записати прохання цього ходу — ЛИШЕ на виході (index.js), по фінальному тексту, що піде клієнту.
 * Повертає { slot, n, limit, step } або null (хід без прохання).
 */
function record(A) {
    const { ctx } = A; ctx.agent = ctx.agent || {};
    const asks = ctx.agent.asks = ctx.agent.asks || {};
    for (const s of Object.keys(asks)) if (filled(ctx, s) || Date.now() - Number(asks[s].at || 0) > 12 * 3600 * 1000) delete asks[s];
    const main = [...(A.out || [])].reverse().find((o) => o.text && String(o.text).trim());
    if (!main) return null;
    const f = slotOf(main.step);
    if (!f || filled(ctx, f.slot)) return null;
    const step = String(main.step || '').split('+').pop();
    const prev = asks[f.slot];
    const clientAt = Math.max(0, ...(A.history || []).filter((m) => m.who === 'client').map((m) => new Date(m.sentAt || m.at).getTime() || 0));
    // Пачка: клієнт написав ДО того, як побачив попереднє прохання (07.10 tatiananepota: 5 пересилань поста за 14 с) — не рахуємо.
    if (prev && !(clientAt > Number(prev.at || 0))) { prev.at = Date.now(); return { slot: f.slot, n: prev.n, limit: f.limit, step, counted: false }; }
    const n = prev ? prev.n + 1 : 1;
    asks[f.slot] = { n, at: Date.now(), step };
    return { slot: f.slot, n, limit: f.limit, step, counted: true };
}

module.exports = { SLOTS, filled, times, slotOf, record };
