'use strict';
// Patch (source of truth): онбординг контент-платформи v4 (структура питань —
// Контент платформа/документація/онбординг-структура-питань-v4.md).
//  1) n_agent: новий системний промпт (scripts/onboard-v4/system-prompt.md) — пропозиції замість опитування,
//     приклад до кожного питання, без архетипів/розподілу контенту у розмові, зразки текстів, два шляхи;
//     інструмент fetch_page (читання сайтів клієнта); оновлений опис query_vector; qaExpectation.
//  2) ключі воронки FETCH_PAGE_URL, SEARCH_SECRET (значення SEARCH_SECRET береться з .env платформи, не друкується).
//  3) n_resolve_project: contextOverride.testProjectId для QA холодного старту.
// Ідемпотентний. Запуск на сервері:  node scripts/patch-onboard-v4-2026-10-14.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const ONBOARD = 'ab566038-395e-4da8-b500-8f9b226bc77a';
const read = (f) => fs.readFileSync(path.join(__dirname, 'onboard-v4', f), 'utf8');

const QA_EXPECTATION =
    'Агент онбордингу v4: говорить по-людськи українською на «ти», 2-4 речення, не більше одного уточнення за хід; до питань дає приклад хорошої відповіді; ' +
    'на тонку відповідь або «не знаю» сам пропонує чернетку чи 3 варіанти, а не перепитує; НЕ вигадує факти, кейси й цифри клієнта; ' +
    'НЕ вживає клієнту слів «архетип», «7 дотиків», «розподіл %», cyclePosition; не перепитує те, що клієнт уже сказав.';

const QUERY_VECTOR_DESC =
    'Пошук у спільній базі знань платформи (типи контенту, цикл «7 дотиків», схеми дописів, опис архетипів). ' +
    'Викликай для банку тем і (мовчки, без обговорення з клієнтом) для архетипу засновника — лише результати пошуку, не вигадуй.';

const FETCH_PAGE_TOOL = {
    name: 'fetch_page',
    description: 'Відкрити сторінку за URL (сайт, соцмережа клієнта) і повернути її текст. Використовуй, коли клієнт дав посилання на сайт чи профіль. JS-важкі сторінки можуть бути порожніми — тоді попроси клієнта вставити текст.',
    inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' }, maxChars: { type: 'number' } },
        required: ['url'],
    },
    url: '{{env.FETCH_PAGE_URL}}',
    method: 'POST',
    headers: { 'X-Search-Secret': '{{env.SEARCH_SECRET}}' },
};

async function main() {
    const out = {};

    // 2. ключі
    await callTool('update_funnel_key', { botId: ONBOARD, key: 'FETCH_PAGE_URL', value: 'http://127.0.0.1:3000/api/websearch/page', label: 'Роут читання сторінки в текст' });
    if (process.env.SEARCH_SECRET) {
        await callTool('update_funnel_key', { botId: ONBOARD, key: 'SEARCH_SECRET', value: process.env.SEARCH_SECRET, label: 'Секрет роутів пошуку у Flows', isSecret: true });
        out.searchSecret = 'set';
    } else {
        out.searchSecret = 'MISSING in .env — fetch_page won\'t authenticate';
    }

    // 1. агент
    const fn = await callTool('get_funnel', { botId: ONBOARD });
    const agent = fn.nodes.find((n) => n.id === 'n_agent');
    const SAVE_NOTE = ' ВАЖЛИВО: data — JSON-обʼєкт, не рядок; відповідь не ok:true (або created:0) — повтори виправлений виклик і не повідомляй клієнту про збереження.';
    const tools = (agent.data.tools || []).map((t) => {
        if (t.name === 'query_vector') return { ...t, description: QUERY_VECTOR_DESC };
        if (t.name === 'save' && !String(t.description).includes('data — JSON-обʼєкт')) return { ...t, description: t.description + SAVE_NOTE };
        return t;
    });
    if (!tools.some((t) => t.name === 'fetch_page')) tools.push(FETCH_PAGE_TOOL);
    const prompt = read('system-prompt.md').trim();
    await callTool('update_node', { botId: ONBOARD, nodeId: 'n_agent', data: { systemPrompt: prompt, tools, qaExpectation: QA_EXPECTATION, maxTokens: 8192 } });
    out.agent = 'prompt ' + prompt.length + ' chars, tools: ' + tools.map((t) => t.name).join(',');

    // 3. resolve
    await callTool('update_node', { botId: ONBOARD, nodeId: 'n_resolve_project', data: { code: read('resolve-project.js') } });
    out.resolve = 'updated';

    console.log(JSON.stringify(out, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
