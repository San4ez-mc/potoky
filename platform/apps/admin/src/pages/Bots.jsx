import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';

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

export function Bots() {
    const [projects, setProjects] = useState([]);
    const [rows, setRows] = useState([]);
    const [projectFilter, setProjectFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [nameSort, setNameSort] = useState('asc');
    const [loading, setLoading] = useState(true);
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');
    const [createForm, setCreateForm] = useState({ projectId: '', name: '', slug: '', description: '' });
    const navigate = useNavigate();

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

        const searchedRows = query
            ? baseRows.filter((row) =>
                String(row.name || '').toLowerCase().includes(query) ||
                String(row.slug || '').toLowerCase().includes(query)
            )
            : baseRows;

        return [...searchedRows].sort((a, b) => {
            const left = String(a.name || '').toLowerCase();
            const right = String(b.name || '').toLowerCase();
            const comparison = left.localeCompare(right, 'uk');
            return nameSort === 'desc' ? -comparison : comparison;
        });
    }, [rows, projectFilter, searchQuery, nameSort]);

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
                            <tr key={bot.id} className="border-b border-gray-800/60 hover:bg-gray-800/35 transition-colors align-top">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-white">{bot.name}</div>
                                    <div className="text-xs text-gray-500 font-mono">/{bot.slug}</div>
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
                                    <div className="flex justify-end gap-2">
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
                <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-800">
                    Всього воронок: {filteredRows.length}
                </div>
            </div>

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
