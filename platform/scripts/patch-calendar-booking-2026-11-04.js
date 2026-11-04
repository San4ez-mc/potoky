'use strict';
// Підключає воронки до календаря calendar.fineko.space: бот показує ВІЛЬНІ віконця й записує людину в календар.
//   • sell-ai-seller (продавець, що продає сам себе): після пропозиції → вільні віконця → вибір цифрою → запис;
//   • bot-karta-sales (Ден + Карта автоматизації): після оплати → вільні віконця → вибір цифрою → запис.
// Запускати ЛИШЕ коли календар уже працює на проді. Ключі воронки: CALENDAR_URL, CALENDAR_API_KEY, CALENDAR_SERVICE_ID, CALENDAR_SOURCE.
//   CAL_URL=https://calendar.fineko.space CAL_KEY=cal_... CAL_SERVICE_ID=... PLATFORM_ROOT=$PWD node scripts/patch-calendar-booking-2026-11-04.js   (DRY_RUN=1 — лише показати)
// Ідемпотентно (за міткою вузла «Календар: вільні віконця»).
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const DRY = !!process.env.DRY_RUN;
const CAL_URL = process.env.CAL_URL || 'https://calendar.fineko.space';
const CAL_KEY = process.env.CAL_KEY || '';
const CAL_SERVICE_ID = process.env.CAL_SERVICE_ID || '';
if (!DRY && (!CAL_KEY || !CAL_SERVICE_ID)) { console.error('Потрібні CAL_KEY (ключ компанії) і CAL_SERVICE_ID (id послуги) з календаря'); process.exit(1); }

const LBL_SLOTS = 'Календар: вільні віконця';

const SLOTS_CODE = `
const out = { slotsList: [], slotsText: '', slotsMsg: '', slotsError: '' };
try {
  const base = String(keys.CALENDAR_URL || '').replace(/\\/$/, '');
  if (!base || !keys.CALENDAR_API_KEY) throw new Error('не задано CALENDAR_URL / CALENDAR_API_KEY');
  const q = new URLSearchParams({ days: '14', limit: '200' });
  if (keys.CALENDAR_SERVICE_ID) q.set('serviceId', String(keys.CALENDAR_SERVICE_ID));
  const res = await fetch(base + '/api/slots?' + q, { headers: { Authorization: 'Bearer ' + keys.CALENDAR_API_KEY }, signal: AbortSignal.timeout(8000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + res.status));
  const perDay = {}; const picked = [];
  for (const s of j.data.slots) {
    perDay[s.date] = perDay[s.date] || 0;
    if (perDay[s.date] >= 2) continue;
    perDay[s.date]++;
    picked.push({ start: s.start, label: s.label });
    if (picked.length >= 6) break;
  }
  out.slotsList = picked;
  out.slotsText = picked.map((s, i) => (i + 1) + ') ' + s.label).join('\\n');
  out.slotsMsg = picked.length
    ? 'Найближчі вільні віконця (час за Києвом):\\n\\n' + out.slotsText + '\\n\\nОбери цифру. Якщо жодне не підходить, напиши, коли зручно, і я передам Олександру.'
    : 'Найближчі віконця зараз зайняті, тому Олександр напише тобі сам і домовиться про час.';
} catch (e) {
  out.slotsError = String(e && e.message || e).slice(0, 200);
  out.slotsMsg = 'Календар зараз недоступний, тому Олександр напише тобі сам і домовиться про час.';
}
return out;
`;

