'use strict';
// Спільний клієнт до content2 через службовий вебхук /api/webhooks/seller-admin (list/get/put/knowledge).
// Адреса й секрет — з env або з ключів воронки `onboard`. Використовують сторінка «ШІ-продавці» і «База знань проєкту».

const CREDS_TTL_MS = 60 * 1000;

function createContent2Client({ db, fetchImpl = fetch, env = process.env }) {
    let credsCache = { at: 0, value: null };

    async function creds() {
        if (credsCache.value && Date.now() - credsCache.at < CREDS_TTL_MS) return credsCache.value;
        let url = env.CONTENT2_URL || '';
        let secret = env.CONTENT2_WEBHOOK_SECRET || '';
        if (!url || !secret) {
            const bot = await db.bot.findFirst({ where: { slug: 'onboard' }, select: { id: true } });
            if (bot) {
                const rows = await db.funnelKey.findMany({ where: { botId: bot.id, key: { in: ['CONTENT2_URL', 'CONTENT2_WEBHOOK_SECRET'] } }, select: { key: true, value: true } });
                const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
                url = url || m.CONTENT2_URL || '';
                secret = secret || m.CONTENT2_WEBHOOK_SECRET || '';
            }
        }
        if (!url || !secret) throw Object.assign(new Error('Не налаштовано звʼязок із content2 (CONTENT2_URL / CONTENT2_WEBHOOK_SECRET у ключах воронки onboard)'), { status: 503 });
        credsCache = { at: Date.now(), value: { url: url.replace(/\/$/, ''), secret } };
        return credsCache.value;
    }

    async function c2(body) {
        const c = await creds();
        let res;
        try {
            res = await fetchImpl(c.url + '/api/webhooks/seller-admin', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': c.secret }, body: JSON.stringify(body),
            });
        } catch (e) {
            throw Object.assign(new Error('Content2 недоступний: ' + e.message), { status: 502 });
        }
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.ok === false) throw Object.assign(new Error(j.error || ('content2 HTTP ' + res.status)), { status: res.status === 404 ? 404 : (res.status >= 500 ? 502 : res.status), missing: j.missing });
        return j;
    }

    // Публічна адреса content2 для посилань у браузері (CONTENT2_URL у ключах бува внутрішній, localhost)
    function publicUrl() {
        return String(env.CONTENT2_PUBLIC_URL || 'https://content2.fineko.space').replace(/\/$/, '');
    }

    return { creds, c2, publicUrl };
}

module.exports = { createContent2Client };
