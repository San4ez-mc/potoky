import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';

// «ШІ-продавці»: усі продавці експертів. Дані (профіль експерта, послуга, кейси, налаштування) зберігає content2,
// онбординг-бот заповнює їх сам; тут власник лише перевіряє, виправляє за потреби й запускає продавця.

const STATUS = [
    { key: 'draft', label: 'Чернетка', hint: 'Не відповідає нікому, крім тестерів', cls: 'border-gray-700', badge: 'bg-gray-700 text-gray-300' },
    { key: 'testing', label: 'Тест', hint: 'Відповідає лише тестерам зі списку', cls: 'border-blue-700', badge: 'bg-blue-900/60 text-blue-300' },
    { key: 'live', label: 'У роботі', hint: 'Відповідає всім (лише коли все готово)', cls: 'border-green-700', badge: 'bg-green-900/60 text-green-300' },
    { key: 'paused', label: 'Пауза', hint: 'Не відповідає нікому', cls: 'border-yellow-700', badge: 'bg-yellow-900/60 text-yellow-300' },
];
const statusOf = (k) => STATUS.find((s) => s.key === k) || STATUS[0];

const DIR_LABELS = {
    greeting: 'Привітання', notRelevant: 'Людині не підходить', softExit: 'Людина думає (мʼякий вихід)', nudge: 'Нагадування після паузи',
    direct: 'Передача експерту', paid: 'Після оплати', afterEnd: 'Завершення розмови',
};
const PREVIEW_LABELS = {
    offer: 'Про послугу', qualify: 'Що з’ясовувати', proof: 'Кейси', faq: 'Часті запитання (напрям відповідей)', rules: 'Правила (що не вигадувати)', tone: 'Голос і стиль', booking: 'Запис',
};
const CONTENT2 = 'https://content2.fineko.space';

const input = 'w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600';

