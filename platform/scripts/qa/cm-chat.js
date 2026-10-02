'use strict';
// Надіслати повідомлення Content Manager-у через webhook (як ніби його написав клієнт) і
// дочекатись відповіді бота, прочитавши її з БД сесії.
//   node scripts/qa/cm-chat.js <projectId> "<повідомлення>" [--wait=240]
// Імітація, а не обхід: той самий /webhook/bot/content-manager-v2, той самий граф.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require('@platform/db');

const BOT_ID = '22f2bce5-ac62-4297-8ea0-66e258e8b505';

async function chat(projectId, message, waitSec = 240) {
    const since = new Date();
    const r = await fetch('http://127.0.0.1:3000/webhook/bot/content-manager-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, projectId, testMode: true }),
    });
    if (!r.ok) throw new Error('webhook HTTP ' + r.status);

    const deadline = Date.now() + waitSec * 1000;
    let session = null;
    let last = 0;
    let stableSince = 0;
    let replies = [];
    while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 4000));
        if (!session) {
            session = await db.session.findFirst({ where: { botId: BOT_ID, startedAt: { gte: since } }, orderBy: { startedAt: 'desc' } });
            if (!session) continue;
        }
        const msgs = await db.message.findMany({ where: { sessionId: session.id, role: 'assistant', createdAt: { gt: since } }, orderBy: { createdAt: 'asc' } });
        // перше повідомлення диспетчера — службовий JSON наміру, не відповідь клієнту
        replies = msgs.map((m) => String(m.content || '')).filter((t) => !/^\s*\{"intent"/.test(t));
        if (replies.length !== last) { last = replies.length; stableSince = Date.now(); }
        // відповідь «встоялась» — 45 с без нових повідомлень (агент із кількома інструментами думає довго)
        if (replies.length && Date.now() - stableSince > 45000) break;
    }
    return { sessionId: session && session.id, replies };
}

module.exports = { chat };

if (require.main === module) {
    const [projectId, message] = process.argv.slice(2);
    const waitArg = process.argv.find((a) => a.startsWith('--wait='));
    chat(projectId, message, waitArg ? parseInt(waitArg.slice(7), 10) : 240)
        .then((r) => { console.log('session:', r.sessionId); r.replies.forEach((t, i) => console.log('--- reply ' + (i + 1) + ' ---\n' + t)); process.exit(0); })
        .catch((e) => { console.error(e); process.exit(1); });
}
