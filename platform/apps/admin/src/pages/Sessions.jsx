import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';

export function Sessions() {
    const { botId } = useParams();
    const [sessions, setSessions] = useState([]);
    const [meta, setMeta] = useState({ total: 0 });
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);

        // Use per-bot endpoint if botId is present, otherwise use admin endpoint
        const promise = botId
            ? api.getBotSessions(botId, page)
            : api.getAllSessions({ page });

        promise
            .then(res => {
                setSessions(res.data || []);
                setMeta(res.meta || { total: 0 });
            })
            .catch(err => {
                console.error('Failed to load sessions:', err);
                setSessions([]);
            })
            .finally(() => setLoading(false));
    }, [botId, page]);

    return (
        <div className="p-6 max-w-5xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold text-white">
                        {botId ? 'Сесії бота' : 'Всі сесії'}
                    </h1>
                    {meta.total > 0 && <div className="text-sm text-gray-500 mt-0.5">Всього: {meta.total}</div>}
                </div>
            </div>

            {loading ? (
                <div className="text-gray-400">Завантаження...</div>
            ) : (
                <div className="space-y-2">
                    {sessions.map(s => {
                        const userName = s.user?.firstName || s.user?.username || `id:${s.user?.telegramId || '?'}`;
                        const msgCount = s._count?.messages ?? '—';
                        const apiCount = s._count?.apiCalls ?? '—';
                        return (
                            <Link
                                key={s.id}
                                to={`/sessions/${s.id}`}
                                className="block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl px-4 py-3 transition-colors"
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${s.isActive ? 'text-emerald-400 bg-emerald-900/30 border-emerald-800' : 'text-gray-400 bg-gray-900 border-gray-700'}`}>
                                            {s.isActive ? 'активна' : 'завершена'}
                                        </span>
                                        <span className="text-sm text-white font-semibold truncate">{userName}</span>
                                        {s.bot && (
                                            <span className="text-xs text-gray-500 font-mono shrink-0">/{s.bot.slug}</span>
                                        )}
                                        <span className="text-xs text-gray-600 shrink-0">💬 {msgCount} · 📡 {apiCount}</span>
                                    </div>
                                    <span className="text-xs text-gray-500 shrink-0">
                                        {s.startedAt ? format(new Date(s.startedAt), 'dd.MM.yyyy HH:mm') : ''}
                                    </span>
                                </div>
                                <div className="text-xs text-gray-600 mt-1 font-mono">{s.id.slice(0, 8)}…  стан: {s.state}</div>
                            </Link>
                        );
                    })}
                    {sessions.length === 0 && <div className="text-gray-500 py-8 text-center">Немає сесій</div>}
                </div>
            )}

            <div className="flex gap-2 mt-4">
                {page > 0 && (
                    <button onClick={() => setPage(p => p - 1)} className="px-4 py-2 bg-gray-800 rounded-lg text-gray-300 text-sm">← Назад</button>
                )}
                {sessions.length === 50 && (
                    <button onClick={() => setPage(p => p + 1)} className="px-4 py-2 bg-gray-800 rounded-lg text-gray-300 text-sm">Далі →</button>
                )}
            </div>
        </div>
    );
}
