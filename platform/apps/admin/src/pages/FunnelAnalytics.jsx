import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client.js';

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
    const [linkMeta, setLinkMeta] = useState({});

    useEffect(() => {
        api.getBot(botId).then(setBot).catch(() => {});
        api.getFunnelKeys(botId).then(keys => {
            const metaKey = keys.find(k => k.key === 'FUNNEL_LINK_META');
            if (metaKey?.value) { try { setLinkMeta(JSON.parse(metaKey.value)); } catch { /* ignore */ } }
        }).catch(() => {});
    }, [botId]);

    useEffect(() => {
        setLoading(true);
        setError('');
        api.getFunnelAnalytics(botId, period)
            .then(r => setData(r?.data ?? r))
            .catch(e => setError(e.message || 'Помилка завантаження'))
            .finally(() => setLoading(false));
    }, [botId, period]);

    const s = data?.summary;
    const flow = (data?.funnelFlow || []).filter(n => n.reached > 0);
    const entryCount = flow[0]?.reached || 0;
    const maxReached = flow[0]?.reached || 1;

    function linkLabel(source) {
        if (source === 'direct') return 'Пряме / /start без параметра';
        if (/^lm[0-9a-f]+$/.test(source)) return `Пост-посилання ${source}`;
        const meta = linkMeta[`telegram-${source.slice(1) - 1}`] || linkMeta[`instagram-${source.slice(1) - 1}`] || {};
        return meta.name || source;
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
                                <div className="text-xs text-gray-500">Переходи по deep-links лід-магнітів (per пост)</div>
                            </div>
                            {(!data.postSources || data.postSources.length === 0) ? (
                                <div className="text-xs text-gray-600 py-4 text-center">Ще немає переходів з постів</div>
                            ) : data.postSources.slice(0, 12).map(p => (
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
