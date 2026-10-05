'use strict';
// Patch (source of truth): goverla — вузол n_supplier_order (brewdrop), 05.10.
// 1) Мережевий збій («fetch failed», GOVTUXUZ2I9 / GOVM77QE028): GET-запити повторюються до 3 разів; якщо збій лишився —
//    зрозуміла помилка з кроком; збій на POST /api/marketplace/orders позначається «замовлення МОГЛО створитись — перевірте кабінет».
//    (Раніше вузол падав винятком без тексту, а кнопка менеджера показувала «✅ оформлено».)
// 2) Однойменні населені пункти (fe2c9063, «село Червоне, Гайсинський район», Вінницька обл.): вузол брав перше «Червоне» точним
//    збігом. Тепер усі кандидати з тією ж назвою звужуються областю/районом з адреси, а якщо їх лишилось кілька — перевіряється,
//    у якому з них є відділення №N; не однозначно — чесна помилка з варіантами, а не вгадування.
//
// Idempotent. Запуск на сервері (після git pull):  node scripts/patch-brewdrop-network-city-2026-10-05.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const NODE = 'n_supplier_order';
const MARK = '__sameCityPick';

const BD_OLD = "async function bd(path,opts){ var r=await fetch(base+path,Object.assign({headers:HDR},opts||{})); var j=null; try{ j=await r.json(); }catch(e){} return {status:r.status,json:j}; }";
const BD_NEW = String.raw`async function bd(path,opts){ var __m=(opts&&opts.method)||'GET'; var __tries=__m==='GET'?3:1; var r=null, __err=null; for(var __a=0;__a<__tries;__a++){ try{ r=await fetch(base+path,Object.assign({headers:HDR},opts||{})); break; }catch(e){ __err=e; if(__a<__tries-1) await new Promise(function(res){ setTimeout(res, 800*(__a+1)); }); } } if(!r){ var __p=String(path).split('?')[0]; throw new Error('мережевий збій brewdrop на '+__m+' '+__p+(/marketplace\/orders/.test(__p)?' — замовлення МОГЛО створитись, перевірте кабінет brewdrop перед повтором':'')+' ('+((__err&&__err.message)||'')+')'); } var j=null; try{ j=await r.json(); }catch(e){} return {status:r.status,json:j}; }`;

const CITY_Q_OLD = "var cy=await bd('/api/cities?name='+encodeURIComponent(cityQ)+'&per_page=10');";
const CITY_Q_NEW = "var cy=await bd('/api/cities?name='+encodeURIComponent(cityQ)+'&per_page=50');";

const CITY_FIND_OLD = "var cityObj=cyList.find(function(c){ return norm(c.name)===norm(cityQ) || norm(c.name_ua)===norm(cityQ); })||null;";
const CITY_FIND_NEW = String.raw`// Однойменні населені пункти (patch-brewdrop-network-city-2026-10-05.js): «Червоне» і «Червоне (Вінницька обл.)» — спершу область/район з адреси, далі — де є відділення №N.
var __sameCityPick=null;
var __sameCity=cyList.filter(function(c){ return normCity(c.name)===normCity(cityQ) || normCity(c.name_ua)===normCity(cityQ); });
if(__sameCity.length>1){
  var __rsrc=norm([od.region, np.region, od.branch, od.city, cityRaw].filter(Boolean).join(' '));
  var __cityStem=norm(cityQ).slice(0,5);
  var __rst=(__rsrc.match(/[а-яіїєґ]{5,}/g)||[]).map(function(w){return w.slice(0,5);}).filter(function(w){return w!==__cityStem && !/^(облас|район|відді|поштом|нова|пошта|село|селищ|місто)/.test(w);});
  var __byReg=__sameCity.filter(function(c){ var paren=norm(String(c.name_ua||c.name||'').split('(')[1]||''); return paren && __rst.some(function(s){ return paren.indexOf(s)>=0; }); });
  var __pool=__byReg.length?__byReg:__sameCity;
  var __bn=(String(np.warehouse||od.branch||'').match(/(\d+)/)||[])[1]||'';
  if(__pool.length===1) __sameCityPick=__pool[0];
  else if(__bn){
    var __reN=new RegExp('№\\s*'+__bn+'(?!\\d)'); var __hits=[];
    for(var __ci=0;__ci<__pool.length&&__ci<10;__ci++){ var __bq=await bd('/api/branches?city_id='+__pool[__ci].id+'&search='+encodeURIComponent(__bn)+'&per_page=50'); if(((__bq.json&&__bq.json.data)||[]).some(function(b){ return __reN.test(String(b.name||'')+' '+String(b.name_ua||'')); })) __hits.push(__pool[__ci]); }
    if(__hits.length===1) __sameCityPick=__hits[0];
    else return fail('населених пунктів «'+cityQ+'» кілька'+(__hits.length?' з відділенням №'+__bn:'')+': '+(__hits.length?__hits:__pool).map(function(c){return c.name_ua||c.name;}).slice(0,6).join('; ')+' — уточніть у клієнта область/район');
  }
  else return fail('населених пунктів «'+cityQ+'» кілька: '+__pool.map(function(c){return c.name_ua||c.name;}).slice(0,6).join('; ')+' — уточніть область/район');
}
var cityObj=__sameCityPick||cyList.find(function(c){ return norm(c.name)===norm(cityQ) || norm(c.name_ua)===norm(cityQ); })||null;`;

async function main() {
    const flow = await prisma.flowDefinition.findUnique({ where: { botId: BOT } });
    if (!flow) throw new Error('flow не знайдено');
    const nodes = flow.nodes.slice();
    const i = nodes.findIndex((n) => n.id === NODE);
    if (i < 0) throw new Error('немає ноди ' + NODE);
    let code = String(nodes[i].data.code || '');
    if (code.includes(MARK)) { console.log('already patched'); return; }
    for (const [from, to] of [[BD_OLD, BD_NEW], [CITY_Q_OLD, CITY_Q_NEW], [CITY_FIND_OLD, CITY_FIND_NEW]]) {
        const cnt = code.split(from).length - 1;
        if (cnt !== 1) throw new Error('фрагмент зустрівся ' + cnt + ' раз(и), очікувалось 1 — код ноди змінився, оновіть патч: ' + from.slice(0, 80));
        code = code.replace(from, () => to);
    }
    nodes[i] = { ...nodes[i], data: { ...nodes[i].data, code } };
    await prisma.flowDefinition.update({ where: { botId: BOT }, data: { nodes } });
    console.log('patched', NODE);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
