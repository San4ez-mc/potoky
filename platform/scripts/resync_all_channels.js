'use strict';

const { db } = require('@platform/db');
const { syncChannelsForBot } = require('../apps/api/src/services/channelSync');

async function main() {
    const bots = await db.bot.findMany({ select: { id: true, slug: true } });

    let total = 0;
    let okCount = 0;
    let failCount = 0;

    for (const bot of bots) {
        total += 1;
        try {
            const result = await syncChannelsForBot(bot.id);
            if (result?.channels?.length) {
                if (result.ok) {
                    okCount += 1;
                    console.log(`OK: ${bot.slug} (${bot.id})`, JSON.stringify(result));
                } else {
                    failCount += 1;
                    console.log(`FAIL: ${bot.slug} (${bot.id})`, JSON.stringify(result));
                }
            }
        } catch (err) {
            failCount += 1;
            console.log(`ERROR: ${bot.slug} (${bot.id}) -> ${err.message}`);
        }
    }

    console.log(`Done. total=${total}, synced_ok=${okCount}, failed=${failCount}`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$disconnect();
    });
