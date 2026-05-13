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
    const [selectedIds, setSelectedIds] = useState([]);
    const [deleting, setDeleting] = useState(false);
    const [errorsModal, setErrorsModal] = useState(null);
    const [errorsOnly, setErrorsOnly] = useState(false);

    const loadSessions = () => {
        setLoading(true);

        const promise = botId
            ? api.getBotSessions(botId, page, errorsOnly ? { hasErrors: 'true' } : {})
            : api.getAllSessions({ page, ...(errorsOnly ? { hasErrors: 'true' } : {}) });

        return promise
            .then(res => {
                setSessions(res.data || []);
                setMeta(res.meta || { total: 0 });
                setSelectedIds([]);
            })
            .catch(err => {
                console.error('Failed to load sessions:', err);
                setSessions([]);
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadSessions();
    }, [botId, page, errorsOnly]);

    const visibleIds = sessions.map(s => s.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));

    const toggleSelected = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleSelectAllVisible = () => {
        if (allVisibleSelected) {
            setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
            return;
        }

        setSelectedIds(prev => {
            const merged = new Set([...prev, ...visibleIds]);
            return Array.from(merged);
        });
    };

    const handleDeleteOne = async (session) => {
        if (!window.confirm(`Видалити сесію ${session.id.slice(0, 8)}...?`)) return;
        setDeleting(true);
        try {
            await api.deleteSession(session.id);
            await loadSessions();
        } catch (err) {
            console.error('Delete session failed:', err);
            alert(err.message || 'Не вдалося видалити сесію');
        } finally {
            setDeleting(false);
        }
    };

    const handleDeleteBulk = async () => {
        if (selectedIds.length === 0) return;
        if (!window.confirm(`Видалити вибрані сесії: ${selectedIds.length} шт.?`)) return;
        setDeleting(true);
        try {
            await api.deleteSessionsBulk(selectedIds);
            await loadSessions();
        } catch (err) {
            console.error('Bulk delete sessions failed:', err);
            alert(err.message || 'Не вдалося видалити вибрані сесії');
        } finally {
            setDeleting(false);
        }
    };

    const handleOpenErrors = async (session) => {
        const fullName = [session.user?.firstName || '', session.user?.lastName || '']
            .filter(Boolean)
            .join(' ') || session.user?.username || `id:${session.user?.telegramId || '?'}`;

        setErrorsModal({
            sessionId: session.id,
            label: fullName,
            loading: true,
            appErrors: [],
            failedApiCalls: [],
        });

        try {
            const data = await api.getSessionErrors(session.id);
            setErrorsModal({
                sessionId: session.id,
                label: fullName,
                loading: false,
                appErrors: data.appErrors || [],
                failedApiCalls: data.failedApiCalls || [],
            });
        } catch (err) {
            console.error('Failed to load session errors:', err);
            setErrorsModal({
                sessionId: session.id,
                label: fullName,
                loading: false,
                appErrors: [],
                failedApiCalls: [],
                error: err.message || 'Не вдалося завантажити помилки',
            });
        }
    };

    return (
        <div className="p-6 max-w-5xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-xl font-semibold text-white">
                        {botId ? 'Сесії бота' : 'Всі сесії'}
                    </h1>
                    {meta.total > 0 && <div className="text-sm text-gray-500 mt-0.5">Всього: {meta.total}</div>}
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => { setPage(0); setErrorsOnly(v => !v); }}
                        className={`px-3 py-2 text-xs rounded-lg border transition-colors ${errorsOnly ? 'border-amber-700 text-amber-300 bg-amber-900/20' : 'border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                    >
                        {errorsOnly ? 'Лише з помилками: ON' : 'Лише з помилками'}
                    </button>
                    <label className="text-xs text-gray-400 flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            className="rounded border-gray-600 bg-gray-800"
                        />
                        Всі на сторінці
                    </label>
                    <button
                        onClick={handleDeleteBulk}
                        disabled={selectedIds.length === 0 || deleting}
                        className="px-3 py-2 text-sm rounded-lg border border-red-800 text-red-400 hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Видалити вибрані ({selectedIds.length})
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="text-gray-400">Завантаження...</div>
            ) : (
                <div className="space-y-2">
                    {sessions.map(s => {
                        const fullName = [
                            s.user?.firstName || '',
                            s.user?.lastName || ''
                        ].filter(Boolean).join(' ') || s.user?.username || `id:${s.user?.telegramId || '?'}`;
                        const tgHandle = s.user?.username || '—';
                        const tgId = s.user?.telegramId ? String(s.user.telegramId) : '—';
                        const msgCount = s._count?.messages ?? '—';
                        const apiCount = s._count?.apiCalls ?? '—';
                        const errCount = s._count?.errors ?? 0;
                        const isSelected = selectedIds.includes(s.id);
                        return (
                            <div
                                key={s.id}
                                className={`bg-gray-900 border rounded-xl px-4 py-3 transition-colors ${isSelected ? 'border-blue-600/60' : 'border-gray-800 hover:border-gray-600'}`}
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0 flex-wrap">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelected(s.id)}
                                            className="rounded border-gray-600 bg-gray-800"
                                        />
                                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${s.isActive ? 'text-emerald-400 bg-emerald-900/30 border-emerald-800' : 'text-gray-400 bg-gray-900 border-gray-700'}`}>
                                            {s.isActive ? 'активна' : 'завершена'}
                                        </span>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm text-white font-semibold truncate">{fullName}</span>
                                            <span className="text-xs text-gray-500 truncate">@{tgHandle} · ID: {tgId}</span>
                                        </div>
                                        {s.bot && (
                                            <span className="text-xs text-gray-500 font-mono shrink-0">/{s.bot.slug}</span>
                                        )}
                                        <span className="text-xs text-gray-600 shrink-0">💬 {msgCount} · 📡 {apiCount}</span>
                                        {errCount > 0 && (
                                            <span className="text-xs text-red-300 bg-red-900/30 border border-red-800 rounded-full px-2 py-0.5 shrink-0">⚠ {errCount}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-xs text-gray-500 shrink-0">
                                            {s.startedAt ? format(new Date(s.startedAt), 'dd.MM.yyyy HH:mm') : ''}
                                        </span>
                                        <button
                                            onClick={() => handleOpenErrors(s)}
                                            className="px-2.5 py-1 text-xs rounded border border-amber-800 text-amber-400 hover:bg-amber-900/30"
                                        >
                                            Помилки
                                        </button>
                                        <button
                                            onClick={() => handleDeleteOne(s)}
                                            disabled={deleting}
                                            className="px-2.5 py-1 text-xs rounded border border-red-800 text-red-400 hover:bg-red-900/30 disabled:opacity-50"
                                        >
                                            Видалити
                                        </button>
                                        <Link
                                            to={`/sessions/${s.id}`}
                                            className="px-2.5 py-1 text-xs rounded border border-gray-700 text-gray-300 hover:bg-gray-800"
                                        >
                                            Відкрити
                                        </Link>
                                    </div>
                                </div>
                                <div className="text-xs text-gray-600 mt-1 font-mono">{s.id.slice(0, 8)}…  стан: {s.state}</div>
                            </div>
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

            {errorsModal && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                    <div className="w-full max-w-3xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
                        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                            <div>
                                <h3 className="text-white font-semibold">Помилки сесії</h3>
                                <p className="text-xs text-gray-500 mt-0.5">{errorsModal.label} · {errorsModal.sessionId.slice(0, 8)}...</p>
                            </div>
                            <button onClick={() => setErrorsModal(null)} className="text-gray-400 hover:text-white text-xl leading-none">x</button>
                        </div>

                        <div className="p-5 overflow-y-auto space-y-5">
                            {errorsModal.loading && <div className="text-gray-400">Завантаження...</div>}
                            {!errorsModal.loading && errorsModal.error && (
                                <div className="text-red-400 text-sm">{errorsModal.error}</div>
                            )}

                            {!errorsModal.loading && !errorsModal.error && (
                                <>
                                    <div>
                                        <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">App Errors ({errorsModal.appErrors.length})</div>
                                        {errorsModal.appErrors.length === 0 ? (
                                            <div className="text-sm text-gray-500">Немає</div>
                                        ) : (
                                            <div className="space-y-2">
                                                {errorsModal.appErrors.map(err => (
                                                    <div key={err.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-[11px] px-2 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800">{err.errorType}</span>
                                                            <span className="text-[11px] text-gray-500">{format(new Date(err.createdAt), 'dd.MM.yyyy HH:mm:ss')}</span>
                                                        </div>
                                                        <div className="text-sm text-gray-200">{err.message}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Failed API Calls ({errorsModal.failedApiCalls.length})</div>
                                        {errorsModal.failedApiCalls.length === 0 ? (
                                            <div className="text-sm text-gray-500">Немає</div>
                                        ) : (
                                            <div className="space-y-2">
                                                {errorsModal.failedApiCalls.map(call => (
                                                    <div key={call.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-[11px] px-2 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800">{call.service}</span>
                                                            <span className="text-[11px] text-gray-500">{format(new Date(call.createdAt), 'dd.MM.yyyy HH:mm:ss')}</span>
                                                            {call.statusCode && (
                                                                <span className="text-[11px] text-red-400">HTTP {call.statusCode}</span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-gray-400 font-mono">{call.method}</div>
                                                        {call.error && (
                                                            <div className="text-xs text-red-300 mt-1 whitespace-pre-wrap">{call.error}</div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
