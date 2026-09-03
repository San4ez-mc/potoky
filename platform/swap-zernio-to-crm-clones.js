'use strict';
/*
 * СВАП ТРАФІКУ Zernio: старі KeyCRM-боти → CRM-клони (2026-09-04), без зміни налаштувань Zernio.
 * Zernio шле вебхук на /webhook/zernio/<СТАРИЙ botId>. Двигун (zernioHandler.resolveZernioTargetBot)
 * читає funnelKey ZERNIO_FORWARD_BOT_ID старого бота і обробляє подію під ботом-ціллю (клоном).
 *
 * Що робить для кожної пари (goverla, covercar):
 *  1) звіряє, що канальні ключі клона ідентичні старим (ZERNIO_*, INSTAGRAM_*, TELEGRAM_BOT_TOKEN,
 *     ADMIN_TELEGRAM_ID) — інакше STOP (клон не зможе відповідати в той самий Instagram);
 *  2) перевіряє, що клон не в testMode (bot.settings.testMode) і має патч аудиту (n_supplier_pay_gate);
 *  3) ставить ZERNIO_FORWARD_BOT_ID = <clone> на старому боті;
 *  4) перейменовує: клон → без "[КЛОН → Fineko CRM]", старий → "[АРХІВ KeyCRM …]" + isActive=false.
 *
 * ЗАПУСК:  node swap-zernio-to-crm-clones.js            (dry-run)
 *          node swap-zernio-to-crm-clones.js --apply
 *          node swap-zernio-to-crm-clones.js --rollback  (прибрати форвард, повернути isActive/назви)
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const PAIRS = [
    { name: 'goverla', oldBotId: '5bdb3e38-1936-416f-b1f0-8f1125583193', newBotId: 'fcdee415-bef2-4a74-a650-e6e4b5a12322' },
    { name: 'covercar', oldBotId: 'cc03657f-9e72-46e5-a16d-88826e70c2ee', newBotId: 'a2d5ba79-f87b-48f2-8301-56292cdf3972' },
];
const CHANNEL_KEYS = ['ZERNIO_API_TOKEN', 'ZERNIO_ACCOUNT_ID', 'ZERNIO_SEND_URL', 'INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_BUSINESS_ID', 'INSTAGRAM_USERNAME', 'TELEGRAM_BOT_TOKEN', 'ADMIN_TELEGRAM_ID', 'SHOP_TAG'];
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');
const ARCHIVE_TAG = ' [АРХІВ KeyCRM, трафік → Fineko CRM з 2026-09-04]';
const CLONE_TAG = /\s*\[КЛОН → Fineko CRM\]\s*/;

async function keysOf(botId) {
    const rows = await db.funnelKey.findMany({ where: { botId }, select: { key: true, value: true } });
    return Object.fromEntries(rows.map((r) => [r.key, (r.value || '').trim()]));
}

async function swapPair(p) {
    const oldBot = await db.bot.findUnique({ where: { id: p.oldBotId } });
    const newBot = await db.bot.findUnique({ where: { id: p.newBotId } });
    if (!oldBot || !newBot) { console.log(p.name, 'ERROR: бот не знайдено', !!oldBot, !!newBot); return false; }
    const ok = await keysOf(p.oldBotId), nk = await keysOf(p.newBotId);
    const diff = CHANNEL_KEYS.filter((k) => (ok[k] || '') !== (nk[k] || ''));
    console.log(`\n=== ${p.name}: "${oldBot.name}" → "${newBot.name}"`);
    console.log('  старий isActive=' + oldBot.isActive + ', форвард зараз: ' + (ok.ZERNIO_FORWARD_BOT_ID || '—'));
    console.log('  клон settings=' + JSON.stringify(newBot.settings || {}));
    if (ROLLBACK) {
        console.log('  ROLLBACK: прибрати ZERNIO_FORWARD_BOT_ID, isActive=true, повернути назви');
        if (!APPLY) return true;
        await db.funnelKey.deleteMany({ where: { botId: p.oldBotId, key: 'ZERNIO_FORWARD_BOT_ID' } });
        await db.bot.update({ where: { id: p.oldBotId }, data: { isActive: true, name: oldBot.name.replace(ARCHIVE_TAG, '') } });
        console.log('  ROLLED BACK');
        return true;
    }
    if (diff.length) { console.log('  STOP: канальні ключі клона відрізняються від старого бота: ' + diff.join(', ') + ' — вирівняй ключі клона перед свапом.'); return false; }
    if (newBot.settings && newBot.settings.testMode) { console.log('  STOP: у клона увімкнено testMode — відповідатиме лише дозволеним; вимкни в налаштуваннях воронки.'); return false; }
    const flow = await db.flowDefinition.findUnique({ where: { botId: p.newBotId }, select: { nodes: true } });
    if (!flow || !flow.nodes.some((n) => n.id === 'n_supplier_pay_gate')) { console.log('  STOP: на клоні ще не застосовано patch-goverla-crm-audit-2026-09-04.js (нема n_supplier_pay_gate).'); return false; }
    if (!nk.CRM_API_KEY || !nk.CRM_API_BASE) { console.log('  STOP: у клона нема CRM_API_KEY/CRM_API_BASE.'); return false; }
    const alreadyForward = ok.ZERNIO_FORWARD_BOT_ID === p.newBotId;
    console.log('  план: ZERNIO_FORWARD_BOT_ID=' + p.newBotId + (alreadyForward ? ' (уже стоїть)' : '') + '; старий → isActive=false + назва з тегом архіву; клон → назва без "[КЛОН]"');
    if (!APPLY) return true;
    await db.funnelKey.upsert({
        where: { botId_key: { botId: p.oldBotId, key: 'ZERNIO_FORWARD_BOT_ID' } },
        update: { value: p.newBotId, label: 'Свап трафіку: події Zernio обробляє цей бот (CRM-клон)' },
        create: { botId: p.oldBotId, key: 'ZERNIO_FORWARD_BOT_ID', value: p.newBotId, label: 'Свап трафіку: події Zernio обробляє цей бот (CRM-клон)', isSecret: false },
    });
    await db.bot.update({ where: { id: p.oldBotId }, data: { isActive: false, name: oldBot.name.includes(ARCHIVE_TAG) ? oldBot.name : oldBot.name + ARCHIVE_TAG } });
    await db.bot.update({ where: { id: p.newBotId }, data: { name: newBot.name.replace(CLONE_TAG, ' ').replace(/\s+$/, '') + (newBot.name.includes('Fineko CRM') ? '' : ' (Fineko CRM)') } });
    console.log('  APPLIED');
    return true;
}

(async () => {
    let allOk = true;
    for (const p of PAIRS) { const r = await swapPair(p); allOk = allOk && r; }
    if (!APPLY) console.log('\nDRY-RUN — запусти з --apply' + (allOk ? '.' : ' ПІСЛЯ усунення STOP-причин вище.'));
    process.exit(allOk ? 0 : 1);
})().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
