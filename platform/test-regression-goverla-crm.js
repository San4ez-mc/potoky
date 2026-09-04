'use strict';
/* Регресійні тести goverla CRM-клону (fcdee415) — кожен тест = знайдений аудитом 2026-09-03 баг.
   Працює БЕЗ БД і без Claude-ключа: трансформує дамп get_funnel патчем і перевіряє структуру,
   плюс ганяє js-ноди (n_calc/n_pay_amount/n_reconcile/n_avail) з фейковим контекстом.
   ЗАПУСК: node test-regression-goverla-crm.js <funnel-dump.json>
           (дамп — JSON get_funnel; після --apply можна зняти новий дамп і прогнати ще раз:
            патч тоді поверне alreadyApplied і тести підуть по дампу як є) */
const fs = require('fs');
const path = require('path');
const { transform, refresh, optsForBot } = require('./patch-goverla-crm-audit-2026-09-04.js');

const dumpPath = process.argv[2];
if (!dumpPath) { console.log('usage: node test-regression-goverla-crm.js <dump.json>'); process.exit(2); }
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
const keysMap = Object.fromEntries((dump.keys || []).map((k) => [k.key, k.value]));
const botOpts = optsForBot(dump.bot && dump.bot.id);
console.log('BOT:', dump.bot && dump.bot.id, dump.bot && dump.bot.name, '| keepCarText=' + botOpts.keepCarText);
let r = transform({ nodes: dump.nodes, edges: dump.edges }, keysMap, botOpts);
if (r.alreadyApplied) { const rr = refresh({ nodes: dump.nodes, edges: dump.edges }, botOpts); r = { nodes: rr.nodes, edges: rr.edges, keyUpdates: rr.keyUpdates || [], keyDeletes: [], notes: ['(дамп уже з патчем → перевіряємо --refresh)'].concat(rr.notes) }; }
const nodes = r.nodes, edges = r.edges;
const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
const results = [];
const ok = (id, name, pass, info) => { results.push({ id, name, pass: !!pass, info }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ' ' + name + (info ? ('  — ' + info) : '')); };
const branch = (id, h) => (edges.find((e) => e.source === id && (e.sourceHandle || null) === h) || {}).target;
const next = (id) => (edges.find((e) => e.source === id && !e.sourceHandle) || {}).target;
const warn = r.notes.filter((n) => n.startsWith('⚠️'));
ok('S-00', 'патч без попереджень', warn.length === 0, warn.join(' | '));

console.log('\n===== СТРУКТУРНІ =====');
const indeg = {}, outdeg = {};
nodes.forEach((n) => { indeg[n.id] = 0; outdeg[n.id] = 0; });
const badEdges = edges.filter((e) => !byId[e.source] || !byId[e.target]);
ok('S-01', 'ребра лише між існуючими нодами', badEdges.length === 0, badEdges.map((e) => e.source + '→' + e.target).join(','));
edges.forEach((e) => { if (outdeg[e.source] != null) outdeg[e.source]++; if (indeg[e.target] != null) indeg[e.target]++; });
const ENTRY = ['start_1', 'n_comment_entry', 'n_prev_match_snapshot', 'n_mono_fetch', 'n_intl_route'];
const orphans = nodes.filter((n) => !ENTRY.includes(n.id) && indeg[n.id] === 0 && outdeg[n.id] === 0).map((n) => n.id);
ok('S-02', 'нема осиротілих нод', orphans.length === 0, orphans.join(','));
const seen = new Set(); const stack = ['start_1', 'n_comment_entry', 'n_prev_match_snapshot', 'n_mono_fetch', 'n_intl_route'];
while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); edges.filter((e) => e.source === id).forEach((e) => stack.push(e.target)); }
const unreach = nodes.map((n) => n.id).filter((id) => !seen.has(id));
ok('S-03', 'усі ноди досяжні зі входів', unreach.length === 0, unreach.join(','));
const condBad = nodes.filter((n) => n.type === 'condition' && (!branch(n.id, 'true') || !branch(n.id, 'false'))).map((n) => n.id);
ok('S-04', 'у кожної condition обидві гілки', condBad.length === 0, condBad.join(','));
const ALLOWED_TERMINAL = new Set(['n_unknown_stop', 'n_comment_unknown_silent', 'n_size_oor_stop', 'n_intl_unsupported_stop', 'n_crm_order_failed_stop', 'n_declined_msg', 'n_welcome_back_clear', 'n_post_order_admin', 'n_upsell2_wait', 'n_avail_stock_stop', 'n_comment_entry']);
const terminals = nodes.filter((n) => outdeg[n.id] === 0).map((n) => n.id);
const badTerm = terminals.filter((t) => !ALLOWED_TERMINAL.has(t));
ok('S-05', 'термінальні ноди лише свідомі', badTerm.length === 0, badTerm.join(','));
const fanout = nodes.filter((n) => n.type !== 'condition' && outdeg[n.id] > 1).map((n) => n.id);
ok('S-06', 'нема fan-out (>1 ребра) поза condition', fanout.length === 0, fanout.join(','));
const cells = {}; const overlaps = [];
nodes.forEach((n) => { const k = Math.round(n.position.x / 360) + ':' + Math.round(n.position.y / 200); if (cells[k]) overlaps.push(cells[k] + '~' + n.id); cells[k] = n.id; });
ok('S-07', 'ноди не накладаються (сітка 360×200)', overlaps.length === 0, overlaps.join(','));
['n_followup_wait', 'n_followup_guard', 'n_followup_msg', 'n_upsell_msg', 'n_ttn_client', 'n_final'].forEach((id) => ok('S-08', 'видалено ' + id, !byId[id]));

