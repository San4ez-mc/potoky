'use strict';
/*
 * Патч: сповіщення в Telegram про недоступність зовнішніх сервісів для 4 воронок
 * covercar_ua / goverla_shop (KeyCRM-версія + клон на нову Fineko CRM):
 *   cc03657f-9e72-46e5-a16d-88826e70c2ee  covercar_ua (KeyCRM)
 *   5bdb3e38-1936-416f-b1f0-8f1125583193  goverla_shop (KeyCRM)
 *   a2d5ba79-f87b-48f2-8301-56292cdf3972  covercar_ua (клон → Fineko CRM)
 *   fcdee415-bef2-4a74-a650-e6e4b5a12322  goverla_shop (клон → Fineko CRM)
 *
 * Що змінює:
 *  1) КРИТИЧНО: n_crm_order (створення замовлення в CRM) — якщо провалилось
 *     (crmOrderId НЕ проставився), раніше n_create однаково слав адміну
 *     "🎉 НОВЕ ЗАМОВЛЕННЯ #" (порожній номер) — виглядало як успіх. Тепер:
 *     n_crm_order → n_crm_order_cond (є crmOrderId?)
 *       true  → n_create (як було, без змін)
 *       false → n_crm_order_failed_admin (notifyTg, чіткий ❌ алерт з причиною
 *                та даними клієнта/товару/доставки) → n_crm_order_failed_stop
 *                (js: adminEngaged=true, handoffReason='crm_order_failed' —
 *                справжня зупинка бота, testRestartAfter для тестера;
 *                той самий "Загальне відновлення після БУДЬ-ЯКОГО хендофу",
 *                що вже працює для payment_link_missing/product_unknown/size_oor)
 *  2) ОПЦІОНАЛЬНО: n_np_check (Нова Пошта — перевірка адреси) — на винятку
 *     (мережа/API впало) раніше мовчки пропускала перевірку (np.warn='НП
 *     недоступна', видно лише в даних сесії). Тепер додатково викликає
 *     notifyBalanceIssue (вже вбудований у движок js-нод, з дедупом 15 хв на
 *     бот+сервіс) — адмін дізнається, що адресу варто перевірити вручну.
 *     БЕЗ adminEngaged: збір адреси й далі оплата можуть продовжуватись —
 *     це збагачувальна перевірка, а не хард-блокер.
 *
 * ЗАПУСК (на СЕРВЕРІ, де DATABASE_URL вказує на прод-БД):
 *   node patch-external-service-notifications.js            (dry-run)
 *   node patch-external-service-notifications.js --apply    (записує + бекап)
 *
 * Ідемпотентний: повторний запуск нічого не ламає.
 */
const { db } = require('@platform/db');
const { computeAutoLayout } = require('@platform/flow-layout');

const BOT_IDS = [
    'cc03657f-9e72-46e5-a16d-88826e70c2ee', // covercar_ua (KeyCRM)
    '5bdb3e38-1936-416f-b1f0-8f1125583193', // goverla_shop (KeyCRM)
    'a2d5ba79-f87b-48f2-8301-56292cdf3972', // covercar_ua (клон → Fineko CRM)
    'fcdee415-bef2-4a74-a650-e6e4b5a12322', // goverla_shop (клон → Fineko CRM)
];
const APPLY = process.argv.includes('--apply');

