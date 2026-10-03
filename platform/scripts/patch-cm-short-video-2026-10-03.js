'use strict';
// Patch (джерело істини): Content Manager пише СЦЕНАРІЇ коротких відео БЕЗ обличчя (TikTok / YouTube Shorts / Reels)
// і віддає їх воронці content-short-video (рендер: мікросервіс apps/short-video).
//
// Проблема (виявлено 2026-10-03): «2 YouTube Shorts зі сценаріями» перетворювались на два Instagram Reels, а замість сценарію
// пост містив лише підпис + англійський промпт для Kling; формату tiktok/youtube у диспетчері не було, структур під відео теж.
// Що робимо:
//   1) Dispatcher — формати tiktok_video / youtube_short; «відео без аватара» = create, не dialog;
//   2) Parse Intent — підписи форматів, менший батч для відео;
//   3) ST: Generate — platform tiktok|youtube, funnel_slug content-short-video, блок ВІДЕО-СЦЕНАРІЇ (схема funnel_params.scenes);
//   4) Accumulate / Build import payload — чистка й хуманайзер торкаються і scenes[].text (але не visual/style/music);
//   5) Content Agent — як створити відео-пост через create_post і показати сценарій користувачу.
// Idempotent. Run on the server:  node scripts/patch-cm-short-video-2026-10-03.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const N = {
    dispatch: 'node_1780590851896', parse: 'node_1780590874133', st: 'node_1780590932392',
    accum: 'node_1781266857076', build: 'node_1781266905762', agent: 'node_agent_content_mgr',
};
const MARK = 'ВІДЕО-СЦЕНАРІЇ';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const VIDEO_BLOCK = String.raw`ВІДЕО-СЦЕНАРІЇ (формати tiktok_video, youtube_short, instagram_reels — короткі вертикальні відео БЕЗ людини в кадрі, 12-18 с; збирає воронка content-short-video):
Такий пост — це СЦЕНАРІЙ. У JSON: platform = tiktok | youtube | reels; post_type = video | short | reel; funnel_slug = "content-short-video"; content = ПІДПИС під відео (1-2 речення + заклик + 3-5 хештегів; для youtube — ще перший рядок-назва ≤100 символів); structure = одна зі структур vid_* зі списку СТРУКТУРИ ПОСТІВ (vid_cartoon_story, vid_kinetic_facts, vid_organizer_story, vid_pov_mini_film); hook = напис першої сцени. funnel_params:
{"style":"<ДОСЛІВНО англійський рядок після STYLE: з правила «Стиль відео» у БАЗОВИХ ПРАВИЛАХ>","music":{"prompt":"<англійською: легка грайлива музика під настрій сюжету, 120 BPM, без вокалу>"},"scenes":[{"sec":3,"visual":"<англійською: що в кадрі; героя називай the character; без тексту, літер і брендів у кадрі>","text":"<напис на екрані: українською, ≤6 слів, без емодзі й тире>","motion":"zoom_in|zoom_out|pan_left|pan_right"}, ...]}
ПРАВИЛА СЦЕНАРІЮ: 4-6 сцен, sec 2-4 (разом 12-18 с). Сцена 1 — ХУК за 3 с: конфлікт, який глядач впізнає (нудна субота, порожня зала, чати мовчать), + напис-питання/POV/цифра; жодних привітань і логотипів. Далі: ускладнення → поворот (додаток) → результат (компанія, подія) → останній напис = CTA. Сюжет має читатись БЕЗ звуку. Чергуй motion і плани (крупний/загальний). Один персонаж у всіх сценах. motion "ai" — максимум у ОДНІЙ сцені ролика і лише в структурі vid_pov_mini_film.
CTA і всі факти про додаток (тестування, релізи, платформи, функції, умови) — ТІЛЬКИ з блоку АКТУАЛЬНІ ФАКТИ; нічого не вигадуй. Хук добирай під аудиторію: для користувачів — біль «нічого робити / не знаю куди піти / чати мовчать»; для організаторів — «прийшло 3 з 10 / ніхто не знав про подію» (структура vid_organizer_story).
Кожен відео-пост — окремий сюжет: не повторюй сюжет, хук і написи з ОСТАННІХ ПОСТІВ ЗА 30 ДНІВ.

`;

