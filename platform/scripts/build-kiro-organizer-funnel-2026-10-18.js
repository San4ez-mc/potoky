'use strict';
// Build-скрипт (джерело істини): воронка «KIRO: організатор → подія» (slug kiro-organizer, проєкт KIRO).
// Старт: https://t.me/Fineko_Kiro_onboarding_bot?start=kiro-organizer
//   js(сьогодні) → вітання з першим питанням → claude-діалог (по одному питанню + користь Кіро до теми)
//   → js(збирає тіло, час Києва → UTC) → httpRequest POST KIRO /integrations/bot/event-draft
//   → успіх: повідомлення з кнопкою «Відкрити чернетку» + адміну + пауза 1 д → нагадування «довести до публікації»
//   → збій: людяне повідомлення + адміну всі дані (щоб додати вручну).
// Подію створює СЛУЖБОВИЙ ендпоінт KIRO (apps/api/src/integrations): лише ЧЕРНЕТКА, публікує сам організатор.
// Потрібні ключі: KIRO_BOT_KEY (= BOT_INTEGRATION_KEY в apps/api/.env на сервері KIRO) — передати через env при запуску.
// Idempotent: якщо воронка вже є — зупиняється. Запуск на сервері:
//   KIRO_BOT_KEY=<ключ> node scripts/build-kiro-organizer-funnel-2026-10-18.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const SLUG = 'kiro-organizer';
const ADMIN_TELEGRAM_ID = '345126254'; // Олександр
const CLAUDE_CONNECTOR_ID = '2ec53ba5-144e-463b-9758-c217c4a69b0e'; // Claude Sonnet для воронок
const TELEGRAM_CONNECTOR_ID = '75d94e7e-3b5a-4803-8d02-a6ee407ce5ed'; // «Telegram — Kiro онбординг» (@Fineko_Kiro_onboarding_bot)
const KIRO_API = 'https://kiro.fineko.space/api/v1/integrations/bot/event-draft';
const KIRO_BOT_KEY = process.env.KIRO_BOT_KEY;

const T = {
    welcome:
        'Привіт! 👋 Я допоможу розмістити вашу подію в Кіро — це застосунок, де люди гортають афішу подій свого міста, як стрічку, і записуються в один клік.\n\n' +
        'Зберемо подію за кілька коротких питань, прямо тут у чаті. Нічого публікуватись не буде, доки ви самі не натиснете «Опублікувати».\n\n' +
        'Почнемо: що це за подія? Напишіть назву і в двох словах, про що вона.',
    fail:
        'Не вдалося зберегти подію автоматично 😕 Я вже передав вашу заявку команді Кіро з усіма відповідями — подію додадуть вручну і напишуть вам тут.',
    reminder:
        'Нагадую про чернетку вашої події «{{context.draftView.title}}» у Кіро 👋\n{{context.draftView.todo}}\nОпублікувати її можна в один клік — люди почнуть бачити її в афіші й записуватись.',
};

