'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...) —
 * розслідування "не той товар" (2026-08-30), знахідка #2 (окрема від
 * findOrCreateZernioUser-фіксу в zernioHandler.js).
 *
 * ФАКТ (перевірено напряму запитом до KeyCRM): goverla_shop і covercar_ua
 * використовують ОДИН і той самий KEYCRM_API_TOKEN — тобто СПІЛЬНИЙ каталог на
 * 29 товарів. n_lookup у ЖОДНОГО з ботів не фільтрував список товарів (`all`)
 * по "своїй" категорії перед матчингом (ad_id/артикул/ключові слова/vision) —
 * будь-який з ПРІОРІТЕТІВ міг теоретично підставити клієнту covercar_ua товар
 * goverla_shop (одяг) і навпаки. Каталог розділяється ЧИСТО по category_id:
 *   category_id=3  → 8 товарів covercar_ua (органайзер, подушки, накидки)
 *   усі інші (1,2,4,5,6,7,8,9,null) → 21 товар goverla_shop (одяг, взуття, набори)
 * Це, найімовірніше, і є (додатковий, окремий від psid-змішування) шлях, яким
 * товар ІНШОГО магазину міг просочитись у сесію (підтверджений живий кейс:
 * сесія covercar_ua cd3f0a27 отримала артикул A0068 — товар goverla_shop).
 *
 * ФІКС: n_lookup одразу після побудови `all` (усі товари з КРМ) фільтрує його
 * за funnelKey KEYCRM_CATEGORY_INCLUDE (whitelist, якщо задано) і/або
 * KEYCRM_CATEGORY_EXCLUDE (blacklist) — ДО будь-якого матчингу. Усі подальші
 * пріоритети (ad_id/артикул/keyword/vision), а також офери/апсейл/набори, які
 * читають той самий `all`, автоматично більше НЕ бачать чужий каталог.
 *   covercar_ua: KEYCRM_CATEGORY_INCLUDE = "3"
 *   goverla_shop: KEYCRM_CATEGORY_EXCLUDE = "3"
 *
 * ЗАПУСК:  node patch-lookup-catalog-shop-scope.js            (dry-run)
 *          node patch-lookup-catalog-shop-scope.js --apply    (записує у БД)
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = {
    goverla: { id: '5bdb3e38-1936-416f-b1f0-8f1125583193', exclude: '3', include: '' },
    covercar: { id: 'cc03657f-9e72-46e5-a16d-88826e70c2ee', exclude: '', include: '3' },
};
const APPLY = process.argv.includes('--apply');

// Регекс, не літерал — точна кількість пробілів у відступі відрізнялась між
// goverla/covercar копіями коду (перевірено diff'ом), тому шукаємо за
// характерною сигнатурою рядка пагінації, а не за побайтовим збігом.
const ANCHOR_RE = /for\(var page=1;page<=10;page\+\+\)\{[^\n]*\}\n/;

const SCOPE_BLOCK = "\n  // Аудит 2026-08-30 (розслідування \"не той товар\"): goverla_shop і covercar_ua\n"
    + "  // діляться ОДНИМ KEYCRM_API_TOKEN (спільний каталог) — без цього фільтра будь-\n"
    + "  // який пріоритет нижче (ad_id/артикул/keyword/vision) міг підставити товар\n"
    + "  // ІНШОГО магазину. Фільтруємо ДО матчингу, за category_id з ключів воронки.\n"
    + "  var __catInc=(keys.KEYCRM_CATEGORY_INCLUDE||'').split(',').map(function(s){return s.trim();}).filter(Boolean);\n"
    + "  var __catExc=(keys.KEYCRM_CATEGORY_EXCLUDE||'').split(',').map(function(s){return s.trim();}).filter(Boolean);\n"
    + "  if(__catInc.length){ all=all.filter(function(p){return __catInc.indexOf(String(p.category_id))>=0;}); }\n"
    + "  if(__catExc.length){ all=all.filter(function(p){return __catExc.indexOf(String(p.category_id))<0;}); }\n";

async function upKey(botId, key, value, label) {
    const ex = await db.funnelKey.findFirst({ where: { botId, key } });
    if (ex) { if (ex.value !== value) await db.funnelKey.update({ where: { id: ex.id }, data: { value, label: label || ex.label } }); }
    else await db.funnelKey.create({ data: { botId, key, value, label: label || null, isSecret: false } });
}

async function patchBot(name, cfg) {
    const botId = cfg.id;
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }
    const n = flow.nodes.find((x) => x.id === 'n_lookup');
    if (!n) { console.log(name, 'ERROR: n_lookup not found'); return; }
    const code = n.data.code || '';
    const hasAnchor = ANCHOR_RE.test(code);
    const hasScope = code.includes('KEYCRM_CATEGORY_INCLUDE');

    console.log(name, 'code scope-фільтр додати =', hasAnchor && !hasScope, '| funnelKey KEYCRM_CATEGORY_INCLUDE=' + JSON.stringify(cfg.include) + ' EXCLUDE=' + JSON.stringify(cfg.exclude));
    if (!hasAnchor && !hasScope) { console.log(name, 'WARNING: ANCHOR_RE не знайдено — код n_lookup інший, пропускаю code-зміну.'); }

    if (!APPLY) return;

    if (hasAnchor && !hasScope) {
        const newCode = code.replace(ANCHOR_RE, (m) => m + SCOPE_BLOCK);
        try {
            // eslint-disable-next-line no-new-func
            new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto', 'return (async () => { ' + newCode + ' })();');
        } catch (e) {
            console.log(name, 'SYNTAX ERROR after edit — НЕ записую:', e.message);
            return;
        }
        const nodes = flow.nodes.map((x) => (x.id === 'n_lookup' ? { ...x, data: { ...x.data, code: newCode } } : x));
        await db.flowDefinition.update({ where: { botId }, data: { nodes } });
        console.log(name, 'n_lookup code APPLIED (syntax verified).');
    }

    await upKey(botId, 'KEYCRM_CATEGORY_INCLUDE', cfg.include, 'Показувати лише ці category_id з каталогу (whitelist; порожньо = усі)');
    await upKey(botId, 'KEYCRM_CATEGORY_EXCLUDE', cfg.exclude, 'Ніколи не показувати ці category_id з каталогу (blacklist)');
    console.log(name, 'funnelKeys APPLIED.');
}

async function main() {
    for (const [name, cfg] of Object.entries(BOTS)) await patchBot(name, cfg);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
