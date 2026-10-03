'use strict';
// Build-скрипт (джерело істини): воронка «KIRO: тестувальники та організатори» (slug kiro-testers, проєкт KIRO).
// Старт: https://t.me/<бот>?start=kiro-testers
//   welcome (кнопки Android/iOS) → claude-класифікатор ОС
//   Android: Gmail (claude-діалог з валідацією) → список testers (saveFile) → сповіщення адміну з кнопкою
//            «✅ Додано до тестувальників» (evt:-callback) → тихий wait(event) → повідомлення з посиланнями
//   iOS:     «буде пізніше» + посилання на сайт
//   далі (обидві гілки): пауза 2д → нагадування #1 → пауза 3д → нагадування #2.
//   Під час пауз репліки користувача НЕ скорочують очікування, а пересилаються адміну (wait.relayToKey).
// Потрібні розширення двигуна (в цьому ж коміті): notifyTg.buttons, wait.silent, wait.ignoreUserMessages/relayToKey/relayAck,
// platformBotHandler callback `evt:<tgId>:<slug>:<eventKey>`.
// TELEGRAM_CONNECTOR_ID виставляється окремо (токен бота з BotFather → збережений конектор): set-key після створення бота.
// Idempotent: якщо воронка вже є — зупиняється. Запуск на сервері: node scripts/build-kiro-testers-funnel-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const SLUG = 'kiro-testers';
const ADMIN_TELEGRAM_ID = '345126254'; // Олександр
const CLAUDE_CONNECTOR_ID = '2ec53ba5-144e-463b-9758-c217c4a69b0e';
const SITE = 'https://kiro.fineko.space/';
const PLAY = 'https://play.google.com/store/apps/details?id=space.fineko.kiro';

const T = {
    welcome:
        'Привіт! 👋 Вітаємо в Кіро!\n' +
        'Кіро — це новий додаток для зручного пошуку та організації подій у форматі Tinder-стрічки 🚀\n\n' +
        '• Якщо ви шукаєте, куди піти: більше жодних нудних каталогів чи нескінченних чатів. Гортаєте картки подій у своєму районі, свайпаєте та записуєтесь за один клік!\n\n' +
        '• Якщо ви організатор: це найпростіший спосіб зібрати людей. Створюйте мінілендінг події за 2 хвилини, збирайте реєстрації, спілкуйтеся з учасниками та показуйте свої івенти новій аудиторії!\n\n' +
        'Наразі додаток знаходиться у режимі закритого тестування в Play Market, тому доступи надаємо за поштою 🔑\n' +
        'Підкажіть, будь ласка, яка у вас операційна система? (Оберіть кнопку нижче або напишіть у відповідь)',
    askEmail:
        'Чудово! 🤖\n' +
        'Щоб ми надали вам доступ до закритого тестування в Play Market, напишіть сюди свою Gmail-пошту (до якої прив\'язаний ваш Google Play) 📩',
    ack:
        'Дякуємо! Пошту отримано. Як тільки ви отримаєте доступ ми вам повідомимо, зазвичай це відбувається протягом кількох годин.',
    access:
        'Вітаємо, вас додано до списку раннього доступу до додатку 👍\n\n' +
        'Ваші посилання для входу:\n' +
        '📲 Завантажити додаток (Android): ' + PLAY + '\n' +
        '🌐 Або відкрити вебверсію: ' + SITE + '\n\n' +
        'Заходьте та обов\'язково додавайте анонси своїх подій! Щодня в додаток заходить усе більше людей, тож скоро учасники почнуть записуватися і до вас 🎯\n\n' +
        '💡 Лайфхак для організаторів: Ви можете створювати повторювані події (наприклад, щотижня). Система сама переноситиме дати, а ви отримуватимете реєстрації, зможете писати учасникам у чаті та керувати списком!',
    ios:
        'На жаль, версія для iOS буде трохи пізніше 🍏\n' +
        'Проте ви вже зараз можете розміщувати свої події через наш сайт — люди в додатках їх також будуть бачити!\n\n' +
        '🌐 Заходьте та додавайте події тут: ' + SITE + '\n\n' +
        'Ми обов\'язково повідомимо вас тут, як тільки релізнемо додаток в App Store! 😉',
    badEmail:
        'Схоже, це не Gmail-адреса 🤔 Для Play Market потрібна пошта на gmail.com. Натисніть /start і спробуйте ще раз — або напишіть нам тут, допоможемо.',
    fu1:
        'Привіт! 👋\n' +
        'Підкажіть, чи вдалося вам зайти на сайт або в додаток та розмістити свої перші події?\n\n' +
        'Якщо виникли якісь питання із заповненням або потрібна допомога з налаштуванням (наприклад, категорій чи повторюваних подій) — просто напишіть сюди у відповідь, я радо допоможу! 🤝',
    fu2:
        'Вітаю! 🚀\n' +
        'Як ваші враження від Кіро?\n' +
        'Чи вдалося опублікувати всі заплановані анонси? Якщо вже розмістили — перевірте, чи все коректно відображається в стрічці.\n\n' +
        'Будемо дуже вдячні за будь-який зворотний зв\'язок або побажання щодо функціоналу — це допомагає нам робити Кіро ще кращим для вас! ✨',
};

