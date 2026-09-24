'use strict';
// Patch (source of truth): виправлення, знайдені QA-набором 2026-09-24.
//  Content Manager: генератор/агент більше не зашиті під «@matsukoleksandr / Олександр Мацук»; нейтральний fallback правил
//    (раніше підставляв «ЦА: власники бізнесу 5–50 людей» будь-якому проєкту); вибір теми за номером зберігає платформу;
//    показ повних текстів постів; довша історія діалогу для диспетчера.
//  Онбординг: 2-3 гіпотези, кейси лише реальні; уточнені qaExpectation.
// Idempotent. Run on the server:  node scripts/patch-fixes-2026-09-24.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';
const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const out = [];

async function node(botId, nodeId) {
    const f = await callTool('get_funnel', { botId });
    const n = f.nodes.find((x) => x.id === nodeId);
    if (!n) throw new Error('node not found ' + nodeId);
    return n;
}

// Замінює підрядок у текстовому полі ноди. Ідемпотентно: якщо вже є `alreadyHas` — пропускає.
async function replaceIn(botId, nodeId, field, from, to, alreadyHas) {
    const n = await node(botId, nodeId);
    const cur = String(n.data[field] || '');
    if (alreadyHas && cur.includes(alreadyHas)) { out.push(`${nodeId}.${field}: already`); return; }
    if (!cur.includes(from)) throw new Error(`${nodeId}.${field}: фрагмент не знайдено: ${from.slice(0, 60)}`);
    await callTool('update_node', { botId, nodeId, data: { [field]: cur.replace(from, to) } });
    out.push(`${nodeId}.${field}: patched`);
}

