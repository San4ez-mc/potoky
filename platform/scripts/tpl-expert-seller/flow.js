'use strict';
// Шаблон воронки ШІ-продавця експерта (tpl-expert-seller). ДЖЕРЕЛО ІСТИНИ графа: тут.
// Ніяких фактів про експерта: усе (послуга, ціна, кейси, правила, тексти) воронка бере з брифу content2 у ноді «Завантажити експерта».
// Клон = цей самий граф + ключі (EXPERT_PROJECT_ID, HANDOFF_TELEGRAM_ID, Telegram-конектор) — див. clone-expert-seller.js.
// Правила: одна нода = одна дія; з кожної ноди один вихідний ланцюжок (розгалуження лише через condition); тексти — з {{context.expert.texts.*}}.

const TEMPLATE_VERSION = 'v1-2026-10-22';
const NAME = (p) => '{{context.expert.expert.' + p + '}}';

const LOAD_CODE = String.raw`
const out = { expertOk: false, expert: null, expertError: '' };
try {
  if (context.testMode && context.expertBriefOverride) { out.expert = context.expertBriefOverride; out.expertOk = true; return out; }
  const pid = String(keys.EXPERT_PROJECT_ID || '').trim();
  const base = String(keys.CONTENT2_URL || '').replace(/\/$/, '');
  if (!pid || !base || !keys.CONTENT2_WEBHOOK_SECRET) throw new Error('не задано EXPERT_PROJECT_ID / CONTENT2_URL / CONTENT2_WEBHOOK_SECRET');
  const res = await fetch(base + '/api/webhooks/seller-brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': String(keys.CONTENT2_WEBHOOK_SECRET) },
    body: JSON.stringify({ projectId: pid, telegramId: String((context.testMode && context.expertTestTelegramId) || user.telegramId) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + res.status));
  out.expert = j; out.expertOk = true;
} catch (e) { out.expertError = String(e && e.message || e).slice(0, 300); }
return out;
`;

const CORE_PROMPT = [
    'Ти — ' + NAME('sellerName') + ', ' + NAME('sellerTitle') + '. Ти ШІ-продавець: у переписці з\'ясовуєш ситуацію людини і, якщо експерт їй підходить, ведеш до запису на консультацію. Ціль — 3-5 коротких обмінів і органічний перехід до запису.',
    '',
    '{{context.expert.blocks.all}}',
    '',
    '━━━ ЯК ВЕДЕШ ДІАЛОГ ━━━',
    '1. Привітання вже надіслано (воно вище в історії). Кожне твоє повідомлення: максимум 2-3 речення, ОДНЕ запитання наприкінці, ніколи два питання разом.',
    '2. Спершу зрозумій ситуацію. Якщо є блок «ЩО З\'ЯСОВУВАТИ ПРО ЛЮДИНУ» — з\'ясовуй це по одному питанню за повідомлення, без допиту. Що людина вже сказала, не перепитуй.',
    '3. Зрозумівши ситуацію, назви 1-2 типові труднощі в її сфері й спитай «Є таке?». Це припущення, а не факт про людину: нічого про неї не вигадуй.',
    '4. Труднощі підтверджено → спитай, як давно це і що вже пробувала. Потім мікро-зобов\'язання: «Якби це вдалося вирішити, що б змінилось?».',
    '5. Людина підходить (за блоками «Кому підходить» і «Що з\'ясовувати») і готова → вихід book.',
    '6. Не питай «Цікаво?» чи «Готовий?». Закривай припущенням: «Коли зручніше глянути: цього тижня чи наступного?» (лише коли в блоках є спосіб запису).',
    '7. Питають ціну до пропозиції → назви її з блоку «ПРО ПОСЛУГУ» одразу і продовжуй діалог.',
    '8. Не тягни розмову: після 6-7 обмінів без готовності завершуй виходом JSON (undecided). Імʼя питай не більше одного разу.',
    '9. Мова: відповідай мовою останнього повідомлення людини, не мішай мови; попросили іншу — переходь і не повертайся. Звертання: за замовчуванням на «ти»; пише на «Ви» чи просить «Ви» — тільки «Ви» до кінця.',
    '10. Ти ШІ, не видавай себе за людину. Питають — чесно скажи, що ти ШІ-продавець експерта. Спеціальних слів про методику (SPIN, воронка) не вживай.',
    '11. Якщо спрацював пункт «Негайно передай розмову експерту» з правил — одразу вихід direct.',
    '12. Чого немає в блоках вище, того ти не знаєш. На таке питання відповідай лише «це до експерта» (з контактом, якщо він дозволений) і НЕ пояснюй, від чого воно залежить, і не припускай.',
    '13. Не вгадуй стать людини: не вживай дієслів минулого часу, що її вказують («написала/написав», «зрозуміла»), поки людина сама не показала стать. Формулюй безособово: «ти вже пишеш йому?», «зрозуміло».',
    '14. Не пропонуй того, чого не вмієш: ти не пишеш експерту від імені людини, не телефонуєш, не бронюєш час. Ти можеш лише розповісти з блоків, дати дозволений контакт, а в кінці передати заявку експерту.',
    '',
    '━━━ ВИХІД ━━━',
    'Коли є рішення, поверни РІВНО один JSON і більше нічого (ні слова до чи після):',
    '{"outcome":"book|direct|undecided|objection|not_relevant","name":"імʼя або порожньо","main_pain":"ситуація СЛОВАМИ ЛЮДИНИ","objection":"суть заперечення або порожньо"}',
    '• book: людина підходить, їй цікава послуга, готова до запису.',
    '• direct: конкретний запит або складне питання, яке має обговорювати сам експерт; людина просить поговорити з експертом; спрацювало «Негайно передай…».',
    '• undecided: не відмовляється, але не готова вирішувати («подумаю», «не певен», сумніви без причини).',
    '• objection: називає конкретну причину не йти далі (дорого, немає часу, не вірить, вже пробувала).',
    '• not_relevant: ПРЯМО каже, що не цікаво, або явно не підходить під «Кого не беруть». «Подумаю» чи сумніви — це НЕ not_relevant.',
    'JSON = кінець діалогу.',
].join('\n');

