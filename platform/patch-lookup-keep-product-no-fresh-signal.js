'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   ЗАЛЕЖНІСТЬ: після patch-stale-product-welcome-back.js і
 *   patch-signal-cond-known-product.js — цей патч довершує їх, виправляючи
 *   справжній корінь бага (виявлено токен-діагностикою з тимчасовим
 *   вимкненням bot.settings.testMode на СИНТЕТИЧНІй сесії, одразу відновлено).
 *
 *   n_lookup мав ранній вихід "нічого не робити, товар уже той самий":
 *   `_matchKey === entryAd`. Але ЦЕ рятує ЛИШЕ товари, знайдені по ad_id/post_id.
 *   Товар, знайдений ПО АРТИКУЛУ В ТЕКСТІ (_matchKey="art_XXXX"), НІКОЛИ не
 *   проходив цей вихід (entryAd для нього завжди порожній/інший) — тож просте
 *   "Вітаб" (жодного сигналу) все одно запускало ПОВНЕ повторне сканування,
 *   нічого не знаходило і падало у fallback() → { product: null }, ЗНИЩУЮЧИ
 *   щойно знайдений товар ще ДО того, як новий n_returning_check міг
 *   перевірити "чи є свіжий сигнал". Саме тому попередні два патчі (нові ноди
 *   n_prev_match_snapshot/n_returning_check/n_welcome_back) не спрацьовували —
 *   n_lookup встигав знищити context.product раніше, ніж вони його бачили.
 *
 *   Фікс: ранній вихід ТЕПЕР ТАКОЖ рятує товар, якщо hasFreshSignalThisTurn
 *   (рахує n_prev_match_snapshot, вже вставлена патчем вище) — false, тобто
 *   ЦЕЙ хід не приніс нічого нового щодо товару.
 *
 * ЗАПУСК:  node patch-lookup-keep-product-no-fresh-signal.js            (dry-run)
 *          node patch-lookup-keep-product-no-fresh-signal.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const NEW_LOOKUP_CODE_GOVERLA = fs.readFileSync(path.join(__dirname, 'n_lookup-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

const CC_OLD = `if (context.product && context.product._source === 'keycrm' && String(context.product._matchKey) === String(context.entryAd||context.__lk||'')) return {};`;
const CC_NEW = `// Аудит 2026-08-29 (живий кейс, matsukoleksandr): _matchKey===entryAd рятує лише
// ad_id-збіги — товар, знайдений по артикулу в тексті (_matchKey="art_XXXX"),
// цей вихід ніколи не проходив, тож "Вітаб" (без сигналу) все одно запускав
// повне сканування, нічого не знаходив і падав у fallback() -> {product:null},
// знищуючи щойно знайдений товар. hasFreshSignalThisTurn рахує
// n_prev_match_snapshot (нова нода перед n_lookup) — немає сигналу -> лишаємо товар.
if (context.product && context.product._source === 'keycrm' && (String(context.product._matchKey) === String(context.entryAd||context.__lk||'') || !context.hasFreshSignalThisTurn)) return {};`;

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    if (!nLookup) { console.log(name, 'ERROR: n_lookup not found'); return; }

    const done = nLookup.data.code.includes('hasFreshSignalThisTurn');
    if (done) { console.log(name, 'ALREADY_APPLIED'); return; }

    if (name === 'covercar' && !nLookup.data.code.includes(CC_OLD)) {
        console.log(name, 'WARNING: анкор CC_OLD не знайдено — лишаю без змін, перевір вручну.');
        return;
    }

    console.log(name, 'буде оновлено ранній вихід n_lookup (враховує hasFreshSignalThisTurn).');
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id !== 'n_lookup') return n;
        if (name === 'goverla') return { ...n, data: { ...n.data, code: NEW_LOOKUP_CODE_GOVERLA } };
        return { ...n, data: { ...n.data, code: n.data.code.split(CC_OLD).join(CC_NEW) } };
    });
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + NEW_LOOKUP_CODE_GOVERLA + '\n})();');
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
