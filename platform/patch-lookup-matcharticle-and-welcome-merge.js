'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Ф1.6  Живий кейс: Сіразетдінов писав/пересилав про "Кофта Ангора" (id 20),
 *   отримав у відповідь "Кофта Мажор петля" (id 27).
 *
 *   Корінь: matchArticle() у n_lookup скенував УСІ кастом-поля товару, включно
 *   з CT_1002 ("Допродажі" — товари, які РАЗОМ КУПУЮТЬ з ЦИМ, не ідентифікатор
 *   самого товару). Ангора і Мажор мали ОДНАКОВЕ CT_1002="L0056-1, L0056-2"
 *   (обидва пропонують ту саму футболку-допродаж, product_id 19) — токен
 *   "L0056-1" однаково "ідентифікував" БУДЬ-ЯКИЙ із двох товарів залежно від
 *   порядку в масиві з KeyCRM. Саме тому колись хтось дописав в опис "Кофта
 *   Мажор петля" нотатку "ℹ️ Інший виріб, ніж Кофта Ангора" (уже прибрано
 *   попереднім патчем з публічного тексту) — намагались "заклеїти" симптом
 *   текстом замість виправити матчинг.
 *
 *   Фікс: matchArticle тепер матчить ЛИШЕ по полях, які РЕАЛЬНО ідентифікують
 *   товар — sku, CT_1001 (ad_id), CT_1006 (артикул постачальника).
 *   CT_1002/1003/1005/1010/1011/1012 — ніколи (це посилання НА інші товари чи
 *   довідкові дані, не ідентифікатори ЦЬОГО товару).
 *
 *   Другорядно (той самий deploy, за проханням власника): n_welcome тепер
 *   об'єднує опис і ціну в ОДНЕ речення {{name}} — {{price}} грн ({{descShort}})
 *   замість окремого блоку; descShort розумно витягує лише матеріал+кольори
 *   (не перші N рядків "як є").
 *
 * ЗАПУСК:  node patch-lookup-matcharticle-and-welcome-merge.js            (dry-run)
 *          node patch-lookup-matcharticle-and-welcome-merge.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const NEW_LOOKUP_CODE_GOVERLA = fs.readFileSync(path.join(__dirname, 'n_lookup-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

const CC_MATCHARTICLE_OLD = `function matchArticle(all,art){ if(!art)return null; var A=String(art).toUpperCase().trim(); for(var i=0;i<all.length;i++){ var p=all[i]; if(p.sku&&String(p.sku).toUpperCase().trim()===A)return p; var cf=p.custom_fields||[]; for(var j=0;j<cf.length;j++){ var v=cf[j]&&cf[j].value; if(v==null)continue; if(String(v).toUpperCase().split(/[\\s,;]+/).indexOf(A)>=0)return p; } } return null; }`;
const CC_MATCHARTICLE_NEW = `var ARTICLE_IDENT_FIELDS={CT_1001:1,CT_1006:1};
function matchArticle(all,art){ if(!art)return null; var A=String(art).toUpperCase().trim(); for(var i=0;i<all.length;i++){ var p=all[i]; if(p.sku&&String(p.sku).toUpperCase().trim()===A)return p; var cf=p.custom_fields||[]; for(var j=0;j<cf.length;j++){ var f=cf[j]; if(!f||!ARTICLE_IDENT_FIELDS[f.uuid])continue; var v=f.value; if(v==null)continue; if(String(v).toUpperCase().split(/[\\s,;]+/).indexOf(A)>=0)return p; } } return null; }`;

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }
    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    const nWelcome = flow.nodes.find((n) => n.id === 'n_welcome');
    if (!nLookup || !nWelcome) { console.log(name, 'ERROR: nodes not found'); return; }

    const lookupDone = nLookup.data.code.includes('ARTICLE_IDENT_FIELDS');
    const welcomeDone = nWelcome.data.text.includes('({{context.product.descShort}})');
    if (lookupDone && welcomeDone) { console.log(name, 'ALREADY_APPLIED'); return; }
    console.log(name, 'lookup(matchArticle)=', !lookupDone, '| welcome(merge)=', !welcomeDone);
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_lookup' && !lookupDone) {
            if (name === 'goverla') return { ...n, data: { ...n.data, code: NEW_LOOKUP_CODE_GOVERLA } };
            if (!n.data.code.includes(CC_MATCHARTICLE_OLD)) { console.log(name, 'WARNING: matchArticle анкор не знайдено'); return n; }
            return { ...n, data: { ...n.data, code: n.data.code.split(CC_MATCHARTICLE_OLD).join(CC_MATCHARTICLE_NEW) } };
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