const BOOK_CODE = `
const out = { booking: { ok: false, taken: false, label: '', id: '', error: '' } };
try {
  const choice = Number(context.pick_result && context.pick_result.choice);
  const list = Array.isArray(context.slotsList) ? context.slotsList : [];
  if (!choice || !list[choice - 1]) return out;
  const slot = list[choice - 1];
  const base = String(keys.CALENDAR_URL || '').replace(/\\/$/, '');
  const sp = context.spin_result || {};
  const res = await fetch(base + '/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + keys.CALENDAR_API_KEY },
    body: JSON.stringify({
      start: slot.start,
      serviceId: keys.CALENDAR_SERVICE_ID || undefined,
      clientName: sp.name || user.firstName || '',
      clientTelegram: user.username || '',
      clientTelegramId: String(user.telegramId || ''),
      source: keys.CALENDAR_SOURCE || 'bot',
      note: sp.main_pain || '',
    }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 409) { out.booking.taken = true; return out; }
  if (!res.ok || !j.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + res.status));
  out.booking.ok = true; out.booking.label = slot.label; out.booking.id = j.data.id;
} catch (e) { out.booking.error = String(e && e.message || e).slice(0, 200); }
return out;
`;

const PICK_RULES = (who) => [
    '━━━ ТВОЯ ЗАДАЧА ПІСЛЯ ПРОПОЗИЦІЇ — ЗАПИС НА КОНСУЛЬТАЦІЮ ━━━',
    'Людина щойно побачила список вільних віконець у календарі ' + who + ' (час за Києвом):',
    '{{context.slotsText}}',
    'Показувати список повторно не треба: він уже надісланий. Нічого, крім цих віконець, не пропонуй і не вигадуй інших часів чи днів.',
    '1) Людина обрала цифру або описала час, що точно збігається з одним із віконець → поверни РІВНО {"done":true,"choice":N,"wish":""} (N — номер зі списку) і більше нічого.',
    '2) Просить час, якого немає у списку → коротко скажи, що вільні лише ці віконця (будні 11:00-18:00 за Києвом), і попроси обрати цифру. Якщо наполягає на іншому часі або жодне не підходить → {"done":true,"choice":0,"wish":"<її побажання її ж словами>"}.',
    '3) Передумала або каже «напишу пізніше» → {"done":true,"choice":0,"wish":""}.',
    '4) Список порожній → скажи, що експерт напише сам → {"done":true,"choice":0,"wish":""}.',
    'На питання про послугу відповідай лише фактами з блоків, а потім повертай розмову до вибору часу. 1-2 речення.',
].join('\n');

async function add(botId, type, position, data) {
    if (DRY) return { id: `dry_${type}_${Math.random().toString(36).slice(2, 6)}` };
    const r = await callTool('add_node', { botId, type, position, data });
    return r.added;
}
const edge = async (botId, source, target) => { if (!DRY) await callTool('create_edge', { botId, source, target }); };
const unedge = async (botId, f, source, target) => { for (const e of f.edges.filter((x) => x.source === source && x.target === target)) if (!DRY) await callTool('delete_edge', { botId, edgeId: e.id }); };
const upd = async (botId, nodeId, data) => { if (!DRY) await callTool('update_node', { botId, nodeId, data }); };
const key = async (botId, f, k, value, label, isSecret) => {
    const cur = (f.keys || []).find((x) => x.key === k);
    if (cur && !isSecret && cur.value === value) { console.log('    = ключ', k, 'вже є'); return; }
    console.log('    ✔ ключ', k);
    if (!DRY) await callTool('update_funnel_key', { botId, key: k, value, label, isSecret: !!isSecret });
};

const COND = [
    { id: 'bk_taken', label: 'Час щойно зайняли', expression: 'context.booking.taken === true' },
    { id: 'bk_ok', label: 'Записано', expression: 'context.booking.ok === true' },
    { id: 'bk_none', label: 'Не обрав / помилка календаря', expression: 'true' },
];

async function setKeys(botId, f, source) {
    await key(botId, f, 'CALENDAR_URL', CAL_URL, 'Календар (calendar.fineko.space)', false);
    await key(botId, f, 'CALENDAR_API_KEY', CAL_KEY, 'Календар: ключ API компанії', true);
    await key(botId, f, 'CALENDAR_SERVICE_ID', CAL_SERVICE_ID, 'Календар: id послуги «Консультація»', false);
    await key(botId, f, 'CALENDAR_SOURCE', source, 'Календар: джерело запису', false);
}

