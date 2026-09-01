'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *
 * ПРОБЛЕМА 3 (живий кейс, скрін власника, 2026-09-01): клієнт у межах набору
 * питає "Які лофери є?" → бот коректно описує 2 варіанти (артикули 5931/5934,
 * дані беруться з context.product.setList, це вже працює правильно) → клієнт
 * хоче фото → бот шле фото ЦІЛОГО НАБОРУ (колаж куртка+джинси+лофери), бо
 * wantsPhoto завжди бере context.product.imageUrls/photoUrl — а це ЦІЛИЙ набір,
 * доки клієнт НЕ зробив остаточний вибір setChoice:"item" (n_set_apply, який уже
 * ВМІЄ підмінити context.product на компонент з ЙОГО власними фото — але тільки
 * ПІСЛЯ явного вибору, а не під час browsing-питань про варіанти).
 *
 * ФІКС (двигун, testSession.js — окремий комміт, уже задеплоєний): wantsPhoto
 * тепер підтримує додаткове поле photoArticle — якщо є, шукає власні фото ЦЬОГО
 * артикула в context.product.setItems (замість фото цілого набору). Якщо
 * компонент знайдено, але власних фото в нього нема — чесна ескалація
 * (notifyAdminPhotoMissing), а НЕ помилкове фото набору-колажу.
 *
 * ЦЕЙ патч — дані воронки, дві частини:
 *   1) n_lookup: setItems тепер несе ВЛАСНІ photoUrl/imageUrls кожного
 *      компонента (дані вже фетчаться з KeyCRM у той самий цикл пошуку `cp` —
 *      жодних додаткових HTTP-викликів, просто раніше не зберігали фото).
 *   2) n_set_choice: системний промпт вчить модель додавати photoArticle поруч
 *      з wantsPhoto, коли клієнт явно питає фото КОНКРЕТНОЇ позиції складу (і НЕ
 *      вгадувати, якщо позицій кілька і не ясно, яка саме).
 *
 * ЗАПУСК:  node patch-set-component-photo.js            (dry-run)
 *          node patch-set-component-photo.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');

const BOTS = {
    goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee',
    goverlaCrmClone: 'fcdee415-bef2-4a74-a650-e6e4b5a12322', covercarCrmClone: 'a2d5ba79-f87b-48f2-8301-56292cdf3972',
};
const APPLY = process.argv.includes('--apply');

const LOOKUP_OLD = "setItems.push({ article:toks[si], id:cp.id, name:cp.name||'', price:(cp.price!=null?cp.price:cp.min_price), supplier:csup?String(csup.value||'').trim():'', supplierArticle:cSupArt?String(cSupArt.value||'').trim():'' });";
const LOOKUP_NEW = "var cImgs=[]; if(cp.thumbnail_url) cImgs.push(cp.thumbnail_url); var cAdx=cp.attachments_data||[]; for(var cx=0;cx<cAdx.length;cx++){ var cuu=(typeof cAdx[cx]==='string')?cAdx[cx]:(cAdx[cx]&&(cAdx[cx].url||cAdx[cx].src)); if(cuu&&cImgs.indexOf(cuu)<0) cImgs.push(cuu); }\n      setItems.push({ article:toks[si], id:cp.id, name:cp.name||'', price:(cp.price!=null?cp.price:cp.min_price), supplier:csup?String(csup.value||'').trim():'', supplierArticle:cSupArt?String(cSupArt.value||'').trim():'', photoUrl:cImgs[0]||'', imageUrls:cImgs.slice(0,5) });";

const CHOICE_OLD = 'ЯКЩО клієнт просить фото товару ("покажіть фото", "скиньте фото", "як виглядає наживо") — у json_output ДОДАЙ поле "wantsPhoto":true (окремо, або разом з іншими полями), і в тексті напиши, що зараз надішлеш фото.';
const CHOICE_NEW = CHOICE_OLD + '\n'
    + 'ЯКЩО клієнт просить фото КОНКРЕТНОЇ позиції зі складу комплекту (напр. "покажіть фото лоферів", назвав конкретний артикул/назву з переліку складу вище) — ДОДАЙ до wantsPhoto:true ЩЕ й поле "photoArticle":"<артикул цієї позиції зі складу вище>" (артикул саме такий, як у переліку складу). Якщо в складі КІЛЬКА варіантів цієї позиції (напр. 2 моделі лоферів) і клієнт не уточнив, який саме — НЕ вгадуй: спитай, який саме варіант його цікавить, замість wantsPhoto/photoArticle. Якщо клієнт просить фото ВСЬОГО комплекту (не окремої позиції) — wantsPhoto:true БЕЗ photoArticle, як завжди.';

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    const nChoice = flow.nodes.find((n) => n.id === 'n_set_choice');
    if (!nLookup) { console.log(name, 'ERROR: n_lookup not found'); return; }
    if (!nChoice) { console.log(name, 'ERROR: n_set_choice not found'); return; }

    const lookupCode = nLookup.data.code || '';
    const lookupDone = lookupCode.includes('cImgs');
    const lookupHasAnchor = lookupCode.includes(LOOKUP_OLD);

    const choicePrompt = nChoice.data.systemPrompt || '';
    const choiceDone = choicePrompt.includes('photoArticle');
    const choiceHasAnchor = choicePrompt.includes(CHOICE_OLD);

    if (lookupDone && choiceDone) { console.log(name, 'ALREADY_APPLIED'); return; }

    if (!lookupDone && !lookupHasAnchor) console.log(name, 'WARNING: n_lookup — анкор setItems.push не знайдено. Пропускаю n_lookup (перевір вручну).');
    if (!choiceDone && !choiceHasAnchor) console.log(name, 'WARNING: n_set_choice — анкор wantsPhoto не знайдено. Пропускаю n_set_choice (перевір вручну).');

    console.log(name, 'n_lookup setItems photo enrichment =', !lookupDone && lookupHasAnchor, '| n_set_choice photoArticle instruction =', !choiceDone && choiceHasAnchor);
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id === 'n_lookup' && !lookupDone && lookupHasAnchor) {
            return { ...n, data: { ...n.data, code: n.data.code.split(LOOKUP_OLD).join(LOOKUP_NEW) } };
        }
        if (n.id === 'n_set_choice' && !choiceDone && choiceHasAnchor) {
            return { ...n, data: { ...n.data, systemPrompt: n.data.systemPrompt.split(CHOICE_OLD).join(CHOICE_NEW) } };
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
