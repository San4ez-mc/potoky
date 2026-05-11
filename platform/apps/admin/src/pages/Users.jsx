import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

export function Users() {
    const [users, setUsers] = useState([]);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        api.getUsers(page)
            .then(setUsers)
            .catch(() => setUsers([]))
            .finally(() => setLoading(false));
    }, [page]);

    return (
        <div className="p-6">
            <h1 className="text-xl font-semibold text-white mb-4">Юзери</h1>

            {loading ? (
                <div className="text-gray-400">Завантаження...</div>
            ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-800">
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Telegram ID</th>
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Ім'я</th>
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Username</th>
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Проєкт</th>
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Сесій</th>
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Реєстрація</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                                    <td className="px-4 py-3 text-sm font-mono text-gray-300">{String(user.telegramId)}</td>
                                    <td className="px-4 py-3 text-sm text-white">
                                        {[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-400">
                                        {user.username ? `@${user.username}` : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-400">{user.project?.name || '—'}</td>
                                    <td className="px-4 py-3 text-sm text-gray-400">{user._count?.sessions ?? 0}</td>
                                    <td className="px-4 py-3 text-xs text-gray-500">
                                        {user.createdAt ? format(new Date(user.createdAt), 'dd.MM.yyyy') : ''}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Link
                                            to={`/users/${user.id}`}
                                            className="text-xs text-brand-light hover:text-brand"
                                        >
                                            Деталі →
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                            {users.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-4 py-12 text-center text-gray-500">Немає юзерів</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="flex gap-2 mt-4">
                {page > 0 && <button onClick={() => setPage(p => p - 1)} className="px-4 py-2 bg-gray-800 rounded-lg text-gray-300 text-sm">← Назад</button>}
                {users.length === 50 && <button onClick={() => setPage(p => p + 1)} className="px-4 py-2 bg-gray-800 rounded-lg text-gray-300 text-sm">Далі →</button>}
            </div>
        </div>
    );
}
