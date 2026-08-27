'use strict';
/*
 * Патч воронки «covercar_ua — тестовий магазин (Zernio)» (bot cc03657f-9e72-46e5-a16d-88826e70c2ee)
 *   Дублювання фіксу "зависання" на новому товарі без явного артикулу — див.
 *   patch-goverla-product-switch-signal.js. Той самий стемп _matchedSharedPostId/
 *   _matchedEntryAd у n_lookup, під структуру коду covercar (product-літерал
 *   завершується інакше, ніж у goverla — тому цільова заміна, не повна перезапись).
 *
 * ЗАПУСК:  node patch-covercar-product-switch-signal.js            (dry-run)
 *          node patch-covercar-product-switch-signal.js --apply    (записує у БД)
 *
 * Ідемпотентний. Потребує testSession.js з відповідним engine-фіксом (спільний код,
 * задеплоєний окремо через git, без патч-файлу) — engine вже спільний з goverla_shop.
 */
const { db } = require('@platform/db');

const BOT_ID = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

const RESULT_OLD = `sizeChartNote:__sizeChartNote, sizeChartData:__sizeChartData, upsellPhotoUrl:__upsellPhoto, upsellPhotoNote:__upsellPhotoNote } };`;
const RESULT_NEW = `sizeChartNote:__sizeChartNote, sizeChartData:__sizeChartData, upsellPhotoUrl:__upsellPhoto, upsellPhotoNote:__upsellPhotoNote, _matchedSharedPostId:__matchedSharedPostId, _matchedEntryAd:__matchedEntryAd } };`;

const ANCHOR = `var __isClothing = CLOTHING_CATEGORY_IDS.indexOf(found.category_id)>=0;`;
const ANCHOR_NEW = `var __isClothing = CLOTHING_CATEGORY_IDS.indexOf(found.category_id)>=0;
  // _matchedSharedPostId / _matchedEntryAd — "відбиток" того, ЯКИЙ саме пост/рілс/ad_id
  // діяв на момент цього визначення товару (продубльовано з goverla_shop, аудит
  // 2026-08-27) — генератор перемикання товару в testSession.js звіряє це з АКТУАЛЬНИМ
  // ctx.sharedPost/entryAd на кожному наступному повідомленні, навіть без артикулу в тексті.
  var __matchedSharedPostId=(context.sharedPost&&context.sharedPost.mediaId)?String(context.sharedPost.mediaId):'';
  var __matchedEntryAd=String(context.entryAd||context.entryAdId||'');`;

async function main() {
    const flow = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!flow) { console.log('ERROR: no flow'); process.exit(1); }
    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    if (!nLookup) { console.log('ERROR: n_lookup not found'); process.exit(1); }

    const done = nLookup.data.code.includes('_matchedSharedPostId');
    if (done) { console.log('ALREADY_APPLIED'); process.exit(0); }

    if (!nLookup.data.code.includes(ANCHOR) || !nLookup.data.code.includes(RESULT_OLD)) {
        console.log('ERROR: анкори не знайдено — структура n_lookup змінилась, перевір вручну.');
        process.exit(1);
    }

    console.log('Буде оновлено n_lookup (додано _matchedSharedPostId/_matchedEntryAd).');
    if (!APPLY) { console.log('DRY-RUN — запусти з --apply.'); process.exit(0); }

    const nodes = flow.nodes.map((n) => {
        if (n.id !== 'n_lookup') return n;
        let code = n.data.code;
        code = code.split(ANCHOR).join(ANCHOR_NEW);
        code = code.split(RESULT_OLD).join(RESULT_NEW);
        return { ...n, data: { ...n.data, code } };
    });
    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes } });
    console.log('APPLIED.');
    process.exit(0);
}
main().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