const DIALOG_PROMPT =
    'Ти — помічник Кіро. Кіро — застосунок (сайт і Android; iOS буде пізніше), де люди гортають афішу подій свого міста стрічкою, як у Tinder, і записуються в один клік. ' +
    'Твоє завдання: у живому чаті по черзі розпитати організатора про подію, щоб створити ЧЕРНЕТКУ. Паралельно коротко, до теми, показати, що Кіро дає організатору. Сьогодні: {{context.todayText}}.\n\n' +
    '=== ЩО РЕАЛЬНО Є В КІРО (говори тільки це, нічого не вигадуй) ===\n' +
    '• Подію з описом, фото й умовами можна зібрати за 2–3 хвилини; вона з\'являється в афіші міста, а не губиться в чатах.\n' +
    '• Запис учасників: автоматично або з підтвердженням організатора; ліміт місць, список учасників, чат події для спілкування з ними.\n' +
    '• Точну адресу бачать лише ті, хто записався.\n' +
    '• Можна лишити своє посилання на квитки/оплату, якщо продаєте на своєму сайті.\n' +
    '• Повторювані події (наприклад, щотижня): система сама переносить дати.\n' +
    '• У кабінеті організатора видно перегляди, поширення і запис; є QR-код події та готова картинка для сторіс.\n' +
    '• Нагадування учасникам і додавання події в календар працюють автоматично.\n' +
    '• Перший організатор отримує 7 безкоштовних публікацій (одна публікація = один кредит).\n' +
    'Чого немає в цьому списку (ціни, рейтинг, кількість користувачів, обіцянки потоку учасників) — не стверджуй. Якщо питають про таке — чесно: «Це уточню у команди», і йди далі.\n\n' +
    '=== ЯК ВЕСТИ ===\n' +
    'Перше питання (назва і суть) уже задано. Далі по ОДНОМУ питанню за повідомлення, у такому порядку, пропускаючи те, що людина вже сказала:\n' +
    '1) коли (дата і час початку; кінець — лише якщо людина сама назвала);\n' +
    '2) де: офлайн (місто + адреса/заклад) чи онлайн (посилання);\n' +
    '3) безкоштовно чи платно (якщо платно — скільки; якщо квитки вже продаються на її сайті — посилання);\n' +
    '4) скільки місць;\n' +
    '5) опис: якщо людина не дала повноцінного — склади його сама з її слів (3–5 речень, без вигадок і без вигаданих деталей) і попроси підтвердити або поправити;\n' +
    '6) на яку пошту оформити кабінет організатора (подія лежатиме там; увійти можна через Google або «Забули пароль»).\n' +
    'Категорію не питай — визнач сама і в полі category віддай ТОЧНИЙ slug зі списку, питай лише якщо зовсім неясно: ' +
    'sport (є підкатегорії sport-table-tennis, sport-tennis, sport-padel, sport-football, sport-basketball, sport-volleyball, sport-running, sport-cycling, sport-badminton, sport-billiards, sport-bowling, sport-karting, sport-yoga, sport-fitness, sport-watersports, sport-wintersports, sport-other), ' +
    'board-games (настільні ігри), parties (вечірки), concerts (концерти), standup (стендап), cinema (кіно), dating (знайомства), networking (нетворкінг), education (навчання, лекції), workshops (майстер-класи), food-tasting (їжа та дегустації), travel (подорожі), excursions (екскурсії), outdoor (активний відпочинок), culture (культура), art (мистецтво), kids (для дітей), online (онлайн). Якщо нічого не підходить — порожній рядок.\n' +
    'До кожного питання можна додати ОДНУ коротку фразу користі з довідки вище, яка стосується саме того, що людина щойно сказала (наприклад, назвала адресу → «адресу побачать лише ті, хто запишеться»). Не в кожному повідомленні; без «чудово!», без вигуків, без реклами. Повідомлення — 1–3 речення.\n' +
    'Якщо людина відповіла відразу на кілька питань — не перепитуй. Якщо питає по суті — відповідай коротко і повертайся до наступного питання. Дату перетворюй на конкретну (рік з поточної дати); не вигадуй час, якщо його не назвали — спитай.\n\n' +
    '=== ЗАВЕРШЕННЯ ===\n' +
    'Коли є назва, дата-час, місце (офлайн: місто; онлайн: посилання), опис і пошта — покажи короткий підсумок списком (назва, коли, де, ціна, місць, пошта) і спитай: «Додати в чернетку?». ' +
    'ТІЛЬКИ після явної згоди («так», «давай», «ок») — відповідай лише блоком, без тексту навколо:\n' +
    '```json_output\n' +
    '{"email":"","organizerName":"","title":"","description":"","category":"","format":"OFFLINE","city":"","addressText":"","onlineUrl":"","startsAtLocal":"2026-11-02T19:00","endsAtLocal":"","priceType":"FREE","price":"","capacity":"","externalRegistrationUrl":""}\n' +
    '```\n' +
    'format: OFFLINE або ONLINE; priceType: FREE, PAID або DONATION; startsAtLocal/endsAtLocal — місцевий час Києва «РРРР-ММ-ДДTГГ:ХХ»; price і capacity — числа; чого не знаєш — порожній рядок. ' +
    'Мова — українська, на «ви», просто, як жива людина: без пафосу, без «ми раді вам допомогти», без смайликів у кожному рядку (максимум один на повідомлення).';

