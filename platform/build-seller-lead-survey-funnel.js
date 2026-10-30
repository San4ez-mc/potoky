// Воронка «Анкета після заявки з лендінгу seller-lp» (ШІ-помічник продажів для експерта).
// Людина лишає заявку на https://seller-lp.fineko.space → hub.js веде її в бота за посиланням
//   https://t.me/den_fineko_bot?start=lead-<id заявки в Hub>-<підпис>
// → routing у platformBotHandler (Rule 0a) кладе бота seller-lead-survey, payload — у context.startRaw.
// Бот коротко вітається, ставить 4 питання по одному, зберігає відповіді в ТУ САМУ заявку Hub
// (POST /api/lead з lead_id+token) і сповіщає Олександра.
//
// Запуск (локально або на сервері; ключі не лежать у файлі):
//   DATABASE_URL=... HUB_API_KEY=<ключ лендінгу seller-telegram> node build-seller-lead-survey-funnel.js
//   (опційно) TELEGRAM_CONNECTOR_ID=<savedConnector бота>, HANDOFF_TELEGRAM_ID, CLAUDE_CONNECTOR_ID
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_SLUG = '/autonatisations_sales'; // «Продаж автоматизації» — там же ШІ-продавець Дена
const BOT_SLUG = 'seller-lead-survey';
const CLAUDE_SONNET = '2ec53ba5-144e-463b-9758-c217c4a69b0e';
const DEN_CONNECTOR = '1cd281cb-1bcc-4210-8f64-1dfca80c0af9'; // Telegram Den (@den_fineko_bot)

const GREETING = [
  'Привіт, {{user.firstName}}! 👋',
  '',
  'Я ШІ-помічник Олександра Мацука — ви щойно залишили заявку на налаштування ШІ-помічника продажів для експерта. Олександр обов’язково зв’яжеться з вами сам, а я допоможу йому підготуватись: поставлю 4 короткі питання, це хвилина.',
  '',
  'Починаємо: що саме ви продаєте — консультації, розбори, курси чи щось інше?',
].join('\n');

const SYSTEM_PROMPT = [
  'РОЛЬ',
  'Ти — ШІ-помічник Олександра Мацука (він допомагає експертам налаштувати ШІ-помічника, який відповідає на звернення клієнтів і веде їх до запису). Ти НЕ людина і чесно скажеш про це, якщо спитають.',
  'Людина щойно залишила заявку на сайті. Привітання з першим питанням уже надіслане (воно вище в історії). Твоя ціль — коротко зібрати те, що Олександр захоче знати до розмови.',
  '',
  'ЩО ЗІБРАТИ (по одному питанню за повідомлення, у такому порядку)',
  '1. Що людина продає (уже спитано у привітанні).',
  '2. Скільки звернень від потенційних клієнтів вона отримує приблизно на тиждень і звідки вони приходять (Instagram, Telegram, реклама, сарафан…).',
  '3. Як їй зручніше зв’язатися з Олександром: дзвінок, Telegram, інший месенджер.',
  '4. Коли зручно — у які дні й години (або «будь-коли в робочий день»).',
  '',
  'ЯК ВЕСТИ',
  '- Ти коуч, а не допит: коротко відреагуй на відповідь людини одним реченням (по суті сказаного, без лестощів) і став наступне питання.',
  '- До кожного питання, крім 1-го і 4-го, додай 2-3 готові варіанти відповіді одним рядком («1) … 2) … 3) …») і «або напиши своїми словами». Відповісти можна цифрою.',
  '- Максимум 2-3 речення в повідомленні, ОДНЕ питання за раз.',
  '- Людина не хоче відповідати на питання — не наполягай, піти далі. Не знає цифри — нехай назве приблизно або скаже «не знаю».',
  '- Не вигадуй фактів про людину, її бізнес, Олександра, ціни, терміни чи умови. Про ціну, деталі продукту й умови кажи лише: «це обговорить Олександр».',
  '- Нічого не обіцяй, крім одного: Олександр напише або зателефонує протягом робочого дня.',
  '- Не вгадуй стать людини: без дієслів минулого часу, що її вказують.',
  '- Мова: українська, на «ви», якщо людина сама не перейшла на «ти». Відповідай мовою людини.',
  '- Жодного жаргону.',
  '- Не пиши, що «зараз збережу/передам» — просто закінчуй JSON, система зробить решту.',
  '',
  'ВИХІД',
  'Коли отримано відповіді на 3 і 4 питання (або людина чітко не хоче далі) — поверни РІВНО один JSON і більше нічого (ні слова до чи після):',
  '{"name":"імʼя, якщо людина назвала, інакше порожньо","sells":"що продає, словами людини","inquiries":"скільки звернень на тиждень і звідки, словами людини","contact_pref":"як зручно зв’язатися","contact_time":"коли зручно","summary":"1-2 речення для Олександра: хто це і що важливо знати перед розмовою; лише те, що людина сказала"}',
  'Чого людина не сказала — порожній рядок, нічого не вигадуй. JSON = кінець діалогу.',
].join('\n');

