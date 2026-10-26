'use strict';
// Онбординг експерта (onboard-seller), 26.10 (підсумки зустрічі 22.10):
//  • промпт агента: приклади під нішу, «не знаю що відповісти», контроль якості, передача фахівцю (edit-mode-prompt.md);
//  • інструмент request_specialist (запит зберігається в досьє й одразу йде в Telegram власнику та фахівцям);
//  • нода «Створити продавця» (js) між «Записати в content2» і «Режим завершення»: коли досьє готове, клон Дена на спільному боті
//    створюється сам (чернетка, нікому не відповідає, доки власник не перемкне статус); картка власнику показує посилання;
//  • код ноди «Зібрати картку запуску» (рядок про продавця в картці власнику).
// Ідемпотентний. Запуск на сервері з кореня platform/ (тексти беруться з файлів репозиторію після git pull):
//   PLATFORM_ROOT=$PWD node scripts/patch-onboard-seller-provision-2026-10-26.js            (DRY_RUN=1 — лише показати)

const fs = require('fs');
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const DRY = !!process.env.DRY_RUN;
const SLUG = 'onboard-seller';
const L = { agent: 'Онбординг-агент експерта', c2: 'Записати в content2', cond: 'Режим завершення', prov: 'Створити продавця', card: 'Зібрати картку запуску' };
const PROMPT_MARK = 'РЕЖИМИ РОЗМОВИ';
const read = (f) => fs.readFileSync(path.join(ROOT, 'scripts', 'onboard-seller', f), 'utf8');

const PROV_CODE = String.raw`
const out = { provisionText: '', provisionLink: '' };
try {
  if (!context.c2ProjectId) return out;
  const dos = String(keys.SELLER_DOSSIER_URL || '').replace(/\/$/, '');
  const r = await fetch(dos + '/provision?sessionId=' + encodeURIComponent(session.id), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Search-Secret': String(keys.SEARCH_SECRET || '') }, body: '{}',
  });
  const d = await r.json();
  if (d && d.ok && d.link) {
    out.provisionLink = d.link;
    out.provisionText = (d.created ? '🤖 Автоматично створено ШІ-продавця (чернетка, поки нікому не відповідає): ' : '🤖 ШІ-продавець: ') + d.link + (d.status ? ' · статус «' + d.status + '»' : '') + '. Налаштування: https://flows.fineko.space/sellers/' + context.c2ProjectId;
  } else if (d && d.ok === false) {
    out.provisionText = '⚠️ Продавця автоматично не створено: ' + String(d.error || 'невідома помилка') + '. Можна створити кнопкою на https://flows.fineko.space/sellers/' + context.c2ProjectId;
  }
} catch (e) {
  out.provisionText = '⚠️ Автоматичне створення продавця не вдалося: ' + e.message;
}
return out;
`;

const SPECIALIST_TOOL = {
    name: 'request_specialist',
    description: 'Передати питання фахівцям (Тетяні, Надії, Олександру): експерт просить допомоги або двічі не зміг відповісти. Виклич лише з його згоди. Повертає message, яке треба переказати експерту.',
    method: 'POST', headers: { 'X-Search-Secret': '{{env.SEARCH_SECRET}}' },
    url: '{{env.SELLER_DOSSIER_URL}}/request-specialist?sessionId={{session.id}}',
    inputSchema: { type: 'object', required: ['reason'], properties: { topic: { type: 'string', description: 'про що (наприклад, «ціна», «кому підходить»)' }, reason: { type: 'string', description: 'що саме не виходить, коротко' } } },
};

const AF = Object.getPrototypeOf(async function () {}).constructor;

async function main() {
    new AF('context', 'user', 'session', 'keys', 'fetch', PROV_CODE); // синтаксис
    new AF('context', 'user', 'session', 'keys', 'fetch', read('card-node-code.js'));
    const bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) throw new Error('воронка ' + SLUG + ' не знайдена');
    const botId = bot.id;
    let f = await callTool('get_funnel', { botId });
    const byLabel = (l) => f.nodes.find((n) => n.data && n.data.label === l);
    const agent = byLabel(L.agent), c2 = byLabel(L.c2), cond = byLabel(L.cond), card = byLabel(L.card);
    if (!agent || !c2 || !cond || !card) throw new Error('не знайдено базових нод (спершу patch-onboard-seller-edit-2026-10-22)');

    // 1) промпт + інструмент
    const base = String(agent.data.systemPrompt || '');
    const editPrompt = read('edit-mode-prompt.md').trim();
    const systemPrompt = (base.includes(PROMPT_MARK) ? base.slice(0, base.indexOf(PROMPT_MARK)).trimEnd() : base.trimEnd()) + '\n\n' + editPrompt;
    const tools = (agent.data.tools || []).filter((t) => t.name !== SPECIALIST_TOOL.name).concat([SPECIALIST_TOOL]);
    console.log('промпт:', base.length, '→', systemPrompt.length, 'символів; інструментів:', tools.length);
    // 2) код картки
    const cardCode = read('card-node-code.js');
    if (DRY) { console.log('DRY_RUN: далі оновив би агента, картку і вставив ноду «' + L.prov + '»'); return; }
    await callTool('update_node', { botId, nodeId: agent.id, data: { systemPrompt, tools } });
    await callTool('update_node', { botId, nodeId: card.id, data: { code: cardCode } });

    // 3) нода + ребра: c2 → prov → cond
    let prov = byLabel(L.prov);
    if (prov) await callTool('update_node', { botId, nodeId: prov.id, data: { code: PROV_CODE } });
    else {
        const r = await callTool('add_node', { botId, type: 'js', position: { x: 200, y: 310 }, data: { label: L.prov, code: PROV_CODE, qaExpectation: 'Коли досьє готове, створює клон продавця на спільному боті (чернетка) і кладе посилання в provisionText; повторний виклик нічого не дублює; збій не валить сесію.' } });
        prov = r.added;
    }
    f = await callTool('get_funnel', { botId });
    const has = (a, b) => f.edges.some((e) => e.source === a && e.target === b);
    const provId = prov.id;
    for (const e of f.edges.filter((x) => x.source === c2.id && x.target === cond.id)) await callTool('delete_edge', { botId, edgeId: e.id });
    f = await callTool('get_funnel', { botId });
    if (!has(c2.id, provId)) await callTool('create_edge', { botId, source: c2.id, target: provId });
    f = await callTool('get_funnel', { botId });
    if (!has(provId, cond.id)) await callTool('create_edge', { botId, source: provId, target: cond.id });
    // порядок ребер від умови не міняється (ми їх не чіпали)
    try { await callTool('auto_layout', { botId }); } catch (e) { /* косметика */ }

    const fin = await callTool('get_funnel', { botId });
    const lab = (id) => (fin.nodes.find((n) => n.id === id) || { data: {} }).data.label;
    const outs = {}; fin.edges.forEach((e) => { (outs[e.source] = outs[e.source] || []).push(e.target); });
    const bad = Object.entries(outs).filter(([s, t]) => t.length > 1 && s !== cond.id).map(([s]) => lab(s) || s);
    console.log('OK: ' + lab(c2.id) + ' → ' + (outs[c2.id] || []).map(lab).join(', ') + ' → ' + (outs[provId] || []).map(lab).join(', '));
    console.log(bad.length ? 'УВАГА: зайві розгалуження в: ' + bad.join(', ') : 'розгалужень, окрім умови, немає');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
