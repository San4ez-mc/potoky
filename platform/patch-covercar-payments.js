'use strict';
/*
 * Патч воронки «Instagram — реклама (Zernio, covercar)» (bot cc03657f-…)
 *   Ф0  Біла нода: n_create notifyTg → notifyAdmin
 *   Ф1  Памʼять: messagesTemplate '{{conversationHistory}}' на діалог-нодах + петля нагадування
 *   Ф2  Гілка оплати: ibanoplata-лінк → реквізити → збір → виписка Mono → звірка → гілки
 *   Ф5  Прибрати осиротілі ноди реквізитів (зведені в одне повідомлення)
 *
 * ЗАПУСК:  node patch-covercar-payments.js            (dry-run: лише показує зміни)
 *          node patch-covercar-payments.js --apply    (записує у БД + бекап flowDefinition)
 *
 * Ідемпотентний: повторний запуск нічого не ламає.
 * Потрібні збережені конектори (створити в /connectors, тип має збігатись):
 *   type=ibanoplata  (api_key, organization_name, identification_code, iban)
 *   type=monobank    (token, account_id)
 */
const { db } = require('@platform/db');

const BOT_ID = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');

const FOP_IBAN = 'UA703220010000026002310097579';
const FOP_CODE = '3560005875';
const FOP_NAME = 'ФОП Сіразетдінов Олексій Олександрович';
const GEMINI_CONNECTOR_ID = 'e94f5f54-b19b-4d9c-b8aa-e88bcc4194d1'; // для ШІ-візії (fallback скрінів)

// ── js-код ноди звірки оплати (Mono → лінк → ШІ-візія → людина) ────────────────
const RECONCILE_CODE = `
var EXPECTED_IBAN = (keys.FOP_IBAN||'').replace(/\\s/g,'');
var EXPECTED_CODE = (keys.FOP_CODE||'').replace(/\\D/g,'');
var orderRef = String(context.orderRef||'').toUpperCase();
var expected = Number(context.payAmount)||0;
var stmt = Array.isArray(context.monoStatement)?context.monoStatement:[];
var consumed = Array.isArray(context.consumedTxIds)?context.consumedTxIds:[];
function matchMono(amount){
  if(orderRef){ for(var i=0;i<stmt.length;i++){ var t=stmt[i]; if(consumed.indexOf(t.id)<0 && String(t.comment||'').toUpperCase().indexOf(orderRef)>=0) return t; } }
  if(amount){ for(var j=0;j<stmt.length;j++){ var u=stmt[j]; if(consumed.indexOf(u.id)<0 && Math.abs(Number(u.amountUah)-amount)<0.01) return u; } }
  return null;
}
function parseAmount(txt){ if(!txt)return null; var m=String(txt).match(/(\\d[\\d\\s]*[.,]?\\d{0,2})\\s*(?:грн|uah|₴)?/i); if(!m)return null; var n=parseFloat(m[1].replace(/\\s/g,'').replace(',','.')); return isFinite(n)?Math.round(n*100)/100:null; }
var found = matchMono(expected);
var via = found ? 'mono' : '';
// Крок 2: лінк-квитанція у тексті (check.monobank.ua / pb.ua/check тощо) — парсимо кодом
if(!found){
  var link=(String(context.lastUserMessage||input||'').match(/https?:\\/\\/[^\\s]+/)||[])[0];
  if(link){ try{ var r=await fetch(link,{redirect:'follow'}); var html=await r.text(); var txt=html.replace(/<[^>]+>/g,' ');
    var okRec = txt.replace(/\\s/g,'').indexOf(EXPECTED_IBAN)>=0 || txt.replace(/\\D/g,'').indexOf(EXPECTED_CODE)>=0;
    var amt = parseAmount((txt.match(/(?:Сума|Сумма|Amount)[^\\d]{0,20}(\\d[\\d\\s]*[.,]?\\d{0,2})/i)||[])[1]);
    if(okRec && amt){ found = matchMono(amt); if(found) via='link'; }
  }catch(e){} }
}
// Крок 3: скрін — ШІ-візія (лише коли Mono не знайшов). Останній резерв.
if(!found && context.lastReceiptImageUrl && keys.GEMINI_API_KEY){
  try{
    var ir=await fetch(context.lastReceiptImageUrl); var ab=await ir.arrayBuffer(); var b64=Buffer.from(ab).toString('base64');
    var mime=(ir.headers.get('content-type')||'image/jpeg').split(';')[0];
    var gr=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key='+encodeURIComponent(keys.GEMINI_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'Це банківська квитанція. Поверни ЛИШЕ JSON {"amount":число,"recipientCode":"код одержувача","iban":"IBAN одержувача","purpose":"призначення"}'},{inline_data:{mime_type:mime,data:b64}}]}]})});
    var gj=await gr.json(); var t=((((gj.candidates||[])[0]||{}).content||{}).parts||[{}])[0].text||''; var mm=t.match(/\\{[\\s\\S]*\\}/);
    if(mm){ var f=JSON.parse(mm[0]); var okRec2=String(f.iban||'').replace(/\\s/g,'').indexOf(EXPECTED_IBAN)>=0 || String(f.recipientCode||'').replace(/\\D/g,'').indexOf(EXPECTED_CODE)>=0; var amt2=Number(f.amount)||parseAmount(f.amount); if(okRec2 && amt2){ found=matchMono(amt2); if(found) via='ai'; } }
  }catch(e){}
}
if(found){ consumed.push(found.id); return { payStatus:'confirmed', payVia:via, payTxId:found.id, consumedTxIds:consumed }; }
return { payStatus:'not_found', payVia:'none' };
`.trim();

