'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *
 * Дрібне формулювання (запит власника, 2026-09-01): "Комплект 4 в 1... Беріть
 * весь комплект чи окрему позицію з нього?" — наказовий тон. Заміна на ввічливе
 * питання: "Бажаєте замовити весь комплект чи окрему позицію з нього?"
 *
 * ЗАПУСК:  node patch-setchoice-polite-phrasing.js            (dry-run)
 *          node patch-setchoice-polite-phrasing.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const OLD = 'Коротко назви, що входить у комплект і його ціну, і спитай: «Берете весь комплект чи окрему річ?» 🙂';
const NEW = 'Коротко назви, що входить у комплект і його ціну, і спитай: «Бажаєте замовити весь комплект чи окрему позицію з нього?» 🙂';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nChoice = flow.nodes.find((n) => n.id === 'n_set_choice');
    if (!nChoice) { console.log(name, 'ERROR: n_set_choice not found'); return; }

    const prompt = nChoice.data.systemPrompt || '';
    if (prompt.includes('Бажаєте замовити весь комплект')) { console.log(name, 'ALREADY_APPLIED'); return; }
    if (!prompt.includes(OLD)) { console.log(name, 'WARNING: анкор не знайдено — n_set_choice.systemPrompt міг змінитись. Пропускаю (перевір вручну).'); return; }

    console.log(name, 'n_set_choice.systemPrompt: "Берете... річ?" -> "Бажаєте замовити... позицію з нього?"');
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => (n.id === 'n_set_choice' ? { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.split(OLD).join(NEW) } } : n));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
