'use strict';
require('dotenv').config();
const { PrismaClient } = require('./node_modules/@prisma/client');
const db = new PrismaClient();
const BOT_ID = '3131ff8f-f341-48dd-a1aa-a3cf816185cd'; // bot-sales-automation

async function main() {
    // Get sessions with follow-up sent
    const sessions = await db.session.findMany({
        where: { botId: BOT_ID, isActive: true, isTest: false },
        include: { user: { select: { telegramId: true } } },
    });

    // Find token
    const connKey = await db.funnelKey.findFirst({ where: { botId: BOT_ID, key: 'TELEGRAM_CONNECTOR_ID' } });
    const sc = await db.savedConnector.findUnique({ where: { id: connKey.value }, select: { config: true } });
    const token = sc.config.token;
    console.log('Got token:', token ? 'YES' : 'NO');

    // Find users who got follow-ups
    const seen = new Set();
    const notified = sessions.filter(s => {
        const ctx = s.context || {};
        if ((ctx.followUpCount || 0) > 0 && s.user?.telegramId) {
            const tid = String(s.user.telegramId);
            if (!seen.has(tid)) { seen.add(tid); return true; }
        }
        return false;
    });

    console.log('Unique users to clean up:', notified.length);

    for (const session of notified) {
        const chatId = String(session.user.telegramId);
        console.log('Cleaning chat:', chatId);

        // Get recent messages from this chat to find our follow-up messages
        // Telegram doesn't let bots list messages, but we can send a "delete" marker
        // Instead: get updates to find message_ids? No - bots can't getChat messages
        // We'll just reset followUpCount so no more will be sent
        const ctx = session.context || {};
        console.log('  followUpCount was:', ctx.followUpCount);
        // Reset so we can track future state properly (messages already sent, can't delete)
        await db.session.update({
            where: { id: session.id },
            data: { context: { ...ctx, followUpCount: 99 } }, // 99 = permanently suppressed
        });
        console.log('  Suppressed future follow-ups for session', session.id);
    }

    console.log('Done. Note: already-sent Telegram messages cannot be deleted without stored message_ids.');
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e.message); process.exit(1); })
    .finally(() => db.$disconnect());