const AGENT_VIDEO_BLOCK = String.raw`ВІДЕО БЕЗ ОБЛИЧЧЯ (TikTok / YouTube Shorts / Reels; мультик, анімація, міні-фільм під музику): якщо просять сценарій або створити таке відео (БЕЗ слів «аватар», «моє обличчя») —
1) виклич get_structures(platform) і обери vid_* структуру; стиль і персонажа бери з правила «Стиль відео» у БАЗОВИХ ПРАВИЛАХ (рядок STYLE: копіюй дослівно в funnel_params.style); CTA і факти про додаток — ТІЛЬКИ з блоку АКТУАЛЬНІ ФАКТИ;
2) складай сценарій: 4-6 сцен по 2-4 с (разом 12-18 с), сцена 1 — хук за 3 с (конфлікт + напис ≤6 слів), останній напис — CTA; напис на екрані українською без емодзі й тире, visual англійською без тексту в кадрі, героя називай «the character»;
3) створи пост: create_post(platform=tiktok | youtube | reels, date, content=підпис з хештегами, funnel_slug="content-short-video", funnel_params={"style":"...","music":{"prompt":"..."},"scenes":[{"sec":3,"visual":"...","text":"...","motion":"zoom_in"}, ...]}, structure, hook_type, hook=напис сцени 1). Відео збереться автоматично за 3-6 хв і з'явиться в календарі;
4) покажи користувачу сценарій по сценах (код-блок: номер, тривалість, що в кадрі, напис на екрані) і підпис; скажи, що відео рендериться. Якщо користувач просить лише сценарій без створення — покажи його і запропонуй створити.
Відео з АВАТАРОМ (обличчя автора) — окремо через create_avatar_reel.

`;