function upsertNode(nodes, id, patch) {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) { nodes[i] = { ...nodes[i], ...patch, data: { ...(nodes[i].data || {}), ...(patch.data || {}) } }; return false; }
    nodes.push({ id, position: { x: 320, y: 3400 }, measured: { width: 260, height: 92 }, ...patch }); return true;
}
function removeNode(nodes, edges, id) {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) nodes.splice(i, 1);
    for (let k = edges.length - 1; k >= 0; k--) if (edges[k].source === id || edges[k].target === id) edges.splice(k, 1);
}
function setEdge(edges, source, target, sourceHandle) {
    // прибрати наявні ребра з цим source(+handle), тоді додати нове
    for (let k = edges.length - 1; k >= 0; k--) {
        if (edges[k].source === source && (sourceHandle ? edges[k].sourceHandle === sourceHandle : !edges[k].sourceHandle)) edges.splice(k, 1);
    }
    const id = 'e_' + source + '_' + target + (sourceHandle ? '_' + sourceHandle : '');
    if (!edges.find((e) => e.id === id)) edges.push({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
}

(async () => {
    const fd = await db.flowDefinition.findUnique({ where: { botId: BOT_ID } });
    if (!fd) { console.error('flowDefinition не знайдено для', BOT_ID); process.exit(1); }
    const nodes = JSON.parse(JSON.stringify(fd.nodes));
    const edges = JSON.parse(JSON.stringify(fd.edges));
    const before = JSON.stringify({ nodes, edges });

    // ── Ф0 біла нода ──
    upsertNode(nodes, 'n_create', { type: 'notifyAdmin' });

    // ── Ф1 памʼять ──
    upsertNode(nodes, 'n_order_intent', { data: {
        messagesTemplate: '{{conversationHistory}}',
        systemPrompt: 'Клієнт уже обрав товар, розмір і колір. Єдина задача — зрозуміти, чи він готовий оформити замовлення.\nВідповідай МАКСИМУМ одним коротким реченням.\nВАЖЛИВО: якщо це коротка відповідь на попереднє питання/нагадування («так», «да», «хочу», «оформляй», «+», «ок», «давайте») — це ГОТОВНІСТЬ, НЕ жарт. Дивись історію листування вище, щоб зрозуміти контекст.\nЗАВЖДИ додай у json_output рівно один JSON: {"ready":"yes"} — якщо погоджується/підтверджує; {"ready":"no"} — якщо вагається чи відмовляється.\nКАТЕГОРИЧНО не згадуй сайтів, кошиків, посилань — оформлення повністю веде цей чат далі.',
    } });
    upsertNode(nodes, 'n_pay_collect', { data: { messagesTemplate: '{{conversationHistory}}' } });
    // петля нагадування: після ненавʼязливого нагадування чекаємо відповідь у order_intent
    setEdge(edges, 'n_followup_msg', 'n_order_intent');

    // ── Ф2 orderRef у n_pay_amount ──
    upsertNode(nodes, 'n_pay_amount', { data: {
        code: "var method=(context.paymentInfo&&context.paymentInfo.method)||'cod'; var full=(context.product&&context.product.price)||0; var ref=String(context.orderRef||'').trim(); if(!ref){ ref=('GOV'+((Number((user&&user.telegramId)||0)).toString(36).slice(-4)+Date.now().toString(36).slice(-4))).toUpperCase(); } return { payAmount: method==='cod'?200:full, payLabel: method==='cod'?'передоплата 200 грн, решта при отриманні':'повна оплата', orderRef: ref };",
    } });

    // ── Ф2 ibanoplata create link ──
    upsertNode(nodes, 'n_iban_invoice', { type: 'connector', position: { x: 320, y: 3300 }, data: {
        label: '11. Створити посилання (ibanoplata)', connectorType: 'ibanoplata', action: 'create_invoice',
        amount: '{{context.payAmount}}', paymentPurpose: 'Оплата за товар {{context.orderRef}}', outputVar: 'context.ibanPayUrl',
    } });

    // ── Ф2 повідомлення з посиланням + реквізитами (замість заглушки, зводить осиротілі ноди) ──
    upsertNode(nodes, 'n_requisites', { type: 'message', data: {
        label: '11. Оплата: посилання + реквізити', buttons: [[{ text: '💳 Оплатити онлайн', url: '{{context.ibanPayUrl}}' }]],
        text: 'Готово! 🎉 Оплатити можна двома способами:\n\n1️⃣ Кнопкою нижче — посилання на оплату за IBAN 👇\n\n2️⃣ Або вручну за реквізитами:\n' + FOP_NAME + '\nIBAN: ' + FOP_IBAN + '\nЄДРПОУ/ІПН: ' + FOP_CODE + '\n📌 У коментарі до платежу вкажіть: {{context.orderRef}}\n\nСума до оплати: {{context.payAmount}} грн ({{context.payLabel}}).\nПісля оплати надішліть, будь ласка, чек/скріншот або посилання на квитанцію 🙏',
    } });

    // ── Ф2 виписка Mono + звірка + гілки ──
    upsertNode(nodes, 'n_mono_fetch', { type: 'connector', position: { x: 320, y: 3760 }, data: {
        label: '12.7 Виписка Mono', connectorType: 'monobank', action: 'get_statement', windowHours: '48', outputVar: 'context.monoStatement',
    } });
    upsertNode(nodes, 'n_reconcile', { type: 'js', position: { x: 320, y: 3860 }, data: { label: '12.8 Звірка оплати', code: RECONCILE_CODE } });
    upsertNode(nodes, 'n_pay_status_cond', { type: 'condition', position: { x: 320, y: 3960 }, data: {
        label: '12.9 Оплату знайдено?', condition: "context.payStatus === 'confirmed'",
    } });
    upsertNode(nodes, 'n_del_invoice', { type: 'connector', position: { x: 120, y: 4080 }, data: {
        label: '12.95 Видалити посилання', connectorType: 'ibanoplata', action: 'delete_invoice', invoiceUid: '{{context.ibanInvoiceUid}}',
    } });
    upsertNode(nodes, 'n_pay_notfound_admin', { type: 'notifyAdmin', position: { x: 640, y: 4080 }, data: {
        label: '12.96 Не знайдено — сигнал', targetKey: 'ADMIN_TELEGRAM_ID',
        message: '⚠️ Клієнт каже, що оплатив, але оплату НЕ знайдено у виписці.\nКлієнт: {{user.username}} ({{context.senderName}})\nЗамовлення: {{context.orderRef}} | сума {{context.payAmount}} грн\nТовар: {{context.product.name}} / {{context.recommendedSize}} / {{context.colorChoice.color}}\nПеревір вручну.',
    } });
    upsertNode(nodes, 'n_pay_notfound_msg', { type: 'message', position: { x: 640, y: 4180 }, data: {
        label: '12.97 Клієнту: перевіряємо', text: 'Дякуємо! Перевіряємо оплату вручну — це може зайняти трохи часу. Щойно підтвердимо, одразу напишемо і оформимо відправку 🙏',
    } });

    // ── ребра гілки оплати ──
    setEdge(edges, 'n_pay_amount', 'n_iban_invoice');
    setEdge(edges, 'n_iban_invoice', 'n_requisites');
    setEdge(edges, 'n_requisites', 'n_collect');
    setEdge(edges, 'n_collect', 'n_mono_fetch');
    setEdge(edges, 'n_mono_fetch', 'n_reconcile');
    setEdge(edges, 'n_reconcile', 'n_pay_status_cond');
    setEdge(edges, 'n_pay_status_cond', 'n_del_invoice', 'true');
    setEdge(edges, 'n_del_invoice', 'n_crm_order');
    setEdge(edges, 'n_pay_status_cond', 'n_pay_notfound_admin', 'false');
    setEdge(edges, 'n_pay_notfound_admin', 'n_pay_notfound_msg');
    setEdge(edges, 'n_pay_notfound_msg', 'n_crm_order');
    // n_crm_order → n_create → n_confirm лишаються як були

    // ── Ф5 прибрати осиротілі ноди реквізитів ──
    ['n_iban', 'n_edrpou', 'n_company', 'n_pay_instr'].forEach((id) => removeNode(nodes, edges, id));

    const after = JSON.stringify({ nodes, edges });
    console.log('nodes:', nodes.length, '| edges:', edges.length, '| змінено:', before !== after);
    console.log('payment branch:', edges.filter((e) => /n_pay_amount|n_iban_invoice|n_requisites|n_collect|n_mono_fetch|n_reconcile|n_pay_status_cond|n_del_invoice|n_pay_notfound/.test(e.source + e.target)).map((e) => `${e.source}-${e.sourceHandle || ''}->${e.target}`).join('\n  '));

    if (!APPLY) { console.log('\nDRY-RUN. Для запису: node patch-covercar-payments.js --apply'); process.exit(0); }

    // бекап + запис + ключі
    const fs = require('fs');
    fs.writeFileSync(`_backup_flow_${BOT_ID}_${Date.now()}.json`, JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
    await db.flowDefinition.update({ where: { botId: BOT_ID }, data: { nodes, edges } });
    const upKey = async (key, value) => {
        const ex = await db.funnelKey.findFirst({ where: { botId: BOT_ID, key } });
        if (ex) await db.funnelKey.update({ where: { id: ex.id }, data: { value } });
        else await db.funnelKey.create({ data: { botId: BOT_ID, key, value } });
    };
    await upKey('FOP_IBAN', FOP_IBAN);
    await upKey('FOP_CODE', FOP_CODE);
    await upKey('FOP_NAME', FOP_NAME);
    await upKey('GEMINI_CONNECTOR_ID', GEMINI_CONNECTOR_ID);
    console.log('✅ Записано + бекап збережено + ключі оновлено.');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
