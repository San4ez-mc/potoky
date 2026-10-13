// Застосувати SQL-файл (CREATE ... IF NOT EXISTS тощо) до бази Flows через клієнт платформи.
//   cd /var/www/flows.fineko.space/platform/apps/api && node ../../scripts/apply-sql.js ../../scripts/<файл>.sql
// Чому не `npx prisma db push` — падає на чужій таблиці global_keys (урок 15.14); `prisma db execute` з packages/db не бачить
// DATABASE_URL (13.10.2026). Розділювач запитів — «;» (у файлах міграцій без функцій/тригерів).
const path = require('path');
const { db } = require(path.join(__dirname, '../apps/api/src/services/shopAgent/lib'));
(async () => {
    const file = process.argv[2]; if (!file) { console.error('вкажіть .sql файл'); process.exit(1); }
    const sql = require('fs').readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) { await db.$executeRawUnsafe(stmt); console.log('ok:', stmt.split('\n')[0].slice(0, 80)); }
    process.exit(0);
})().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
