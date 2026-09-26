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
const { understand } = require('./understand');
const { runPolicy } = require('./policy');

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
    return rows.reverse().filter((m) => m.role === 'user' || m.role === 'assistant').filter((m) => !(m.metadata && m.metadata.hidden)).map((m) => ({ who: m.role === 'user' ? 'client' : (((m.metadata || {}).source) === 'zernio_inbox' ? 'manager' : 'bot'), text: String(m.content || '').replace(/https?:\/\/(www\.)?instagram\.com\/\S+/gi, '').trim(), at: m.createdAt }));
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
    if (r && r.ok) await db.session.update({ where: { id: sessionId }, data: { context: cleanJsonDeep(ctx) } });
    return { commentReplyText: ctx.commentReplyText || '', commentCategory: ctx.commentCategory || '' };
}

/** Чи обробляє агент коментарі (за замовчуванням так для агент-ботів; ключ COMMENT_AGENT=0 повертає старий шлях). */
async function isCommentAgent(botId) {
    if (!(await isAgentBot(botId))) return false;
    try { const k = await db.funnelKey.findFirst({ where: { botId, key: 'COMMENT_AGENT' }, select: { value: true } }); return !(k && /^(0|false|off)$/i.test(String(k.value || '').trim())); } catch (e) { return true; }
}

async function handleTurn({ botId, sessionId, text, imageUrl, sharedPost, entryAdId, dryRun }) {
    const session = await db.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session) throw new Error('session not found');
    const assets = await loadAssets(botId);
    const ctx = session.context || {};
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
    if (sharedPost) ctx.sharedPost = sharedPost;
    const newEntryAd = !!(entryAdId && entryAdId !== ctx.agent.seenEntryAd);
    if (entryAdId) { ctx.entryAdId = entryAdId; ctx.agent.seenEntryAd = entryAdId; }
    const history = await buildHistory(sessionId);
    const botSpokeBefore = history.some((m) => m.who === 'bot');
    const A = { botId, session, ctx, keys: assets.keys, assets, user: session.user ? { id: session.user.id, firstName: session.user.firstName, username: session.user.username } : {}, trace: [], out: [], turnText: String(text || ''), turnImage: imageUrl || null, turnSharedPost: sharedPost || (ctx.sharedPost && ctx.hasFreshSignalThisTurn ? ctx.sharedPost : null), newEntryAd, history, botSpokeBefore };
    if (session.isTest || ctx.testMode) ctx.testMode = true;
    const t0 = Date.now();
    const u = await understand(A);
    try { await runPolicy(A, u); }
    catch (e) {
        logger.error('[shopAgent] policy failed: ' + e.message, { sessionId, stack: e.stack });
        A.trace.push({ error: e.message });
        if (!A.out.length) A.out.push({ text: 'Секунду, перевіряю інформацію 🙂 Якщо не відповім за хвилину — менеджер уже підключається.', step: 'error' });
        await db.appError.create({ data: { sessionId, botId, errorType: 'shop_agent', message: e.message, stack: String(e.stack || '').slice(0, 4000), context: { step: 'policy' } } }).catch(() => {});
    }
    // одноразові прапорці ходу
    delete ctx.productJustPresented; delete ctx.hasFreshSignalThisTurn; delete ctx.sharedPost;
    ctx.agent.lastTurnAt = new Date().toISOString(); ctx.agent.lastIntent = u.intent; ctx.agent.lastTrace = A.trace.slice(-12);
    // 2026-09-15 (власник): архітектурне рішення для «2 повідомлення поспіль без відповіді клієнта
    // між ними» — зливаємо ПОСПІЛЬ ідучі чисто текстові виходи одного ходу в одне повідомлення тут,
    // в ОДНОМУ місці для всієї policy.js, а не точково в кожній секції окремо. Див. lib.js.
    A.out = mergeConsecutiveTextOutputs(A.out);
    // Одне й те саме фото (картка товару + прев'ю зі списку, обкладинка й фото кольору) не надсилаємо двічі за один хід.
    {
        const seenPhotos = new Set();
        const photoKey = (u) => { try { const x = new URL(String(u)); return x.searchParams.get('asset_id') || x.pathname.split('/').pop(); } catch (e) { return String(u).split('?')[0].split('/').pop(); } };
        A.out = A.out.map((o) => {
            if (!o.photoUrls || !o.photoUrls.length) return o;
            const urls = o.photoUrls.filter((u) => { const k = photoKey(u); if (!k || seenPhotos.has(k)) return false; seenPhotos.add(k); return true; });
            return { ...o, photoUrls: urls, _hadPhotos: true };
        }).filter((o) => !(o._hadPhotos && !o.photoUrls.length && !o.text && !o.caption));
    }
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

module.exports = { handleTurn, classifyComment, isCommentAgent, isAgentBot, loadCustomerMemory, buildHistory };
