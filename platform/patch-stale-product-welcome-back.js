'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Живий кейс (matsukoleksandr, 2026-08-29): сесії не мають TTL — товар,
 *   визначений 2 ДНІ ТОМУ (context.product + context.sharedPost), лишається
 *   в контексті НАЗАВЖДИ. Клієнт написав просте "Вітаб" (без жодної згадки
 *   товару) — а бот одразу вивалив ПОВНУ презентацію старого товару (5 фото
 *   + повний опис), ніби той щойно переслав пост. Корінь: n_have_product
 *   (`context.product && context.product.name`) — тривіально TRUE назавжди,
 *   щойно товар хоч раз визначили, незалежно від того, чи ЦЕЙ конкретний хід
 *   має бодай якийсь стосунок до товару. У goverla додатково n_signal_check
 *   мав ту саму ваду: `hasPost = !!(context.sharedPost || context.entryAd)`
 *   перевіряв факт ІСНУВАННЯ поля, а не його СВІЖІСТЬ — застарілий sharedPost
 *   із минулої розмови завжди читався як "клієнт щойно переслав пост".
 *
 *   Рішення (обговорено з власником, варіант 1): не сканувати старий
 *   sharedPost.caption заново, якщо ЦЕЙ хід не містить жодного свіжого
 *   сигналу товару (новий пост/рілс, артикул у тексті, фото) — замість
 *   повної презентації показати м'яке "З поверненням! Ви цікавились Х —
 *   актуально, чи щось інше?", не форсуючи товар, який клієнт, можливо, вже
 *   й забув.
 *
 *   Дві нові ноди (ОДНАКОВІ для обох ботів, вставлені в той самий уніфікований
 *   вузол графа — обидва боти мають ідентичне ребро n_lookup -> n_have_product):
 *
 *   1) n_prev_match_snapshot (js, ПЕРЕД n_lookup) — знімає "чи цей хід має
 *      СВІЖИЙ сигнал товару" ДО того, як n_lookup встигне оновити
 *      _matchedSharedPostId/_matchedEntryAd (щоб не переплутати "щойно
 *      підтверджено" зі "щойно вперше з'явилось").
 *   2) n_returning_check (condition, ПІСЛЯ n_lookup, ПЕРЕД n_have_product) —
 *      якщо товар УЖЕ є в контексті, а свіжого сигналу цей хід не приніс →
 *      n_welcome_back (нова message-нода, м'який чекін); інакше — звичайний
 *      n_have_product, як і раніше.
 *
 * ЗАПУСК:  node patch-stale-product-welcome-back.js            (dry-run)
 *          node patch-stale-product-welcome-back.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const SNAPSHOT_CODE = `// Аудит 2026-08-29 (живий кейс, matsukoleksandr): сесії без TTL — sharedPost/entryAd
// з розмови кількаденної давнини лишаються в контексті назавжди. Знімаємо "чи ЦЕЙ
// хід має свіжий сигнал товару" ДО того, як n_lookup (наступна нода) оновить
// _matchedSharedPostId/_matchedEntryAd — інакше після оновлення значення завжди
// збігаються з поточними (бо саме з них щойно взялись), і "свіжість" губиться.
var __prevMatchedPost = (context.product && context.product._matchedSharedPostId) || '';
var __prevMatchedAd = (context.product && context.product._matchedEntryAd) || '';
var __curPost = (context.sharedPost && context.sharedPost.mediaId) ? String(context.sharedPost.mediaId) : '';
var __curAd = String(context.entryAd || context.entryAdId || '');
var __freshPost = !!(__curPost && __curPost !== String(__prevMatchedPost));
var __freshAd = !!(__curAd && __curAd !== String(__prevMatchedAd));
var __msg = String(context.lastUserMessage || input || '');
var __hasArticleLike = /(?:артикул|арт\\.?|art|код|sku|#|№)\\s*[:#№.\\-]?\\s*[A-Za-zА-Яа-яІЇЄҐіїєґ]{0,5}\\d{2,8}/i.test(__msg)
  || /\\b[A-Za-z]\\d{3,6}\\b/.test(__msg);
return { hasFreshSignalThisTurn: __freshPost || __freshAd || __hasArticleLike || !!context.lastUserImageUrl };`;

const WELCOME_BACK_TEXT = 'З поверненням! 😊 Ви цікавились «{{context.product.customerName}}» — це ще актуально, чи цікавить щось інше? Напишіть, будь ласка 🙂';

async function patchBot(name, botId, coords) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    if (flow.nodes.some((n) => n.id === 'n_prev_match_snapshot')) { console.log(name, 'ALREADY_APPLIED'); return; }

    const edgeToLookup = flow.edges.find((e) => e.target === 'n_lookup');
    const edgeLookupToHave = flow.edges.find((e) => e.source === 'n_lookup' && e.target === 'n_have_product');
    if (!edgeToLookup || !edgeLookupToHave) { console.log(name, 'ERROR: очікувані ребра не знайдено — перевір вручну.'); return; }

    console.log(name, 'буде додано n_prev_match_snapshot, n_returning_check, n_welcome_back.');
    if (!APPLY) return;

    let nodes = flow.nodes.map((n) => ({ ...n }));
    let edges = flow.edges.map((e) => ({ ...e }));

    nodes.push({
        id: 'n_prev_match_snapshot', type: 'js', position: coords.snapshot,
        data: { label: '1.4 Знімок: чи цей хід має свіжий сигнал товару?', code: SNAPSHOT_CODE,
            description: 'Обчислює hasFreshSignalThisTurn ДО n_lookup — щоб відрізнити "клієнт щойно переслав щось нове" від "товар у контексті — лише застаріла пам\'ять з минулої розмови".' },
    });
    nodes.push({
        id: 'n_returning_check', type: 'condition', position: coords.check,
        data: { label: '1.9 Товар відомий, але без свіжого сигналу? (повернення)',
            condition: "context.product && context.product.name && String(context.product.name).length > 0 && !context.hasFreshSignalThisTurn",
            description: 'TRUE — товар уже є в контексті, а ЦЕЙ хід не приніс нічого нового (просте привітання тощо) → м\'який чекін n_welcome_back, БЕЗ повторної повної презентації. FALSE — звичайний n_have_product (новий товар, свіжий сигнал, або товару ще нема взагалі).' },
    });
    nodes.push({
        id: 'n_welcome_back', type: 'message', position: coords.welcomeBack,
        data: { label: '1.95 Мʼякий чекін (повернення без нового сигналу)', text: WELCOME_BACK_TEXT, variants: [],
            description: 'Клієнт повернувся (можливо, через дні) і написав щось без стосунку до товару — не форсуємо стару презентацію, а тепло перепитуємо, чи вона ще актуальна.' },
    });

    // n_signal_cond(true)/n_route -> n_lookup стає -> n_prev_match_snapshot -> n_lookup
    edges = edges.map((e) => (e === edgeToLookup || (e.source === edgeToLookup.source && e.target === edgeToLookup.target && e.sourceHandle === edgeToLookup.sourceHandle)
        ? { ...e, target: 'n_prev_match_snapshot' } : e));
    edges.push({ id: 'e_prev_match_snapshot_to_lookup', source: 'n_prev_match_snapshot', target: 'n_lookup' });

    // n_lookup -> n_have_product стає -> n_returning_check -> (n_welcome_back | n_have_product)
    edges = edges.filter((e) => !(e.source === 'n_lookup' && e.target === 'n_have_product'));
    edges.push({ id: 'e_lookup_to_returning_check', source: 'n_lookup', target: 'n_returning_check' });
    edges.push({ id: 'e_returning_check_true', source: 'n_returning_check', target: 'n_welcome_back', sourceHandle: 'true' });
    edges.push({ id: 'e_returning_check_false', source: 'n_returning_check', target: 'n_have_product', sourceHandle: 'false' });

    await db.flowDefinition.update({ where: { botId }, data: { nodes, edges } });
    console.log(name, 'APPLIED.');
}

async function main() {
    // Синтаксична самоперевірка snapshot-коду (як у попередніх патчах n_lookup).
    new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto',
        'return (async function(){"use strict";\n' + SNAPSHOT_CODE + '\n})();');

    await patchBot('goverla', BOTS.goverla, {
        snapshot: { x: 360, y: 700 },
        check: { x: 1080, y: 900 },
        welcomeBack: { x: 1080, y: 1150 },
    });
    await patchBot('covercar', BOTS.covercar, {
        snapshot: { x: 300, y: 300 },
        check: { x: 300, y: 500 },
        welcomeBack: { x: 600, y: 500 },
    });
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
