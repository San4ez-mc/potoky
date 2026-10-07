'use strict';
/**
 * shopAgent/index.js — оркестратор одного ходу агента-продавця.
 *
 * handleTurn({ botId, sessionId, text, imageUrl, sharedPost, entryAdId }):
 *   1) вантажить сесію, активи (коди нод, шаблони, ключі), памʼять клієнта між розмовами;
 *   2) будує історію з БД (клієнт + бот + менеджер) — одна памʼять для всіх кроків;
 *   3) understand → runPolicy → зберігає context і кладе відповіді в messages (доставку робить
 *      zernioHandler.runFlowAndDeliver так само, як для старого графа).
 * Увімкнення на боті: settings.engine === 'shop_agent_v2' або funnelKey SHOP_AGENT_V2=1.
 */
const { db, logger, loadAssets, cleanJsonDeep, mergeConsecutiveTextOutputs, runNodeCode, nodeCode } = require('./lib');
const { geminiKeys } = require('../geminiKey');
const { resolveIgLink, LINK_RE } = require('./igLink');
const { understand } = require('./understand');
const { runPolicy, matchColor, breakLoop } = require('./policy');
const { textFromJsonLike } = require('./compose');
const _noCreditBotAlertAt = new Map(); // botId -> ts загального сигналу «кредити Claude закінчились»

/** Прибрати з ВЛАСНОГО тексту бота речення, що просять зріст і вагу (викликається, лише коли вони вже відомі). */
const HW_ASK = { h: /(зріст|зросту|ріст|рост)/i, w: /(ваг|вес)/i, verb: /(підкажіть|напишіть|вкажіть|скажіть|надішліть|дайте|уточніть|потрібн|лишилось\s+дізнатись)/i, keep: /(підібрал|рекоменд|за вашими|беру ваш|для\s+(сина|доньк|дружин|чолові|другої|іншої|другого|іншого))/i };
/** Прибрати з ВЛАСНОГО тексту бота речення-питання певного виду (isAsk(речення) → true); решта повідомлення лишається.
 * Спільне для всіх видів питань (зріст/вага, колір, адреса, комплект) — див. ASK_KINDS. */
