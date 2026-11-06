'use strict';
// Воронка «Ден продає Fineko CRM» (slug sell-crm) на боті Дена (@den_fineko_bot): /start sell-crm.
// Хід: привітання з поясненням → питання (сфера, що продає, чи є система, що не влаштовує / що має вирішувати) з паралельним продажем →
// збереження відповідей (контент-платформа + сповіщення власнику) → видача тестового доступу до демо-магазину → пауза 12 хв →
// «як враження, питай» → відповіді на питання з бази знань → показ (посилання на календар) / передача Олександру / «пізніше».
// База знань — проєкт контент-платформи «Fineko CRM (продаж Деном)» (скрипт seed-crm-sales-kb-2026-11-06.js), тексти воронки читають її блоки.
// Ключі DEMO_LOGIN / DEMO_PASSWORD беруться з /root/.crm-demo-login.txt на сервері (у чат не друкуються).
// Запуск: PLATFORM_ROOT=$PWD node - < patch-sell-crm-funnel-2026-11-06.js (DRY_RUN=1 — лише показати). Ідемпотентно за slug.
const path = require('path');
const fs = require('fs');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const DRY = !!process.env.DRY_RUN;
const SLUG = 'sell-crm';
const KB_PROJECT = process.env.CRM_KB_PROJECT_ID || 'cmw55qh3r0000q1doj64s5lxd';
const MODEL = 'claude-sonnet-4-6';
const CLAUDE = '{{env.CLAUDE_CONNECTOR_ID}}';

const HEAD = 'Ти — Ден, ШІ-помічник Fineko CRM. Ти ШІ, не видавай себе за людину. «Експерт» у блоках нижче це Олександр Мацук, засновник Fineko CRM.';
const B = (names) => names.map((n) => `{{context.crm.blocks.${n}}}`).join('\n\n');
const RULES_SHORT = 'Чого немає в блоках нижче, того ти не знаєш: кажи «це до Олександра» й не вигадуй. Ціну не називай ніколи. Слів «воронка», «лід», «конверсія», «оптимізація», «масштабування» не вживай. Імʼя людини вживай рівно так, як вона його написала, у називному відмінку, не відмінюй і не вигадуй форм. Мова: мовою останнього повідомлення людини; звертання на «ти», якщо людина не просить «Ви».';

const GREET = [
  HEAD, '', B(['offer', 'tone', 'rules']), '',
  '━━━ ПЕРШЕ ПОВІДОМЛЕННЯ ━━━',
  'Людина щойно відкрила бота. Напиши 6-7 коротких рядків, кожна думка з нового рядка:',
  '1) «Привіт, <імʼя в Telegram>! Я Ден, ШІ-помічник Fineko CRM» (без вгадування роду).',
  '2) Одним реченням, що це: програма для Instagram-магазинів і дропшиперів, де всі замовлення, посилки Нової пошти, реклама й реальний прибуток в одному місці, без Excel.',
  '3) Що буде далі, майже дослівно: «Я задам кілька питань, щоб точно зрозуміти, що тобі потрібно, а потім відкрию тестовий доступ до системи: там можна клацати на прикладі магазину».',
  '4) Перше питання: у якій сфері ти працюєш і що продаєш? Дай 3-4 варіанти, КОЖЕН З НОВОГО РЯДКА («1) одяг і взуття», «2) аксесуари», «3) товари для дому», «4) інше»), далі окремим рядком «або напиши своїми словами».',
  'Заборонено: ціни, вигадані цифри й відгуки, «Привіт! Я радий допомогти». Максимум 8 рядків.',
].join('\n');

