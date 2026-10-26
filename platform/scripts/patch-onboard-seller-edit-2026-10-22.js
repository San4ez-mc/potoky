'use strict';
// Онбординг експерта (onboard-seller): режими розмови new | resume | edit + редагування даних після онбордингу.
//  • «Стан досьє» (js, перед агентом): визначає режим і знімок значень на початку розмови.
//  • Агент отримує «Режим розмови: …» (startTrigger) і розділ РЕЖИМИ РОЗМОВИ у промпті (edit-mode-prompt.md).
//  • «Записати в content2» (js, v2): пише в content2 ЛИШЕ змінені поля (порівняння з відбитком останньої синхронізації,
//    збереженим у досьє як матеріал kind=c2sync), тож ручні правки власника в content2 не перезатираються;
//    рахує зміни для експерта й власника.
//  • Умова «Режим завершення»: edit + були зміни/запит → дайджест власнику + підтвердження експерту; edit без змін → коротка відповідь;
//    інакше — звичайна «Картка запуску» (як було).
// Ідемпотентний. Запуск на сервері (з кореня platform/), текст промпту підставляється з локального файлу:
//   (echo "const EDIT_PROMPT = $(node -e "console.log(JSON.stringify(require('fs').readFileSync('scripts/onboard-seller/edit-mode-prompt.md','utf8')))");"; cat scripts/patch-onboard-seller-edit-2026-10-22.js) \
//     | ssh root@… "cd /var/www/flows.fineko.space/platform && PLATFORM_ROOT=\$PWD node -"

const fs = require('fs');
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const SLUG = 'onboard-seller';
const L = {
    state: 'Стан досьє', agent: 'Онбординг-агент експерта', c2: 'Записати в content2', cond: 'Режим завершення',
    digest: 'Дайджест змін власнику', notify: 'Зміни експерта власнику', ack: 'Експерту: зміни збережено', nochange: 'Експерту: без змін',
    card: 'Зібрати картку запуску', done: 'Експерту: що далі',
};
const PROMPT_MARK = 'РЕЖИМИ РОЗМОВИ';
const START_TRIGGER = 'Режим розмови: {{context.dossierMode}}. Виклич get_dossier, привітайся (імʼя в Telegram: {{user.firstName}}) і дій за правилами цього режиму.';
const BTN = [[{ text: '✏️ Змінити або додати', url: 'https://t.me/{{env.TELEGRAM_BOT_USERNAME}}?start=onboard-seller' }]];

// ───────── js: стан досьє ─────────
const STATE_CODE = String.raw`
const out = { dossierMode: 'new', dossierBefore: {} };
try {
  const dos = String(keys.SELLER_DOSSIER_URL || '').replace(/\/$/, '');
  const r = await fetch(dos + '/get?sessionId=' + encodeURIComponent(session.id), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Search-Secret': String(keys.SEARCH_SECRET || '') }, body: '{}',
  });
  const d = await r.json();
  if (d && d.ok) {
    const filled = [].concat(d.critical || [], d.optional || []).filter((f) => f && f.value && f.status !== 'missing');
    for (const f of filled) out.dossierBefore[f.id] = { v: String(f.value).slice(0, 160), s: f.status };
    out.dossierMode = !filled.length ? 'new' : (d.ready ? 'edit' : 'resume');
  }
} catch (e) { /* лишаємо new: агент сам звіриться з get_dossier */ }
return out;
`;