function stripAskSentences(text, isAsk) {
    const lines = String(text).split('\n').map((line) => {
        const parts = line.split(/(?<=[.!?…])\s+|(?<=\p{Extended_Pictographic}️?)\s+(?=[А-ЯІЇЄҐA-Z👉])/u);
        let dropped = false;
        let kept = parts.filter((s) => {
            if (isAsk(s)) { dropped = true; return false; }
            // «Напишіть їх, будь ласка» одразу після прибраного прохання — теж прохання.
            if (dropped && /^(напишіть|підкажіть|вкажіть|надішліть)\s+(їх|це)/i.test(s.trim())) return false;
            return true;
        });
        if (!dropped) return line;
        kept = kept.filter((s) => s.replace(/[\p{Extended_Pictographic}️\s.,!?—-]/gu, '')); // «👉» без тексту — залишок рядка
        return kept.join(' ').trim();
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** Довгий текст бота одним рядком → абзаци по реченнях (Edits f28a08a5, adc3eb0d, cef935e2/33d24987, f121b8c5: «так значно
 * гарніше, ніж суцільним текстом»). Одне правило на виході для всіх джерел тексту (compose, шаблони, склеєні в коді відповіді),
 * а не правка кожного шаблону окремо. Текст, що вже має переноси, не чіпаємо; «1. Кофта» не розриваємо; дуже коротке речення
 * лишається з наступним. */
function paragraphize(text) {
    const s = String(text || '').trim();
    if (s.length < 140 || s.includes('\n')) return s;
    const parts = s.split(/(?<=[^\d\s][.!?…])\s+(?=[А-ЯІЇЄҐA-Z«"])|(?<=\p{Extended_Pictographic}️?)\s+(?=[А-ЯІЇЄҐA-Z«"])/u).map((x) => x.trim()).filter(Boolean);
    const paras = [];
    for (const p of parts) { if (paras.length && paras[paras.length - 1].length < 40) paras[paras.length - 1] += ' ' + p; else paras.push(p); }
    // Нумерований перелік в одному реченні («1. Кофта … 2. Джинси …») — кожен пункт з нового рядка.
    const out = paras.map((p) => ((p.match(/(^|\s)\d{1,2}\.\s/g) || []).length >= 2 ? p.replace(/\s(?=\d{1,2}\.\s)/g, '\n') : p));
    return out.length < 2 && out[0] === s ? s : out.join('\n\n');
}
const isHwAsk = (s) => HW_ASK.h.test(s) && HW_ASK.w.test(s) && HW_ASK.verb.test(s) && !HW_ASK.keep.test(s);
function stripKnownHwAsk(text) { return stripAskSentences(text, isHwAsk); }
/** Види питань бота (розпізнаються за ВЛАСНИМИ текстами бота — це дані, не зміст клієнта). Що вже відоме — не питаємо; що бот уже
 * спитав після повідомлення клієнта, на яке зараз відповідає (або менш як 90 с тому), — не повторюємо (2026-10-05, категорії
 * «Дублює повідомлення» і «Памʼять діалогу»: раніше кожен шлях лікували окремо — картка+питання, сітка, допродаж, підтвердження). */
const ASK_KINDS = [
    { kind: 'hw', isAsk: isHwAsk },
    { kind: 'color', isAsk: (s) => /(оберіть\s+колір|який\s+колір\s+обираєте|лишилось\s+(лише\s+)?обрати\s+колір|ще\s+раз\s+про\s+колір)/i.test(s) },
    { kind: 'address', isAsk: (s) => /(ПІБ|дані\s+для\s+відправки|для\s+відправки\s+Новою\s+Поштою|відділення\s+або\s+поштомат)/i.test(s) && /(напишіть|можна\s+написати|надішліть|вкажіть|підкажіть)/i.test(s) },
    { kind: 'set', isAsk: (s) => /весь\s+комплект,?\s+чи\s+окрем/i.test(s) },
];

const _engineCache = new Map();
async function isAgentBot(botId) {
    const c = _engineCache.get(botId); if (c && Date.now() - c.at < 30 * 1000) return c.v;
    let v = false;
    try {
        const bot = await db.bot.findUnique({ where: { id: botId }, select: { settings: true } });
        if (bot && bot.settings && bot.settings.engine === 'shop_agent_v2') v = true;
        else { const k = await db.funnelKey.findFirst({ where: { botId, key: 'SHOP_AGENT_V2' }, select: { value: true } }); v = !!(k && /^(1|true|on)$/i.test(String(k.value || '').trim())); }
    } catch (e) { v = false; }
    _engineCache.set(botId, { at: Date.now(), v });
    return v;
}

/** Памʼять клієнта між розмовами: зріст/вага і доставка з попередніх сесій цього ж користувача. */
async function loadCustomerMemory(session) {
    const prev = await db.session.findMany({ where: { userId: session.userId, botId: session.botId, id: { not: session.id } }, orderBy: { lastActive: 'desc' }, take: 10, select: { context: true } }).catch(() => []);
    const mem = {};
    for (const s of prev) {
        const c = s.context || {}; const si = c.sizeInput || {}; const od = c.orderData || {};
        if (!mem.height && si.height && si.weight) { mem.height = Number(si.height); mem.weight = Number(si.weight); }
        if (!mem.phone && od.phone && od.fullName && od.city && od.branch) Object.assign(mem, { phone: od.phone, fullName: od.fullName, city: od.city, branch: od.branch });
        if (!mem.lastSku && c.product && c.product.sku) mem.lastSku = c.product.sku;
        if (!mem.lastOrderRef && c.orderRef && c.crmOrderId) mem.lastOrderRef = c.orderRef;
    }
    return mem;
}

async function buildHistory(sessionId, limit = 16) {
    const rows = await db.message.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' }, take: limit, select: { role: true, content: true, metadata: true, createdAt: true } });
    return rows.reverse().filter((m) => m.role === 'user' || m.role === 'assistant').filter((m) => !(m.metadata && m.metadata.hidden)).map((m) => ({ who: m.role === 'user' ? 'client' : (((m.metadata || {}).source) === 'zernio_inbox' ? 'manager' : 'bot'), text: String(m.content || '').replace(/https?:\/\/(www\.)?instagram\.com\/\S+/gi, '').trim(), at: m.createdAt, sentAt: (m.metadata && m.metadata.channelCreatedAt) ? new Date(m.metadata.channelCreatedAt) : m.createdAt }));
}

/** Коментар під постом за керування агента: детермінована класифікація (нода n_comment_entry) → ctx.commentReplyText/commentCategory
 * для публічної відповіді. Сам DM клієнту далі веде звичайний handleTurn (приватна відповідь на commentId). */
async function classifyComment({ botId, sessionId, commentText }) {
    const session = await db.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session) return null;
    const assets = await loadAssets(botId);
    const ctx = session.context || {};
    const code = nodeCode(assets, 'n_comment_entry');
    if (!code) return null;
    ctx.commentText = String(commentText || ctx.commentText || '');
    const r = await runNodeCode(code, { ctx, keys: assets.keys, user: session.user || {}, session, input: ctx.commentText, label: 'n_comment_entry' });
    // commentReplyText/commentCategory — лише ОСТАННІЙ коментар (те, що реально постить zernioHandler). Клієнт міг лишити кілька коментарів під одним постом —
    // тримаємо історію окремо (не впливає на продакшн-логіку), інакше знімок стану для тестів/діагностики бачить лише останню публічну відповідь.
    if (ctx.commentReplyText) ctx.commentPublicReplies = [...(Array.isArray(ctx.commentPublicReplies) ? ctx.commentPublicReplies : []), { text: ctx.commentReplyText, category: ctx.commentCategory || '', commentText: ctx.commentText }].slice(-10);
    if (r && r.ok) await db.session.update({ where: { id: sessionId }, data: { context: cleanJsonDeep(ctx) } });
    return { commentReplyText: ctx.commentReplyText || '', commentCategory: ctx.commentCategory || '' };
}

/** Чи обробляє агент коментарі (за замовчуванням так для агент-ботів; ключ COMMENT_AGENT=0 повертає старий шлях). */
async function isCommentAgent(botId) {
    if (!(await isAgentBot(botId))) return false;
    try { const k = await db.funnelKey.findFirst({ where: { botId, key: 'COMMENT_AGENT' }, select: { value: true } }); return !(k && /^(0|false|off)$/i.test(String(k.value || '').trim())); } catch (e) { return true; }
}

async function handleTurn({ botId, sessionId, text, imageUrl, imageUrls, sharedPost, entryAdId, storyId, dryRun }) {
    const session = await db.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session) throw new Error('session not found');
    const assets = await loadAssets(botId);
    const ctx = session.context || {};
    // Пауза від скарги/прохання менеджера, поставлена попереднім ходом, поки це повідомлення чекало в черзі.
    // 2026-09-29 (ed8e3e06): «Передала менеджеру» — і через 6 с бот знову питав колір, бо гейт у zernioHandler читав контекст ДО черги.
    if (!dryRun && ctx.funnelPaused && /^(complaint|handoff|post_unknown|annoyed|loop)$/.test(String(ctx.pausedBy || ''))) {
        logger.info('[shopAgent] turn skipped — session paused', { botId, sessionId, pausedBy: ctx.pausedBy });
        return { replies: [], understanding: {}, trace: [], ctx, paused: true };
    }
    ctx.agent = ctx.agent || { version: 2, turns: 0 };
    ctx.agent.turns = (ctx.agent.turns || 0) + 1;
    if (!ctx.customer) ctx.customer = await loadCustomerMemory(session);
    ctx.lastUserMessage = String(text || ''); ctx.lastCustomerMessage = String(text || '');
    if (imageUrl) { ctx.lastUserImageUrl = imageUrl; ctx.recentUserImageUrl = imageUrl; ctx.recentUserImageAt = Date.now(); }
    // 2026-09-17 (регресія проти вже виправленого 2026-09-04 бага в testSession.js — той самий
    // фікс сюди не переніс при побудові shopAgent v2): фото з попереднього ходу лишалось у
    // lastUserImageUrl НАЗАВЖДИ (нічого його не чистило), тож n_prev_match_snapshot/n_signal_check
    // рахували БУДЬ-ЯКИЙ наступний чисто текстовий хід у ВЖЕ активному діалозі як "свіжий сигнал
    // товару" — n_lookup щоразу заново ганяв повний матчинг (включно з keyword/vision) замість
    // early-return "товар не змінився", і міг підмінити вже коректний товар випадковим схожим SKU
    // (живі кейси: Kolya Kolya/set1111→C0043, anastasia.ze7/A0187→C0043). Фото належить лише
    // своєму ходу — якщо ЦЕЙ хід текстовий і без нового фото, чистимо стару позначку.
    else if (text) delete ctx.lastUserImageUrl;
    // Посилання на допис Instagram текстом — те саме, що пересланий допис (правка f170331d).
    if (!sharedPost && text && LINK_RE.test(String(text))) { const lp = await resolveIgLink(text); if (lp) sharedPost = lp; }
    if (sharedPost) ctx.sharedPost = sharedPost;
    // Кілька фото одним повідомленням — розпізнаються разом (productMatch: lastUserImageUrls).
    if (Array.isArray(imageUrls) && imageUrls.length > 1) ctx.lastUserImageUrls = imageUrls.slice(0, 4); else delete ctx.lastUserImageUrls;
    const newEntryAd = !!(entryAdId && entryAdId !== ctx.agent.seenEntryAd);
    if (entryAdId) { ctx.entryAdId = entryAdId; ctx.agent.seenEntryAd = entryAdId; }
    let adTouchChanged = false;
    // Дотики реклами для CRM (2026-10-06): з 13.09 жодне замовлення не мало реклами — графовий рушій ставив firstEntryAdId на першому
    // кроці, агент цього не робив. Перший дотик — реклама, з якої людина вперше прийшла (не змінюється); останній — найсвіжіша.
    // Передаються з кожною подією картки (tools.funnelStage) — CRM сам знаходить оголошення за Meta-id.
    {
        const adNow = entryAdId || ctx.entryAdId;
        if (adNow) {
            const t = ctx.adTouch || {};
            if (!t.first) { t.first = { externalId: String(adNow), at: new Date().toISOString(), name: ctx.adTitle || null }; adTouchChanged = true; }
            if (!t.last || t.last.externalId !== String(adNow)) { t.last = { externalId: String(adNow), at: new Date().toISOString(), name: ctx.adTitle || null }; adTouchChanged = true; }
            ctx.adTouch = t;
        }
    }
    const history = await buildHistory(sessionId);
    const botSpokeBefore = history.some((m) => m.who === 'bot');
    // Ключі Gemini по черзі (власний → конектор воронки) — щоб вичерпаний ключ воронки не клав розпізнавання фото (2026-09-29).
    let turnKeys = assets.keys;
    try { turnKeys = Object.assign({}, assets.keys, { __geminiKeys: await geminiKeys(botId, assets.keys) }); } catch (e) { /* лишаємо як є */ }
    const A = { botId, session, ctx, keys: turnKeys, assets, user: session.user ? { id: session.user.id, firstName: session.user.firstName, username: session.user.username } : {}, trace: [], out: [], turnText: String(text || ''), turnImage: imageUrl || null, turnSharedPost: sharedPost || (ctx.sharedPost && ctx.hasFreshSignalThisTurn ? ctx.sharedPost : null), newEntryAd, turnStory: storyId || null, history, botSpokeBefore };
    if (session.isTest || ctx.testMode) ctx.testMode = true;
    const t0 = Date.now();
    const u = await understand(A);
    // ШІ недоступний і повідомлення без однозначних даних (30.09 20:21–20:24 — усі провайдери без балансу): відповідати навмання
    // гірше, ніж мовчати («Мені ще потрібні зріст і вага» тричі поспіль). Не відповідаємо — повідомлення лишається невідповіданим, і
    // retryMissedZernioTurns повторить хід, щойно ШІ повернеться; менеджеру — один сигнал на сесію за 30 хв.
    if (u._error && !u._offlineParse && !dryRun) {
        logger.warn('[shopAgent] AI unavailable — turn skipped (will retry)', { botId, sessionId, error: String(u._error).slice(0, 160) });
        // Закінчились кредити Claude (рішення власника 30.09): бот нічого не відповідає, кличе менеджера — загальний сигнал раз на годину
        // на весь бот + сигнал про КОЖНОГО клієнта, що чекає. Щойно баланс поповнять, бот працює далі сам.
        if (u._noCredit && (!_noCreditBotAlertAt.get(botId) || Date.now() - _noCreditBotAlertAt.get(botId) > 60 * 60 * 1000)) {
            _noCreditBotAlertAt.set(botId, Date.now());
            try { await require('./tools').alert(A, { title: '💸 Закінчились кредити Claude — бот НЕ відповідає клієнтам', main: 'Поповніть баланс Anthropic. Поки баланс порожній, бот мовчить і шле сюди сигнал про кожного клієнта — відповідайте вручну.', details: String(u._error).slice(0, 200) }); } catch (e) { /* best-effort */ }
        }
        if (!ctx.agent.aiDownAlertAt || Date.now() - ctx.agent.aiDownAlertAt > 30 * 60 * 1000) {
            ctx.agent.aiDownAlertAt = Date.now();
            try { await require('./tools').alert(A, { title: u._noCredit ? '💸 Кредити Claude закінчились — клієнт чекає, відповідайте вручну' : '⚠️ ШІ недоступний — бот не може відповісти', main: 'Клієнт чекає відповіді: «' + String(text || '').slice(0, 200) + '»', details: (u._noCredit ? 'Бот мовчить, поки не поповнять баланс Anthropic.' : 'Причина: ' + String(u._error).slice(0, 200) + '\nБот повторить відповідь сам, щойно ШІ відновиться; якщо терміново — відпишіть вручну.') }); } catch (e) { /* best-effort */ }
        }
        await db.session.update({ where: { id: sessionId }, data: { context: cleanJsonDeep(ctx) } }).catch(() => {});
        return { replies: [], understanding: u, trace: A.trace, ctx, aiDown: true };
    }
    try { await runPolicy(A, u); }
    catch (e) {
        logger.error('[shopAgent] policy failed: ' + e.message, { sessionId, stack: e.stack });
        A.trace.push({ error: e.message });
        if (!A.out.length) A.out.push({ text: 'Секунду, перевіряю інформацію 🙂 Якщо не відповім за хвилину — менеджер уже підключається.', step: 'error' });
        await db.appError.create({ data: { sessionId, botId, errorType: 'shop_agent', message: e.message, stack: String(e.stack || '').slice(0, 4000), context: { step: 'policy' } } }).catch(() => {});
    }
    // Кредити Claude закінчились посеред ходу (аналізатор встиг, складання відповіді — ні): нічого не відправляємо, кличемо менеджера.
    if (A._noCredit && !dryRun) {
        A.out = [];
        logger.warn('[shopAgent] Claude credit ran out mid-turn — no reply', { botId, sessionId });
        if (!ctx.agent.aiDownAlertAt || Date.now() - ctx.agent.aiDownAlertAt > 30 * 60 * 1000) {
            ctx.agent.aiDownAlertAt = Date.now();
            try { await require('./tools').alert(A, { title: '💸 Кредити Claude закінчились — клієнт чекає, відповідайте вручну', main: 'Клієнт чекає відповіді: «' + String(text || '').slice(0, 200) + '»', details: 'Бот мовчить, поки не поповнять баланс Anthropic.' }); } catch (e) { /* best-effort */ }
        }
    }
    if (adTouchChanged && !dryRun) require('./tools').adTouchSync(A).catch(() => {});
    // Підтвердження зміни вибору («лише кофта») — перед першим текстом цього ходу, щоб клієнт бачив, що його почули.
    if (A._switchNote && !A._noCredit) { const firstText = A.out.find((o) => o.text && !o.photoUrls); if (firstText) firstText.text = A._switchNote + firstText.text; else A.out.push({ text: A._switchNote.trim(), step: 'set_switch' }); }
    // одноразові прапорці ходу
    delete ctx.productJustPresented; delete ctx.hasFreshSignalThisTurn; delete ctx.sharedPost;
    ctx.agent.lastTurnAt = new Date().toISOString(); ctx.agent.lastIntent = u.intent; ctx.agent.lastTrace = A.trace.slice(-12);
    // 2026-09-15 (власник): архітектурне рішення для «2 повідомлення поспіль без відповіді клієнта
    // між ними» — зливаємо ПОСПІЛЬ ідучі чисто текстові виходи одного ходу в одне повідомлення тут,
    // в ОДНОМУ місці для всієї policy.js, а не точково в кожній секції окремо. Див. lib.js.
    A.out = mergeConsecutiveTextOutputs(A.out);
    // Остання лінія захисту (2026-09-30): сирий/обірваний JSON моделі клієнту не йде ніколи — хоч би з якого місця policy він прийшов.
    const outBefore = A.out.length;
    A.out = A.out.map((o) => {
        if (!o.text || !/^\s*[{[]|"text"\s*:/.test(o.text)) return o;
        const t = textFromJsonLike(o.text);
        logger.warn('[shopAgent] JSON у тексті відповіді — очищено', { sessionId, step: o.step, broken: t === null });
        return t ? Object.assign({}, o, { text: t }) : (o.photoUrls ? Object.assign({}, o, { text: undefined }) : null);
    }).filter(Boolean);
    if (outBefore && !A.out.length) A.out.push({ text: 'Секунду, перевіряю інформацію 🙂 Якщо не відповім за хвилину — менеджер уже підключається.', step: 'error' });
    // Інваріант (01.10, 59 випадків з 08.09): зріст і вага вже відомі — жодне повідомлення цього ходу їх не просить, хоч би звідки
    // прийшов текст (картка з CRM, шаблон ноди, compose). Прибираємо лише речення-прохання, решту повідомлення лишаємо.
    if (ctx.sizeInput && ctx.sizeInput.height && ctx.sizeInput.weight) {
        A.out = A.out.map((o) => {
            if (!o.text) return o;
            const t = stripKnownHwAsk(o.text);
            if (t === o.text) return o;
            logger.info('[shopAgent] прохання зросту/ваги прибрано — вже відомі', { sessionId, step: o.step });
            return t ? Object.assign({}, o, { text: t }) : (o.photoUrls ? Object.assign({}, o, { text: undefined }) : null);
        }).filter(Boolean);
    }
    // Інваріант «не питати відоме й не повторювати щойно поставлене» (див. ASK_KINDS) + дубль цілого повідомлення.
    {
        const pr = ctx.product || {};
        const od = ctx.orderData || {};
        const known = {
            color: !pr.isSet && !!(ctx.colorChoice && (ctx.colorChoice.color || (Array.isArray(ctx.colorChoice.colors) && ctx.colorChoice.colors.length))),
            address: !!(od.phone && od.fullName && od.city && od.branch),
            set: !!(pr.isSet && ctx.setMode),
        };
        // Частково відомо (лише зріст / частина адреси) — дозапит легітимний, повтором не вважаємо.
        const partial = { hw: !!(ctx.sizeInput && (!!ctx.sizeInput.height !== !!ctx.sizeInput.weight)), address: !!(od.phone || od.fullName || od.city || od.branch) && !known.address };
        const hist = Array.isArray(A.history) ? A.history : [];
        const clientAt = Math.max(0, ...hist.filter((m) => m.who === 'client').map((m) => new Date(m.sentAt || m.at).getTime()));
        const nowT = Date.now();
        // Лише бот, що говорив ПІСЛЯ того, як клієнт написав повідомлення цього ходу (клієнт його ще не бачив, — пачка, дубль вебхука).
        // Не «за останні 90 с»: клієнт відповів на картку («чорну і сіру») — повторне прохання зросту/ваги легітимне, інакше бот мовчить.
        // Повідомлення клієнта в історії нема (тестовий прогін, сервісний хід) — повторів не визначаємо, лише «вже відоме».
        const recentBot = clientAt ? hist.filter((m) => m.who === 'bot' && new Date(m.at).getTime() > clientAt && nowT - new Date(m.at).getTime() < 10 * 60 * 1000) : [];
        const askedRecently = (kd) => recentBot.some((m) => String(m.text || '').split(/(?<=[.!?…])\s+|\n/).some((snt) => kd.isAsk(snt)));
        const drop = ASK_KINDS.filter((kd) => known[kd.kind] || (!partial[kd.kind] && askedRecently(kd)));
        if (drop.length) {
            A.out = A.out.map((o) => {
                if (!o.text || o.noMerge) return o;
                const t = stripAskSentences(o.text, (snt) => drop.some((kd) => kd.isAsk(snt)));
                if (t === o.text) return o;
                logger.info('[shopAgent] питання прибрано — вже відоме або щойно поставлене', { sessionId, step: o.step, kinds: drop.map((d) => d.kind) });
                return t ? Object.assign({}, o, { text: t }) : (o.photoUrls ? Object.assign({}, o, { text: undefined }) : null);
            }).filter(Boolean);
        }
        // Повідомлення, майже дослівно таке саме, як бот уже надіслав (після повідомлення клієнта або < 90 с тому), — не дублюємо.
        const stems = (t) => new Set(String(t || '').toLowerCase().split(/[^a-zа-яіїєґ0-9]+/i).filter((w) => w.length >= 4).map((w) => w.slice(0, 6)));
        const sim = (a, b) => { const x = stems(a), y = stems(b); if (!x.size || !y.size) return 0; let n = 0; for (const w of x) if (y.has(w)) n++; return n / Math.max(x.size, y.size); };
        A.out = A.out.filter((o) => {
            if (!o.text || o.photoUrls || o.noMerge || String(o.text).length < 25) return true;
            const dup = recentBot.some((m) => sim(o.text, m.text) >= 0.85);
            if (dup) logger.info('[shopAgent] дубль повідомлення не надіслано', { sessionId, step: o.step });
            return !dup;
        });
    }
    // Інваріант «обіцяне фото = надіслане фото» (Edit 5283717f: «Ось фото сірого кольору», «Фото надішлю окремим повідомленням» —
    // а фото не було; той самий клас, що й «надсилаю сітку» без сітки 18.09). Текст бота обіцяє фото, а фото в ході нема → додаємо
    // фото товару (для названого кольору — фото саме цього кольору з офера CRM); нема жодного — прибираємо обіцянку.
    {
        const PHOTO_CLAIM = /(ось\s+(і\s+)?фото|надсилаю\s+(вам\s+)?фото|надішлю\s+(вам\s+)?фото|фото\s+надішлю|фото\s+надсилаю|зараз\s+надішлю\s+фото|ловіть\s+фото|показую\s+фото)/i;
        const claimed = A.out.filter((o) => o.text && PHOTO_CLAIM.test(o.text));
        if (claimed.length && !A.out.some((o) => Array.isArray(o.photoUrls) && o.photoUrls.length)) {
            const pr = ctx.product || {};
            const base = (A.keys.CRM_PUBLIC_BASE || 'https://pcrm.fineko.space').replace(/\/$/, '');
            const abs = (u0) => (/^https?:/.test(String(u0)) ? String(u0) : base + (String(u0).charAt(0) === '/' ? u0 : '/' + u0));
            let urls = [];
            const col = pr.colors ? (matchColor(pr, String(A.turnText || '')) || matchColor(pr, claimed.map((o) => o.text).join(' '))) : null;
            if (col) for (const of of (pr.offers || [])) { const pc = (of.properties || []).find((q) => /кол|цвет/i.test(q.name || '')); if (pc && String(pc.value).toLowerCase() === String(col).toLowerCase() && Array.isArray(of.images)) urls.push(...of.images.map(abs)); }
            if (!urls.length) urls = (Array.isArray(pr.imageUrls) ? pr.imageUrls : []).filter((x) => /^https?:/.test(String(x)));
            if (urls.length) { A.out.unshift({ photoUrls: [...new Set(urls)].slice(0, 5), caption: '', step: 'photo_promised' }); logger.info('[shopAgent] обіцяне фото додано', { sessionId, color: col || null }); }
            else A.out = A.out.map((o) => (o.text && PHOTO_CLAIM.test(o.text) ? Object.assign({}, o, { text: stripAskSentences(o.text, (snt) => PHOTO_CLAIM.test(snt)) }) : o)).filter((o) => o.text || o.photoUrls);
        }
    }
    // Абзаци замість суцільного рядка (paragraphize) — для всіх текстів, крім полів для копіювання (noMerge).
    A.out = A.out.map((o) => (o.text && !o.noMerge ? Object.assign({}, o, { text: paragraphize(o.text) }) : o));
    // Одне й те саме фото (картка товару + прев'ю зі списку, обкладинка й фото кольору) не надсилаємо двічі за один хід.
    {
        const seenPhotos = new Set();
        const photoKey = (u) => { try { const x = new URL(String(u)); return x.searchParams.get('asset_id') || x.pathname.split('/').pop(); } catch (e) { return String(u).split('?')[0].split('/').pop(); } };
        // Фото, надіслані клієнту за останні 30 хв (прев'ю зі списку → картка того ж товару), повторно не шлемо; явні повтори (сітка, «ще раз») — шлемо.
        const now = Date.now(); const recent = ctx.agent.sentPhotoKeys || {};
        for (const k of Object.keys(recent)) if (now - recent[k] > 30 * 60 * 1000) delete recent[k];
        // Картка товару (present_photo) показує всі кольори, навіть якщо якесь фото вже мигнуло в прев'ю списку ходом раніше
        // (2026-09-30, правки e1755083/080559bb: у картці A0187 не було світло-сірої — її «з'їв» 30-хвилинний фільтр після прев'ю).
        const RESEND_OK = /^(photo_again|size_chart|photo_on_demand|present_photo)/;
        A.out = A.out.map((o) => {
            if (!o.photoUrls || !o.photoUrls.length) return o;
            const resend = RESEND_OK.test(String(o.step || ''));
            const urls = o.photoUrls.filter((u) => { const k = photoKey(u); if (!k || seenPhotos.has(k) || (!resend && recent[k])) return false; seenPhotos.add(k); return true; });
            urls.forEach((u) => { recent[photoKey(u)] = now; });
            if (!urls.length && o.caption) return { text: o.caption, step: o.step };
            return { ...o, photoUrls: urls, _hadPhotos: true };
        }).filter((o) => !(o._hadPhotos && !o.photoUrls.length && !o.text && !o.caption));
        ctx.agent.sentPhotoKeys = recent;
    }
    // Запобіжник «зациклився» — ОСТАННІМ, по тому, що клієнт реально отримає (після прибирання дублів/відомих питань): 07.10 він
    // рахував прохання, які потім прибирались як дублі, і ходи пачки (5 пересилань поста за 14 с) — менеджер отримав хибне «зациклився».
    if (!A._noCredit && !dryRun) { try { await breakLoop(A); } catch (e) { logger.warn('[shopAgent] breakLoop failed: ' + e.message, { sessionId }); } }
    const replies = [];
    if (!dryRun) {
        for (const o of A.out) {
            if (o.photoUrls && o.photoUrls.length) await db.message.create({ data: cleanJsonDeep({ sessionId, role: 'assistant', content: o.caption || '', metadata: { source: 'shop_agent', nodeId: 'agent:' + o.step, nodeType: 'sendPhoto', attachment: { type: 'photo', url: o.photoUrls[0], urls: o.photoUrls, caption: o.caption || '' } } }) });
            else if (o.text && String(o.text).trim()) await db.message.create({ data: cleanJsonDeep({ sessionId, role: 'assistant', content: String(o.text).trim(), metadata: { source: 'shop_agent', nodeId: 'agent:' + o.step } }) });
            replies.push(o);
        }
        await db.session.update({ where: { id: sessionId }, data: { context: cleanJsonDeep(ctx), lastActive: new Date(), state: ctx.crmOrderId ? 'ordered' : (ctx.product && ctx.product.sku ? 'consulting' : 'inbox') } });
    } else replies.push(...A.out);
    logger.info('[shopAgent] turn', { botId, sessionId, ms: Date.now() - t0, intent: u.intent, out: A.out.map((o) => o.step), paused: !!ctx.funnelPaused });
    return { replies, understanding: u, trace: A.trace, ctx };
}

module.exports = { handleTurn, classifyComment, isCommentAgent, isAgentBot, loadCustomerMemory, buildHistory, stripKnownHwAsk, stripAskSentences, ASK_KINDS, paragraphize };