const ASK = [
  HEAD, '', B(['all']), '',
  '━━━ ТВОЯ ЗАДАЧА: ЗНАЙОМСТВО І ПАРАЛЕЛЬНО ПРОДАЖ ━━━',
  RULES_SHORT,
  'Привітання вже надіслано (воно вище в історії), перше питання про сферу вже поставлено. Кожне твоє повідомлення: максимум 3 речення + ОДНЕ питання, ніколи два питання разом. Що людина вже сказала, не перепитуй.',
  'Питання по черзі:',
  '1) Сфера й що саме продає (якщо відповіла лише сферою, уточни, що саме).',
  '2) Як і де продає: Instagram, сайт, інше; свій товар чи через постачальників (дропшипінг).',
  '3) Чи користується вже якоюсь системою для замовлень (CRM, таблиця Excel, Telegram, зошит)? Дай варіанти кожен з нового рядка: «1) так, CRM», «2) Excel або таблиця», «3) нотатки й переписка», «4) нічого».',
  '4а) Якщо користується CRM або іншою системою: спитай, якою саме, потім «що в ній не влаштовує?». Допитуйся конкретики одним уточненням (що саме незручно, чого бракує, що ламається, чи дорого). Записуй її словами. Чужу систему не критикуй, не порівнюй і не називай її недоліків сама: людина говорить, ти слухаєш.',
  '4б) Якщо системи нема (таблиця, нотатки, нічого): спитай, що для неї головне, щоб система вирішувала. Варіанти кожен з нового рядка: «1) бачити всі замовлення в одному місці», «2) знати реальний прибуток», «3) статуси посилок Нової пошти», «4) яка реклама приносить замовлення», «5) порядок із постачальниками й менеджерами», далі «або своїми словами; можна кілька».',
  'ПАРАЛЕЛЬНО ПРОДАЄШ: після кожної відповіді людини (крім першої) перед наступним питанням додай ОДНЕ-ДВА речення з блоку «АКТУАЛЬНІ ФАКТИ» про те, що в Fineko CRM стосується саме її відповіді (дропшипінг → постачальники й ціна на дату замовлення; Excel → статуси Нової пошти самі й прибуток по кожному замовленню; не влаштовує складність або склад → CRM лише для магазину під замовлення, склад не потрібен; реклама → яке оголошення привело замовлення). Один факт за раз, не повторюй уже сказаний, без вигаданих цифр і відгуків. Це не лекція.',
  'ФОРМАТ ВАРІАНТІВ: коли даєш готові варіанти відповіді, КОЖЕН з нового рядка (порожній рядок після питання, далі по одному варіанту на рядок). Те саме для будь-якого переліку.',
  'КОЛИ ДОСТАТНЬО: коли знаєш сферу й що продає, як продає, чи є система (якщо є: яка й що не влаштовує; якщо нема: що має вирішувати). Не тягни понад 6-7 обмінів. Людина питає про ціну чи просить доступ раніше: коротко відповідай за блоками («суму називає Олександр після короткої розмови») і веди до наступного питання; якщо вже знаєш головне, виходь.',
  'Не пиши від імені людини, не бронюй і не телефонуй. Не обіцяй того, чого нема в блоках.',
  '━━━ ВИХІД ━━━',
  'Коли достатньо, поверни РІВНО один JSON і більше нічого (ні слова до чи після):',
  '{"done":true,"name":"імʼя або порожньо","sphere":"сфера","sells":"що продає","channel":"де продає","dropship":"yes|no|unknown","hasSystem":"yes|no","systemName":"назва системи або порожньо","dislikes":"що не влаштовує, ЇЇ СЛОВАМИ, або порожньо","needs":"що має вирішувати система, її словами, або порожньо","orders":"скільки замовлень, якщо казала, або порожньо"}',
].join('\n');

const TIP = [
  HEAD, '', B(['facts']), '', RULES_SHORT, '',
  'Людина щойно отримала тестовий доступ до демо-магазину. Напиши 4-5 коротких рядків:',
  '1) Одне речення: «Дякую, зрозумів твою ситуацію».',
  '2) «Що глянути першим саме тобі:» і 2-3 пункти КОЖЕН З НОВОГО РЯДКА («1) …»), привʼязані до її відповідей (її сфера, система, що не влаштовує або що має вирішувати) і до фактів вище. Назви розділи простими словами (замовлення, аналітика, реклама, постачальники, повернення).',
  '3) «Поклацай 10-15 хвилин, потім я запитаю, як враження.»',
  'Без вигаданих цифр і слів, яких не вживати.',
].join('\n');