console.log('\n===== КРИТИЧНІ ГІЛКИ =====');
ok('K1a', 'n_create → гейт оплати', next('n_create') === 'n_supplier_pay_gate', next('n_create'));
ok('K1b', 'гейт[true] → постачальник, [false] → hold', branch('n_supplier_pay_gate', 'true') === 'n_supplier_route' && branch('n_supplier_pay_gate', 'false') === 'n_supplier_hold');
ok('K1c', 'hold → n_confirm_prep → n_confirm → n_fs5 → n_upsell2_wait', next('n_supplier_hold') === 'n_confirm_prep' && next('n_confirm_prep') === 'n_confirm' && next('n_confirm') === 'n_fs5' && next('n_fs5') === 'n_upsell2_wait');
ok('K1d', 'після n_upsell2_wait нема нагадування', outdeg.n_upsell2_wait === 0);
ok('K2a', 'n_del_invoice → адреса є? → n_crm_order / n_collect_ask → n_collect', next('n_del_invoice') === 'n_has_address_cond' && branch('n_has_address_cond', 'true') === 'n_crm_order' && branch('n_has_address_cond', 'false') === 'n_collect_ask' && next('n_collect_ask') === 'n_collect');
ok('V2a', 'n_collect_ask показує payConfirmedLine (ставить n_reconcile)', /payConfirmedLine/.test(byId.n_collect_ask.data.text) && /payConfirmedLine/.test(byId.n_reconcile.data.code));
ok('K2b', 'n_pay_notfound_msg → адреса є?', next('n_pay_notfound_msg') === 'n_has_address_cond');
ok('K2c', 'n_crm_order без телефону дає явну причину', /crmOrderError: 'адресу\/телефон/.test(byId.n_crm_order.data.code));
ok('K2d', 'n_reconcile не звіряє двічі', /payStatus === 'confirmed' && context\.payTxId/.test(byId.n_reconcile.data.code));
ok('K3a', 'n_np_gate[false] → перевірка "вже оплачено/0 грн"', branch('n_np_gate', 'false') === 'n_pay_check_cond' && branch('n_pay_check_cond', 'true') === 'n_has_address_cond' && branch('n_pay_check_cond', 'false') === 'n_mono_fetch');
ok('K3b', 'n_np_gate[true] → n_np_ask (детерміноване уточнення) → n_collect', branch('n_np_gate', 'true') === 'n_np_ask' && next('n_np_ask') === 'n_collect' && /np\.askMsg/.test(byId.n_np_ask.data.text));
ok('K4a', 'n_order_cond[false] → відмова без нагадування', branch('n_order_cond', 'false') === 'n_declined_msg' && outdeg.n_declined_msg === 0);
ok('K4b', 'n_fs5 не веде у wait', !edges.some((e) => e.source === 'n_fs5' && /followup/.test(e.target)));
ok('K5a', 'brewdrop без sd[0] / ba[0]', !/\|\|sd\[0\]|\|\|ba\[0\]/.test(byId.n_supplier_order.data.code));
ok('K5b', 'easydrop без cityOpts[0]/whOpts[0] і без будь-якого розміру', ['n_supplier_order_ed', 'n_supplier_order_cart'].every((id) => !/cityOpts\[0\]|whOpts\[0\]/.test(byId[id].data.code) && /__availLabels/.test(byId[id].data.code)));
ok('K6a', 'n_calc без дефолту M і без фолбеку S/M/L/XL', !/size = 'M'/.test(byId.n_calc.data.code) && !/\['S','M','L','XL'\]/.test(byId.n_calc.data.code));
ok('K6b', 'n_size_reply бере текст із n_calc', /sizeReplyText/.test(byId.n_size_reply.data.text) && (byId.n_size_reply.data.variants || []).length === 0);

console.log('\n===== ВИСОКІ =====');
ok('V7a', 'n_welcome_back — claude з json stillInterested', byId.n_welcome_back.type === 'claude' && /stillInterested/.test(byId.n_welcome_back.data.systemPrompt) && byId.n_welcome_back.data.outputVar === 'welcomeBack');
ok('V7b', 'welcome_back → cond → n_is_set / clear', next('n_welcome_back') === 'n_welcome_back_cond' && branch('n_welcome_back_cond', 'true') === 'n_is_set' && branch('n_welcome_back_cond', 'false') === 'n_welcome_back_clear');
ok('V7c', 'n_lookup → post_order_cond → returning_check', next('n_lookup') === 'n_post_order_cond' && branch('n_post_order_cond', 'false') === 'n_returning_check' && branch('n_post_order_cond', 'true') === 'n_post_order_msg');
ok('V8a', 'speakFirst на n_order_intent / n_welcome_back; n_collect реактивна (Sonnet)', ['n_order_intent', 'n_welcome_back'].every((id) => byId[id].data.speakFirst === true) && byId.n_collect.data.speakFirst === false && byId.n_collect.data.connectorId === '2ec53ba5-144e-463b-9758-c217c4a69b0e');
ok('V2b', 'прохання про адресу детерміноване (addressAskLine з n_pay_amount) у n_requisites / n_req_sum / n_trust_confirm_msg', ['n_requisites', 'n_req_sum', 'n_trust_confirm_msg'].every((id) => /\{\{context\.addressAskLine\}\}/.test(byId[id].data.text) && (byId[id].data.variants || []).every((v) => /\{\{context\.addressAskLine\}\}/.test(v))) && /addressAskLine/.test(byId.n_pay_amount.data.code));
ok('V2c', 'n_collect не пише реквізити/посилання сама', /НІКОЛИ не пишеш, не повторюєш і не вигадуєш/.test(byId.n_collect.data.systemPrompt));
ok('V2d', 'n_color: колір → лише json; артикул у промптах n_size/n_color; правило "подумаю"', /ТІЛЬКИ json_output \{"color"/.test(byId.n_color.data.systemPrompt) && ['n_size', 'n_color'].every((id) => /артикул \{\{context\.product\.sku\}\}/.test(byId[id].data.systemPrompt) && /клієнт відкладає/.test(byId[id].data.systemPrompt)));
ok('V2e', 'n_order_intent: згода/відмова → лише json', /ТІЛЬКИ json_output \{"ready":"yes"\} БЕЗ жодного тексту/.test(byId.n_order_intent.data.systemPrompt));
ok('V2f', 'один допродаж (узгоджено з n_pay_amount/n_crm_order) + заголовок презентації', /upsell\.length < 1/.test(byId.n_lookup.data.code) && /заголовок з назвою і ціною/.test(byId.n_lookup.data.code));
ok('V3a', 'n_size: параметри в першому повідомленні не перепитуються (waitAfterPresentationUnless), фото не скидає товар', typeof byId.n_size.data.waitAfterPresentationUnless === 'string' && new RegExp(byId.n_size.data.waitAfterPresentationUnless, 'i').test('Чорний колір Параметри 182/100') && new RegExp(byId.n_size.data.waitAfterPresentationUnless, 'i').test('яка ціна кофти Параметри ріст 167 Вага 75 кг') && !new RegExp(byId.n_size.data.waitAfterPresentationUnless, 'i').test('Як замовити кофту?') && ['n_size', 'n_color', 'n_set_choice'].every((id) => byId[id].data.keepProductOnImage === true));
ok('V3b', 'n_size: метри→см, колір у json; n_calc фіксує колір із кроку розміру', /зріст у метрах/.test(byId.n_size.data.systemPrompt) && /"color":"<колір як у списку>"/.test(byId.n_size.data.systemPrompt) && /__colorPick/.test(byId.n_calc.data.code));
ok('V3c', 'адреса наперед: n_order_cond[true] → n_order_prefill → n_pay', branch('n_order_cond', 'true') === 'n_order_prefill' && next('n_order_prefill') === 'n_pay' && /"prefill"/.test(byId.n_order_intent.data.systemPrompt));
ok('V3d', 'кількість/нотатка допродажу наскрізно (prompt → n_pay_amount → n_crm_order)', /upsellQty/.test(byId.n_order_intent.data.systemPrompt) && /upsellQty/.test(byId.n_pay_amount.data.code) && /upsellNote/.test(byId.n_crm_order.data.code) && /qtyPrices: __cq/.test(byId.n_lookup.data.code));
ok('V3e', 'умови в підсумку (ORDER_TERMS_LINE) + слово «Оформляємо» обовʼязкове', /ORDER_TERMS_LINE/.test(byId.n_order_intent.data.systemPrompt) && /ОБОВʼЯЗКОВО містить слово «Оформляємо»/.test(byId.n_order_intent.data.systemPrompt) && (r.keyUpdates || []).some((k) => k.key === 'ORDER_TERMS_LINE'));
ok('V3f', 'n_welcome_back передає повідомлення далі (keepUserMessageOnExit)', byId.n_welcome_back.data.keepUserMessageOnExit === true);
ok('V3g', 'askManager замість handoff на невідомі питання + SHOP_FAQ у промптах і ключах', ['n_size', 'n_color', 'n_set_choice', 'n_order_intent'].every((id) => /askManager/.test(byId[id].data.systemPrompt) && /SHOP_FAQ/.test(byId[id].data.systemPrompt)) && !/поза твоїми даними \(гарантія, доставка за кордон, нестандартна оплата, знижки, претензія\) — НЕ вигадуй: поверни json_output \{"handoff"/.test(byId.n_color.data.systemPrompt) && (r.keyUpdates || []).some((k) => k.key === 'SHOP_FAQ' && k.value.length > 50));
// Кожне видиме повідомлення закінчується питанням або чітким кроком (стандарт §3.4)
const CTA_RE = /\?\s*[^\wа-яіїєґ]*$|напиш|скиньт|підкаж|оберіть|надішл|скопіюй|натисн|можна написати|чекаю|повідом|підтверд|оформля|перевір|звірим|надійде|підкажу|допоможу|поруч|напишіть/i;
// Свідомі винятки: n_welcome/n_size_reply/n_np_ask — текст цілком з плейсхолдерів (followUpQuestion/sizeReplyText/
// np.askMsg самі містять питання); n_req_* — фрагменти реквізитів для копіювання, CTA у n_req_sum;
// n_intl_unsupported_msg — термінальний handoff ("покличу менеджера").
const CTA_EXEMPT = new Set(['n_welcome', 'n_size_reply', 'n_np_ask', 'n_req_sum', 'n_trust_confirm_msg', 'n_req_manual', 'n_req_iban_l', 'n_req_iban_v', 'n_req_code_l', 'n_req_code_v', 'n_req_ref_l', 'n_req_ref_v', 'n_req_name_l', 'n_req_name_v', 'n_intl_unsupported_msg']);
const noCta = nodes.filter((n) => n.type === 'message' && !CTA_EXEMPT.has(n.id)).filter((n) => { const texts = [n.data.text].concat(n.data.variants || []).filter(Boolean); return texts.some((t) => !CTA_RE.test(String(t).replace(/\{\{[^}]+\}\}/g, ' ').trim())); }).map((n) => n.id);
ok('M1', 'кожна message-нода закінчується питанням/наступним кроком', noCta.length === 0, noCta.join(','));
ok('V8b', 'n_avail_cond[true] → n_order_intent (допродаж у першому повідомленні)', branch('n_avail_cond', 'true') === 'n_order_intent' && /ДОПРОДАЖ/.test(byId.n_order_intent.data.systemPrompt));
ok('V8c', 'n_size_photo має підпис із наступним кроком', /зріст і вагу/.test(byId.n_size_photo.data.caption || ''));
ok('V8d', 'n_collect знає статус оплати та уточнення НП', /payStatus/.test(byId.n_collect.data.systemPrompt) && /np\.askMsg/.test(byId.n_collect.data.systemPrompt));
ok('V10', 'n_pay_collect: softHandoffOff', byId.n_pay_collect.data.softHandoffOff === true);
ok('V11', 'сигнал про невідомий товар раз на сесію', branch('n_unknown_notify_gate', 'true') === 'n_unknown_once_cond' && next('n_unknown_admin') === 'n_unknown_mark' && next('n_unknown_mark') === 'n_unknown_stop');
ok('V12a', 'matchNote у промптах замість "ОДНОЗНАЧНО"', ['n_size', 'n_color', 'n_set_choice', 'n_order_intent', 'n_welcome_back'].every((id) => /\{\{context\.product\.matchNote\}\}/.test(byId[id].data.systemPrompt)) && !nodes.some((n) => /ОДНОЗНАЧНО підтверджено системою за артикулом\/кодом, який назвав/.test(n.data.systemPrompt || '')));
ok('V12b', 'n_lookup рахує matchNote/productMismatch і фолбек презентації', /matchNote: __matchNote/.test(byId.n_lookup.data.code) && /productMismatch/.test(byId.n_lookup.data.code) && /if \(!__descClean\)/.test(byId.n_lookup.data.code));
ok('S15a', botOpts.keepCarText ? 'covercar: текст про авто збережено' : 'нема тексту про авто/салон', botOpts.keepCarText === nodes.some((n) => /авто\/модель|весь салон|сидіння/i.test(n.data.systemPrompt || '')));
ok('D3', 'n_size: waitAfterPresentation + презентація сама питає параметри', byId.n_size.data.waitAfterPresentation === true && /__paramAsk/.test(byId.n_lookup.data.code));
ok('D2', 'ручні реквізити з активного ФОП (context.fop)', ['n_req_iban_v', 'n_req_code_v', 'n_req_name_v'].every((id) => /context\.fop\./.test(byId[id].data.text)) && /\/fops/.test(byId.n_pay_amount.data.code) && /context\.fop/.test(byId.n_reconcile.data.code));
ok('D1', 'n_collect вміє paymentMethodChange (перевипуск інвойсу в двигуні) + regex-детект', /paymentMethodChange/.test(byId.n_collect.data.systemPrompt) && byId.n_collect.data.detectPaymentChange === true);
ok('D5', 'n_color приймає явний розмір клієнта, n_avail переписує', /"size":"<РОЗМІР>"/.test(byId.n_color.data.systemPrompt) && /sizeOverride/.test(byId.n_avail.data.code));
ok('D6', 'n_requisites називає суму', /До сплати зараз/.test(byId.n_requisites.data.text) && (byId.n_requisites.data.variants || []).every((v) => /До сплати зараз/.test(v)));
ok('S16', 'n_confirm: confirmLead+ttnLine, без "акційної ціни"', /confirmLead/.test(byId.n_confirm.data.text) && /ttnLine/.test(byId.n_confirm.data.text) && !nodes.some((n) => /акційною ціною/.test(JSON.stringify(n.data))));
ok('S19a', 'n_pay: рядок про закордон у всіх варіантах', (byId.n_pay.data.variants || []).every((v) => /за кордон/.test(v)));
ok('S19b', 'n_pay_collect: country лише з method', /Ніколи не повертай JSON лише з country/.test(byId.n_pay_collect.data.systemPrompt));
ok('S24', 'Haiku на простих нодах', ['n_pay_collect', 'n_recall_confirm', 'n_upsell2_wait', 'n_welcome_back'].every((id) => byId[id].data.connectorId === '4a8000aa-837f-4a73-bf5c-224949ebaf9a'));
ok('S25a', 'DRY_RUN=1', (r.keyUpdates || []).filter((k) => /DRY_RUN/.test(k.key)).every((k) => k.value === '1'));
ok('AV1', 'n_avail_cond[false] → вид відсутності → менеджер / інший колір', branch('n_avail_cond', 'false') === 'n_avail_kind_cond' && branch('n_avail_kind_cond', 'true') === 'n_avail_stock_msg' && branch('n_avail_kind_cond', 'false') === 'n_avail_no');
const claudeBad = nodes.filter((n) => n.type === 'claude' && !(n.data.systemPrompt || '').trim()).map((n) => n.id);
ok('CL1', 'усі claude-ноди мають промпт', claudeBad.length === 0, claudeBad.join(','));
const notifyBad = nodes.filter((n) => n.type === 'notifyTg' && n.data.targetKey !== 'ADMIN_TELEGRAM_ID').map((n) => n.id);
ok('NT1', 'усі notifyTg → ADMIN_TELEGRAM_ID', notifyBad.length === 0, notifyBad.join(','));
const budget = nodes.filter((n) => n.type === 'claude' && String(n.data.systemPrompt || '').length > 12000).map((n) => n.id + ':' + n.data.systemPrompt.length);
ok('CL2', 'промпти ≤12K символів', budget.length === 0, budget.join(','));

console.log('\n===== ПОВЕДІНКА JS-НОД =====');
async function runNode(id, context, extra) {
    const code = byId[id].data.code;
    const fn = new Function('context', 'user', 'session', 'input', 'keys', 'fetch', 'Buffer', 'FormData', 'Blob', 'console', 'crypto', 'notifyBalanceIssue', 'return (async()=>{' + code + '\n})()');
    const fetchStub = async () => { throw new Error('no network in test'); };
    return fn(context, (extra && extra.user) || {}, {}, (extra && extra.input) || '', Object.assign({ SIZE_CHART: keysMap.SIZE_CHART, SHOP_TAG: 'goverla_shop', FOP_IBAN: 'UA1', FOP_CODE: '123' }, (extra && extra.keys) || {}), fetchStub, Buffer, FormData, Blob, console, require('crypto'), () => {});
}
(async () => {
    const prodHW = { categoryId: 'c1', categoryParams: [{ name: 'Зріст' }, { name: 'Вага' }], categoryParamsIsHeightWeight: true, colors: 'чорний, сірий', sizes: ['S', 'M', 'L'] };
    let x = await runNode('n_calc', { testMode: true, product: prodHW, sizeInput: { height: 178, weight: 72 } });
    ok('B-C1', 'n_calc 178/72 → M за сіткою', x.recommendedSize === 'M' && x.sizeSource === 'chart' && /M/.test(x.sizeReplyText) && /колір/.test(x.sizeColorFollowup), JSON.stringify([x.recommendedSize, x.sizeSource]));
    x = await runNode('n_calc', { testMode: true, product: prodHW, sizeInput: { height: 100, weight: 180 } });
    ok('B-C2', 'n_calc "100 180" → міняє місцями, не ескалює', x.sizeOutOfRange === false && x.recommendedSize, JSON.stringify(x.recommendedSize));
    const prodShoe = { categoryId: 'c2', categoryParams: [{ name: 'Розмір ноги' }], categoryParamsIsHeightWeight: false, colors: '', sizes: ['40', '41', '42'] };
    x = await runNode('n_calc', { testMode: true, product: prodShoe, sizeInput: { clothingSize: '42' } });
    ok('B-C3', 'взуття 42 (є в наявності) → 42, не "S"', x.recommendedSize === '42' && x.sizeSource === 'client' && /Записала|беремо|Зафіксувала/.test(x.sizeReplyText), JSON.stringify([x.recommendedSize, x.sizeReplyText]));
    x = await runNode('n_calc', { testMode: true, product: { ...prodShoe, sizes: ['40', '41'] }, sizeInput: { clothingSize: '42' } });
    ok('B-C4', 'взуття 42 (нема) → ескалація, не перший розмір', x.sizeOutOfRange === true && /42/.test(x.sizeOorReason), x.sizeOorReason);
    x = await runNode('n_calc', { testMode: true, product: { ...prodShoe, sizes: [] }, sizeInput: { clothingSize: '42' } });
    ok('B-C5', 'взуття 42 без sizes у CRM → приймаємо як є', x.recommendedSize === '42' && !x.sizeOutOfRange);
    x = await runNode('n_calc', { testMode: true, product: { ...prodHW, sizes: ['46', '48', '50'] }, sizeInput: { height: 178, weight: 72 } });
    ok('B-C6', 'зріст/вага + числова сітка товару → ескалація (не перший розмір)', x.sizeOutOfRange === true && /числова/.test(x.sizeOorReason), x.sizeOorReason);
    x = await runNode('n_calc', { testMode: true, product: { ...prodHW, sizes: ['S', 'L'] }, sizeInput: { height: 178, weight: 72 } });
    ok('B-C7', 'M нема, є S/L → найближчий літерний', ['S', 'L'].includes(x.recommendedSize) && !x.sizeOutOfRange, x.recommendedSize);
    x = await runNode('n_calc', { testMode: true, product: prodHW, sizeInput: { height: 230, weight: 72 } });
    ok('B-C8', 'зріст 230 → поза сіткою', x.sizeOutOfRange === true);
    x = await runNode('n_calc', { testMode: true, product: prodHW, sizeInput: { clothingSize: 'XL' } });
    ok('B-C9', 'клієнт наполіг на XL, у товарі S/M/L → ескалація з причиною', x.sizeOutOfRange === true && /XL/.test(x.sizeOorReason), x.sizeOorReason);

    x = await runNode('n_pay_amount', { paymentInfo: { method: 'cod' }, product: { price: 1500 }, psid: '123456', igUsername: 'user1' }, { user: {} });
    ok('B-P1', 'orderRef із SHOP_TAG (GOV…), без NaN, orderRefAt', /^GOV[0-9A-Z]{8}$/.test(x.orderRef) && !/NAN/.test(x.orderRef) && x.orderRefAt > 0 && x.payAmount === 200, x.orderRef);
    x = await runNode('n_pay_amount', { paymentInfo: { method: 'cod_trust' }, product: { price: 1500 }, orderRef: 'GOVAAAA1111', orderRefAt: 5 }, { user: {} });
    ok('B-P2', 'cod_trust → 0 грн, існуючий ref збережено', x.payAmount === 0 && x.orderRef === 'GOVAAAA1111' && x.orderRefAt === 5);
    x = await runNode('n_pay_amount', { paymentInfo: { method: 'full' }, product: { price: 1500, qtyPrices: { '2': 2700 } }, orderIntent: { qty: 2 } }, { user: {} });
    ok('B-P3', 'full ×2 з акцією → 2700', x.payAmount === 2700 && x.orderQty === 2);
    x = await runNode('n_pay_amount', { paymentInfo: { method: 'full' }, product: { price: 1279, upsellItems: [{ id: 'u', name: 'Футболка', price: 898 }] }, orderIntent: { addUpsell: true } }, { user: {} });
    ok('B-P4', 'full + допродаж → 2177 (живий кейс 7944d0c6)', x.payAmount === 2177 && x.upsellSum === 898 && x.orderTotal === 2177, String(x.payAmount));
    x = await runNode('n_pay_amount', { paymentInfo: { method: 'cod' }, product: { price: 1279, upsellItems: [{ id: 'u', name: 'Футболка', price: 898 }] }, orderIntent: { addUpsell: true } }, { user: {} });
    ok('B-P5', 'cod + допродаж → 200 зараз, решта 1977 у payLabel, fop із funnelKey-фолбеку', x.payAmount === 200 && /1977/.test(x.payLabel) && x.fop && x.fop.iban === 'UA1' && x.fop.source === 'funnelKey', x.payLabel);
    x = await runNode('n_avail', { product: { sizes: ['S', 'M', 'L', 'XL'], offers: [] }, colorChoice: { color: 'чорний', size: 'l' }, recommendedSize: 'XL' });
    ok('B-A5', 'клієнт назвав L на кроці кольору → recommendedSize L (було XL)', x.available === true && x.recommendedSize === 'L' && x.sizeSource === 'client', JSON.stringify(x));
    x = await runNode('n_avail', { product: { sizes: ['S', 'M'], offers: [] }, colorChoice: { color: 'чорний', size: 'XXL' }, recommendedSize: 'M' });
    ok('B-A6', 'названий розмір поза сіткою товару → ігноруємо, лишаємо M', x.recommendedSize === undefined);

    const nowSec = Math.floor(Date.now() / 1000);
    const stmt = [{ id: 't_old', amountUah: 200, time: nowSec - 7200, comment: '' }, { id: 't_new', amountUah: 200, time: nowSec - 60, comment: '' }];
    const recBase = { orderRef: 'GOVX', payAmount: 200, orderRefAt: (nowSec - 600) * 1000, monoStatement: stmt };
    x = await runNode('n_reconcile', { ...recBase, lastUserMessage: 'ось адреса' });
    ok('B-R1', 'адреса без слів про оплату → чужі 200 грн НЕ зараховуємо', x.payStatus === 'not_found', x.payStatus);
    x = await runNode('n_reconcile', { ...recBase, lastUserMessage: 'оплатив' });
    ok('B-R2', '"оплатив" + один платіж після orderRefAt → confirmed саме ним', x.payStatus === 'confirmed' && x.payTxId === 't_new', JSON.stringify([x.payStatus, x.payTxId]));
    x = await runNode('n_reconcile', { ...recBase, lastUserMessage: 'оплатив', monoStatement: stmt.concat([{ id: 't_new2', amountUah: 200, time: nowSec - 30, comment: '' }]) });
    ok('B-R3', '"оплатив" + два кандидати → not_found (ручна перевірка)', x.payStatus === 'not_found');
    x = await runNode('n_reconcile', { ...recBase, lastUserMessage: 'адреса', monoStatement: stmt.concat([{ id: 't_ref', amountUah: 200, time: nowSec - 40, comment: 'Оплата GOVX' }]) });
    ok('B-R4', 'збіг за orderRef працює без слів про оплату', x.payStatus === 'confirmed' && x.payTxId === 't_ref');
    x = await runNode('n_reconcile', { ...recBase, payStatus: 'confirmed', payTxId: 't_prev', monoStatement: [] });
    ok('B-R5', 'уже підтверджена оплата не звіряється вдруге', x.payStatus === 'confirmed' && x.payTxId === 't_prev');

    x = await runNode('n_avail', { product: { offers: [{ properties: [{ name: 'Колір', value: 'чорний' }], quantity: 0 }, { properties: [{ name: 'Колір', value: 'сірий' }], quantity: 2 }] }, colorChoice: { color: 'чорний' } });
    ok('B-A1', 'облік ведеться, колір з quantity 0 → нема, unavailableColors', x.available === false && x.availReason === 'color' && x.unavailableColors[0] === 'чорний');
    x = await runNode('n_avail', { product: { offers: [{ properties: [{ name: 'Розмір', value: 'M' }], quantity: 0 }, { properties: [{ name: 'Розмір', value: 'L' }], quantity: 3 }] }, recommendedSize: 'M' });
    ok('B-A2', 'товар без кольорів, M quantity 0 (облік є) → no_stock', x.available === false && x.availReason === 'no_stock');
    x = await runNode('n_avail', { product: { offers: [{ properties: [{ name: 'Колір', value: 'чорний' }], quantity: 0 }, { properties: [{ name: 'Колір', value: 'сірий' }], quantity: 0 }] }, colorChoice: { color: 'чорний' } });
    ok('B-A7', 'CRM без обліку залишків (усі quantity 0) → товар вважаємо наявним', x.available === true, JSON.stringify(x));
    x = await runNode('n_avail', { product: { offers: [{ properties: [] }] } });
    ok('B-A3', 'offers без quantity → не блокуємо', x.available === true);
    x = await runNode('n_avail', { product: { offers: [{ properties: [{ name: 'Розмір', value: 'M' }], quantity: 3 }, { properties: [{ name: 'Розмір', value: 'L' }], quantity: 0 }] }, recommendedSize: 'L' });
    ok('B-A4', 'без кольору, розмір L quantity 0 → no_stock', x.available === false && x.availReason === 'no_stock');

    x = await runNode('n_confirm_prep', { payStatus: 'not_found', payAmount: 200, supplierTtn: '' });
    ok('B-CF1', 'confirm без оплати не каже "вже оформили"', !/вже його оформили/.test(x.confirmLead) && /ТТН\) надішлемо/.test(x.ttnLine));
    x = await runNode('n_confirm_prep', { payStatus: 'confirmed', payAmount: 200, supplierTtn: '20450012345678' });
    ok('B-CF2', 'confirm з ТТН → "вже в дорозі"', /в дорозі/.test(x.ttnLine) && /20450012345678/.test(x.ttnLine));

    const failed = results.filter((t) => !t.pass);
    console.log('\n===== ПІДСУМОК: ' + (results.length - failed.length) + '/' + results.length + ' PASS' + (failed.length ? ('; FAIL: ' + failed.map((t) => t.id).join(', ')) : '') + ' =====');
    const outPath = process.argv[3];
    if (outPath) { fs.writeFileSync(outPath, JSON.stringify({ nodes, edges }, null, 1)); console.log('трансформований флоу записано у', outPath); }
    process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.log('ERROR', e.message, e.stack); process.exit(1); });
