'use strict';
/**
 * metaChannel.js — прямий канал Instagram (Meta, Instagram API з Instagram Login) замість Zernio. 2026-10-11.
 *
 * Чому окремий модуль, а не адаптація zernioHandler.js: половина з 2477 рядків zernioHandler — обхідні шляхи під
 * ненадійність Zernio (пізня реклама, загублені повідомлення → REST-звірка й опитування, проксі для фото, дублі вебхуків,
 * пересилання між ботами). Meta дає рекламу в першому ж повідомленні, повідомлення не губить, профіль клієнта й розмови
 * віддає напряму. Тут — лише те, що потрібно для прямого каналу; спільна логіка (повідомлення менеджера, пошук сесії за
 * id клієнта, фото, голосові, кадри рілсів) — ті самі функції з zernioHandler, не копії (15.25).
 *
 * Перемикач — ключ цільової воронки INBOUND_CHANNEL: 'meta' — працює цей модуль; інше/нема — Zernio, як раніше.
 * Повернення до Zernio без коду: INBOUND_CHANNEL=zernio (+ git-тег goverla-zernio-2026-10-11, бекап /root/backups).
 *
 * Потік: вебхук Meta (/webhook/instagram/:botId) → instagramHandler → handleMetaEvent → цільовий бот (ZERNIO_FORWARD_BOT_ID)
 *   → вхідне: дедуп за mid → профіль (нікнейм для тестового режиму) → користувач і сесія за id клієнта (ті самі, що з Zernio)
 *     → повідомлення в розмову → склеювання пачки → shopAgent.handleTurn → доставка тексту й фото через Meta API;
 *   → echo (наш акаунт → клієнт): своє (за id, що повернула Meta) — пропускаємо; інше — написав менеджер → recordManagerMessage.
 */
const { db } = require('@platform/db');
const logger = require('@platform/logger');
const { labelPhoto } = require('./photoLabel');
const shopAgent = require('./shopAgent');
const Z = require('./zernioHandler');
const { isBlockedByTestMode } = require('./testModeGate');

const GRAPH = 'https://graph.instagram.com/v21.0';
const DEBOUNCE_MS = 2500;
const TEXT_LIMIT = 1000; // Instagram: до 1000 символів в одному повідомленні

// ── Перемикач каналу (ключ INBOUND_CHANNEL цільової воронки), кеш 60 с — синхронний доступ для zernioHandler ──
const _channel = new Map();
async function channelOf(botId) {
    const c = _channel.get(botId);
    if (c && c.until > Date.now()) return c.v;
    const row = await db.funnelKey.findFirst({ where: { botId, key: 'INBOUND_CHANNEL' }, select: { value: true } }).catch(() => null);
    const v = String((row && row.value) || '').trim().toLowerCase() === 'meta' ? 'meta' : 'zernio';
    _channel.set(botId, { v, until: Date.now() + 60 * 1000 });
    return v;
}
function channelOfSync(botId) { const c = _channel.get(botId); return c ? c.v : null; }
async function refreshChannels() {
    try {
        const rows = await db.funnelKey.findMany({ where: { key: 'INBOUND_CHANNEL' }, select: { botId: true, value: true } });
        for (const r of rows) _channel.set(r.botId, { v: String(r.value || '').trim().toLowerCase() === 'meta' ? 'meta' : 'zernio', until: Date.now() + 90 * 1000 });
    } catch (e) { /* best-effort */ }
}
refreshChannels(); setInterval(refreshChannels, 60 * 1000).unref();

async function token(botId) {
    const row = await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_ACCESS_TOKEN' }, select: { value: true } });
    const t = String((row && row.value) || '').trim();
    if (!t || t === 'REPLACE_ME') throw new Error('немає INSTAGRAM_ACCESS_TOKEN');
    return t;
}
async function ownIgId(botId) {
    const row = await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_BUSINESS_ID' }, select: { value: true } });
    return String((row && row.value) || '').trim();
}

// Дедуп подій Meta (повтори вебхука) — та сама таблиця, що для Zernio/старого Instagram, свій префікс.
async function dedup(botId, id) {
    try { await db.processedMessage.create({ data: { botId, updateId: 'meta_' + id } }); return true; }
    catch (e) { if (e.code === 'P2002') return false; throw e; }
}

// ── Профіль клієнта (нікнейм потрібен тестовому режиму й CRM), кеш 6 год ──
const _profile = new Map();
async function profile(botId, igsid) {
    const c = _profile.get(igsid);
    if (c && c.until > Date.now()) return c.v;
    let v = {};
    try {
        const r = await fetch(GRAPH + '/' + encodeURIComponent(igsid) + '?fields=name,username&access_token=' + encodeURIComponent(await token(botId)));
        const j = await r.json().catch(() => ({}));
        if (r.ok && !j.error) v = { name: j.name || null, username: j.username || null };
    } catch (e) { /* профіль — не критично */ }
    _profile.set(igsid, { v, until: Date.now() + 6 * 3600 * 1000 });
    return v;
}

// ── Відправка тексту через Meta (фото — Z.sendMetaPhotoAlbum, той самий шлях, що вже працює) ──
function splitText(text) {
    const t = String(text || '').trim(); if (t.length <= TEXT_LIMIT) return t ? [t] : [];
    const out = []; let cur = '';
    for (const para of t.split(/\n\n/)) {
        if ((cur + (cur ? '\n\n' : '') + para).length <= TEXT_LIMIT) { cur = cur ? cur + '\n\n' + para : para; continue; }
        if (cur) out.push(cur);
        if (para.length <= TEXT_LIMIT) { cur = para; continue; }
        let rest = para; while (rest.length > TEXT_LIMIT) { const cut = rest.lastIndexOf(' ', TEXT_LIMIT); out.push(rest.slice(0, cut > 200 ? cut : TEXT_LIMIT)); rest = rest.slice(cut > 200 ? cut + 1 : TEXT_LIMIT); }
        cur = rest;
    }
    if (cur) out.push(cur);
    return out;
}
async function sendText(botId, igsid, text, opts = {}) {
    const tok = await token(botId); let lastId = null;
    const recipient = opts.commentId ? { comment_id: String(opts.commentId) } : { id: String(igsid) };
    for (const part of (opts.commentId ? [String(text || '').trim().slice(0, TEXT_LIMIT)] : splitText(text))) {
        let r, j;
        for (let attempt = 0; attempt < 3; attempt++) {
            r = await fetch(GRAPH + '/me/messages?access_token=' + encodeURIComponent(tok), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient, message: { text: part } }) });
            j = await r.json().catch(() => ({}));
            if (r.ok && !j.error) break;
            const code = j && j.error && j.error.code;
            if (!(r.status >= 500 || code === 2 || code === 4 || code === 613)) break; // повторюємо лише тимчасові збої/ліміти
            await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        }
        if (!r.ok || j.error) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
        lastId = j.message_id || lastId;
        if (lastId) rememberSent(lastId);
    }
    return lastId;
}

