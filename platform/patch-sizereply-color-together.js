'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *
 * ПРОБЛЕМА 2 (живий кейс, скрін власника, 2026-09-01): бот шле "Супер, дякую!
 * Вам ідеально підійде розмір M — перевірено, сяде як треба 🎉" — це n_size_reply,
 * ЗАКІНЧУЄТЬСЯ похвалою, БЕЗ питання/наступного кроку. Клієнт розгублюється
 * ("І шо робимо далі? Щось я нічого не розумію"), і лише ПІСЛЯ ЦЬОГО зайвого
 * ходу бот нарешті питає колір (n_color, через n_has_colors — claude dialog-нода,
 * яка БЕЗ speakFirst потребує СВІЖОГО lastUserMessage, а n_size як claude-нода
 * вже свідомо ОЧИСТИЛА lastUserMessage одразу після своєї відповіді — тож n_color
 * фізично не спрацьовує, доки клієнт щось не напише).
 *
 * Порушення правила проєкту (п.3.4): "кожне видиме повідомлення закінчується
 * питанням або чітким наступним кроком". Власник прямо: "Ось ці два повідомлення
 * разом мають надсилатись. Якщо ми запитаємо клієнта, клієнт нічого не напише."
 *
 * ФІКС (без ризикованого speakFirst на n_color — це зачепило б і ІНШИЙ вхідний
 * шлях у n_color, n_avail_no → n_has_colors → n_color, де n_avail_no ВЖЕ сам
 * закінчується питанням про колір; speakFirst там створив би ТОЙ САМИЙ клас дублю,
 * що і Проблема 1): підтвердження розміру (n_size_reply) тепер САМЕ несе питання
 * про колір в ОДНОМУ повідомленні (n_calc рахує sizeColorFollowup — питання про
 * колір, ЛИШЕ якщо в товару справді є вибір кольору і його ще не обрано; інакше
 * порожньо, поведінка інших товарів не змінюється). Далі виконання зупиняється
 * рівно там, де й мало б (n_color чекає СПРАВЖНЬОЇ відповіді клієнта — жодних
 * змін у самому n_color).
 *
 * ЗАПУСК:  node patch-sizereply-color-together.js            (dry-run)
 *          node patch-sizereply-color-together.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = {
    goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee',
    goverlaCrmClone: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', covercarCrmClone: 'a2d5ba79-f87b-48f2-8301-56292cdf3972',
};
const APPLY = process.argv.includes('--apply');

// Анкор — НЕ текст коментаря (той відрізняється між goverla/covercar: у covercar
// перший рядок коментаря має додаткове "(продубльовано з goverla_shop)" і інший
// перенос рядка), а перший ВИКОНУВАНИЙ рядок коду — ідентичний в обох воронках.
const CALC_ANCHOR_TOP = "var s0 = context.sizeInput || {};";
const CALC_INJECT_TOP = "// Проблема 2 (аудит 2026-09-01): підтвердження розміру й питання про колір мають\n"
    + "// йти РАЗОМ, одним повідомленням (n_size_reply) — інакше клієнт лишається з голою\n"
    + "// похвалою без наступного кроку (порушення \"кожне повідомлення = питання/крок\").\n"
    + "// Рахуємо тут (доступно для ОБОХ шляхів виходу нижче), а не в n_size_reply — щоб\n"
    + "// не дублювати JS-логіку \"чи потрібен вибір кольору\", яка вже є в n_has_colors.\n"
    + "var __needsColorAsk = !!(context.product && String(context.product.colors||'').trim().length > 0 && !(context.colorChoice && context.colorChoice.color));\n"
    + "var __sizeColorFollowup = __needsColorAsk ? ('\\n\\n🎨 Тепер оберіть колір: ' + context.product.colors + ' — який вам більше до душі? 😊') : '';\n\n"
    + CALC_ANCHOR_TOP;

