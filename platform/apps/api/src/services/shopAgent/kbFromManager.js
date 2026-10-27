'use strict';
/**
 * shopAgent/kbFromManager.js — відповідь менеджера з чату → у базу знань (15.10, рішення власника: «спершу шукати в базі знань, якщо не
 * знайдено — додавати туди, далі кликати менеджера»; відповідь менеджера раніше губилась у чаті, і наступному клієнту бот знову не знав).
 *
 * Як: коли бот передає питання менеджеру, tools.kbAsk створює в CRM чернетку питання без відповіді й памʼятає її id у
 * ctx.agent.kbDrafts. Повідомлення менеджера в цій розмові протягом доби звіряємо з відкритими чернетками (ШІ): якщо воно ВІДПОВІДАЄ
 * на одне з питань — записуємо його в чернетку, вмикаємо запис і позначаємо тегом «з чату менеджера — перевірте».
 *
 * 27.10 (власник: «багато повторюваного… все правильно порозподіляй»): раніше відповіддю ставало ПЕРШЕ-ЛІПШЕ повідомлення менеджера —
 * у базі опинились «З вами менеджер Ірина», «Без передоплати не працюємо» (на питання про довжину рукава), номер ТТН, «Читаю діалог»,
 * і бот подавав це клієнтам як факт. Тепер: не відповідь → чернетка лишається відкритою (чекаємо наступного повідомлення менеджера);
 * ШІ недоступний → текст пишемо як ПРОПОЗИЦІЮ відповіді, але запис не вмикаємо (Олексій підтвердить у «Потребують відповіді»).
 */
const { callClaude } = require('@platform/claude');
const { db, logger, crmFetch, loadAssets } = require('./lib');

const DAY = 24 * 3600 * 1000;
const JUDGE_MODEL = 'claude-haiku-4-5';

/** Привітання/дрібниці — не відповідь на питання. Лише форма повідомлення, не зміст (зміст судить ШІ нижче). */
function isFiller(t) {
    const s = String(t || '').trim();
    if (!s) return true;
    if (/^(добр\S*\s+(день|ранок|вечір|ранку)|вітаю|привіт\S*|здрав\S*|дякую|дякуємо|секунду|хвилинку|зараз\s+уточню|уточн\S*)[\s!.,🙂😊💛🙏]*$/i.test(s)) return true;
    return false;
}

/**
 * На яке з відкритих питань відповідає повідомлення менеджера: індекс у `qs` (0-based), -1 — ні на яке, null — ШІ недоступний.
 * Відповідь — це факт по суті питання (так/ні теж рахується), а не привітання, представлення, прохання до клієнта чи інша тема.
 */
async function answeredIndex(sessionId, qs, text) {
    const prompt = 'Питання клієнта, які бот передав менеджеру:\n' + qs.map((q, i) => (i + 1) + '. ' + q).join('\n')
        + '\n\nПовідомлення менеджера клієнту:\n«' + text.slice(0, 800) + '»\n\n'
        + 'Чи відповідає це повідомлення по суті на одне з питань (дає факт: так/ні, число, матеріал, умову)? '
        + 'Привітання, «з вами менеджер…», прохання до клієнта (оплата, скріншот, дані), уточнення без факту, відповідь на ІНШЕ питання — це НЕ відповідь.\n'
        + 'Відповідай лише JSON: {"answers": <номер питання або 0>}';
    try {
        const raw = await callClaude({ sessionId, systemPrompt: 'Ти перевіряєш, чи відповів менеджер магазину на питання клієнта. Відповідаєш лише JSON.', messages: [{ role: 'user', content: prompt }], options: { model: JUDGE_MODEL, maxTokens: 20, extra: { temperature: 0 }, noFallbackOnBilling: true } });
        const m = String(raw || '').match(/\{[\s\S]*\}/);
        if (!m) return null;
        const n = Number(JSON.parse(m[0]).answers);
        return Number.isInteger(n) && n >= 1 && n <= qs.length ? n - 1 : -1;
    } catch (e) {
        logger.warn('[kbFromManager] judge failed: ' + e.message, { sessionId });
        return null;
    }
}

async function capture(botId, session, text, deps = {}) {
    try {
        const judge = deps.judge || answeredIndex;
        const cur = await db.session.findUnique({ where: { id: session.id }, select: { context: true } });
        const ctx = (cur && cur.context) || (session && session.context) || {};
        const drafts = Array.isArray(ctx.agent && ctx.agent.kbDrafts) ? ctx.agent.kbDrafts : [];
        const open = drafts.filter((d) => d && d.id && !d.answered && Date.now() - Number(d.at || 0) < DAY);
        const answer = String(text || '').trim();
        if (!open.length || isFiller(answer) || answer.length > 1500) return { skipped: true };
        const idx = await judge(session.id, open.map((d) => String(d.q || '').slice(0, 300)), answer);
        if (idx === -1) { logger.info('[kbFromManager] повідомлення менеджера — не відповідь на питання, чернетку не чіпаємо', { botId, sessionId: session.id }); return { skipped: true, notAnswer: true }; }
        // ШІ недоступний — не вгадуємо, яке питання: остання чернетка, але лише як пропозиція (запис вимкнено).
        const d = open[idx === null ? open.length - 1 : idx];
        const patch = idx === null
            ? { answer, isActive: false, tags: ['з чату менеджера', 'не перевірено'] }
            : { answer, isActive: true, tags: ['з чату менеджера', 'перевірте'] };
        const assets = await loadAssets(botId);
        const r = await crmFetch(assets.keys, '/knowledge/' + d.id, { method: 'PATCH', body: JSON.stringify(patch) }, 6000);
        if (!r.ok) { logger.warn('[kbFromManager] PATCH failed', { botId, sessionId: session.id, status: r.status }); return { ok: false }; }
        // Позначаємо в розмові, що на це питання вже є відповідь (атомарно, лише поле agent.kbDrafts).
        const fresh = await db.session.findUnique({ where: { id: session.id }, select: { context: true } });
        const c = (fresh && fresh.context) || {}; c.agent = c.agent || {};
        c.agent.kbDrafts = (c.agent.kbDrafts || []).map((x) => (x && x.id === d.id ? { ...x, answered: Date.now() } : x));
        await db.session.update({ where: { id: session.id }, data: { context: c } });
        logger.info('[kbFromManager] відповідь менеджера записано в базу знань', { botId, sessionId: session.id, entryId: d.id, q: d.q, active: patch.isActive });
        return { ok: true, entryId: d.id, active: patch.isActive };
    } catch (e) {
        logger.warn('[kbFromManager] capture failed: ' + e.message, { botId });
        return { ok: false };
    }
}

module.exports = { capture, isFiller, answeredIndex };