const OBJECTION_PROMPT = [
    'Ти — ' + NAME('sellerName') + ', ' + NAME('sellerTitle') + '. У людини заперечення: {{context.spin_result.objection}}. Її ситуація: {{context.spin_result.main_pain}}.',
    '',
    '{{context.expert.blocks.all}}',
    '',
    'Обробити щиро й коротко (1-2 повідомлення), без тиску. Використовуй лише факти з блоків вище: ціну, формат, кейси (лише у дозволених формулюваннях). Не вигадуй знижок, гарантій і відгуків.',
    'Типове: «дорого» → порівняй із вартістю проблеми, яку людина описала; «немає часу» → нагадай формат і тривалість із блоку; «не вірю/вже пробувала» → спитай, що не спрацювало; «сама розберуся» → ок, але запропонуй погляд збоку.',
    'Формат: максимум 2-3 речення, одне питання наприкінці. Мова й «ти/Ви» — як у людини. Ти ШІ, не видавай себе за людину.',
    'Чого немає в блоках, того ти не знаєш: відповідай «це до експерта» і не пояснюй, від чого воно залежить. Не вгадуй стать людини (без «написала/написав», «зрозуміла»). Не пропонуй того, чого не вмієш: писати експерту від імені людини, телефонувати, бронювати час.',
    'Після обробки спитай, чи готова розглянути запис. Погодилась → поверни JSON {"convinced":true}. Ні → {"convinced":false}. Тільки JSON, коли рішення є.',
].join('\n');

const OFFER_PROMPT = [
    'Ти — ' + NAME('sellerName') + ', ' + NAME('sellerTitle') + '. Склади ОДНЕ повідомлення людині з пропозицією записатись.',
    '',
    '{{context.expert.blocks.offer}}',
    '{{context.expert.blocks.booking}}',
    '',
    'Вимоги: 4-6 коротких рядків. (1) одним реченням зв\'яжи з ситуацією людини; (2) що відбувається на консультації й що вона отримає; (3) ціна й умови: лише з блоку «ПРО ПОСЛУГУ», нічого не додавай; (4) як записатись: є посилання → дай його; режим оплати вперед → скажи, що зараз надішлеш посилання на оплату; (5) нічого не вигадуй: ні знижок, ні гарантій, ні термінів.',
    'Ти ШІ, не видавай себе за людину. Звертайся на «ти» (як у діалозі вище); «Ви» лише якщо людина сама ні разу не казала «ти» і пише на «Ви». Мова — мова людини (українська, якщо не знаєш). Поверни ЛИШЕ текст повідомлення, без лапок і пояснень.',
].join('\n');

