'use strict';
/**
 * Детектори класів помилок у розмовах бота (етап 0 плану «правки → нуль», 13.10.2026).
 *
 * Навіщо: правки в Edits — це те, що встиг побачити й заскріншотити Олексій; частки розмов з помилкою ніхто не міряв, тож
 * не було видно ні покращення (05–07.10 ~1 правка на 100 розмов), ні хвилі (12.10 ~27 на 100). Детектори — детерміновані
 * перевірки ФАКТІВ розмови (без ШІ, без тлумачення змісту): хто що надіслав, який крок зробив бот, що зрозумів аналізатор
 * (знімки agent_turns). Той самий набір — для щоденного звіту і для прогону нового коду перед деплоєм (етап 1).
 *
 * Класи (code → що означає):
 *   no_reply_bot      клієнт написав, бот не на паузі, відповіді нема 10+ хв
 *   no_reply_manager  клієнт написав у розмову, яку веде менеджер (бот на паузі), відповіді нема 10+ хв
 *   repeat_ask        те саме прохання бота 3+ рази в розмові (зріст/вага, колір, оплата, «що цікавить»)
 *   asked_known_hw    бот просить зріст і вагу, які клієнт уже написав
 *   duplicate_bot     той самий текст бота двічі поспіль за 3 хв
 *   send_failed       відповідь не пішла клієнту (збій каналу)
 *   loop_handoff      бот сам здався: «щоб не ганяти по колу»
 *   complaint         клієнт скаржиться / роздратований
 *   open_question     хід закінчився з відкритим питанням клієнта (реєстр питань)
 *   sale_on_status    клієнт питав про своє замовлення — бот продавав
 *   product_unknown   клієнт приніс товар (пост/реклама/фото) — бот не визначив
 *   ai_down           ШІ не відповів — хід пропущено
 */
const { db } = require('@platform/db');

const ASK_STEPS = /^(ask_params|ask_color|set_color_ask|set_size_ask|pay_options|pay_options_repeat|order_intent|order_intent_repeat|ask_address|unknown|hint|hint_repeat)$/;
const SALE_STEPS = /^(ask_params|ask_color|set_color_ask|pay_options|present|order_intent|hint|unknown|size_reply)/;
// Закриття розмови, що не потребує відповіді: лише слова-подяки/згоди («Дякую, чекаю», «Дякую вам», «Ок, гарного дня», емодзі).
const CLOSING_WORDS = new Set(['дякую', 'дякуємо', 'дякі', 'спасибі', 'спасибо', 'благодарю', 'вам', 'і', 'и', 'ок', 'окей', 'ok', 'добре', 'гаразд', 'супер', 'чудово', 'зрозуміло', 'зрозумів', 'зрозуміла', 'ясно', 'понятно', 'хорошо', 'чекаю', 'чекатиму', 'жду', 'буду', 'чекати', 'ждать', 'домовились', 'гарного', 'хорошого', 'дня', 'вечора', 'вечера', 'дуже', 'велике', 'большое', 'ага',
    // 14.10 (розбір звіту): відмова/відкладення теж не потребують відповіді — «Ні, дякую», «Подумаю», «Добре, очікую», «Поки що не потрібно».
    'ні', 'нє', 'нет', 'не', 'потрібно', 'треба', 'надо', 'подумаю', 'подумаємо', 'подумаем', 'очікую', 'очікуватиму', 'поки', 'що', 'пока', 'вирішую', 'вибачте', 'гарно', 'докую', 'дякую.', 'щиро', 'все', 'зрозумів.']);