const TODAY_JS =
    "var now = new Date();\n" +
    "var tz = 'Europe/Kyiv';\n" +
    "var d;\n" +
    "try { d = new Intl.DateTimeFormat('uk-UA', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now); }\n" +
    "catch (e) { d = now.toISOString().slice(0, 10); }\n" +
    "return { todayText: d + ' (ISO ' + now.toISOString().slice(0, 10) + ')' };";

const BUILD_JS =
    "var e = context.eventData || {};\n" +
    "function s(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }\n" +
    "function kyivToIso(local) {\n" +
    "  var m = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/.exec(s(local));\n" +
    "  if (!m) return '';\n" +
    "  var y = +m[1], mo = +m[2], da = +m[3], h = +m[4], mi = +m[5];\n" +
    "  var fmt;\n" +
    "  try { fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false }); } catch (x) { fmt = null; }\n" +
    "  var offs = [2, 3];\n" +
    "  for (var i = 0; i < offs.length; i++) {\n" +
    "    var c = new Date(Date.UTC(y, mo - 1, da, h - offs[i], mi));\n" +
    "    if (!fmt) return c.toISOString();\n" +
    "    var hh = parseInt(fmt.format(c), 10) % 24;\n" +
    "    if (hh === h % 24) return c.toISOString();\n" +
    "  }\n" +
    "  return new Date(Date.UTC(y, mo - 1, da, h - 3, mi)).toISOString();\n" +
    "}\n" +
    "var name = s(e.organizerName) || [user && user.firstName, user && user.lastName].filter(Boolean).join(' ');\n" +
    "var fmtv = s(e.format).toUpperCase() === 'ONLINE' ? 'ONLINE' : 'OFFLINE';\n" +
    "var pt = s(e.priceType).toUpperCase();\n" +
    "if (['FREE', 'PAID', 'DONATION'].indexOf(pt) < 0) pt = '';\n" +
    "var draftIn = {\n" +
    "  email: s(e.email).toLowerCase(), organizerName: name, title: s(e.title), description: s(e.description),\n" +
    "  category: s(e.category), format: fmtv, city: s(e.city), addressText: s(e.addressText), onlineUrl: s(e.onlineUrl),\n" +
    "  startsAt: kyivToIso(e.startsAtLocal), endsAt: kyivToIso(e.endsAtLocal), priceType: pt,\n" +
    "  price: s(e.price).replace(',', '.').replace(/[^0-9.]/g, ''), capacity: s(e.capacity).replace(/[^0-9]/g, ''),\n" +
    "  externalRegistrationUrl: s(e.externalRegistrationUrl)\n" +
    "};\n" +
    "return { draftIn: draftIn, draftResult: null };";

const VIEW_JS =
    "var r = context.draftResult || {};\n" +
    "var inb = context.draftIn || {};\n" +
    "var ok = !!(r && typeof r === 'object' && r.eventId && r.editUrl);\n" +
    "var labels = { category: 'категорія', startsAt: 'дата й час', description: 'опис', city: 'місто', onlineUrl: 'посилання на онлайн' };\n" +
    "var miss = (Array.isArray(r.missingForPublish) ? r.missingForPublish : []).map(function (k) { return labels[k] || k; });\n" +
    "var todo = miss.length ? 'Щоб опублікувати, лишилось додати: ' + miss.join(', ') + '.' : 'Все потрібне вже заповнено — лишилось натиснути «Опублікувати».';\n" +
    "var lines = ['Готово: подію «' + inb.title + '» збережено в Кіро як чернетку ✅', ''];\n" +
    "lines.push('Вона лежить у кабінеті організатора на пошті ' + inb.email + '. Увійдіть у Кіро з цією поштою (через Google або «Забули пароль»), і чернетка буде у «Мої події».');\n" +
    "if (r.rejected) lines.push('Частину полів система не прийняла (' + String(r.rejected).slice(0, 120) + ') — їх можна поправити в кабінеті.');\n" +
    "if (r.categoryResolved === false) lines.push('Категорію я не змогла підібрати — оберіть у кабінеті.');\n" +
    "if (r.cityResolved === false) lines.push('Такого міста в Кіро поки немає в списку — оберіть найближче в кабінеті.');\n" +
    "lines.push('', todo, 'Фото додається там само — з фото подія виглядає помітно краще.');\n" +
    "return { draftOk: ok, draftView: { title: inb.title, editUrl: r.editUrl || '', todo: todo, doneText: lines.join('\\n'), errText: ok ? '' : String(typeof context.draftResult === 'string' ? context.draftResult : JSON.stringify(context.draftResult || {})).slice(0, 600) } };";