async function main() {
    const f = await callTool('get_funnel', { botId: CM });
    const node = (id) => f.nodes.find((x) => x.id === id);

    // 1) Dispatcher
    {
        const sp = String(node(N.dispatch).data.systemPrompt);
        if (sp.includes('tiktok_video')) console.log('dispatcher: already patched');
        else {
            const a = '- telegram_post → telegram';
            if (!sp.includes(a)) throw new Error('dispatcher: рядок telegram_post не знайдено');
            let next = sp.replace(a, a + '\n- tiktok_video → tiktok\n- youtube_short → youtube');
            const b = '- ВИНЯТОК — ВІДЕО/РІЛС З АВАТАРОМ:';
            if (!next.includes(b)) throw new Error('dispatcher: рядок ВИНЯТОК не знайдено');
            next = next.replace(b, '- ВІДЕО БЕЗ АВАТАРА: «відео / ролик / шортс / тікток / рілс / мультик / анімація / міні-фільм» БЕЗ слів «аватар», «моє обличчя», «я в кадрі» — це intent="create": для TikTok format=tiktok_video (platform tiktok), для YouTube Shorts format=youtube_short (platform youtube), для Reels format=instagram_reels (platform reels); count = кількість відео; «зі сценаріями / сценарій» теж create (сценарій і є пост); тему ролика клади в topic.\n' + b + ' (ТІЛЬКИ коли явно просять аватара/обличчя автора; звичайні відео без обличчя — див. пункт вище)');
            await callTool('update_node', { botId: CM, nodeId: N.dispatch, data: { systemPrompt: next } });
            console.log('dispatcher: patched');
        }
    }

    // 2) Parse Intent
    {
        let code = String(node(N.parse).data.code);
        if (code.includes('tiktok_video')) console.log('parse: already patched');
        else {
            const a = "telegram_post:'Telegram'};";
            const b = 'var batchSize=7;';
            if (!code.includes(a) || !code.includes(b)) throw new Error('parse: маркери FMT/batchSize не знайдено');
            code = code.replace(a, "telegram_post:'Telegram',tiktok_video:'TikTok відео',youtube_short:'YouTube Shorts'};")
                .replace(b, "var batchSize=resolvedTasks.some(function(r){return /tiktok_video|youtube_short|instagram_reels/.test(String(r.format));})?4:7; // відео-сценарії великі: менший батч");
            new Function('context', code);
            await callTool('update_node', { botId: CM, nodeId: N.parse, data: { code } });
            console.log('parse: patched');
        }
    }

    // 3) ST: Generate
    {
        let sp = String(node(N.st).data.systemPrompt);
        if (sp.includes(MARK)) console.log('ST: already patched');
        else {
            const enumOld = '"platform":"threads|instagram|stories|reels|linkedin|telegram"';
            const slugOld = '- instagram_reels → content-ai-bg або content-video-broll';
            const anchor = 'ТОЧНА КІЛЬКІСТЬ:';
            if (!sp.includes(enumOld) || !sp.includes(slugOld) || !sp.includes(anchor)) throw new Error('ST: маркери не знайдено (enum/slug/ТОЧНА КІЛЬКІСТЬ)');
            sp = sp.replace(enumOld, '"platform":"threads|instagram|stories|reels|linkedin|telegram|tiktok|youtube"')
                .replace(slugOld, '- instagram_reels / tiktok_video / youtube_short → funnel_slug: content-short-video (відео БЕЗ обличчя зі сценарію, див. блок ВІДЕО-СЦЕНАРІЇ); content-video-broll — лише якщо користувач прямо просить окремий AI-кліп без сюжету')
                .replace(anchor, VIDEO_BLOCK + anchor);
            await callTool('update_node', { botId: CM, nodeId: N.st, data: { systemPrompt: sp } });
            console.log('ST: patched');
        }
    }

    // 4) Accumulate + Build payload (humanizer)
    {
        let code = String(node(N.accum).data.code);
        if (code.includes('funnel_params.scenes')) console.log('accum: already patched');
        else {
            const a = "if(typeof p.funnel_params.subtitle==='string') p.funnel_params.subtitle=cleanUk(p.funnel_params.subtitle);";
            if (!code.includes(a)) throw new Error('accum: маркер subtitle не знайдено');
            code = code.replace(a, a + "\n      if(Array.isArray(p.funnel_params.scenes)){ p.funnel_params.scenes.forEach(function(s){ if(s && typeof s.text==='string') s.text=cleanUk(s.text); }); }");
            new Function('context', code);
            await callTool('update_node', { botId: CM, nodeId: N.accum, data: { code } });
            console.log('accum: patched');
        }
        let b = String(node(N.build).data.code);
        if (b.includes('scenes[].text')) console.log('build: already patched');
        else {
            const t1 = 'funnel_params.slides[].subText)';
            const t2 = 'image_prompt та imagePrompt (лишай англійською).';
            if (!b.includes(t1) || !b.includes(t2)) throw new Error('build: маркери humanizer не знайдено');
            b = b.replace(t1, 'funnel_params.slides[].subText, funnel_params.scenes[].text)')
                .replace(t2, 'image_prompt та imagePrompt (лишай англійською); funnel_params.scenes[].visual/sec/motion/motionPrompt, funnel_params.style, funnel_params.music — англійською/числа, не чіпай.');
            new AsyncFunction('context', 'keys', b); // тіло ноди має top-level await (двигун обгортає в async)
            await callTool('update_node', { botId: CM, nodeId: N.build, data: { code: b } });
            console.log('build: patched');
        }
    }

    // 7) Parse Intent: «14 днів від 06.10.2026» розкидалось від СЬОГОДНІ, бо явна дата початку ігнорувалась (startD завжди today/завтра).
    //    Знайдено 2026-10-03 на плані відео для KIRO: пости лягли на 03.10-16.10 замість 06.10-19.10.
    {
        let code = String(node(N.parse).data.code);
        if (code.includes('__exStart')) console.log('parse start-date: already patched');
        else {
            const a = "// «від завтра»";
            if (!code.includes(a)) throw new Error('parse start-date: маркер «від завтра» не знайдено');
            const add = String.raw`
    var __exStart = String(t.date||'').match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/); // явна дата початку: «від 06.10.2026»
    if (__exStart) { var __y = __exStart[3] ? parseInt(__exStart[3],10) : baseToday.getFullYear(); if (__y < 100) __y += 2000; startD = new Date(__y, parseInt(__exStart[2],10)-1, parseInt(__exStart[1],10)); }`;
            code = code.replace(a, a + add);
            new Function('context', code);
            await callTool('update_node', { botId: CM, nodeId: N.parse, data: { code } });
            console.log('parse start-date: patched');
        }
    }

    // 8) Parse Intent: відео-план шматками по 5 (а не 10). 2026-10-03: перший шматок із 10 відео-сценаріїв (~25 КБ JSON) закінчився
    //    bulk-import 500 «Unexpected end of JSON input» (тіло запиту обірвалось) — 10 плейсхолдерів зависли й впали по таймауту.
    {
        let code = String(node(N.parse).data.code);
        if (code.includes('__videoChunk')) console.log('parse chunk: already patched');
        else {
            const a = 'var CHUNK_MAX = 10;';
            if (!code.includes(a)) throw new Error('parse chunk: маркер CHUNK_MAX не знайдено');
            code = code.replace(a, "var __videoChunk = resolvedTasks.some(function(r){return /tiktok_video|youtube_short|instagram_reels/.test(String(r.format));});\nvar CHUNK_MAX = __videoChunk ? 5 : 10;");
            new Function('context', code);
            await callTool('update_node', { botId: CM, nodeId: N.parse, data: { code } });
            console.log('parse chunk: patched');
        }
    }

    // 6) Chat text: для відео-постів показуємо сценарій по сценах (раніше в чат ішов лише підпис)
    {
        const cn = node('node_1781269102711');
        let code = String(cn.data.code);
        if (code.includes('p.funnel_params.scenes')) console.log('chat text: already patched');
        else {
            const a = '  var vio = scanW(txt);';
            if (!code.includes(a)) throw new Error('chat text: маркер scanW не знайдено');
            const add = [
                "  if (p.funnel_slug === 'content-short-video' && p.funnel_params && Array.isArray(p.funnel_params.scenes)) {",
                "    var sc = p.funnel_params.scenes, tot = 0;",
                "    var sl = sc.map(function(s, k){ tot += Number(s.sec)||3; return (k+1)+') '+(Number(s.sec)||3)+' с · напис: «'+String(s.text||'')+'» · кадр: '+String(s.visual||'').slice(0,110); });",
                "    lines.push('🎬 Сценарій (≈'+Math.round(tot)+' с, відео без обличчя; збереться за 3-6 хв і зʼявиться в календарі):');",
                "    lines.push(FENCE); lines.push(sl.join('\\n'));",
                "    if (p.funnel_params.music && p.funnel_params.music.prompt) lines.push('музика: '+p.funnel_params.music.prompt);",
                "    lines.push(FENCE);",
                "  }",
            ].join('\n') + '\n';
            code = code.replace(a, add + a);
            new Function('context', code);
            await callTool('update_node', { botId: CM, nodeId: 'node_1781269102711', data: { code } });
            console.log('chat text: patched');
        }
    }

    // 5) Content Agent
    {
        const n = node(N.agent);
        const sp = String(n.data.systemPrompt);
        if (sp.includes('ВІДЕО БЕЗ ОБЛИЧЧЯ')) console.log('agent: already patched');
        else {
            const anchor = 'ЛІД-МАГНІТИ І ПОСИЛАННЯ';
            if (!sp.includes(anchor)) throw new Error('agent: маркер ЛІД-МАГНІТИ не знайдено');
            const qa = String(n.data.qaExpectation || '');
            await callTool('update_node', { botId: CM, nodeId: N.agent, data: {
                systemPrompt: sp.replace(anchor, AGENT_VIDEO_BLOCK + anchor),
                qaExpectation: qa + ' Сценарій короткого відео без обличчя (TikTok/Shorts/Reels) створює через create_post з funnel_slug=content-short-video і funnel_params.scenes (а не звичайним текстовим постом) і показує його по сценах.',
            } });
            console.log('agent: patched');
        }
    }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
