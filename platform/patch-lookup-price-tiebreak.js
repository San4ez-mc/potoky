'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Живий кейс (аудит 2026-08-29, реел Олексія "Осіння вʼязана кофта, джинси,
 *   футболка, лофери"): Priority 2.5 (ключові слова підпису проти назви товару)
 *   знаходив ДВА кандидати з однаковим рахунком — реальний "Комплект 4 в 1"
 *   (sku=set001, ціна 5308) і покинутий чернетковий дубль (sku=set1111,
 *   ЦІНА 0) — тай-брейк був занадто консервативний і чесно відмовлявся
 *   вгадувати, тому матч так і не спрацьовував.
 *
 *   Виправлення: при рівному рахунку — товар із РЕАЛЬНОЮ ціною (>0) йде
 *   першим; вважаємо матч однозначним, лише якщо серед тих, хто теж набрав
 *   top-рахунок, НЕМАЄ іншого з таким самим "має ціну чи ні" статусом
 *   (тобто два платні дублі з однаковим рахунком і далі коректно НЕ
 *   вгадуються — тільки платний проти безцінного дубля тепер вирішується).
 *
 * ЗАПУСК:  node patch-lookup-price-tiebreak.js            (dry-run)
 *          node patch-lookup-price-tiebreak.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const NEW_LOOKUP_CODE_GOVERLA = fs.readFileSync(path.join(__dirname, 'n_lookup-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

// Анкор — точний блок сортування/вибору Priority 2.5, як його поставив
// patch-lookup-keyword-and-post-vision.js (без тай-брейка за ціною).
const OLD_SORT_BLOCK = `      scoredKW.sort(function(a,b){return b.score-a.score;});
      if(scoredKW.length && scoredKW[0].score>=2 && (scoredKW.length<2 || scoredKW[0].score>scoredKW[1].score)){
        found=scoredKW[0].p; via='keyword:'+scoredKW[0].score; mk='kw_'+scoredKW[0].p.id;
      }`;

const NEW_SORT_BLOCK = `      // Тай-брейк за ціною (аудит 2026-08-29, живий кейс "Комплект 4 в 1" —
      // ДВА записи в каталозі з однаковим збігом слів: реальний, з ціною
      // (set001, 5308 грн) і покинутий чернетковий дубль (set1111, ЦІНА 0).
      // При рівному рахунку — сортуємо кандидатів з однаковим top-score так,
      // щоб товар із РЕАЛЬНОЮ ціною (>0) йшов першим; лише якщо й після цього
      // лишається справжня двозначність (кілька з ціною АБО жоден без ціни) —
      // чесно НЕ вгадуємо.
      scoredKW.sort(function(a,b){
        if(b.score!==a.score) return b.score-a.score;
        var ap=(a.p.price!=null?a.p.price:a.p.min_price)||0, bp=(b.p.price!=null?b.p.price:b.p.min_price)||0;
        return (bp>0?1:0)-(ap>0?1:0);
      });
      if(scoredKW.length && scoredKW[0].score>=2){
        var __topScore=scoredKW[0].score;
        var __topPrice=(scoredKW[0].p.price!=null?scoredKW[0].p.price:scoredKW[0].p.min_price)||0;
        var __tiedRivals=scoredKW.filter(function(x,xi){ return xi>0 && x.score===__topScore; });
        var __ambiguous = __tiedRivals.some(function(x){ var xp=(x.p.price!=null?x.p.price:x.p.min_price)||0; return (__topPrice>0)===(xp>0); });
        if(!__ambiguous){
          found=scoredKW[0].p; via='keyword:'+__topScore; mk='kw_'+scoredKW[0].p.id;
        }
      }`;

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    if (!nLookup) { console.log(name, 'ERROR: n_lookup not found'); return; }

    const done = nLookup.data.code.includes('Тай-брейк за ціною');
    if (done) { console.log(name, 'ALREADY_APPLIED'); return; }

    if (name === 'covercar' && !nLookup.data.code.includes(OLD_SORT_BLOCK)) {
        console.log(name, 'WARNING: анкор OLD_SORT_BLOCK не знайдено — лишаю без змін, перевір вручну.');
        return;
    }

    console.log(name, 'буде додано тай-брейк за ціною у Priority 2.5.');
    if (!APPLY) return;

    const nodes = flow.nodes.map((n) => {
        if (n.id !== 'n_lookup') return n;
        if (name === 'goverla') return { ...n, data: { ...n.data, code: NEW_LOOKUP_CODE_GOVERLA } };
        return { ...n, data: { ...n.data, code: n.data.code.split(OLD_SORT_BLOCK).join(NEW_SORT_BLOCK) } };
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
