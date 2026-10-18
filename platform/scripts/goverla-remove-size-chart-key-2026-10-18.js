'use strict';
// Розміри переїхали в CRM (18.10: товар → категорія → «Налаштування → Загальні»), тож ключ воронки SIZE_CHART — друга копія, яка
// з часом розійдеться з CRM. Видаляємо (рішення власника 18.10). Перед видаленням — значення в /root/size-chart-key.backup-2026-10-18.json
// і перевірка, що CRM справді віддає сітку магазину (інакше бот лишився б без сітки).
//   node scripts/goverla-remove-size-chart-key-2026-10-18.js [--apply]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { db, loadAssets } = require(path.join(__dirname, '..', 'apps', 'api', 'src', 'services', 'shopAgent', 'lib'));
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
(async () => {
    const apply = process.argv.includes('--apply');
    const rows = await db.funnelKey.findMany({ where: { botId: BOT, key: 'SIZE_CHART' } });
    if (!rows.length) { console.log('ключа SIZE_CHART уже нема'); process.exit(0); }
    const a = await loadAssets(BOT);
    const base = String(a.keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\/$/, '');
    const r = await fetch(base + '/tenant/size-fit', { headers: { Authorization: 'Bearer ' + a.keys.CRM_API_KEY, Accept: 'application/json' } });
    const j = r.ok ? await r.json() : null;
    const n = j && j.data && j.data.fitChart ? Object.keys(j.data.fitChart).length : 0;
    console.log('CRM: сітка магазину — ' + (n ? n + ' розмірів, меж ' + (j.data.sizeRules || []).length : 'НЕМА'));
    if (!n) { console.log('у CRM нема сітки магазину — ключ не видаляю'); process.exit(1); }
    if (!apply) { console.log('перевірка: буде видалено записів ' + rows.length + ' (без --apply нічого не змінено)'); process.exit(0); }
    fs.writeFileSync('/root/size-chart-key.backup-2026-10-18.json', JSON.stringify(rows, null, 2));
    await db.funnelKey.deleteMany({ where: { botId: BOT, key: 'SIZE_CHART' } });
    console.log('видалено: SIZE_CHART (' + rows.length + '), копія — /root/size-chart-key.backup-2026-10-18.json');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
