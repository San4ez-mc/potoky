// Патч: статична гілка "Повернення/обмін" (власник підтвердив: "Це все — стабільний, повторюваний
// скрипт... роби"). Реконструйовано зі СПРАВЖНІХ сесій, де менеджери вручну проводили клієнта через
// процес (2119c5d6-8a88-4c54-ae3c-5cada3d29ecd, a91be4dc-45d5-4d54-8204-a506ed812c07,
// de26e8d7-7301-4f49-82cc-25106da0a8f4) — за прямою вказівкою власника: "знайди в існуючих сесіях,
// там менеджери вже це робили" (а не вигадувати дизайн з нуля).
//
// Обсяг НАВМИСНО обмежений власником: "У CRM/системі нічого не створюється — тільки оце фіксуєш в
// СРМ в новому статусі". Тобто:
//   - НЕ створюємо записів Return (модель існує, але свідомо не використовуємо).
//   - ЄДИНА дія в CRM: переводимо картку замовлення на стадію "Повернення/обмін" + дописуємо ТТН
//     повернення в existing ttn[] (не новий запис, апдейт існуючого поля).
//   - Нетипові ситуації (клієнт ще НЕ забрав посилку / хоче забрати частину і повернути решту —
//     це рішення про виняток з політики передоплати, реальні гроші) — НЕ намагаємось
//     заскриптувати: модель повертає {"handoff":true} (вбудований механізм рушія — ставить
//     ctx.adminEngaged, шле клієнту "покличу менеджера", алертить адміна) замість вигаданого
//     рішення. Точнісінько так само в живих сесіях реальний менеджер сам вирішував цей кейс
//     (de26e8d7: пояснення правила "не можна забрати частину" + попередження про непередплату).
//
// Де підключено: n_post_order_cond (TRUE = клієнт пише, маючи crmOrderId) раніше вів ПРЯМО на
// n_post_order_once_cond (генеричне "в роботі"). Тепер між ними вставлено n_return_intent_cond —
// TRUE (регекс-детектор сигналу повернення/обміну в ОСТАННЬОМУ повідомленні клієнта) веде в нову
// гілку; FALSE — стара поведінка без змін.
//
// Ідемпотентно: перевіряє наявність нод за id перед вставкою; безпечно перезапускати.

const { PrismaClient } = require('@prisma/client');
const { computeAutoLayout } = require('@platform/flow-layout');
const prisma = new PrismaClient();

const BOT_IDS = [
  'fcdee415-bef2-4a74-a650-e6e4b5a12322', // goverla_shop — основний магазин (Zernio), production
];

