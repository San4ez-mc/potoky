import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client.js';

const PERIOD_OPTIONS = [
    { value: '24h', label: '24 години' },
    { value: '7d', label: '7 днів' },
    { value: '30d', label: '30 днів' },
];

function Bar({ value, max, color = 'bg-brand' }) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
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
        // Load link metadata from funnel keys
        api.getFunnelKeys(botId).then(keys => {
            const metaKey = keys.find(k => k.key === 'FUNNEL_LINK_META');
            if (metaKey?.value) {
                try { setLinkMeta(JSON.parse(metaKey.value)); } catch { /* ignore */ }
            }
        }).catch(() => {});
    }, [botId]);

    useEffect(() => {
        setLoading(true);
        setError('');
        api.getFunnelAnalytics(botId, period)
            .then(r => setData(r.data))
            .catch(e => setError(e.message || 'Помилка завантаження'))
            .finally(() => setLoading(false));
    }, [botId, period]);

    const maxLinkCount = data?.linkStats?.[0]?.count || 1;
    const maxNodeCount = data?.nodeStats?.[0]?.count || 1;

    function linkLabel(source) {
        if (source === 'direct') return 'Пряме посилання / /start без параметра';
        const meta = linkMeta[`telegram-${source.slice(1) - 1}`] || linkMeta[`instagram-${source.slice(1) - 1}`] || {};
        return meta.name || source;
    }

    return (
        <div className="p-6 space-y-5 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => navigate('/funnels')}
                    className="text-gray-400 hover:text-white text-sm transition-colors"
                >
                    ← Воронки
                </button>
                <div className="text-gray-700">/</div>
                <div>
                    <h1 className="text-lg font-semibold text-white">
                        Аналітика{bot ? `: ${bot.name}` : ''}
                    </h1>
                    {bot && <div className="text-xs text-gray-500 font-mono">/{bot.slug}</div>}
                </div>
                <div className="ml-auto flex gap-1">
                    {PERIOD_OPTIONS.map(o => (
                        <button
                            key={o.value}
                            onClick={() => setPeriod(o.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === o.value ? 'bg-brand text-white' : 'bg-gray-900 border border-gray-700 text-gray-400 hover:bg-gray-800'}`}
                        >
                            {o.label}
                        </button>
                    ))}
                    <Link
                        to={`/funnel/${botId}`}
                        className="ml-2 px-3 py-1.5 rounded-lg text-xs text-brand-light border border-gray-700 bg-gray-900 hover:bg-gray-800 transition-colors"
                    >
                        Редагувати воронку
                    </Link>
                </div>
            </div>

            {error && (
                <div className="rounded-lg bg-red-900/20 border border-red-800/40 px-4 py-3 text-sm text-red-300">{error}</div>
            )}

            {loading ? (
                <div className="text-gray-400 text-sm">Завантаження...</div>
            ) : data && (
                <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                            { label: 'Всього сесій', value: data.totalSessions },
                            { label: 'Активних зараз', value: data.activeSessions, color: 'text-emerald-400' },
                            { label: 'Унікальних джерел', value: data.linkStats.length },
                            { label: 'Нод пройдено', value: data.nodeStats.length },
                        ].map(card => (
                            <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                                <div className="text-xs text-gray-500 mb-1">{card.label}</div>
                                <div className={`text-2xl font-bold ${card.color || 'text-white'}`}>{card.value}</div>
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* Link stats */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                            <div className="text-sm font-semibold text-white">Сесії по посиланнях</div>
                            <div className="text-xs text-gray-500">Звідки прийшли люди у воронку</div>

                            {data.linkStats.length === 0 ? (
                                <div className="text-xs text-gray-600 py-4 text-center">Немає даних за цей період</div>
                            ) : data.linkStats.map(item => (
                                <div key={item.source} className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-300 truncate max-w-[200px]" title={item.source}>
                                            {linkLabel(item.source)}
                                        </span>
                                        <span className="text-xs font-mono font-semibold text-white ml-2 shrink-0">{item.count}</span>
                                    </div>
                                    <Bar value={item.count} max={maxLinkCount} />
                                </div>
                            ))}
                        </div>

                        {/* Node stats */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                            <div className="text-sm font-semibold text-white">Статистика нод</div>
                            <div className="text-xs text-gray-500">Скільки сесій пройшло через кожну ноду</div>

                            {data.nodeStats.length === 0 ? (
                                <div className="text-xs text-gray-600 py-4 text-center">Немає даних за цей період</div>
                            ) : data.nodeStats.slice(0, 20).map((item, i) => (
                                <div key={item.nodeId} className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-gray-400 font-mono truncate max-w-[220px]" title={item.nodeId}>
                                            {item.nodeId}
                                        </span>
                                        <span className="text-xs font-mono font-semibold text-white ml-2 shrink-0">{item.count}</span>
                                    </div>
                                    <Bar
                                        value={item.count}
                                        max={maxNodeCount}
                                        color={i === 0 ? 'bg-emerald-500' : i < 3 ? 'bg-brand' : 'bg-gray-600'}
                                    />
                                </div>
                            ))}
                            {data.nodeStats.length > 20 && (
                                <div className="text-xs text-gray-600 text-center pt-1">+ {data.nodeStats.length - 20} нод не показано</div>
                            )}
                        </div>
                    </div>

                    {/* Conversion funnel hint */}
                    {data.nodeStats.length >= 2 && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <div className="text-sm font-semibold text-white mb-2">Де зупиняються люди</div>
                            <div className="text-xs text-gray-500 mb-3">
                                Порівняння першої та останньої нод показує відтік аудиторії
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                                <div className="bg-emerald-900/30 border border-emerald-800/40 rounded-lg px-3 py-2 text-center">
                                    <div className="text-emerald-400 font-bold">{data.nodeStats[0]?.count}</div>
                                    <div className="text-xs text-gray-500 mt-0.5">Вхід</div>
                                </div>
                                <div className="flex-1 border-t border-dashed border-gray-700" />
                                {data.nodeStats.length > 2 && (
                                    <>
                                        <div className="text-xs text-gray-600">↓ відтік</div>
                                        <div className="flex-1 border-t border-dashed border-gray-700" />
                                    </>
                                )}
                                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-center">
                                    <div className="text-white font-bold">{data.nodeStats[data.nodeStats.length - 1]?.count}</div>
                                    <div className="text-xs text-gray-500 mt-0.5">Вихід</div>
                                </div>
                                <div className="text-xs text-gray-400 ml-2">
                                    Конверсія: {data.nodeStats[0]?.count > 0
                                        ? Math.round((data.nodeStats[data.nodeStats.length - 1].count / data.nodeStats[0].count) * 100)
                                        : 0}%
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
