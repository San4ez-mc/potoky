import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';

function EditInfoModal({ isOpen, bot, onClose, onSaved }) {
    const [form, setForm] = useState({ name: '', description: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const textareaRef = useRef(null);

    useEffect(() => {
        if (isOpen && bot) {
            setForm({ name: bot.name || '', description: bot.description || '' });
            setError('');
        }
    }, [isOpen, bot]);

    if (!isOpen || !bot) return null;

    const handleSave = async () => {
        if (!form.name.trim()) { setError('Назва обов\'язкова'); return; }
        setSaving(true);
        setError('');
        try {
            await api.updateBot(bot.id, form.name.trim(), form.description.trim());
            onSaved({ ...bot, name: form.name.trim(), description: form.description.trim() });
            onClose();
        } catch (e) {
            setError(e.message || 'Помилка збереження');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl shadow-black/40">
                <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-white">Інформація про воронку</h2>
                        <div className="text-xs text-gray-500 font-mono mt-0.5">/{bot.slug}</div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
                </div>
                <div className="p-5 space-y-3">
                    {error && (
                        <div className="rounded-lg bg-red-900/20 border border-red-900/40 px-3 py-2 text-sm text-red-300">{error}</div>
                    )}
                    <div>
                        <label className="mb-1 block text-sm text-gray-300">Назва</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm text-gray-300">Опис воронки</label>
                        <textarea
                            ref={textareaRef}
                            value={form.description}
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            rows={4}
                            placeholder="Для кого ця воронка, що вона робить, коли запускається..."
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand focus:outline-none resize-none"
                        />
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
                        >
                            {saving ? 'Збереження...' : 'Зберегти'}
                        </button>
                        <button
                            onClick={onClose}
                            className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
                        >
                            Скасувати
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Modal({ isOpen, title, children, onClose }) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl shadow-black/40">
                <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
                    <h2 className="text-base font-semibold text-white">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>
    );
}

function slugify(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9а-яіїєґ\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100);
}

const relTime = (d) => {
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 3600000) return Math.floor(diff / 60000) + 'хв';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'год';
    return Math.floor(diff / 86400000) + 'д';
};

const CHANNEL_EMOJI = { telegram: '✈️', instagram: '📸', webhook: '🔗' };

const FILTER_STORAGE_KEY = 'botsListFilters';

function loadSavedFilters() {
    try {
        const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return null;
}

export function Bots() {
    const savedFilters = loadSavedFilters();
    const [projects, setProjects] = useState([]);
    const [rows, setRows] = useState([]);
    const [projectFilter, setProjectFilter] = useState(savedFilters?.projectFilter ?? 'all');
    const [searchQuery, setSearchQuery] = useState(savedFilters?.searchQuery ?? '');
    const [nameSort, setNameSort] = useState(savedFilters?.nameSort ?? 'asc');
    const [dateSort, setDateSort] = useState(savedFilters?.dateSort ?? null); // null | 'asc' | 'desc'
    const [channelFilter, setChannelFilter] = useState(savedFilters?.channelFilter ?? 'all');
    const [botLabelFilter, setBotLabelFilter] = useState(savedFilters?.botLabelFilter ?? '');
    const [showSystemBots, setShowSystemBots] = useState(savedFilters?.showSystemBots ?? false);
    const [showArchived, setShowArchived] = useState(savedFilters?.showArchived ?? false);
    const [loading, setLoading] = useState(true);
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');
    const [createForm, setCreateForm] = useState({ projectId: '', name: '', slug: '', description: '' });
    const [editInfoBot, setEditInfoBot] = useState(null);
    const [archiveConfirm, setArchiveConfirm] = useState(null); // botId being confirmed
    const navigate = useNavigate();
    const searchRef = useRef(null);

    // Focus search on "/" keypress
    useEffect(() => {
        const handler = (e) => {
            if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                e.preventDefault();
                searchRef.current?.focus();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    // Persist filters to sessionStorage whenever they change
    useEffect(() => {
        try {
            sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
                projectFilter, searchQuery, nameSort, dateSort, channelFilter, botLabelFilter, showSystemBots, showArchived,
            }));
        } catch { /* ignore */ }
    }, [projectFilter, searchQuery, nameSort, dateSort, channelFilter, botLabelFilter, showSystemBots, showArchived]);

    const fetchData = () => {
        return api.getProjects()
            .then(async (projs) => {
                const withBots = await Promise.all(
                    projs.map(async (p) => ({
                        ...p,
                        bots: await api.getProjectBots(p.id).catch(() => []),
                    }))
                );
                setProjects(withBots.map(p => ({ id: p.id, name: p.name, slug: p.slug })));

                const allRows = withBots.flatMap((project) =>
                    (project.bots || []).map((bot) => ({
                        ...bot,
                        projectId: project.id,
                        projectName: project.name,
                        projectSlug: project.slug,
                    }))
                );
                setRows(allRows);
            });
    };

    useEffect(() => {
        fetchData().finally(() => setLoading(false));
    }, []);

    // Toggle name sort (remove date sort when clicking name)
    const toggleNameSort = () => {
        setDateSort(null);
        setNameSort(prev => prev === 'asc' ? 'desc' : 'asc');
    };

    // Toggle date sort (remove name sort when clicking date)
    const toggleDateSort = () => {
        setNameSort(null);
        setDateSort(prev => prev === 'desc' ? 'asc' : 'desc');
    };

    const filteredRows = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const labelQuery = botLabelFilter.trim().toLowerCase();

        let result = projectFilter === 'all' ? rows : rows.filter(r => r.projectId === projectFilter);

        // Show/hide archived (isActive=false)
        if (!showArchived) result = result.filter(r => r.isActive !== false);

        // Hide system bots by default
        if (!showSystemBots) result = result.filter(r => r.settings?.isSystem !== true);

        // Channel filter
        if (channelFilter !== 'all') {
            result = result.filter(r => (r.channels || []).includes(channelFilter));
        }

        // Bot label filter
        if (labelQuery) {
            result = result.filter(r => (r.botLabel || '').toLowerCase().includes(labelQuery));
        }

        // Search
        if (query) {
            result = result.filter(r =>
                String(r.name || '').toLowerCase().includes(query) ||
                String(r.slug || '').toLowerCase().includes(query)
            );
        }

        return [...result].sort((a, b) => {
            // System bots always sort last
            const aSystem = a.settings?.isSystem === true;
            const bSystem = b.settings?.isSystem === true;
            if (aSystem !== bSystem) return aSystem ? 1 : -1;

            if (dateSort) {
                const aDate = a.metrics?.flowUpdatedAt ? new Date(a.metrics.flowUpdatedAt).getTime() : 0;
                const bDate = b.metrics?.flowUpdatedAt ? new Date(b.metrics.flowUpdatedAt).getTime() : 0;
                return dateSort === 'desc' ? bDate - aDate : aDate - bDate;
            }

            if (nameSort) {
                const left = String(a.name || '').toLowerCase();
                const right = String(b.name || '').toLowerCase();
                const comparison = left.localeCompare(right, 'uk');
                return nameSort === 'desc' ? -comparison : comparison;
            }

            return 0;
        });
    }, [rows, projectFilter, searchQuery, nameSort, dateSort, channelFilter, botLabelFilter, showSystemBots]);

    const openCreateModal = () => {
        const initialProjectId = projectFilter !== 'all' ? projectFilter : (projects[0]?.id || '');
        setCreateForm({ projectId: initialProjectId, name: '', slug: '', description: '' });
        setCreateError('');
        setCreateModalOpen(true);
    };

    const closeCreateModal = () => {
        setCreateModalOpen(false);
        setCreateError('');
        setCreating(false);
    };

    const handleCreateFunnel = async () => {
        const projectId = createForm.projectId || (projectFilter !== 'all' ? projectFilter : '');
        if (!projectId) { setCreateError('Оберіть проєкт'); return; }
        if (!createForm.name.trim()) { setCreateError('Назва воронки обов\'язкова'); return; }
        const slug = createForm.slug.trim() || slugify(createForm.name);
        if (!slug) { setCreateError('Slug не може бути порожнім'); return; }

        setCreating(true);
        setCreateError('');
        try {
            const created = await api.createFunnel(projectId, {
                name: createForm.name.trim(),
                slug,
                description: createForm.description.trim() || undefined,
            });
            closeCreateModal();
            await fetchData();
            navigate(`/funnel/${created.id}`);
        } catch (error) {
            setCreateError(error.message || 'Не вдалося створити воронку');
        } finally {
            setCreating(false);
        }
    };

    const handleEditInfoSaved = (updated) => {
        setRows(prev => prev.map(r => r.id === updated.id ? { ...r, name: updated.name, description: updated.description } : r));
    };

    const handleArchive = async (bot) => {
        const isArchiving = bot.isActive !== false;
        try {
            if (isArchiving) {
                await api.archiveBot(bot.id);
            } else {
                await api.unarchiveBot(bot.id);
            }
            setRows(prev => prev.map(r => r.id === bot.id ? { ...r, isActive: !isArchiving } : r));
        } catch (e) {
            alert('Помилка: ' + (e.message || 'невідома'));
        } finally {
            setArchiveConfirm(null);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-full">
            <div className="text-gray-400">Завантаження...</div>
        </div>
    );

    const SortArrow = ({ active, dir }) => (
        <span className={`ml-1 text-[10px] ${active ? 'text-brand' : 'text-gray-600'}`}>
            {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
    );

    return (
        <div className="p-4 md:p-6 space-y-4 md:space-y-5">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-white">Воронки</h1>
                    <p className="text-sm text-gray-400">Список усіх воронок з основними показниками.</p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="px-4 py-2 rounded-lg bg-brand hover:bg-brand/90 text-white text-sm font-medium transition-colors shrink-0"
                >
                    + Нова воронка
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-end">
                {/* Search */}
                <div className="flex-1 min-w-[180px] max-w-xs">
                    <label className="text-xs text-gray-500 block mb-1">Пошук <span className="text-gray-600 font-mono">/</span></label>
                    <input
                        ref={searchRef}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Назва або slug..."
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand"
                    />
                </div>

                {/* Project filter */}
                <div className="flex-1 min-w-[160px] max-w-xs">
                    <label className="text-xs text-gray-500 block mb-1">Проєкт</label>
                    <select
                        value={projectFilter}
                        onChange={(e) => setProjectFilter(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                    >
                        <option value="all">Всі проєкти</option>
                        {projects.map(project => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                    </select>
                </div>

                {/* Channel filter */}
                <div className="min-w-[150px]">
                    <label className="text-xs text-gray-500 block mb-1">Канал</label>
                    <select
                        value={channelFilter}
                        onChange={(e) => setChannelFilter(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                    >
                        <option value="all">Всі канали</option>
                        <option value="telegram">✈️ Telegram</option>
                        <option value="instagram">📸 Instagram</option>
                        <option value="webhook">🔗 Webhook</option>
                    </select>
                </div>

                {/* Bot label filter */}
                <div className="min-w-[160px] max-w-xs">
                    <label className="text-xs text-gray-500 block mb-1">Фільтр за ботом</label>
                    <select
                        value={botLabelFilter}
                        onChange={(e) => setBotLabelFilter(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                    >
                        <option value="">Усі боти</option>
                        {[...new Set(rows.map(r => r.botLabel).filter(Boolean))].sort().map(lbl => (
                            <option key={lbl} value={lbl}>{lbl}</option>
                        ))}
                    </select>
                </div>

                {/* System bots checkbox */}
                <div className="flex items-center self-end pb-2">
                    <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none hover:text-gray-200 transition-colors">
                        <input
                            type="checkbox"
                            checked={showSystemBots}
                            onChange={(e) => setShowSystemBots(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-brand focus:ring-brand focus:ring-offset-gray-900"
                            title="Системні воронки обробляють /start без параметра і не відображаються в основному списку"
                        />
                        Показати системні
                    </label>
                </div>

                {/* Archived checkbox */}
                <div className="flex items-center self-end pb-2">
                    <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none hover:text-gray-200 transition-colors">
                        <input
                            type="checkbox"
                            checked={showArchived}
                            onChange={(e) => setShowArchived(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-brand focus:ring-brand focus:ring-offset-gray-900"
                        />
                        Показати архівовані
                    </label>
                </div>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
                {filteredRows.length === 0 && (
                    <div className="py-12 text-center text-gray-500 text-sm">Немає воронок за обраним фільтром</div>
                )}
                {filteredRows.map((bot) => {
                    const activeSessions = bot.metrics?.activeSessions ?? 0;
                    const errors = bot.metrics?.unresolvedErrors ?? 0;
                    const updatedAt = bot.metrics?.flowUpdatedAt;
                    return (
                        <div
                            key={bot.id}
                            className={`bg-gray-900 border border-gray-800 rounded-xl p-2.5 space-y-1.5 ${bot.isActive === false ? 'opacity-50' : ''}`}
                        >
                            {/* Name row */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="font-medium text-white text-sm flex items-center gap-1.5 flex-wrap">
                                        {bot.name}
                                        {bot.settings?.isSystem && <span className="px-1 py-0.5 rounded text-[9px] bg-gray-700 text-gray-400 border border-gray-600">sys</span>}
                                        {bot.botLabel && <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-900/30 border border-blue-800/50 text-blue-300">{bot.botLabel}</span>}
                                    </div>
                                    <div className="text-[11px] text-gray-500 font-mono mt-0.5">/{bot.slug}</div>
                                    <div className="text-xs text-gray-500 mt-0.5">{bot.projectName}</div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    {(bot.channels || []).map(ch => (
                                        <span key={ch} className="text-base">{CHANNEL_EMOJI[ch] || '📡'}</span>
                                    ))}
                                </div>
                            </div>
                            {/* Stats row */}
                            <div className="flex items-center gap-3 text-xs text-gray-400">
                                <span>👥 {bot.metrics?.usersCount ?? 0}</span>
                                <span>💬 {bot.metrics?.totalSessions ?? 0}</span>
                                {activeSessions > 0 && <span className="text-emerald-400">● {activeSessions} активних</span>}
                                {errors > 0 && <span className="text-red-400 font-semibold">⚠ {errors} помилок</span>}
                                {updatedAt && <span className="text-gray-600 ml-auto">{relTime(updatedAt)} тому</span>}
                            </div>
                            {/* Actions */}
                            <div className="flex flex-wrap gap-2">
                                {bot.isActive === false ? (
                                    <button onClick={() => handleArchive(bot)} className="flex-1 px-3 py-2 bg-emerald-900/30 text-emerald-400 text-xs rounded-lg border border-emerald-800/40">↩ Відновити</button>
                                ) : archiveConfirm === bot.id ? (
                                    <>
                                        <button onClick={() => handleArchive(bot)} className="flex-1 px-3 py-2 bg-orange-900/50 text-orange-300 text-xs rounded-lg border border-orange-800/50">Підтвердити архів</button>
                                        <button onClick={() => setArchiveConfirm(null)} className="px-3 py-2 bg-gray-800 text-gray-400 text-xs rounded-lg">✕</button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => navigate(`/funnel/${bot.id}`)} className="flex-1 px-3 py-2 bg-brand/20 text-brand-light text-xs rounded-lg font-medium">Редагувати</button>
                                        <button onClick={() => navigate(`/bots/${bot.id}/sessions`)} className="px-3 py-2 bg-gray-800 text-gray-300 text-xs rounded-lg">Сесії</button>
                                        <button onClick={() => navigate(`/funnel/${bot.id}/analytics`)} className="px-3 py-2 bg-gray-800 text-gray-300 text-xs rounded-lg">📊</button>
                                        <button onClick={() => setEditInfoBot(bot)} className="px-3 py-2 bg-gray-800 text-gray-300 text-xs rounded-lg">ℹ</button>
                                        <button onClick={() => setArchiveConfirm(bot.id)} className="px-3 py-2 bg-gray-800 text-gray-500 text-xs rounded-lg">📦</button>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
                <div className="px-1 py-2 text-xs text-gray-500">Всього воронок: {filteredRows.length}</div>
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
                <table className="w-full min-w-[1040px]">
                    <thead>
                        <tr className="border-b border-gray-800 bg-gray-950/70">
                            <th className="text-left px-4 py-1.5 text-xs text-gray-400 font-medium">
                                <button
                                    onClick={toggleNameSort}
                                    className="flex items-center hover:text-gray-200 transition-colors"
                                >
                                    Воронка
                                    <SortArrow active={!!nameSort && !dateSort} dir={nameSort} />
                                </button>
                            </th>
                            <th className="text-left px-4 py-1.5 text-xs text-gray-400 font-medium">Проєкт</th>
                            <th className="text-left px-4 py-1.5 text-xs text-gray-400 font-medium">Канали</th>
                            <th className="text-left px-4 py-1.5 text-xs text-gray-400 font-medium">Користувачі</th>
                            <th className="text-left px-4 py-1.5 text-xs text-gray-400 font-medium">Сесії</th>
                            <th className="text-left px-4 py-1.5 text-xs text-gray-400 font-medium">Активні</th>
                            <th className="text-left px-4 py-1.5 text-xs text-gray-400 font-medium">Помилки</th>
                            <th className="text-left px-4 py-1.5 text-xs text-gray-400 font-medium">
                                <button
                                    onClick={toggleDateSort}
                                    className="flex items-center hover:text-gray-200 transition-colors"
                                >
                                    Оновлено
                                    <SortArrow active={!!dateSort} dir={dateSort} />
                                </button>
                            </th>
                            <th className="px-4 py-1.5" />
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRows.map((bot) => {
                            const activeSessions = bot.metrics?.activeSessions ?? 0;
                            const errors = bot.metrics?.unresolvedErrors ?? 0;
                            const updatedAt = bot.metrics?.flowUpdatedAt;

                            return (
                                <tr
                                    key={bot.id}
                                    className={`border-b border-gray-800/60 hover:bg-gray-800/20 transition-colors align-middle ${bot.settings?.isSystem ? 'opacity-60' : ''} ${bot.isActive === false ? 'opacity-40' : ''}`}
                                >
                                    <td className="px-4 py-1.5" style={{ maxWidth: '260px' }}>
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="font-medium text-white text-sm truncate" title={bot.name}>{bot.name}</span>
                                            {bot.settings?.isSystem && (
                                                <span title="Системна воронка" className="shrink-0 px-1 py-0.5 rounded text-[9px] bg-gray-700 text-gray-400 border border-gray-600">sys</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className="text-[11px] text-gray-500 font-mono truncate">/{bot.slug}</span>
                                            {bot.botLabel && (
                                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-blue-900/30 border border-blue-800/50 text-blue-300">{bot.botLabel}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-1.5 text-xs text-gray-400 whitespace-nowrap">{bot.projectName}</td>
                                    <td className="px-4 py-1.5">
                                        <div className="flex gap-1 flex-wrap">
                                            {(bot.channels || []).map(ch => (
                                                <span key={ch} title={ch} className="text-base leading-none">{CHANNEL_EMOJI[ch] || '📡'}</span>
                                            ))}
                                            {(!bot.channels || bot.channels.length === 0) && <span className="text-gray-600 text-xs">—</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-1.5 text-sm text-gray-300">{bot.metrics?.usersCount ?? 0}</td>
                                    <td className="px-4 py-1.5 text-sm text-gray-300">{bot.metrics?.totalSessions ?? 0}</td>
                                    <td className="px-4 py-1.5 text-sm">
                                        <span className={activeSessions > 0 ? 'text-emerald-400 font-medium' : 'text-gray-500'}>{activeSessions}</span>
                                    </td>
                                    <td className="px-4 py-1.5 text-sm">
                                        {errors > 0 ? (
                                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-red-900/40 text-red-400 border border-red-800/50">{errors}</span>
                                        ) : <span className="text-gray-600">—</span>}
                                    </td>
                                    <td className="px-4 py-1.5 text-xs text-gray-500 whitespace-nowrap">
                                        {updatedAt ? (
                                            <>
                                                <div>{format(new Date(updatedAt), 'dd.MM.yy HH:mm')}</div>
                                                <div className="text-gray-600">{relTime(updatedAt)} тому</div>
                                            </>
                                        ) : '—'}
                                    </td>
                                    <td className="px-4 py-1.5">
                                        <div className="flex justify-end gap-2 flex-wrap">
                                            {bot.isActive === false ? (
                                                <button onClick={() => handleArchive(bot)} className="px-3 py-1.5 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 text-xs rounded-lg transition-colors border border-emerald-800/40">↩ Відновити</button>
                                            ) : archiveConfirm === bot.id ? (
                                                <>
                                                    <button onClick={() => handleArchive(bot)} className="px-3 py-1.5 bg-orange-900/50 hover:bg-orange-900/70 text-orange-300 text-xs rounded-lg transition-colors border border-orange-800/50">Підтвердити</button>
                                                    <button onClick={() => setArchiveConfirm(null)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition-colors">✕</button>
                                                </>
                                            ) : (
                                                <>
                                                    <button onClick={() => setEditInfoBot(bot)} title={bot.description || 'Інфо / опис'} className="w-7 h-7 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">ℹ️</button>
                                                    <button onClick={() => navigate(`/funnel/${bot.id}`)} title="Редагувати" className="w-7 h-7 flex items-center justify-center bg-brand/20 hover:bg-brand/30 text-brand-light text-sm rounded-lg transition-colors">✏️</button>
                                                    <button onClick={() => navigate(`/bots/${bot.id}/sessions`)} title="Сесії" className="w-7 h-7 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">💬</button>
                                                    <button onClick={() => navigate(`/funnel/${bot.id}/analytics`)} title="Аналітика" className="w-7 h-7 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">📊</button>
                                                    <button onClick={() => setArchiveConfirm(bot.id)} title="Архівувати" className="w-7 h-7 flex items-center justify-center bg-gray-800 hover:bg-orange-900/30 text-gray-500 hover:text-orange-400 text-sm rounded-lg transition-colors">📦</button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredRows.length === 0 && (
                            <tr>
                                <td colSpan={9} className="px-4 py-12 text-center text-gray-500 text-sm">Немає воронок за обраним фільтром</td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-800 flex items-center justify-between">
                    <span>Всього воронок: {filteredRows.length}</span>
                    {!showSystemBots && rows.some(r => r.settings?.isSystem) && (
                        <span className="text-gray-600">+ {rows.filter(r => r.settings?.isSystem).length} системних (приховано)</span>
                    )}
                </div>
            </div>

            <EditInfoModal
                isOpen={!!editInfoBot}
                bot={editInfoBot}
                onClose={() => setEditInfoBot(null)}
                onSaved={handleEditInfoSaved}
            />

            <Modal
                isOpen={createModalOpen}
                title="Нова воронка"
                onClose={closeCreateModal}
            >
                <div className="space-y-3">
                    {createError && (
                        <div className="rounded-lg bg-red-900/20 border border-red-900/40 px-3 py-2 text-sm text-red-300">
                            {createError}
                        </div>
                    )}

                    <div>
                        <label className="mb-1 block text-sm text-gray-300">Проєкт</label>
                        <select
                            value={createForm.projectId}
                            onChange={(e) => setCreateForm({ ...createForm, projectId: e.target.value })}
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
                        >
                            <option value="">Оберіть проєкт</option>
                            {projects.map((project) => (
                                <option key={project.id} value={project.id}>{project.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="mb-1 block text-sm text-gray-300">Назва</label>
                        <input
                            type="text"
                            value={createForm.name}
                            onChange={(e) => setCreateForm((prev) => ({
                                ...prev,
                                name: e.target.value,
                                slug: prev.slug || slugify(e.target.value),
                            }))}
                            placeholder="Наприклад: Bot 6.1 New Funnel"
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="mb-1 block text-sm text-gray-300">Slug</label>
                        <input
                            type="text"
                            value={createForm.slug}
                            onChange={(e) => setCreateForm({ ...createForm, slug: slugify(e.target.value) })}
                            placeholder="new-funnel-slug"
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="mb-1 block text-sm text-gray-300">Опис</label>
                        <textarea
                            value={createForm.description}
                            onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                            rows={3}
                            placeholder="Необов'язково"
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand focus:outline-none resize-none"
                        />
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button
                            onClick={handleCreateFunnel}
                            disabled={creating}
                            className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
                        >
                            {creating ? 'Створення...' : 'Створити'}
                        </button>
                        <button
                            onClick={closeCreateModal}
                            className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
                        >
                            Скасувати
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
