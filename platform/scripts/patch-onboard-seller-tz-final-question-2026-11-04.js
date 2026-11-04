'use strict';
// Онбординг експерта (правки власника 04.11): менше зайвих питань.
//  (1) часовий пояс не питаємо: за замовчуванням Київ;
//  (2) «куди слати заявки» не просимо числовий Telegram ID: бот уже знає чат експерта, питає лише «буде ок, якщо заявки приходитимуть сюди?»;
//      ID беремо з Telegram-користувача (вузол «Записати в content2»: handoffTelegramId = цифри з O19, інакше user.telegramId);
//  (3) наприкінці одне питання «що ще важливо знати боту про тебе» зі списком підказок (інша країна, графік, мови, кого не береш, умови, табу).
// Правка живого промпту агента й вузла; джерело для повторного складання — scripts/onboard-seller/system-prompt.md (змінено разом). Ідемпотентно (кожна частина окремо).
// Запуск з кореня platform/:  PLATFORM_ROOT=$PWD node scripts/patch-onboard-seller-tz-final-question-2026-11-04.js  (DRY_RUN=1 — лише показати)
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const DRY = !!process.env.DRY_RUN;

const TZ_OLD = 'Робочі дні, години, часовий пояс.';
const TZ_NEW = 'Робочі дні й години. Часовий пояс НЕ питай: за замовчуванням Київ; в іншій країні експерт скаже сам у фінальному питанні (20).';

const Q19_RE = /19\. ОБОВ.{0,3}ЯЗКОВО[^\n]*\[O19\]/;
const Q19_MARK = 'Заявки від клієнтів приходитимуть сюди';
const Q19_NEW = '19. ОБОВʼЯЗКОВО (без цього продавця не запустити): куди надсилати сповіщення про гарячих лідів? НЕ проси числовий Telegram ID: ти вже в чаті з експертом, система знає його акаунт. Спитай одним реченням: «Заявки від клієнтів приходитимуть сюди, у цей чат. Підходить?» і варіанти кожен з нового рядка: «1) Так, сюди», «2) Ні, хочу в інший чат» (лише тоді попроси числовий Telegram ID і підкажи @userinfobot). Відповів «сюди»/«так» → set_fields O19: value «Сюди, у цей чат експерта», status confirmed, quote його слова. Окремо, коротко (необовʼязково): коли заявки не надсилати? [O19]';

const Q20_MARK = '20. ОСТАННЄ питання перед карткою';
const Q20 = [
    Q20_MARK + ' (завжди, окремим повідомленням): «Що ще важливо знати боту про тебе чи твою роботу? Вибери з переліку або напиши своє:» і список, кожен пункт з нового рядка:',
    '1) Я в іншій країні або в іншому часовому поясі',
    '2) Працюю не щодня: є вихідні, відпустка чи сезонна пауза',
    '3) Клієнти пишуть не лише українською',
    '4) Є люди, яких я не беру (за віком, містом, запитом)',
    '5) Є важлива умова: передоплата, договір, анкета перед консультацією',
    '6) Є теми, про які бот не має говорити',
    '7) Є те, що бот має обовʼязково згадати чи підкреслити',
    '8) Нічого додати, усе сказано',
    'Відповіді розклади по полях і запиши set_fields у цьому ж ході: країна, часовий пояс, графік → K8; мови → K11; кого не береш → K5; умови → K4; теми-табу → O16; решту → O13 з позначкою «додатково». Варіант 8 → нічого не записуй. Якщо експерт уже все це сказав раніше, не перепитуй, а лише запропонуй перелік одним реченням.',
].join('\n');

const NODE_OLD = String.raw`handoffTelegramId: ((v('O19').match(/\b\d{6,12}\b/) || [])[0]) || ''`;
const NODE_NEW = String.raw`handoffTelegramId: ((v('O19').match(/\b\d{6,12}\b/) || [])[0]) || String(user.telegramId || '')`;

(async () => {
    const bot = await db.bot.findFirst({ where: { slug: 'onboard-seller' } });
    if (!bot) throw new Error('onboard-seller не знайдено');
    const f = await callTool('get_funnel', { botId: bot.id });
    const n = (f.nodes || []).find((x) => x.type === 'agent' && x.data && typeof x.data.systemPrompt === 'string');
    if (!n) throw new Error('агент онбордингу не знайдено');
    let p = n.data.systemPrompt; const before = p.length;
    const done = [];

    if (p.includes(TZ_OLD)) { p = p.replace(TZ_OLD, TZ_NEW); done.push('часовий пояс не питаємо'); }

    if (!p.includes(Q19_MARK)) {
        if (!Q19_RE.test(p)) throw new Error('не знайдено питання 19');
        p = p.replace(Q19_RE, Q19_NEW); done.push('питання 19: «заявки сюди?»');
    }

    if (!p.includes(Q20_MARK)) {
        const a = p.indexOf('Питання 10, 12, 15 і 19 став ЗАВЖДИ');
        if (a < 0) throw new Error('не знайдено рядок «Питання 10, 12, 15 і 19 став ЗАВЖДИ»');
        p = p.slice(0, a) + Q20 + '\n' + p.slice(a).replace('Питання 10, 12, 15 і 19 став ЗАВЖДИ', 'Питання 10, 12, 15, 19 і 20 став ЗАВЖДИ');
        done.push('питання 20: що ще знати боту');
    }

    if (done.length) {
        if (!DRY) await callTool('update_node', { botId: bot.id, nodeId: n.id, data: { systemPrompt: p } });
        console.log('  ✔ промпт агента', DRY ? '(dry-run)' : 'оновлено:', done.join('; '), '| довжина', before, '→', p.length);
    } else console.log('  = промпт вже оновлено');

    // вузол «Записати в content2»: handoffTelegramId за замовчуванням = Telegram експерта
    const w = (f.nodes || []).find((x) => x.type === 'js' && x.data && typeof x.data.code === 'string' && x.data.code.includes(NODE_OLD));
    if (w) {
        if (!DRY) await callTool('update_node', { botId: bot.id, nodeId: w.id, data: { code: w.data.code.replace(NODE_OLD, NODE_NEW) } });
        console.log('  ✔ вузол «' + (w.data.label || w.id) + '»: Telegram для заявок за замовчуванням = акаунт експерта', DRY ? '(dry-run)' : '');
    } else if ((f.nodes || []).some((x) => x.type === 'js' && x.data && typeof x.data.code === 'string' && x.data.code.includes(NODE_NEW))) {
        console.log('  = вузол запису в content2 вже оновлено');
    } else console.log('  ? вузол із handoffTelegramId не знайдено: перевірте вручну');
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
