'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Ф1.5  Фідбек по живій сесії Олексія Сіразетдінова (2026-08-27, товар "Кофта
 *   Мажор петля"):
 *   1) Кожне повідомлення має закінчуватись питанням — n_welcome НЕ закінчувалось.
 *   2) Скоротити тексти — n_welcome дублював ПОВНИЙ опис товару (усі ✔️-пункти).
 *   3) Бот привітався двічі підряд (n_welcome, потім одразу n_size "Привіт! Я
 *      Оля...") — у n_size УЖЕ була заборона повторно вітатись, але модель її
 *      ігнорувала; підсилено формулювання + додано ту саму заборону в n_color
 *      (не мав її взагалі).
 *   4) (Знайдено при розборі, не з фідбеку) Внутрішня нотатка "ℹ️ Інший виріб,
 *      ніж..." з поля опису KeyCRM потрапляла клієнту дослівно через
 *      {{context.product.desc}} — n_lookup тепер обрізає рядки, що починаються
 *      з ℹ️, з публічного desc (AI-консультанти й далі отримують повний опис).
 *
 *   Зміни:
 *   - n_lookup: product.descShort (коротка, до ~220 симв., БЕЗ ℹ️-нотаток) для
 *     n_welcome; product.desc (повний, теж без ℹ️-нотаток) лишається для AI.
 *   - n_welcome: усі 5 варіантів → descShort + завершальне питання.
 *   - n_size: заборона повторного вітання підсилена (жирний ❌, конкретні слова).
 *   - n_color: та сама заборона додана (раніше не мав).
 *
 * ⚠️ ОКРЕМА проблема, знайдена в тій же сесії — фото товару НЕ надсилалось
 *   ("немає INSTAGRAM_ACCESS_TOKEN для Meta-фото", підтверджено логом доставки) —
 *   це відсутній РЕАЛЬНИЙ ключ у funnelKey (зараз "REPLACE_ME"), НЕ виправляється
 *   цим патчем — власник має надати справжній Instagram Graph API токен.
 *
 * ЗАПУСК:  node patch-welcome-shorten-and-greet-fix.js            (dry-run)
 *          node patch-welcome-shorten-and-greet-fix.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOTS = {
    goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193',
    covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee',
};
const APPLY = process.argv.includes('--apply');