// ── n_np_check: той самий код у всіх 4 воронках (Нова Пошта не залежить від CRM-бекенду) ──
const NP_CHECK_CODE = `
var key=(keys.NOVAPOSHTA_API_KEY||'').trim();
var od=context.orderData||{};
var np=Object.assign({tries:0,summary:''}, context.np||{});
if(!key || !od.city){ np.checked=false; np.summary=''; return { np: np }; }
np.tries=(np.tries||0)+1;
async function npCall(model,method,props){ var r=await fetch('https://api.novaposhta.ua/v2.0/json/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:key,modelName:model,calledMethod:method,methodProperties:props})}); return await r.json().catch(function(){return{};}); }
function mkSummary(){ var s='📦 Доставка: '+(np.city||od.city)+(np.warehouse?(', '+np.warehouse):''); if(np.warn) s+='\\n⚠️ '+np.warn+' — напишіть, якщо треба поправити'; return s+'\\n'; }
try{
  var s=await npCall('Address','searchSettlements',{CityName:String(od.city),Limit:'20'});
  var addrs=(s.data&&s.data[0]&&s.data[0].Addresses)||[];
  if(!addrs.length){ np.checked=true; np.ask=(np.tries<2); np.city=od.city; np.warn='місто «'+od.city+'» не знайдено в Новій Пошті'; np.askMsg='Не знайшла населений пункт «'+od.city+'» у Новій Пошті 🤔 Підкажіть, будь ласка, точну назву міста/села (можна з областю).'; np.summary=mkSummary(); return { np: np }; }
  // 1) ТОЧНИЙ збіг назви: «Київ» не має перепитуватись лише тому, що є «Київець» тощо.
  function nrm(x){ return String(x||'').toLowerCase().replace(/[’'\`]/g,'').replace(/\\s+/g,' ').trim(); }
  var q=nrm(od.city);
  var exact=addrs.filter(function(a){ return nrm(a.MainDescription)===q; });
  if(exact.length>1){
    // серед однойменних — місто має пріоритет над селом/смт
    var cities=exact.filter(function(a){ return /^м\\.|^m\\./i.test(String(a.SettlementTypeCode||'')) || /місто/i.test(String(a.SettlementTypeDescription||'')) || /^м\\.\\s/i.test(String(a.Present||'')); });
    if(cities.length===1) exact=cities;
  }
  if(exact.length===1){ addrs=exact; }
  else if(exact.length>1){ addrs=exact; }
  if(addrs.length>1){
    var reg=''; var mm=String((od.region||'')+' '+od.city).toLowerCase().match(/([а-яіїєґ']{4,})\\s*обл/i); if(mm) reg=mm[1];
    var narrow=reg?addrs.filter(function(a){return String(a.Present).toLowerCase().indexOf(reg)>=0;}):addrs;
    if(narrow.length===1){ addrs=narrow; }
    else {
      np.checked=true; np.ask=(np.tries<2); np.city=od.city;
      np.options=addrs.slice(0,6).map(function(a){return a.Present;});
      np.warn='кілька населених пунктів «'+od.city+'», уточніть область';
      np.askMsg='Щоб не помилитись із доставкою 🙂 у нас кілька населених пунктів «'+od.city+'». Підкажіть, будь ласка, область (або повну назву з районом).';
      np.summary=mkSummary(); return { np: np };
    }
  }
  var a=addrs[0]; np.checked=true; np.ask=false; np.city=a.Present; np.cityRef=a.DeliveryCity||''; np.settlementRef=a.Ref||''; np.ref=np.cityRef||np.settlementRef; np.warn=''; np.askMsg='';
  var bnum=(String(od.branch||'').match(/\\d+/)||[])[0];
  var wantP=/поштомат|термінал/i.test(String(od.branch||''));
  if(np.ref){
    // getWarehouses: для міста — CityRef (DeliveryCity), для села — SettlementRef. Пробуємо обидва.
    var w=np.cityRef?await npCall('Address','getWarehouses',{CityRef:np.cityRef,Limit:'1000'}):{};
    if(!((w.data)||[]).length && np.settlementRef) w=await npCall('Address','getWarehouses',{SettlementRef:np.settlementRef,Limit:'1000'});
    var whs=(w.data)||[]; var hit=null;
    if(bnum){ hit=whs.filter(function(x){return String(x.Number)===String(bnum)&&(!wantP||x.CategoryOfWarehouse==='Postomat');})[0] || whs.filter(function(x){return String(x.Number)===String(bnum);})[0]; }
    if(hit){ np.warehouse=hit.Description; np.warehouseRef=hit.Ref; np.warehouseType=hit.CategoryOfWarehouse; }
    else if(bnum){ np.warehouse='№'+bnum; np.ask=(np.tries<2); np.warn=(wantP?'поштомат':'відділення')+' №'+bnum+' у місті «'+np.city+'» не знайдено'; np.askMsg='У місті «'+np.city+'» не знайшла '+(wantP?'поштомат':'відділення')+' №'+bnum+' 🤔 Перевірте, будь ласка, номер (можна написати «поштомат N» чи «відділення N»).'; }
    else { np.ask=(np.tries<2); np.warn='не вказано номер відділення/поштомата'; np.askMsg='Підкажіть, будь ласка, номер відділення або поштомата Нової Пошти 🙂'; }
  }
  np.summary=mkSummary(); return { np: np };
}catch(e){
  np.checked=false; np.summary=''; np.warn='НП недоступна';
  // Аудит 2026-09-02 (сповіщення про недоступні зовнішні сервіси): опціональна
  // перевірка — збір адреси й оплата продовжуються без хард-блоку, але адмін
  // має знати, що адресу варто звірити вручну. notifyBalanceIssue вже
  // вбудований у движок js-нод (дедуп 15 хв на бот+сервіс).
  try{ notifyBalanceIssue('Нова Пошта (перевірка адреси)', e.message); }catch(e2){}
  return { np: np };
}
`.trim();

