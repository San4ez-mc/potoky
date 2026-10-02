'use strict';
// Patch (джерело істини): Content Manager розрізняє АКТУАЛЬНУ і ЗАСТАРІЛУ інформацію.
//
// Проблема: нова інформація про продукт (скільки тестувальників, етап запуску, де доступний
// застосунок) йшла або в save_rule (плоский запис, що живе вічно), або нікуди. Стара і нова версії
// лежали поруч у базі знань, векторі, продуктах і навіть уже запланованих постах — генератор
// брав будь-яку, бо не було ні дат, ні заміни.
//
// Рішення (content2: knowledge_entries category='fact' + topic + valid_from/valid_until, див.
// src/lib/facts.ts): новий факт тієї ж теми замінює старий; get_facts віддає блок «АКТУАЛЬНІ ФАКТИ».
// Тут, у воронці:
//   1) JS: coreRules + fallback — підвантажує get_facts у context.factsText (до Dispatcher, тож
//      блок доступний і Content Agent, і ST: Generate);
//   2) ST: Generate — блок АКТУАЛЬНІ ФАКТИ + правило актуальності (факти > решта бази);
//   3) Content Agent — блок фактів, інструменти get_facts/save_fact/expire_fact/find_stale_posts,
//      протокол «нова інформація → факти з датами → виправити застарілі пости»;
//   4) Dispatcher — повідомлення з новою інформацією = intent save_rule (веде до агента).
// Idempotent. Run on the server:  node scripts/patch-cm-dated-facts-2026-10-02.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const N_MERGE = 'node_merge_core_rules';
const N_ST = 'node_1780590932392';
const N_AGENT = 'node_agent_content_mgr';
const N_DISPATCH = 'node_1780590851896';
const MARK = 'АКТУАЛЬНІ ФАКТИ';

const TOKEN = 'fnk_wh_2026_x9mK4pLqR7vNsT1eYcJdBuAw';
const tool = (name, description, properties, required) => ({
    url: 'https://content2.fineko.space/api/agent-tools?action=' + name + '&token=' + TOKEN + '&projectId={{context.projectId}}',
    name, type: 'http', description,
    inputSchema: { type: 'object', required: required || [], properties: properties || {} },
});

const ST_BLOCK =
    '{{context.factsText}}\n\n' +
    'ПРАВИЛО АКТУАЛЬНОСТІ: усе про ПОТОЧНИЙ СТАН продукту — скільки тестувальників чи користувачів, на яких платформах доступний, що вже випущено, а що ще ні, поточні умови й ціни, які функції чи події вже є — бери ЛИШЕ з блоку «АКТУАЛЬНІ ФАКТИ» вище. Якщо ці самі речі в інших блоках (база знань, продукти, лід-магніти, кейси, банк тем, ОСТАННІ ПОСТИ) сказано інакше — це застаріле: ігноруй і НЕ повторюй. Не вигадуй чисел і статусів, яких немає в цьому блоці. Те, що позначено «ЗАПЛАНОВАНО НА МАЙБУТНЄ», подавай як майбутнє, а не як наявне. Якщо пост про запуск, тестування, платформи чи залучення людей — наводь конкретику з фактів (актуальні числа, етапи, дати); у плані з 6+ постів принаймні кожен 4-й має спиратись на актуальний факт, коли такі факти є.\n\n';

const AGENT_BLOCK =
    'АКТУАЛЬНІ ФАКТИ ПРО ПРОДУКТ/КОМПАНІЮ — єдина правда про поточний стан. Якщо щось у базі знань, продуктах чи старих постах суперечить цьому блоку — вірний цей блок:\n{{context.factsText}}\n\n' +
    'НОВА ІНФОРМАЦІЯ ПРО ПРОДУКТ/КОМПАНІЮ (ВАЖЛИВО): якщо користувач ділиться новиною чи станом справ — скільки людей тестує, який етап запуску, що вже випущено або буде випущено і коли, нові функції, ціни, події, зміни («у нас уже…», «тепер…», «зʼявилось…», «коли буде 100 — вийде…») — це ФАКТ З ДАТОЮ, а не правило стилю. Роби так:\n' +
    '1) Розбий повідомлення на окремі факти (одна тема = один факт; одна фраза користувача може дати 3-4 факти).\n' +
    '2) Спершу виклич get_facts(status="all"): якщо тема вже є — використай ТУ САМУ topic, тоді новий факт автоматично замінить старий (старий стане «застарілим»).\n' +
    '3) Для кожного факту — save_fact(topic, title, content, valid_from?, valid_until?, stale_markers?). topic — коротка стабільна тема (напр. «статус тестування», «випуск на iOS»). content — повне самодостатнє твердження з конкретикою, БЕЗ слів «сьогодні/вчора/зараз» (давай явні дати ДД.ММ.РРРР). Те, що буде в майбутньому, — з valid_from (дата початку дії), якщо дата відома; якщо дати нема, а умова є («коли буде 100 користувачів») — пиши умову прямо в content. stale_markers — 2-5 КОРОТКИХ (2-4 слова) ключових фраз СТАРОГО формулювання, що збігаються з будь-яким перефразуванням, а не цілі речення (напр. «15 тестувальників», «15 живих», «перших 15», «ще не доступний»); візьми їх зі старих фактів, бази знань, продуктів, постів.\n' +
    '4) ПЕРЕВІР ЗАПЛАНОВАНІ ПОСТИ на застаріле. (а) Якщо save_fact повернув stalePosts>0 — виклич find_stale_posts. (б) Маркери ловлять лише дослівні збіги, тому ЗАВЖДИ додатково виклич list_posts(date_from=сьогодні, date_to=далека дата) і за уривками знайди пости, що за змістом суперечать новим фактам (старі числа чи статуси, «ще не доступний», «потрібно N тестувальників» тощо, коли тепер інакше). Для кожного такого поста get_post → перепиши лише застаріле місце під нові факти (решту тексту, довжину й тон збережи) → check_writing → edit_post. Не чіпай пости, яких новина не стосується.\n' +
    '5) Якщо ще й просять написати пости — після збереження фактів створи до 5 постів сам (create_post); для більшого обсягу скажи надіслати окремий запит на генерацію (тоді він піде вже з новими фактами).\n' +
    '6) Підсумок: що тепер актуальне, що замінено як застаріле, які пости виправлено. Не кажи «зберіг», якщо save_fact не повернув ok=true.\n' +
    'Правила стилю, заборони, тон — і далі save_rule; факти про СТАН (числа, етапи, дати, статуси) — ТІЛЬКИ save_fact. Якщо щось просто перестало бути правдою і заміни нема — expire_fact(id або topic). Про що зараз актуально/застаріло — відповідай з get_facts(status="all").\n\n';

