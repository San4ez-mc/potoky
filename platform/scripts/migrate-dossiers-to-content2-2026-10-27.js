'use strict';
// Одноразовий перенос уже зібраних анкет експертів (files/seller_dossier) у content2 (єдине джерело правди, 27.10).
// Безпечно: нічого не видаляє (копія у files лишається), не перезаписує у content2 новішу анкету, повторний запуск нічого не псує.
// Запуск з кореня platform/ ПІСЛЯ деплою content2 (потрібна таблиця seller_dossiers і вебхук seller-dossier):
//   DRY_RUN=1 node scripts/migrate-dossiers-to-content2-2026-10-27.js     (лише показати)

const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { db } = require('@platform/db');
const { createContent2Client } = require(path.join(ROOT, 'apps/api/src/services/content2Client'));
const { stamp } = require(path.join(ROOT, 'apps/api/src/services/dossierStore'));

const DRY = !!process.env.DRY_RUN;
const WEBHOOK = '/api/webhooks/seller-dossier';

(async () => {
    const content2 = createContent2Client({ db });
    const rows = await db.file.findMany({ where: { fileType: 'seller_dossier' }, orderBy: { updatedAt: 'desc' } });
    const seen = new Set();
    let moved = 0; let skipped = 0; let failed = 0;
    for (const row of rows) {
        const key = row.userId + '|' + row.botId;
        if (seen.has(key)) continue; seen.add(key); // лише найсвіжіша анкета експерта
        let state = null;
        try { state = JSON.parse(row.content); } catch { /* ignore */ }
        if (!state || !state.fields) { skipped++; console.log('  пропуск ' + row.userId.slice(0, 8) + ': порожня або зіпсована анкета'); continue; }
        const user = await db.user.findUnique({ where: { id: row.userId }, select: { telegramId: true, firstName: true, username: true } });
        if (!user) { skipped++; continue; }
        let testMode = false;
        if (row.sessionId) { const s = await db.session.findUnique({ where: { id: row.sessionId }, select: { context: true } }).catch(() => null); testMode = !!(s && s.context && s.context.testMode); }
        const projectName = (testMode ? 'QA ' : '') + 'Експерт TG' + String(user.telegramId);
        const filled = Object.keys(state.fields).length;
        try {
            const cur = await content2.call(WEBHOOK, { action: 'get', projectName }, 10000);
            if (cur.state && cur.state.fields && stamp(cur.state) >= stamp(state)) { skipped++; console.log('  ' + projectName + ': у content2 вже є така сама або новіша (' + Object.keys(cur.state.fields).length + ' полів)'); continue; }
            console.log('  ' + projectName + ' (' + (user.firstName || '') + (user.username ? ' @' + user.username : '') + '): ' + filled + ' полів ' + (DRY ? '→ перенесу' : '→ переношу'));
            if (!DRY) await content2.call(WEBHOOK, { action: 'put', projectId: cur.projectId || undefined, projectName, state }, 15000);
            moved++;
        } catch (e) { failed++; console.log('  ' + projectName + ': ПОМИЛКА ' + e.message); }
    }
    console.log((DRY ? 'Сухий прогін. ' : '') + 'Перенесено ' + moved + ', пропущено ' + skipped + ', помилок ' + failed + ' (унікальних експертів: ' + seen.size + ')');
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