async function main() {
    if (!KIRO_BOT_KEY) { console.error('Потрібен KIRO_BOT_KEY (значення BOT_INTEGRATION_KEY з apps/api/.env сервера KIRO)'); process.exit(2); }
    const existing = await callTool('list_funnels', {}).catch(() => null);
    const list = Array.isArray(existing) ? existing : (existing && existing.bots) || [];
    if (list.some((b) => b.slug === SLUG)) { console.log('вже існує:', SLUG, '— зупиняюсь'); return; }

    const funnel = await callTool('create_funnel', {
        projectSlug: 'kiro',
        name: 'KIRO: організатор → подія',
        slug: SLUG,
        description: 'Розмовна воронка для організаторів подій: невеликими питаннями (що, коли, де, ціна, місця, опис, пошта) збирає подію, між питаннями коротко і по темі розповідає про переваги Кіро. Наприкінці через службовий ендпоінт KIRO створює ЧЕРНЕТКУ події (публікує сам організатор), дає посилання на неї; через добу нагадує довести до публікації. Адмін отримує сповіщення про кожну подію.',
        goal: 'Отримати від організатора дані події у чаті, створити чернетку в KIRO через /integrations/bot/event-draft і підвести людину до публікації, показуючи реальні переваги Кіро.',
    });
    const botId = funnel.bot.id;
    console.log('botId', botId);
    await callTool('delete_node', { botId, nodeId: 'msg_intro' });
    await callTool('update_node', { botId, nodeId: 'start_1', data: { label: 'Start', trigger: '/start ' + SLUG } });

    const key = (k, value, label) => callTool('update_funnel_key', { botId, key: k, value, label });
    await key('ADMIN_TELEGRAM_ID', ADMIN_TELEGRAM_ID, 'Адмін: сповіщення про нові події організаторів');
    await key('CLAUDE_CONNECTOR_ID', CLAUDE_CONNECTOR_ID, 'Claude для воронок');
    await key('TELEGRAM_CONNECTOR_ID', TELEGRAM_CONNECTOR_ID, 'Telegram — Kiro онбординг');
    await key('KIRO_BOT_KEY', KIRO_BOT_KEY, 'Секрет службового ендпоінта KIRO (BOT_INTEGRATION_KEY)');

    const ids = {};
    const add = async (k, type, data) => { const r = await callTool('add_node', { botId, type, position: { x: 0, y: 0 }, data }); ids[k] = r.added.id; };
    const edge = (a, b) => callTool('create_edge', { botId, source: a === 'start' ? 'start_1' : ids[a], target: ids[b] });

    await add('today', 'js', { label: 'Сьогоднішня дата', code: TODAY_JS });
    await add('welcome', 'message', { label: 'Вітання + перше питання', text: T.welcome });
    await add('dialog', 'claude', { label: 'Розмова: питання + переваги Кіро', mode: 'dialog', model: 'claude-sonnet-4-6', connectorId: CLAUDE_CONNECTOR_ID, systemPrompt: DIALOG_PROMPT, exitCondition: 'json_output', outputVar: 'context.eventData', messagesTemplate: '{{conversationHistory}}' });
    await add('build', 'js', { label: 'Зібрати тіло запиту (час Києва → UTC)', code: BUILD_JS });
    await add('http', 'httpRequest', {
        label: 'KIRO: створити чернетку події',
        method: 'POST',
        url: KIRO_API,
        headers: { 'x-bot-key': '{{env.KIRO_BOT_KEY}}', 'Content-Type': 'application/json' },
        bodyFields: {
            email: '{{context.draftIn.email}}', organizerName: '{{context.draftIn.organizerName}}', title: '{{context.draftIn.title}}',
            description: '{{context.draftIn.description}}', category: '{{context.draftIn.category}}', format: '{{context.draftIn.format}}',
            city: '{{context.draftIn.city}}', addressText: '{{context.draftIn.addressText}}', onlineUrl: '{{context.draftIn.onlineUrl}}',
            startsAt: '{{context.draftIn.startsAt}}', endsAt: '{{context.draftIn.endsAt}}', priceType: '{{context.draftIn.priceType}}',
            price: '{{context.draftIn.price}}', capacity: '{{context.draftIn.capacity}}', externalRegistrationUrl: '{{context.draftIn.externalRegistrationUrl}}',
        },
        outputVar: 'context.draftResult',
    });
    await add('view', 'js', { label: 'Підготувати відповідь', code: VIEW_JS });
    await add('okCond', 'condition', { label: 'Чернетку створено?', conditions: [{ id: 'ok', label: '→ так', expression: 'context.draftOk === true' }, { id: 'fail', label: '→ ні', expression: 'true' }] });
    await add('done', 'message', { label: 'Чернетку створено + кнопка', text: '{{context.draftView.doneText}}', buttons: [[{ text: '✏️ Відкрити чернетку', url: '{{context.draftView.editUrl}}' }]] });
    await add('notifyOk', 'notifyTg', {
        label: 'Адміну: нова подія від організатора', targetKey: 'ADMIN_TELEGRAM_ID',
        message: '🎫 <b>Нова чернетка події через бота KIRO</b>\n\n<b>{{context.draftIn.title}}</b>\n📧 {{context.draftIn.email}}\n👤 {{context.draftIn.organizerName}}\n📍 {{context.draftIn.city}} {{context.draftIn.addressText}}\n🕒 {{context.draftIn.startsAt}}\n\n{{context.draftView.todo}}',
    });
    await add('wait', 'wait', { label: 'Пауза 1 день', unit: 'days', duration: 1, ignoreUserMessages: true, relayToKey: 'ADMIN_TELEGRAM_ID', relayPrefix: '💬 Організатор KIRO пише', relayAck: 'Дякую, передав команді — відповімо тут найближчим часом 🙌' });
    await add('remind', 'message', { label: 'Нагадування: довести до публікації', text: T.reminder, buttons: [[{ text: '✏️ Відкрити чернетку', url: '{{context.draftView.editUrl}}' }]] });

    await add('failMsg', 'message', { label: 'Збій: передали команді', text: T.fail });
    await add('notifyFail', 'notifyTg', {
        label: 'Адміну: збій створення (додати вручну)', targetKey: 'ADMIN_TELEGRAM_ID',
        message: '⚠️ <b>Не вдалося створити чернетку в KIRO</b>\n\nВідповідь: <code>{{context.draftView.errText}}</code>\n\nДані організатора:\n<b>{{context.draftIn.title}}</b>\n📧 {{context.draftIn.email}}\n📍 {{context.draftIn.city}} {{context.draftIn.addressText}} {{context.draftIn.onlineUrl}}\n🕒 {{context.draftIn.startsAt}}\n💰 {{context.draftIn.priceType}} {{context.draftIn.price}} | місць: {{context.draftIn.capacity}}\n\n{{context.draftIn.description}}\n\nTelegram: {{user.username}} ({{user.telegramId}})',
    });

    await edge('start', 'today');
    await edge('today', 'welcome');
    await edge('welcome', 'dialog');
    await edge('dialog', 'build');
    await edge('build', 'http');
    await edge('http', 'view');
    await edge('view', 'okCond');
    await edge('okCond', 'done');      // успіх
    await edge('okCond', 'failMsg');   // збій
    await edge('done', 'notifyOk');
    await edge('notifyOk', 'wait');
    await edge('wait', 'remind');
    await edge('failMsg', 'notifyFail');

    await callTool('auto_layout', { botId });
    console.log(JSON.stringify({ botId, slug: SLUG, nodes: ids }, null, 2));
    console.log('\nДАЛІ: реєстрація вебхука (channelSync) якщо потрібно; тест: https://t.me/Fineko_Kiro_onboarding_bot?start=' + SLUG);
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