const isClosing = (t) => { if (String(t || '').includes('?')) return false; /* «??» — нетерплячка, не закриття */ const w = String(t || '').toLowerCase().replace(/[\p{Extended_Pictographic}️!.,)(?:;"'«»\-]/gu, ' ').split(/\s+/).filter(Boolean); return !w.length || w.every((x) => CLOSING_WORDS.has(x)); };
// Кроки, якими бот сам передає розмову людині — далі відповідати має менеджер.
const HANDOFF_STEPS = /(handoff|post_status_unknown_order|complaint|annoyed|insist|post_unknown|escalat)/;

const CLASS_LABEL = {
    no_reply_bot: 'клієнт без відповіді (бот не на паузі)',
    no_reply_manager: 'клієнт без відповіді (веде менеджер)',
    repeat_ask: 'те саме прохання 3+ рази',
    asked_known_hw: 'питав зріст і вагу, які вже знає',
    duplicate_bot: 'дубль повідомлення бота',
    send_failed: 'відповідь не дійшла (збій каналу)',
    loop_handoff: 'бот здався «щоб не ганяти по колу»',
    complaint: 'скарга / роздратування клієнта',
    open_question: 'питання клієнта лишилось без відповіді',
    sale_on_status: 'продаж замість відповіді про замовлення',
    product_unknown: 'не визначив товар із поста/реклами/фото',
    ai_down: 'ШІ не відповів — хід пропущено',
};
// Класи, за які відповідає бот (частка помилок бота). no_reply_manager — окремо: це черга менеджерів.
const BOT_CLASSES = Object.keys(CLASS_LABEL).filter((k) => k !== 'no_reply_manager');

let _hw = null;
function hwHelpers() {
    if (!_hw) {
        const { extractHeightWeight } = require('../shopAgent/understand');
        const { stripKnownHwAsk } = require('../shopAgent/index');
        _hw = { extractHeightWeight, asksHw: (t) => { const s = String(t || ''); return !!s && stripKnownHwAsk(s) !== s; } };
    }
    return _hw;
}

const md = (m) => m.metadata || {};
const step = (m) => String(md(m).nodeId || '').replace(/^agent:/, '').split('+').pop(); // «pay_q+pay_options» → pay_options (як asks.slotOf)
const isBot = (m) => m.role === 'assistant' && md(m).source === 'shop_agent';
const isManager = (m) => m.role === 'assistant' && md(m).source === 'zernio_inbox';

/**
 * Детектори для однієї розмови. msgs — повідомлення за [from-24 год, to+15 хв] по зростанню; turns — знімки ходів у [from, to].
 * Повертає [{ cls, at, detail }] лише для подій у вікні [from, to].
 */
function detectSession(msgs, turns, { from, to, now = Date.now() }) {
    const out = []; const inWin = (d) => d >= from && d <= to;
    const { extractHeightWeight, asksHw } = hwHelpers();
    // no_reply: останнє повідомлення пачки клієнта без жодної нашої відповіді (бот чи менеджер) за 10 хв
    for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i]; if (m.role !== 'user' || !inWin(m.createdAt)) continue;
        const c = String(m.content || '').trim();
        if (!c || /^\[порожнє/.test(c) || isClosing(c)) continue;
        const t = m.createdAt.getTime();
        // Наступне ЗМІСТОВНЕ повідомлення клієнта (а не «Дякую, чекаю» після питання — інакше питання ховалось).
        const nextUser = msgs.slice(i + 1).find((x) => x.role === 'user' && !isClosing(String(x.content || '').trim()));
        if (nextUser && nextUser.createdAt.getTime() - t < 3 * 60 * 1000) continue; // не останнє в пачці
        // Хто мав відповідати: останнє наше повідомлення до клієнта — від менеджера, або бот сам передав розмову → менеджер.
        const lastOurs = msgs.slice(0, i).reverse().find((x) => x.role === 'assistant' && !md(x).hidden);
        const managerLed = !!lastOurs && (isManager(lastOurs) || (isBot(lastOurs) && HANDOFF_STEPS.test(step(lastOurs))));
        const waitMs = (managerLed ? 20 : 10) * 60 * 1000; // менеджер — людина, бот — 10 хв
        if (now - t < waitMs) continue; // ще рано судити
        const reply = msgs.slice(i + 1).find((x) => x.role === 'assistant' && !md(x).hidden && x.createdAt.getTime() - t <= waitMs);
        if (reply) continue;
        out.push({ cls: managerLed ? 'no_reply_manager' : 'no_reply_bot', at: m.createdAt, detail: c.slice(0, 80) });
    }
    // repeat_ask: те саме прохання 3+ рази
    const counts = {};
    for (const m of msgs) if (isBot(m) && inWin(m.createdAt) && ASK_STEPS.test(step(m))) { counts[step(m)] = (counts[step(m)] || []); counts[step(m)].push(m); }
    for (const [s, arr] of Object.entries(counts)) if (arr.length >= 3) out.push({ cls: 'repeat_ask', at: arr[2].createdAt, detail: s + ' ×' + arr.length });
    // asked_known_hw, duplicate_bot, send_failed, loop_handoff, complaint
    let prevBot = null;
    for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m.role === 'assistant' && md(m).status === 'failed' && inWin(m.createdAt)) out.push({ cls: 'send_failed', at: m.createdAt, detail: String(md(m).deliveryError || '').slice(0, 80) });
        if (!isBot(m)) continue;
        const s = step(m); const txt = String(m.content || '').trim();
        if (inWin(m.createdAt)) {
            if (s === 'loop_handoff') out.push({ cls: 'loop_handoff', at: m.createdAt, detail: '' });
            if (/^(complaint|annoyed)/.test(s)) out.push({ cls: 'complaint', at: m.createdAt, detail: s });
            if (txt && asksHw(txt) && msgs.slice(0, i).some((x) => x.role === 'user' && extractHeightWeight(String(x.content || '')))) out.push({ cls: 'asked_known_hw', at: m.createdAt, detail: txt.slice(0, 60) });
            if (txt && prevBot && String(prevBot.content || '').trim() === txt && m.createdAt - prevBot.createdAt < 3 * 60 * 1000) out.push({ cls: 'duplicate_bot', at: m.createdAt, detail: txt.slice(0, 60) });
        }
        if (txt) prevBot = m;
    }
    // зі знімків ходу
    for (const t of turns) {
        const u = t.understanding || {}; const steps = (t.out || []).map((o) => String(o.step || '').split('+').pop());
        if (u._error && !u._offlineParse) out.push({ cls: 'ai_down', at: t.createdAt, detail: String(u._error).slice(0, 80) });
        const open = (t.questions || []).filter((q) => q && q.status === 'open');
        if (open.length && steps.length) out.push({ cls: 'open_question', at: t.createdAt, detail: String(open[0].text || '').slice(0, 80) });
        if (u.statusQuestion && steps.some((x) => SALE_STEPS.test(x))) out.push({ cls: 'sale_on_status', at: t.createdAt, detail: steps.join(',') });
        const inp = t.input || {};
        if ((inp.sharedPost || inp.entryAdId || inp.imageUrl) && steps.some((x) => /^(unknown|post_unknown_handoff)$/.test(x))) out.push({ cls: 'product_unknown', at: t.createdAt, detail: steps.join(',') });
    }
    return out;
}