const CHECKIN = [
  HEAD, '', B(['tone']), '',
  'Людина отримала тестовий доступ ~12 хвилин тому. Напиши 2-3 короткі рядки: спитай, що встигла побачити, що сподобалось і що незрозуміло; скажи, що можна питати про що завгодно щодо системи, відповіси. Без тиску, без ціни. Одне питання наприкінці. Не вітайся заново.',
].join('\n');

const QA = [
  HEAD, '', B(['offer', 'facts', 'faq', 'rules', 'tone']), '',
  '━━━ ТВОЯ ЗАДАЧА: ВІДПОВІДІ НА ПИТАННЯ ПІСЛЯ ДЕМО ━━━',
  RULES_SHORT,
  'Людина клацала в демо-магазині й тепер питає. Відповідай по суті, лише за блоками: що вміє система, чого нема (кажи чесно), як почати. Кожна відповідь: 2-4 речення, наприкінці одне м’яке питання або крок («Що ще цікавить?»). Не повторюй вітання.',
  'Якщо людина питає, як подивитись на своїх даних, скільки часу займає, чи підійде їй: поясни за фактами «Як почати» й «Чого в CRM немає» (налаштування кілька днів разом з нами, не «за 5 хвилин»).',
  'Після 2-3 відповідей запропонуй короткий показ на 15 хвилин на її замовленнях одним реченням («Хочеш, покажу на твоїх замовленнях? Це 15 хвилин»). Не питай «цікаво?».',
  'ВИХІД. Коли є рішення, поверни РІВНО один JSON і більше нічого:',
  '{"outcome":"show|handoff|later","name":"імʼя або порожньо","interest":"що найбільше зацікавило","questions":"її основні питання","note":"заперечення або побажання"}',
  '• show: людина сама хоче показ або погодилась на твою пропозицію показу (або питає, як підключити свій магазин).',
  '• handoff: питає ціну, договір, рахунок, оплату, хоче підключити магазин зараз, просить поговорити з людиною чи Олександром, складна інтеграція, скарга. Ціну сама не називай.',
  '• later: «подумаю», «не зараз», мало часу, не зацікавилась; після однієї спроби запропонувати показ. Після ~8 обмінів без рішення теж later.',
  'JSON = кінець діалогу.',
].join('\n');

const SHORT = (task) => [HEAD, '', B(['tone', 'rules']), '', RULES_SHORT, '', task].join('\n');

const LOAD = `
const out = { crmOk: false, crm: null, crmError: '' };
try {
  const pid = String(keys.CRM_KB_PROJECT_ID || '').trim();
  const base = String(keys.CONTENT2_URL || '').replace(/\\/$/, '');
  if (!pid || !base || !keys.CONTENT2_WEBHOOK_SECRET) throw new Error('не задано CRM_KB_PROJECT_ID / CONTENT2_URL / CONTENT2_WEBHOOK_SECRET');
  const res = await fetch(base + '/api/webhooks/seller-brief', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': String(keys.CONTENT2_WEBHOOK_SECRET) }, body: JSON.stringify({ projectId: pid, telegramId: String(user.telegramId || '') }), signal: AbortSignal.timeout(10000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j || !j.ok || !j.blocks) throw new Error((j && j.error) || ('HTTP ' + res.status));
  out.crm = j; out.crmOk = true;
} catch (e) { out.crmError = String(e && e.message || e).slice(0, 300); }
return out;
`;

