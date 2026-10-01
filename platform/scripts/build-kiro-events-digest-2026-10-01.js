'use strict';
// Воронка (джерело істини — нода, не код): "KIRO: дайджест подій".
// Раз у понеділок і четвер бере РЕАЛЬНІ майбутні події з публічного KIRO API
// (GET /api/v1/discovery, без автентифікації), пише ОДИН пост-дайджест про 1-3 події
// БЕЗ ВИГАДОК (тільки факти з API), і додає його в контент-план content2 зі статусом
// "scheduled" — публікує вже наявний автопостинг-планувальник content2, ця воронка
// САМА нічого не постить і не кличе Threads API напряму. Ізольовано від Content
// Manager — свій простий промпт, жодних спільних нод/ключів CM не чіпає.
// Node id генеруються двигуном автоматично (node_<timestamp>) — скрипт ловить їх
// із відповіді кожного add_node і сам зводить ребра. Умовні ребра з condition
// матчаться ПОРЯДКОМ СТВОРЕННЯ (не handle-полем) — тому створюємо їх у тому ж
// порядку, що й масив conditions.
//   node scripts/build-kiro-events-digest-2026-10-01.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const BOT_ID = '49309e59-a64d-4f02-bd82-8d6c4ca4dd8b';
const KIRO_CONTENT2_PROJECT_ID = 'cmucrsgv30000wozyziaak11e';
const CLAUDE_SONNET_CONNECTOR = '2ec53ba5-144e-463b-9758-c217c4a69b0e';
const WEBHOOK_SECRET = 'fnk_wh_2026_x9mK4pLqR7vNsT1eYcJdBuAw';

async function add(type, position, data) {
    const r = await callTool('add_node', { botId: BOT_ID, type, position, data });
    return r.added.id;
}
async function edge(source, target) {
    await callTool('create_edge', { botId: BOT_ID, source, target });
}

