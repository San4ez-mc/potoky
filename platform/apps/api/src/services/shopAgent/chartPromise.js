'use strict';
/**
 * chartPromise.js — інваріант «обіцяна розмірна сітка = надіслана сітка» (Edits 02.11, Ирина Щербак).
 *
 * Клієнтка спитала «Є розмірна сітка», у відповіді було «Так, зараз надішлю розмірну сітку окремим фото», але фото не було: на ході
 * презентації аналітик поставив тему питання size_chart, а не wantsSizeChart, тож політика сітку не відправила, а compose її пообіцяв.
 * Те саме, що інваріант «обіцяне фото» в index.js, лише для сітки. Якщо текст обіцяє сітку, а її в ході нема — додаємо сітку товару
 * (для комплекту — сітки речей); нічого надіслати — прибираємо обіцянку з тексту.
 */
const CHART_CLAIM = /(?:надішлю|надсилаю|скидаю|відправлю|кину|ось|додаю)\s+(?:вам\s+)?(?:ще\s+раз\s+)?(?:розмірн\S*\s+)?сітк|сітк\S*\s+(?:окремим|надішл|надсил|ось|додам)/i;

/** Повертає 'added' | 'stripped' | null. Змінює A.out і ctx.agent.chartSentFor. */
function applyChartPromise(A, ctx, stripAskSentences) {
    const claimed = A.out.filter((o) => o.text && CHART_CLAIM.test(o.text));
    if (!claimed.length) return null;
    if (A.out.some((o) => /^size_chart/.test(o.step || '') && Array.isArray(o.photoUrls) && o.photoUrls.length)) return null;
    const pr = (ctx && ctx.product) || {};
    const uniq = (it, i, a) => a.findIndex((x) => x.sizeChartUrl === it.sizeChartUrl) === i;
    const charts = pr.sizeChartUrl
        ? [{ url: pr.sizeChartUrl, caption: '' }]
        : (Array.isArray(pr.setItems) ? pr.setItems.filter((it) => it.sizeChartUrl).filter(uniq).slice(0, 4)
            .map((it) => ({ url: it.sizeChartUrl, caption: 'Розмірна сітка: ' + String(it.name || '').split('\n')[0].replace(/\.?\s*Артикул:?.*$/i, '').trim() })) : []);
    if (charts.length) {
        const at = A.out.findIndex((o) => o.text && CHART_CLAIM.test(o.text));
        A.out.splice(at + 1, 0, ...charts.map((c) => ({ photoUrls: [c.url], caption: c.caption, step: 'size_chart' })));
        if (ctx && ctx.agent) ctx.agent.chartSentFor = pr.sku || ctx.agent.chartSentFor;
        return 'added';
    }
    A.out = A.out.map((o) => (o.text && CHART_CLAIM.test(o.text) ? Object.assign({}, o, { text: stripAskSentences(o.text, (snt) => CHART_CLAIM.test(snt)) }) : o)).filter((o) => o.text || o.photoUrls);
    return 'stripped';
}

module.exports = { applyChartPromise, CHART_CLAIM };