const NEW_NODES = [
  {
    id: 'n_return_intent_cond',
    type: 'condition',
    data: {
      label: '1.851 Сигнал повернення/обміну?',
      condition:
        "/поверн|обмін|обмен|легке\\s*поверненн|не\\s*п[іи]дійшл|не\\s*подошл|\\bзамін\\w*|\\bзамен\\w*|\\bпомен\\w*/i.test(String(input || context.lastCustomerMessage || ''))",
      description:
        'TRUE → гілка "Легке повернення" (n_return_easy_msg). FALSE → стара поведінка (n_post_order_once_cond, "в роботі"). Детерміновано регексом (не LLM) — критичне розгалуження.',
    },
  },
  {
    id: 'n_return_easy_msg',
    type: 'message',
    data: {
      label: '1.852 Повернення: інструкція «Легке повернення»',
      text:
        'В Нової пошти є програма «Легке повернення» 📦\nЗа її допомогою можна повернути або обміняти товар безкоштовно.\n\nДля цього:\n1) Зайдіть у мобільний застосунок Нової пошти\n2) Натисніть на номер накладної, за якою забирали товар\n3) Натисніть «Легке повернення»\n\nАбо скажіть працівнику відділення, що хочете оформити повернення за програмою «Легке повернення» — він зробить усе сам 😉\n\nТермін обміну/повернення — від 7 до 14 днів (в середньому 10):\n▫️ 1-2 дні посилка їде до нас\n▫️ 1-3 дні забирають з відділення\n▫️ 1-3 дні оглядаємо товар\n▫️ 1-2 дні відправляємо нову посилку (або оформлюємо повернення коштів)\n▫️ 1-2 дні їде до вас\n\nЯк відправите — напишіть нам, будь ласка, номер нової накладної, щоб ми одразу оформили обмін/повернення 🤗',
      variants: [],
      description:
        'Дослівно (злегка причесано) з реальних сесій 2119c5d6/a91be4dc — так менеджери завжди пояснювали процес.',
    },
  },
  {
    id: 'n_return_ttn_collect',
    type: 'claude',
    data: {
      mode: 'dialog',
      label: '1.853 Повернення: чекаємо ТТН',
      model: 'claude-haiku-4-5',
      outputVar: 'returnFlow',
      connectorId: '4a8000aa-837f-4a73-bf5c-224949ebaf9a',
      description:
        'Дочекатись номера накладної повернення. Нетиповий кейс (ще не забрав/частковий пікап) → handoff:true (вбудований механізм — жива людина вирішує, бо це рішення про виняток з політики передоплати).',
      temperature: 0.1,
      // 2026-09-12 (живий тест-прогін, антипатерн A5 "дубль повідомлень"): БЕЗ waitOnEntry ця
      // нода обробляла ТЕ САМЕ повідомлення, що вже отримало відповідь від n_return_easy_msg
      // (статичну інструкцію) в цьому ж ході — клієнт бачив інструкцію ДВІЧІ (раз дослівно,
      // раз перефразовану моделлю). waitOnEntryUnless: якщо тригер-повідомлення вже МІСТИТЬ
      // номер накладної (10-14 цифр) — обробляємо одразу, без зайвого чекання.
      waitOnEntry: true,
      waitOnEntryUnless: '\\d{10,14}',
      exitCondition: 'json_output',
      systemPrompt:
        'Клієнту щойно пояснили процес «Легке повернення» Нової пошти (можна безкоштовно повернути/обміняти товар через мобільний застосунок НП). Твоя ЄДИНА задача — дочекатись від клієнта НОМЕРА НАКЛАДНОЇ (ТТН, зазвичай 14 цифр) нової посилки з поверненням.\n\nЯКЩО клієнт написав число, схоже на номер накладної (12-14 цифр, можливо з пробілами) — поверни ТІЛЬКИ json_output {"returnTtn":"<цифри без пробілів>"}, без жодного тексту.\n\nЯКЩО клієнт пише, що ЩЕ НЕ ЗАБРАВ посилку з відділення, або хоче забрати ЛИШЕ ЧАСТИНУ замовлення (одну річ узяти, іншу відмовити прямо на пошті — НЕ через «Легке повернення»), або питає про повернення передоплати при відмові — це виняткова ситуація з реальними грошима, її вирішує ТІЛЬКИ менеджер. НІЧОГО не вигадуй і не обіцяй сам — поверни ТІЛЬКИ json_output {"handoff":true}, без тексту.\n\nЯКЩО клієнт ставить інше запитання (термін, куди писати тощо) — коротко тепло відповідай ЗВИЧАЙНИМ ТЕКСТОМ (без JSON) із відомих фактів (термін — 7-14 днів, в середньому 10) і знову попроси номер накладної.\n\nЯвно просить живу людину/менеджера → {"handoff":true}.\nУкраїнською, на «ви», тепло. Реквізитів, номерів карток чи сум сама не називай — це не твоя задача тут.',
    },
  },
  {
    id: 'n_return_crm_update',
    type: 'js',
    data: {
      label: '1.854 CRM: стадія «Повернення/обмін» + ТТН',
      description:
        'ЄДИНА дія в CRM за прямою вказівкою власника — нічого нового не створюємо, лише стадія + ttn[] існуючого замовлення. Best-effort (try/catch), не блокує відповідь клієнту.',
      code:
        "// 2026-09-12 (власник: \"тільки оце фіксуєш в СРМ в новому статусі\" — реконструйовано з реальних\n" +
        "// сесій 2119c5d6/a91be4dc/de26e8d7, де менеджери вручну вели клієнта через \"Легке повернення\").\n" +
        "var returnTtn = (context.returnFlow && context.returnFlow.returnTtn) ? String(context.returnFlow.returnTtn).replace(/\\D/g, '') : '';\n" +
        "if (context.crmOrderId && String(context.crmOrderId).indexOf('TEST-') !== 0 && returnTtn) {\n" +
        "  try {\n" +
        "    var base = (keys.CRM_API_BASE || 'http://127.0.0.1:4700/api').replace(/\\/$/, '');\n" +
        "    var apiKey = (keys.CRM_API_KEY || '').trim();\n" +
        "    if (apiKey) {\n" +
        "      var hdr = { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' };\n" +
        "      var pr = await fetch(base + '/pipelines', { headers: hdr });\n" +
        "      var pj = await pr.json().catch(function () { return {}; });\n" +
        "      var stageId = null;\n" +
        "      if (pj && pj.ok && Array.isArray(pj.data)) {\n" +
        "        for (var i = 0; i < pj.data.length && !stageId; i++) {\n" +
        "          var stages = pj.data[i].stages || [];\n" +
        "          var hit = stages.filter(function (s) { return /поверненн|обмін/i.test(s.name || ''); })[0];\n" +
        "          if (hit) stageId = hit.id;\n" +
        "        }\n" +
        "      }\n" +
        "      var orr = await fetch(base + '/orders/' + context.crmOrderId, { headers: hdr });\n" +
        "      var orj = orr.ok ? await orr.json().catch(function () { return {}; }) : {};\n" +
        "      var existingTtn = (orj && orj.data && Array.isArray(orj.data.ttn)) ? orj.data.ttn : [];\n" +
        "      var newTtn = existingTtn.indexOf(returnTtn) === -1 ? existingTtn.concat([returnTtn]) : existingTtn;\n" +
        "      var patchBody = { ttn: newTtn };\n" +
        "      if (stageId) patchBody.stageId = stageId;\n" +
        "      await fetch(base + '/orders/' + context.crmOrderId, { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr), body: JSON.stringify(patchBody) });\n" +
        "    }\n" +
        "  } catch (e) { /* best-effort, не блокуємо клієнта через це */ }\n" +
        "}\n" +
        "return { returnTtnConfirmed: returnTtn || null };",
    },
  },
  {
    id: 'n_return_confirm_msg',
    type: 'message',
    data: {
      label: '1.855 Повернення: підтвердження клієнту',
      text:
        'Заявку прийняли! 🤗\nЩойно посилка дійде до нас — перевіримо товар і зв\'яжемось щодо обміну/повернення. Термін — від 7 до 14 днів (в середньому 10) 💛',
      variants: [],
      description: 'Дослівно "Заявку прийняли" — так закривали цю розмову реальні менеджери.',
    },
  },
  {
    id: 'n_return_admin',
    type: 'notifyTg',
    data: {
      label: '1.856 Сигнал: оформлено повернення/обмін',
      message:
        '🔄 <b>Повернення/обмін</b> — замовлення {{context.orderRef}} (CRM {{context.crmOrderId}})\n\n👤 {{context.senderName}} ({{context.igUsername}})\n📦 ТТН повернення: {{context.returnFlow.returnTtn}}\n💬 Причина (зі слів клієнта): «{{context.lastCustomerMessage}}»',
      targetKey: 'ADMIN_TELEGRAM_ID',
      alertTitle: '🔄 Повернення/обмін оформлено ботом',
      alertMain: 'Картку вже переведено в CRM на стадію «Повернення/обмін» автоматично. Далі вручну: перевірка товару, рішення про обмін чи повернення коштів.',
      description: 'Термінальний сигнал — далі веде менеджер вручну (перевірка товару, фактичний обмін/повернення коштів).',
      alertDetails: '🧾 {{context.orderRef}}\n📦 ТТН: {{context.returnFlow.returnTtn}}',
    },
  },
];

