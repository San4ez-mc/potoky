'use strict';
/**
 * Копії фото/відео з розмов на нашому сервері (2026-10-14, власник: «фото від клієнта теж хочу бачити в адмінці»).
 * Вкладення клієнтів і менеджерів зберігались лише посиланням: Meta (lookaside.fbsbx.com) — підписане, живе кілька днів;
 * Zernio — API-адреса, що без ключа не відкривається. Тож в адмінці замість фото — «[фото]».
 * Фоновий прохід (раз на 2 хв, лише в platform-api) знаходить свіжі повідомлення з вкладеннями без копії, завантажує файл
 * у закриту папку (MEDIA_DIR, НЕ публічна — на фото бувають квитанції з номерами карток) і пише attachment.stored.
 * Адмінка показує /api/media/<stored> — маршрут за authMiddleware (cookie сесії).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('@platform/db');
const logger = require('@platform/logger');

const MEDIA_DIR = process.env.SESSION_MEDIA_DIR || path.join(__dirname, '..', '..', '..', 'uploads', 'session-media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
const MAX_BYTES = 25 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

const _zk = new Map(); // botId -> {at, token, account}
async function zernioAuth(botId) {
    const c = _zk.get(botId); if (c && Date.now() - c.at < 10 * 60 * 1000) return c;
    const rows = await db.funnelKey.findMany({ where: { botId, key: { in: ['ZERNIO_API_TOKEN', 'ZERNIO_ACCOUNT_ID'] } }, select: { key: true, value: true } }).catch(() => []);
    const k = Object.fromEntries(rows.map((r) => [r.key, String(r.value || '').trim()]));
    const v = { at: Date.now(), token: k.ZERNIO_API_TOKEN || '', account: k.ZERNIO_ACCOUNT_ID || '' };
    _zk.set(botId, v); return v;
}

/** Завантажити один файл; повертає ключ «<sessionId>/<файл>» або null. */
async function storeOne(botId, sessionId, url) {
    if (!url || !/^https?:\/\//i.test(String(url))) return null;
    const headers = {};
    if (/zernio\.com\/api\//i.test(url)) { const z = await zernioAuth(botId); if (!z.token) return null; headers.Authorization = 'Bearer ' + z.token; }
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 20000);
    try {
        const r = await fetch(String(url), { headers, signal: ac.signal, redirect: 'follow' });
        if (!r.ok) return { failed: 'HTTP ' + r.status };
        const ct = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!/^(image|video)\//.test(ct)) return { failed: 'content-type ' + (ct || '?') }; // сторінка помилки / HTML — не зберігаємо (урок §15.16)
        const buf = Buffer.from(await r.arrayBuffer());
        if (!buf.length || buf.length > MAX_BYTES) return { failed: 'size ' + buf.length };
        const name = crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 20) + '.' + (EXT[ct] || 'bin');
        const dir = path.join(MEDIA_DIR, String(sessionId).replace(/[^0-9a-f-]/gi, ''));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), buf);
        return { key: path.basename(dir) + '/' + name };
    } catch (e) { return { failed: e.message }; }
    finally { clearTimeout(to); }
}

/** Прохід: свіжі (за sinceHours) повідомлення з вкладеннями без копії. */
async function sweep({ sinceHours = 72, limit = 200 } = {}) {
    const rows = await db.$queryRawUnsafe(`select m.id, m."sessionId", s."botId", m.metadata from messages m join sessions s on s.id = m."sessionId"
        where m."createdAt" > now() - ($1 || ' hours')::interval and not coalesce((m.metadata->>'mediaStoreDone')::boolean, false)
          and (m.metadata ? 'attachment' or m.metadata ? 'attachments') order by m."createdAt" desc limit ${Number(limit) || 200}`, String(sinceHours)).catch((e) => { logger.warn('[mediaStore] query: ' + e.message); return []; });
    let stored = 0;
    for (const row of rows) {
        const md = row.metadata || {};
        // Медіа бота (наші фото з CRM) зберігати не треба — вони й так у нас.
        if (md.source === 'shop_agent') { await mark(row.id, md); continue; }
        const one = async (a) => {
            if (!a || a.stored || !a.url || !/^(photo|image|video|animation)$/i.test(String(a.type || ''))) return a;
            const r = (await storeOne(row.botId, row.sessionId, a.url)) || {};
            if (r.key) { stored++; return { ...a, stored: r.key }; }
            return { ...a, storeError: r.failed || 'n/a' };
        };
        const next = { ...md };
        if (md.attachment) next.attachment = await one(md.attachment);
        if (Array.isArray(md.attachments)) { const out = []; for (const a of md.attachments) out.push(await one(a)); next.attachments = out; }
        await mark(row.id, next);
    }
    if (stored) logger.info('[mediaStore] збережено копій: ' + stored);
    return { scanned: rows.length, stored };
}
async function mark(id, md) { await db.message.update({ where: { id }, data: { metadata: { ...md, mediaStoreDone: true } } }).catch(() => {}); }

/** Безпечний шлях до файлу за ключем «<sessionId>/<файл>» (без виходу за MEDIA_DIR). */
function filePath(key) {
    const m = String(key || '').match(/^([0-9a-f-]{36})\/([0-9a-f]{20}\.[a-z0-9]{2,4})$/i);
    return m ? path.join(MEDIA_DIR, m[1], m[2]) : null;
}

const __runsBackground = !process.env.name || process.env.name === 'platform-api';
if (__runsBackground) setTimeout(() => { sweep().catch(() => {}); setInterval(() => sweep().catch(() => {}), 2 * 60 * 1000).unref(); }, 90 * 1000).unref();

module.exports = { sweep, storeOne, filePath, MEDIA_DIR };