const OS_PROMPT =
    'Ти — вітальний помічник застосунку Кіро (події у форматі Tinder-стрічки; закрите тестування в Play Market). ' +
    'Користувач відповів на питання «яка у вас операційна система?». Визнач: Android чи iOS (iPhone/iPad/Apple/айфон = ios; андроїд/самсунг/Xiaomi/Pixel = android).\n' +
    'Якщо зрозуміло — відповідай ТІЛЬКИ блоком, без жодного тексту навколо:\n```json_output\n{"os":"android"}\n```\n(або {"os":"ios"}).\n' +
    'Якщо незрозуміло або людина питає про інше — відповідь 1-2 короткі речення по суті (без вигадок: фактів про Кіро тут лише ті, що в цьому промпті) і ще раз спитай, Android чи iOS. Українською, на «ви», без пафосу.';

const EMAIL_PROMPT =
    'Ти збираєш Gmail-адресу користувача для додавання в закрите тестування Play Market. Користувач щойно отримав прохання написати Gmail.\n' +
    'Правила: прийнятна лише адреса @gmail.com (або @googlemail.com). Якщо в повідомленні є така адреса — відповідай ТІЛЬКИ блоком без тексту навколо:\n' +
    '```json_output\n{"email":"адреса@gmail.com"}\n```\n(адреса — малими літерами, без пробілів, рівно так, як написав користувач).\n' +
    'Якщо адреса не Gmail (напр. ukr.net, outlook) — 1-2 речення: для Play Market потрібна саме Gmail-пошта (до якої прив\'язаний Google Play); попроси її. ' +
    'Якщо адреси немає або користувач питає про інше — відповідь коротко по суті й нагадай про Gmail. Не вигадуй фактів про додаток. Українською, на «ви».';