const NEW_EDGES = [
  // Вставка перед старою гілкою (перенаправляємо, не видаляючи стару поведінку для FALSE):
  { id: 'edge_return_1', source: 'n_return_intent_cond', target: 'n_return_easy_msg', sourceHandle: 'true' },
  { id: 'edge_return_2', source: 'n_return_intent_cond', target: 'n_post_order_once_cond', sourceHandle: 'false' },
  { id: 'edge_return_3', source: 'n_return_easy_msg', target: 'n_return_ttn_collect' },
  { id: 'edge_return_4', source: 'n_return_ttn_collect', target: 'n_return_crm_update' },
  { id: 'edge_return_5', source: 'n_return_crm_update', target: 'n_return_confirm_msg' },
  { id: 'edge_return_6', source: 'n_return_confirm_msg', target: 'n_return_admin' },
];

async function patchBot(botId) {
  const flow = await prisma.flowDefinition.findUnique({ where: { botId } });
  if (!flow) { console.log(botId, '— НЕМАЄ flowDefinition, пропускаю'); return; }
  const nodes = flow.nodes || [];
  const edges = flow.edges || [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  if (!nodeIds.has('n_post_order_cond') || !nodeIds.has('n_post_order_once_cond')) {
    console.log(botId, '— немає n_post_order_cond/n_post_order_once_cond, пропускаю (не goverla-подібна воронка)');
    return;
  }

  let changed = false;
  const outNodes = nodes.slice();
  for (const n of NEW_NODES) {
    const idx = outNodes.findIndex((x) => x.id === n.id);
    if (idx === -1) {
      outNodes.push(Object.assign({ position: { x: 0, y: 0 } }, n));
      changed = true;
      console.log(botId, '+ node', n.id);
    } else {
      // Ідемпотентний апдейт даних (не лише "пропустити, якщо є") — щоб фікси в NEW_NODES
      // (напр. waitOnEntry) доїжджали до вже застосованого патчу без ручного видалення ноди.
      const before = JSON.stringify(outNodes[idx].data || {});
      const mergedData = Object.assign({}, outNodes[idx].data, n.data);
      const after = JSON.stringify(mergedData);
      if (before !== after) {
        outNodes[idx] = Object.assign({}, outNodes[idx], { data: mergedData });
        changed = true;
        console.log(botId, '~ node дані оновлено', n.id);
      } else {
        console.log(botId, '= node вже актуальна', n.id, '(пропускаю)');
      }
    }
  }

  // Перепідключення старого ребра n_post_order_cond --true--> n_post_order_once_cond
  // на n_post_order_cond --true--> n_return_intent_cond (стара мета лишається лише як FALSE-гілка
  // нового вузла — див. edge_return_2 нижче).
  let outEdges = edges.slice();
  const oldEdgeIdx = outEdges.findIndex((e) => e.source === 'n_post_order_cond' && e.target === 'n_post_order_once_cond');
  if (oldEdgeIdx !== -1 && outEdges[oldEdgeIdx].target !== 'n_return_intent_cond') {
    console.log(botId, '~ перенаправляю ребро n_post_order_cond -> n_post_order_once_cond на -> n_return_intent_cond');
    outEdges[oldEdgeIdx] = Object.assign({}, outEdges[oldEdgeIdx], { target: 'n_return_intent_cond' });
    changed = true;
  } else if (!outEdges.some((e) => e.source === 'n_post_order_cond' && e.target === 'n_return_intent_cond')) {
    outEdges.push({ id: 'edge_return_0', source: 'n_post_order_cond', target: 'n_return_intent_cond', sourceHandle: outEdges[oldEdgeIdx] ? outEdges[oldEdgeIdx].sourceHandle : undefined });
    changed = true;
  }

  const existingEdgeKeys = new Set(outEdges.map((e) => e.source + '>>' + e.target + '>>' + (e.sourceHandle || '')));
  for (const e of NEW_EDGES) {
    const key = e.source + '>>' + e.target + '>>' + (e.sourceHandle || '');
    if (!existingEdgeKeys.has(key)) { outEdges.push(e); changed = true; console.log(botId, '+ edge', e.source, '->', e.target, e.sourceHandle || ''); }
    else console.log(botId, '= edge вже є', e.source, '->', e.target, '(пропускаю)');
  }

  if (!changed) { console.log(botId, '— без змін (усе вже застосовано)'); return; }

  const laidOut = computeAutoLayout(outNodes, outEdges);
  await prisma.flowDefinition.update({ where: { botId }, data: { nodes: laidOut, edges: outEdges } });
  console.log(botId, '✅ застосовано, вузлів:', laidOut.length, 'ребер:', outEdges.length);
}

(async () => {
  for (const botId of BOT_IDS) {
    await patchBot(botId);
  }
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());