const SAVE = `
const out = { interviewSaved: false, interviewText: '', ownerText: '' };
const d = context.discovery || {};
const who = [d.name || user.firstName || '', user.username ? '@' + user.username : '', 'tg ' + (user.telegramId || '')].filter(Boolean).join(', ');
const line = (k, v) => (v ? k + ': ' + v : '');
out.interviewText = [
  line('Хто', who), line('Сфера', d.sphere), line('Що продає', d.sells), line('Де продає', d.channel), line('Дропшипінг', d.dropship), line('Замовлень', d.orders),
  line('Користується системою', d.hasSystem === 'yes' ? 'так' + (d.systemName ? ': ' + d.systemName : '') : (d.hasSystem === 'no' ? 'ні' : '')),
  line('Що не влаштовує у поточній системі', d.dislikes), line('Що система має вирішувати', d.needs), line('Дата', new Date().toISOString().slice(0, 10)),
].filter(Boolean).join('\\n');
out.ownerText = '🧩 Fineko CRM: нове знайомство (Ден)\\n\\n' + out.interviewText + '\\n\\nТестовий доступ видано. Сесія: ' + session.id;
try {
  const base = String(keys.CONTENT2_URL || '').replace(/\\/$/, '');
  const res = await fetch(base + '/api/webhooks/onboarding-save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': String(keys.CONTENT2_WEBHOOK_SECRET) }, body: JSON.stringify({ projectId: String(keys.CRM_KB_PROJECT_ID), kind: 'doc', data: { fileName: 'CRM-інтерв\\'ю: ' + (d.name || user.firstName || 'без імені') + ' (tg ' + user.telegramId + ')', text: out.interviewText } }), signal: AbortSignal.timeout(10000) });
  out.interviewSaved = res.ok;
} catch (e) { /* збереження не критичне: власник отримає сповіщення */ }
return out;
`;

const ACCESS = `
return { demoUrl: String(keys.DEMO_URL || ''), demoLogin: String(keys.DEMO_LOGIN || ''), demoPassword: String(keys.DEMO_PASSWORD || '') };
`;

const SHOW_URL = `
const base = String(keys.CALENDAR_URL || 'https://calendar.fineko.space').replace(/\\/$/, '');
const slug = String(keys.CALENDAR_PUBLIC_SLUG || 'matsuk');
const d = context.discovery || {}; const q = context.qa_result || {};
const nm = q.name || d.name || user.firstName || '';
return { showUrl: base + '/book/' + slug + '?' + new URLSearchParams({ tg: String(user.telegramId || ''), n: String(nm), u: String(user.username || ''), s: 'sell-crm' }).toString() };
`;

const ACCESS_TEXT = [
  'Дякую! Відкриваю тестовий доступ до системи 👇',
  '',
  'Це демо-магазин з вигаданими даними (замовлення, постачальники, товари, реклама), клацай що завгодно.',
  '',
  'Посилання: {{context.demoUrl}}',
  'Логін: {{context.demoLogin}}',
  'Пароль: {{context.demoPassword}}',
  '',
  'Вхід відкриється через єдиний вхід FINEKO: введи логін і пароль вище.',
].join('\n');

const OWNER_TAIL = '\nTelegram: @{{user.username}} · tg://user?id={{user.telegramId}}';

async function add(botId, type, position, data) {
  if (DRY) return { id: `dry_${type}_${Math.random().toString(36).slice(2, 6)}` };
  const r = await callTool('add_node', { botId, type, position, data });
  return r.added;
}
const edge = async (botId, source, target) => { if (!DRY) await callTool('create_edge', { botId, source, target }); };
const setKey = async (botId, k, value, label, isSecret) => { if (!value) { console.log('    ! нема значення для', k); return; } console.log('    ✔ ключ', k); if (!DRY) await callTool('update_funnel_key', { botId, key: k, value, label, isSecret: !!isSecret }); };