async function main() {
    // ── Content Manager: без зашитого автора ────────────────────────────────
    await replaceIn(CM, 'node_1780590932392', 'systemPrompt',
        'Ти — SMM-копірайтер для @matsukoleksandr.',
        'Ти — SMM-копірайтер проєкту «{{context.profile.projectName}}». Пиши від імені власника цього проєкту, його голосом, для його аудиторії й лише з фактів, що є в блоках нижче (персони, стратегія, продукти, кейси, база знань); не вживай інших авторів, брендів чи проєктів.',
        'проєкту «{{context.profile.projectName}}». Пиши від імені');

    await replaceIn(CM, 'node_1780590995517', 'systemPrompt',
        'асистент Олександра Мацука (FINEKO — автоматизація + курс)',
        'асистент проєкту «{{context.profile.projectName}}»',
        'асистент проєкту «{{context.profile.projectName}}»');

    await replaceIn(CM, 'node_merge_core_rules', 'code',
        'ЦА: власники бізнесу 5–50 людей (від 7 в команді). Стиль: практик, перша особа, без пафосу, конкретика.',
        'Аудиторія, тон і стиль — лише з профілю проєкту (персони, тон голосу, стратегія); не вигадуй аудиторію чи біографію автора.',
        'лише з профілю проєкту (персони, тон голосу, стратегія)');

    for (const vecNode of ['node_1780594238378', 'node_1781008605948']) {
        await replaceIn(CM, vecNode, 'body',
            'Стиль і голос @matsukoleksandr для',
            'Стиль і голос автора проєкту «{{context.profile.projectName}}» для',
            'автора проєкту «{{context.profile.projectName}}»');
    }

    const AGENT_SHOW =
        'Ти працюєш як універсальний асистент: в одному повідомленні може бути КІЛЬКА запитів — виконуй їх ПОСЛІДОВНО, всі до одного.\n\n' +
        'ПОКАЗ ПОСТІВ (обовʼязково): list_posts повертає лише уривки. Коли користувач просить показати/переглянути пости — для КОЖНОГО поста (до 10 штук) виклич get_post(number) і виведи ПОВНИЙ текст окремим code-блоком; ' +
        'якщо постів більше 10 — покажи перші 10 повними, решту одним списком з номерами й запропонуй відкрити потрібні.';
    await replaceIn(CM, 'node_agent_content_mgr', 'systemPrompt',
        'Ти — повноцінний агент управління контентом для Олександра Мацука (FINEKO).',
        'Ти — повноцінний агент управління контентом для проєкту «{{context.profile.projectName}}».',
        'для проєкту «{{context.profile.projectName}}»');
    await replaceIn(CM, 'node_agent_content_mgr', 'systemPrompt',
        'Ти працюєш як універсальний асистент: в одному повідомленні може бути КІЛЬКА запитів — виконуй їх ПОСЛІДОВНО, всі до одного.',
        AGENT_SHOW, 'ПОКАЗ ПОСТІВ (обовʼязково)');

    // ── Content Manager: диспетчер — вибір теми зберігає платформу ──────────
    await replaceIn(CM, 'node_1780590851896', 'systemPrompt',
        'НІКОЛИ не питай уточнень текстом.',
        'ВИБІР ТЕМИ (theme_selection=true): коли користувач обирає тему з ТВОГО попереднього списку («першу», «другу», «3», «ту що про …») — знайди В ІСТОРІЇ останнє повідомлення асистента зі списком тем ' +
        'і візьми РІВНО ту тему за номером/описом (перша = №1, друга = №2, третя = №3); впиши її дослівно в tasks[].topic. Формат, платформа й кількість НЕ змінюються: візьми їх із ПОПЕРЕДНЬОГО запиту користувача в історії ' +
        '(Threads → threads_single/platform threads; Instagram → instagram_post тощо; count за замовчуванням 1) — НЕ став Instagram за замовчуванням.\n\nНІКОЛИ не питай уточнень текстом.',
        'ВИБІР ТЕМИ (theme_selection=true)');

    // ── Content Manager: довша історія для диспетчера (список тем не обрізається) ──
    await replaceIn(CM, 'node_1780590806221', 'code', 'trim().slice(0, 500)', 'trim().slice(0, 1200)', 'trim().slice(0, 1200)');

    // ── Онбординг: 2-3 гіпотези, кейси лише реальні ─────────────────────────
    await replaceIn(ONBOARD, 'n_agent', 'systemPrompt',
        'НЕ ПЕРЕПИТУЙ:',
        'ГІПОТЕЗИ: пропонуючи гіпотези (персони, болі, теми) — 2-3 найсильніші, а не список із 5+; чесно називай їх гіпотезами.\n' +
        'КЕЙСИ — ТІЛЬКИ РЕАЛЬНІ: не вигадуй імена, цифри, подробиці й не пропонуй «приклади кейсів». У save kind=case поля problem/solution/metrics/allowedClaims — виключно зі слів клієнта (чого клієнт не сказав — те поле порожнє). ' +
        'Кейс привʼязуй до точної назви продукту зі get_profile.\n\nНЕ ПЕРЕПИТУЙ:',
        'ГІПОТЕЗИ: пропонуючи гіпотези');

    // ── qaExpectation ───────────────────────────────────────────────────────
    const qa = (botId, nodeId, text) => callTool('update_node', { botId, nodeId, data: { qaExpectation: text } });
    await qa(ONBOARD, 'n_agent',
        'Агент онбордингу: пише зрозуміло й по-людськи українською на «ти» (списки гіпотез чи тем до 3 пунктів допустимі), ставить 1-2 питання за раз; на старті викликає get_profile і називає компанію; ' +
        'дані клієнта зберігає інструментом save з правильним kind; не перепитує те, що клієнт уже сказав чи що вже є в профілі; не вигадує факти про клієнта (кейси — лише реальні); ' +
        'finish_onboarding викликає ЛИШЕ коли клієнт просить згенерувати пости/контент-план або сам каже, що онбординг завершено — в інших випадках продовжує збирати профіль.');
    await qa(CM, 'node_1780590851896',
        'Диспетчер повертає валідний JSON з intent із {create, edit, save_rule, new_plan, dialog}; для create дає tasks з format/platform/count/date/topic (для періоду в date, напр. «3 дні», розкидання по датах робить наступна нода Parse Intent — це нормально); ' +
        'не задає уточнень текстом. Якщо в одному повідомленні кілька запитів різних типів — intent може відображати лише один із них: решту виконує Content Agent (це нормально).');
    await qa(CM, 'node_agent_content_mgr',
        'Content Agent виконує запит через інструменти (list_posts/get_post/edit_post/save_rule/get_* тощо) без вигаданих даних; показуючи пости, виводить повний текст кожного окремим code-блоком; ' +
        'пише від імені бізнесу поточного проєкту і НЕ згадує чужого автора чи проєкт (Олександр Мацук, FINEKO, консалтинг з автоматизації), якщо поточний проєкт інший.');
    out.push('qaExpectation: refined on 3 nodes');

    console.log(out.join('\n'));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); console.log(out.join('\n')); process.exit(1); });