// Витягуємо id заявки й підпис з context.startRaw ("lead-12-ab12cd34ef56") або мітку сайту ("site", "site-utm").
const PARSE_CODE = [
  "const raw = String(context.startRaw || '');",
  "const m = raw.match(/^lead-(\d{1,9})-([a-f0-9]{8,16})$/);",
  "const site = raw.match(/^site(?:-([A-Za-z0-9_-]{1,40}))?$/);",
  "return { hubLeadId: m ? Number(m[1]) : 0, hubLeadToken: m ? m[2] : '', fromSite: !!site, siteUtm: site && site[1] ? site[1] : '' };",
].join('\n');

// Прийшов у бота напряму з сайту (/start site[-utm]) і заявки ще нема → створюємо її в Hub, далі анкета дописується в неї.
const ENSURE_CODE = [
  "const out = {};",
  "if (context.hubLeadId && context.hubLeadToken) return out;",
  "try {",
  "  const base = String(keys.HUB_URL || '').replace(/\/$/, '');",
  "  if (!base || !keys.HUB_API_KEY) throw new Error('не задано HUB_URL / HUB_API_KEY');",
  "  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').slice(0, 190);",
  "  const body = { name: name, contact: user.username ? '@' + user.username : '', tg_id: String(user.telegramId || ''), interest: 'Telegram-бот', message: 'Прийшов у бота з сайту' + (context.siteUtm ? ' (мітка: ' + context.siteUtm + ')' : ''), ab: 'entry=bot', page_url: 'https://seller-lp.fineko.space/' };",
  "  if (context.siteUtm) body.utm_source = context.siteUtm;",
  "  const res = await fetch(base + '/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': String(keys.HUB_API_KEY) }, body: JSON.stringify(body) });",
  "  const j = await res.json().catch(() => ({}));",
  "  if (!res.ok || !j || !j.ok || !j.token) throw new Error((j && (j.error || j.message)) || ('HTTP ' + res.status));",
  "  out.hubLeadId = j.id; out.hubLeadToken = j.token; out.hubCreatedHere = true;",
  "} catch (e) { out.hubError = String(e && e.message || e).slice(0, 200); }",
  "return out;",
].join('\n');

// Зберігаємо анкету в Hub. Є id+підпис → дописуємо в ту саму заявку; немає → нова заявка із Telegram-контактом.
// Збій Hub не валить сесію: людина все одно отримує подяку, а Олександр — сповіщення (з позначкою про збій).
const SAVE_CODE = [
  "const r = context.surveyResult || {};",
  "const out = { hubSaved: false, hubError: '' };",
  "try {",
  "  const base = String(keys.HUB_URL || '').replace(/\\/$/, '');",
  "  if (!base || !keys.HUB_API_KEY) throw new Error('не задано HUB_URL / HUB_API_KEY');",
  "  const clip = (v) => String(v == null ? '' : v).slice(0, 600);",
  "  const body = { sells: clip(r.sells), inquiries: clip(r.inquiries), contact_pref: clip(r.contact_pref), contact_time: clip(r.contact_time), summary: clip(r.summary) };",
  "  if (context.hubLeadId && context.hubLeadToken) {",
  "    body.lead_id = context.hubLeadId; body.token = context.hubLeadToken;",
  "  } else { throw new Error(context.hubError || 'нема id заявки в Hub'); }",
  "  const res = await fetch(base + '/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': String(keys.HUB_API_KEY) }, body: JSON.stringify(body) });",
  "  const j = await res.json().catch(() => ({}));",
  "  if (!res.ok || !j || !j.ok) throw new Error((j && (j.error || j.message)) || ('HTTP ' + res.status));",
  "  out.hubSaved = true; out.hubLeadIdSaved = j.id || context.hubLeadId || 0;",
  "} catch (e) { out.hubError = String(e && e.message || e).slice(0, 200); }",
  "return out;",
].join('\n');