async function replyToComment(botId, commentId, text) {
    const r = await fetch(GRAPH + '/' + encodeURIComponent(commentId) + '/replies?access_token=' + encodeURIComponent(await token(botId)), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: String(text || '') }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
    return j.id || null;
}

// Свої відправлення — щоб echo від Meta не сприйняти як повідомлення менеджера.
const _sent = new Map();
function rememberSent(mid) { _sent.set(String(mid), Date.now()); if (_sent.size > 5000) { const lim = Date.now() - 6 * 3600 * 1000; for (const [k, t] of _sent) if (t < lim) _sent.delete(k); } }
async function isOurSent(mid, sessionId, text) {
    if (_sent.has(String(mid))) return true;
    if (!sessionId) return false;
    const hit = await db.message.findFirst({ where: { sessionId, role: 'assistant', metadata: { path: ['metaMessageId'], equals: String(mid) } }, select: { id: true } }).catch(() => null);
    if (hit) return true;
    // Той самий текст, який бот (або адмінка) надіслав цій людині за останні 3 хв, — наше (довгий текст ріжеться на частини).
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    const recent = await db.message.findMany({ where: { sessionId, role: 'assistant', createdAt: { gte: new Date(Date.now() - 3 * 60 * 1000) } }, select: { content: true, metadata: true } }).catch(() => []);
    return recent.some((m) => { const md = m.metadata || {}; if (md.source === 'zernio_inbox') return false; const c = String(m.content || '').replace(/\s+/g, ' ').trim(); const cap = String((md.attachment && md.attachment.caption) || '').replace(/\s+/g, ' ').trim(); return (c && c.includes(t)) || (cap && cap.includes(t)); });
}
const ECHO_SETTLE_MS = 6000;
const _echoes = new Set(); // фонові перевірки «луни» (для тестів — дочекатись)

// Збій відправки → менеджеру одразу (05–07.10: 81 збій Zernio за 2,5 год без жодного сигналу). Не частіше разу на 15 хв на бота.
const _sendAlertAt = new Map();
async function alertSendFailure(botId, sessionId, err) {
    if (Date.now() - (_sendAlertAt.get(botId) || 0) < 15 * 60 * 1000) return;
    _sendAlertAt.set(botId, Date.now());
    await Z.sendTelegramAlert(botId, '⚠️ Instagram не прийняв відповідь бота: ' + String(err || '?').slice(0, 200) + '\nСесія: https://flows.fineko.space/sessions/' + sessionId, sessionId).catch(() => {});
}

// ── Розбір вхідного повідомлення Meta ──
function parseInbound(m) {
    const msg = m.message || {};
    const text = String(msg.text || '').trim();
    const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
    const media = []; let sharedPost = null; let audioUrl = null;
    for (const a of atts) {
        const t = String((a && a.type) || '').toLowerCase(); const pl = (a && a.payload) || {};
        if (t === 'image' && pl.url) media.push({ type: 'photo', url: pl.url });
        else if (t === 'video' && pl.url) media.push({ type: 'video', url: pl.url });
        else if (t === 'audio' && pl.url) audioUrl = pl.url;
        else if (t === 'ig_post' || t === 'share' || t === 'ig_reel' || t === 'reel') {
            if (!sharedPost) sharedPost = { kind: /reel/.test(t) ? 'reel' : 'post', mediaId: pl.ig_post_media_id || pl.reel_video_id || pl.media_id || null, caption: pl.title || pl.caption || null, url: pl.url || null };
        } else if (t === 'story_mention' && pl.url) media.push({ type: 'photo', url: pl.url, story: true });
    }
    const story = msg.reply_to && msg.reply_to.story ? msg.reply_to.story : null;
    const replyToMid = msg.reply_to && msg.reply_to.mid ? String(msg.reply_to.mid) : null; // відповідь свайпом на наше повідомлення
    const ref = msg.referral || m.referral || null;
    return { mid: msg.mid || null, text, media, sharedPost, audioUrl, story, replyToMid, ref, at: m.timestamp ? new Date(Number(m.timestamp)) : new Date() };
}

// ── Склеювання пачки повідомлень і черга ходів на сесію ──
const _pending = new Map(); const _queue = new Map();
// Пачка, що вже в черзі за ходом, який виконується, але ще НЕ почалась. Нові повідомлення домішуються в неї, а не стають окремим
// ходом (14.10, Edit 0da56214 merdan_movlanov: фото → хід ~35 с; за цей час ще два повідомлення про натуральну шкіру стали двома
// ходами — бот двічі поспіль відповів майже однаковим текстом про екошкіру).
const _waiting = new Map(); // sessionId -> batch e
function mergeBatch(into, e) {
    for (const t of e.texts || []) into.texts.push(t);
    if (e.imageUrl && !into.imageUrl) into.imageUrl = e.imageUrl;
    for (const u of e.imageUrls || []) if (!into.imageUrls.includes(u)) into.imageUrls.push(u);
    for (const [k, v] of Object.entries(e.ctxPatch || {})) if (v != null) into.ctxPatch[k] = v;
    if (e.resume) into.resume = true;
}
function scheduleTurn(sessionId, msg) {
    let e = _pending.get(sessionId);
    if (!e) { e = { botId: msg.botId, contactId: msg.contactId, texts: [], imageUrl: null, imageUrls: [], ctxPatch: {}, timer: null }; _pending.set(sessionId, e); }
    if (msg.text) e.texts.push(msg.text);
    if (msg.imageUrl) { if (!e.imageUrl) e.imageUrl = msg.imageUrl; if (!e.imageUrls.includes(msg.imageUrl)) e.imageUrls.push(msg.imageUrl); }
    if (msg.ctxPatch) for (const [k, v] of Object.entries(msg.ctxPatch)) if (v != null) e.ctxPatch[k] = v;
    if (msg.resumeFromManagerSilence) e.resume = true;
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => {
        _pending.delete(sessionId);
        enqueue(sessionId, e);
    }, DEBOUNCE_MS);
}

function enqueue(sessionId, e) {
    const w = _waiting.get(sessionId);
    if (w) { mergeBatch(w, e); logger.info('[metaChannel] повідомлення домішано в пачку, що чекає своєї черги', { sessionId }); return; }
    const running = _queue.has(sessionId);
    if (running) _waiting.set(sessionId, e);
    const prev = _queue.get(sessionId) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => { if (_waiting.get(sessionId) === e) _waiting.delete(sessionId); return runTurn(sessionId, e); }).catch((err) => logger.error('[metaChannel] turn failed', { sessionId, error: err.message }));
    _queue.set(sessionId, run);
    run.finally(() => { if (_queue.get(sessionId) === run) _queue.delete(sessionId); });
}

