'use strict';
/**
 * shopAgent/kbFromManager.js — відповідь менеджера з чату → у базу знань (15.10, рішення власника: «спершу шукати в базі знань, якщо не
 * знайдено — додавати туди, далі кликати менеджера»; відповідь менеджера раніше губилась у чаті, і наступному клієнту бот знову не знав).
 *
 * Як: коли бот передає питання менеджеру, tools.kbAsk створює в CRM чернетку питання без відповіді й памʼятає її id у
 * ctx.agent.kbDrafts. Перше повідомлення менеджера в цій розмові протягом доби — відповідь на останнє таке питання: записуємо його
 * в чернетку, вмикаємо запис і позначаємо тегом «з чату менеджера — перевірте» (Олексій виправить у CRM, якщо треба).
 */
const { db, logger, crmFetch, loadAssets } = require('./lib');

const DAY = 24 * 3600 * 1000;

/** Привітання/дрібниці — не відповідь на питання. Лише форма повідомлення, не зміст. */
function isFiller(t) {
    const s = String(t || '').trim();
    if (!s) return true;
    if (/^(добр\S*\s+(день|ранок|вечір|ранку)|вітаю|привіт\S*|здрав\S*|дякую|дякуємо|секунду|хвилинку|зараз\s+уточню|уточн\S*)[\s!.,🙂😊💛🙏]*$/i.test(s)) return true;
    return false;
}

async function capture(botId, session, text) {
    try {
        const cur = await db.session.findUnique({ where: { id: session.id }, select: { context: true } });
        const ctx = (cur && cur.context) || (session && session.context) || {};
        const drafts = Array.isArray(ctx.agent && ctx.agent.kbDrafts) ? ctx.agent.kbDrafts : [];
        const open = drafts.filter((d) => d && d.id && !d.answered && Date.now() - Number(d.at || 0) < DAY);
        const answer = String(text || '').trim();
        if (!open.length || isFiller(answer) || answer.length > 1500) return { skipped: true };
        const d = open[open.length - 1];
        const assets = await loadAssets(botId);
        const r = await crmFetch(assets.keys, '/knowledge/' + d.id, { method: 'PATCH', body: JSON.stringify({ answer, isActive: true, tags: ['з чату менеджера', 'перевірте'] }) }, 6000);
        if (!r.ok) { logger.warn('[kbFromManager] PATCH failed', { botId, sessionId: session.id, status: r.status }); return { ok: false }; }
        // Позначаємо в розмові, що на це питання вже є відповідь (атомарно, лише поле agent.kbDrafts).
        const fresh = await db.session.findUnique({ where: { id: session.id }, select: { context: true } });
        const c = (fresh && fresh.context) || {}; c.agent = c.agent || {};
        c.agent.kbDrafts = (c.agent.kbDrafts || []).map((x) => (x && x.id === d.id ? { ...x, answered: Date.now() } : x));
        await db.session.update({ where: { id: session.id }, data: { context: c } });
        logger.info('[kbFromManager] відповідь менеджера записано в базу знань', { botId, sessionId: session.id, entryId: d.id, q: d.q });
        return { ok: true, entryId: d.id };
    } catch (e) {
        logger.warn('[kbFromManager] capture failed: ' + e.message, { botId });
        return { ok: false };
    }
}

module.exports = { capture, isFiller };