/** Якість за період: частка розмов з помилкою, класи, приклади. */
async function qualityForPeriod(botId, from, to, { now = Date.now() } = {}) {
    const sess = await db.$queryRawUnsafe(`select distinct m."sessionId" id from messages m join sessions s on s.id = m."sessionId"
        where s."botId" = $1 and not s."isTest" and m."createdAt" between $2 and $3`, botId, from, to);
    const ids = sess.map((r) => r.id);
    const res = { botId, from, to, clientConversations: 0, botConversations: 0, defectSessions: 0, byClass: {}, examples: {} };
    for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const msgs = await db.message.findMany({ where: { sessionId: { in: chunk }, createdAt: { gte: new Date(from.getTime() - 24 * 3600 * 1000), lte: new Date(to.getTime() + 15 * 60 * 1000) } }, orderBy: { createdAt: 'asc' }, select: { sessionId: true, role: true, content: true, createdAt: true, metadata: true } });
        const turns = await db.$queryRawUnsafe(`select "sessionId", "createdAt", "input", "understanding", "questions", "out" from agent_turns where "sessionId" = any($1::text[]) and "createdAt" between $2 and $3`, chunk, from, to).catch(() => []);
        const bySess = {}; for (const m of msgs) (bySess[m.sessionId] = bySess[m.sessionId] || []).push(m);
        const turnsBy = {}; for (const t of turns) (turnsBy[t.sessionId] = turnsBy[t.sessionId] || []).push(t);
        for (const sid of chunk) {
            const list = bySess[sid] || [];
            const inWin = list.filter((m) => m.createdAt >= from && m.createdAt <= to);
            if (inWin.some((m) => m.role === 'user')) res.clientConversations++;
            const botHere = inWin.some(isBot);
            if (botHere) res.botConversations++;
            const defects = detectSession(list, turnsBy[sid] || [], { from, to, now });
            const botDefect = defects.some((d) => BOT_CLASSES.includes(d.cls));
            if (botDefect) res.defectSessions++;
            const seen = new Set();
            for (const d of defects) {
                if (seen.has(d.cls)) continue; seen.add(d.cls); // клас рахуємо раз на розмову
                res.byClass[d.cls] = (res.byClass[d.cls] || 0) + 1;
                (res.examples[d.cls] = res.examples[d.cls] || []).push({ sessionId: sid, at: d.at, detail: d.detail });
            }
        }
    }
    res.defectRate = res.botConversations ? res.defectSessions / res.botConversations : 0;
    for (const k of Object.keys(res.examples)) res.examples[k] = res.examples[k].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
    return res;
}

function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + '%'; }

/** Текст звіту для Telegram (порівняння з попереднім днем, якщо є). */
function formatReport(res, prev, { shopTag = '', dayLabel = '' } = {}) {
    const lines = [];
    lines.push((shopTag ? '🏪 ' + shopTag + '\n' : '') + '📊 Якість бота' + (dayLabel ? ' за ' + dayLabel : ''));
    const d = prev && prev.botConversations ? ' (учора ' + pct(prev.defectRate) + ')' : '';
    lines.push('Розмов, де відповідав бот: ' + res.botConversations + ' · з помилкою: ' + res.defectSessions + ' — ' + pct(res.defectRate) + d);
    const order = Object.keys(CLASS_LABEL).filter((k) => res.byClass[k]).sort((a, b) => res.byClass[b] - res.byClass[a]);
    if (!order.length) lines.push('Помилок за детекторами не знайдено ✅');
    for (const k of order) {
        const was = prev && prev.byClass ? (prev.byClass[k] || 0) : null;
        lines.push('• ' + CLASS_LABEL[k] + ': ' + res.byClass[k] + (was !== null ? ' (учора ' + was + ')' : ''));
    }
    const top = order.filter((k) => BOT_CLASSES.includes(k)).slice(0, 3);
    if (top.length) {
        lines.push('\nПриклади:');
        for (const k of top) for (const e of res.examples[k].slice(0, 2)) lines.push('— ' + CLASS_LABEL[k] + ': https://flows.fineko.space/sessions/' + e.sessionId + (e.detail ? ' «' + String(e.detail).slice(0, 50) + '»' : ''));
    }
    return lines.join('\n');
}

module.exports = { detectSession, qualityForPeriod, formatReport, CLASS_LABEL, BOT_CLASSES, pct, isClosing };
