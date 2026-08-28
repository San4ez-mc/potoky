'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Нова конвенція власника (2026-08-27/28): опис товару в KeyCRM ТЕПЕР пишеться
 *   як ГОТОВА до відправки презентація — з ціною і акційними цінами вже всередині,
 *   перше речення = ім'я товару для клієнта. Бот більше НЕ урізає/переформульовує
 *   опис (__descShort раніше різав до 220 символів і губив саме ціну/акцію, яка
 *   писалась ДАЛІ в тексті) — а надсилає його ДОСЛІВНО (n_welcome, окремим
 *   патчем), лише додаючи запитання-заклик в кінці (за категорією: одяг →
 *   зріст/вага, взуття → розмір взуття, інше → загальне "Цікавить?").
 *
 *   n_lookup: __descShort (fact-extraction, обрізка до 220 симв.) → замінено на
 *   __customerName (перший рядок/речення чистого опису — це ім'я товару, яке
 *   клієнт БАЧИТЬ) + __followUpQuestion (категорійне запитання). found.name
 *   (поле "Назва" з CRM) лишається в product.name — але тепер це ЛИШЕ для
 *   внутрішнього використання (адмін-ноди, пошук/матчинг), клієнту ніде прямо
 *   не показується — показується product.customerName.
 *
 *   ЦЕЙ патч НЕ чіпає жодну customer-facing ноду (n_welcome, n_photo, n_size,
 *   n_color, ...) — вони патчаться ОКРЕМО (product.name → product.customerName,
 *   n_welcome → єдиний шаблон desc+followUpQuestion). Це підготовчий крок:
 *   поки він не застосований, нові поля просто ігноруються рушієм.
 *
 * ЗАПУСК:  node patch-verbatim-desc-customername.js            (dry-run)
 *          node patch-verbatim-desc-customername.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

// GOVERLA: n_lookup-code.js — живе джерело істини (1:1 з нодою), повна перезапись.
const NEW_LOOKUP_CODE_GOVERLA = fs.readFileSync(path.join(__dirname, 'n_lookup-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

// COVERCAR: структура n_lookup НЕ 1:1 з goverla — цільова заміна блоку descShort/result.
const CC_OLD = `  var __descClean=String(found.description||'').split('\\n').filter(function(ln){ return !/^\\s*ℹ️/.test(ln); }).join('\\n').trim();
  var __descShort=__descClean.split('\\n').slice(0,3).join('\\n');
  if(__descShort.length>220) __descShort=__descShort.slice(0,220).replace(/\\s+\\S*$/,'')+'…';
  var result={ supplier:__sup, product:{ _source:'keycrm', supplier:__sup, setComponents:__set, isSet:!!__set, setItems:setItems, setList:setItems.map(function(x){return x.name+(x.price?(" — "+x.price+" грн"):"")+" [арт. "+x.article+"]";}).join("; "), _matchKey:mk, _via:via, id:found.id, category_id:found.category_id, name:found.name||'Товар', desc:__descClean, descShort:__descShort, price:price, currency:found.currency_code||'UAH', photoUrl:img||'', imageUrls:imgs.slice(0,5), colors:colors.join(', '), colorsList:colors, sizes:sizes, offers:offers, upsell:upsell.join('; '), isClothing:__isClothing, supplierArticle:__supArticle, footwearNote:__footwearNote, qtyPrices:{ '2':__qty2?Number(__qty2):null, '3':__qty3?Number(__qty3):null, '4':__qty4?Number(__qty4):null }, qtyPromoText:__qtyPromoText, sizeChartUrl:__sizeChartUrl, aiInfo:__aiInfo, sizeChartNote:__sizeChartNote, sizeChartData:__sizeChartData, upsellPhotoUrl:__upsellPhoto, upsellPhotoNote:__upsellPhotoNote, _matchedSharedPostId:__matchedSharedPostId, _matchedEntryAd:__matchedEntryAd } };`;

const CC_NEW = `  var __descClean=String(found.description||'').split('\\n').filter(function(ln){ return !/^\\s*ℹ️/.test(ln); }).join('\\n').trim();
  // Аудит 2026-08-28: опис у KeyCRM тепер — готова презентація (з ціною/акцією
  // всередині), надсилаємо ДОСЛІВНО (n_welcome). Перше речення = ім'я товару
  // для клієнта; found.name лишається лише для внутрішнього використання.
  var __customerName=(__descClean.split('\\n')[0]||'').trim() || found.name || 'Товар';
  var __followUpQuestion = __isClothing
    ? '👉 Вкажіть, будь ласка, зріст і вагу — підберемо найкращий розмір? 😊'
    : (found.category_id === 7
      ? 'Напишіть, будь ласка, який розмір взуття зазвичай носите? 😊'
      : 'Цікавить? 😊');
  var result={ supplier:__sup, product:{ _source:'keycrm', supplier:__sup, setComponents:__set, isSet:!!__set, setItems:setItems, setList:setItems.map(function(x){return x.name+(x.price?(" — "+x.price+" грн"):"")+" [арт. "+x.article+"]";}).join("; "), _matchKey:mk, _via:via, id:found.id, category_id:found.category_id, name:found.name||'Товар', customerName:__customerName, desc:__descClean, followUpQuestion:__followUpQuestion, price:price, currency:found.currency_code||'UAH', photoUrl:img||'', imageUrls:imgs.slice(0,5), colors:colors.join(', '), colorsList:colors, sizes:sizes, offers:offers, upsell:upsell.join('; '), isClothing:__isClothing, supplierArticle:__supArticle, footwearNote:__footwearNote, qtyPrices:{ '2':__qty2?Number(__qty2):null, '3':__qty3?Number(__qty3):null, '4':__qty4?Number(__qty4):null }, qtyPromoText:__qtyPromoText, sizeChartUrl:__sizeChartUrl, aiInfo:__aiInfo, sizeChartNote:__sizeChartNote, sizeChartData:__sizeChartData, upsellPhotoUrl:__upsellPhoto, upsellPhotoNote:__upsellPhotoNote, _matchedSharedPostId:__matchedSharedPostId, _matchedEntryAd:__matchedEntryAd } };`;

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    if (!nLookup) { console.log(name, 'ERROR: n_lookup not found'); return; }

    const done = nLookup.data.code.includes('__customerName') && nLookup.data.code.includes('__followUpQuestion');
    if (done) { console.log(name, 'ALREADY_APPLIED'); return; }

    if (name === 'covercar' && !nLookup.data.code.includes(CC_OLD)) {
        console.log(name, 'WARNING: анкор CC_OLD не знайдено — лишаю без змін, перевір вручну.');
        return;
    }

    console.log(name, 'буде оновлено n_lookup (customerName/followUpQuestion замість descShort).');
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