const NOTIFY_TEXT = [
  '📝 Анкета в Telegram-боті заповнена',
  '',
  'Заявка в Hub: #{{context.hubLeadIdSaved}} {{context.hubStatusText}}',
  'Імʼя: {{context.surveyResult.name}} ({{user.firstName}})',
  'Telegram: @{{user.username}} · tg://user?id={{user.telegramId}}',
  '',
  '🛒 Продає: {{context.surveyResult.sells}}',
  '📥 Звернення: {{context.surveyResult.inquiries}}',
  '☎️ Зв’язок: {{context.surveyResult.contact_pref}}',
  '🕒 Коли: {{context.surveyResult.contact_time}}',
  '',
  '💡 {{context.surveyResult.summary}}',
].join('\n');

const THANKS = 'Дякую, {{user.firstName}}! Усе передав Олександру. Він напише або зателефонує вам протягом робочого дня. Гарного дня! 🙌';

function buildGraph() {
  const nodes = [
    { id: 'start_1', type: 'start', position: { x: 80, y: 60 }, data: { label: 'Старт', trigger: '/start ' + BOT_SLUG } },
    { id: 'n_parse', type: 'js', position: { x: 80, y: 200 }, data: { label: 'Розібрати посилання з лендінгу', code: PARSE_CODE,
      qaExpectation: 'З context.startRaw (lead-<id>-<підпис>) виходить hubLeadId і hubLeadToken; без посилання — 0 і порожньо.' } },
    { id: 'n_ensure', type: 'js', position: { x: 80, y: 270 }, data: { label: 'Заявка в Hub (якщо прийшов з сайту без форми)', code: ENSURE_CODE,
      qaExpectation: 'Є id+підпис з посилання — нічого не робить. /start site[-мітка] без заявки — створює її в Hub (interest «Telegram-бот»), збій Hub не валить сесію.' } },
    { id: 'n_greet', type: 'message', position: { x: 80, y: 410 }, data: { label: 'Привітання + питання 1', text: GREETING,
      qaExpectation: 'Чесно: ШІ-помічник Олександра Мацука; 4 питання, перше — що продає; без жаргону.' } },
    { id: 'n_ask', type: 'claude', position: { x: 80, y: 480 }, data: { label: 'Анкета (діалог)', mode: 'dialog', model: 'claude-sonnet-4-6',
      connectorId: '{{env.CLAUDE_CONNECTOR_ID}}', systemPrompt: SYSTEM_PROMPT, exitCondition: 'json_output', outputVar: 'context.surveyResult',
      messagesTemplate: '{{conversationHistory}}', temperature: 0.4,
      qaExpectation: 'Одне питання за раз, з варіантами; не вигадує; не наполягає; закінчує JSON з sells/inquiries/contact_pref/contact_time.' } },
    { id: 'n_save', type: 'js', position: { x: 80, y: 620 }, data: { label: 'Зберегти анкету в Hub', code: SAVE_CODE,
      qaExpectation: 'POST /api/lead на leads.fineko.space з lead_id+token; збій Hub не валить сесію.' } },
    { id: 'n_status', type: 'js', position: { x: 80, y: 760 }, data: { label: 'Позначка збереження',
      code: "return { hubStatusText: context.hubSaved ? '(оновлено)' : '⚠️ НЕ збережено в Hub: ' + (context.hubError || 'невідомо') + ' — перепиши вручну', hubLeadIdSaved: context.hubLeadIdSaved || context.hubLeadId || '—' };" } },
    { id: 'n_notify', type: 'notifyAdmin', position: { x: 80, y: 900 }, data: { label: 'Сповістити Олександра', message: NOTIFY_TEXT, targetKey: 'HANDOFF_TELEGRAM_ID' } },
    { id: 'n_thanks', type: 'message', position: { x: 80, y: 1040 }, data: { label: 'Подяка', text: THANKS,
      qaExpectation: 'Дякує, каже що Олександр напише/зателефонує протягом робочого дня; нічого більше не обіцяє.' } },
  ];
  const ids = nodes.map((n) => n.id);
  const edges = [];
  for (let i = 0; i < ids.length - 1; i++) edges.push({ id: `e_${ids[i]}__${ids[i + 1]}`, source: ids[i], target: ids[i + 1] });
  return { nodes, edges };
}

