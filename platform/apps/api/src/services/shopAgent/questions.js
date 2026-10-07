'use strict';
/**
 * shopAgent/questions.js — реєстр питань клієнта за хід (2026-10-07, архітектурна переробка, погоджено власником).
 *
 * Чому: питання клієнта (u.questions) змінювали 17 місць policy — 8 фільтрів регулярками («картка вже відповіла на ціну»,
 * «сітку вже надіслали», «зміну комплекту записали»…) і 9 місць, що підставляли питання. Кожне — латка під одну скаргу, разом
 * вони розходились: питання знімалось як «відповідене», хоча клієнт відповіді не бачив («спитав ціну — отримав лише зріст і вагу»,
 * FunnelTest 79/86/115/125, 12 з 15 «зациклився»).
 *
 * Тепер у кожного питання є тема (від аналізатора, understand.questionTopics) і статус:
 *   open      — ще без відповіді;
 *   covered   — відповідь клієнт уже бачить у цьому ж ході (картка, сітка, підсумок, «Записала: …») — by пояснює чим;
 *   answered  — відповіла модель (compose) з фактів/бази знань;
 *   escalated — модель чесно не знала, питання передано менеджеру.
 * u.questions лишається ПОХІДНИМ видом (усі, крім covered) — для сумісності з рештою policy; змінювати його напряму не можна.
 * Інваріант кінця ходу (policy.universalQuestionFallback): відкрите питання без відповіді не лишається.
 */

function init(A, u) {
    const ts = Array.isArray(u.questionTopics) ? u.questionTopics : [];
    A.qs = (Array.isArray(u.questions) ? u.questions : []).map((text, i) => ({ text: String(text), topic: ts[i] || 'other', status: 'open', by: null }));
    sync(A, u);
}

function sync(A, u) {
    if (!A.qs) return;
    u.questions = A.qs.filter((q) => q.status !== 'covered').map((q) => q.text);
    u.questionTopics = A.qs.filter((q) => q.status !== 'covered').map((q) => q.topic);
}

/** Відповідь клієнт уже бачить (by — що саме: 'card', 'size_chart', 'order_summary', 'set_edit', 'list_pick'…). pred(q) → bool. */
function cover(A, u, pred, by) {
    if (!A.qs) init(A, u);
    let n = 0;
    for (const q of A.qs) if (q.status === 'open' && pred(q)) { q.status = 'covered'; q.by = by; n++; }
    if (n) sync(A, u);
    return n;
}

/** Покрити теми (масив) — найчастіший випадок. */
function coverTopics(A, u, topics, by, extra) {
    return cover(A, u, (q) => topics.includes(q.topic) && (!extra || extra(q)), by);
}

/** Додати питання, яке система сформулювала сама (напр. «Чи є розмір 54?» з числового розміру). */
function add(A, u, text, topic) {
    if (!A.qs) init(A, u);
    if (A.qs.some((q) => q.text === text)) return;
    A.qs.push({ text: String(text), topic: topic || 'other', status: 'open', by: null });
    sync(A, u);
}

/** Модель відповіла на ці питання (compose — єдине місце). resolved=false → передано менеджеру. */
function markAnswered(A, texts, resolved) {
    if (!A || !A.qs || !Array.isArray(texts)) return;
    for (const q of A.qs) if (q.status === 'open' && texts.includes(q.text)) { q.status = resolved === false ? 'escalated' : 'answered'; q.by = 'compose'; }
}

function open(A) { return (A.qs || []).filter((q) => q.status === 'open'); }

/** Для траси/діагностики. */
function summary(A) { return (A.qs || []).map((q) => q.topic + ':' + q.status + (q.by ? '(' + q.by + ')' : '')); }

module.exports = { init, sync, cover, coverTopics, add, markAnswered, open, summary };