/** Плавна зупинка процесу: ходи, що чекали склеювання пачки, — одразу; далі чекаємо, поки черга спорожніє (до timeoutMs). */
async function drain(timeoutMs = 25000) {
    for (const [sid, e] of [..._pending]) { if (e.timer) clearTimeout(e.timer); _pending.delete(sid); enqueue(sid, e); }
    const until = Date.now() + timeoutMs;
    while ((_queue.size || _echoes.size) && Date.now() < until) await Promise.race([Promise.allSettled([..._queue.values(), ..._echoes]), new Promise((r) => setTimeout(r, 500))]);
    if (_queue.size) logger.warn('[metaChannel] drain: не встигли завершити ходів: ' + _queue.size);
}

async function runTurn(sessionId, e) {
    const { botId } = e;
    const sess0 = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
    const contactId = String(((sess0 && sess0.context) || {}).psid || e.contactId || '');
    if (!contactId) { logger.warn('[metaChannel] немає psid клієнта — нема куди відповідати', { sessionId }); return; }
    e.texts = Array.isArray(e.texts) ? e.texts : []; e.imageUrls = Array.isArray(e.imageUrls) ? e.imageUrls : []; e.ctxPatch = e.ctxPatch || {};
    // Сигнали товару цього ходу (пост, реклама, сторіз) — у контекст перед ходом, як робить звичайний вхід.
    if (Object.keys(e.ctxPatch).length) {
        const s = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
        const c = { ...((s && s.context) || {}) }; for (const [k, v] of Object.entries(e.ctxPatch)) c[k] = v;
        await db.session.update({ where: { id: sessionId }, data: { context: Z.cleanJsonDeep(c) } }).catch(() => {});
    }
    const text = e.texts.filter(Boolean).join('\n').trim();
    const sinceTime = new Date();
    try {
        if (e.commentId) await shopAgent.classifyComment({ botId, sessionId, commentText: text });
        await shopAgent.handleTurn({ botId, sessionId, text, imageUrl: e.imageUrl, imageUrls: e.imageUrls.length > 1 ? e.imageUrls : undefined, sharedPost: e.ctxPatch.sharedPost, entryAdId: e.ctxPatch.entryAdId, storyId: e.ctxPatch.storyId });
    } catch (err) { logger.error('[metaChannel] handleTurn failed', { botId, sessionId, error: err.message }); }
    const outMsgs = await db.message.findMany({ where: { sessionId, role: 'assistant', createdAt: { gt: sinceTime } }, orderBy: { createdAt: 'asc' } });
    // Клієнт уже пише далі (нова пачка в черзі) — застаріле прохання зросту/ваги не шлемо (як у zernioHandler).
    if (_pending.has(sessionId) || _waiting.has(sessionId)) {
        for (const om of outMsgs) {
            if (!/agent:ask_params$/.test(String((om.metadata || {}).nodeId || ''))) continue;
            const rest = shopAgent.stripKnownHwAsk(String(om.content || ''));
            if (rest === String(om.content || '')) continue;
            if (rest) { om.content = rest; await db.message.update({ where: { id: om.id }, data: { content: rest } }).catch(() => {}); }
            else { om.metadata = { ...(om.metadata || {}), hidden: true, supersededBy: 'newer_client_message' }; await db.message.update({ where: { id: om.id }, data: { metadata: om.metadata } }).catch(() => {}); }
        }
    }
    let dmSent = 0, dmFailed = 0;
    // Клієнт лише лишив коментар і не писав у директ за добу: Meta дозволяє ОДНУ приватну відповідь (лише текст). Усі тексти ходу —
    // одним повідомленням; фото відкладаємо, вони підуть першими, щойно клієнт відповість у директ (як у zernioHandler).
    const commentOnly = !!e.commentId && !(await dmWindowOpen(sessionId));
    if (commentOnly) {
        const pending = []; const texts = []; const ids = [];
        for (const om of outMsgs) {
            const m = om.metadata || {};
            if (m.hidden || m.source === 'zernio_inbox' || m.status === 'sent') continue;
            const att = m.attachment;
            const urls = att && (att.type === 'photo' || att.type === 'image') ? (Array.isArray(att.urls) && att.urls.length ? att.urls : [att.url]).filter((u) => u && /^https?:/.test(String(u))) : [];
            if (urls.length) pending.push({ urls, caption: att.caption || om.content || '' });
            else if (String(om.content || '').trim() && !/^\[повідомлення\]$/.test(String(om.content).trim())) { texts.push(String(om.content).trim()); ids.push(om.id); }
        }
        if (texts.length) {
            const dmText = texts.join('\n\n');
            try {
                const mid = await sendText(botId, contactId, dmText, { commentId: e.commentId });
                dmSent++;
                await Z.logDelivery(sessionId, botId, 'meta_comment_dm', true, null, { commentId: e.commentId, text: dmText.slice(0, 160), messageId: mid });
                for (const id of ids) { const om = outMsgs.find((x) => x.id === id); await db.message.update({ where: { id }, data: { metadata: { ...(om.metadata || {}), metaMessageId: mid || null, status: 'sent', channel: 'meta', commentDm: true } } }).catch(() => {}); }
            } catch (err) {
                dmFailed++;
                await Z.logDelivery(sessionId, botId, 'meta_comment_dm', false, err.message, { commentId: e.commentId });
                await Z.sendTelegramAlert(botId, '⚠️ Приватну відповідь на коментар не доставлено (' + String(err.message).slice(0, 120) + ') — у публічній відповіді попросили написати самим.\nСесія: https://flows.fineko.space/sessions/' + sessionId, sessionId).catch(() => {});
            }
        }
        if (pending.length) {
            const s2 = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
            await db.session.update({ where: { id: sessionId }, data: { context: Z.cleanJsonDeep({ ...((s2 && s2.context) || {}), commentPendingPhotos: pending.slice(0, 5) }) } }).catch(() => {});
        }
    } else {
        if (!e.commentId) await flushPendingCommentPhotos(botId, sessionId, contactId, outMsgs);
        await deliver(botId, sessionId, contactId, outMsgs);
    }
    if (e.commentId) await postPublicReply(botId, sessionId, e.commentId, dmSent, dmFailed);
    await Z.postTurnChecks(botId, sessionId, ((sess0 && sess0.context) || {}).senderName, text);
}

/** Чи писав клієнт нам у директ за останні 23 год (будь-яким каналом — це та сама розмова Instagram; коментар — роль event, не user) (тоді відповідаємо звичайним повідомленням, а не приватною відповіддю на коментар). */
async function dmWindowOpen(sessionId) {
    const m = await db.message.findFirst({ where: { sessionId, role: 'user', createdAt: { gte: new Date(Date.now() - 23 * 3600 * 1000) } }, select: { id: true } }).catch(() => null);
    return !!m;
}