const AFTER_PROMPT = [
    'Ти — ' + NAME('sellerName') + ', ' + NAME('sellerTitle') + '. Людина отримала пропозицію запису. Відповідай на її питання про послугу й запис.',
    '',
    '{{context.expert.blocks.all}}',
    '',
    'Використовуй лише факти з блоків. Чого не знаєш, скажи лише «це до експерта» (контакти лише з правил) і не пояснюй, від чого воно залежить. Не вгадуй стать людини (без «написала/написав»). Не пропонуй писати експерту від імені людини чи бронювати час. 2-3 речення, одне питання наприкінці. Мова й «ти/Ви» — як у людини.',
    'Коли людина підтвердила, що записалась/запишеться, або явно завершила розмову — поверни РІВНО {"done":true} і більше нічого.',
].join('\n');

const leadMsg = (icon, title) =>
    icon + ' ' + title + '\n\nІмʼя: {{context.spin_result.name}}\nСитуація: {{context.spin_result.main_pain}}\nTelegram: @{{user.username}} · tg://user?id={{user.telegramId}}\nРежим: {{context.expert.mode}}';

// Живе повідомлення за НАПРЯМОМ (а не готовим текстом): нода отримує тон і правила експерта + напрям із брифу й формулює одне повідомлення
// за контекстом розмови (останньою реплікою людини, її мовою і «ти/Ви»). Нода режиму single з exitCondition none сама показує текст.
const livePrompt = (dirKey) => [
    'Ти — ' + NAME('sellerName') + ', ' + NAME('sellerTitle') + '. Ти ШІ-продавець, не видавай себе за людину.',
    '',
    '{{context.expert.blocks.offer}}',
    '',
    '{{context.expert.blocks.tone}}',
    '',
    '{{context.expert.blocks.rules}}',
    '',
    '━━━ ЩО ЗАРАЗ ТРЕБА ЗРОБИТИ (це напрям, а не готовий текст) ━━━',
    '{{context.expert.directions.' + dirKey + '}}',
    '',
    'Виконай РІВНО те, що сказано в напрямі: не починай нового продажного кроку, не став запитань, якщо напрям їх не просить. Послугу описуй точно за блоком «ПРО ПОСЛУГУ», не узагальнюй її до «автоматизації бізнесу».',
    'Сформулюй ОДНЕ коротке повідомлення своїми словами, спираючись на ситуацію людини й останню її репліку. Мова й «ти/Ви» — як у людини (за замовчуванням українська, на «ти»). Не копіюй формулювань напряму дослівно. Не вигадуй фактів поза блоками. Не вгадуй стать людини. Не пропонуй того, чого не вмієш. Поверни ЛИШЕ текст повідомлення, без лапок і пояснень.',
].join('\n');
const liveCtx = '[{"role":"user","content":"Остання репліка людини: {{input}}. Імʼя: {{context.spin_result.name}}. Її ситуація: {{context.spin_result.main_pain}}. Заперечення: {{context.spin_result.objection}}."}]';
const liveNode = (dirKey, qa, ctxTemplate) => ({
    mode: 'single', model: 'claude-sonnet-4-6', connectorId: '{{env.CLAUDE_CONNECTOR_ID}}', systemPrompt: livePrompt(dirKey),
    exitCondition: 'none', outputVar: 'context.live_' + dirKey, messagesTemplate: ctxTemplate || liveCtx, qaExpectation: qa,
});