const NEW_LOOKUP_CODE_GOVERLA = fs.readFileSync(path.join(__dirname, 'n_lookup-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

// COVERCAR: цільова заміна (структура n_lookup НЕ 1:1 з goverla).
const CC_DESC_OLD = `desc:found.description||'', price:price,`;
const CC_DESC_NEW = `desc:__descClean, descShort:__descShort, price:price,`;
const CC_ANCHOR = `var __matchedSharedPostId=(context.sharedPost&&context.sharedPost.mediaId)?String(context.sharedPost.mediaId):'';
  var __matchedEntryAd=String(context.entryAd||context.entryAdId||'');`;
const CC_ANCHOR_NEW = `var __matchedSharedPostId=(context.sharedPost&&context.sharedPost.mediaId)?String(context.sharedPost.mediaId):'';
  var __matchedEntryAd=String(context.entryAd||context.entryAdId||'');
  var __descClean=String(found.description||'').split('\\n').filter(function(ln){ return !/^\\s*ℹ️/.test(ln); }).join('\\n').trim();
  var __descShort=__descClean.split('\\n').slice(0,3).join('\\n');
  if(__descShort.length>220) __descShort=__descShort.slice(0,220).replace(/\\s+\\S*$/,'')+'…';`;

const N_WELCOME_VARIANTS = [
    "Вітаємо у {{env.SHOP_TAG}}! 🙌 Ось ваш товар: {{context.product.name}} — {{context.product.price}} грн 🔥\n{{context.product.descShort}}\n\nЦікавить? 😊",
    "Раді вітати у {{env.SHOP_TAG}}! 💛 {{context.product.name}} — лише {{context.product.price}} грн 🔥\n{{context.product.descShort}}\n\nБерете? 😊",
    "{{env.SHOP_TAG}} на звʼязку! 🙌 Ваш товар: {{context.product.name}} — {{context.product.price}} грн 🔥\n{{context.product.descShort}}\n\nПідходить? 😊",
    "Дякуємо, що завітали! 💛 Ось що вас зацікавило: {{context.product.name}} — {{context.product.price}} грн 🔥\n{{context.product.descShort}}\n\nОформляємо? 😊",
    "{{env.SHOP_TAG}} вітає! 🙌 Знайшли для вас: {{context.product.name}} — {{context.product.price}} грн 🔥\n{{context.product.descShort}}\n\nСподобалось? 😊",
];

const N_SIZE_GREET_OLD = 'ВАЖЛИВО: клієнта вже привітали і презентували товар — НЕ вітайся повторно і не дублюй презентацію. Одразу по суті.';
const N_SIZE_GREET_NEW = '❌ КЛІЄНТА ВЖЕ ПРИВІТАЛИ секунду тому — НІКОЛИ не пиши "Привіт"/"Вітаю"/"Доброго дня" знову і не дублюй презентацію товару. Одразу по суті, без привітання.';

const N_COLOR_ANCHOR = 'Веди діалог САМЕ про цей товар — НЕ вигадуй іншу категорію/характеристики, яких немає в даних вище.';
const N_COLOR_ANCHOR_NEW = 'Веди діалог САМЕ про цей товар — НЕ вигадуй іншу категорію/характеристики, яких немає в даних вище.\n❌ КЛІЄНТА ВЖЕ ПРИВІТАЛИ раніше в цій розмові — НІКОЛИ не пиши "Привіт"/"Вітаю" знову. Одразу по суті.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    const nWelcome = flow.nodes.find((n) => n.id === 'n_welcome');
    const nSize = flow.nodes.find((n) => n.id === 'n_size');
    const nColor = flow.nodes.find((n) => n.id === 'n_color');
    if (!nLookup || !nWelcome || !nSize || !nColor) { console.log(name, 'ERROR: nodes not found'); return; }

    const lookupDone = nLookup.data.code.includes('descShort');
    const welcomeDone = nWelcome.data.text.includes('descShort');
    const sizeDone = nSize.data.systemPrompt.includes('НІКОЛИ не пиши "Привіт"');
    const colorDone = nColor.data.systemPrompt.includes('НІКОЛИ не пиши "Привіт"/"Вітаю" знову');

    if (lookupDone && welcomeDone && sizeDone && colorDone) { console.log(name, 'ALREADY_APPLIED'); return; }
    console.log(name, 'lookup=', !lookupDone, '| welcome=', !welcomeDone, '| size-greet=', !sizeDone, '| color-greet=', !colorDone);
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_lookup' && !lookupDone) {
            if (name === 'goverla') return { ...n, data: { ...n.data, code: NEW_LOOKUP_CODE_GOVERLA } };
            if (name === 'covercar') {
                if (!n.data.code.includes(CC_ANCHOR) || !n.data.code.includes(CC_DESC_OLD)) { console.log(name, 'WARNING: n_lookup анкор не знайдено'); return n; }
                let code = n.data.code.split(CC_ANCHOR).join(CC_ANCHOR_NEW);
                code = code.split(CC_DESC_OLD).join(CC_DESC_NEW);
                return { ...n, data: { ...n.data, code } };
            }
        }
        if (n.id === 'n_welcome' && !welcomeDone) {
            return { ...n, data: { ...n.data, text: N_WELCOME_VARIANTS[0], variants: N_WELCOME_VARIANTS } };
        }
        if (n.id === 'n_size' && !sizeDone) {
            if (!n.data.systemPrompt.includes(N_SIZE_GREET_OLD)) { console.log(name, 'WARNING: n_size анкор не знайдено'); return n; }
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.replace(N_SIZE_GREET_OLD, N_SIZE_GREET_NEW) } };
        }
        if (n.id === 'n_color' && !colorDone) {
            if (!n.data.systemPrompt.includes(N_COLOR_ANCHOR)) { console.log(name, 'WARNING: n_color анкор не знайдено'); return n; }
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.replace(N_COLOR_ANCHOR, N_COLOR_ANCHOR_NEW) } };
        }
        return n;
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
