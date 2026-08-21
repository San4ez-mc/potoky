// Фікси за живою сесією Олексія (2026-08-21, order GOVWCE8VUQF):
// 1) Оплату питали ДВІЧІ: n_order_intent (useKb) відповідав на побічне "Передплата
//    потрібна?" ПОВНИМ нумерованим меню 1️⃣/2️⃣ (те саме, що потім формально показує
//    n_pay) -> клієнт відповів "Перший варіант", думаючи що вже обрав, а n_pay все
//    одно перепитав. Фікс: n_order_intent відповідає на такі питання коротко, БЕЗ
//    нумерованого меню (меню — виключно зона n_pay).
// 2) Реквізити вручну лилися СРАЗУ 8 повідомленнями одразу після лінку оплати,
//    хоча клієнт міг і не захотіти вручну. Фікс: n_requisites тепер лінк + коротка
//    пропозиція "напишіть — надішлемо реквізити" + прохання чека, і одразу веде в
//    n_collect (збір адреси). Реквізити вручну (n_req_manual...n_req_sum) лишаються
//    тими самими 8 нодами (окремі повідомлення для копіювання), але тепер це БІЧНА
//    гілка: n_collect розпізнає прохання "дай реквізити" (json {wantsManualReq:true})
//    -> condition n_collect_route -> n_req_manual -> ... -> назад у n_collect.
// 3) Бракувало назви компанії (ФОП) у реквізитах — додано n_req_name_l/n_req_name_v.
// 4) n_collect змушував давати по-батькові — тепер "Ім'я Прізвище" (2 слова) досить,
//    по-батькові не обов'язкове.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const BOT = 'cc03657f-9e72-46e5-a16d-88826e70c2ee';
const APPLY = process.argv.includes('--apply');
const NL = String.fromCharCode(10);