// ── sell-ai-seller ─────────────────────────────────────────────────────────────────────────────────
async function patchSeller() {
    const bot = await db.bot.findFirst({ where: { slug: 'sell-ai-seller' } });
    if (!bot) { console.log('— sell-ai-seller не знайдено'); return; }
    const botId = bot.id;
    const f = await callTool('get_funnel', { botId });
    console.log('sell-ai-seller');
    await setKeys(botId, f, 'sell-ai-seller');
    if (f.nodes.some((n) => n.data && n.data.label === LBL_SLOTS)) { console.log('  = календар уже підключено'); return; }
    const by = (id) => f.nodes.find((n) => n.id === id);
    const mode = by('n_mode'); const after = by('n_after'); const afterEnd = by('n_after_end'); const offer = by('n_offer');
    const stage = f.nodes.find((n) => n.type === 'flowStage' && n.data.stageName === 'Обрав час консультації');
    const notifyOk = f.nodes.find((n) => n.type === 'notifyTg' && n.data.label === 'Запис на консультацію: сповіщення');
    if (!mode || !after || !afterEnd || !offer || !stage || !notifyOk) throw new Error('sell-ai-seller: не знайдено потрібні вузли');
    const x = after.position.x; const y = after.position.y;

    // 1) показ віконець перед діалогом вибору
    const nSlots = await add(botId, 'js', { x: x + 420, y: y - 140 }, { label: LBL_SLOTS, code: SLOTS_CODE, qaExpectation: 'Бере вільні віконця з календаря (до 6, не більше 2 на день); збій календаря не валить розмову.' });
    const nSlotsMsg = await add(botId, 'message', { x: x + 420, y: y - 70 }, { label: 'Календар: показати віконця', text: '{{context.slotsMsg}}' });
    await unedge(botId, f, mode.id, after.id);
    await edge(botId, mode.id, nSlots.id); await edge(botId, nSlots.id, nSlotsMsg.id); await edge(botId, nSlotsMsg.id, after.id);

    // 2) діалог вибору: вихід choice
    let p = after.data.systemPrompt;
    const mk = p.indexOf('━━━ ТВОЯ ЗАДАЧА ПІСЛЯ ПРОПОЗИЦІЇ — ЗАПИС');
    if (mk < 0) throw new Error('n_after: нема блоку запису');
    p = p.slice(0, mk) + PICK_RULES('експерта');
    await upd(botId, after.id, { systemPrompt: p, outputVar: 'context.pick_result', qaExpectation: 'Людина обирає віконце цифрою; бот не вигадує інших часів; закінчує JSON {done, choice, wish}.' });

    // 3) пропозиція не питає «цього тижня чи наступного»: віконця показуються одразу під нею
    const op = offer.data.systemPrompt;
    const a6 = op.indexOf('6) Закриття припущенням');
    if (a6 >= 0) {
        const end6 = op.indexOf('\n', a6);
        const six = '6) Закриття: скажи, що одразу під цим повідомленням покажеш найближчі вільні віконця, щоб обрати час зустрічі просто тут. Не питай «цього тижня чи наступного» і не давай інших способів запису.';
        await upd(botId, offer.id, { systemPrompt: op.slice(0, a6) + six + op.slice(end6) });
    }

    // 4) запис у календар
    const nBook = await add(botId, 'js', { x: x - 420, y: y + 70 }, { label: 'Календар: записати', code: BOOK_CODE, qaExpectation: 'Створює запис у календарі за вибраним віконцем; 409 = слот щойно зайняли.' });
    const nCond = await add(botId, 'condition', { x: x - 420, y: y + 140 }, { label: 'Календар: результат запису', conditions: COND });
    const nTaken = await add(botId, 'message', { x: x - 840, y: y + 210 }, { label: 'Календар: час зайняли', text: 'Цей час щойно зайняли, пробач. Ось актуальні віконця, обери інше цифрою.' });
    const nNone = await add(botId, 'notifyTg', { x, y: y + 210 }, { label: 'Календар: не обрав час', message: '⚠️ Запис у календарі не створено\n\nІмʼя: {{context.spin_result.name}}\nСитуація: {{context.spin_result.main_pain}}\nПобажання по часу: {{context.pick_result.wish}}\nПомилка: {{context.booking.error}}{{context.slotsError}}\nTelegram: @{{user.username}} · tg://user?id={{user.telegramId}}\n\nДомовся про час з людиною вручну.', targetKey: 'HANDOFF_TELEGRAM_ID' });
    await unedge(botId, f, after.id, stage.id);
    await edge(botId, after.id, nBook.id); await edge(botId, nBook.id, nCond.id);
    await edge(botId, nCond.id, nTaken.id); await edge(botId, nCond.id, stage.id); await edge(botId, nCond.id, nNone.id);
    await edge(botId, nTaken.id, nSlots.id); await edge(botId, nNone.id, afterEnd.id);

    // 5) сповіщення про запис і завершення з реальним часом
    await upd(botId, notifyOk.id, { message: '📅 Запис на консультацію (уже в календарі)\n\nЧас: {{context.booking.label}}\nІмʼя: {{context.spin_result.name}}\nСитуація: {{context.spin_result.main_pain}}\nTelegram: @{{user.username}} · tg://user?id={{user.telegramId}}\n\nКалендар: ' + CAL_URL });
    const ep = afterEnd.data.systemPrompt; const em = ep.indexOf('ПІДТВЕРДИ ЗАПИС:');
    if (em >= 0) {
        const emEnd = ep.indexOf('\n\n', em);
        await upd(botId, afterEnd.id, {
            systemPrompt: ep.slice(0, em) + 'ПІДТВЕРДИ ЗАПИС: у повідомленні нижче вказано обраний час консультації. Якщо він є, підтверди: «Записано на <час>» і скажи, що перед зустріччю експерт напише в Telegram, а змінити час можна, просто написавши сюди або експерту. Якщо часу немає, скажи, що експерт напише сам і домовиться про час. Без нового продажу.' + ep.slice(emEnd),
            messagesTemplate: '[{"role":"user","content":"Людина завершує розмову, її остання репліка: {{input}}. Обраний час консультації: {{context.booking.label}}."}]',
        });
    }
    console.log('  ✔ календар підключено', DRY ? '(dry-run)' : '');
}

