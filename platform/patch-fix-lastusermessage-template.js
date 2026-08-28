'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Аудит 2026-08-27/28: {{context.lastUserMessage}} у ШАБЛОНАХ (renderTemplate)
 *   — ЗАВЖДИ порожній. Реальне поле лежить у context.flowRuntime.lastUserMessage
 *   (runtime.lastUserMessage), а не в context.lastUserMessage напряму —
 *   renderTemplate дивиться у ctx (root), не в runtime. Це ІНША помилка, ніж
 *   JS-нод, де `context.lastUserMessage||input` — safe fallback (там input
 *   несе поточне повідомлення напряму).
 *
 *   Виявлено користувачем: Telegram-сповіщення "🔔 БОТ НЕ ВИЗНАЧИВ ТОВАР"
 *   приходило з порожнім полем "Останнє:" — бо notifyTg-нода n_unknown_admin
 *   рендерить {{context.lastUserMessage}} у своєму message-шаблоні.
 *
 *   Той самий баг — у systemPrompt claude-ноди n_unknown_msg (обидва боти):
 *   «Повідомлення клієнта: «{{context.lastUserMessage}}»» — модель щоразу
 *   отримує порожні лапки замість реального тексту клієнта.
 *
 *   Фікс: {{context.lastUserMessage}} → {{context.flowRuntime.lastUserMessage}}
 *   у ДВОХ нодах × 2 боти = 4 місця.
 *
 * ЗАПУСК:  node patch-fix-lastusermessage-template.js            (dry-run)
 *          node patch-fix-lastusermessage-template.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const OLD = '{{context.lastUserMessage}}';
const NEW = '{{context.flowRuntime.lastUserMessage}}';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    let changed = false;
    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_unknown_admin' && n.data && typeof n.data.message === 'string' && n.data.message.includes(OLD)) {
            changed = true;
            return { ...n, data: { ...n.data, message: n.data.message.split(OLD).join(NEW) } };
        }
        if (n.id === 'n_unknown_msg' && n.data && typeof n.data.systemPrompt === 'string' && n.data.systemPrompt.includes(OLD)) {
            changed = true;
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.split(OLD).join(NEW) } };
        }
        return n;
    });

    if (!changed) { console.log(name, 'ALREADY_APPLIED'); return; }

    console.log(name, 'буде замінено', OLD, '->', NEW, 'у n_unknown_admin.message та/або n_unknown_msg.systemPrompt.');
    if (!APPLY) return;

    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
