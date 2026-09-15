'use strict';

/**
 * zernioConversationSync.js — «джерело істини» для Instagram-розмови через Zernio.
 *
 * НАВІЩО (аудит 2026-09-13, живі сесії farrakhova401 / pol_natka / matifeyy / vasyafaliuta):
 * вебхук-потік Zernio (message.received / message.sent) — НЕПОВНИЙ і ЗАПІЗНІЛИЙ:
 *   • повідомлення клієнта приходять із затримкою ~2 хв (типово 113–116 с), частина —
 *     через 15–19 хв або 2 доби, частина НЕ приходить взагалі («185+ 79 кг» matifeyy);
 *   • повідомлення менеджера (message.sent) приходять через 2–19 хв або губляться зовсім
 *     (перші 3 репліки менеджера у farrakhova401 так і не дійшли).
 * Наслідок: бот бачив «нову розмову», що починається з «Часткова» або з адреси доставки,
 * відповідав «Привіт! Я Оля…» посеред продажу, який уже вів менеджер, і перепитував те,
 * що клієнт уже писав. 163 сесії за тиждень, де бот відповів у розмові менеджера.
 *
 * REST GET /inbox/conversations/{id}/messages повертає ПОВНУ розмову одразу і чітко
 * підписує відправника: sentVia='api' — наш бот, sentVia='comment_automation' —
 * Zernio-автоматизація коментарів (теж наша), sentVia порожнє + senderName='You' —
 * менеджер з інбокса. Тому ПЕРЕД кожним ходом бота (runFlowAndDeliver) звіряємось із цим
 * REST, а не з тим, що встиг принести вебхук:
 *   1) довантажуємо в сесію пропущені повідомлення клієнта і менеджера (з реальним часом);
 *   2) визначаємо, хто писав ОСТАННІМ серед вихідних: якщо менеджер — розмова
 *      менеджерська, бот мовчить (funnelPaused/manager_message), доки не спрацює
 *      звичайне правило відновлення після тиші менеджера;
 *   3) віддаємо у воронку ВСІ ще не відповіджені повідомлення клієнта у правильному
 *      порядку — не лише те, що приніс конкретний вебхук.
 *
 * Вимикач: funnelKey ZERNIO_TRUTH_SYNC=0. Будь-яка помилка REST → мовчазний фолбек на
 * стару поведінку (повертаємо { ok:false }), бот не ламається.
 */

const { db } = require('@platform/db');
const logger = require('@platform/logger');

const REST_LIMIT = 60;                 // останні N повідомлень розмови (найновіші перші)
const REST_TIMEOUT_MS = 6000;
const OUR_SENT_VIA = new Set(['api', 'comment_automation']);
const USER_MATCH_WINDOW_MS = 3 * 60 * 1000;      // вебхук клієнта: channelCreatedAt ≈ реальний час
const MANAGER_MATCH_WINDOW_MS = 30 * 60 * 1000;  // echo менеджера приходить із затримкою до ~20 хв
const OWN_ALBUM_WINDOW_MS = 20 * 1000;           // наш фото-альбом через Meta Graph = outgoing без sentVia поруч із api-текстом
const MAX_INSERT_PER_SYNC = 30;
const UNANSWERED_MAX_AGE_MS = 2 * 60 * 60 * 1000;   // у воронку йдуть лише «свіжі» невідповіджені (до 2 год)

const _norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const _keyCache = new Map();

async function getKeys(botId) {
    const c = _keyCache.get(botId);
    if (c && Date.now() - c.at < 60 * 1000) return c.v;
    const rows = await db.funnelKey.findMany({ where: { botId, key: { in: ['ZERNIO_API_TOKEN', 'ZERNIO_ACCOUNT_ID', 'ZERNIO_TRUTH_SYNC'] } }, select: { key: true, value: true } });
    const v = Object.fromEntries(rows.map((r) => [r.key, String(r.value || '').trim()]));
    _keyCache.set(botId, { at: Date.now(), v });
    return v;
}

function isReal(v) { return typeof v === 'string' && v.length > 3 && v !== 'REPLACE_ME'; }