async function main() {
  const { nodes, edges } = buildGraph();
  const project = await prisma.project.findFirst({ where: { slug: PROJECT_SLUG } });
  if (!project) throw new Error('Проєкт ' + PROJECT_SLUG + ' не знайдено');

  let bot = await prisma.bot.findFirst({ where: { slug: BOT_SLUG } });
  const meta = {
    name: 'Анкета після заявки (seller-lp)',
    description: 'Після заявки на лендінгу seller-lp.fineko.space людина приходить у Telegram: ШІ-помічник Олександра Мацука ставить 4 короткі питання (що продає, звернення на тиждень і звідки, як і коли зв’язатись), зберігає відповіді в ту саму заявку FINEKO Hub і сповіщає Олександра.',
    goal: 'Зібрати від людини, що залишила заявку, мінімальну анкету і передати її Олександру разом із заявкою в Hub, нічого не вигадуючи й чесно називаючи себе ШІ.',
  };
  if (!bot) {
    bot = await prisma.bot.create({ data: { projectId: project.id, slug: BOT_SLUG, trigger: 'telegram', isActive: true, ...meta } });
  } else {
    bot = await prisma.bot.update({ where: { id: bot.id }, data: { projectId: project.id, isActive: true, ...meta } });
  }
  await prisma.flowDefinition.upsert({ where: { botId: bot.id }, update: { nodes, edges }, create: { botId: bot.id, nodes, edges } });

  const KEYS = [
    ['HUB_URL', process.env.HUB_URL || 'https://leads.fineko.space', 'FINEKO Hub (адмінка заявок)', false],
    ['HUB_API_KEY', process.env.HUB_API_KEY || '', 'Ключ лендінгу seller-telegram у Hub (Лендінги → Ключ і код)', true],
    ['CLAUDE_CONNECTOR_ID', process.env.CLAUDE_CONNECTOR_ID || CLAUDE_SONNET, 'Claude Sonnet', false],
    ['TELEGRAM_CONNECTOR_ID', process.env.TELEGRAM_CONNECTOR_ID || DEN_CONNECTOR, 'Telegram-бот (Ден, @den_fineko_bot)', false],
    ['HANDOFF_TELEGRAM_ID', process.env.HANDOFF_TELEGRAM_ID || '345126254', 'Кому слати анкети (Олександр)', false],
    ['ADMIN_TELEGRAM_ID', process.env.ADMIN_TELEGRAM_ID || '345126254', 'Власник платформи: алерти про збої', false],
  ];
  for (const [key, value, label, isSecret] of KEYS) {
    const upd = { label, isSecret };
    if (value) upd.value = value;
    await prisma.funnelKey.upsert({ where: { botId_key: { botId: bot.id, key } }, update: upd, create: { botId: bot.id, key, value: value || '', label, isSecret } });
  }
  const missing = KEYS.filter((k) => !k[1]).map((k) => k[0]);
  console.log('OK bot:', bot.id, '| nodes:', nodes.length, '| edges:', edges.length);
  if (missing.length) console.log('УВАГА, порожні ключі:', missing.join(', '));
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