(async () => {
  const existing = await db.bot.findFirst({ where: { slug: SLUG } });
  if (existing) {
    const f = await callTool('get_funnel', { botId: existing.id });
    if ((f.nodes || []).length > 3) { console.log('Воронка ' + SLUG + ' уже є (' + f.nodes.length + ' вузлів), нічого не роблю'); process.exit(0); }
  }
  const den = await db.bot.findFirst({ where: { slug: 'bot-karta-sales' }, include: { project: true } });
  const seller = await db.bot.findFirst({ where: { slug: 'sell-ai-seller' } });
  if (!den || !seller) throw new Error('не знайдено bot-karta-sales / sell-ai-seller');
  const kv = async (botId, k) => { const r = await db.funnelKey.findFirst({ where: { botId, key: k }, select: { value: true } }); return r ? r.value : ''; };
  console.log('Проєкт:', den.project.name, '(' + den.project.slug + ')');

  let botId;
  if (existing) botId = existing.id;
  else if (DRY) botId = 'dry_bot';
  else {
    const nb = await callTool('new_bot', { projectSlug: den.project.slug, name: 'Ден продає Fineko CRM', slug: SLUG, description: 'Ден (ШІ) знайомиться з власником Instagram-магазину або дропшипером (сфера, що продає, чи є система, що не влаштовує), паралельно розповідає про Fineko CRM, видає тестовий доступ до демо-магазину, відповідає на питання й веде на показ у календар.', goal: 'Дізнатись про клієнта й його поточну систему (що не влаштовує, що має вирішувати), видати тестовий доступ, відповісти на питання з бази знань і довести до запису на показ 15 хвилин.', trigger: '/start ' + SLUG, isActive: true });
    botId = (nb.bot && nb.bot.id) || nb.botId || nb.id;
    if (!botId) throw new Error('new_bot не повернув id: ' + JSON.stringify(nb).slice(0, 200));
  }
  console.log('Бот:', botId);

  // прибрати дефолтні вузли нового бота (крім start): msg_intro перехоплює перший хід
  let startId = 'start_1';
  if (!DRY) {
    const f0 = await callTool('get_funnel', { botId });
    const st = (f0.nodes || []).find((n) => n.type === 'start');
    if (st) startId = st.id;
    for (const n of (f0.nodes || []).filter((x) => x.type !== 'start')) await callTool('delete_node', { botId, nodeId: n.id });
    await callTool('update_node', { botId, nodeId: startId, data: { label: 'Старт /start ' + SLUG, trigger: '/start ' + SLUG } });
  }

  // ключі воронки
  await setKey(botId, 'TELEGRAM_CONNECTOR_ID', await kv(den.id, 'TELEGRAM_CONNECTOR_ID'), 'Telegram-бот Дена', false);
  await setKey(botId, 'TELEGRAM_BOT_USERNAME', await kv(den.id, 'TELEGRAM_BOT_USERNAME') || 'den_fineko_bot', 'Імʼя бота', false);
  await setKey(botId, 'CLAUDE_CONNECTOR_ID', await kv(den.id, 'CLAUDE_CONNECTOR_ID') || await kv(seller.id, 'CLAUDE_CONNECTOR_ID'), 'Claude для воронок', false);
  await setKey(botId, 'ADMIN_TELEGRAM_ID', await kv(den.id, 'ADMIN_TELEGRAM_ID'), 'Власник (сповіщення)', false);
  await setKey(botId, 'HANDOFF_TELEGRAM_ID', await kv(den.id, 'ADMIN_TELEGRAM_ID'), 'Кому передавати розмову', false);
  await setKey(botId, 'CONTENT2_URL', await kv(seller.id, 'CONTENT2_URL'), 'Контент-платформа', false);
  await setKey(botId, 'CONTENT2_WEBHOOK_SECRET', await kv(seller.id, 'CONTENT2_WEBHOOK_SECRET'), 'Контент-платформа: секрет вебхука', true);
  await setKey(botId, 'CRM_KB_PROJECT_ID', KB_PROJECT, 'База знань Fineko CRM (проєкт контент-платформи)', false);
  await setKey(botId, 'CALENDAR_URL', await kv(seller.id, 'CALENDAR_URL') || 'https://calendar.fineko.space', 'Календар', false);
  await setKey(botId, 'CALENDAR_PUBLIC_SLUG', await kv(seller.id, 'CALENDAR_PUBLIC_SLUG') || 'matsuk', 'Календар: сторінка запису', false);
  await setKey(botId, 'DEMO_URL', 'https://pcrm.fineko.space', 'Демо-доступ: посилання на CRM', false);
  let login = ''; let pwd = '';
  try { const t = fs.readFileSync('/root/.crm-demo-login.txt', 'utf8'); login = (t.match(/^login=(.*)$/m) || [])[1] || ''; pwd = (t.match(/^password=(.*)$/m) || [])[1] || ''; } catch (e) { console.log('    ! нема /root/.crm-demo-login.txt'); }
  await setKey(botId, 'DEMO_LOGIN', login, 'Демо-доступ: логін', false);
  await setKey(botId, 'DEMO_PASSWORD', pwd, 'Демо-доступ: пароль', true);

  const X = 160; let Y = 0; const pos = () => ({ x: X, y: (Y += 120) });
  const claude = (label, systemPrompt, over) => add(botId, 'claude', pos(), { label, model: MODEL, connectorId: CLAUDE, systemPrompt, ...over });
  const stage = (label, name, order) => add(botId, 'flowStage', pos(), { label: 'Етап: ' + label, stageName: name, stageOrder: order });
  const chain = async (...ids) => { for (let i = 0; i < ids.length - 1; i++) await edge(botId, ids[i], ids[i + 1]); };

  const stOpen = await stage('Відкрив бота', 'Відкрив бота', 1);
  const nLoad = await add(botId, 'js', pos(), { label: 'Завантажити базу Fineko CRM', code: LOAD, qaExpectation: 'Бере блоки бази знань із контент-платформи; збій не валить розмову.' });
  const nGate = await add(botId, 'condition', pos(), { label: 'База доступна?', conditions: [{ id: 'c_err', label: 'База недоступна', expression: '!context.crmOk' }, { id: 'c_ok', label: 'Є', expression: 'true' }] });
  const nErrN = await add(botId, 'notifyTg', pos(), { label: 'Збій бази: алерт власнику', message: '⚠️ Ден (Fineko CRM): база знань недоступна: {{context.crmError}}' + OWNER_TAIL, targetKey: 'ADMIN_TELEGRAM_ID' });
  const nErrM = await add(botId, 'message', pos(), { label: 'Збій бази: людині', text: 'Вибач, у мене зараз технічна пауза. Напиши, будь ласка, Олександру напряму: t.me/olexandrmatsuk, він швидко допоможе.' });
  const nLead = await add(botId, 'notifyTg', pos(), { label: 'Новий лід Fineko CRM', message: '🚀 Нова розмова: Ден продає Fineko CRM' + OWNER_TAIL + '\nІмʼя в Telegram: {{user.firstName}} {{user.lastName}}', targetKey: 'ADMIN_TELEGRAM_ID' });
  const nGreet = await claude('Вітання', GREET, { mode: 'single', outputVar: 'context.live_greeting', exitCondition: 'none', messagesTemplate: '[{"role":"user","content":"Людина щойно відкрила бота. Імʼя в Telegram: {{user.firstName}}."}]', qaExpectation: 'Привіт, я Ден, ШІ-помічник Fineko CRM; що буде далі (питання, потім тестовий доступ); перше питання про сферу з варіантами по рядку; без цін і вигаданих цифр.' });
  const nAsk = await claude('Знайомство: питання і продаж', ASK, { mode: 'dialog', outputVar: 'context.discovery', exitCondition: 'json_output', messagesTemplate: '{{conversationHistory}}', qaExpectation: 'Питає сферу, що продає, чи є система, що не влаштовує (або що має вирішувати); паралельно коротко розповідає про можливості з фактів; одне питання за раз; не критикує чужу систему; закінчує JSON.' });
  const stAsked = await stage('Відповів на питання', 'Відповів на питання', 2);
  const nSave = await add(botId, 'js', pos(), { label: 'Зберегти знайомство', code: SAVE, qaExpectation: 'Записує відповіді людини в контент-платформу (док «CRM-інтервʼю») і готує текст власнику.' });
  const nSaveN = await add(botId, 'notifyTg', pos(), { label: 'Знайомство: сповіщення власнику', message: '{{context.ownerText}}', targetKey: 'ADMIN_TELEGRAM_ID' });
  const nAcc = await add(botId, 'js', pos(), { label: 'Дані тестового доступу', code: ACCESS });
  const nAccM = await add(botId, 'message', pos(), { label: 'Видати тестовий доступ', text: ACCESS_TEXT, buttons: [[{ text: '🔗 Відкрити Fineko CRM', url: '{{context.demoUrl}}' }]] });
  const stAcc = await stage('Отримав тестовий доступ', 'Отримав тестовий доступ', 3);
  const nTip = await claude('Що глянути першим', TIP, { mode: 'single', outputVar: 'context.live_tip', exitCondition: 'none', messagesTemplate: '[{"role":"user","content":"Ситуація людини: сфера {{context.discovery.sphere}}; продає {{context.discovery.sells}}; система: {{context.discovery.systemName}}; не влаштовує: {{context.discovery.dislikes}}; має вирішувати: {{context.discovery.needs}}."}]', qaExpectation: 'Короткі підказки, що глянути першим саме цій людині; без вигаданих цифр.' });
  const nWait = await add(botId, 'wait', pos(), { label: 'Пауза: поклацати 12 хв', unit: 'minutes', duration: 12 });
  const nChk = await claude('Як враження? Питай', CHECKIN, { mode: 'single', outputVar: 'context.live_checkin', exitCondition: 'none', messagesTemplate: '[{"role":"user","content":"Людина отримала доступ 12 хвилин тому. Імʼя: {{context.discovery.name}}. Її ситуація: {{context.discovery.sells}}."}]', qaExpectation: 'Питає про враження й запрошує задавати питання; без тиску й ціни.' });
  const nQa = await claude('Відповіді на питання', QA, { mode: 'dialog', outputVar: 'context.qa_result', exitCondition: 'json_output', messagesTemplate: '{{conversationHistory}}', qaExpectation: 'Відповідає лише за базою; чесно каже, чого нема; не називає ціну; пропонує показ; закінчує JSON {outcome}.' });
  const nOut = await add(botId, 'condition', pos(), { label: 'Результат розмови', conditions: [{ id: 'o_show', label: 'Хоче показ', expression: "context.qa_result.outcome === 'show'" }, { id: 'o_hand', label: 'Передати Олександру', expression: "context.qa_result.outcome === 'handoff'" }, { id: 'o_later', label: 'Пізніше / не зараз', expression: 'true' }] });
  const nShowU = await add(botId, 'js', pos(), { label: 'Посилання на запис на показ', code: SHOW_URL });
  const nShowM = await add(botId, 'message', pos(), { label: 'Запис на показ', text: 'Чудово! Обери час для короткого показу (15 хвилин), коли тобі зручно:\n\n{{context.showUrl}}\n\nОлександр покаже систему на твоїх замовленнях. Якщо зручніше домовитись у чаті, напиши час тут.', buttons: [[{ text: '📅 Обрати час показу', url: '{{context.showUrl}}' }]] });
  const stShow = await stage('Хоче показ', 'Хоче показ', 4);
  const nShowN = await add(botId, 'notifyTg', pos(), { label: 'Хоче показ: сповіщення', message: '🔥 Хоче показ Fineko CRM\n\nІмʼя: {{context.qa_result.name}}\nСфера: {{context.discovery.sphere}}; продає: {{context.discovery.sells}}\nСистема: {{context.discovery.systemName}}; не влаштовує: {{context.discovery.dislikes}}\nЩо цікавило: {{context.qa_result.interest}}\nПитання: {{context.qa_result.questions}}' + OWNER_TAIL, targetKey: 'ADMIN_TELEGRAM_ID' });
  const nHandN = await add(botId, 'notifyTg', pos(), { label: 'Передати Олександру: сповіщення', message: '🙋 Просить Олександра (Fineko CRM)\n\nІмʼя: {{context.qa_result.name}}\nСфера: {{context.discovery.sphere}}; продає: {{context.discovery.sells}}\nЩо питає: {{context.qa_result.questions}}\nПримітка: {{context.qa_result.note}}' + OWNER_TAIL, targetKey: 'HANDOFF_TELEGRAM_ID' });
  const nHandM = await claude('Передати Олександру: людині', SHORT('Людина просить поговорити з Олександром, питає ціну, договір чи підключення. Напиши 2 короткі речення: скажи, що передав Олександру й він напише в Telegram; контакт можеш дати лише з блоку «Контакти, які можна називати». Ціну не називай, терміну відповіді не обіцяй.'), { mode: 'single', outputVar: 'context.live_handoff', exitCondition: 'none', messagesTemplate: '[{"role":"user","content":"Остання репліка людини: {{input}}. Її питання: {{context.qa_result.questions}}."}]', qaExpectation: 'Каже, що передано Олександру; не називає ціни; не обіцяє часу відповіді.' });
  const stHand = await stage('Просить Олександра', 'Просить Олександра', 5);
  const nLaterM = await claude('Пізніше: м’який вихід', SHORT('Людина не готова зараз. Напиши 2 короткі речення: без тиску скажи, що тестовий доступ лишається, можна повертатися й питати. Одне речення про те, що можна написати Олександру напряму, якщо контакт є в блоці «Контакти, які можна називати».'), { mode: 'single', outputVar: 'context.live_later', exitCondition: 'none', messagesTemplate: '[{"role":"user","content":"Остання репліка людини: {{input}}. Імʼя: {{context.qa_result.name}}."}]', qaExpectation: 'Мʼякий вихід без тиску, доступ лишається.' });
  const stLater = await stage('Пізніше', 'Пізніше', 6);
  const nLaterN = await add(botId, 'notifyTg', pos(), { label: 'Пізніше: сповіщення', message: '💤 Не готова зараз (Fineko CRM)\n\nІмʼя: {{context.qa_result.name}}\nСфера: {{context.discovery.sphere}}; продає: {{context.discovery.sells}}\nСистема: {{context.discovery.systemName}}; не влаштовує: {{context.discovery.dislikes}}\nПримітка: {{context.qa_result.note}}' + OWNER_TAIL, targetKey: 'ADMIN_TELEGRAM_ID' });

  const id = (n) => n.id;
  await chain(startId, id(stOpen), id(nLoad), id(nGate));
  await edge(botId, id(nGate), id(nErrN)); await edge(botId, id(nGate), id(nLead)); // порядок = порядок умов
  await chain(id(nErrN), id(nErrM));
  await chain(id(nLead), id(nGreet), id(nAsk), id(stAsked), id(nSave), id(nSaveN), id(nAcc), id(nAccM), id(stAcc), id(nTip), id(nWait), id(nChk), id(nQa), id(nOut));
  await edge(botId, id(nOut), id(nShowU)); await edge(botId, id(nOut), id(nHandN)); await edge(botId, id(nOut), id(nLaterM)); // show / handoff / later
  await chain(id(nShowU), id(nShowM), id(stShow), id(nShowN));
  await chain(id(nHandN), id(nHandM), id(stHand));
  await chain(id(nLaterM), id(stLater), id(nLaterN));
  console.log('Воронка ' + SLUG + ' ' + (DRY ? '(dry-run)' : 'збудована') + '. Посилання: https://t.me/den_fineko_bot?start=' + SLUG);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.stack ? e.stack.slice(0, 500) : e); process.exit(1); });
