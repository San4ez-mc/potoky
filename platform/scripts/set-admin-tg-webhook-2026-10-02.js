/**
 * Підключає вебхук бота сповіщень воронки (ключ TELEGRAM_BOT_TOKEN) до /webhook/admin-tg — щоб працювали
 * кнопки під сповіщеннями менеджерам («📦 Оформити постачальнику», shopAgent/managerActions.js).
 * Лише callback_query: повідомлення в групі менеджерів бот і далі не читає.
 *
 * Не перехоплює чужий вебхук: якщо в бота вже стоїть інший URL — зупиняється (перезаписати: --force).
 *
 *   node scripts/set-admin-tg-webhook-2026-10-02.js <botId> [--force]
 */
const { loadAssets } = require('../apps/api/src/services/shopAgent/lib.js');
const { webhookSecret } = require('../apps/api/src/services/shopAgent/managerActions.js');

(async () => {
    const botId = process.argv[2]; const force = process.argv.includes('--force');
    if (!botId) { console.log('usage: node scripts/set-admin-tg-webhook-2026-10-02.js <botId> [--force]'); process.exit(1); }
    const a = await loadAssets(botId);
    const tok = String(a.keys.TELEGRAM_BOT_TOKEN || '');
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(tok)) { console.log('у воронки немає валідного TELEGRAM_BOT_TOKEN'); process.exit(1); }
    const api = (m, body) => fetch('https://api.telegram.org/bot' + tok + '/' + m, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
    const base = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://flows.fineko.space').replace(/\/$/, '');
    const url = base + '/webhook/admin-tg';
    const me = await api('getMe'); const info = await api('getWebhookInfo');
    const cur = (info.result && info.result.url) || '';
    console.log('бот:', me.result && me.result.username, '| поточний вебхук:', cur || '(немає)');
    if (cur && cur !== url && !force) { console.log('У бота вже інший вебхук — не перезаписую (додайте --force, якщо так і треба).'); process.exit(1); }
    const r = await api('setWebhook', { url, secret_token: webhookSecret(tok), allowed_updates: ['callback_query'], drop_pending_updates: false });
    console.log('setWebhook:', JSON.stringify(r));
    const after = await api('getWebhookInfo');
    console.log('тепер:', after.result && after.result.url, JSON.stringify(after.result && after.result.allowed_updates));
    process.exit(r.ok ? 0 : 1);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