const CALC_RET_EXACT_OLD = "return { recommendedSize: exactSize, sizeOutOfRange: false, sizeMatchedBy: 'exact_measurement' };";
const CALC_RET_EXACT_NEW = "return { recommendedSize: exactSize, sizeOutOfRange: false, sizeMatchedBy: 'exact_measurement', sizeColorFollowup: __sizeColorFollowup };";

const CALC_RET_FINAL_OLD = "return { recommendedSize: size, sizeOutOfRange: false };";
const CALC_RET_FINAL_NEW = "return { recommendedSize: size, sizeOutOfRange: false, sizeColorFollowup: __sizeColorFollowup };";

const REPLY_SUFFIX = '{{context.sizeColorFollowup}}';

function alreadyHasSuffix(t) { return typeof t === 'string' && t.includes(REPLY_SUFFIX); }

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nCalc = flow.nodes.find((n) => n.id === 'n_calc');
    const nReply = flow.nodes.find((n) => n.id === 'n_size_reply');
    if (!nCalc) { console.log(name, 'ERROR: n_calc not found'); return; }
    if (!nReply) { console.log(name, 'ERROR: n_size_reply not found'); return; }

    const calcCode = nCalc.data.code || '';
    const calcDone = calcCode.includes('__sizeColorFollowup');
    const calcHasTopAnchor = calcCode.includes(CALC_ANCHOR_TOP);
    const calcHasExactRet = calcCode.includes(CALC_RET_EXACT_OLD);
    const calcHasFinalRet = calcCode.includes(CALC_RET_FINAL_OLD);

    const replyDone = alreadyHasSuffix(nReply.data.text)
        && Array.isArray(nReply.data.variants) && nReply.data.variants.length > 0
        && nReply.data.variants.every(alreadyHasSuffix);

    if (calcDone && replyDone) { console.log(name, 'ALREADY_APPLIED'); return; }

    if (!calcDone) {
        if (!calcHasTopAnchor) { console.log(name, 'WARNING: n_calc — верхній анкор не знайдено, код міг змінитись. Пропускаю n_calc (перевір вручну).'); }
        else if (!calcHasExactRet) { console.log(name, 'WARNING: n_calc — exact_measurement return не знайдено. Пропускаю n_calc (перевір вручну).'); }
        else if (!calcHasFinalRet) { console.log(name, 'WARNING: n_calc — фінальний return не знайдено. Пропускаю n_calc (перевір вручну).'); }
        else { console.log(name, 'n_calc.code: буде додано __sizeColorFollowup + прокинуто у 2 return.'); }
    }
    if (!replyDone) {
        console.log(name, 'n_size_reply: text +', nReply.data.variants ? nReply.data.variants.length : 0, 'variants отримають суфікс', REPLY_SUFFIX);
    }

    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_calc' && !calcDone && calcHasTopAnchor && calcHasExactRet && calcHasFinalRet) {
            let code = n.data.code;
            code = code.replace(CALC_ANCHOR_TOP, CALC_INJECT_TOP);
            code = code.split(CALC_RET_EXACT_OLD).join(CALC_RET_EXACT_NEW);
            code = code.split(CALC_RET_FINAL_OLD).join(CALC_RET_FINAL_NEW);
            return { ...n, data: { ...n.data, code } };
        }
        if (n.id === 'n_size_reply' && !replyDone) {
            const text = alreadyHasSuffix(n.data.text) ? n.data.text : (n.data.text + REPLY_SUFFIX);
            const variants = Array.isArray(n.data.variants)
                ? n.data.variants.map((v) => (alreadyHasSuffix(v) ? v : v + REPLY_SUFFIX))
                : n.data.variants;
            return { ...n, data: { ...n.data, text, variants } };
        }
        return n;
    });
    await db.flowDefinition.update({ where: { botId }, data: { nodes } });
    console.log(name, 'APPLIED.');
}

async function main() {
    for (const [name, botId] of Object.entries(BOTS)) await patchBot(name, botId);
    if (!APPLY) console.log('DRY-RUN — запусти з --apply.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
