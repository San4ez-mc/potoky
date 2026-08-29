'use strict';
/*
 * Патч ОБОХ воронок («goverla_shop» 5bdb3e38-... і «covercar_ua» cc03657f-...)
 *   Запит власника (2026-08-29): частину рекламних постів НЕ можна відредагувати
 *   (крутяться в живих кампаніях), тож просто дописати "Артикул XXXX" в підпис
 *   не завжди можливо. Перед тим, як чесно сказати "не визначив товар", варто
 *   спробувати ЩЕ два способи:
 *
 *   1) ПРІОРИТЕТ 2.5 — ключові слова підпису проти НАЗВИ товару в каталозі.
 *      Спрацьовує саме для акційних/набірних постів типу "Кофта, джинси,
 *      футболка, лофери" — назва товару в CRM буквально перелічує ті самі
 *      слова ("Комплект 4 в 1 (Кофта Ангора, Джинси, Футболка, Лофери)").
 *      Обережний поріг: 2+ значущих слова-збіги, і найкращий кандидат ЯВНО
 *      кращий за другого — інакше не вгадуємо.
 *
 *   2) ПРІОРІТЕТ 2.9 розширено — ШІ-візія (Gemini) тепер пробує НЕ ЛИШЕ скрін,
 *      який клієнт надіслав напряму (lastUserImageUrl), а й ФОТО/ОБКЛАДИНКУ
 *      самого пересланого поста/рілсу (context.sharedPost.url), коли артикул і
 *      ключові слова не спрацювали.
 *
 *   Кличемо людину, якщо ВСЕ це не спрацювало, — уже відбувається автоматично
 *   через n_unknown_admin (notifyTg), нічого додатково будувати не треба.
 *
 * ЗАПУСК:  node patch-lookup-keyword-and-post-vision.js            (dry-run)
 *          node patch-lookup-keyword-and-post-vision.js --apply    (записує у БД)
 *
 * Ідемпотентний.
 */
const { db } = require('@platform/db');
const fs = require('fs');
const path = require('path');

const BOTS = { goverla: '5bdb3e38-1936-416f-b1f0-8f1125583193', covercar: 'cc03657f-9e72-46e5-a16d-88826e70c2ee' };
const APPLY = process.argv.includes('--apply');

