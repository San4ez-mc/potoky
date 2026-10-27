'use strict';
// Сховище досьє експерта (анкета онбордингу): ЄДИНЕ джерело правди — content2 (таблиця seller_dossiers, вебхук seller-dossier).
// Рішення власника 27.10: Flows власного сховища не тримає. Перехідний період: усе, що пишемо в content2, дублюємо тіньовою копією
// у files(seller_dossier), щоб відкат був безболісним, а недоступний content2 не зупиняв розмову (експорт CSV теж читає цю копію).
// Читання: беремо новішу (за state.updatedAt) з двох, тож невдалий запис у content2 не губить свіжі відповіді (наступне збереження дошле їх).

const FILE_TYPE = 'seller_dossier';
const WEBHOOK = '/api/webhooks/seller-dossier';
const TIMEOUT_MS = 8000;

const stamp = (st) => { const t = Date.parse(st && st.updatedAt); return Number.isNaN(t) ? 0 : t; };
const isState = (st) => !!st && typeof st === 'object' && !!st.fields && typeof st.fields === 'object';

function createDossierStore({ db, content2, logger, emptyState }) {
    const warn = (m) => { try { logger.warn(m); } catch { /* ignore */ } };

    // Імʼя проєкту ТЕ САМЕ, що в ноді «Записати в content2» (вона знаходить проєкт за назвою), тож дублів проєктів не буде.
    async function expertKey(session) {
        let testMode = false; let projectId = ''; let tgId = '';
        try {
            const s = await db.session.findUnique({ where: { id: session.id }, select: { context: true } });
            const ctx = (s && s.context) || {};
            testMode = !!ctx.testMode;
            projectId = ctx.c2ProjectId || '';
        } catch { /* ignore */ }
        try { const u = await db.user.findUnique({ where: { id: session.userId }, select: { telegramId: true } }); tgId = u ? String(u.telegramId) : ''; } catch { /* ignore */ }
        return { projectName: tgId ? (testMode ? 'QA ' : '') + 'Експерт TG' + tgId : '', projectId };
    }

    async function load(sessionId) {
        const session = await db.session.findUnique({ where: { id: String(sessionId || '') }, select: { id: true, userId: true, botId: true } });
        if (!session) return null;
        const row = await db.file.findFirst({ where: { userId: session.userId, botId: session.botId, fileType: FILE_TYPE }, orderBy: { updatedAt: 'desc' } });
        let fileState = null;
        try { fileState = row ? JSON.parse(row.content) : null; } catch { fileState = null; }
        if (!isState(fileState)) fileState = null;

        let c2State = null; let key = { projectName: '', projectId: '' }; let projectId = '';
        try {
            key = await expertKey(session);
            if (key.projectName || key.projectId) {
                const j = await content2.call(WEBHOOK, { action: 'get', projectId: key.projectId || undefined, projectName: key.projectName || undefined }, TIMEOUT_MS);
                projectId = j.projectId || key.projectId || '';
                if (isState(j.state)) c2State = j.state;
            }
        } catch (e) { warn('[dossierStore] content2 get: ' + e.message); }

        let state; let source;
        if (c2State && fileState) {
            if (stamp(fileState) > stamp(c2State)) { state = fileState; source = 'file-newer'; } else { state = c2State; source = 'content2'; }
        } else if (c2State) { state = c2State; source = 'content2'; }
        else if (fileState) { state = fileState; source = 'file'; }
        else { state = emptyState(); source = 'new'; }
        return { session, row, state, key, projectId, source };
    }

    async function save(ctx) {
        const content = JSON.stringify(ctx.state);
        // 1) тіньова копія (старе місце), завжди
        if (ctx.row) await db.file.update({ where: { id: ctx.row.id }, data: { content, sessionId: ctx.session.id } });
        else ctx.row = await db.file.create({ data: { userId: ctx.session.userId, botId: ctx.session.botId, sessionId: ctx.session.id, fileType: FILE_TYPE, fileName: 'seller_dossier.json', filePath: `/seller-dossier/${ctx.session.userId}.json`, content, version: 1 } });
        // 2) content2: основне сховище; збій не зупиняє розмову (наступне збереження дошле)
        try {
            if (!ctx.key || (!ctx.key.projectName && !ctx.key.projectId)) return;
            const j = await content2.call(WEBHOOK, { action: 'put', projectId: ctx.projectId || ctx.key.projectId || undefined, projectName: ctx.key.projectName || undefined, state: ctx.state }, TIMEOUT_MS);
            if (j.projectId && j.projectId !== ctx.projectId) {
                ctx.projectId = j.projectId;
                // запамʼятовуємо проєкт у контексті розмови: його використовують «Створити продавця» та інші ноди
                const s = await db.session.findUnique({ where: { id: ctx.session.id }, select: { context: true } });
                const cur = (s && s.context) || {};
                if (cur.c2ProjectId !== j.projectId) await db.session.update({ where: { id: ctx.session.id }, data: { context: { ...cur, c2ProjectId: j.projectId } } });
            }
        } catch (e) { warn('[dossierStore] content2 put: ' + e.message); }
    }

    return { load, save };
}

module.exports = { createDossierStore, stamp, FILE_TYPE };
