import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { NETWORKS, netLabel } from '../components/funnel/EnvironmentPanel.jsx';
import { FunnelGraphView } from '../components/funnel/FunnelGraphView.jsx';

const PERIOD_OPTIONS = [
    { value: '24h', label: '24 години' },
    { value: '7d', label: '7 днів' },
    { value: '30d', label: '30 днів' },
];

const NODE_ICON = {
    start: '🚀', message: '💬', claude: '🤖', agent: '🤖', condition: '🔀',
    wait: '⏳', wait_payment: '💳', connector: '💳', notifyAdmin: '🔔',
    httpRequest: '🌐', saveFile: '💾', loadFile: '📂',
};
const nodeIcon = (t) => NODE_ICON[t] || '•';
const pctOfTotal = (val, total) => total > 0 ? Math.round((val / total) * 100) : 0;

const PLATFORM_LABEL = {
    threads: 'Threads', instagram_posts: 'Instagram', instagram: 'Instagram',
    instagram_stories: 'IG Stories', instagram_reels: 'IG Reels',
    telegram: 'Telegram', linkedin: 'LinkedIn', tiktok: 'TikTok',
};

const QUALITY_ROWS = [
    { key: 'unknownProduct', label: 'Не визначив товар', base: 'sessions' },
    { key: 'cardTwice', label: 'Картка товару двічі', base: 'sessions' },
    { key: 'deliveryFail', label: 'Повідомлення не доставлено', base: 'sessions' },
    { key: 'managerTakeover', label: 'Підхопив менеджер', base: 'sessions' },
    { key: 'supplierError', label: 'Постачальник: помилка', base: 'orders' },
    { key: 'supplierCreated', label: 'Постачальник: оформлено авто', base: 'orders', good: true },
];
function QualityTable({ q }) {
    const pct = (v, b) => (b > 0 ? (Math.round((v / b) * 1000) / 10).toFixed(1) + '%' : '—');
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="text-gray-500">
                        <th className="text-left font-medium py-1.5">Показник</th>
                        <th className="text-right font-medium py-1.5">Зараз</th>
                        <th className="text-right font-medium py-1.5">%</th>
                        <th className="text-right font-medium py-1.5">Попередній</th>
                        <th className="text-right font-medium py-1.5">%</th>
                        <th className="text-right font-medium py-1.5">Зміна</th>
                    </tr>
                </thead>
                <tbody>
                    <tr className="border-t border-gray-800 text-gray-300">
                        <td className="py-1.5">Сесій з відповідями бота</td>
                        <td className="text-right tabular-nums">{q.current.sessions}</td><td />
                        <td className="text-right tabular-nums text-gray-500">{q.previous.sessions}</td><td /><td />
                    </tr>
                    <tr className="border-t border-gray-800 text-gray-300">
                        <td className="py-1.5">Замовлень</td>
                        <td className="text-right tabular-nums">{q.current.orders}</td><td />
                        <td className="text-right tabular-nums text-gray-500">{q.previous.orders}</td><td /><td />
                    </tr>
                    {[
                        { key: 'aiUsd', label: 'Вартість AI за період', d: 2 },
                        { key: 'aiPerSession', label: 'AI за одну розмову', d: 3 },
                        { key: 'aiPerOrder', label: 'AI за одне замовлення', d: 2 },
                    ].map((r) => {
                        const cur = Number(q.current[r.key] || 0), prev = Number(q.previous[r.key] || 0);
                        const uah = (v) => (q.usdUah ? ' (' + (v * q.usdUah).toFixed(r.d === 3 ? 2 : 0) + ' грн)' : '');
                        const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
                        return (
                            <tr key={r.key} className="border-t border-gray-800 text-gray-300">
                                <td className="py-1.5">{r.label}</td>
                                <td className="text-right tabular-nums text-white whitespace-nowrap">${cur.toFixed(r.d)}{uah(cur)}</td><td />
                                <td className="text-right tabular-nums text-gray-500 whitespace-nowrap">${prev.toFixed(r.d)}{uah(prev)}</td><td />
                                <td className={`text-right tabular-nums ${delta == null ? 'text-gray-600' : delta > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{delta == null ? '—' : (delta > 0 ? '+' : '') + delta + '%'}</td>
                            </tr>
                        );
                    })}
                    {QUALITY_ROWS.map((r) => {
                        const cur = q.current[r.key] || 0, prev = q.previous[r.key] || 0;
                        const curB = q.current[r.base] || 0, prevB = q.previous[r.base] || 0;
                        const curP = curB > 0 ? cur / curB : null, prevP = prevB > 0 ? prev / prevB : null;
                        const delta = (curP != null && prevP != null) ? Math.round((curP - prevP) * 1000) / 10 : null;
                        const worse = delta != null && (r.good ? delta < 0 : delta > 0);
                        return (
                            <tr key={r.key} className="border-t border-gray-800">
                                <td className="py-1.5 text-gray-300">{r.label}</td>
                                <td className="text-right tabular-nums text-white">{cur}</td>
                                <td className="text-right tabular-nums text-white">{pct(cur, curB)}</td>
                                <td className="text-right tabular-nums text-gray-500">{prev}</td>
                                <td className="text-right tabular-nums text-gray-500">{pct(prev, prevB)}</td>
                                <td className={`text-right tabular-nums ${delta == null ? 'text-gray-600' : worse ? 'text-red-400' : 'text-emerald-400'}`}>{delta == null ? '—' : (delta > 0 ? '+' : '') + delta + ' п.п.'}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function QualityDaily({ daily }) {
    const cols = [
        { key: 'unknownProduct', label: 'Товар', base: 'sessions' },
        { key: 'cardTwice', label: 'Картка ×2', base: 'sessions' },
        { key: 'deliveryFail', label: 'Не дост.', base: 'sessions' },
        { key: 'managerTakeover', label: 'Менеджер', base: 'sessions' },
        { key: 'supplierError', label: 'Пост. пом.', base: 'orders' },
    ];
    const money = [
        { key: 'aiUsd', label: 'AI $', d: 2 },
        { key: 'aiPerSession', label: '$/розм.', d: 3 },
        { key: 'aiPerOrder', label: '$/замовл.', d: 2 },
    ];
    const pct = (v, b) => (b > 0 ? Math.round((v / b) * 100) + '%' : '·');
    return (
        <div className="overflow-x-auto">
            <table className="text-[11px] tabular-nums">
                <thead>
                    <tr className="text-gray-500">
                        <th className="text-left font-medium pr-3 py-1">День</th>
                        <th className="text-right font-medium pr-3 py-1">Сесій</th>
                        <th className="text-right font-medium pr-3 py-1">Замов.</th>
                        {cols.map((c) => <th key={c.key} className="text-right font-medium pr-3 py-1">{c.label}</th>)}
                        {money.map((c) => <th key={c.key} className="text-right font-medium pr-3 py-1">{c.label}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {daily.map((d) => (
                        <tr key={d.date} className="border-t border-gray-800/60 text-gray-300">
                            <td className="pr-3 py-0.5 text-gray-400">{d.date.slice(5)}</td>
                            <td className="text-right pr-3">{d.sessions}</td>
                            <td className="text-right pr-3">{d.orders}</td>
                            {cols.map((c) => { const v = d[c.key] || 0, b = d[c.base] || 0; const p = b > 0 ? v / b : 0; return <td key={c.key} className={`text-right pr-3 ${b > 0 && p >= 0.2 ? 'text-red-400' : b > 0 && p >= 0.1 ? 'text-amber-400' : ''}`}>{pct(v, b)}{b > 0 && v > 0 ? ` (${v})` : ''}</td>; })}
                            {money.map((c) => { const v = Number(d[c.key] || 0); return <td key={c.key} className="text-right pr-3 text-gray-400">{v > 0 ? v.toFixed(c.d) : '·'}</td>; })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Bar({ value, max, color = 'bg-brand' }) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
        <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
            <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
    );
}

function Card({ label, value, sub, color }) {
    return (
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <div className={`text-2xl font-bold ${color || 'text-white'}`}>{value}</div>
            {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
        </div>
    );
}

// «2 дні 4 год», «35 хв» тощо — компактне форматування тривалості для картки
function formatDuration(ms) {
    if (ms == null) return '—';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} хв`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `${hours} год`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days} дн ${remHours} год` : `${days} дн`;
}

// Компактний спарклайн-графік нових підписників по тижнях (останні 8 тижнів)
function WeeklyTrend({ weeks }) {
    if (!weeks || weeks.length === 0) return null;
    const max = Math.max(1, ...weeks.map(w => w.count));
    return (
        <div className="flex items-end gap-1.5 h-14">
            {weeks.map(w => {
                const h = Math.max(2, Math.round((w.count / max) * 100));
                const label = new Date(w.weekStart).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
                return (
                    <div key={w.weekStart} className="flex flex-col items-center gap-1 flex-1" title={`тиждень з ${label}: ${w.count}`}>
                        <div className="w-full bg-brand/60 rounded-sm hover:bg-brand transition-colors" style={{ height: `${h}%` }} />
                        <span className="text-[9px] text-gray-600">{w.count}</span>
                    </div>
                );
            })}
        </div>
    );
}

// Індивідуальні налаштування аналітики per-воронка (період, з тестами) — щоб не вибирати їх заново щоразу
function loadSettings(botId) {
    try { return JSON.parse(localStorage.getItem(`funnelAnalyticsSettings:${botId}`) || '{}'); } catch { return {}; }
}
function saveSettings(botId, patch) {
    try { localStorage.setItem(`funnelAnalyticsSettings:${botId}`, JSON.stringify({ ...loadSettings(botId), ...patch })); } catch { /* ignore */ }
}

export function FunnelAnalytics() {
    const { botId } = useParams();
    const navigate = useNavigate();
    const [period, setPeriod] = useState(() => loadSettings(botId).period || '30d');
    const [includeTest, setIncludeTest] = useState(() => loadSettings(botId).includeTest || false);
    const [data, setData] = useState(null);
    const [flowDef, setFlowDef] = useState(null); // {nodes, edges} з позиціями — той самий граф, що в редакторі
    const [bot, setBot] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [botUsername, setBotUsername] = useState('');
    const [selectedNets, setSelectedNets] = useState([]); // [] = all networks
    const [creating, setCreating] = useState(false);
    const [reloadTick, setReloadTick] = useState(0);

    useEffect(() => {
        api.getBot(botId).then(setBot).catch(() => {});
        api.getFunnelKeys(botId).then(keys => {
            const u = keys.find(k => k.key === 'TELEGRAM_BOT_USERNAME')?.value || '';
            setBotUsername(String(u).replace(/^@/, ''));
        }).catch(() => {});
        // Ті самі nodes/edges (з позиціями), що редактор — щоб малювати РЕАЛЬНИЙ граф,
        // а не фейкову лінійну апроксимацію.
        api.getFunnel(botId).then(r => setFlowDef((r?.data ?? r)?.flow || null)).catch(() => setFlowDef(null));
    }, [botId]);

    const changePeriod = (p) => { setPeriod(p); saveSettings(botId, { period: p }); };
    const toggleIncludeTest = () => setIncludeTest(v => { const nv = !v; saveSettings(botId, { includeTest: nv }); return nv; });

    useEffect(() => {
        setLoading(true);
        setError('');
        api.getFunnelAnalytics(botId, period, includeTest)
            .then(r => setData(r?.data ?? r))
            .catch(e => setError(e.message || 'Помилка завантаження'))
            .finally(() => setLoading(false));
    }, [botId, period, includeTest, reloadTick]);

    const toggleNet = (id) => setSelectedNets(prev => prev.includes(id) ? prev.filter(n => n !== id) : [...prev, id]);
    const netMatch = (p) => selectedNets.length === 0 || selectedNets.includes(p || 'other');

    async function createChannelLink({ platform, name, description }) {
        setCreating(false);
        await api.createChannelLink({ botId, funnelSlug: bot?.slug || botId, botUsername, platform, name, description });
        setReloadTick(t => t + 1);
    }
    async function deleteChannelLink(id) {
        if (!window.confirm('Видалити це посилання?')) return;
        await api.deleteChannelLink(id);
        setReloadTick(t => t + 1);
    }

    const s = data?.summary;
    const reachedById = Object.fromEntries((data?.funnelFlow || []).map(n => [n.nodeId, n]));

    const channels = (data?.channels || []).filter(c => netMatch(c.platform));
    const postSources = (data?.postSources || []).filter(p => netMatch(p.platform));
    // Networks present in the data, for the filter bar
    const availableNets = Array.from(new Set([...(data?.channels || []).map(c => c.platform), ...(data?.postSources || []).map(p => p.platform)].filter(Boolean)));
    const filteredClicks = channels.reduce((a, c) => a + c.totalClicks, 0);
    // Implicit base link of the funnel (t.me/<bot>?start=<slug>) — always exists.
    const directSessions = (data?.linkStats || []).find(l => l.source === 'direct')?.count || 0;
    const baseLink = (botUsername && bot?.slug) ? { url: `https://t.me/${botUsername}?start=${bot.slug}`, sessions: directSessions } : null;
    const showBase = baseLink && selectedNets.length === 0;

    function linkLabel(source) {
        if (source === 'direct') return 'Пряме / /start без параметра';
        if (/^lm[0-9a-f]+$/.test(source)) return `Пост-посилання ${source}`;
        if (/^k[0-9a-f]{8}(_\w+)?$/.test(source)) return `Deep-link ${source}`;
        return source;
    }

    return (
        <div className="p-6 space-y-5 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => navigate('/funnels')} className="text-gray-400 hover:text-white text-sm transition-colors">← Воронки</button>
                <div className="text-gray-700">/</div>
                <div>
                    <h1 className="text-lg font-semibold text-white">Аналітика{bot ? `: ${bot.name}` : ''}</h1>
                    {bot && <div className="text-xs text-gray-500 font-mono">/{bot.slug}</div>}
                </div>
                <div className="ml-auto flex gap-1 items-center flex-wrap">
                    {PERIOD_OPTIONS.map(o => (
                        <button
                            key={o.value}
                            onClick={() => changePeriod(o.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === o.value ? 'bg-brand text-white' : 'bg-gray-900 border border-gray-700 text-gray-400 hover:bg-gray-800'}`}
                        >
                            {o.label}
                        </button>
                    ))}
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 ml-1 cursor-pointer select-none" title="Індивідуальне налаштування — запам'ятовується для цієї воронки">
                        <input type="checkbox" checked={includeTest} onChange={toggleIncludeTest} /> з тестами
                    </label>
                    <Link to={`/funnel/${botId}`} className="ml-2 px-3 py-1.5 rounded-lg text-xs text-brand-light border border-gray-700 bg-gray-900 hover:bg-gray-800 transition-colors">
                        Редагувати воронку
                    </Link>
                </div>
            </div>

            {error && <div className="rounded-lg bg-red-900/20 border border-red-800/40 px-4 py-3 text-sm text-red-300">{error}</div>}

            {loading ? (
                <div className="text-gray-400 text-sm">Завантаження...</div>
            ) : data && s && (
                <>
                    {/* Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Card label="Всього сесій" value={s.totalSessions} />
                        <Card label="Є відповідь" value={s.repliedSessions ?? 0} sub={`${s.repliedRate ?? 0}% від сесій`} color="text-sky-400" />
                        <Card label="Активних зараз" value={s.activeSessions} sub={`${pctOfTotal(s.activeSessions, s.totalSessions)}%`} color="text-emerald-400" />
                        <Card label="Завершили" value={s.completedSessions} sub={`конверсія ${s.conversionRate}%`} color="text-brand-light" />
                        <Card label="Відписались" value={s.unsubscribedSessions} sub={`${pctOfTotal(s.unsubscribedSessions, s.totalSessions)}%`} color={s.unsubscribedSessions > 0 ? 'text-red-400' : 'text-white'} />
                        <Card label="Кліків з постів" value={s.trackedClicks} sub="deep-links" />
                        <Card label="Нових / тиждень" value={s.avgWeeklySubs ?? '—'} sub="середнє за останні повні тижні" color="text-amber-400" />
                        <Card label="Час проходження" value={formatDuration(s.avgCompletionMs)} sub="середньо від старту до завершення" color="text-violet-400" />
                    </div>

                    {/* Помилки бота — кількість і % від сесій з відповідями бота, проти попереднього періоду (2026-09-08) */}
                    {data.quality && !data.quality.error && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
                            <div>
                                <div className="text-sm font-semibold text-white">Помилки бота</div>
                                <div className="text-xs text-gray-500">Сесії з відповідями бота за період: {data.quality.current.sessions} (попередній такий самий період: {data.quality.previous.sessions}). Відсоток — від цих сесій; для постачальника — від замовлень.</div>
                            </div>
                            <QualityTable q={data.quality} />
                            {data.quality.daily && data.quality.daily.length > 0 && (
                                <div className="pt-2">
                                    <div className="text-xs text-gray-500 mb-1">По днях (14 днів): частка сесій з помилкою. Порівнюйте день до і після правки.</div>
                                    <QualityDaily daily={data.quality.daily} />
                                </div>
                            )}
                            {data.quality.metricNodes === 0 && (
                                <div className="text-xs text-amber-400">У графі немає нод із позначкою errorMetric ('unknown_product' / 'presentation') — рядки «не визначив товар» і «картка двічі» будуть нульові. Постав позначку в даних відповідних нод.</div>
                            )}
                        </div>
                    )}

                    {/* Weekly new subscribers trend */}
                    {data.weeklySubs && data.weeklySubs.length > 1 && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
                            <div>
                                <div className="text-sm font-semibold text-white">Нові підписники по тижнях</div>
                                <div className="text-xs text-gray-500">Останні {data.weeklySubs.length} тижнів, незалежно від обраного періоду вище</div>
                            </div>
                            <WeeklyTrend weeks={data.weeklySubs} />
                        </div>
                    )}

                    {/* Deep links per network — filter + management */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div>
                                <div className="text-sm font-semibold text-white">Посилання по мережах</div>
                                <div className="text-xs text-gray-500">Deep-links воронки. Фільтруй, щоб бачити переходи з конкретної соцмережі.</div>
                            </div>
                            <button onClick={() => setCreating(v => !v)} disabled={!botUsername} title={!botUsername ? 'Немає TELEGRAM_BOT_USERNAME' : ''} className="px-3 py-1.5 rounded-lg text-xs bg-brand hover:bg-brand/90 text-white transition-colors disabled:opacity-40">+ Нове посилання</button>
                        </div>

                        {/* Network filter chips */}
                        <div className="flex flex-wrap gap-1.5">
                            <button onClick={() => setSelectedNets([])} className={`px-2.5 py-1 rounded-full text-xs transition-colors ${selectedNets.length === 0 ? 'bg-brand text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>Всі</button>
                            {availableNets.map(n => (
                                <button key={n} onClick={() => toggleNet(n)} className={`px-2.5 py-1 rounded-full text-xs transition-colors ${selectedNets.includes(n) ? 'bg-brand text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                                    {netLabel(n)}
                                </button>
                            ))}
                            {availableNets.length === 0 && <span className="text-xs text-gray-600 py-1">Мережевих посилань ще немає — нижче основне, а «+ Нове посилання» додасть під мережу.</span>}
                        </div>

                        {creating && <NewLinkForm networks={NETWORKS} onCreate={createChannelLink} onCancel={() => setCreating(false)} />}

                        {(showBase || channels.length > 0) && (
                            <div className="space-y-2">
                                {showBase && (
                                    <div className="bg-gray-950 border border-gray-800 rounded-lg p-2.5 space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 shrink-0">Основне</span>
                                                <span className="text-xs font-medium text-gray-200 truncate">Основне посилання воронки</span>
                                            </div>
                                            <span className="text-xs font-mono font-semibold text-white shrink-0" title="прямих входів (без параметра/за slug)">👆 {baseLink.sessions}</span>
                                        </div>
                                        <div className="text-[10px] text-gray-600">Базовий deep-link. Для трекінгу по конкретних мережах створюй окремі посилання нижче.</div>
                                        <div className="flex items-center gap-2">
                                            <a href={baseLink.url} target="_blank" rel="noreferrer" className="text-[11px] text-brand-light hover:text-white break-all font-mono truncate">{baseLink.url}</a>
                                            <button onClick={() => navigator.clipboard?.writeText(baseLink.url)} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 shrink-0">копі</button>
                                        </div>
                                    </div>
                                )}
                                {channels.map(c => (
                                    <div key={c.id} className="bg-gray-950 border border-gray-800 rounded-lg p-2.5 space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/20 text-brand-light shrink-0">{netLabel(c.platform)}</span>
                                                <span className="text-xs font-medium text-gray-200 truncate">{c.name || 'Без назви'}</span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-xs font-mono font-semibold text-white" title="всього переходів (канал + пости)">👆 {c.totalClicks}</span>
                                                <button onClick={() => deleteChannelLink(c.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-red-900/50 text-gray-500 hover:text-red-400 transition-colors" title="Видалити">✕</button>
                                            </div>
                                        </div>
                                        {c.description && <div className="text-[10px] text-gray-500">{c.description}</div>}
                                        <div className="text-[10px] text-gray-600">прямих: {c.directClicks} · з постів: {c.postClicks} ({c.postLinks} лінків)</div>
                                        {c.url && (
                                            <div className="flex items-center gap-2">
                                                <a href={c.url} target="_blank" rel="noreferrer" className="text-[11px] text-brand-light hover:text-white break-all font-mono truncate">{c.url}</a>
                                                <button onClick={() => navigator.clipboard?.writeText(c.url)} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 shrink-0">копі</button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {channels.length > 0 && <div className="text-[11px] text-gray-500 text-right">Разом за фільтром: <b className="text-white">{filteredClicks}</b> переходів</div>}
                            </div>
                        )}
                    </div>

                    {/* Funnel flow — реальний граф (позиції з редактора), не фейковий лінійний список.
                        Кожна незв'язна гілка (напр. окремий вхід для Instagram-коментарів, який
                        двигун стартує напряму через currentNodeId) рендериться окремо — так видно,
                        що це інший сценарій, а не фінальний етап основної воронки. */}
                    <div className="space-y-2">
                        <div>
                            <div className="text-sm font-semibold text-white">Проходження воронки</div>
                            <div className="text-xs text-gray-500">Скільки сесій дійшло до кожної ноди. «⚠ -N%» — великий відтік саме тут (далі не пішли жодним шляхом); «⏹» — кінцева дія сценарію (не відтік).</div>
                        </div>
                        {!flowDef || flowDef.nodes.length === 0 ? (
                            <div className="text-xs text-gray-600 py-4 text-center bg-gray-900 border border-gray-800 rounded-xl">Немає даних про структуру воронки</div>
                        ) : (
                            <FunnelGraphView nodes={flowDef.nodes} edges={flowDef.edges} reachedById={reachedById} />
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* Where people are stuck now */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                            <div>
                                <div className="text-sm font-semibold text-white">Де люди зупинились</div>
                                <div className="text-xs text-gray-500">Незавершені сесії — на якому кроці стоять зараз</div>
                            </div>
                            {(!data.stuckAt || data.stuckAt.length === 0) ? (
                                <div className="text-xs text-gray-600 py-4 text-center">Немає незавершених сесій</div>
                            ) : data.stuckAt.slice(0, 12).map(item => (
                                <div key={item.nodeId} className="flex items-center gap-2">
                                    <span className="text-sm w-5 text-center shrink-0">{nodeIcon(item.type)}</span>
                                    <span className="text-xs text-gray-300 truncate flex-1" title={item.label}>{item.label}</span>
                                    <span className="text-xs font-mono font-semibold text-white shrink-0">{item.count}</span>
                                </div>
                            ))}
                        </div>

                        {/* Post sources (deep links) */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                            <div>
                                <div className="text-sm font-semibold text-white">Звідки приходять — пости</div>
                                <div className="text-xs text-gray-500">Переходи per пост (код = посилання_номерпоста)</div>
                            </div>
                            {postSources.length === 0 ? (
                                <div className="text-xs text-gray-600 py-4 text-center">Ще немає переходів з постів</div>
                            ) : postSources.slice(0, 15).map(p => (
                                <div key={p.code} className="flex items-center gap-2">
                                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded shrink-0">
                                        {PLATFORM_LABEL[p.platform] || p.platform || '—'}
                                    </span>
                                    <span className="text-[11px] text-gray-500 font-mono truncate flex-1" title={p.code}>{p.code}</span>
                                    <span className="text-xs text-gray-400 shrink-0" title="сесій">{p.sessions} сес.</span>
                                    <span className="text-xs font-mono font-semibold text-white w-8 text-right shrink-0" title="кліків">{p.clicks}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Traffic sources (session _linkSource) */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                        <div>
                            <div className="text-sm font-semibold text-white">Джерела сесій</div>
                            <div className="text-xs text-gray-500">Звідки users зайшли у воронку (за параметром входу)</div>
                        </div>
                        {(!data.linkStats || data.linkStats.length === 0) ? (
                            <div className="text-xs text-gray-600 py-4 text-center">Немає даних</div>
                        ) : data.linkStats.map(item => {
                            const maxLink = data.linkStats[0]?.count || 1;
                            return (
                                <div key={item.source} className="flex items-center gap-3">
                                    <span className="text-xs text-gray-300 w-52 truncate shrink-0" title={item.source}>{linkLabel(item.source)}</span>
                                    <Bar value={item.count} max={maxLink} />
                                    <span className="text-xs font-mono font-semibold text-white w-10 text-right shrink-0">{item.count}</span>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

function NewLinkForm({ networks, onCreate, onCancel }) {
    const [platform, setPlatform] = useState(networks?.[0]?.id || 'threads');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        setSaving(true);
        try { await onCreate({ platform, name: name.trim(), description: description.trim() }); }
        finally { setSaving(false); }
    };

    return (
        <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
            <select value={platform} onChange={e => setPlatform(e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand">
                {(networks || []).map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Назва (напр. Threads — біо)" className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand" />
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Опис (необов'язково)" className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand" />
            <div className="flex gap-1.5">
                <button onClick={submit} disabled={saving} className="flex-1 text-xs py-1.5 rounded bg-brand hover:bg-brand/90 text-white transition-colors disabled:opacity-50">{saving ? '...' : 'Створити'}</button>
                <button onClick={onCancel} className="text-xs px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors">✕</button>
            </div>
        </div>
    );
}