/** Клієнт відповів у директ після коментаря: спершу відкладені фото; те саме фото в цьому ж ході вдруге не шлемо. */
async function flushPendingCommentPhotos(botId, sessionId, igsid, outMsgs) {
    try {
        const s = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
        const c = (s && s.context) || {};
        const pend = Array.isArray(c.commentPendingPhotos) ? c.commentPendingPhotos : [];
        if (!pend.length) return;
        await db.session.update({ where: { id: sessionId }, data: { context: Z.cleanJsonDeep({ ...c, commentPendingPhotos: [] }) } });
        const key = (u) => { try { const x = new URL(String(u)); return x.searchParams.get('asset_id') || x.pathname.split('/').pop(); } catch (er) { return String(u).split('?')[0].split('/').pop(); } };
        const flushed = new Set();
        for (const p of pend) {
            try {
                const mid = await Z.sendMetaPhotoAlbum(botId, igsid, p.urls); if (mid) rememberSent(mid);
                p.urls.forEach((u) => flushed.add(key(u)));
                await Z.logDelivery(sessionId, botId, 'ig_photo_album', true, null, { deferredFromComment: true, count: p.urls.length, channel: 'meta' });
                if (p.caption) await sendText(botId, igsid, p.caption);
            } catch (er) { await Z.logDelivery(sessionId, botId, 'ig_photo_album', false, er.message, { deferredFromComment: true, channel: 'meta' }); }
        }
        for (const om of outMsgs) {
            const att = (om.metadata || {}).attachment;
            const urls = att ? (Array.isArray(att.urls) && att.urls.length ? att.urls : [att.url]).filter(Boolean) : [];
            if (urls.length && urls.every((u) => flushed.has(key(u)))) { om.metadata = { ...(om.metadata || {}), hidden: true, dupOfDeferred: true }; await db.message.update({ where: { id: om.id }, data: { metadata: om.metadata } }).catch(() => {}); }
        }
    } catch (er) { logger.warn('[metaChannel] deferred photos: ' + er.message, { sessionId }); }
}

/** Публічна відповідь під коментарем (текст готує класифікатор — ctx.commentReplyText), один раз на коментар. */
async function postPublicReply(botId, sessionId, commentId, dmSent, dmFailed) {
    try {
        const s = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
        const c = (s && s.context) || {};
        if (!c.commentReplyText || c.commentReplyPosted) return;
        const name = String(c.senderName || '').trim().split(/\s+/)[0] || 'друже';
        const pub = Z.pickCommentPublicReply(c.commentReplyText, dmSent, dmFailed, name);
        let rid = null, rerr = null;
        try { rid = await replyToComment(botId, commentId, pub); }
        catch (er) { rerr = er.message; logger.warn('[metaChannel] публічна відповідь на коментар не пройшла: ' + er.message, { sessionId }); }
        await Z.logDelivery(sessionId, botId, 'meta_comment_reply', !!rid, rerr, { commentId, dmSent, dmFailed, text: pub.slice(0, 160) });
        await db.message.create({ data: { sessionId, role: 'assistant', content: pub, metadata: { source: 'comment_public_reply', eventType: 'comment.reply', commentId, ok: !!rid, channel: 'meta', ...(rerr ? { error: rerr } : {}) } } }).catch(() => {});
        await db.session.update({ where: { id: sessionId }, data: { context: { ...c, commentReplyText: pub, commentReplyPosted: true } } }).catch(() => {});
    } catch (er) { logger.warn('[metaChannel] comment reply block: ' + er.message, { sessionId }); }
}

