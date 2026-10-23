'use strict';
// Онбординг експерта (onboard-seller): після діалогу відповіді ОДРАЗУ пишуться в content2 (рішення власника 19.10:
// «нехай зразу йде в контент», без ручного «ок»). Додає js-ноду «Записати в content2» між агентом і карткою запуску
// та дописує підсумок запису в картку власнику. Ідемпотентний (онбординг-save у content2 дедуплікує за назвою).
//
// Запуск на сервері (з кореня platform/):
//   PLATFORM_ROOT=/var/www/flows.fineko.space/platform node scripts/patch-onboard-seller-content2-2026-10-19.js
//   або без файлу на сервері:  ssh … "cd /var/www/flows.fineko.space/platform && PLATFORM_ROOT=$PWD node -" < scripts/patch-…js
// Ключі CONTENT2_URL і CONTENT2_WEBHOOK_SECRET копіюються з воронки onboard (значення не друкуються).

const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const SLUG = 'onboard-seller';
const SRC_SLUG = 'onboard';
const NODE_LABEL = 'Записати в content2';
const CARD_LABEL = 'Зібрати картку запуску';
const AGENT_LABEL = 'Онбординг-агент експерта';

// Код js-ноди (тіло async-функції; змінні: context, user, session, keys, fetch). Не кидає винятків.
const C2_CODE = String.raw`
const out = { c2Summary: '', c2ProjectId: '', c2Saved: 0, c2Failed: 0 };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n) => { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
try {
  const dos = String(keys.SELLER_DOSSIER_URL || '').replace(/\/$/, '');
  const c2 = String(keys.CONTENT2_URL || '').replace(/\/$/, '');
  if (!c2 || !keys.CONTENT2_WEBHOOK_SECRET) throw new Error('немає CONTENT2_URL / CONTENT2_WEBHOOK_SECRET у ключах воронки');
  const r = await fetch(dos + '/get?sessionId=' + encodeURIComponent(session.id), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Search-Secret': String(keys.SEARCH_SECRET || '') }, body: '{}',
  });
  const d = await r.json();
  if (!d || !d.ok) throw new Error('досьє: ' + ((d && d.error) || ('HTTP ' + r.status)));
  const F = {};
  for (const f of [].concat(d.critical || [], d.optional || [])) if (f && f.value && f.status !== 'missing') F[f.id] = f;
  const v = (id) => (F[id] ? F[id].value : '');
  const mark = (id) => {
    const f = F[id]; if (!f) return '';
    if (f.status === 'confirmed' || f.status === 'not_applicable') return 'підтверджено експертом';
    if (f.status === 'conflict') return 'є суперечність, потрібне рішення';
    return 'з матеріалів, потребує перевірки';
  };
  const projectName = (context.testMode ? 'QA ' : '') + 'Експерт TG' + user.telegramId;
  const items = [];
  const core = [v('K1'), v('O13')].filter(Boolean).join('\n');
  if (core || v('K11')) items.push({ label: 'профіль експерта', kind: 'founder', data: { core: core || undefined, interactionStyle: v('K11') || undefined } });
  if (v('K2')) items.push({ label: 'послуга', kind: 'product', data: { name: clip(v('K2'), 120), description: v('K3') || undefined, price: v('K4') || undefined, audience: v('K5') || undefined } });
  if (v('O11') || v('K5')) items.push({ label: 'клієнт', kind: 'persona', data: { name: 'Ідеальний клієнт', pains: v('O11') || ('Кому підходить: ' + v('K5')), objections: v('O10') || undefined, tone: v('K11') || undefined, language: v('K11') || undefined } });
  if (v('O12')) items.push({ label: 'кейс', kind: 'case', data: { title: 'Кейс експерта', product: v('K2') ? clip(v('K2'), 120) : undefined, solution: v('O12') } });
  const DOCS = [
    ['Що з’ясувати про клієнта', ['K6']], ['Цільова дія і запис', ['K7', 'K8']], ['Заборонені обіцянки', ['K9']],
    ['Коли передавати розмову людині', ['K10']], ['Мови і стиль спілкування', ['K11']], ['Шлях заявки і головний біль', ['O3', 'O4']],
    ['Часті запитання і відповіді експерта', ['O10']], ['Кейс і дозволені формулювання', ['O12']], ['Імʼя продавця', ['O15']],
    ['Чутлива тема', ['O16']], ['Сповіщення про ліди', ['O19']],
  ];
  for (const [title, ids] of DOCS) {
    const parts = ids.filter((id) => v(id)).map((id) => F[id].title + ': ' + v(id) + ' [' + mark(id) + ']');
    if (parts.length) items.push({ label: 'продавець: ' + title.toLowerCase(), kind: 'doc', data: { title: 'Продавець — ' + title, text: parts.join('\n') } });
  }
  if (!items.length) throw new Error('у досьє ще нічого не записано');
  let projectId = '';
  const fails = [];
  for (const it of items) {
    try {
      const res = await fetch(c2 + '/api/webhooks/onboarding-save', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': String(keys.CONTENT2_WEBHOOK_SECRET) },
        body: JSON.stringify({ projectName, projectId: projectId || undefined, kind: it.kind, data: it.data }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error((j && j.error) || ('HTTP ' + res.status));
      if (!projectId && j.projectId) projectId = j.projectId;
      out.c2Saved++;
    } catch (e) { out.c2Failed++; fails.push(it.label + ': ' + e.message); }
  }
  out.c2ProjectId = projectId;
  out.c2Summary = '🗂 content2: проєкт «' + esc(projectName) + '» — записано ' + out.c2Saved + ' з ' + items.length +
    (fails.length ? '. Не записалось: ' + esc(fails.slice(0, 3).join('; ')) : '') +
    '\nhttps://content2.fineko.space/user-data (оберіть компанію «' + esc(projectName) + '» у перемикачі зверху)';
} catch (e) {
  out.c2Summary = '⚠️ content2: не вдалося записати (' + esc(e.message) + '). Досьє збережено у Flows, сесія ' + session.id + '.';
}
return out;
`;

