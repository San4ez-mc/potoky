import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { NETWORKS, netLabel } from '../components/funnel/EnvironmentPanel.jsx';

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

const PLATFORM_LABEL = {
    threads: 'Threads', instagram_posts: 'Instagram', instagram: 'Instagram',
    instagram_stories: 'IG Stories', instagram_reels: 'IG Reels',
    telegram: 'Telegram', linkedin: 'LinkedIn', tiktok: 'TikTok',
};

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

export function FunnelAnalytics() {
    const { botId } = useParams();
    const navigate = useNavigate();
    const [period, setPeriod] = useState('30d');
    const [data, setData] = useState(null);
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
    }, [botId]);

    useEffect(() => {
        setLoading(true);
        setError('');
        api.getFunnelAnalytics(botId, period)
            .then(r => setData(r?.data ?? r))
            .catch(e => setError(e.message || 'Помилка завантаження'))
            .finally(() => setLoading(false));
    }, [botId, period, reloadTick]);

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
    const flow = (data?.funnelFlow || []).filter(n => n.reached > 0);
    const entryCount = flow[0]?.reached || 0;
    const maxReached = flow[0]?.reached || 1;

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
                <div className="ml-auto flex gap-1 items-center">
                    {PERIOD_OPTIONS.map(o => (
                        <button
                            key={o.value}
                            onClick={() => setPeriod(o.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === o.value ? 'bg-brand text-white' : 'bg-gray-900 border border-gray-700 text-gray-400 hover:bg-gray-800'}`}
                        >
                            {o.label}
                        </button>
                    ))}
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
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <Card label="Всього сесій" value={s.totalSessions} />
                        <Card label="Активних зараз" value={s.activeSessions} color="text-emerald-400" />
                        <Card label="Завершили" value={s.completedSessions} sub={`конверсія ${s.conversionRate}%`} color="text-brand-light" />
                        <Card label="Відписались" value={s.unsubscribedSessions} color={s.unsubscribedSessions > 0 ? 'text-red-400' : 'text-white'} />
                        <Card label="Кліків з постів" value={s.trackedClicks} sub="deep-links" />
                    </div>

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

                    {/* Funnel flow — drop-off */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                        <div>
                            <div className="text-sm font-semibold text-white">Проходження воронки</div>
                            <div className="text-xs text-gray-500">Скільки сесій дійшло до кожного кроку. «Далі не пройшли» = зупинились на цьому кроці й не рушили далі (перестали відповідати / ще в процесі) — це НЕ відписка (відписки — окрема картка «Відписались»).</div>
                        </div>
                        {flow.length === 0 ? (
                            <div className="text-xs text-gray-600 py-4 text-center">Немає даних про проходження за цей період</div>
                        ) : (
                            <div className="space-y-0">
                                {flow.map((n, i) => {
                                    const convFromEntry = entryCount > 0 ? Math.round((n.reached / entryCount) * 100) : 0;
                                    const bigDrop = n.dropPct >= 40;
                                    return (
                                        <div key={n.nodeId}>
                                            <div className="flex items-center gap-3 py-1.5">
                                                <span className="text-sm w-5 text-center shrink-0" title={n.type}>{nodeIcon(n.type)}</span>
                                                <div className="w-48 shrink-0 min-w-0">
                                                    <div className="text-xs text-gray-200 truncate" title={n.label}>{n.label}</div>
                                                    <div className="text-[10px] text-gray-600">{convFromEntry}% від входу</div>
                                                </div>
                                                <Bar value={n.reached} max={maxReached} color={i === 0 ? 'bg-emerald-500' : 'bg-brand'} />
                                                <span className="text-xs font-mono font-semibold text-white w-10 text-right shrink-0">{n.reached}</span>
                                            </div>
                                            {i < flow.length - 1 && n.dropAfter > 0 && (
                                                <div className="flex items-center gap-3 pl-8">
                                                    <div className="w-48 shrink-0" />
                                                    <div className={`text-[11px] ${bigDrop ? 'text-red-400 font-medium' : 'text-gray-600'}`}>
                                                        ↓ далі не пройшли: {n.dropAfter} ({n.dropPct}%) {bigDrop ? '— найбільший відтік' : ''}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
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
