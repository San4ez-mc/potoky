'use strict';
/*
 * Одноразовий скрипт: видалити СТАРІ ТЕСТОВІ сесії (isTest === true, кнопка
 * «Тест» в адмін-панелі) для goverla_shop і covercar_ua — лишити тільки
 * справжній трафік (реальні Instagram-клієнти через Zernio webhook).
 *
 * НЕ чіпає isTest === false сесії, навіть якщо ім'я користувача виглядає
 * "тестовим" (напр. stopfix2_user) — без явного isTest-прапорця це може
 * бути реальний клієнт/тестер, видаляти наосліп ризиковано.
 *
 * Видаляє в порядку FK: messages → apiCalls → files → errors → сесія.
 *
 * ЗАПУСК:  node cleanup-test-sessions.js            (dry-run, лише порахує)
 *          node cleanup-test-sessions.js --apply    (реально видаляє)
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

// Мої власні діагностичні curl-симуляції webhook'ів цієї сесії роботи (НЕ isTest —
// пройшли через реальний webhook-шлях, тому платформа їх так не позначила).
// Явний список id, знайдений вручну за синтетичними igUsername (stopfix*, test_*).
// НЕ включає oleksii_sirazetdinov/matsukoleksandr — це реальний тестер користувача,
// чию історію раніше вже (нез'ясовно) втратили — цю НЕ чіпаємо.
const DIAG_SESSION_IDS = [
    '64d7be2e-a147-4573-8133-926348dadc62', // stopfix2_user
    '435c1dad-b5c0-48cb-86f3-f9dce6819387', // stopfix_user
    'a4f76d27-513c-4d11-ab92-2d09a4a99888', // test_silent_user
    '066aa9e0-cf3d-4556-9299-a55cb61d9233', // test_customer
];

async function cleanupBot(name, botId) {
    const testIds = (await db.session.findMany({ where: { botId, isTest: true }, select: { id: true } })).map((s) => s.id);
    const diagIds = (await db.session.findMany({ where: { botId, id: { in: DIAG_SESSION_IDS } }, select: { id: true } })).map((s) => s.id);
    const ids = Array.from(new Set([...testIds, ...diagIds]));
    if (!ids.length) { console.log(name, 'немає тестових сесій.'); return; }
    console.log(name, '(isTest=' + testIds.length + ', діагностичних=' + diagIds.length + ')');

    console.log(name, 'тестових сесій:', ids.length);
    if (!APPLY) return;

    const delMsg = await db.message.deleteMany({ where: { sessionId: { in: ids } } });
    const delApi = await db.apiCall.deleteMany({ where: { sessionId: { in: ids } } });
    const delFiles = await db.file.deleteMany({ where: { sessionId: { in: ids } } });
    const delErr = await db.appError.deleteMany({ where: { sessionId: { in: ids } } });
    const delSess = await db.session.deleteMany({ where: { id: { in: ids } } });
    console.log(name, 'видалено: сесій=' + delSess.count, 'повідомлень=' + delMsg.count, 'apiCalls=' + delApi.count, 'files=' + delFiles.count, 'errors=' + delErr.count);
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await cleanupBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