function StatusBadge({ status }) {
    const s = statusOf(status);
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.badge}`}>{s.label}</span>;
}

// ── Список ────────────────────────────────────────────────────
function SellerList() {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => { api.getSellers().then(setRows).catch((e) => setError(e.message)); }, []);

    if (error) return <div className="p-6 text-red-400 text-sm">{error}</div>;
    if (!rows) return <div className="p-6 text-gray-500 text-sm">Завантаження…</div>;

    return (
        <div className="p-6 max-w-5xl">
            <h1 className="text-lg font-semibold text-white">ШІ-продавці</h1>
            <p className="text-sm text-gray-400 mt-1 mb-4">Продавці експертів. Їх налаштування заповнює онбординг-бот; тут ви перевіряєте, виправляєте і запускаєте. Дані зберігаються в content2.</p>
            {rows.length === 0 && <p className="text-sm text-gray-500">Поки нікого: продавець зʼявляється після онбордингу експерта.</p>}
            <div className="space-y-2">
                {rows.map((s) => (
                    <Link key={s.projectId} to={`/sellers/${s.projectId}`} className="block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl px-4 py-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-white truncate">{s.projectName}</p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    {s.sellerName ? `Продавець: ${s.sellerName}` : 'Імʼя продавця ще не задано'}
                                    {s.clone ? ` · воронка ${s.clone.slug}` : ' · воронки ще нема'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <StatusBadge status={s.status} />
                                {s.ready
                                    ? <span className="text-xs text-green-400">✓ готово до запуску</span>
                                    : <span className="text-xs text-yellow-400">бракує: {s.missing}</span>}
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}

// ── Картка продавця ───────────────────────────────────────────
function SellerDetail({ projectId }) {
    const [data, setData] = useState(null);
    const [f, setF] = useState(null);
    const [allow, setAllow] = useState('');
    const [error, setError] = useState('');
    const [msg, setMsg] = useState(null);
    const [saving, setSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showDirs, setShowDirs] = useState(false);

    const load = () => api.getSeller(projectId).then((d) => {
        setData(d);
        setF({ ...d.config, texts: { ...(d.config.texts || {}) } });
        setAllow((d.config.testAllowlist || []).join(', '));
    }).catch((e) => setError(e.message));
    useEffect(() => { load(); }, [projectId]);

    async function save(extra) {
        setSaving(true); setMsg(null);
        try {
            const body = extra || {
                mode: f.mode, sellerName: f.sellerName, sellerTitle: f.sellerTitle, primaryProductId: f.primaryProductId,
                bookingUrl: f.bookingUrl, bookingNote: f.bookingNote, handoffTelegramId: f.handoffTelegramId, allowedContacts: f.allowedContacts,
                priceAmount: f.priceAmount, currency: f.currency, paymentConnectorId: f.paymentConnectorId, monthlyDialogLimit: f.monthlyDialogLimit,
                testAllowlist: allow, texts: f.texts,
            };
            await api.saveSeller(projectId, body);
            setMsg({ ok: true, text: 'Збережено' });
            await load();
        } catch (e) {
            setMsg({ ok: false, text: e.message });
        } finally {
            setSaving(false);
        }
    }

    if (error) return <div className="p-6 text-red-400 text-sm">{error}</div>;
    if (!data || !f) return <div className="p-6 text-gray-500 text-sm">Завантаження…</div>;

    const set = (k, v) => setF({ ...f, [k]: v });
    const r = data.readiness;
    const clone = data.clone;

    return (
        <div className="p-6 max-w-4xl space-y-6">
            <div>
                <Link to="/sellers" className="text-xs text-gray-500 hover:text-gray-300">← Усі продавці</Link>
                <div className="flex items-start justify-between gap-3 flex-wrap mt-1">
                    <div>
                        <h1 className="text-lg font-semibold text-white">{data.projectName}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">Налаштування заповнює онбординг-бот. Правте лише те, що треба виправити.</p>
                    </div>
                    <button onClick={() => save()} disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-light text-white text-sm disabled:opacity-60">{saving ? 'Зберігаю…' : 'Зберегти'}</button>
                </div>
                {msg && <p className={`text-xs mt-2 ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
            </div>

            <section className="flex flex-wrap gap-2 text-xs">
                <a href={`${CONTENT2}/user-data?projectId=${projectId}`} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">Профіль і кейси в content2 ↗</a>
                <a href={`${CONTENT2}/products?projectId=${projectId}`} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">Послуга ↗</a>
                <a href={`${CONTENT2}/storage?projectId=${projectId}`} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">Правила й документи ↗</a>
                {clone && <Link to={`/funnel/${clone.botId}`} className="px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">Воронка {clone.slug}</Link>}
                {clone && <Link to={`/bots/${clone.botId}/sessions`} className="px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">Розмови (сесії)</Link>}
                {clone && clone.link && <a href={clone.link} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">Відкрити в Telegram ↗</a>}
                {!clone && <span className="px-2.5 py-1 text-yellow-400">Воронку ще не створено (її клонує скрипт clone-expert-seller)</span>}
            </section>

            <section>
                <p className="text-xs font-semibold text-gray-400 mb-2">Статус</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {STATUS.map((s) => (
                        <button key={s.key} onClick={() => save({ status: s.key })} disabled={saving}
                            className={`text-left border rounded-lg px-3 py-2 bg-gray-900 ${s.cls} ${f.status === s.key ? 'ring-2 ring-brand' : 'opacity-70 hover:opacity-100'}`}>
                            <p className="text-sm font-medium text-white">{f.status === s.key ? '● ' : ''}{s.label}</p>
                            <p className="text-[11px] text-gray-500">{s.hint}</p>
                        </button>
                    ))}
                </div>
                {f.goLiveAt && <p className="text-[11px] text-gray-600 mt-1">Вперше запущено {String(f.goLiveAt).slice(0, 10)}</p>}
            </section>

            <section className={`border rounded-lg px-3 py-2 ${r.ready ? 'border-green-700/60 bg-green-900/10' : 'border-yellow-700/60 bg-yellow-900/10'}`}>
                <p className="text-sm font-medium text-white">{r.ready ? '✅ Усе потрібне для запуску заповнено' : `⚠️ Для запуску бракує: ${r.missing.length}`}</p>
                {r.missing.length > 0 && <ul className="list-disc ml-5 mt-1 text-xs text-gray-300">{r.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
                {r.warnings.length > 0 && (<><p className="text-xs font-medium text-gray-400 mt-2">Не блокує, але варто перевірити:</p><ul className="list-disc ml-5 text-xs text-gray-500">{r.warnings.map((m) => <li key={m}>{m}</li>)}</ul></>)}
            </section>

            <section className="grid sm:grid-cols-2 gap-3">
                <div>
                    <label className="text-xs text-gray-400">Як звати продавця</label>
                    <input value={f.sellerName} onChange={(e) => set('sellerName', e.target.value)} placeholder="напр. Ден" className={input} />
                    {data.hints.name && <p className="text-[11px] text-gray-600 mt-0.5">З онбордингу: {data.hints.name}</p>}
                </div>
                <div>
                    <label className="text-xs text-gray-400">Як він представляє експерта</label>
                    <input value={f.sellerTitle} onChange={(e) => set('sellerTitle', e.target.value)} placeholder="ШІ-продавець Олександра Мацука" className={input} />
                </div>
                <div>
                    <label className="text-xs text-gray-400">Що продає (послуга)</label>
                    <select value={f.primaryProductId} onChange={(e) => set('primaryProductId', e.target.value)} className={input}>
                        <option value="">Головна за пріоритетом</option>
                        {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.price ? ` · ${p.price}` : ''}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs text-gray-400">Режим</label>
                    <select value={f.mode} onChange={(e) => set('mode', e.target.value)} className={input}>
                        <option value="book_consult">Запис на консультацію</option>
                        <option value="paid_consult">Запис з оплатою вперед (поки недоступний)</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs text-gray-400">Куди слати гарячих лідів (Telegram ID, цифри)</label>
                    <input value={f.handoffTelegramId} onChange={(e) => set('handoffTelegramId', e.target.value)} placeholder="345126254" className={input} />
                    {data.hints.notify && <p className="text-[11px] text-gray-600 mt-0.5">З онбордингу: {data.hints.notify}</p>}
                </div>
                <div>
                    <label className="text-xs text-gray-400">Контакти, які бот може називати</label>
                    <input value={f.allowedContacts} onChange={(e) => set('allowedContacts', e.target.value)} placeholder="t.me/nickname" className={input} />
                </div>
                <div>
                    <label className="text-xs text-gray-400">Посилання на запис (Calendly, Cal.com…)</label>
                    <input value={f.bookingUrl} onChange={(e) => set('bookingUrl', e.target.value)} placeholder="https://" className={input} />
                </div>
                <div>
                    <label className="text-xs text-gray-400">Як записуються, якщо без посилання</label>
                    <textarea value={f.bookingNote} onChange={(e) => set('bookingNote', e.target.value)} rows={2} className={input} />
                    {data.hints.booking && <p className="text-[11px] text-gray-600 mt-0.5 whitespace-pre-wrap">З онбордингу: {data.hints.booking}</p>}
                </div>
                <div>
                    <label className="text-xs text-gray-400">Ліміт діалогів на місяць (порожньо = без ліміту)</label>
                    <input value={f.monthlyDialogLimit} onChange={(e) => set('monthlyDialogLimit', e.target.value === '' ? '' : Number(e.target.value))} inputMode="numeric" className={input} />
                </div>
                <div>
                    <label className="text-xs text-gray-400">Тестери (Telegram ID через кому): їм продавець відповідає в статусі «Тест»</label>
                    <input value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="345126254, 123456789" className={input} />
                </div>
            </section>

            <section>
                <button onClick={() => setShowDirs(!showDirs)} className="text-xs text-gray-400 hover:text-white">{showDirs ? '▾' : '▸'} Напрями відповідей (необовʼязково: звичайно підходять типові)</button>
                {showDirs && (
                    <div className="mt-2 space-y-2">
                        <p className="text-[11px] text-gray-600">Це не готові тексти, а підказки, що і в якому дусі сказати. Продавець формулює відповідь сам за розмовою. Порожнє поле = типовий напрям.</p>
                        {Object.keys(DIR_LABELS).map((k) => (
                            <div key={k}>
                                <label className="text-xs text-gray-400">{DIR_LABELS[k]}</label>
                                <textarea value={f.texts[k] || ''} onChange={(e) => set('texts', { ...f.texts, [k]: e.target.value })} rows={2} placeholder={data.defaultDirections[k]} className={input} />
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <button onClick={() => setShowPreview(!showPreview)} className="text-xs text-gray-400 hover:text-white">{showPreview ? '▾' : '▸'} Що саме продавець знає про експерта (перевірка)</button>
                {showPreview && (
                    <div className="mt-2 space-y-3">
                        {Object.keys(PREVIEW_LABELS).map((k) => data.preview[k] ? (
                            <div key={k}>
                                <p className="text-[11px] font-semibold text-gray-400">{PREVIEW_LABELS[k]}</p>
                                <pre className="text-xs text-gray-200 whitespace-pre-wrap bg-gray-900 border border-gray-800 rounded-lg p-2">{data.preview[k]}</pre>
                            </div>
                        ) : null)}
                    </div>
                )}
            </section>

            {(f.funnelBotId || f.templateVersion) && <p className="text-[11px] text-gray-600">Воронка {f.funnelBotId || '—'} · версія шаблону {f.templateVersion || '—'}</p>}
        </div>
    );
}

export function Sellers() {
    const { projectId } = useParams();
    return projectId ? <SellerDetail projectId={projectId} /> : <SellerList />;
}
