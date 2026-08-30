'use strict';
/*
 * ТЕРМІНОВИЙ ФІКС патчу patch-lookup-remove-default-and-vision-confidence.js
 * (щойно застосованого) — новий текст vision-промпту в n_lookup містив
 * апостроф ("ОБОВ'ЯЗКОВО") УСЕРЕДИНІ рядка, який у самому коді ноди
 * обгорнутий ОДИНАРНИМИ лапками (var promptp='...'), — апостроф зламав
 * рядок і n_lookup.data.code перестав бути валідним JS (перевірено
 * new Function() self-check одразу після --apply, ПЕРШЕ ніж це побачив
 * реальний клієнт). Замінює "ОБОВ'ЯЗКОВО" на "завжди" (без апострофа) в
 * ОБОХ ботів.
 *
 * ЗАПУСК:  node patch-lookup-fix-apostrophe-syntax.js            (dry-run)
 *          node patch-lookup-fix-apostrophe-syntax.js --apply    (записує у БД)
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const BROKEN = "bestMatchIndex ОБОВ'ЯЗКОВО null";
const FIXED = 'bestMatchIndex завжди null';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    const n = flow.nodes.find((x) => x.id === 'n_lookup');
    const code = n.data.code || '';
    if (!code.includes(BROKEN)) { console.log(name, code.includes(FIXED) ? 'ALREADY_FIXED' : 'WARNING: BROKEN string not found — код інший, перевір вручну'); return; }
    console.log(name, 'буде виправлено апостроф');
    if (!APPLY) return;
    const newCode = code.split(BROKEN).join(FIXED);
    try {
        // eslint-disable-next-line no-new-func
        new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto', 'return (async () => { ' + newCode + ' })();');
    } catch (e) {
        console.log(name, 'SYNTAX STILL BROKEN AFTER FIX:', e.message, '— НЕ записую.');
        return;
    }
    const nodes = flow.nodes.map((x) => (x.id === 'n_lookup' ? { ...x, data: { ...x.data, code: newCode } } : x));
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED (syntax verified OK before write).');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
