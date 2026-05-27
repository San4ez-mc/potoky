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
    const [showSystemBots, setShowSystemBots] = useState(savedFilters?.showSystemBots ?? false);
    const [loading, setLoading] = useState(true);
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');
    const [createForm, setCreateForm] = useState({ projectId: '', name: '', slug: '', description: '' });
    const [editInfoBot, setEditInfoBot] = useState(null);
    const navigate = useNavigate();

    // Persist filters to sessionStorage whenever they change
    useEffect(() => {
        try {
            sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ projectFilter, searchQuery, nameSort, showSystemBots }));
        } catch { /* ignore */ }
    }, [projectFilter, searchQuery, nameSort, showSystemBots]);

    useEffect(() => {
        api.getProjects()
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
            })
            .finally(() => setLoading(false));
    }, []);

    const filteredRows = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        const baseRows = projectFilter === 'all'
            ? rows
            : rows.filter((row) => row.projectId === projectFilter);

        // Hide system bots by default unless toggle is on
        const visibleRows = showSystemBots
            ? baseRows
            : baseRows.filter((row) => row.settings?.isSystem !== true);

        const searchedRows = query
            ? visibleRows.filter((row) =>
                String(row.name || '').toLowerCase().includes(query) ||
                String(row.slug || '').toLowerCase().includes(query)
            )
            : visibleRows;

        return [...searchedRows].sort((a, b) => {
            // System bots always sort last
            const aSystem = a.settings?.isSystem === true;
            const bSystem = b.settings?.isSystem === true;
            if (aSystem !== bSystem) return aSystem ? 1 : -1;

            const left = String(a.name || '').toLowerCase();
            const right = String(b.name || '').toLowerCase();
            const comparison = left.localeCompare(right, 'uk');
            return nameSort === 'desc' ? -comparison : comparison;
        });
    }, [rows, projectFilter, searchQuery, nameSort, showSystemBots]);

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

        if (!projectId) {
            setCreateError('Оберіть проєкт');
            return;
        }

        if (!createForm.name.trim()) {
            setCreateError('Назва воронки обов\'язкова');
            return;
        }

        const slug = createForm.slug.trim() || slugify(createForm.name);
        if (!slug) {
            setCreateError('Slug не може бути порожнім');
            return;
        }

        setCreating(true);
        setCreateError('');
        try {
            const created = await api.createFunnel(projectId, {
                name: createForm.name.trim(),
                slug,
                description: createForm.description.trim() || undefined,
            });

            closeCreateModal();
            await api.getProjects()
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

    if (loading) return (
        <div className="flex items-center justify-center h-full">
            <div className="text-gray-400">Завантаження...</div>
        </div>
    );

    return (
        <div className="p-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-white">Воронки</h1>
                    <p className="text-sm text-gray-400">Список усіх воронок з основними показниками.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-end w-full md:w-auto">
                    <div className="w-full md:w-72">
                        <label className="text-xs text-gray-500 block mb-1">Пошук по назві/slug</label>
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Наприклад: bot 1.1"
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand"
                        />
                    </div>
                    <div className="w-full md:w-72">
                        <label className="text-xs text-gray-500 block mb-1">Фільтр по проєкту</label>
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
                    <div className="w-full md:w-56">
                        <label className="text-xs text-gray-500 block mb-1">Сортування назви</label>
                        <select
                            value={nameSort}
                            onChange={(e) => setNameSort(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        >
                            <option value="asc">А-Я</option>
                            <option value="desc">Я-А</option>
                        </select>
                    </div>
                    <button
                        onClick={() => setShowSystemBots(v => !v)}
                        title="Системні воронки обробляють /start без параметра і не відображаються в основному списку"
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                            showSystemBots
                                ? 'bg-gray-700 border-gray-500 text-gray-200'
                                : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        ⚙ Системні
                    </button>
                    <button
                        onClick={openCreateModal}
                        className="px-4 py-2 rounded-lg bg-brand hover:bg-brand/90 text-white text-sm font-medium transition-colors"
                    >
                        + Нова воронка
                    </button>
                </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full min-w-[980px]">
                    <thead>
                        <tr className="border-b border-gray-800 bg-gray-950/70">
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Воронка</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Проєкт</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Користувачі</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Сесії</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Активні</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Помилки</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Оновлено</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRows.map((bot) => (
                            <tr key={bot.id} className={`border-b border-gray-800/60 hover:bg-gray-800/35 transition-colors align-top ${bot.settings?.isSystem ? 'opacity-70' : ''}`}>
                                <td className="px-4 py-3 max-w-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-white">{bot.name}</span>
                                        {bot.settings?.isSystem && (
                                            <span title="Системна воронка — обробляє /start без параметра для нових користувачів. Не видаляється." className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700 text-gray-400 border border-gray-600">
                                                ⚙ sys
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500 font-mono">/{bot.slug}</div>
                                    {bot.description && (
                                        <div className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">{bot.description}</div>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-300">{bot.projectName}</td>
                                <td className="px-4 py-3 text-sm text-gray-300">{bot.metrics?.usersCount ?? 0}</td>
                                <td className="px-4 py-3 text-sm text-gray-300">{bot.metrics?.totalSessions ?? 0}</td>
                                <td className="px-4 py-3 text-sm text-emerald-400">{bot.metrics?.activeSessions ?? 0}</td>
                                <td className="px-4 py-3 text-sm">
                                    <span className={(bot.metrics?.unresolvedErrors ?? 0) > 0 ? 'text-red-400' : 'text-gray-400'}>
                                        {bot.metrics?.unresolvedErrors ?? 0}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-500">
                                    {bot.metrics?.flowUpdatedAt ? format(new Date(bot.metrics.flowUpdatedAt), 'dd.MM.yyyy HH:mm') : '—'}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex justify-end gap-2 flex-wrap">
                                        <button
                                            onClick={() => setEditInfoBot(bot)}
                                            title={bot.description ? bot.description : 'Переглянути / редагувати опис'}
                                            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
                                        >
                                            ℹ Інфо
                                        </button>
                                        <button
                                            onClick={() => navigate(`/funnel/${bot.id}`)}
                                            className="px-3 py-1.5 bg-brand/20 hover:bg-brand/30 text-brand-light text-xs rounded-lg transition-colors"
                                        >
                                            Редагувати
                                        </button>
                                        <button
                                            onClick={() => navigate(`/bots/${bot.id}/sessions`)}
                                            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
                                        >
                                            Сесії
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredRows.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-4 py-12 text-center text-gray-500 text-sm">Немає воронок за обраним фільтром</td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-800 flex items-center justify-between">
                    <span>Всього воронок: {filteredRows.length}</span>
                    {!showSystemBots && rows.some(r => r.settings?.isSystem) && (
                        <span className="text-gray-600">
                            + {rows.filter(r => r.settings?.isSystem).length} системних (приховано)
                        </span>
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
