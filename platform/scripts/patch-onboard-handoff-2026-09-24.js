'use strict';
// Patch (source of truth): onboarding -> Content Manager handoff + project switching from the bot.
//  1) onboard: n_done gets buttons ("Все ок" -> Content Manager, "Поправити" -> back to onboarding);
//     agent prompt: finish_onboarding + handoff on "generate posts", and "do not ask twice".
//  2) content-manager-v2: default project = KIRO; per-user active project (file `active_project`),
//     greeting on empty /start, and "перемкни на <проєкт>" switching — all as nodes.
//  3) unstick the owner's open onboarding session and DM him the handoff buttons.
// Idempotent. Run on the server:  node scripts/patch-onboard-handoff-2026-09-24.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');
const { db } = require('@platform/db');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';
const CM = '22f2bce5-ac62-4297-8ea0-66e258e8b505';
const KIRO_ID = 'cmucrsgv30000wozyziaak11e';
const OWNER_TG = '345126254';
const TG_CONNECTOR = 'eb411228-6318-4e15-8ddb-286d3776fe8b';
const BOT_URL = 'https://t.me/fineko_content_bot';
const read = (f) => fs.readFileSync(path.join(__dirname, 'handoff', f), 'utf8');

const DONE_TEXT =
    '🎉 Документи онбордингу створені! Ось що заповнено — відкрий і почитай:\n\n' +
    '🗂️ Усе разом: https://content2.fineko.space/user-data\n' +
    '📦 Продукти: https://content2.fineko.space/products\n' +
    '📝 Банк тем: https://content2.fineko.space/topics\n' +
    '🎁 Лід-магніти: https://content2.fineko.space/lead-magnets\n\n' +
    'Усе влучно? Якщо так — переходимо до контенту: Content Manager згенерує пости під цей профіль.';
const DONE_BUTTONS = [
    [{ text: '✅ Все ок — до Content Manager', url: BOT_URL + '?start=content-manager-v2' }],
    [{ text: '✏️ Поправити', url: BOT_URL + '?start=onboard' }],
];

const PROMPT_MARKER = 'ЗАВЕРШЕННЯ ТА ПЕРЕДАЧА';
const PROMPT_ADD =
    '\n\nЗАВЕРШЕННЯ ТА ПЕРЕДАЧА (обовʼязково):\n' +
    '- Профіль достатній, коли є профіль засновника, продукти, ≥1 персона, тон і стратегія (кейси, теми, лід-магніти — бажані). Тоді ОДРАЗУ підсумуй у 3-4 рядки і виклич finish_onboarding — не чекай додаткового підтвердження й не став нових питань.\n' +
    '- Якщо клієнт просить згенерувати пости чи контент-план («згенеруй 20 постів», «що далі», «пости на тиждень») — НЕ кажи, що це не твоя зона і не відсилай на сайт: коротко підсумуй профіль і виклич finish_onboarding. Після цього система сама покаже кнопку переходу до Content Manager, який і генерує пости.\n\n' +
    'НЕ ПЕРЕПИТУЙ: перед кожним питанням звір історію діалогу і get_profile. Що клієнт уже сказав (соцмережі, тон, продукт, аудиторія) — НЕ питай вдруге, використай і збережи. Про соцмережі питай РІВНО один раз і одразу збережи відповідь (save kind:"brand", title:"Соцмережі").';

async function sendTg(text, buttons) {
    const conn = await db.savedConnector.findUnique({ where: { id: TG_CONNECTOR }, select: { config: true } });
    const token = conn && conn.config && conn.config.token;
    if (!token) throw new Error('no telegram token');
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: OWNER_TG, text, disable_web_page_preview: true, reply_markup: { inline_keyboard: buttons } }),
    });
    const j = await r.json();
    return !!j.ok;
}

