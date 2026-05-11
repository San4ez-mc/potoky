import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';

const STATE_COLORS = {
    active: 'text-emerald-400 bg-emerald-900/30 border-emerald-800',
    completed: 'text-gray-400 bg-gray-900 border-gray-700',
    error: 'text-red-400 bg-red-900/30 border-red-800',
};

export function Sessions() {
    const { botId } = useParams();
    const [sessions, setSessions] = useState([]);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        const fetch = botId ? api.getBotSessions(botId, page) : api.getUsers(page).then(u => u);
        // For now just get all via admin
        api.getApiLogs({ page })
            .then(() => { })
            .catch(() => { });

        // Real sessions via bot
        (botId ? api.getBotSessions(botId, page) : Promise.resolve([]))
            .then(setSessions)
            .catch(() => setSessions([]))
            .finally(() => setLoading(false));
    }, [botId, page]);

    return (
        <div className="p-6">
            <h1 className="text-xl font-semibold text-white mb-4">
                {botId ? 'Сесії бота' : 'Всі сесії'}
            </h1>

            {loading ? (
                <div className="text-gray-400">Завантаження...</div>
            ) : (
                <div className="space-y-2">
                    {sessions.map(s => (
                        <Link
                            key={s.id}
                            to={`/sessions/${s.id}`}
                            className="block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl px-4 py-3 transition-colors"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATE_COLORS[s.isActive ? 'active' : 'completed'] || STATE_COLORS.completed}`}>
                                        {s.isActive ? 'активна' : 'завершена'}
                                    </span>
                                    <span className="text-sm text-white font-mono">{s.id.slice(0, 8)}…</span>
                                    <span className="text-sm text-gray-400">{s.state}</span>
                                </div>
                                <span className="text-xs text-gray-500">
                                    {s.updatedAt ? format(new Date(s.updatedAt), 'dd.MM.yyyy HH:mm') : ''}
                                </span>
                            </div>
                        </Link>
                    ))}
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
