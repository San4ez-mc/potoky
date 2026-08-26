import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';
import { UserPhoto } from '../components/UserPhoto.jsx';

// ─── localStorage helpers for read-tracking ─────────────────────────────────
const STORAGE_KEY = 'sessions_read_at';

function getReadMap() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function markSessionsRead(ids) {
    const map = getReadMap();
    const now = Date.now();
    ids.forEach(id => { map[id] = now; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}
export function markOneSessionRead(id) { markSessionsRead([id]); }
function countUnread(session, readMap) {
    const readAt = readMap[session.id] || 0;
    return (session.messages || []).filter(
        m => m.role === 'user' && new Date(m.createdAt).getTime() > readAt
    ).length;
}

// Компактний пейджер зі сторінками (замість "Далі" за евристикою sessions.length===50) —
// використовує meta.total/meta.limit, які бекенд і так завжди повертає (admin.js/funnels.js).
function buildPageWindow(current, totalPages) {
    // сторінки навколо поточної (±2) + перша/остання, з '…' між розривами
    const pages = new Set([0, totalPages - 1, current - 2, current - 1, current, current + 1, current + 2]);
    const sorted = [...pages].filter(p => p >= 0 && p < totalPages).sort((a, b) => a - b);
    const result = [];
    let prev = null;
    for (const p of sorted) {
        if (prev !== null && p - prev > 1) result.push('…');
        result.push(p);
        prev = p;
    }
    return result;
}

function SessionsPager({ page, meta, loading, onPageChange }) {
    const limit = meta.limit || 50;
    const total = meta.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    if (total === 0) return null;

    const goTo = (p) => {
        if (p < 0 || p >= totalPages || p === page || loading) return;
        onPageChange(p);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <div className="text-xs text-gray-500">
                Сторінка {page + 1} з {totalPages} · показано {Math.min(limit, total - page * limit)} з {total}
            </div>
            <div className="flex items-center gap-1">
                <button
                    onClick={() => goTo(page - 1)}
                    disabled={page === 0 || loading}
                    className="px-3 py-1.5 bg-gray-800 rounded-lg text-gray-300 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-700"
                >
                    ← Назад
                </button>
                {buildPageWindow(page, totalPages).map((p, i) =>
                    p === '…' ? (
                        <span key={`ellipsis-${i}`} className="px-2 text-gray-600 text-sm select-none">…</span>
                    ) : (
                        <button
                            key={p}
                            onClick={() => goTo(p)}
                            disabled={loading}
                            className={`min-w-[32px] px-2 py-1.5 rounded-lg text-sm transition-colors ${
                                p === page ? 'bg-brand/20 text-brand-light font-medium' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                            }`}
                        >
                            {p + 1}
                        </button>
                    )
                )}
                <button
                    onClick={() => goTo(page + 1)}
                    disabled={page >= totalPages - 1 || loading}
                    className="px-3 py-1.5 bg-gray-800 rounded-lg text-gray-300 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-700"
                >
                    Далі →
                </button>
            </div>
        </div>
    );
}

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
    const [sessionType, setSessionType] = useState('all');
    // #12: за замовчуванням показуємо лише справжні сесії (bot), webhook — це тести
    const [source, setSource] = useState('bot');
    const [readMap, setReadMap] = useState(() => getReadMap());
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');

    // Дебаунс: не смикаємо API на кожне натискання клавіші
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(0);
        }, 400);
        return () => clearTimeout(t);
    }, [searchInput]);

    const backTo = useMemo(() => {
        const params = new URLSearchParams();
        params.set('page', String(page));
        if (errorsOnly) params.set('hasErrors', 'true');
        if (sessionType !== 'all') params.set('sessionType', sessionType);
        if (search) params.set('search', search);
        return botId
            ? `/bots/${botId}/sessions?${params.toString()}`
            : `/sessions?${params.toString()}`;
    }, [botId, page, errorsOnly, sessionType, search]);

    const buildFilters = () => {
        const filters = {};
        if (errorsOnly) filters.hasErrors = 'true';
        if (sessionType === 'test') filters.isTest = 'true';
        else if (sessionType === 'real') filters.isTest = 'false';
        if (source !== 'all') filters.source = source;
        if (search) filters.search = search;
        return filters;
    };

    const loadSessions = () => {
        setLoading(true);
        const filters = buildFilters();

        const promise = botId
            ? api.getBotSessions(botId, page, filters)
            : api.getAllSessions({ page, ...filters });

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
    }, [botId, page, errorsOnly, sessionType, source, search]);

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

    const handleToggleTest = async (session) => {
        try {
            await api.markSessionTest(session.id, !session.isTest);
            setSessions(prev => prev.map(s => s.id === session.id ? { ...s, isTest: !session.isTest } : s));
        } catch (err) {
            console.error('Mark test failed:', err);
            alert(err.message || 'Не вдалося змінити мітку тесту');
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
        <div className="p-4 md:p-6 w-full max-w-none">
            <div className="mb-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold text-white">
                            {botId ? 'Сесії бота' : 'Всі сесії'}
                        </h1>
                        {meta.total > 0 && <div className="text-sm text-gray-500 mt-0.5">Всього: {meta.total}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => { markSessionsRead(sessions.map(s => s.id)); setReadMap(getReadMap()); }}
                            title="Позначити всі сесії на цій сторінці як прочитані"
                            className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800"
                        >
                            ✓ Прочитано
                        </button>
                        <button
                            onClick={handleDeleteBulk}
                            disabled={selectedIds.length === 0 || deleting}
                            className="px-3 py-1.5 text-xs rounded-lg border border-red-800 text-red-400 hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            🗑 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
                        </button>
                    </div>
                </div>
                <div className="relative">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Пошук за іменем, username або текстом переписки…"
                        className="w-full px-3 py-2 pl-9 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
                    {searchInput && (
                        <button
                            onClick={() => setSearchInput('')}
                            title="Очистити пошук"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-sm px-1"
                        >✕</button>
                    )}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                    {/* Type radio */}
                    <div className="flex items-center rounded-lg border border-gray-700 overflow-hidden text-xs">
                        {[['all', 'Всі'], ['real', 'Справжні'], ['test', 'Тест']].map(([val, label]) => (
                            <button key={val} onClick={() => { setPage(0); setSessionType(val); }}
                                className={`px-3 py-1.5 transition-colors ${sessionType === val ? 'bg-brand/20 text-brand-light' : 'text-gray-300 hover:bg-gray-800'}`}>
                                {label}
                            </button>
                        ))}
                    </div>
                    {/* Source radio */}
                    <div className="flex items-center rounded-lg border border-gray-700 overflow-hidden text-xs">
                        {[['all', 'Всі'], ['bot', 'TG'], ['instagram', 'IG'], ['webhook', 'API']].map(([val, label]) => (
                            <button key={val} onClick={() => { setPage(0); setSource(val); }}
                                className={`px-3 py-1.5 transition-colors ${source === val ? 'bg-brand/20 text-brand-light' : 'text-gray-300 hover:bg-gray-800'}`}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => { setPage(0); setErrorsOnly(v => !v); }}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${errorsOnly ? 'border-amber-700 text-amber-300 bg-amber-900/20' : 'border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                    >
                        З помилками{errorsOnly ? ' ✓' : ''}
                    </button>
                    <label className="text-xs text-gray-400 flex items-center gap-2 ml-auto">
                        <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} className="rounded border-gray-600 bg-gray-800" />
                        Всі
                    </label>
                </div>
            </div>

            {loading ? (
                <div className="text-gray-400">Завантаження...</div>
            ) : (
                <div className="w-full rounded-xl border border-gray-800 overflow-hidden bg-gray-900">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs" style={{ minWidth: '700px' }}>
                            <thead className="bg-gray-950 border-b border-gray-800 text-[11px] uppercase tracking-wider text-gray-500">
                                <tr>
                                    <th className="px-2 py-2 text-left w-6"></th>
                                    <th className="px-2 py-2 text-left w-4"></th>
                                    <th className="px-2 py-2 text-left w-24">Статус</th>
                                    <th className="px-2 py-2 text-left">Користувач</th>
                                    <th className="px-2 py-2 text-left w-36">Бот</th>
                                    <th className="px-2 py-2 text-left w-32">Стан</th>
                                    <th className="px-2 py-2 text-right w-16">Пов./API</th>
                                    <th className="px-2 py-2 text-right w-10">Пом.</th>
                                    <th className="px-2 py-2 text-right w-10">Нові</th>
                                    <th className="px-2 py-2 text-left w-20">Остання акт.</th>
                                    <th className="px-2 py-2 text-right w-20">Дії</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((s) => {
                                    const fullName = [s.user?.firstName || '', s.user?.lastName || '']
                                        .filter(Boolean).join(' ') || s.user?.username || `id:${s.user?.telegramId || '?'}`;
                                    const tgHandle = s.user?.username ? `@${s.user.username}` : null;
                                    const tgId = s.user?.telegramId ? `ID: ${s.user.telegramId}` : null;
                                    const msgCount = s._count?.messages ?? 0;
                                    const apiCount = s._count?.apiCalls ?? 0;
                                    const errCount = s._count?.errors ?? 0;
                                    const isSelected = selectedIds.includes(s.id);
                                    const unreadCount = countUnread(s, readMap);
                                    const unread = unreadCount > 0;

                                    return (
                                        <tr key={s.id} className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors ${isSelected ? 'bg-blue-900/10' : ''} ${unread ? 'bg-blue-950/20' : ''}`}>
                                            {/* Checkbox */}
                                            <td className="px-2 py-2 align-middle">
                                                <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(s.id)}
                                                    className="rounded border-gray-600 bg-gray-800" />
                                            </td>
                                            {/* placeholder — unread badge moved to its own column after errors */}
                                            <td className="px-1 py-2 align-middle"></td>
                                            {/* Status */}
                                            <td className="px-2 py-2 align-middle">
                                                <span className={`inline-flex text-[11px] px-1.5 py-0.5 rounded-full border ${s.isActive ? 'text-emerald-400 bg-emerald-900/30 border-emerald-800' : 'text-gray-500 border-gray-700'}`}>
                                                    {s.isActive ? 'активна' : 'завершена'}
                                                </span>
                                                {s.isTest && <span className="ml-1 inline-flex text-[11px] px-1.5 py-0.5 rounded-full border text-violet-400 border-violet-800">тест</span>}
                                            </td>
                                            {/* User */}
                                            <td className="px-2 py-2 align-middle max-w-0">
                                                <div className="flex items-center gap-2">
                                                    <UserPhoto
                                                        userId={s.user?.id}
                                                        initials={(s.user?.firstName?.[0] || s.user?.username?.[0] || '?').toUpperCase()}
                                                        size="w-7 h-7 text-xs"
                                                    />
                                                    <div className="min-w-0">
                                                        <div className={`text-sm font-medium truncate ${unread ? 'text-white' : 'text-gray-200'}`} title={fullName}>{fullName}</div>
                                                        <div className="text-[11px] text-gray-500 truncate">{[tgHandle, tgId].filter(Boolean).join(' · ')}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            {/* Bot */}
                                            <td className="px-2 py-2 align-middle text-[11px] text-gray-400 font-mono truncate max-w-0" title={s.bot?.slug}>
                                                {s.bot?.slug ? `/${s.bot.slug}` : '—'}
                                            </td>
                                            {/* State */}
                                            <td className="px-2 py-2 align-middle text-[11px] text-gray-500 font-mono truncate max-w-0" title={s.state || '—'}>{s.state || '—'}</td>
                                            {/* Counts */}
                                            <td className="px-2 py-2 align-middle text-right text-gray-400 whitespace-nowrap">{msgCount} / {apiCount}</td>
                                            {/* Errors */}
                                            <td className="px-2 py-2 align-middle text-right">
                                                {errCount > 0 ? (
                                                    <button onClick={() => handleOpenErrors(s)}
                                                        className="text-[11px] text-red-300 bg-red-900/30 border border-red-800 rounded-full px-1.5 py-0.5 hover:bg-red-900/50">
                                                        {errCount}
                                                    </button>
                                                ) : <span className="text-gray-700">0</span>}
                                            </td>
                                            {/* Unread count badge */}
                                            <td className="px-2 py-2 align-middle text-right">
                                                {unreadCount > 0 ? (
                                                    <span className="text-[11px] text-blue-300 bg-blue-900/40 border border-blue-700 rounded-full px-1.5 py-0.5">
                                                        {unreadCount}
                                                    </span>
                                                ) : <span className="text-gray-700">—</span>}
                                            </td>
                                            {/* Last activity date */}
                                            <td className="px-2 py-2 align-middle text-[11px] text-gray-500 whitespace-nowrap">
                                                {s.lastActive ? format(new Date(s.lastActive), 'dd.MM HH:mm') : s.startedAt ? format(new Date(s.startedAt), 'dd.MM HH:mm') : '—'}
                                            </td>
                                            {/* Actions */}
                                            <td className="px-2 py-2 align-middle">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button onClick={() => handleToggleTest(s)}
                                                        title={s.isTest ? 'Зняти мітку тесту' : 'Позначити як тест'}
                                                        className={`w-6 h-6 flex items-center justify-center rounded text-base transition-colors ${s.isTest ? 'text-violet-400 bg-violet-900/20' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-800'}`}>
                                                        🔬
                                                    </button>
                                                    <button onClick={() => handleDeleteOne(s)} disabled={deleting}
                                                        title="Видалити сесію"
                                                        className="w-6 h-6 flex items-center justify-center rounded text-base text-gray-600 hover:text-red-400 hover:bg-red-900/20 disabled:opacity-40">
                                                        🗑
                                                    </button>
                                                    <Link
                                                        to={`/sessions/${s.id}?back=${encodeURIComponent(backTo)}`}
                                                        onClick={() => { markSessionsRead([s.id]); setReadMap(getReadMap()); }}
                                                        className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 text-sm font-bold"
                                                        title="Відкрити сесію"
                                                    >→</Link>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {sessions.length === 0 && (
                        <div className="text-gray-500 py-8 text-center border-t border-gray-800">Немає сесій</div>
                    )}
                </div>
            )}

            <SessionsPager page={page} meta={meta} loading={loading} onPageChange={setPage} />

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
