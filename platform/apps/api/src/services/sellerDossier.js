'use strict';
// «Досьє експерта» для онбордингу ШІ-продавця (spec: Контент платформа/документація/ОНБОРДИНГ_експерта_питання_v2.md).
// Чиста логіка без БД: поля, статуси, правило запуску, «Картка запуску». Те, що зберігається й порахується тут кодом,
// не залежить від того, чи «вважає» модель поле закритим: ✅ без цитати експерта не існує, а запуск вирішує функція computeCard.

const STATUS = {
    confirmed: '✅',
    from_materials: '🟡',
    missing: '🔴',
    conflict: '🔴',
    not_applicable: '➖',
};
const STATUS_IDS = Object.keys(STATUS);

// 11 критичних полів. explicit = ніколи не підтверджується «одним махом» (потрібні слова експерта саме про це поле).
const CRITICAL = [
    { id: 'K1', title: 'Хто експерт, чим займається, кому допомагає' },
    { id: 'K2', title: 'Яку послугу продає бот' },
    { id: 'K3', title: 'Зміст, формат і результат консультації' },
    { id: 'K4', title: 'Вартість, оплата, повернення', explicit: true },
    { id: 'K5', title: 'Кому підходить і кому ні' },
    { id: 'K6', title: 'Що з’ясувати про клієнта (критерії)' },
    { id: 'K7', title: 'Цільова дія (запис / оплата / заявка)' },
    { id: 'K8', title: 'Як організовано запис або передачу заявки' },
    { id: 'K9', title: 'Заборонені обіцянки й твердження', explicit: true,
        defaultText: 'Не вигадувати факти, ціни, гарантії, кейси, результати й спеціальні умови; не обіцяти результат, терміни, знижки, розстрочку; не виходити за межі повноважень; кейси й цифри лише у формулюваннях, дозволених експертом.' },
    { id: 'K10', title: 'Коли передавати розмову людині',
        defaultText: 'Скарга, конфлікт, кризовий стан, нестандартний запит, потрібне індивідуальне рішення, питання поза компетенцією бота, роздратований клієнт.' },
    { id: 'K11', title: 'Мови та стиль спілкування' },
];

// Некритичні: відсутність запуск не блокує.
const OPTIONAL = [
    { id: 'O3', title: 'Звідки приходять люди, шлях до оплати, де «зникають»' },
    { id: 'O4', title: 'Обсяг заявок і головний біль' },
    { id: 'O10', title: 'Найчастіші запитання й сумніви, як експерт відповідає' },
    { id: 'O11', title: 'Типові клієнти (профіль)' },
    { id: 'O12', title: 'Кейс і дозволені формулювання' },
    { id: 'O13', title: 'Шлях експерта, відмінності, що можна називати' },
    { id: 'O15', title: 'Імʼя ШІ-продавця й як він представляє експерта' },
    { id: 'O16', title: 'Чутлива тема й додаткові заборони' },
    { id: 'O19', title: 'Куди слати сповіщення про гарячих лідів, коли не писати' },
    { id: 'T1', title: 'Технічно: бот у BotFather (токен не в чат)' },
    { id: 'T2', title: 'Технічно: платіжний сервіс, нагадування' },
];

const DEFS = new Map([...CRITICAL, ...OPTIONAL].map((d) => [d.id, d]));
const isCritical = (id) => CRITICAL.some((d) => d.id === id);

const SOURCES = ['expert', 'site', 'file', 'chat_logs', 'default', 'agent_draft'];