async function main() {
    // 1) Прибираємо дефолтні demo-ноди (цей бот не веде діалог).
    try { await callTool('delete_node', { botId: BOT_ID, nodeId: 'msg_intro' }); } catch (e) { console.log('delete msg_intro:', e.message); }

    // 2) Дати (Kyiv) — вікно пошуку подій.
    const nDates = await add('js', { x: 80, y: 240 }, {
        label: 'Дати (Kyiv)',
        code: "var kyivNow = new Date(Date.now() + 3*3600*1000);\nvar todayISO = kyivNow.toISOString().slice(0,10);\nvar until = new Date(kyivNow.getTime() + 10*24*3600*1000);\nvar untilISO = until.toISOString().slice(0,10);\nreturn { todayISO: todayISO, untilISO: untilISO, kyivHour: kyivNow.getUTCHours() };",
    });

    // 3) Які події вже анонсували раніше (щоб не повторюватись) — per-bot файл, той самий
    //    webhook_system користувач перевикористовується щоразу, коли кронвиклик без _ownerTelegramId.
    const nLoadAnnounced = await add('loadFile', { x: 80, y: 400 }, {
        label: 'Вже анонсовані події', fileType: 'kiro_announced_events', onMissing: 'skip', outputVar: 'context.announcedRaw',
    });

    // 4) Реальні майбутні події — публічний discovery API KIRO, без автентифікації.
    const nFetchEvents = await add('httpRequest', { x: 80, y: 560 }, {
        label: 'KIRO: майбутні події (discovery)',
        method: 'GET',
        url: 'https://kiro.fineko.space/api/v1/discovery?dateFrom={{context.todayISO}}&dateTo={{context.untilISO}}&limit=20',
        outputVar: 'context.discoveryRaw',
    });

    // 5) Правила бренду (той самий get_rules, що й Content Manager читає — лише ЧИТАННЯ,
    //    жодних спільних нод CM не чіпаємо).
    const nGetRules = await add('httpRequest', { x: 80, y: 720 }, {
        label: 'Правила бренду (content2, read-only)',
        method: 'GET',
        url: 'https://content2.fineko.space/api/agent-tools?action=get_rules&token=' + WEBHOOK_SECRET + '&projectId=' + KIRO_CONTENT2_PROJECT_ID,
        outputVar: 'context.rulesRaw',
    });

    // 6) Відбір подій: фільтр (опубліковані, не тестові, не скасовані, ще не анонсовані),
    //    пріоритет Києву, до 3 штук, у звичайний текст-факти для промпту.
    const pickCode = [
        "var announced = [];",
        "try { var a = JSON.parse(context.announcedRaw || '[]'); if (Array.isArray(a)) announced = a.map(String); } catch(e) {}",
        "",
        "var items = [];",
        "try { var parsed = typeof context.discoveryRaw === 'string' ? JSON.parse(context.discoveryRaw) : context.discoveryRaw; items = Array.isArray(parsed && parsed.items) ? parsed.items : []; } catch(e) {}",
        "",
        "var candidates = items.filter(function(e){",
        "  return e && e.status === 'PUBLISHED' && e.visibility === 'PUBLIC' && !e.isTest && !e.cancelledAt && announced.indexOf(e.id) === -1;",
        "});",
        "",
        "var kyiv = candidates.filter(function(e){ return e.city && (e.city.nameUk === 'Київ' || e.city.slug === 'kyiv'); });",
        "var pool = kyiv.length ? kyiv : candidates;",
        "pool.sort(function(a,b){ return new Date(a.startsAt) - new Date(b.startsAt); });",
        "var picked = pool.slice(0, 3);",
        "",
        "function fmtDate(iso){",
        "  var d = new Date(iso);",
        "  var kd = new Date(d.getTime() + 3*3600*1000);",
        "  var dd = String(kd.getUTCDate()).padStart(2,'0');",
        "  var mm = String(kd.getUTCMonth()+1).padStart(2,'0');",
        "  var hh = String(kd.getUTCHours()).padStart(2,'0');",
        "  var mi = String(kd.getUTCMinutes()).padStart(2,'0');",
        "  return dd + '.' + mm + ' о ' + hh + ':' + mi;",
        "}",
        "function price(e){",
        "  if (e.priceType === 'FREE') return 'безкоштовно';",
        "  if (e.priceType === 'DONATION') return 'донат';",
        "  return e.price ? (e.price + ' ' + (e.currency || 'грн')) : 'платно';",
        "}",
        "",
        "var factsLines = picked.map(function(e){",
        "  var place = e.addressText || (e.city && e.city.nameUk) || '';",
        "  var cityTxt = e.city ? (' (' + e.city.nameUk + ')') : '';",
        "  var desc = String(e.description || '').replace(/\\n/g, ' ').slice(0, 200);",
        "  return '- «' + e.title + '» — ' + fmtDate(e.startsAt) + ', ' + place + cityTxt + ', ' + price(e) + '. ' + desc;",
        "});",
        "",
        "var rulesText = '';",
        "try { var rp = typeof context.rulesRaw === 'string' ? JSON.parse(context.rulesRaw) : context.rulesRaw; rulesText = (rp && rp.rules) || ''; } catch(e) {}",
        "",
        "return {",
        "  hasEvents: picked.length > 0,",
        "  pickedCount: picked.length,",
        "  pickedIds: picked.map(function(e){ return e.id; }),",
        "  pickedTitles: picked.map(function(e){ return e.title; }).join(', '),",
        "  eventFactsText: factsLines.join('\\n') || 'немає',",
        "  rulesCleanText: rulesText.slice(0, 1500),",
        "};",
    ].join('\n');
    const nPickEvents = await add('js', { x: 80, y: 880 }, { label: 'Відбір подій (факти, не вигадки)', code: pickCode });

    // 7) Гілка: чи є що анонсувати. Порядок conditions = порядок майбутніх ребер (0 перше, 1 друге).
    const nCondHasEvents = await add('condition', { x: 80, y: 1040 }, {
        label: 'Є нові події?',
        conditions: [
            { id: '0', label: '→ так, пишемо пост', expression: 'context.hasEvents === true' },
            { id: '1', label: '→ ні, завершити', expression: 'true' },
        ],
    });

    // 9) Пишемо пост — власний, ізольований промпт (не торкається Content Manager).
    const sysPrompt = [
        'Ти пишеш ОДИН Threads-пост для профілю kiro.ukraine — застосунку для пошуку подій і людей поруч у Києві.',
        'ТОН: «ти», невимушено, живо, без пафосу й канцеляриту, зрідка дужка в кінці речення як усмішка :). Чиста українська, без русизмів.',
        '',
        'ФАКТИ ПРО ПОДІЇ (використовуй ТІЛЬКИ це — назву, дату, місце, ціну; нічого не вигадуй і не додавай подій, яких тут немає):',
        '{{context.eventFactsText}}',
        '',
        'ПРАВИЛА БРЕНДУ З БАЗИ ЗНАНЬ:',
        '{{context.rulesCleanText}}',
        '',
        'ВАЖЛИВО: додаток KIRO ЗАРАЗ на перевірці в Google Play, ще НЕ доступний для публічного завантаження. НЕ пиши «скачай» і не давай посилань на стор. Якщо є природне місце для CTA — запрошуй стати одним з перших 15 тестувальників (написати в директ/коментарі). Якщо CTA не вписується органічно — просто покажи подію як доказ, що в KIRO вже реально щось відбувається, без примусового заклику.',
        'Довжина: 250-500 символів (Threads обрізає стрічку довше). Без хештегів (максимум 1). Якщо подій кілька — об’єднай в один зв’язний пост, не список-простирадло.',
        'Відповідай ТІЛЬКИ текстом поста, без лапок навколо, без пояснень.',
    ].join('\n');
    const nWritePost = await add('claude', { x: -180, y: 1200 }, {
        label: 'Написати пост (ізольовано від CM)',
        mode: 'single',
        model: 'claude-sonnet-4-6',
        connectorId: CLAUDE_SONNET_CONNECTOR,
        systemPrompt: sysPrompt,
        messagesTemplate: '[{"role":"user","content":"Напиши пост. Подій у фактах: {{context.pickedCount}}."}]',
        exitCondition: 'none',
        outputVar: 'context.postText',
    });

    // 10) Збираємо payload для content2 bulk-import — ЧАС публікації = найближчий ще не
    //     минулий сьогоднішній крон-слот (09:00/12:00/18:00 Kyiv), інакше завтра 09:00.
    //     Сама воронка нічого не постить — лише кладе запис зі status:"scheduled",
    //     публікує вже наявний планувальник content2 /api/scheduler/run.
    const buildCode = [
        "var content = String(context.postText || '').trim();",
        "content = content.replace(/^```[a-z]*\\n?/i, '').replace(/```$/, '').trim();",
        "content = content.replace(/^\"|\"$/g, '').trim();",
        "",
        "var slots = ['09:00', '12:00', '18:00'];",
        "var hh = context.kyivHour;",
        "var chosenDate = context.todayISO;",
        "var chosenTime = slots.find(function(s){ return parseInt(s, 10) > hh; });",
        "if (!chosenTime) {",
        "  chosenTime = '09:00';",
        "  chosenDate = new Date(new Date(context.todayISO).getTime() + 24*3600*1000).toISOString().slice(0, 10);",
        "}",
        "",
        "var payload = {",
        "  projectId: '" + KIRO_CONTENT2_PROJECT_ID + "',",
        "  posts: [{",
        "    date: chosenDate,",
        "    platform: 'threads',",
        "    content: content,",
        "    audience: 'cold',",
        "    post_type: 'post',",
        "    schedule_time: chosenTime,",
        "    intent: 'trust',",
        "    structure: 'ps_za_lashtunkamy',",
        "  }],",
        "};",
        "",
        "return { importPayload: JSON.stringify(payload), chosenDate: chosenDate, chosenTime: chosenTime };",
    ].join('\n');
    const nBuildPayload = await add('js', { x: -180, y: 1360 }, { label: 'Зібрати payload для плану', code: buildCode });

    // 11) Записуємо в контент-план content2 (той самий endpoint, яким користується CM) —
    //     далі публікацію робить вже наявний автопостинг-планувальник, не ця воронка.
    const nSavePost = await add('httpRequest', { x: -180, y: 1520 }, {
        label: 'Додати в контент-план (content2)',
        method: 'POST',
        url: 'https://content2.fineko.space/api/posts/bulk-import?token=' + WEBHOOK_SECRET,
        bodyTemplate: '{{context.importPayload}}',
        outputVar: 'context.saveResult',
    });

    // 12) Позначити ці події як анонсовані (щоб не повторювати наступного разу).
    const nMarkAnnounced = await add('js', { x: -180, y: 1680 }, {
        label: 'Позначити події анонсованими',
        code: [
            "var announced = [];",
            "try { var a = JSON.parse(context.announcedRaw || '[]'); if (Array.isArray(a)) announced = a.map(String); } catch(e) {}",
            "var newIds = Array.isArray(context.pickedIds) ? context.pickedIds : [];",
            "var merged = announced.concat(newIds);",
            "if (merged.length > 150) merged = merged.slice(merged.length - 150);",
            "return { announcedToSave: JSON.stringify(merged) };",
        ].join('\n'),
    });

    const nSaveAnnounced = await add('saveFile', { x: -180, y: 1840 }, {
        label: 'Зберегти список анонсованих', fileType: 'kiro_announced_events', contentVar: 'context.announcedToSave',
    });

    // 13) Підсумок власнику.
    const nNotifyDone = await add('notifyAdmin', { x: -180, y: 2000 }, {
        label: 'Готово — сповістити власника',
        targetKey: 'ADMIN_TELEGRAM_ID',
        message: '📅 KIRO дайджест подій: додав у план пост про {{context.pickedCount}} подію/ій ({{context.pickedTitles}}) на {{context.chosenDate}} {{context.chosenTime}}. Публікацію зробить автопостинг-планувальник.\n\nТекст поста:\n{{context.postText}}',
    });

    // 8) Нема нічого нового — повідомити власнику й завершити.
    const nNotifyNothing = await add('notifyAdmin', { x: 340, y: 1200 }, {
        label: 'Немає нових подій',
        targetKey: 'ADMIN_TELEGRAM_ID',
        message: '📅 KIRO дайджест подій: у вікні найближчих 10 днів немає нових опублікованих подій (або всі вже анонсовані раніше). Нічого не додав у план.',
    });

    // 14) Ребра — лінійний ланцюжок + умовне розгалуження (порядок = порядок conditions).
    await edge('start_1', nDates);
    await edge(nDates, nLoadAnnounced);
    await edge(nLoadAnnounced, nFetchEvents);
    await edge(nFetchEvents, nGetRules);
    await edge(nGetRules, nPickEvents);
    await edge(nPickEvents, nCondHasEvents);
    await edge(nCondHasEvents, nWritePost); // condition id "0" (hasEvents === true) — перше ребро
    await edge(nCondHasEvents, nNotifyNothing); // condition id "1" (else) — друге ребро
    await edge(nWritePost, nBuildPayload);
    await edge(nBuildPayload, nSavePost);
    await edge(nSavePost, nMarkAnnounced);
    await edge(nMarkAnnounced, nSaveAnnounced);
    await edge(nSaveAnnounced, nNotifyDone);

    // 15) Ключі воронки.
    await callTool('update_funnel_key', { botId: BOT_ID, key: 'ADMIN_TELEGRAM_ID', value: '345126254' });
    await callTool('update_funnel_key', { botId: BOT_ID, key: 'CONTENT2_PROJECT_ID', value: KIRO_CONTENT2_PROJECT_ID });

    console.log('DONE: kiro-events-digest funnel built.', {
        nDates, nLoadAnnounced, nFetchEvents, nGetRules, nPickEvents, nCondHasEvents,
        nWritePost, nBuildPayload, nSavePost, nMarkAnnounced, nSaveAnnounced, nNotifyDone, nNotifyNothing,
    });
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