const NEW_LOOKUP_CODE_GOVERLA = fs.readFileSync(path.join(__dirname, 'n_lookup-code.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');

const CC_OLD = `    // 2b) артикул на рівні товару (sku / CT_1001 / будь-яке кастом-поле)
    if(!found){ for(var b=0;b<cc.length&&!found;b++){ var pm=matchArticle(all,cc[b]); if(pm){ found=pm; via='article:'+cc[b]; mk='art_'+cc[b]; } } }
  }

  // ПРІОРИТЕТ 3: media_id рілса — опційно (поле в CRM); наразі пропускаємо

  // ПРІОРІТЕТ 2.9: клієнт кинув СКРІН товару замість поста/рілс — ШІ-візія (Gemini)
  // проти каталогу KeyCRM. На цьому кроці ще немає orderRef/оплати, тож будь-яке
  // вхідне фото тут — майже напевно спроба показати товар, не квитанція.
  if(!found && context.lastUserImageUrl && keys.GEMINI_API_KEY){
    function imgOk(u){ try{ var h=new URL(u).hostname.toLowerCase(); if(h==='api.telegram.org') return true; return ['cdninstagram.com','fbcdn.net','fbsbx.com','lookaside.fbsbx.com'].some(function(d){return h===d||h.endsWith('.'+d);}); }catch(e){return false;} }
    if(imgOk(context.lastUserImageUrl)){
      var acp=new AbortController(); var top=setTimeout(function(){try{acp.abort();}catch(e){}},10000);
      try{
        var irp=await fetch(context.lastUserImageUrl,{signal:acp.signal});
        var abp=await irp.arrayBuffer();
        if(abp.byteLength<=8000000){
          var b64p=Buffer.from(abp).toString('base64');
          var mimepRaw=(irp.headers.get('content-type')||'').split(';')[0]; var mimep=(!mimepRaw || mimepRaw==='application/octet-stream') ? 'image/jpeg' : mimepRaw;
          var catList=all.map(function(p,i){return i+': '+(p.name||'');}).join('\\n').slice(0,6000);
          var promptp='Це скріншот, який клієнт надіслав замість посту/рілс — ймовірно, товар з нашого магазину. Опиши коротко, що на фото (тип товару, колір, помітний текст/бренд). Потім знайди НАЙБЛИЖЧИЙ відповідник у каталозі нижче (формат: індекс: назва). Якщо жодного релевантного немає — bestMatchIndex null. Поверни ЛИШЕ JSON {"description":"...","bestMatchIndex":число_або_null}.\\nКаталог:\\n'+catList;`;

const CC_NEW = `    // 2b) артикул на рівні товару (sku / CT_1001 / будь-яке кастом-поле)
    if(!found){ for(var b=0;b<cc.length&&!found;b++){ var pm=matchArticle(all,cc[b]); if(pm){ found=pm; via='article:'+cc[b]; mk='art_'+cc[b]; } } }
  }

  // ПРІОРИТЕТ 2.5 (аудит 2026-08-29, запит власника): артикулу нема (частина
  // рекламних постів досі не можна відредагувати — крутяться в кампаніях) —
  // пробуємо ЗА КЛЮЧОВИМИ СЛОВАМИ підпису проти НАЗВИ товару в каталозі.
  // Поріг обережний: мінімум 2 значущих слова-збіги, і найкращий кандидат
  // ЯВНО кращий за другого — інакше не вгадуємо, краще чесно "не визначив".
  if(!found && context.sharedPost && context.sharedPost.caption){
    var STOPWORDS_KW={'та':1,'і':1,'й':1,'на':1,'до':1,'за':1,'від':1,'для':1,'або':1,'це':1,'вже':1,'ще':1,'як':1,'що':1,'по':1,'при':1,'без':1,'між':1};
    function tokenizeKW(s){ return String(s||'').toLowerCase().replace(/[^\\wа-яіїєґ\\s]/gi,' ').split(/\\s+/).filter(function(w){return w.length>=4 && !STOPWORDS_KW[w];}); }
    var capWordsKW=tokenizeKW(context.sharedPost.caption);
    if(capWordsKW.length){
      var capSetKW={}; for(var wi=0;wi<capWordsKW.length;wi++)capSetKW[capWordsKW[wi]]=1;
      var scoredKW=[];
      for(var pi3=0;pi3<all.length;pi3++){
        var pnameWordsKW=tokenizeKW(all[pi3].name);
        var overlapKW=0; for(var wj=0;wj<pnameWordsKW.length;wj++){ if(capSetKW[pnameWordsKW[wj]])overlapKW++; }
        if(overlapKW>0) scoredKW.push({p:all[pi3], score:overlapKW});
      }
      scoredKW.sort(function(a,b){return b.score-a.score;});
      if(scoredKW.length && scoredKW[0].score>=2 && (scoredKW.length<2 || scoredKW[0].score>scoredKW[1].score)){
        found=scoredKW[0].p; via='keyword:'+scoredKW[0].score; mk='kw_'+scoredKW[0].p.id;
      }
    }
  }

  // ПРІОРИТЕТ 3: media_id рілса — опційно (поле в CRM); наразі пропускаємо

  // ПРІОРІТЕТ 2.9 (розширено 2026-08-29): ШІ-візія (Gemini) — раніше лише для
  // СКРІНУ, який клієнт надіслав напряму (lastUserImageUrl). Тепер ТАКОЖ
  // пробуємо, якщо клієнт переслав пост/рілс БЕЗ артикулу і без збігу за
  // ключовими словами — context.sharedPost.url тоді несе фото/обкладинку.
  var __visionUrl = context.lastUserImageUrl || (!found && context.sharedPost && context.sharedPost.url) || '';
  if(!found && __visionUrl && keys.GEMINI_API_KEY){
    function imgOk(u){ try{ var h=new URL(u).hostname.toLowerCase(); if(h==='api.telegram.org') return true; return ['cdninstagram.com','fbcdn.net','fbsbx.com','lookaside.fbsbx.com'].some(function(d){return h===d||h.endsWith('.'+d);}); }catch(e){return false;} }
    if(imgOk(__visionUrl)){
      var acp=new AbortController(); var top=setTimeout(function(){try{acp.abort();}catch(e){}},10000);
      try{
        var irp=await fetch(__visionUrl,{signal:acp.signal});
        var abp=await irp.arrayBuffer();
        if(abp.byteLength<=8000000){
          var b64p=Buffer.from(abp).toString('base64');
          var mimepRaw=(irp.headers.get('content-type')||'').split(';')[0]; var mimep=(!mimepRaw || mimepRaw==='application/octet-stream') ? 'image/jpeg' : mimepRaw;
          var catList=all.map(function(p,i){return i+': '+(p.name||'');}).join('\\n').slice(0,6000);
          var promptp='Це фото (скріншот, або обкладинка допису/рілсу), яке клієнт показав — ймовірно, товар з нашого магазину. Опиши коротко, що на фото (тип товару, колір, помітний текст/бренд). Потім знайди НАЙБЛИЖЧИЙ відповідник у каталозі нижче (формат: індекс: назва). Якщо жодного релевантного немає — bestMatchIndex null. Поверни ЛИШЕ JSON {"description":"...","bestMatchIndex":число_або_null}.\\nКаталог:\\n'+catList;`;

async function patchBot(name, botId) {
    const flow = await db.flowDefinition.findUnique({ where: { botId } });
    if (!flow) { console.log(name, 'ERROR: no flow'); return; }

    const nLookup = flow.nodes.find((n) => n.id === 'n_lookup');
    if (!nLookup) { console.log(name, 'ERROR: n_lookup not found'); return; }

    const done = nLookup.data.code.includes('ПРІОРИТЕТ 2.5');
    if (done) { console.log(name, 'ALREADY_APPLIED'); return; }

    if (name === 'covercar' && !nLookup.data.code.includes(CC_OLD)) {
        console.log(name, 'WARNING: анкор CC_OLD не знайдено — лишаю без змін, перевір вручну.');
        return;
    }

    console.log(name, 'буде додано keyword-matching (2.5) і vision по фото поста (2.9 розширено).');
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