async function fetchConversationMessages(keys, conversationId) {
    const ac = new AbortController();
    const to = setTimeout(() => { try { ac.abort(); } catch (e) { /* noop */ } }, REST_TIMEOUT_MS);
    try {
        const url = 'https://zernio.com/api/v1/inbox/conversations/' + encodeURIComponent(conversationId)
            + '/messages?accountId=' + encodeURIComponent(keys.ZERNIO_ACCOUNT_ID) + '&limit=' + REST_LIMIT + '&sortOrder=desc';
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + keys.ZERNIO_API_TOKEN }, signal: ac.signal });
        if (!r.ok) return { ok: false, status: r.status };
        const j = await r.json().catch(() => ({}));
        const raw = Array.isArray(j.messages) ? j.messages : Array.isArray(j.data) ? j.data : [];
        const msgs = raw.map((m) => {
            const createdAt = new Date(m.createdAt || m.sentAt || 0);
            const atts = Array.isArray(m.attachments) ? m.attachments : [];
            return {
                id: String(m.id || ''),
                direction: m.direction === 'outgoing' ? 'outgoing' : 'incoming',
                sentVia: String(m.sentVia || (m.metadata && m.metadata.sentVia) || ''),
                senderName: String(m.senderName || ''),
                text: String(m.message || m.text || ''),
                createdAt,
                attachments: atts.map((a) => ({ type: /video/i.test(String(a.type || '')) ? 'video' : 'photo', url: a.refreshUrl || a.url || null, refreshUrl: a.refreshUrl || null })).filter((a) => a.url),
            };
        }).filter((m) => Number.isFinite(m.createdAt.getTime())).sort((a, b) => a.createdAt - b.createdAt);
        return { ok: true, msgs };
    } catch (e) {
        return { ok: false, error: e.message };
    } finally { clearTimeout(to); }
}

/** Класифікація вихідного: 'bot' (наш API / автоматизація коментарів / наш фото-альбом) або 'manager'. */
function classifyOutgoing(m, allMsgs) {
    if (OUR_SENT_VIA.has(m.sentVia)) return 'bot';
    if (!m.text && m.attachments.length) {
        // Наш альбом фото товару йде через Meta Graph API напряму (sendMetaPhotoAlbum) — у Zernio
        // це outgoing без sentVia, але ЗАВЖДИ впритул (±20 с) до нашого api-тексту (картка товару).
        const near = allMsgs.some((o) => o !== m && o.direction === 'outgoing' && OUR_SENT_VIA.has(o.sentVia) && Math.abs(o.createdAt - m.createdAt) <= OWN_ALBUM_WINDOW_MS);
        if (near) return 'bot';
    }
    return 'manager';
}

function dbMsgTime(m) {
    const md = m.metadata || {};
    const ch = md.channelCreatedAt ? Date.parse(md.channelCreatedAt) : NaN;
    return Number.isFinite(ch) ? ch : new Date(m.createdAt).getTime();
}

/**
 * Основна функція. Повертає:
 *  { ok, managerLed, lastManagerAt, lastBotAt, unanswered:[{text,createdAt,attachments}], inserted:{user,manager} }
 * opts.dryRun — нічого не пише в БД (для тестів); opts.bypassManagerGate — для відновлення після тиші менеджера.
 */