async function main() {
    const out = {};

    // ── 1. onboard ──────────────────────────────────────────────────────────
    await callTool('update_node', { botId: ONBOARD, nodeId: 'n_done', data: { text: DONE_TEXT, buttons: DONE_BUTTONS } });
    const ob = await callTool('get_funnel', { botId: ONBOARD });
    const agent = ob.nodes.find((n) => n.id === 'n_agent');
    if (String(agent.data.systemPrompt).includes(PROMPT_MARKER)) {
        out.onboardPrompt = 'already patched';
    } else {
        await callTool('update_node', { botId: ONBOARD, nodeId: 'n_agent', data: { systemPrompt: agent.data.systemPrompt + PROMPT_ADD } });
        out.onboardPrompt = 'patched';
    }

    // ── 2. content-manager-v2 ───────────────────────────────────────────────
    await callTool('update_funnel_key', { botId: CM, key: 'CONTENT2_PROJECT_ID', value: KIRO_ID, label: 'Проєкт за замовчуванням (content2)' });
    out.cmDefaultProject = 'KIRO';

    const cm = await callTool('get_funnel', { botId: CM });
    if (cm.nodes.some((n) => n.data && n.data.label === 'Активний проєкт користувача')) {
        out.cmNodes = 'already present, skipped';
    } else {
        const add = async (type, data) => (await callTool('add_node', { botId: CM, type, data, position: { x: 0, y: 0 } })).added.id;
        const edge = (source, target) => callTool('create_edge', { botId: CM, source, target });
        const delEdge = async (source, target) => {
            const e = cm.edges.find((x) => x.source === source && x.target === target);
            if (!e) throw new Error('edge not found ' + source + '->' + target);
            await callTool('delete_edge', { botId: CM, edgeId: e.id });
        };

        const nLoad = await add('loadFile', { label: 'Активний проєкт користувача', fileType: 'active_project', outputVar: 'context.activeProjectId', onMissing: 'skip' });
        const nPick = await add('js', { label: 'Обрати проєкт (контекст → збережений → за замовчуванням)', code: read('pick-project.js') });
        const nEmpty = await add('condition', {
            label: 'Порожній /start?',
            conditions: [
                { id: 'empty', label: 'порожній /start', expression: "(function(){var m=String(input||context.message||context.text||'').trim();return !m||/^\\/start\\b/i.test(m);})()" },
                { id: 'has', label: 'є запит', expression: 'true' },
            ],
        });
        const nGreet = await add('message', {
            label: 'Привітання Content Manager',
            text: '👋 Я Content Manager. Працюю з проєктом «{{context.profile.projectName}}» — генерую пости під його профіль.\n\nНапиши завдання, наприклад:\n• «20 постів для Threads, по 2-3 на день, на найближчий час»\n• «пост про мій досвід із велосипедом і Kiro»\n\nЩоб змінити проєкт — напиши «перемкни на <назва>».',
        });
        const nParse = await add('js', { label: 'Розпізнати «перемкни на проєкт»', code: read('sw-parse.js') });
        const nSwCond = await add('condition', {
            label: 'Це перемикання проєкту?',
            conditions: [
                { id: 'switch', label: 'так', expression: '!!context.swName' },
                { id: 'other', label: 'ні', expression: 'true' },
            ],
        });
        const nResolve = await add('httpRequest', {
            label: 'Знайти проєкт за назвою (content2)',
            url: '{{env.CONTENT2_URL}}/api/webhooks/resolve-project',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-webhook-secret': '{{env.CONTENT2_WEBHOOK_SECRET}}' },
            bodyFields: { name: '{{context.swName}}' },
            outputVar: 'context.swRes',
            ignoreErrors: true,
        });
        const nFound = await add('condition', {
            label: 'Проєкт знайдено?',
            conditions: [
                { id: 'found', label: 'так', expression: 'context.swRes && context.swRes.ok === true && !!context.swRes.id' },
                { id: 'nf', label: 'ні', expression: 'true' },
            ],
        });
        const nSet = await add('js', { label: 'Підготувати перемикання', code: read('sw-set.js') });
        const nSave = await add('saveFile', { label: 'Зберегти активний проєкт', fileType: 'active_project', contentVar: 'context.swSaved' });
        const nDone = await add('message', { label: 'Перемкнув', text: '✅ Перемкнув на проєкт «{{context.swProjectName}}». Далі всі пости й плани — для нього. Що згенерувати?' });
        const nNf = await add('message', { label: 'Проєкт не знайдено', text: '🤔 Не знайшов проєкт «{{context.swName}}». Напиши назву точно так, як у content2 (наприклад KIRO).' });

        // rewire: start -> load -> pick -> gate ; gate(ready) -> empty? -> greeting | parse -> switch? -> ... | Setup
        await delEdge('start_1', 'n_gate_profile');
        await edge('start_1', nLoad);
        await edge(nLoad, nPick);
        await edge(nPick, 'n_gate_profile');
        await callTool('update_node', { botId: CM, nodeId: 'n_gate_profile', data: { bodyFields: { projectId: '{{context.projectId}}' } } });

        await delEdge('n_gate_cond', 'node_1780590806221');
        await edge('n_gate_cond', nEmpty);             // appended after the "incomplete" edge => index1 = ready
        await edge(nEmpty, nGreet);                    // index0 = empty
        await edge(nEmpty, nParse);                    // index1 = has request
        await edge(nParse, nSwCond);
        await edge(nSwCond, nResolve);                 // index0 = switch
        await edge(nSwCond, 'node_1780590806221');     // index1 = normal flow -> Setup context
        await edge(nResolve, nFound);
        await edge(nFound, nSet);                      // index0 = found
        await edge(nFound, nNf);                       // index1 = not found
        await edge(nSet, nSave);
        await edge(nSave, nDone);
        await callTool('auto_layout', { botId: CM });
        out.cmNodes = 'added 12 nodes + rewired';
    }

    // ── 3. unstick the owner + DM the handoff buttons ───────────────────────
    const user = await db.user.findUnique({ where: { telegramId: BigInt(OWNER_TG) } });
    if (user) {
        const upd = await db.session.updateMany({
            where: { userId: user.id, botId: ONBOARD, state: { not: 'completed' } },
            data: { state: 'completed', isActive: false },
        });
        out.closedOnboardSessions = upd.count;
        out.dmSent = await sendTg('✅ Онбординг KIRO готовий. Переходимо до контенту?\n\nНатисни «Все ок» — і Content Manager почне працювати з проєктом KIRO. «Поправити» поверне в онбординг.', DONE_BUTTONS);
    } else {
        out.owner = 'user not found';
    }

    console.log(JSON.stringify(out, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