// ───────── js: запис у content2 (v2, лише змінене) ─────────
const C2_CODE = String.raw`
const out = { c2Summary: '', c2ProjectId: '', c2Saved: 0, c2Failed: 0, c2HadSync: false, changedIds: [], changesCount: 0, changeItems: [], expertChangeText: '', hasRequest: false };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const hash = (s) => { s = String(s); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36).slice(-5); };
try {
  const dos = String(keys.SELLER_DOSSIER_URL || '').replace(/\/$/, '');
  const c2 = String(keys.CONTENT2_URL || '').replace(/\/$/, '');
  const sm = (context.sellerResult && context.sellerResult.summary) || '';
  out.hasRequest = /ЗАПИТ\s+ВЛАСНИКУ/i.test(String(sm));
  if (!c2 || !keys.CONTENT2_WEBHOOK_SECRET) throw new Error('немає CONTENT2_URL / CONTENT2_WEBHOOK_SECRET у ключах воронки');
  const hdr = { 'Content-Type': 'application/json', 'X-Search-Secret': String(keys.SEARCH_SECRET || '') };
  const r = await fetch(dos + '/get?sessionId=' + encodeURIComponent(session.id), { method: 'POST', headers: hdr, body: '{}' });
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
  // відбиток останньої синхронізації: які значення вже в content2
  const last = (Array.isArray(d.materials) ? d.materials : []).filter((m) => m && m.kind === 'c2sync').pop();
  const synced = {};
  if (last && last.ref) String(last.ref).split(',').forEach((p) => { const i = p.indexOf(':'); if (i > 0) synced[p.slice(0, i)] = p.slice(i + 1); });
  out.c2HadSync = !!last;
  const cur = {};
  for (const id of Object.keys(F)) cur[id] = hash(F[id].status + '|' + F[id].value);
  const changed = Object.keys(cur).filter((id) => !last || synced[id] !== cur[id]);
  const removed = last ? Object.keys(synced).filter((id) => !cur[id]) : [];
  out.changedIds = changed.concat(removed);
  out.changesCount = out.changedIds.length;
  const before = context.dossierBefore || {};
  out.changeItems = out.changedIds.map((id) => {
    const f = F[id];
    return { id, title: f ? f.title : id, val: f ? clip(f.value, 160) : '', old: before[id] && (!f || String(f.value).slice(0, 160) !== before[id].v) ? clip(before[id].v, 160) : '', mark: f ? mark(id) : '', removed: !f };
  });
  out.expertChangeText = [...new Set(out.changeItems.map((c) => (c.removed ? 'прибрано: ' : '') + c.title))].map((t) => '• ' + t).join('\n');

  // c2ProjectNameOverride: явна назва проєкту (для навмисного прогону, напр. власний продавець власника); інакше «Експерт TG<id>» (у тестах з префіксом QA)
  const projectName = String(context.c2ProjectNameOverride || '').trim() || ((context.testMode ? 'QA ' : '') + 'Експерт TG' + user.telegramId);
  const items = [];
  const add = (label, deps, kind, data) => { if (!last || deps.some((id) => out.changedIds.includes(id))) items.push({ label, kind, data }); };
  const core = [v('K1'), v('O13')].filter(Boolean).join('\n');
  if (core || v('K11')) add('профіль експерта', ['K1', 'O13', 'K11'], 'founder', { core: core || undefined, interactionStyle: v('K11') || undefined });
  // назва послуги — коротка (перше речення/до тире), повний текст K2 іде в опис
  const svcName = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); const cut = t.split(/\s[—–-]\s|[.:;(]/)[0].trim(); return clip(cut || t, 70); };
  const svc = v('K2') ? svcName(v('K2')) : '';
  if (svc) add('послуга', ['K2', 'K3', 'K4', 'K5'], 'product', { name: svc, description: [v('K2').length > svc.length + 3 ? v('K2') : '', v('K3')].filter(Boolean).join('\n') || undefined, price: v('K4') || undefined, audience: v('K5') || undefined });
  if (v('O11') || v('K5')) add('клієнт', ['O11', 'K5', 'O10', 'K11'], 'persona', { name: 'Ідеальний клієнт', pains: v('O11') || ('Кому підходить: ' + v('K5')), objections: v('O10') || undefined, tone: v('K11') || undefined, language: v('K11') || undefined });
  if (v('O12') && !/^(нема|немає|нет|no)(?![\p{L}])/iu.test(v('O12').trim())) add('кейс', ['O12', 'K2'], 'case', { title: 'Кейс експерта', product: svc || undefined, solution: v('O12'), allowedClaims: (() => { const am = v('O12').match(/Дозволено казати:\s*([\s\S]*?)(?:\.?\s*Не казати:|$)/i); const a = am && am[1].trim(); if (!a) return undefined; if (a.length >= 30) return a; /* «обидва ці факти» без самих фактів: дозволений весь опис кейсу до «Не казати» */ return v('O12').split(/Не казати:/i)[0].trim(); })() });
  const DOCS = [
    ['Що з’ясувати про клієнта', ['K6']], ['Цільова дія і запис', ['K7', 'K8']], ['Заборонені обіцянки', ['K9']],
    ['Коли передавати розмову людині', ['K10']], ['Мови і стиль спілкування', ['K11']], ['Шлях заявки і головний біль', ['O3', 'O4']],
    ['Часті запитання і відповіді експерта', ['O10']], ['Кейс і дозволені формулювання', ['O12']], ['Імʼя продавця', ['O15']],
    ['Чутлива тема', ['O16']], ['Сповіщення про ліди', ['O19']],
  ];
  for (const [title, ids] of DOCS) {
    const parts = ids.filter((id) => v(id)).map((id) => F[id].title + ': ' + v(id) + ' [' + mark(id) + ']');
    if (parts.length) add('продавець: ' + title.toLowerCase(), ids, 'doc', { title: 'Продавець — ' + title, text: parts.join('\n') });
    else if (last && ids.some((id) => removed.includes(id))) add('продавець: ' + title.toLowerCase() + ' (прибрано)', ids, 'doc', { title: 'Продавець — ' + title, text: 'Прибрано експертом.' });
  }
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
  // підказки для налаштувань продавця з того, що сказав експерт. content2 заповнює ЛИШЕ порожні поля й не чіпає статус/режим/оплату.
  let prefilled = [];
  if (projectId) {
    try {
      const o15 = v('O15').replace(/[«»"“”]/g, '');
      // формат, який просить промпт: «Імʼя: Ден. Титул: ШІ-продавець Олександра Мацука»; запасні варіанти для вільного тексту
      const nameM = o15.match(/(?:Імʼя|Імя|Звуть|звуть|Звати|звати|Звати|звать)[:\s—-]+([A-Za-zА-Яа-яІіЇїЄєҐґ'’-]{2,30})/);
      const firstSeg = (o15.split(/[,;:—.\n]/)[0] || '').trim();
      const titleM = o15.match(/Титул:\s*([^\n]{3,120})/i) || o15.match(/(ШІ[-\s]продавець[^\n]{0,100})/i);
      const bk = [v('K7'), v('K8')].filter(Boolean).join('\n');
      const handles = [].concat(bk.match(/(?:https?:\/\/)?t\.me\/[A-Za-z0-9_]{4,}/g) || [], bk.match(/(?:^|\s)@[A-Za-z0-9_]{5,}/g) || []).map((s) => s.trim());
      const urlM = (bk.match(/https?:\/\/[^\s)]+/g) || []).find((u) => !/t\.me\//i.test(u));
      const prefill = {
        sellerName: nameM ? nameM[1] : (firstSeg && firstSeg.length <= 30 && !/ШІ/i.test(firstSeg) ? firstSeg : ''),
        sellerTitle: titleM ? titleM[1].replace(/[.\s]+$/, '').trim() : '',
        handoffTelegramId: ((v('O19').match(/\b\d{6,12}\b/) || [])[0]) || '',
        allowedContacts: [...new Set(handles)].join(', ').slice(0, 300),
        bookingUrl: urlM || '',
        bookingNote: v('K8') ? clip(v('K8'), 1000) : '',
      };
      for (const k of Object.keys(prefill)) if (!prefill[k]) delete prefill[k];
      if (Object.keys(prefill).length) {
        const pr = await fetch(c2 + '/api/webhooks/seller-config', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': String(keys.CONTENT2_WEBHOOK_SECRET) },
          body: JSON.stringify({ projectId, prefill }),
        });
        const pj = await pr.json().catch(() => ({}));
        if (pr.ok && pj.ok) prefilled = pj.prefilled || [];
      }
    } catch (e) { /* підказки не критичні: власник заповнить налаштування в адмінці */ }
  }
  out.c2Prefilled = prefilled;
  // нове відбиток записуємо лише коли все дійшло; інакше наступного разу повторимо
  if (!out.c2Failed && (items.length || !last)) {
    try {
      await fetch(dos + '/set-many?sessionId=' + encodeURIComponent(session.id), {
        method: 'POST', headers: hdr,
        body: JSON.stringify({ fields: [], materials: [{ kind: 'c2sync', ref: Object.keys(cur).map((id) => id + ':' + cur[id]).join(',') }] }),
      });
    } catch (e) { /* відбиток не записався — наступна синхронізація повторить */ }
  }
  const manual = out.changeItems.filter((c) => c.removed && /^(K1|K2|K3|K4|K5|O11|O12|O13)$/.test(c.id)).map((c) => c.title);
  out.c2Summary = items.length
    ? '🗂 content2: проєкт «' + esc(projectName) + '» — записано ' + out.c2Saved + ' з ' + items.length +
      (fails.length ? '. Не записалось: ' + esc(fails.slice(0, 3).join('; ')) : '') +
      (manual.length ? '. Прибрати вручну в content2: ' + esc(manual.join(', ')) : '') +
      (prefilled.length ? '. Налаштування продавця підставлено: ' + esc(prefilled.join(', ')) : '') +
      '\nhttps://content2.fineko.space/user-data (оберіть компанію «' + esc(projectName) + '» у перемикачі зверху)'
    : '🗂 content2: змін для запису немає.';
} catch (e) {
  out.c2Summary = '⚠️ content2: не вдалося записати (' + esc(e.message) + '). Досьє збережено у Flows, сесія ' + session.id + '.';
}
return out;
`;