async function main() {
    const existing = await callTool('list_funnels', {}).catch(() => null);
    const list = Array.isArray(existing) ? existing : (existing && existing.bots) || [];
    if (list.some((b) => b.slug === SLUG)) { console.log('вже існує:', SLUG, '— зупиняюсь'); return; }

    const funnel = await callTool('create_funnel', {
        projectSlug: 'kiro',
        name: 'KIRO: тестувальники та організатори',
        slug: SLUG,
        description: 'Коротка воронка залучення тестувальників і організаторів KIRO: вітання → вибір ОС → (Android) Gmail для закритого тестування в Play Market, підтвердження адміном кнопкою в Telegram, посилання на додаток і сайт; (iOS) посилання на сайт. Далі два автоповідомлення (через 2 і ще 3 дні). Репліки користувачів у паузах пересилаються адміну.',
        goal: 'Зібрати Gmail тестувальників Android для закритого тестування, дати доступ після підтвердження адміна, підштовхнути організаторів додавати події на сайт/в додаток і зібрати зворотний зв\'язок.',
    });
    const botId = funnel.bot.id;
    console.log('botId', botId);
    await callTool('delete_node', { botId, nodeId: 'msg_intro' });
    await callTool('update_node', { botId, nodeId: 'start_1', data: { label: 'Start', trigger: '/start ' + SLUG } });

    // ключі (TELEGRAM_CONNECTOR_ID — окремо, після створення бота)
    await callTool('update_funnel_key', { botId, key: 'ADMIN_TELEGRAM_ID', value: ADMIN_TELEGRAM_ID, label: 'Адмін: кому слати Gmail тестувальників (кнопка підтвердження)' });
    await callTool('update_funnel_key', { botId, key: 'CLAUDE_CONNECTOR_ID', value: CLAUDE_CONNECTOR_ID, label: 'Claude для воронок' });

    const ids = {};
    const add = async (k, type, data) => { const r = await callTool('add_node', { botId, type, position: { x: 0, y: 0 }, data }); ids[k] = r.added.id; };
    const edge = (a, b) => callTool('create_edge', { botId, source: a === 'start' ? 'start_1' : ids[a], target: ids[b] });

    await add('welcome', 'message', { label: 'Вітання + вибір ОС', text: T.welcome, buttons: [[{ text: '🤖 Android', callback_data: 'cta:Android' }, { text: '🍏 iOS', callback_data: 'cta:iOS' }]] });
    await add('os', 'claude', { label: 'Яка ОС?', mode: 'dialog', model: 'claude-haiku-4-5', connectorId: CLAUDE_CONNECTOR_ID, systemPrompt: OS_PROMPT, exitCondition: 'json_output', outputVar: 'context.osChoice', messagesTemplate: '{{conversationHistory}}' });
    await add('osCond', 'condition', { label: 'Android чи iOS?', conditions: [{ id: 'android', label: '→ Android', expression: "context.osChoice && context.osChoice.os === 'android'" }, { id: 'ios', label: '→ iOS', expression: 'true' }] });

    await add('askEmail', 'message', { label: 'Android: запит Gmail', text: T.askEmail });
    await add('email', 'claude', { label: 'Зібрати Gmail', mode: 'dialog', model: 'claude-haiku-4-5', connectorId: CLAUDE_CONNECTOR_ID, systemPrompt: EMAIL_PROMPT, exitCondition: 'json_output', outputVar: 'context.emailData', messagesTemplate: '{{conversationHistory}}' });
    await add('emailJs', 'js', {
        label: 'Нормалізувати й перевірити Gmail',
        code: "var e = String((context.emailData && context.emailData.email) || '').trim().toLowerCase();\n" +
            "var ok = /^[a-z0-9._%+-]+@(gmail|googlemail)\\.com$/.test(e);\n" +
            "return { testerEmail: e, emailOk: ok, testerName: [user && user.firstName, user && user.lastName].filter(Boolean).join(' ') || '', testerUsername: (user && user.username) ? '@' + user.username : '' };",
    });
    await add('emailCond', 'condition', { label: 'Gmail валідний?', conditions: [{ id: 'ok', label: '→ так', expression: 'context.emailOk === true' }, { id: 'bad', label: '→ ні', expression: 'true' }] });
    await add('badEmail', 'message', { label: 'Gmail некоректний', text: T.badEmail });

    await add('loadList', 'loadFile', { label: 'Список тестувальників', fileType: 'kiro_testers', onMissing: 'skip', outputVar: 'context.testersRaw' });
    await add('appendJs', 'js', {
        label: 'Додати в список',
        code: "var list = [];\nif (Array.isArray(context.testersRaw)) { list = context.testersRaw; }\nelse { try { var a = JSON.parse(context.testersRaw || '[]'); if (Array.isArray(a)) list = a; } catch (e) {} }\n" +
            "if (!list.some(function (t) { return t.email === context.testerEmail; })) {\n" +
            "  list.push({ email: context.testerEmail, name: context.testerName, username: context.testerUsername, tgId: String(user && user.telegramId || ''), at: new Date().toISOString().slice(0, 10) });\n}\n" +
            "return { testersToSave: JSON.stringify(list), testersCount: list.length };",
    });
    await add('saveList', 'saveFile', { label: 'Зберегти список тестувальників', fileType: 'kiro_testers', contentVar: 'context.testersToSave' });
    await add('notifyAdmin', 'notifyTg', {
        label: 'Адміну: новий тестувальник',
        targetKey: 'ADMIN_TELEGRAM_ID',
        message: '🆕 <b>Новий тестувальник KIRO (Android)</b>\n\n📧 Gmail: <code>{{context.testerEmail}}</code>\n👤 {{context.testerName}} {{context.testerUsername}}\n\nДодайте цю пошту в Play Console → Закрите тестування → Тестувальники, потім натисніть кнопку — користувач отримає посилання.\n(Усього в списку: {{context.testersCount}})',
        buttons: [[{ text: '✅ Додано до тестувальників', callback_data: 'evt:{{user.telegramId}}:' + SLUG + ':kt_granted' }]],
    });
    await add('ack', 'message', { label: 'Android: пошту отримано', text: T.ack });
    await add('waitGrant', 'wait', { label: 'Чекаємо підтвердження адміна', mode: 'event', eventKey: 'kt_granted', silent: true, relayToKey: 'ADMIN_TELEGRAM_ID', relayPrefix: '💬 Тестувальник KIRO пише, поки чекає доступ', relayAck: 'Дякую, передав команді — відповімо тут найближчим часом 🙌' });
    await add('access', 'message', { label: 'Android: доступ надано', text: T.access });

    await add('ios', 'message', { label: 'iOS: пізніше + сайт', text: T.ios });

    const relay = { ignoreUserMessages: true, relayToKey: 'ADMIN_TELEGRAM_ID', relayPrefix: '💬 Відповідь тестувальника KIRO', relayAck: 'Дякую, передав команді — відповімо тут найближчим часом 🙌' };
    await add('wait1', 'wait', Object.assign({ label: 'Пауза 2 дні', unit: 'days', duration: 2 }, relay));
    await add('fu1', 'message', { label: 'Нагадування #1 (2 дні)', text: T.fu1 });
    await add('wait2', 'wait', Object.assign({ label: 'Пауза 3 дні', unit: 'days', duration: 3 }, relay));
    await add('fu2', 'message', { label: 'Нагадування #2 (5 днів)', text: T.fu2 });

    // ребра (порядок ребер від condition = порядок умов)
    await edge('start', 'welcome');
    await edge('welcome', 'os');
    await edge('os', 'osCond');
    await edge('osCond', 'askEmail'); // Android
    await edge('osCond', 'ios');      // iOS
    await edge('askEmail', 'email');
    await edge('email', 'emailJs');
    await edge('emailJs', 'emailCond');
    await edge('emailCond', 'loadList'); // валідний
    await edge('emailCond', 'badEmail'); // ні
    await edge('loadList', 'appendJs');
    await edge('appendJs', 'saveList');
    await edge('saveList', 'notifyAdmin');
    await edge('notifyAdmin', 'ack');
    await edge('ack', 'waitGrant');
    await edge('waitGrant', 'access');
    await edge('access', 'wait1');
    await edge('ios', 'wait1');
    await edge('wait1', 'fu1');
    await edge('fu1', 'wait2');
    await edge('wait2', 'fu2');

    await callTool('auto_layout', { botId });
    console.log(JSON.stringify({ botId, slug: SLUG, nodes: ids }, null, 2));
    console.log('\nДАЛІ: токен бота → збережений конектор Telegram → update_funnel_key TELEGRAM_CONNECTOR_ID → реєстрація вебхука (channelSync).');
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