/** Коментар під постом (Meta changes[field=comments]). Свої відповіді (від нашого акаунта) пропускаємо. */
async function handleComment(botId, own, v) {
    const from = v.from || {}; const commentId = v.id; const mediaId = (v.media && v.media.id) || null;
    if (!commentId || !from.id) return 'skip';
    if (own && String(from.id) === own) return 'skip';
    const ownName = String((await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_USERNAME' }, select: { value: true } }).catch(() => null) || {}).value || '').trim().toLowerCase();
    if (ownName && String(from.username || '').toLowerCase() === ownName) return 'skip';
    if (!(await dedup(botId, 'cm_' + commentId))) return 'skip';
    const commentText = String(v.text || '');
    // Підпис поста — там артикул (коментар «🔥» товару не називає), як пересланий пост у директі.
    let postCaption = null;
    if (mediaId) {
        try {
            const r = await fetch(GRAPH + '/' + encodeURIComponent(mediaId) + '?fields=caption&access_token=' + encodeURIComponent(await token(botId)));
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.caption) postCaption = String(j.caption); else if (!r.ok) logger.warn('[metaChannel] media caption fetch failed', { botId, mediaId, error: j.error && j.error.message });
        } catch (er) { /* best-effort */ }
    }
    const patch = {
        commentId: String(commentId), commentText, commentMediaId: mediaId ? String(mediaId) : null, entryAd: mediaId ? String(mediaId) : undefined,
        ...(postCaption ? { sharedPost: { kind: 'post', mediaId: String(mediaId), caption: postCaption } } : {}),
        // Товар коментаря — тривка підказка на 72 год (productMatch: commentProductArticle). sharedPost живе лише один хід: якщо
        // ходу на коментар не було (тестовий режим, відповів менеджер), наступне «Доброго дня» його вже не бачило (12.10, dk.ukr).
        ...(postCaption && /Артикул\s*:?\s*[^\s,;]+/i.test(postCaption) ? { commentProductArticle: postCaption.match(/Артикул\s*:?\s*([^\s,;]+)/i)[1].replace(/[.]+$/, ''), commentProductName: postCaption.split('\n')[0].slice(0, 120), commentProductAt: new Date().toISOString() } : {}),
        commentReplyPosted: false, commentCategory: '',
        ...(from.username ? { igUsername: from.username } : {}),
    };
    const { session, profile: prof } = await sessionFor(botId, String(from.id), patch);
    const name = prof.name || from.username || 'друже';
    await db.message.create({ data: Z.cleanJsonDeep({ sessionId: session.id, role: 'event', content: '💬 Коментар від ' + name + ': ' + commentText.slice(0, 200), metadata: { source: 'meta', channel: 'meta', eventType: 'comment.received', authorName: name, commentText, commentId: String(commentId), mediaId, raw: v } }) });
    if (await isBlockedByTestMode(botId, [from.username, prof.username, prof.name])) return 'stored';
    const ctx = session.context || {};
    if (ctx.adminEngaged || ctx.funnelPaused) return 'stored';
    if (!(await shopAgent.isCommentAgent(botId))) { logger.info('[metaChannel] коментарі не веде агент (COMMENT_AGENT=0) — лише записано', { botId }); return 'stored'; }
    enqueue(session.id, { botId, contactId: String(from.id), commentId: String(commentId), texts: [commentText], imageUrl: null, imageUrls: [], ctxPatch: patch });
    return 'processed';
}

/** id наших повідомлень-фото → артикул товару на фото (останні 40) — щоб відповідь свайпом на фото вказувала товар. */
async function rememberPhotoSkus(sessionId, map) {
    const s = await db.session.findUnique({ where: { id: sessionId }, select: { context: true } });
    const c = { ...((s && s.context) || {}) }; const a = { ...(c.agent || {}) };
    const prev = a.photoReplyMap && typeof a.photoReplyMap === 'object' ? a.photoReplyMap : {};
    a.photoReplyMap = Object.fromEntries(Object.entries({ ...prev, ...map }).slice(-40));
    c.agent = a;
    await db.session.update({ where: { id: sessionId }, data: { context: Z.cleanJsonDeep(c) } }).catch(() => {});
}
/** Артикул товару на нашому фото, на яке клієнт відповів свайпом (або null). */
function replyToSkuFor(ctx, replyToMid) {
    const m = replyToMid && ctx && ctx.agent && ctx.agent.photoReplyMap;
    return (m && m[String(replyToMid)]) || null;
}

async function deliver(botId, sessionId, igsid, outMsgs) {
    for (const om of outMsgs) {
        const m = om.metadata || {};
        if (m.hidden || m.source === 'zernio_inbox' || m.status === 'sent') continue;
        const content = String(om.content || '').trim();
        if (/^\[повідомлення\]$/.test(content)) continue;
        const att = m.attachment;
        const urls = att && (att.type === 'photo' || att.type === 'image') ? (Array.isArray(att.urls) && att.urls.length ? att.urls : [att.url]).filter((u) => u && /^https?:/.test(String(u))) : [];
        try {
            if (urls.length && Array.isArray(att.labels) && att.labels.length === urls.length) {
                // Різні товари списку (14.10): кожне фото окремим повідомленням із НОМЕРОМ позиції — відповідь свайпом на фото
                // однозначно вказує товар (photoReplyMap у контексті розмови), а номер видно навіть без тексту списку.
                const mids = []; const map = {};
                for (let i = 0; i < urls.length; i++) {
                    let mid = null;
                    try {
                        const b = await labelPhoto(urls[i], att.labels[i]);
                        mid = await Z.sendMetaPhoto(botId, igsid, urls[i], b ? { buffer: b, contentType: 'image/png' } : {});
                    } catch (e) { logger.warn('[metaChannel] фото позиції ' + att.labels[i] + ': ' + e.message, { sessionId }); }
                    if (mid) { rememberSent(mid); mids.push(mid); if (att.skus && att.skus[i]) map[mid] = String(att.skus[i]); }
                }
                await Z.logDelivery(sessionId, botId, 'ig_photo_list', mids.length > 0, mids.length < urls.length ? ('не надіслано ' + (urls.length - mids.length) + ' з ' + urls.length) : null, { nodeId: m.nodeId || null, count: mids.length, channel: 'meta' });
                await db.message.update({ where: { id: om.id }, data: { metadata: { ...m, metaMessageId: mids[0] || null, metaMessageIds: mids, status: mids.length ? 'sent' : 'failed' } } }).catch(() => {});
                if (Object.keys(map).length) await rememberPhotoSkus(sessionId, map);
            } else if (urls.length) {
                const rep = { planned: urls.length, sent: urls.length, failed: [] };
                const mid = await Z.sendMetaPhotoAlbum(botId, igsid, urls.slice(0, 10), rep);
                if (mid) rememberSent(mid);
                await Z.logDelivery(sessionId, botId, 'ig_photo_album', true, rep.failed.length ? ('не надіслано ' + rep.failed.length + ' з ' + rep.planned) : null, { nodeId: m.nodeId || null, count: rep.sent, channel: 'meta' });
                await db.message.update({ where: { id: om.id }, data: { metadata: { ...m, metaMessageId: mid || null, status: 'sent' } } }).catch(() => {});
                const cap = String(att.caption || '').trim();
                if (cap) { const cid = await sendText(botId, igsid, cap); await Z.logDelivery(sessionId, botId, 'meta_text', true, null, { nodeId: m.nodeId || null, text: cap.slice(0, 160), messageId: cid }); }
            } else if (content) {
                const mid = await sendText(botId, igsid, content);
                await Z.logDelivery(sessionId, botId, 'meta_text', true, null, { nodeId: m.nodeId || null, text: content.slice(0, 160), messageId: mid });
                await db.message.update({ where: { id: om.id }, data: { metadata: { ...m, metaMessageId: mid || null, status: 'sent', channel: 'meta' } } }).catch(() => {});
            }
        } catch (err) {
            logger.warn('[metaChannel] доставка не пройшла: ' + err.message, { botId, sessionId, nodeId: m.nodeId || null });
            await Z.logDelivery(sessionId, botId, urls.length ? 'ig_photo_album' : 'meta_text', false, err.message, { nodeId: m.nodeId || null, channel: 'meta' });
            await db.message.update({ where: { id: om.id }, data: { metadata: { ...m, status: 'failed', deliveryError: String(err.message).slice(0, 300), channel: 'meta' } } }).catch(() => {});
            await alertSendFailure(botId, sessionId, err.message);
        }
    }
}

async function sessionFor(botId, igsid, patch) {
    const p = await profile(botId, igsid);
    const user = await Z.findOrCreateZernioUser(String(igsid), botId, p.name || p.username || null);
    const session = await Z.findOrCreateZernioSession(user.id, botId, {
        psid: String(igsid), contactId: String(igsid), conversationId: 'ig:' + igsid, channel: 'meta',
        ...(p.name ? { senderName: p.name } : {}), ...(p.username ? { igUsername: p.username } : {}), ...(patch || {}),
    });
    return { session, profile: p };
}

// Реклама, з якої клієнт відкрив розмову, приходить окремою подією messaging_referral (без message) — часто ДО першого повідомлення,
// інколи після (2026-10-14: ~третина перших повідомлень з реклами за 12–13.10 були без ad_id → бот показував список товарів замість
// картки; такі події відкидались як «ні message, ні postback»). Тримаємо реферал 10 хв і віддаємо найближчому повідомленню клієнта,
// а якщо хід уже в черзі склеювання — домішуємо одразу. Сюди ж потрапляють повідомлення, які підібрав поллер розмов (там реклами нема).
const REF_HOLD_MS = 10 * 60 * 1000;
const _refHold = new Map(); // `${botId}:${igsid}` -> { patch, at }
function refPatch(ref) {
    const adId = ref && (ref.ad_id || ref.adId); if (!adId) return null;
    const cd = ref.ads_context_data || {};
    const patch = { entryAdId: String(adId), lastReferral: { ref: ref.ref || null, adId: String(adId), source: ref.source || null, type: ref.type || null, adTitle: cd.ad_title || null, postId: cd.post_id || null } };
    if (patch.lastReferral.adTitle) patch.adTitle = patch.lastReferral.adTitle;
    return patch;
}
function takeHeldRef(botId, igsid) {
    const k = botId + ':' + igsid; const h = _refHold.get(k); if (!h) return null;
    _refHold.delete(k);
    return Date.now() - h.at < REF_HOLD_MS ? h.patch : null;
}

/** Вхідна подія вебхука Meta. webhookBotId — бот із URL вебхука; цільовий — за ZERNIO_FORWARD_BOT_ID (той самий ключ, що для Zernio). */
async function handleMetaEvent(webhookBotId, body) {
    const botId = await Z.resolveZernioTargetBot(webhookBotId);
    const own = await ownIgId(botId);
    let processed = 0, skipped = 0;
    for (const entry of body.entry || []) {
        let events = (entry.messaging && entry.messaging.length ? entry.messaging : entry.standby) || [];
        if (!events.length && Array.isArray(entry.changes)) events = entry.changes.filter((c) => c && c.value && (c.field === 'messages' || c.field === 'message')).map((c) => c.value);
        for (const ch of (Array.isArray(entry.changes) ? entry.changes : []).filter((c) => c && c.field === 'comments' && c.value)) {
            try { const r = await handleComment(botId, own, ch.value); if (r === 'skip') skipped++; else processed++; }
            catch (err) { logger.error('[metaChannel] comment failed', { botId, error: err.message }); }
        }
        for (const m of events) {
            try {
                // Окремий реферал (клієнт відкрив розмову з реклами) — не хід, лише «з якої реклами».
                if (!m.message && !m.postback && m.referral && m.sender && !(own && String(m.sender.id) === own)) {
                    const rp = refPatch(m.referral); if (!rp) { skipped++; continue; }
                    const igsid = String(m.sender.id);
                    const { session } = await sessionFor(botId, igsid, { lastReferral: rp.lastReferral, ...(rp.adTitle ? { adTitle: rp.adTitle } : {}) });
                    const pe = _pending.get(session.id);
                    if (pe) { pe.ctxPatch.entryAdId = rp.entryAdId; logger.info('[metaChannel] referral → хід у черзі', { botId, sessionId: session.id, adId: rp.entryAdId }); }
                    else { _refHold.set(botId + ':' + igsid, { patch: rp, at: Date.now() }); logger.info('[metaChannel] referral до повідомлення — тримаємо', { botId, sessionId: session.id, adId: rp.entryAdId }); }
                    processed++; continue;
                }
                if (m.read || m.reaction || m.message_edit || (!m.message && !m.postback)) { skipped++; continue; }
                const msg = m.message || {};
                // ── echo: повідомлення від нашого акаунта клієнту ──
                if (msg.is_echo || (own && m.sender && String(m.sender.id) === own)) {
                    const igsid = m.recipient && m.recipient.id; if (!igsid || !msg.mid) { skipped++; continue; }
                    // Розмова цього бота серед УСІХ користувачів із цим psid (14.10, cd0b1f76 stanislavchehovskiy: перший знайдений користувач
                    // належав іншому боту без zernioBotId → сесії «не було», відповіді менеджера губились, бот не знав, що розмову веде менеджер).
                    const users = await db.user.findMany({ where: { metadata: { path: ['psid'], equals: String(igsid) } }, select: { id: true } });
                    const session = users.length ? await db.session.findFirst({ where: { userId: { in: users.map((u) => u.id) }, botId }, orderBy: { startedAt: 'desc' } }) : null;
                    if (!session) { skipped++; continue; } // менеджер пише людині, якої бот не знає — розмови тут нема
                    if (_sent.has(String(msg.mid))) { skipped++; continue; }
                    // Чекаємо, поки наша відправка запише свій id, — у фоні, щоб не тримати решту подій пачки.
                    const atts = (Array.isArray(msg.attachments) ? msg.attachments : []).map((a) => ({ type: a.type, url: a.payload && a.payload.url }));
                    const echoDone = (async () => {
                        await new Promise((res) => setTimeout(res, ECHO_SETTLE_MS));
                        if (await isOurSent(msg.mid, session.id, msg.text)) return;
                        if (!(await dedup(botId, 'echo_' + msg.mid))) return;
                        const fresh = await db.session.findUnique({ where: { id: session.id } });
                        await Z.recordManagerMessage(botId, fresh || session, { text: msg.text || '', attachments: atts, ids: { channel: 'meta', metaMessageId: msg.mid } });
                    })().catch((err) => logger.error('[metaChannel] echo failed', { botId, error: err.message }));
                    _echoes.add(echoDone); echoDone.finally(() => _echoes.delete(echoDone));
                    processed++; continue;
                }
                // ── вхідне від клієнта ──
                const igsid = m.sender && m.sender.id; if (!igsid) { skipped++; continue; }
                const p = parseInbound(m); if (!p.mid) { skipped++; continue; }
                if (!(await dedup(botId, 'in_' + p.mid))) { skipped++; continue; }
                const held = takeHeldRef(botId, String(igsid));
                const patch = refPatch(p.ref) || held || {};
                const { session, profile: prof } = await sessionFor(botId, igsid, patch);
                let text = p.text;
                if (!text && p.audioUrl) { const tr = await Z.transcribeVoice(botId, p.audioUrl).catch(() => ''); if (tr) text = tr; }
                let sharedPost = p.sharedPost;
                if (sharedPost && sharedPost.kind === 'reel' && sharedPost.mediaId) { try { const fr = await Z.getReelVideoFramesForVision(botId, sharedPost.mediaId); if (fr.length) sharedPost = { ...sharedPost, frameUrls: fr }; } catch (er) { /* кадри — best-effort */ } }
                const photo = p.media.find((x) => x.type === 'photo') || (p.story && p.story.url ? { type: 'photo', url: p.story.url } : null);
                const label = text || (sharedPost && sharedPost.caption ? ('[переслав ' + sharedPost.kind + '] ' + String(sharedPost.caption).slice(0, 80).replace(/\s+/g, ' ')) : (p.media.length > 1 ? '[' + p.media.length + ' медіа]' : p.media[0] ? (p.media[0].type === 'video' ? '[відео]' : '[фото]') : p.audioUrl ? '[голосове]' : p.story ? '[відповідь на сторіз]' : '[порожнє повідомлення]'));
                await db.message.create({ data: Z.cleanJsonDeep({ sessionId: session.id, role: 'user', content: label, createdAt: p.at, metadata: {
                    source: 'meta', channel: 'meta', mid: p.mid, platformMessageId: p.mid, channelCreatedAt: p.at.toISOString(),
                    ...(photo ? { attachment: { type: 'photo', url: photo.url } } : p.media[0] ? { attachment: p.media[0] } : {}),
                    ...(p.media.length > 1 ? { attachments: p.media } : {}), ...(sharedPost ? { sharedPost } : {}),
                    ...(patch.entryAdId ? { adId: patch.entryAdId, referral: patch.lastReferral } : {}), ...(p.story ? { storyId: p.story.id || null } : {}),
                    ...(p.audioUrl ? { voice: true, transcript: text || null } : {}),
                    ...(p.replyToMid ? { replyToMid: p.replyToMid } : {}),
                } }) });
                await db.session.update({ where: { id: session.id }, data: { lastActive: new Date() } }).catch(() => {});
                processed++;
                const _sc = session.context || {}; // профіль від Meta міг не прийти — нікнейм, збережений раніше
                if (await isBlockedByTestMode(botId, [prof.username, prof.name, _sc.igUsername, _sc.senderName])) continue;
                const ctx = (await db.session.findUnique({ where: { id: session.id }, select: { context: true } })).context || {};
                // Менеджер веде розмову: бот мовчить (знімає resumeAfterManagerSilence / вручну). Виняток — клієнт за добу
                // повернувся з НОВОЮ рекламою чи постом (той самий принцип, що в zernioHandler).
                if (ctx.funnelPaused) {
                    // Пауза менеджера сплила (менеджер не писав клієнту понад добу — pausedAt оновлюється з кожним його повідомленням):
                    // клієнт пише — бот відповідає одразу, не чекаючи фонового зняття (12.10, tanyayaremo: пауза з 11.10 12:58, наступного
                    // дня «Можна замовити чорного L» / «Ціна» / «Передплата» / «Реквізити» — без відповіді). Те саме правило 24 год, що в hardExpirePauses.
                    const old = ctx.pausedAt && Date.now() - new Date(ctx.pausedAt).getTime() > 24 * 3600 * 1000;
                    if (!(old && /^(manager_message|manual)/.test(String(ctx.pausedBy || '')))) continue;
                    await db.session.update({ where: { id: session.id }, data: { context: Z.cleanJsonDeep({ ...ctx, funnelPaused: false, pausedBy: null, adminEngaged: false, resumedBy: 'client_return_24h', resumedAt: new Date().toISOString() }) } });
                }
                // Точний повтор попереднього повідомлення клієнта за 2 хв, на яке бот уже відповів (подвійне натискання кнопки-питання
                // реклами, 12.10 _marian28_06_: «Яка ціна кофти?» ×2 → картка, а потім ще раз ціна) — записали, окремо не відповідаємо.
                if (text && !photo && !sharedPost && !patch.entryAdId) {
                    const prevU = await db.message.findFirst({ where: { sessionId: session.id, role: 'user', createdAt: { lt: p.at, gte: new Date(p.at.getTime() - 120 * 1000) } }, orderBy: { createdAt: 'desc' }, select: { content: true, createdAt: true } });
                    const norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').replace(/[?!.…\s]+$/, '').trim();
                    if (prevU && norm(prevU.content) === norm(text)) {
                        const answered = await db.message.findFirst({ where: { sessionId: session.id, role: 'assistant', createdAt: { gt: prevU.createdAt } }, select: { id: true } });
                        if (answered) { logger.info('[metaChannel] повтор того самого питання за 2 хв — бот уже відповів, окремо не відповідаємо', { sessionId: session.id }); continue; }
                    }
                }
                const replyToSku = p.replyToMid ? replyToSkuFor(ctx, p.replyToMid) : null;
                scheduleTurn(session.id, { botId, contactId: String(igsid), text, imageUrl: photo ? photo.url : null, ctxPatch: { ...(sharedPost ? { sharedPost, hasFreshSignalThisTurn: true } : {}), ...(patch.entryAdId ? { entryAdId: patch.entryAdId } : {}), ...(p.story && p.story.id ? { storyId: String(p.story.id) } : {}), ...(replyToSku ? { replyToSku } : {}) } });
            } catch (err) {
                logger.error('[metaChannel] event failed', { botId, error: err.message, stack: String(err.stack || '').slice(0, 800) });
            }
        }
    }
    return { ok: true, processed, skipped, channel: 'meta' };
}

async function retryUnanswered() {
    try {
        const now = Date.now();
        const sessions = await db.session.findMany({ where: { isActive: true, isTest: false, context: { path: ['channel'], equals: 'meta' }, lastActive: { lte: new Date(now - 45 * 1000), gte: new Date(now - 30 * 60 * 1000) } }, select: { id: true, botId: true, context: true }, take: 100 });
        for (const s of sessions) {
            try {
                if (_pending.has(s.id) || _queue.has(s.id)) continue;
                const ctx = s.context || {};
                if (ctx.funnelPaused || ctx.adminEngaged) continue;
                if ((await channelOf(s.botId)) !== 'meta') continue;
                if (await isBlockedByTestMode(s.botId, [ctx.igUsername, ctx.senderName])) continue;
                const last = await db.message.findMany({ where: { sessionId: s.id, role: { in: ['user', 'assistant'] } }, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, role: true, content: true, createdAt: true, metadata: true } });
                // Відповідь бота збережена, але не відправлена (процес перезапустився між «готово» і «надіслано» — 12.10, v_khanenko25:
                // колір джинсів так і не дійшов, розмову підхопив менеджер). Доставляємо її, якщо після неї клієнт нічого не писав.
                const undelivered = []; for (const m of last) { const md = m.metadata || {}; if (m.role !== 'assistant' || md.hidden || md.status || !(md.nodeId || md.source === 'shop_agent') || (md.source && md.source !== 'shop_agent')) break; undelivered.unshift(m); }
                if (undelivered.length && now - undelivered[0].createdAt.getTime() > 60 * 1000) {
                    const dkey = 'deliver:' + undelivered[0].id;
                    const dr = ctx.metaRetry && ctx.metaRetry.key === dkey ? ctx.metaRetry : { key: dkey, n: 0, next: 0 };
                    if (dr.n >= 2 || now < dr.next) continue;
                    await db.session.update({ where: { id: s.id }, data: { context: { ...ctx, metaRetry: { key: dkey, n: dr.n + 1, next: now + 3 * 60 * 1000 } } } }).catch(() => {});
                    logger.info('[metaChannel] доставка відповіді, що не пішла', { sessionId: s.id, n: undelivered.length, attempt: dr.n + 1 });
                    await deliver(s.botId, s.id, String(ctx.psid || ''), undelivered);
                    continue;
                }
                const unanswered = []; for (const m of last) { if (m.role === 'assistant' && !(m.metadata || {}).hidden) break; if (m.role === 'user') unanswered.unshift(m); }
                if (!unanswered.length) continue;
                const lastAt = unanswered[unanswered.length - 1].createdAt.getTime();
                if (now - lastAt < 60 * 1000) continue;
                const key = String((unanswered[unanswered.length - 1].metadata || {}).mid || lastAt);
                const r = ctx.metaRetry && ctx.metaRetry.key === key ? ctx.metaRetry : { key, n: 0, next: 0 };
                if (r.n >= 3 || now < r.next) continue;
                await db.session.update({ where: { id: s.id }, data: { context: { ...ctx, metaRetry: { key, n: r.n + 1, next: now + [3, 9, 27][r.n] * 60 * 1000 } } } }).catch(() => {});
                const text = unanswered.map((m) => String(m.content || '')).filter((t) => t && !/^\[(порожнє|фото|відео|голосове|\d+ медіа)/.test(t)).join('\n').trim();
                const att = unanswered.map((m) => (m.metadata || {}).attachment).find((a) => a && a.type === 'photo' && /^http/.test(a.url || ''));
                const shared = unanswered.map((m) => (m.metadata || {}).sharedPost).find(Boolean);
                if (!text && !att && !shared) continue;
                logger.info('[metaChannel] повтор невідповіданого ходу', { sessionId: s.id, attempt: r.n + 1, textPreview: text.slice(0, 60) });
                scheduleTurn(s.id, { botId: s.botId, contactId: ctx.psid, text, imageUrl: att ? att.url : null, ctxPatch: shared ? { sharedPost: shared } : null });
            } catch (e) { logger.warn('[metaChannel] retry session error: ' + e.message, { sessionId: s.id }); }
        }
    } catch (e) { logger.warn('[metaChannel] retry error: ' + e.message); }
}
/**
 * Опитувач розмов Meta (12.10): вебхук Instagram губить частину повідомлень — ~20% перших повідомлень із реклами («Яка ціна
 * кофти?», innabogovid / mike_gorone / mishakibish): подій не було взагалі, а в API розмов повідомлення є. Раз на 2 хв дивимось
 * свіжі розмови й пропускаємо через той самий вхід (handleMetaEvent) повідомлення клієнта, якого нема в нас, якщо: йому 1,5–30 хв
 * (вебхук мав шанс), після нього ніхто з нашого боку не писав (менеджер міг відповісти з телефона), і його нема в базі ні за id,
 * ні тим самим текстом ±3 хв. Реклама в API розмов не віддається — такий хід іде без товару з реклами (бот спитає/покаже список).
 */
const _convPollAt = new Map();
async function pollConversations() {
    const now = Date.now();
    for (const [botId, c] of _channel) {
        if (!c || c.v !== 'meta') continue;
        try {
            const bot = await db.bot.findUnique({ where: { id: botId }, select: { isActive: true } });
            if (!bot || !bot.isActive) continue;
            const tok = await token(botId); const own = await ownIgId(botId);
            const ownName = String(((await db.funnelKey.findFirst({ where: { botId, key: 'INSTAGRAM_USERNAME' }, select: { value: true } })) || {}).value || '').trim().toLowerCase();
            const since = (_convPollAt.get(botId) || now - 20 * 60 * 1000) - 5 * 60 * 1000;
            const lr = await fetch(GRAPH + '/me/conversations?platform=instagram&fields=id,updated_time&limit=25&access_token=' + encodeURIComponent(tok));
            const lj = await lr.json().catch(() => ({}));
            if (!lr.ok || lj.error) { logger.warn('[metaChannel] poll: список розмов ' + ((lj.error && lj.error.message) || lr.status), { botId }); continue; }
            _convPollAt.set(botId, now);
            let picked = 0;
            for (const conv of lj.data || []) {
                if (new Date(conv.updated_time).getTime() < since) continue;
                const mr = await fetch(GRAPH + '/' + conv.id + '?fields=messages.limit(10){id,created_time,from,message,attachments,shares}&access_token=' + encodeURIComponent(tok));
                const mj = await mr.json().catch(() => ({}));
                const msgs = (((mj.messages || {}).data) || []).slice().sort((a, b) => new Date(a.created_time) - new Date(b.created_time));
                const isOwn = (m) => { const f = m.from || {}; return (own && String(f.id) === own) || (ownName && String(f.username || '').toLowerCase() === ownName); };
                for (let i = 0; i < msgs.length; i++) {
                    const m = msgs[i]; if (isOwn(m) || !(m.from && m.from.id)) continue;
                    const at = new Date(m.created_time).getTime(); const age = now - at;
                    if (age < 90 * 1000 || age > 30 * 60 * 1000) continue;
                    if (msgs.slice(i + 1).some(isOwn)) continue; // уже відповіли (бот чи менеджер)
                    if (await db.processedMessage.findFirst({ where: { botId, updateId: 'meta_in_' + m.id }, select: { id: true } }).catch(() => null)) continue;
                    const text = String(m.message || '').trim();
                    if (text) {
                        const dup = await db.message.findFirst({ where: { role: 'user', createdAt: { gte: new Date(at - 180 * 1000), lte: new Date(at + 180 * 1000) }, content: { startsWith: text.slice(0, 60) }, session: { botId, context: { path: ['psid'], equals: String(m.from.id) } } }, select: { id: true } }).catch(() => null);
                        if (dup) continue;
                    }
                    const atts = [];
                    for (const a of ((m.attachments || {}).data || [])) { if (a.image_data && a.image_data.url) atts.push({ type: 'image', payload: { url: a.image_data.url } }); else if (a.video_data && a.video_data.url) atts.push({ type: 'video', payload: { url: a.video_data.url } }); }
                    const links = (((m.shares || {}).data) || []).map((s) => s.link).filter(Boolean);
                    const fullText = [text, ...links].filter(Boolean).join('\n');
                    if (!fullText && !atts.length) continue;
                    logger.info('[metaChannel] poll: повідомлення без вебхука — обробляю', { botId, from: m.from.username || m.from.id, textPreview: fullText.slice(0, 60), ageMin: Math.round(age / 60000) });
                    await handleMetaEvent(botId, { object: 'instagram', entry: [{ id: own, messaging: [{ sender: { id: String(m.from.id) }, recipient: { id: own }, timestamp: at, message: { mid: m.id, ...(fullText ? { text: fullText } : {}), ...(atts.length ? { attachments: atts } : {}) } }] }] });
                    picked++;
                }
            }
            if (picked) logger.info('[metaChannel] poll: підхоплено без вебхука', { botId, picked });
        } catch (e) { logger.warn('[metaChannel] poll error: ' + e.message, { botId }); }
    }
}

const __runsBackground = !process.env.name || process.env.name === 'platform-api';
if (__runsBackground) setTimeout(() => { pollConversations(); setInterval(pollConversations, 2 * 60 * 1000).unref(); }, 100 * 1000).unref();
if (__runsBackground) setTimeout(() => { retryUnanswered(); setInterval(retryUnanswered, 60 * 1000).unref(); }, 150 * 1000).unref();

module.exports = { handleMetaEvent, scheduleTurn, runTurn, drain, sendText, replyToComment, channelOf, channelOfSync, splitText, _echoes, _pollConversations: pollConversations, _refPatch: refPatch, _takeHeldRef: takeHeldRef, _refHold, _enqueue: enqueue, _waiting, _queue, _replyToSkuFor: replyToSkuFor };
