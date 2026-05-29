import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

export function Users() {
    const [users, setUsers] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [loading, setLoading] = useState(true);

    const LIMIT = 50;

    const load = useCallback((p, q) => {
        setLoading(true);
        api.getUsers(p, q)
            .then(res => {
                const data = res?.data ?? res ?? [];
                const meta = res?.meta ?? {};
                setUsers(data);
                setTotal(meta.total ?? data.length);
            })
            .catch(() => setUsers([]))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(page, search); }, [page, search, load]);

    const handleSearch = (e) => {
        e.preventDefault();
        setPage(0);
        setSearch(searchInput.trim());
    };

    const clearSearch = () => {
        setSearchInput('');
        setSearch('');
        setPage(0);
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-semibold text-white">
                    Підписники
                    {total > 0 && <span className="ml-2 text-sm text-gray-500 font-normal">{total}</span>}
                </h1>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                <input
                    type="text"
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    placeholder="Пошук за ім'ям або @username..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand"
                />
                <button
                    type="submit"
                    className="px-4 py-2 bg-brand/20 hover:bg-brand/30 text-brand-light rounded-lg text-sm transition-colors"
                >
                    Знайти
                </button>
                {search && (
                    <button
                        type="button"
                        onClick={clearSearch}
                        className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
                    >
                        ✕
                    </button>
                )}
            </form>

            {loading ? (
                <div className="text-gray-400">Завантаження...</div>
            ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-800">
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Ім'я</th>
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Username</th>
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Telegram ID</th>
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Сесій</th>
                                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Реєстрація</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => {
                                const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || '—';
                                const photoUrl = user.metadata?.photoFileId
                                    ? `/api/users/${user.id}/photo`
                                    : null;
                                const initials = (user.firstName?.[0] || user.username?.[0] || '?').toUpperCase();
                                return (
                                <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full shrink-0 overflow-hidden bg-brand/20 flex items-center justify-center text-brand text-sm font-bold">
                                                {photoUrl
                                                    ? <img src={photoUrl} alt="" className="w-full h-full object-cover" onError={e => { e.target.style.display='none'; }} />
                                                    : initials}
                                            </div>
                                            <span className="text-sm text-white">{fullName}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-400">
                                        {user.username ? `@${user.username}` : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm font-mono text-gray-400">{String(user.telegramId)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-sm ${(user._count?.sessions ?? 0) > 0 ? 'text-white font-medium' : 'text-gray-500'}`}>
                                            {user._count?.sessions ?? 0}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-500">
                                        {user.createdAt ? format(new Date(user.createdAt), 'dd.MM.yyyy') : ''}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1.5 justify-end">
                                            <Link
                                                to={`/users/${user.id}`}
                                                className="px-2 py-1 text-xs rounded border border-gray-700 text-gray-300 hover:bg-gray-800 whitespace-nowrap transition-colors"
                                            >
                                                Відкрити
                                            </Link>
                                            <Link
                                                to={`/users/${user.id}`}
                                                className="px-2 py-1 text-xs rounded border border-blue-800 text-blue-400 hover:bg-blue-900/30 whitespace-nowrap transition-colors"
                                            >
                                                Сесії →
                                            </Link>
                                        </div>
                                    </td>
                                </tr>
                                );
                            })}
                            {users.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                                        {search ? `Не знайдено за запитом "${search}"` : 'Немає підписників'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="flex items-center gap-2 mt-4">
                {page > 0 && (
                    <button onClick={() => setPage(p => p - 1)} className="px-4 py-2 bg-gray-800 rounded-lg text-gray-300 text-sm">
                        ← Назад
                    </button>
                )}
                {users.length === LIMIT && (
                    <button onClick={() => setPage(p => p + 1)} className="px-4 py-2 bg-gray-800 rounded-lg text-gray-300 text-sm">
                        Далі →
                    </button>
                )}
                {total > 0 && (
                    <span className="ml-auto text-xs text-gray-500">
                        {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} з {total}
                    </span>
                )}
            </div>
        </div>
    );
}