// ── Ден + Карта автоматизації ──────────────────────────────────────────────────────────────────────
async function patchDen() {
    const bot = await db.bot.findFirst({ where: { slug: 'bot-karta-sales' } });
    if (!bot) { console.log('— bot-karta-sales не знайдено'); return; }
    const botId = bot.id;
    const f = await callTool('get_funnel', { botId });
    console.log('bot-karta-sales');
    await setKeys(botId, f, 'bot-karta-sales');
    if (f.nodes.some((n) => n.data && n.data.label === LBL_SLOTS)) { console.log('  = календар уже підключено'); return; }
    const paidMsg = f.nodes.find((n) => n.data && n.data.label === 'Після оплати — студенту');
    const notifyPaid = f.nodes.find((n) => n.data && n.data.label === 'Сповіщення адміну');
    if (!paidMsg || !notifyPaid) throw new Error('bot-karta-sales: нема вузлів оплати');
    const x = 160; const y = 3500;

    await upd(botId, paidMsg.id, { text: '✅ Оплату отримано! 🎉\n\nДякую — гарний крок. 💪\n\nЗалишилось обрати час зустрічі: зараз покажу найближчі вільні віконця Олександра.\n\nЯкщо щось піде не так — напиши йому напряму: t.me/olexandrmatsuk' });
    const nSlots = await add(botId, 'js', { x, y }, { label: LBL_SLOTS, code: SLOTS_CODE });
    const nSlotsMsg = await add(botId, 'message', { x, y: y + 120 }, { label: 'Календар: показати віконця', text: '{{context.slotsMsg}}' });
    const nPick = await add(botId, 'claude', { x, y: y + 240 }, {
        mode: 'dialog', label: 'Календар: вибір часу', model: 'claude-sonnet-4-6', outputVar: 'context.pick_result', connectorId: '{{env.CLAUDE_CONNECTOR_ID}}', exitCondition: 'json_output', messagesTemplate: '{{conversationHistory}}',
        systemPrompt: 'Ти — Ден, помічник Олександра Мацука. Людина оплатила консультацію з автоматизації (60-90 хвилин онлайн) і тепер обирає час зустрічі. Мова: українська, на «ти», коротко, по-людськи.\n\n' + PICK_RULES('Олександра') + '\nНіколи не вигадуй цін, умов і термінів.',
        qaExpectation: 'Людина обирає віконце цифрою; бот не вигадує інших часів; JSON {done, choice, wish}.',
    });
    const nBook = await add(botId, 'js', { x, y: y + 360 }, { label: 'Календар: записати', code: BOOK_CODE });
    const nCond = await add(botId, 'condition', { x, y: y + 480 }, { label: 'Календар: результат запису', conditions: COND });
    const nTaken = await add(botId, 'message', { x: x - 420, y: y + 600 }, { label: 'Календар: час зайняли', text: 'Цей час щойно зайняли, пробач. Ось актуальні віконця, обери інше цифрою.' });
    const nStage = await add(botId, 'flowStage', { x, y: y + 600 }, { label: 'Етап: Обрав час консультації', stageName: 'Обрав час консультації', stageOrder: 6 });
    const nOkMsg = await add(botId, 'message', { x, y: y + 720 }, { label: 'Календар: підтвердження', text: '📅 Записано на {{context.booking.label}} (за Києвом).\n\nПеред зустріччю Олександр напише тобі сюди або в особисті. Якщо треба змінити час — просто напиши йому: t.me/olexandrmatsuk\n\nДо зустрічі! 🙂' });
    const nOkNotify = await add(botId, 'notifyTg', { x, y: y + 840 }, { label: 'Календар: запис — сповіщення', message: '📅 Запис на консультацію (оплачено, уже в календарі)\n\nЧас: {{context.booking.label}}\nІм\'я: {{context.spin_result.name}}\nБіль: {{context.spin_result.main_pain}}\nTelegram: @{{user.username}} ({{user.telegramId}})\n\nКалендар: ' + CAL_URL, targetKey: 'ADMIN_TELEGRAM_ID' });
    const nNoneMsg = await add(botId, 'message', { x: x + 420, y: y + 600 }, { label: 'Календар: без запису', text: 'Добре, тоді Олександр напише тобі сам і домовиться про зручний час. Або напиши йому напряму: t.me/olexandrmatsuk' });
    const nNoneNotify = await add(botId, 'notifyTg', { x: x + 420, y: y + 720 }, { label: 'Календар: не обрав час', message: '⚠️ Оплатив, але запис у календарі не створено\n\nІм\'я: {{context.spin_result.name}}\nПобажання по часу: {{context.pick_result.wish}}\nПомилка: {{context.booking.error}}{{context.slotsError}}\nTelegram: @{{user.username}} ({{user.telegramId}})\n\nДомовся про час з людиною вручну.', targetKey: 'ADMIN_TELEGRAM_ID' });

    await edge(botId, notifyPaid.id, nSlots.id); await edge(botId, nSlots.id, nSlotsMsg.id); await edge(botId, nSlotsMsg.id, nPick.id);
    await edge(botId, nPick.id, nBook.id); await edge(botId, nBook.id, nCond.id);
    await edge(botId, nCond.id, nTaken.id); await edge(botId, nCond.id, nStage.id); await edge(botId, nCond.id, nNoneMsg.id);
    await edge(botId, nTaken.id, nSlots.id);
    await edge(botId, nStage.id, nOkMsg.id); await edge(botId, nOkMsg.id, nOkNotify.id);
    await edge(botId, nNoneMsg.id, nNoneNotify.id);
    console.log('  ✔ календар підключено', DRY ? '(dry-run)' : '');
}

(async () => {
    await patchSeller();
    await patchDen();
    console.log('Готово' + (DRY ? ' (dry-run)' : ''));
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