function buildFlow() {
    const nodes = [];
    const edges = [];
    let y = 0;
    const add = (id, type, label, data, x = 0) => { nodes.push({ id, type, position: { x, y: (y += 140) }, data: { label, ...data } }); return id; };
    const link = (a, b, extra = {}) => edges.push({ id: 'e' + edges.length + '_' + a + '__' + b, source: a, target: b, ...extra });

    nodes.push({ id: 'start_1', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Старт', trigger: '/start tpl-expert-seller' } });
    add('n_load', 'js', 'Завантажити експерта', { code: LOAD_CODE, qaExpectation: 'Бриф експерта завантажується з content2; збій не валить сесію (expertOk=false). У тестах підміна через context.expertBriefOverride.' });
    add('n_gate', 'condition', 'Можна говорити?', { conditions: [
        { id: 'c_err', label: 'Бриф недоступний', expression: '!context.expertOk' },
        { id: 'c_closed', label: 'Продавець не відповідає цій людині', expression: '!(context.expert && context.expert.access && context.expert.access.allowed)' },
        { id: 'c_ok', label: 'Можна', expression: 'true' },
    ] });
    add('n_err_notify', 'notifyTg', 'Збій брифу: алерт власнику', { targetKey: 'ADMIN_TELEGRAM_ID', message: '⚠️ Продавець: не вдалося завантажити бриф експерта. {{context.expertError}}' }, -420);
    add('n_err_msg', 'message', 'Збій брифу: людині', { text: 'Вибач, зараз не можу відповісти. Спробуй трохи пізніше.', qaExpectation: 'Людина бачить ввічливу відмову, без технічних деталей.' }, -420);
    add('n_blocked_msg', 'message', 'Недоступно (не запущено/пауза/ліміт)', { text: '{{context.expert.texts.unavailable}}', qaExpectation: 'Чужим людям, коли продавець не запущений, лише ввічлива відмова.' }, -840);
    add('n_lead', 'notifyTg', 'Новий лід', { targetKey: 'HANDOFF_TELEGRAM_ID', message: '🚀 Нова розмова з продавцем\n\nTelegram: @{{user.username}} · tg://user?id={{user.telegramId}}\nІмʼя в Telegram: {{user.firstName}} {{user.lastName}}' });
    add('n_greet', 'claude', 'Вітання', liveNode('greeting', 'Живе привітання: імʼя й титул продавця, чесно що він ШІ, чим допомагає, одне відкрите питання; без шаблонів і вигаданих фактів.',
        '[{"role":"user","content":"Людина щойно відкрила бота. Імʼя в Telegram: {{user.firstName}}."}]'));
    add('n_spin', 'claude', 'Діалог із людиною', {
        mode: 'dialog', model: 'claude-sonnet-4-6', connectorId: '{{env.CLAUDE_CONNECTOR_ID}}', systemPrompt: CORE_PROMPT,
        exitCondition: 'json_output', outputVar: 'context.spin_result', messagesTemplate: '{{conversationHistory}}',
        qaExpectation: 'Короткі повідомлення, одне питання; не вигадує ціни, контактів, цифр кейсів; чесно каже, що він ШІ; закінчує JSON з outcome.',
    });
    add('n_outcome', 'condition', 'Результат діалогу', { conditions: [
        { id: 'o_nr', label: 'Не актуально', expression: "context.spin_result.outcome === 'not_relevant'" },
        { id: 'o_obj', label: 'Заперечення', expression: "context.spin_result.outcome === 'objection'" },
        { id: 'o_dir', label: 'Передати експерту', expression: "context.spin_result.outcome === 'direct'" },
        { id: 'o_und', label: 'Думає', expression: "context.spin_result.outcome === 'undecided'" },
        { id: 'o_book', label: 'Готова до запису', expression: "context.spin_result.outcome === 'book'" },
        { id: 'o_def', label: 'Невідомий результат → як «думає»', expression: 'true' },
    ] });
    add('n_nr_msg', 'claude', 'Не актуально', liveNode('notRelevant', 'Ввічливо відпускає людину, якій послуга не підходить; без критики, без продажу, мовою людини.'), -1260);
    add('n_obj', 'claude', 'Обробка заперечення', {
        mode: 'dialog', model: 'claude-sonnet-4-6', connectorId: '{{env.CLAUDE_CONNECTOR_ID}}', systemPrompt: OBJECTION_PROMPT,
        exitCondition: 'json_output', outputVar: 'context.obj_result', messagesTemplate: '{{conversationHistory}}',
        qaExpectation: 'Обробляє заперечення тільки фактами з брифу; без знижок і гарантій; закінчує JSON convinced.',
    }, -840);
    add('n_obj_cond', 'condition', 'Переконали?', { conditions: [
        { id: 'oc_no', label: 'Не переконали', expression: 'context.obj_result.convinced === false' },
        { id: 'oc_yes', label: 'Переконали', expression: 'context.obj_result.convinced === true' },
    ] }, -840);
    add('n_soft_msg', 'claude', 'М\'який вихід', liveNode('softExit', 'Приймає відмову без тиску, повертає одну корисну думку, лишає двері відчиненими.'), -840);
    add('n_dir_notify', 'notifyTg', 'Передача експерту: сповіщення', { targetKey: 'HANDOFF_TELEGRAM_ID', message: leadMsg('🙋', 'Просить поговорити з експертом') }, 420);
    add('n_dir_msg', 'claude', 'Передача експерту: людині', liveNode('direct', 'Каже, що заявку передано експерту; дає лише дозволений контакт; не обіцяє часу відповіді.'), 420);
    add('n_und_notify', 'notifyTg', 'Лід думає: сповіщення', { targetKey: 'HANDOFF_TELEGRAM_ID', message: leadMsg('🟡', 'Лід думає (не відмовився)') }, 840);
    add('n_und_msg', 'claude', 'Думає: м\'який вихід', liveNode('softExit', 'Приймає, що людина думає, без тиску; лишає двері відчиненими.'), 840);
    add('n_und_wait', 'wait', 'Думає: пауза 48 год', { unit: 'hours', duration: 48 }, 840);
    add('n_und_nudge', 'claude', 'Думає: нагадування', liveNode('nudge', 'Мʼяко нагадує про себе, повʼязуючи з ситуацією людини; одне конкретне питання; без докорів.',
        '[{"role":"user","content":"Минуло дві доби відтоді, як людина сказала, що подумає. Її ситуація: {{context.spin_result.main_pain}}. Імʼя: {{context.spin_result.name}}."}]'), 840);
    add('n_offer', 'claude', 'Скласти пропозицію запису', {
        mode: 'single', model: 'claude-sonnet-4-6', connectorId: '{{env.CLAUDE_CONNECTOR_ID}}', systemPrompt: OFFER_PROMPT,
        exitCondition: 'none', outputVar: 'context.offerText', messagesTemplate: '[{"role":"user","content":"Імʼя людини: {{context.spin_result.name}}. Її ситуація: {{context.spin_result.main_pain}}"}]',
        qaExpectation: 'Пропозиція (її показує сама нода) містить лише ціну й умови з брифу, посилання на запис, без вигаданих знижок і гарантій; показується один раз.',
    });
    add('n_hot_notify', 'notifyTg', 'Гарячий лід: сповіщення', { targetKey: 'HANDOFF_TELEGRAM_ID', message: leadMsg('🔥', 'Гарячий лід (готова до запису)') });
    // УВАГА: нода «connector» двигуна поки ігнорує connectorId і бере перший активний WayForPay платформи (рахунок власника).
    // Тому реальний рахунок створюється лише якщо бриф каже paymentSupported=true (прапор у content2, вмикається після виправлення двигуна),
    // а в тестовому режимі рахунки не створюються ніколи.
    add('n_mode', 'condition', 'Режим: оплата вперед?', { conditions: [
        { id: 'm_paid', label: 'Оплата вперед (реальна)', expression: "context.expert.mode === 'paid_consult' && context.expert.paymentSupported === true && !context.testMode" },
        { id: 'm_paid_test', label: 'Оплата вперед (тест: без рахунку)', expression: "context.expert.mode === 'paid_consult' && context.expert.paymentSupported === true && !!context.testMode" },
        { id: 'm_book', label: 'Запис на консультацію', expression: 'true' },
    ] });
    add('n_pay', 'connector', 'Оплата: створити рахунок', {
        action: 'create_invoice', amount: '{{context.expert.offer.priceAmount}}', currency: '{{context.expert.offer.currency}}',
        connectorId: '', connectorType: 'wayforpay', connectorIcon: '💳', outputVar: 'context.payment_url',
        description: '{{context.expert.offer.name}}', orderReference: 'consult_{{user.telegramId}}_{{timestamp}}',
        qaExpectation: 'connectorId проставляє clone-expert-seller з налаштувань продавця (платіжний конектор експерта).',
    }, 420);
    add('n_pay_test', 'message', 'Оплата: тест (без рахунку)', { text: '💳 [тест] Тут було б посилання на оплату. Рахунок у тестовому режимі не створюється.' }, 840);
    add('n_pay_msg', 'message', 'Оплата: посилання', { text: '💳 Ось посилання для оплати:\n\n{{context.payment_url}}\n\nПісля оплати експерт напише тобі й домовиться про час.\n\n{{context.wfp_legal_footer}}' }, 420);
    add('n_pay_wait', 'wait_payment', 'Оплата: очікування', { timeoutHours: 72 }, 420);
    add('n_paid_msg', 'claude', 'Оплата: дякуємо', liveNode('paid', 'Дякує за оплату й каже, що експерт напише домовитись про час.'), 420);
    add('n_paid_notify', 'notifyTg', 'Оплата: сповіщення', { targetKey: 'HANDOFF_TELEGRAM_ID', message: leadMsg('💰', 'Оплачено! Домовтесь про час') }, 420);
    add('n_after', 'claude', 'Після пропозиції: відповіді на питання', {
        mode: 'dialog', model: 'claude-sonnet-4-6', connectorId: '{{env.CLAUDE_CONNECTOR_ID}}', systemPrompt: AFTER_PROMPT,
        exitCondition: 'json_output', outputVar: 'context.after_result', messagesTemplate: '{{conversationHistory}}',
        qaExpectation: 'Відповідає лише фактами з брифу; чого не знає, відправляє до експерта.',
    });
    add('n_after_end', 'claude', 'Після пропозиції: завершення', liveNode('afterEnd', 'Коротко підтверджує, що все гаразд, і каже, що можна писати, коли знадобиться; не продає знову.',
        '[{"role":"user","content":"Людина завершує розмову, її остання репліка: {{input}}."}]'));

    link('start_1', 'n_load'); link('n_load', 'n_gate');
    link('n_gate', 'n_err_notify'); link('n_gate', 'n_blocked_msg'); link('n_gate', 'n_lead');
    link('n_err_notify', 'n_err_msg');
    link('n_lead', 'n_greet'); link('n_greet', 'n_spin'); link('n_spin', 'n_outcome');
    link('n_outcome', 'n_nr_msg'); link('n_outcome', 'n_obj'); link('n_outcome', 'n_dir_notify');
    link('n_outcome', 'n_und_notify'); link('n_outcome', 'n_offer'); link('n_outcome', 'n_und_notify');
    link('n_obj', 'n_obj_cond'); link('n_obj_cond', 'n_soft_msg'); link('n_obj_cond', 'n_offer');
    link('n_dir_notify', 'n_dir_msg');
    link('n_und_notify', 'n_und_msg'); link('n_und_msg', 'n_und_wait'); link('n_und_wait', 'n_und_nudge');
    link('n_offer', 'n_hot_notify'); link('n_hot_notify', 'n_mode');
    link('n_mode', 'n_pay'); link('n_mode', 'n_pay_test'); link('n_mode', 'n_after'); link('n_pay_test', 'n_paid_msg');
    link('n_pay', 'n_pay_msg'); link('n_pay_msg', 'n_pay_wait'); link('n_pay_wait', 'n_paid_msg', { sourceHandle: 'paid', animated: true });
    link('n_paid_msg', 'n_paid_notify');
    link('n_after', 'n_after_end');
    return { nodes, edges };
}

// Самоперевірка графа: кожна нода (крім кінцевих) має вихід; з не-condition виходить рівно один ребро; condition має стільки ребер, скільки умов.
const TERMINAL = new Set(['n_err_msg', 'n_blocked_msg', 'n_nr_msg', 'n_soft_msg', 'n_dir_msg', 'n_und_nudge', 'n_paid_notify', 'n_after_end']);
function validateFlow(flow) {
    const errs = [];
    const ids = new Set(flow.nodes.map((n) => n.id));
    for (const e of flow.edges) { if (!ids.has(e.source) || !ids.has(e.target)) errs.push('ребро на неіснуючу ноду: ' + e.id); }
    for (const n of flow.nodes) {
        const out = flow.edges.filter((e) => e.source === n.id);
        if (n.type === 'condition') { if (out.length !== n.data.conditions.length) errs.push(n.id + ': ребер ' + out.length + ', умов ' + n.data.conditions.length); }
        else if (TERMINAL.has(n.id)) { if (out.length) errs.push(n.id + ': кінцева нода має вихід'); }
        else if (out.length !== 1) errs.push(n.id + ': виходів ' + out.length + ' (потрібен рівно 1)');
    }
    const seen = new Set(['start_1']); const q = ['start_1'];
    while (q.length) { const c = q.pop(); for (const e of flow.edges.filter((x) => x.source === c)) if (!seen.has(e.target)) { seen.add(e.target); q.push(e.target); } }
    for (const n of flow.nodes) if (!seen.has(n.id)) errs.push(n.id + ': недосяжна нода');
    return errs;
}

module.exports = { TEMPLATE_VERSION, buildFlow, validateFlow };