// ───────── js: дайджест змін для власника + підтвердження експерту ─────────
const DIGEST_CODE = String.raw`
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const who = [user.firstName, user.lastName].filter(Boolean).join(' ') || ('Telegram ' + user.telegramId);
const un = user.username ? ' (@' + user.username + ')' : '';
const items = Array.isArray(context.changeItems) ? context.changeItems : [];
const sm = String((context.sellerResult && context.sellerResult.summary) || '').trim();
const out = { ownerChangeText: '', expertAckText: '' };
const L = ['<b>' + (items.length ? 'Експерт оновив дані: ' : 'Прохання від експерта: ') + esc(who) + un + '</b>'];
if (items.length) {
  L.push('Змінено ' + items.length + ':');
  for (const c of items.slice(0, 12)) {
    if (c.removed) { L.push('• <b>' + esc(c.title) + '</b>: прибрано експертом'); continue; }
    L.push('• <b>' + esc(c.title) + '</b>: ' + (c.old ? 'було «' + esc(c.old) + '» → ' : '') + 'стало «' + esc(c.val) + '» (' + esc(c.mark) + ')');
  }
  if (items.length > 12) L.push('… ще ' + (items.length - 12));
}
if (sm) L.push('\n' + (context.hasRequest ? '❗ ' : '💬 ') + esc(clip(sm, 500)));
if (context.c2Summary) L.push('\n' + context.c2Summary);
out.ownerChangeText = L.join('\n').slice(0, 3900);
const ack = [items.length ? 'Готово, зміни збережено ✅' : 'Прохання прийнято ✅'];
if (context.expertChangeText) ack.push('\nЩо змінилось:\n' + context.expertChangeText);
ack.push(context.hasRequest ? '\nПрохання передано Олександру, він відповість сам.' : '\nОлександр побачить оновлення.');
ack.push('Захочеш ще щось виправити чи додати, натисни кнопку нижче.');
out.expertAckText = ack.join('\n');
return out;
`;