function upsertNode(nodes, id, patch) {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) { nodes[i] = { ...nodes[i], ...patch, data: { ...(nodes[i].data || {}), ...(patch.data || {}) } }; return false; }
    nodes.push({ id, position: { x: 320, y: 4520 }, measured: { width: 260, height: 92 }, ...patch });
    return true;
}
function setEdge(edges, source, target, sourceHandle) {
    for (let k = edges.length - 1; k >= 0; k--) {
        if (edges[k].source === source && (sourceHandle ? edges[k].sourceHandle === sourceHandle : !edges[k].sourceHandle)) edges.splice(k, 1);
    }
    const id = 'e_' + source + '_' + target + (sourceHandle ? '_' + sourceHandle : '');
    if (!edges.find((e) => e.id === id)) edges.push({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
}

(async () => {
    for (const BOT_ID of BOT_IDS) {
        const fd = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
        if (!fd) { console.error('flowDefinition не знайдено для', BOT_ID); continue; }
        const nodes = JSON.parse(JSON.stringify(fd.nodes));
        const edges = JSON.parse(JSON.stringify(fd.edges));
        const before = JSON.stringify({ nodes, edges });

        if (!nodes.find((n) => n.id === 'n_crm_order') || !nodes.find((n) => n.id === 'n_create')) {
            console.error('Пропускаю', BOT_ID, '— немає n_crm_order/n_create (несподівана топологія)');
            continue;
        }

        // ── 1) КРИТИЧНО: гейт після n_crm_order ──
        upsertNode(nodes, 'n_crm_order_cond', { type: 'condition', data: {
            label: '12.51 Замовлення в CRM створено?',
            condition: '!!context.crmOrderId',
            description: 'TRUE — CRM POST /order(s) успішний (є crmOrderId) → звичайне сповіщення n_create. FALSE — провал → окремий ❌ алерт + справжня зупинка бота (adminEngaged), щоб не слати адміну фальшиве "НОВЕ ЗАМОВЛЕННЯ #" з порожнім номером.',
        } });
        upsertNode(nodes, 'n_crm_order_failed_admin', { type: 'notifyTg', data: {
            label: '12.52 ПОМИЛКА створення замовлення в CRM — сигнал',
            targetKey: 'ADMIN_TELEGRAM_ID',
            message: '❌ <b>ПОМИЛКА: замовлення НЕ створено в CRM</b> — оформіть вручну!\n\nПричина: {{context.crmOrderError}}\n\n👤 Клієнт: {{context.senderName}} ({{context.igUsername}})\n🛍️ Товар: {{context.product.name}} | Розмір: {{context.recommendedSize}} | Колір: {{context.colorChoice.color}}\n💳 Оплата: {{context.payLabel}}\n📦 Отримувач: {{context.orderData.fullName}}, {{context.orderData.phone}}\n📍 Адреса: {{context.orderData.city}}, НП {{context.orderData.branch}}',
            description: 'Клієнт уже оплатив і дав адресу, але запис у CRM не пройшов — без цього сигналу замовлення просто загубилось би.',
        } });
        upsertNode(nodes, 'n_crm_order_failed_stop', { type: 'js', data: {
            label: '12.53 Пауза бота (менеджер оформлює вручну)',
            code: "return { adminEngaged: true, handoffReason: 'crm_order_failed' };",
            description: 'Ставить adminEngaged=true, handoffReason="crm_order_failed" — бот замовкає, автоматично відновиться на наступне повідомлення клієнта (як і решта хендофів у двигуні).',
            testRestartAfter: true,
        } });

        setEdge(edges, 'n_crm_order', 'n_crm_order_cond');
        setEdge(edges, 'n_crm_order_cond', 'n_create', 'true');
        setEdge(edges, 'n_crm_order_cond', 'n_crm_order_failed_admin', 'false');
        setEdge(edges, 'n_crm_order_failed_admin', 'n_crm_order_failed_stop');
        // n_crm_order_failed_stop — термінальна пауза, без вихідного ребра (як n_unknown_stop/n_size_oor_stop).
        for (let k = edges.length - 1; k >= 0; k--) if (edges[k].source === 'n_crm_order_failed_stop') edges.splice(k, 1);

        // ── 2) ОПЦІОНАЛЬНО: Нова Пошта — сповіщення при недоступності ──
        if (nodes.find((n) => n.id === 'n_np_check')) {
            upsertNode(nodes, 'n_np_check', { data: { code: NP_CHECK_CODE } });
        }

        const after = JSON.stringify({ nodes, edges });
        const changed = before !== after;
        console.log(BOT_ID, '| nodes:', nodes.length, '| edges:', edges.length, '| змінено:', changed);

        if (!APPLY) continue;
        if (!changed) { console.log('  (без змін, пропускаю запис)'); continue; }

        const laidOut = computeAutoLayout(nodes, edges);

        const fs = require('fs');
        fs.writeFileSync(`_backup_flow_${BOT_ID}_${Date.now()}.json`, JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
        await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes: laidOut, edges } });
        console.log('  ✅ записано + бекап збережено + auto_layout застосовано.');
    }
    if (!APPLY) console.log('\nDRY-RUN. Для запису: node patch-external-service-notifications.js --apply');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