const CARD_MARK = '// C2_SUMMARY';
const CARD_TAIL = "if (context.c2Summary) out.ownerCardText = String(out.ownerCardText || '') + '\\n\\n' + context.c2Summary; " + CARD_MARK + '\nreturn out;';

async function main() {
    const bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) throw new Error('воронка ' + SLUG + ' не знайдена');
    const botId = bot.id;

    // ключі content2 з воронки onboard (значення не друкуємо)
    const src = await db.bot.findFirst({ where: { slug: SRC_SLUG } });
    if (!src) throw new Error('воронка-джерело ключів ' + SRC_SLUG + ' не знайдена');
    for (const key of ['CONTENT2_URL', 'CONTENT2_WEBHOOK_SECRET']) {
        const k = await db.funnelKey.findUnique({ where: { botId_key: { botId: src.id, key } } });
        if (!k || !k.value) throw new Error('у воронці ' + SRC_SLUG + ' немає ключа ' + key);
        await callTool('update_funnel_key', { botId, key, value: k.value, label: key === 'CONTENT2_URL' ? 'Content2 (куди пишемо профіль)' : 'Content2 webhook-секрет', isSecret: key === 'CONTENT2_WEBHOOK_SECRET' });
    }

    let f = await callTool('get_funnel', { botId });
    const byLabel = (l) => f.nodes.find((n) => n.data && n.data.label === l);
    const agent = byLabel(AGENT_LABEL), card = byLabel(CARD_LABEL);
    if (!agent || !card) throw new Error('не знайдено ноди агента/картки');

    // 1) нода запису в content2
    new (Object.getPrototypeOf(async function () {}).constructor)('context', 'user', 'session', 'keys', 'fetch', C2_CODE); // перевірка синтаксису
    let c2 = byLabel(NODE_LABEL);
    const c2Data = {
        code: C2_CODE,
        qaExpectation: 'Після діалогу досьє експерта записується у content2 (founder/product/persona/case + документи «Продавець — …»); c2Summary містить «записано N з M»; помилка запису не валить сесію.',
    };
    if (c2) await callTool('update_node', { botId, nodeId: c2.id, data: c2Data });
    else {
        const r = await callTool('add_node', { botId, type: 'js', position: { x: 200, y: 240 }, data: { label: NODE_LABEL, ...c2Data } });
        c2 = { id: r.added.id };
    }

    // 2) картка власнику: допис підсумку запису (один раз, за маркером)
    const cardCode = String(card.data.code || '');
    if (!cardCode.includes(CARD_MARK)) {
        const idx = cardCode.lastIndexOf('return out;');
        if (idx < 0) throw new Error('у коді картки немає "return out;"');
        const patched = cardCode.slice(0, idx) + CARD_TAIL + cardCode.slice(idx + 'return out;'.length);
        new (Object.getPrototypeOf(async function () {}).constructor)('context', 'user', 'session', 'keys', 'fetch', patched);
        await callTool('update_node', { botId, nodeId: card.id, data: { code: patched } });
    }

    // 3) ребра: агент → c2 → картка (прямого агент → картка бути не повинно)
    f = await callTool('get_funnel', { botId });
    const direct = f.edges.filter((e) => e.source === agent.id && e.target === card.id);
    for (const e of direct) await callTool('delete_edge', { botId, edgeId: e.id });
    const has = (a, b) => f.edges.some((e) => e.source === a && e.target === b);
    if (!has(agent.id, c2.id)) await callTool('create_edge', { botId, source: agent.id, target: c2.id });
    if (!has(c2.id, card.id)) await callTool('create_edge', { botId, source: c2.id, target: card.id });
    try { await callTool('auto_layout', { botId }); } catch (e) { /* косметика */ }

    const fin = await callTool('get_funnel', { botId });
    const order = ['start'];
    let cur = fin.nodes.find((n) => n.type === 'start');
    const seen = new Set();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); order.push(cur.data && cur.data.label); const e = fin.edges.find((x) => x.source === cur.id); cur = e && fin.nodes.find((n) => n.id === e.target); }
    console.log('OK ланцюжок:', order.join(' → '));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