const AF = Object.getPrototypeOf(async function () {}).constructor;
const syntax = (code) => new AF('context', 'user', 'session', 'keys', 'fetch', code);

async function ensureNode(botId, f, label, type, position, data) {
    const found = f.nodes.find((n) => n.data && n.data.label === label);
    if (found) { await callTool('update_node', { botId, nodeId: found.id, data }); return found.id; }
    const r = await callTool('add_node', { botId, type, position, data: { label, ...data } });
    return r.added.id;
}

async function main() {
    const bot = await db.bot.findFirst({ where: { slug: SLUG } });
    if (!bot) throw new Error('воронка ' + SLUG + ' не знайдена');
    const botId = bot.id;
    [STATE_CODE, C2_CODE, DIGEST_CODE].forEach(syntax);

    let f = await callTool('get_funnel', { botId });
    const byLabel = (l) => f.nodes.find((n) => n.data && n.data.label === l);
    const agent = byLabel(L.agent), card = byLabel(L.card), done = byLabel(L.done);
    const start = f.nodes.find((n) => n.type === 'start');
    if (!agent || !card || !done || !byLabel(L.c2)) throw new Error('не знайдено базових нод (спершу застосуй patch-onboard-seller-content2-2026-10-19)');

    // 1) промпт агента + startTrigger
    const editPrompt = (typeof EDIT_PROMPT !== 'undefined' ? EDIT_PROMPT : fs.readFileSync(path.join(__dirname, 'onboard-seller', 'edit-mode-prompt.md'), 'utf8')).trim();
    // Питання, без яких продавця не запустити, не можуть бути «необовʼязковими» (22.10, тест: агент пропускав кейс, FAQ, імʼя продавця й Telegram для лідів)
    const FORCE = [
        [/(\n)10\. \(необовʼязково\) /, (m, nl) => nl + '10. ОБОВʼЯЗКОВО: '],
        [/3 найчастіші запитання чи сумніви клієнтів і як ти відповідаєш\./, () => '3 найчастіші запитання чи сумніви клієнтів і яка СУТЬ твоєї відповіді (напрям, а не дослівний текст: бот формулюватиме сам за ситуацією). Значення запиши як «Питання → суть відповіді».'],
        [/(\n)12\. \(необовʼязково\) /, (m, nl) => nl + '12. ОБОВʼЯЗКОВО (нема кейсу: запиши «нема»): '],
        [/(\n)15\. \(необовʼязково\) /, (m, nl) => nl + '15. ОБОВʼЯЗКОВО: '],
        [/(\n)19\. \(необовʼязково\) Куди надсилати сповіщення про гарячих лідів і коли не писати\?/, (m, nl) => nl + '19. ОБОВʼЯЗКОВО (без цього продавця не запустити): Куди надсилати сповіщення про гарячих лідів? Потрібен числовий Telegram ID (цифри; не знаєш, підкажи написати боту @userinfobot). І коли не писати?'],
        [/Питання 3, 4, 10-13, 15, 16, 19 став лише якщо відповіді ще нема в матеріалах і вона реально допоможе продавцю; у рідкісних випадках пропусти\./, () => 'Питання 10, 12, 15 і 19 став ЗАВЖДИ, ПЕРЕД викликом expert_card, якщо відповіді ще нема в матеріалах чи розмові; питання 3, 4, 11, 13, 16 став лише якщо відповіді ще нема і вона реально допоможе продавцю.'],
    ];
    let basePrompt = String(agent.data.systemPrompt || '');
    for (const [re, rep] of FORCE) basePrompt = basePrompt.replace(re, rep);
    const systemPrompt = basePrompt.includes(PROMPT_MARK) ? basePrompt.slice(0, basePrompt.indexOf(PROMPT_MARK)).trimEnd() + '\n\n' + editPrompt : basePrompt.trimEnd() + '\n\n' + editPrompt;
    await callTool('update_node', { botId, nodeId: agent.id, data: { systemPrompt, startTrigger: START_TRIGGER } });

    // 2) ноди
    const stateId = await ensureNode(botId, f, L.state, 'js', { x: 200, y: 100 }, {
        code: STATE_CODE, qaExpectation: 'Визначає режим розмови new/resume/edit і знімок значень на початку; збій читання досьє не валить сесію (режим new).',
    });
    const c2Id = await ensureNode(botId, f, L.c2, 'js', { x: 200, y: 240 }, {
        code: C2_CODE, qaExpectation: 'Пише в content2 лише змінені поля (відбиток c2sync у досьє), рахує changedIds/changeItems; помилка запису не валить сесію.',
    });
    const condId = await ensureNode(botId, f, L.cond, 'condition', { x: 200, y: 380 }, {
        conditions: [
            { id: 'c_edit_changes', label: 'Редагування: є зміни або прохання', expression: "context.dossierMode === 'edit' && context.c2HadSync === true && ((context.changesCount || 0) > 0 || context.hasRequest === true)" },
            { id: 'c_edit_none', label: 'Редагування: без змін', expression: "context.dossierMode === 'edit' && context.c2HadSync === true" },
            { id: 'c_default', label: 'Онбординг (звичайна картка)', expression: 'true' },
        ],
    });
    const digestId = await ensureNode(botId, f, L.digest, 'js', { x: 0, y: 520 }, {
        code: DIGEST_CODE, qaExpectation: 'Формує ownerChangeText (що змінилось, було → стало, запит власнику) і expertAckText; без падінь.',
    });
    const notifyId = await ensureNode(botId, f, L.notify, 'notifyTg', { x: 0, y: 660 }, { targetKey: 'ADMIN_TELEGRAM_ID', message: '{{context.ownerChangeText}}' });
    const ackId = await ensureNode(botId, f, L.ack, 'message', { x: 0, y: 800 }, {
        text: '{{context.expertAckText}}', buttons: BTN,
        qaExpectation: 'Експерт бачить, що саме змінилось, і кнопку для повторного редагування; без службових кодів.',
    });
    const noChId = await ensureNode(botId, f, L.nochange, 'message', { x: 400, y: 520 }, {
        text: 'Добре, нічого не змінилось. Якщо знадобиться щось виправити чи додати, натисни кнопку нижче.', buttons: BTN,
        qaExpectation: 'Коротка відповідь без змін і кнопка редагування.',
    });
    // кнопка «Змінити або додати» і під звичайним фінальним повідомленням
    await callTool('update_node', { botId, nodeId: done.id, data: { buttons: BTN } });

    // 3) ребра. Було: start→agent, c2→card. Стає: start→state→agent→c2→cond→(digest→notify→ack | nochange | card)
    f = await callTool('get_funnel', { botId });
    const drop = (a, b) => f.edges.filter((e) => e.source === a && e.target === b);
    for (const e of [...drop(start.id, agent.id), ...drop(c2Id, card.id)]) await callTool('delete_edge', { botId, edgeId: e.id });
    f = await callTool('get_funnel', { botId });
    const has = (a, b) => f.edges.some((e) => e.source === a && e.target === b);
    const mk = async (a, b) => { if (!has(a, b)) { await callTool('create_edge', { botId, source: a, target: b }); f = await callTool('get_funnel', { botId }); } };
    await mk(start.id, stateId); await mk(stateId, agent.id); await mk(agent.id, c2Id); await mk(c2Id, condId);
    // порядок ребер від умови = порядок умов
    for (const e of f.edges.filter((x) => x.source === condId)) await callTool('delete_edge', { botId, edgeId: e.id });
    f = await callTool('get_funnel', { botId });
    await mk(condId, digestId); await mk(condId, noChId); await mk(condId, card.id);
    await mk(digestId, notifyId); await mk(notifyId, ackId);
    try { await callTool('auto_layout', { botId }); } catch (e) { /* косметика */ }

    // 4) перевірка графа: немає зайвих розгалужень, умова має 3 виходи в правильному порядку
    const fin = await callTool('get_funnel', { botId });
    const lab = (id) => (fin.nodes.find((n) => n.id === id) || { data: {} }).data.label;
    const outs = {}; fin.edges.forEach((e) => { (outs[e.source] = outs[e.source] || []).push(e.target); });
    const bad = Object.entries(outs).filter(([s, t]) => t.length > 1 && s !== condId).map(([s]) => lab(s) || s);
    const condOut = (outs[condId] || []).map(lab);
    console.log('OK умова →', condOut.join(' | '));
    console.log(bad.length ? 'УВАГА: зайві розгалуження в: ' + bad.join(', ') : 'розгалужень, окрім умови, немає');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e && e.message, e && e.stack); process.exit(1); });