function emptyState() {
    return { version: 1, fields: {}, materials: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

const clip = (s, n) => { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/**
 * Записати поле. Жорсткі правила (не залежать від моделі):
 *  - confirmed тільки з цитатою слів експерта (quote) і значенням;
 *  - not_applicable потребує note (чому) і слів експерта;
 *  - з полем із конфліктом (conflict) статус завжди conflict, поки конфлікт не знято;
 *  - значення з сайту/файлу/переписки (from_materials) не може бути confirmed без цитати експерта.
 */
function setField(state, input) {
    const id = String(input && input.id || '').trim().toUpperCase();
    if (!DEFS.has(id)) return { ok: false, error: `Невідоме поле «${id}». Дозволені: ${[...DEFS.keys()].join(', ')}` };
    let status = String(input.status || '').trim();
    if (!STATUS_IDS.includes(status)) return { ok: false, error: `status має бути одним із: ${STATUS_IDS.join(', ')}` };
    const value = clip(input.value, 1500);
    const quote = clip(input.quote, 600);
    const source = SOURCES.includes(input.source) ? input.source : (status === 'confirmed' ? 'expert' : 'agent_draft');
    const conflict = clip(input.conflict, 400);
    const note = clip(input.note, 300);

    if (conflict) status = 'conflict';
    if (status === 'confirmed') {
        if (!value) return { ok: false, error: 'confirmed потребує value (що саме підтверджено)' };
        if (!quote) return { ok: false, error: 'confirmed потребує quote: дослівні слова експерта, якими він це підтвердив. Без них став from_materials' };
    }
    if (status === 'not_applicable' && (!note || !quote)) return { ok: false, error: 'not_applicable потребує note (чому не застосовується) і quote (слова експерта)' };
    if ((status === 'from_materials' || status === 'conflict') && !value && !conflict) return { ok: false, error: 'потрібне value або conflict' };

    // Поля з типовим текстом (K9, K10): ✅ лише після того, як експерт цей текст побачив. Доказ: спершу була записана чернетка
    // (from_materials/conflict) у попередньому виклику, тобто бот показав список і чекав на відповідь.
    if (status === 'confirmed' && DEFS.get(id).defaultText) {
        const before = state.fields[id];
        if (!before || (before.status !== 'from_materials' && before.status !== 'conflict' && before.status !== 'confirmed')) {
            return { ok: false, error: `${id}: спершу запиши чернетку (status from_materials, source default) і покажи експерту список у повідомленні. confirmed — лише коли він відповів на цей список. Не підтверджуй те, чого експерт не бачив` };
        }
    }

    const prev = state.fields[id] || {};
    const now = new Date().toISOString();
    state.fields[id] = {
        id, title: DEFS.get(id).title,
        value, status, source, quote, note, conflict,
        confirmedBy: status === 'confirmed' || status === 'not_applicable' ? 'expert' : null,
        confirmedAt: status === 'confirmed' || status === 'not_applicable' ? now : null,
        updatedAt: now,
        prevValue: prev.value && prev.value !== value ? clip(prev.value, 300) : (prev.prevValue || ''),
    };
    state.updatedAt = now;
    return { ok: true, field: state.fields[id] };
}

/** Експерт підтвердив усю картку («все вірно»): 🟡 → ✅, окрім explicit-полів (K4, K9) і конфліктних. */
function confirmAll(state, quote) {
    const q = clip(quote, 600);
    if (!q) return { ok: false, error: 'потрібен quote: слова експерта, якими він підтвердив картку' };
    const now = new Date().toISOString();
    const confirmed = [], skipped = [];
    for (const f of Object.values(state.fields)) {
        if (f.status !== 'from_materials' || !f.value) continue;
        if (DEFS.get(f.id) && DEFS.get(f.id).explicit) { skipped.push(f.id); continue; }
        Object.assign(f, { status: 'confirmed', source: f.source === 'default' ? 'default' : f.source, quote: q, confirmedBy: 'expert', confirmedAt: now, updatedAt: now });
        confirmed.push(f.id);
    }
    state.updatedAt = now;
    return { ok: true, confirmed, skippedNeedExplicit: skipped };
}

function addMaterial(state, m) {
    state.materials.push({ kind: clip(m.kind, 20), ref: clip(m.ref, 300), at: new Date().toISOString() });
}

/** Картка запуску: вердикт обчислює КОД. Запуск дозволено, коли всі K1–K11 ✅ або «не застосовується». */
function computeCard(state) {
    const rows = CRITICAL.map((d) => {
        const f = state.fields[d.id];
        const status = f ? f.status : 'missing';
        return {
            id: d.id, title: d.title, explicit: !!d.explicit, defaultText: d.defaultText || '',
            status, mark: STATUS[status],
            value: f ? f.value : '', source: f ? f.source : '', quote: f ? f.quote : '',
            confirmedBy: f ? f.confirmedBy : null, confirmedAt: f ? f.confirmedAt : null,
            note: f ? f.note : '', conflict: f ? f.conflict : '',
        };
    });
    const ok = (r) => r.status === 'confirmed' || r.status === 'not_applicable';
    const done = rows.filter(ok).length;
    const blockers = rows.filter((r) => !ok(r));
    const optional = OPTIONAL.map((d) => {
        const f = state.fields[d.id];
        return { id: d.id, title: d.title, status: f ? f.status : 'missing', mark: STATUS[f ? f.status : 'missing'], value: f ? f.value : '', quote: f ? f.quote : '' };
    });
    const conflicts = Object.values(state.fields).filter((f) => f.status === 'conflict' || f.conflict).map((f) => ({ id: f.id, title: f.title, conflict: f.conflict || f.value }));
    return {
        ready: blockers.length === 0,
        done, total: CRITICAL.length,
        verdict: blockers.length === 0
            ? `Готово до запуску: ${CRITICAL.length}/${CRITICAL.length} ✅`
            : `Не готово: ${done}/${CRITICAL.length} ✅. Не вистачає: ${blockers.map((b) => `${b.id} ${b.mark}`).join(', ')}`,
        rows, blockers, optional, conflicts,
    };
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const srcLabel = (s) => ({ expert: 'слова експерта', site: 'сайт', file: 'файл', chat_logs: 'переписка', default: 'типове значення', agent_draft: 'чернетка бота' }[s] || s || '');

/** Повідомлення власнику (Telegram HTML): вердикт + таблиця K1–K11 + суперечності. До ~3500 символів. */
function renderOwnerCard(card, state) {
    const L = [];
    L.push(`<b>Картка запуску — досьє експерта</b>`);
    L.push(esc(card.verdict));
    L.push('');
    for (const r of card.rows) {
        const val = r.value ? esc(clip(String(r.value).replace(/\s+/g, ' '), 160)) : (r.defaultText && r.status !== 'confirmed' ? '<i>типове значення не підтверджено</i>' : '<i>немає</i>');
        const who = r.status === 'confirmed' || r.status === 'not_applicable'
            ? ` — ${esc(srcLabel(r.source))}, підтвердив експерт ${r.confirmedAt ? r.confirmedAt.slice(0, 16).replace('T', ' ') : ''}`
            : (r.source ? ` — ${esc(srcLabel(r.source))}, не підтверджено` : '');
        L.push(`${r.mark} <b>${r.id} ${esc(r.title)}</b>: ${val}${who}`);
        if (r.conflict) L.push(`   ⚠️ суперечність: ${esc(clip(r.conflict, 200))}`);
        if (r.note) L.push(`   ℹ️ ${esc(clip(r.note, 160))}`);
    }
    if (card.conflicts.length) {
        L.push(''); L.push('<b>Суперечності між джерелами</b>');
        for (const c of card.conflicts) L.push(`• ${c.id}: ${esc(clip(c.conflict, 220))}`);
    }
    const optFilled = card.optional.filter((o) => o.status !== 'missing');
    const optEmpty = card.optional.filter((o) => o.status === 'missing' && !o.id.startsWith('T'));
    L.push(''); L.push(`<b>Бажано доповнити (не блокує):</b> ${optEmpty.length ? optEmpty.map((o) => o.id).join(', ') : 'усе заповнено'}`);
    L.push(`Заповнено додатково: ${optFilled.length}`);
    let text = L.join('\n');
    if (text.length > 3900) text = text.slice(0, 3890) + '…';
    return text;
}

/** Повні відповіді (для власника), порізані на повідомлення ≤3900 символів. */
function renderFull(card, state) {
    const blocks = [];
    for (const r of card.rows) blocks.push(`${r.mark} ${r.id} ${r.title}\n${r.value || '—'}${r.quote ? `\n«${r.quote}»` : ''}${r.note ? `\n(${r.note})` : ''}`);
    for (const o of card.optional) if (o.value) blocks.push(`${o.mark} ${o.id} ${o.title}\n${o.value}${o.quote ? `\n«${o.quote}»` : ''}`);
    if (state.materials.length) blocks.push('Матеріали:\n' + state.materials.map((m) => `• ${m.kind}: ${m.ref}`).join('\n'));
    const parts = []; let cur = '';
    for (const b of blocks.map(esc)) {
        if ((cur + '\n\n' + b).length > 3800) { if (cur) parts.push(cur); cur = b.slice(0, 3800); } else cur = cur ? cur + '\n\n' + b : b;
    }
    if (cur) parts.push(cur);
    return parts;
}

/** Картка для самого експерта: простою мовою, без службових слів. */
function renderExpertCard(card) {
    const L = ['Ось що в мене записано:'];
    for (const r of card.rows) {
        if (r.status === 'not_applicable') { L.push(`• ${r.title}: не застосовується`); continue; }
        const v = r.value || (r.defaultText ? `${r.defaultText} (типово, якщо підходить)` : '— ще не знаю');
        const tag = r.status === 'confirmed' ? ' ✅' : (r.status === 'conflict' ? ' ⚠️ треба вибрати' : ' (перевір)');
        L.push(`• ${r.title}: ${clip(v, 220)}${tag}`);
    }
    return L.join('\n');
}

module.exports = { STATUS, CRITICAL, OPTIONAL, emptyState, setField, confirmAll, addMaterial, computeCard, renderOwnerCard, renderFull, renderExpertCard, isCritical };