async function syncConversationTruth(botId, sessionId, conversationId, opts = {}) {
    const dryRun = !!opts.dryRun;
    try {
        if (!conversationId || !sessionId) return { ok: false, reason: 'no-conversation' };
        const keys = await getKeys(botId);
        if (keys.ZERNIO_TRUTH_SYNC === '0' || keys.ZERNIO_TRUTH_SYNC === 'false') return { ok: false, reason: 'disabled' };
        if (!isReal(keys.ZERNIO_API_TOKEN) || !isReal(keys.ZERNIO_ACCOUNT_ID)) return { ok: false, reason: 'no-keys' };
        const rest = await fetchConversationMessages(keys, conversationId);
        if (!rest.ok) { logger.warn('[zernioSync] REST failed', { botId, sessionId, conversationId, status: rest.status || null, error: rest.error || null }); return { ok: false, reason: 'rest-failed' }; }
        // opts.asOf — для тестів: «як виглядала розмова на момент X» (обрізаємо новіші повідомлення).
        const asOf = opts.asOf ? new Date(opts.asOf).getTime() : null;
        const msgs = asOf ? rest.msgs.filter((m) => m.createdAt.getTime() <= asOf) : rest.msgs;
        if (!msgs.length) return { ok: true, managerLed: false, unanswered: [], inserted: { user: 0, manager: 0 }, empty: true };

        const existing = await db.message.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, role: true, content: true, metadata: true, createdAt: true } });
        const knownRestIds = new Set(existing.map((m) => String((m.metadata || {}).zernioRestId || '')).filter(Boolean));
        const isBotMsg = (m) => m.role === 'assistant' && ((m.metadata || {}).source) !== 'zernio_inbox';
        const isManagerMsg = (m) => m.role === 'assistant' && ((m.metadata || {}).source) === 'zernio_inbox';
        const isUserMsg = (m) => m.role === 'user';

        // Чи є це REST-повідомлення вже в нашій БД? Вебхук дає інший простір id (Mongo ObjectId
        // проти IG-формату в REST), тому звіряємо за (клас, нормалізований текст, вікно часу):
        //  • клієнт: metadata.channelCreatedAt (реальний час з ObjectId) або createdAt — ±3 хв;
        //  • менеджер: echo message.sent приходить ПІЗНІШЕ за реальний час до ~20 хв —
        //    приймаємо createdAt у [t-5с, t+30хв];
        //  • без тексту (фото): збіг за наявністю вкладення/плейсхолдера у тому ж вікні.
        const findKnown = (rm, cls) => {
            if (knownRestIds.has(rm.id)) return true;
            const txt = _norm(rm.text);
            const t = rm.createdAt.getTime();
            for (const em of existing) {
                if (cls === 'user' ? !isUserMsg(em) : !isManagerMsg(em)) continue;
                const inWindow = cls === 'user'
                    ? Math.abs(dbMsgTime(em) - t) <= USER_MATCH_WINDOW_MS
                    : (new Date(em.createdAt).getTime() - t) >= -5000 && (new Date(em.createdAt).getTime() - t) <= MANAGER_MATCH_WINDOW_MS;
                if (!inWindow) continue;
                const ec = _norm(em.content);
                if (txt) { if (ec === txt) return true; continue; }
                const md = em.metadata || {};
                if (md.attachment || (Array.isArray(md.attachments) && md.attachments.length) || /^\[(фото|відео|\d+ медіа|вкладення|фото ×\d+ від менеджера|повідомлення від менеджера|фото від менеджера|відео від менеджера|вкладення без файлу)/.test(ec)) return true;
            }
            return false;
        };

        let lastBotAt = 0, lastManagerAt = 0, lastManagerText = '';
        const toInsert = [];
        for (const rm of msgs) {
            if (rm.direction === 'outgoing') {
                const cls = classifyOutgoing(rm, msgs);
                if (cls === 'bot') { lastBotAt = Math.max(lastBotAt, rm.createdAt.getTime()); continue; }
                lastManagerAt = Math.max(lastManagerAt, rm.createdAt.getTime());
                if (rm.text) lastManagerText = rm.text;
                if (!findKnown(rm, 'manager')) toInsert.push({ cls: 'manager', rm });
            } else {
                if (!findKnown(rm, 'user')) toInsert.push({ cls: 'user', rm });
            }
        }
        // Локальні повідомлення бота, яких ще нема у Zernio (щойно надіслані) — теж «наші останні».
        // 2026-09-15 (живий кейс: "Запустити бота"/"Перезапустити сесію" в адмінці НЕ повертали
        // бота в розмову, де останнім вихідним було повідомлення менеджера) — managerLed рахується
        // ЧИСТО за часом і геть не знав про ці дії адміна: без явного маркера бот лишався
        // заблокованим НАЗАВЖДИ (сам собі розблокувати не міг — щоб надіслати щось, спершу треба
        // пройти managerLed). RESUME_MARKERS — той самий принцип, що вже є в testSession.js
        // (RESET_MARKERS для вікна історії LLM), тут — для розблокування managerLed: рахуємо їх у
        // lastBotAt НАВІТЬ якщо позначені hidden (приховані від LLM, але не від цього гейту).
        const RESUME_MARKERS = new Set(['admin_restart', 'manual_resume', 'test_mode_auto_restart']);
        for (const em of existing) {
            if (!isBotMsg(em) || (asOf && new Date(em.createdAt).getTime() > asOf)) continue;
            const emSrc = (em.metadata || {}).source;
            if ((em.metadata || {}).hidden && !RESUME_MARKERS.has(emSrc)) continue;
            lastBotAt = Math.max(lastBotAt, new Date(em.createdAt).getTime());
        }

        let insUser = 0, insManager = 0;
        if (!dryRun) {
            for (const it of toInsert.slice(0, MAX_INSERT_PER_SYNC)) {
                const rm = it.rm;
                const att = rm.attachments[0] ? { type: rm.attachments[0].type, url: rm.attachments[0].url, refreshUrl: rm.attachments[0].refreshUrl } : null;
                try {
                    if (it.cls === 'user') {
                        await db.message.create({ data: { sessionId, role: 'user', content: rm.text || (att ? (att.type === 'video' ? '[відео]' : '[фото]') : '[порожнє повідомлення]'), createdAt: rm.createdAt,
                            metadata: { source: 'zernio_sync', zernioRestId: rm.id, channelCreatedAt: rm.createdAt.toISOString(), ...(att ? { attachment: att, attachments: rm.attachments } : {}) } } });
                        insUser++;
                    } else {
                        const label = rm.text || (rm.attachments.length ? ('[' + (rm.attachments.length > 1 ? 'фото ×' + rm.attachments.length : (rm.attachments[0].type === 'video' ? 'відео' : 'фото')) + ' від менеджера]') : '[повідомлення від менеджера]');
                        await db.message.create({ data: { sessionId, role: 'assistant', content: label, createdAt: rm.createdAt,
                            metadata: { source: 'zernio_inbox', zernioRestId: rm.id, status: 'sent', syncedFromRest: true, ...(rm.attachments.length ? { attachments: rm.attachments.slice(0, 10) } : {}) } } });
                        insManager++;
                    }
                } catch (e) { logger.warn('[zernioSync] insert failed: ' + e.message, { sessionId }); }
            }
        }

        // Невідповіджені повідомлення клієнта: після ОСТАННЬОГО вихідного (нашого або менеджера).
        const lastOutAt = Math.max(lastBotAt, lastManagerAt);
        const nowRef = asOf || Date.now();
        const unanswered = msgs.filter((m) => m.direction === 'incoming' && m.createdAt.getTime() > lastOutAt && (nowRef - m.createdAt.getTime()) <= UNANSWERED_MAX_AGE_MS)
            .map((m) => ({ text: m.text, createdAt: m.createdAt, attachments: m.attachments }));
        const managerLed = lastManagerAt > 0 && lastManagerAt > lastBotAt;
        const result = { ok: true, managerLed, lastManagerAt: lastManagerAt || null, lastBotAt: lastBotAt || null, lastManagerText: String(lastManagerText).slice(0, 120), unanswered, inserted: { user: insUser, manager: insManager }, restCount: msgs.length, toInsert: dryRun ? toInsert.map((x) => ({ cls: x.cls, at: x.rm.createdAt.toISOString(), text: String(x.rm.text).slice(0, 60), att: x.rm.attachments.length })) : undefined };
        if (insUser || insManager) logger.info('[zernioSync] ingested missed messages from REST', { botId, sessionId, insUser, insManager, managerLed });
        return result;
    } catch (e) {
        logger.warn('[zernioSync] failed: ' + e.message, { botId, sessionId, conversationId });
        return { ok: false, reason: 'error', error: e.message };
    }
}

/** Чи увімкнено звірку з REST для цього бота (ключі є і не вимкнено ZERNIO_TRUTH_SYNC=0). */
async function isTruthSyncEnabled(botId) {
    try {
        const keys = await getKeys(botId);
        if (keys.ZERNIO_TRUTH_SYNC === '0' || keys.ZERNIO_TRUTH_SYNC === 'false') return false;
        return isReal(keys.ZERNIO_API_TOKEN) && isReal(keys.ZERNIO_ACCOUNT_ID);
    } catch (e) { return false; }
}

module.exports = { syncConversationTruth, isTruthSyncEnabled, classifyOutgoing, fetchConversationMessages };