async function main() {
    const f = await callTool('get_funnel', { botId: CM });
    const node = (id) => f.nodes.find((x) => x.id === id);

    // 1) merge: підвантажити факти
    {
        const n = node(N_MERGE);
        let code = String(n.data.code);
        if (code.includes("grab('get_facts')")) console.log('merge: already patched');
        else {
            const a = "  var topPatterns=await grab('get_top_patterns');";
            const b = 'topPatterns: topPatterns };';
            if (!code.includes(a) || !code.includes(b)) throw new Error('merge: маркери не знайдено — код змінився');
            code = code.replace(a, a + "\n  var factsText=await grab('get_facts');").replace(b, 'topPatterns: topPatterns, factsText: factsText };');
            new Function('context', code);
            await callTool('update_node', { botId: CM, nodeId: N_MERGE, data: { code } });
            console.log('merge: patched (context.factsText)');
        }
    }

    // 2) ST: Generate
    {
        const n = node(N_ST);
        const sp = String(n.data.systemPrompt);
        if (sp.includes(MARK)) console.log('ST: already patched');
        else {
            const needle = 'ПЕРСОНИ / ЦА (кому пишемо';
            if (!sp.includes(needle)) throw new Error('ST: маркер ПЕРСОНИ не знайдено');
            await callTool('update_node', { botId: CM, nodeId: N_ST, data: { systemPrompt: sp.replace(needle, ST_BLOCK + needle) } });
            console.log('ST: patched (блок АКТУАЛЬНІ ФАКТИ + правило актуальності)');
        }
    }

    // 3) Content Agent
    {
        const n = node(N_AGENT);
        let sp = String(n.data.systemPrompt);
        const tools = Array.isArray(n.data.tools) ? n.data.tools.slice() : [];
        const data = {};
        // Блок АГЕНТА — між «АКТУАЛЬНІ ФАКТИ ПРО ПРОДУКТ/КОМПАНІЮ» і «ІНСТРУМЕНТИ ДАНИХ:»; якщо він уже є —
        // оновлюємо до поточного тексту (щоб правки формулювань застосовувались повторним запуском).
        const needle = 'ІНСТРУМЕНТИ ДАНИХ:';
        const startMark = 'АКТУАЛЬНІ ФАКТИ ПРО ПРОДУКТ/КОМПАНІЮ';
        if (!sp.includes(needle)) throw new Error('agent: маркер ІНСТРУМЕНТИ ДАНИХ не знайдено');
        const si = sp.indexOf(startMark);
        const next = si >= 0 ? sp.slice(0, si) + AGENT_BLOCK + sp.slice(sp.indexOf(needle)) : sp.replace(needle, AGENT_BLOCK + needle);
        const next2 = next.replace('Якщо юзер дає правки (стиль, ЦА, факти) — застосуй', 'Якщо юзер дає правки (стиль, ЦА) — застосуй');
        if (next2 === sp) console.log('agent prompt: already up to date');
        else data.systemPrompt = next2;
        const wanted = [
            tool('get_facts', 'Факти з датами. status: active (за замовчуванням) | scheduled | outdated | all. Повертає facts[] (id, topic, title, content, status, validFrom, validUntil) і готовий блок text. Для питань «що актуально / що застаріло» — status=all.',
                { status: { type: 'string', description: 'active|scheduled|outdated|all' } }),
            tool('save_fact', 'Зберегти ФАКТ З ДАТОЮ про стан продукту/компанії (числа, етапи, статуси, дати). Новий факт тієї ж topic автоматично замінює старий (той стає застарілим). Для правил стилю — save_rule, не це.',
                {
                    topic: { type: 'string', description: 'Коротка стабільна тема, напр. "статус тестування"' },
                    title: { type: 'string', description: 'Заголовок факту (до 80 символів)' },
                    content: { type: 'string', description: 'Повне самодостатнє твердження українською, з явними датами ДД.ММ.РРРР, без «сьогодні/вчора»' },
                    valid_from: { type: 'string', description: 'З якої дати діє (YYYY-MM-DD), якщо факт про майбутнє; інакше пропусти' },
                    valid_until: { type: 'string', description: 'До якої дати діє (YYYY-MM-DD), якщо відомо' },
                    stale_markers: { type: 'string', description: 'КОРОТКІ (2-4 слова) фрази СТАРОГО формулювання (по одній у рядок), яких більше не можна вживати в постах, напр. "15 тестувальників"' },
                }, ['topic', 'title', 'content']),
            tool('expire_fact', 'Позначити факт застарілим без заміни (передай id з get_facts або topic).',
                { id: { type: 'string' }, topic: { type: 'string' }, valid_until: { type: 'string', description: 'опційно YYYY-MM-DD' } }),
            tool('find_stale_posts', 'Заплановані пости та чернетки (від сьогодні), у яких лишилась фраза зі старого формулювання (stale_markers фактів). Повертає номери постів — виправ їх через get_post + edit_post.', {}),
        ];
        let added = 0;
        let refreshed = 0;
        for (const t of wanted) {
            const i = tools.findIndex((x) => x.name === t.name);
            if (i < 0) { tools.push(t); added++; }
            else if (JSON.stringify(tools[i]) !== JSON.stringify(t)) { tools[i] = t; refreshed++; }
        }
        if (added || refreshed) data.tools = tools;
        const qa = String(n.data.qaExpectation || '');
        if (!qa.includes('save_fact')) data.qaExpectation = qa + ' Нову інформацію про стан продукту (числа, етапи, дати) зберігає через save_fact (з topic, щоб замінити старий факт), а не save_rule, і виправляє заплановані пости зі старим формулюванням.';
        if (Object.keys(data).length) { await callTool('update_node', { botId: CM, nodeId: N_AGENT, data }); console.log('agent: patched', Object.keys(data).join(', '), '(+' + added + ' tools)'); }
        else console.log('agent: already patched');
    }

    // 4) Dispatcher
    {
        const n = node(N_DISPATCH);
        const sp = String(n.data.systemPrompt);
        if (sp.includes('НОВА ІНФОРМАЦІЯ')) console.log('dispatcher: already patched');
        else {
            const old = '- "save_rule" — зберегти правило/корекцію стилю: "запам\'ятай", "не використовуй", "завжди", "ніколи", "надалі", "тон має бути".';
            if (!sp.includes(old)) throw new Error('dispatcher: рядок save_rule не знайдено');
            const neu = old + '\n  ТАКОЖ "save_rule" — НОВА ІНФОРМАЦІЯ про продукт/компанію/статус, яку користувач повідомляє (новини, цифри, етапи запуску, дати, «у нас уже…», «тепер…», «зʼявилось…», «коли буде N — вийде…», скільки людей тестує/користується), навіть БЕЗ слів «запамʼятай». Якщо в одному повідомленні і нова інформація, і прохання написати пости — теж "save_rule" (агент спершу збереже факти, а потім створить пости).';
            await callTool('update_node', { botId: CM, nodeId: N_DISPATCH, data: { systemPrompt: sp.replace(old, neu) } });
            console.log('dispatcher: patched');
        }
    }

    // 5) Dispatcher: «розкидай по одному на день» → date = «N днів від завтра» (інакше всі пости лягали на одну дату;
    //    Parse Intent розкидає по днях лише коли date містить «N днів/тижнів»; виявлено 2026-10-02 на постах для організаторів)
    {
        const n = node(N_DISPATCH);
        const sp = String(n.data.systemPrompt);
        if (sp.includes('РОЗКИДАТИ ПО ДНЯХ')) console.log('dispatcher spread: already patched');
        else {
            const needle = '- topic: якщо користувач ЯВНО вказав тему';
            if (!sp.includes(needle)) throw new Error('dispatcher: рядок topic не знайдено');
            const add = '- РОЗКИДАТИ ПО ДНЯХ: якщо користувач просить розкидати пости по днях («по одному на день», «щодня по одному», «розкидай по днях») і дає count N — став date = «N днів від завтра» (або «N днів від <дата>»), щоб на кожен день припав один пост. Не став date=«завтра» для кількох постів, коли просили розкидати.\n';
            await callTool('update_node', { botId: CM, nodeId: N_DISPATCH, data: { systemPrompt: sp.replace(needle, add + needle) } });
            console.log('dispatcher spread: patched');
        }
    }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
