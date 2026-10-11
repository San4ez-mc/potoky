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
async function sendText(botId, igsid, text) {
    const tok = await token(botId); let lastId = null;
    for (const part of splitText(text)) {
        let r, j;
        for (let attempt = 0; attempt < 3; attempt++) {
            r = await fetch(GRAPH + '/me/messages?access_token=' + encodeURIComponent(tok), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { id: String(igsid) }, message: { text: part } }) });
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
    const ref = msg.referral || m.referral || null;
    return { mid: msg.mid || null, text, media, sharedPost, audioUrl, story, ref, at: m.timestamp ? new Date(Number(m.timestamp)) : new Date() };
}

// ── Склеювання пачки повідомлень і черга ходів на сесію ──
const _pending = new Map(); const _queue = new Map();
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
        const prev = _queue.get(sessionId) || Promise.resolve();
        const run = prev.catch(() => {}).then(() => runTurn(sessionId, e)).catch((err) => logger.error('[metaChannel] turn failed', { sessionId, error: err.message }));
        _queue.set(sessionId, run);
        run.finally(() => { if (_queue.get(sessionId) === run) _queue.delete(sessionId); });
    }, DEBOUNCE_MS);
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
        await shopAgent.handleTurn({ botId, sessionId, text, imageUrl: e.imageUrl, imageUrls: e.imageUrls.length > 1 ? e.imageUrls : undefined, sharedPost: e.ctxPatch.sharedPost, entryAdId: e.ctxPatch.entryAdId, storyId: e.ctxPatch.storyId });
    } catch (err) { logger.error('[metaChannel] handleTurn failed', { botId, sessionId, error: err.message }); }
    const outMsgs = await db.message.findMany({ where: { sessionId, role: 'assistant', createdAt: { gt: sinceTime } }, orderBy: { createdAt: 'asc' } });
    // Клієнт уже пише далі (нова пачка в черзі) — застаріле прохання зросту/ваги не шлемо (як у zernioHandler).
    if (_pending.has(sessionId)) {
        for (const om of outMsgs) {
            if (!/agent:ask_params$/.test(String((om.metadata || {}).nodeId || ''))) continue;
            const rest = shopAgent.stripKnownHwAsk(String(om.content || ''));
            if (rest === String(om.content || '')) continue;
            if (rest) { om.content = rest; await db.message.update({ where: { id: om.id }, data: { content: rest } }).catch(() => {}); }
            else { om.metadata = { ...(om.metadata || {}), hidden: true, supersededBy: 'newer_client_message' }; await db.message.update({ where: { id: om.id }, data: { metadata: om.metadata } }).catch(() => {}); }
        }
    }
    await deliver(botId, sessionId, contactId, outMsgs);
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
            if (urls.length) {
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

/** Вхідна подія вебхука Meta. webhookBotId — бот із URL вебхука; цільовий — за ZERNIO_FORWARD_BOT_ID (той самий ключ, що для Zernio). */
async function handleMetaEvent(webhookBotId, body) {
    const botId = await Z.resolveZernioTargetBot(webhookBotId);
    const own = await ownIgId(botId);
    let processed = 0, skipped = 0;
    for (const entry of body.entry || []) {
        let events = (entry.messaging && entry.messaging.length ? entry.messaging : entry.standby) || [];
        if (!events.length && Array.isArray(entry.changes)) events = entry.changes.filter((c) => c && c.value && (c.field === 'messages' || c.field === 'message')).map((c) => c.value);
        for (const m of events) {
            try {
                if (m.read || m.reaction || m.message_edit || (!m.message && !m.postback)) { skipped++; continue; }
                const msg = m.message || {};
                // ── echo: повідомлення від нашого акаунта клієнту ──
                if (msg.is_echo || (own && m.sender && String(m.sender.id) === own)) {
                    const igsid = m.recipient && m.recipient.id; if (!igsid || !msg.mid) { skipped++; continue; }
                    const user = (await db.user.findMany({ where: { metadata: { path: ['psid'], equals: String(igsid) } } })).find((u) => !u.metadata.zernioBotId || u.metadata.zernioBotId === botId);
                    const session = user ? await db.session.findFirst({ where: { userId: user.id, botId }, orderBy: { startedAt: 'desc' } }) : null;
                    if (!session) { skipped++; continue; } // менеджер пише людині, якої бот не знає — розмови тут нема
                    if (_sent.has(String(msg.mid))) { skipped++; continue; }
                    await new Promise((res) => setTimeout(res, ECHO_SETTLE_MS)); // дати нашій відправці записати свій id
                    if (await isOurSent(msg.mid, session.id, msg.text)) { skipped++; continue; }
                    if (!(await dedup(botId, 'echo_' + msg.mid))) { skipped++; continue; }
                    const atts = (Array.isArray(msg.attachments) ? msg.attachments : []).map((a) => ({ type: a.type, url: a.payload && a.payload.url }));
                    await Z.recordManagerMessage(botId, session, { text: msg.text || '', attachments: atts, ids: { channel: 'meta', metaMessageId: msg.mid } });
                    processed++; continue;
                }
                // ── вхідне від клієнта ──
                const igsid = m.sender && m.sender.id; if (!igsid) { skipped++; continue; }
                const p = parseInbound(m); if (!p.mid) { skipped++; continue; }
                if (!(await dedup(botId, 'in_' + p.mid))) { skipped++; continue; }
                const patch = {};
                if (p.ref && (p.ref.ad_id || p.ref.adId)) {
                    patch.entryAdId = String(p.ref.ad_id || p.ref.adId);
                    patch.lastReferral = { ref: p.ref.ref || null, adId: patch.entryAdId, source: p.ref.source || null, type: p.ref.type || null, adTitle: (p.ref.ads_context_data && p.ref.ads_context_data.ad_title) || null, postId: (p.ref.ads_context_data && p.ref.ads_context_data.post_id) || null };
                    if (patch.lastReferral.adTitle) patch.adTitle = patch.lastReferral.adTitle;
                }
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
                } }) });
                await db.session.update({ where: { id: session.id }, data: { lastActive: new Date() } }).catch(() => {});
                processed++;
                if (await isBlockedByTestMode(botId, [prof.username, prof.name])) continue;
                const ctx = (await db.session.findUnique({ where: { id: session.id }, select: { context: true } })).context || {};
                // Менеджер веде розмову: бот мовчить (знімає resumeAfterManagerSilence / вручну). Виняток — клієнт за добу
                // повернувся з НОВОЮ рекламою чи постом (той самий принцип, що в zernioHandler).
                if (ctx.funnelPaused) {
                    const strong = !!(patch.entryAdId || sharedPost);
                    const old = ctx.pausedAt && Date.now() - new Date(ctx.pausedAt).getTime() > 24 * 3600 * 1000;
                    if (!(strong && old && /^manager_message/.test(String(ctx.pausedBy || '')))) continue;
                    await db.session.update({ where: { id: session.id }, data: { context: Z.cleanJsonDeep({ ...ctx, funnelPaused: false, pausedBy: null, resumedBy: 'client_return_24h', resumedAt: new Date().toISOString() }) } });
                }
                scheduleTurn(session.id, { botId, contactId: String(igsid), text, imageUrl: photo ? photo.url : null, ctxPatch: { ...(sharedPost ? { sharedPost, hasFreshSignalThisTurn: true } : {}), ...(patch.entryAdId ? { entryAdId: patch.entryAdId } : {}), ...(p.story && p.story.id ? { storyId: String(p.story.id) } : {}) } });
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
                const last = await db.message.findMany({ where: { sessionId: s.id, role: { in: ['user', 'assistant'] } }, orderBy: { createdAt: 'desc' }, take: 15, select: { role: true, content: true, createdAt: true, metadata: true } });
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
const __runsBackground = !process.env.name || process.env.name === 'platform-api';
if (__runsBackground) setTimeout(() => { retryUnanswered(); setInterval(retryUnanswered, 60 * 1000).unref(); }, 150 * 1000).unref();

module.exports = { handleMetaEvent, scheduleTurn, runTurn, sendText, channelOf, channelOfSync, splitText };