(async () => {
  const fd = await db.flowDefinition.findUnique({ where: { botId: BOT } });
  const nodes = JSON.parse(JSON.stringify(fd.nodes));
  const edges = JSON.parse(JSON.stringify(fd.edges));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const up = (id, patch) => { const n = byId[id]; if (!n) { console.log('❌ ' + id + ' NOT FOUND'); return false; } n.data = { ...(n.data || {}), ...patch }; return true; };

  // --- 1) n_order_intent: не дублювати меню оплати (шаблонована фраза — джерело
  //        істини для формулювання: migrate-payment-menu-nodup2.js, там же n_set_choice/n_color) ---
  const oi = byId.n_order_intent;
  if (oi) {
    const marker = 'НІКОЛИ не показуй нумероване меню';
    if (!String(oi.data.systemPrompt || '').includes(marker)) {
      oi.data.systemPrompt = String(oi.data.systemPrompt || '')
        + NL + 'Якщо клієнт питає про СПОСІБ оплати (передоплата/накладений/скільки зараз платити/"як платити") — відповідай РІВНО одним реченням, БЕЗ списку, БЕЗ цифр 1/2, БЕЗ суми комісії: «Оплата гнучка — можна частину зараз і решту при отриманні, або одразу повністю; на наступному кроці зручно оберете 🙂». Саме такою фразою (можеш трохи адаптувати тон, але без списку/цифр/деталей). Деталі (суми, комісію, конкретний вибір) дає ВИКЛЮЧНО наступний крок (n_pay) — якщо повторити їх зараз, клієнту доведеться відповідати на той самий вибір двічі.';
      console.log('✅ n_order_intent: заборона дублювати меню оплати');
    } else console.log('✓ n_order_intent вже виправлено');
  }

  // --- 2a) n_requisites: злите повідомлення (лінк + пропозиція вручну + прохання чека) ---
  up('n_requisites', {
    text: '💳 Найзручніший спосіб — оплата за посиланням: просто відкрийте, оберіть свій банк унизу і оплатіть в 1 клік 👇\n{{context.ibanPayUrl}}\n\nЯкщо бажаєте оплатити вручну за реквізитами — просто напишіть, надішлемо 🙂\n\nПісля оплати надішліть, будь ласка, чек/скріншот або посилання на квитанцію — і я одразу оформлю відправку 🙂',
  });
  console.log('✅ n_requisites: лінк + пропозиція вручну (замість автоматичного дампу реквізитів)');

  // --- 2b) нова гілка edges: n_requisites -> n_collect напряму ---
  const setEdge = (s, t, h) => {
    for (let k = edges.length - 1; k >= 0; k--) if (edges[k].source === s && (h ? edges[k].sourceHandle === h : !edges[k].sourceHandle)) edges.splice(k, 1);
    const id = 'e_' + s + '_' + t + (h ? '_' + h : '');
    if (!edges.find((e) => e.id === id)) edges.push({ id, source: s, target: t, ...(h ? { sourceHandle: h } : {}) });
  };
  setEdge('n_requisites', 'n_collect');
  console.log('✅ ребро: n_requisites -> n_collect (напряму, без автодампу реквізитів)');

  // --- 3) додати ноду назви компанії (ФОП) у ланцюжок реквізитів вручну ---
  const wpos = (byId.n_welcome && byId.n_welcome.position) || { x: 0, y: 800 };
  if (!byId.n_req_name_l) {
    nodes.push({ id: 'n_req_name_l', type: 'message', position: { x: wpos.x + 1400, y: wpos.y + 300 },
      data: { label: '11.45 Назва отримувача (підпис)', text: '🏢 Отримувач (ФОП):', variants: [], description: 'Підпис "Отримувач (ФОП):" — окреме повідомлення для копіювання.' } });
    console.log('✅ додано n_req_name_l');
  }
  if (!byId.n_req_name_v) {
    nodes.push({ id: 'n_req_name_v', type: 'message', position: { x: wpos.x + 1400, y: wpos.y + 400 },
      data: { label: '11.46 Назва отримувача (значення)', text: '{{env.FOP_NAME}}', variants: [], description: 'Саме значення назви ФОП-отримувача (окремим повідомленням для копіювання).' } });
    console.log('✅ додано n_req_name_v');
  }
  // вставити в ланцюжок: ...n_req_code_v -> n_req_name_l -> n_req_name_v -> n_req_ref_l...
  setEdge('n_req_code_v', 'n_req_name_l');
  setEdge('n_req_name_l', 'n_req_name_v');
  setEdge('n_req_name_v', 'n_req_ref_l');
  console.log('✅ ланцюжок реквізитів: ...ЄДРПОУ -> Отримувач(ФОП) -> Коментар...');

  // --- n_req_sum: прибрати дубль прохання чека (уже є в n_requisites) ---
  up('n_req_sum', { text: '💰 Сума до сплати: {{context.payAmount}} грн ({{context.payLabel}}).' });
  console.log('✅ n_req_sum: без дубля прохання чека');

  // --- 4) n_collect: по-батькові не обов'язкове + розпізнає прохання реквізитів вручну ---
  const NEW_COLLECT_PROMPT = [
    'Збери дані доставки Новою Поштою: ПІБ, ТЕЛЕФОН, МІСТО, № ВІДДІЛЕННЯ.',
    'ПІБ приймай у форматі "Ім\'я Прізвище" (2 слова) — цього ДОСТАТНЬО, по-батькові НЕ обов\'язкове і уточнювати/вимагати його НЕ треба. Якщо клієнт сам написав по-батькові — просто прийми як є, без уточнень.',
    'Якщо чогось бракує — тепло попроси саме це (коротко, з турботою).',
    'Коли у повідомленні є ВСІ 4 поля — НЕ перепитуй підтвердження, НЕ пиши видимого тексту, одразу поверни ТІЛЬКИ json_output {"fullName":"...","phone":"...","city":"...","branch":"..."} (подяку напише наступний крок). Не згадуй сайтів.',
    'ЯКЩО клієнт просить реквізити оплати вручну (IBAN/ЄДРПОУ/реквізити/"як оплатити вручну" тощо) — НЕ вигадуй їх сама і не пиши текст, поверни РІВНО json_output {"wantsManualReq":true} — наступний крок надішле реквізити окремими повідомленнями.',
    'Якщо клієнт замість даних доставки ставить ІНШЕ питання (оплата, термін, гарантія тощо) — коротко тепло відповідай ЗВИЧАЙНИМ ТЕКСТОМ з відомих даних, і одразу після відповіді знову попроси саме ті поля, яких бракує.',
    'Якщо клієнт ЯВНО просить живу людину/менеджера — поверни json_output {"handoff":true} (без інших полів).',
  ].join(NL);
  up('n_collect', { systemPrompt: NEW_COLLECT_PROMPT });
  console.log('✅ n_collect: по-батькові опційне + розпізнає прохання реквізитів вручну');

  // --- 5) condition-гейт після n_collect: wantsManualReq -> реквізити вручну; інакше -> як було ---
  if (!byId.n_collect_route) {
    const cpos = (byId.n_collect && byId.n_collect.position) || { x: wpos.x + 700, y: wpos.y + 500 };
    nodes.push({ id: 'n_collect_route', type: 'condition', position: { x: cpos.x + 350, y: cpos.y },
      data: { label: '12.1 Просить реквізити вручну?', condition: 'context.orderData && context.orderData.wantsManualReq === true',
        description: 'TRUE -> показати реквізити вручну окремими повідомленнями (і повернутись у збір адреси). FALSE -> звичайний наступний крок (перевірка Нової Пошти).' } });
    console.log('✅ додано n_collect_route (condition-гейт)');
  }
  setEdge('n_collect', 'n_collect_route');
  setEdge('n_collect_route', 'n_req_manual', 'true');
  setEdge('n_collect_route', 'n_np_check', 'false');
  console.log('✅ ребра: n_collect -> n_collect_route -> [true] n_req_manual / [false] n_np_check');
  console.log('   (n_req_manual...n_req_sum вже веде назад у n_collect — цикл замкнено)');

  if (!APPLY) { console.log('\nDRY-RUN — запусти з --apply'); process.exit(0); }
  require('fs').writeFileSync('_backup_payflow_' + Date.now() + '.json', JSON.stringify({ nodes: fd.nodes, edges: fd.edges }, null, 2));
  await db.flowDefinition.update({ where: { botId: BOT }, data: { nodes, edges } });
  console.log('\n✅ записано');
  await db.$disconnect();
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
