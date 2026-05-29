import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

function Modal({ isOpen, title, children, onClose }) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full mx-4">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
                </div>
                {children}
            </div>
        </div>
    );
}

function FunnelChip({ bot, projectId, onDelete, onNavigate }) {
    const [deleting, setDeleting] = useState(false);
    const [hover, setHover] = useState(false);

    const handleDelete = async () => {
        if (!confirm(`Видалити воронку «${bot.name}» з проекту?\n\nВоронка залишиться в системі, але більше не буде прив'язана до цього проекту.`)) return;
        setDeleting(true);
        try {
            await api.deleteFunnel(projectId, bot.id);
            onDelete(bot.id);
        } catch (err) {
            alert('Помилка: ' + err.message);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div
            className="group relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors cursor-default"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            <span className="text-xs text-gray-300 font-medium truncate max-w-[140px]">{bot.name}</span>
            <span className="text-[10px] text-gray-600 font-mono hidden group-hover:inline">/{bot.slug}</span>
            {hover && (
                <div className="flex items-center gap-0.5 ml-0.5">
                    <button
                        onClick={() => onNavigate(bot.id)}
                        className="p-0.5 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                        title="Відкрити"
                    >
                        ↗
                    </button>
                    {!bot.settings?.isSystem && (
                        <button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="p-0.5 text-[10px] text-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
                            title="Видалити з проекту"
                        >
                            ✕
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function BotsPanel({ project, onRefresh }) {
    const navigate = useNavigate();
    const [bots, setBots] = useState(null);
    const [loading, setLoading] = useState(true);
    const [addMode, setAddMode] = useState(null); // null | 'create' | 'assign'
    const [addForm, setAddForm] = useState({ name: '', slug: '', description: '' });
    const [addError, setAddError] = useState('');
    const [adding, setAdding] = useState(false);
    const [allBots, setAllBots] = useState([]);
    const [assignBotId, setAssignBotId] = useState('');
    const [assignLoading, setAssignLoading] = useState(false);

    useEffect(() => {
        api.getProjectBots(project.id)
            .then(data => setBots(data))
            .catch(() => setBots([]))
            .finally(() => setLoading(false));
    }, [project.id]);

    const openAssign = () => {
        setAddMode('assign');
        setAddError('');
        setAssignBotId('');
        api.getAllBots().then(list => {
            setAllBots(list.filter(b => b.projectId !== project.id));
        }).catch(() => setAllBots([]));
    };

    const handleAssign = async () => {
        if (!assignBotId) { setAddError('Оберіть воронку'); return; }
        setAssignLoading(true);
        setAddError('');
        try {
            await api.updateBot(assignBotId, undefined, undefined, project.id);
            const updated = await api.getProjectBots(project.id);
            setBots(updated);
            setAddMode(null);
            onRefresh();
        } catch (err) {
            setAddError(err.message || 'Помилка при призначенні');
        } finally {
            setAssignLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!addForm.name.trim() || !addForm.slug.trim()) {
            setAddError("Назва та slug обов'язкові");
            return;
        }
        setAdding(true);
        setAddError('');
        try {
            const newBot = await api.createFunnel(project.id, {
                name: addForm.name.trim(),
                slug: addForm.slug.trim(),
                description: addForm.description.trim() || undefined,
            });
            setBots(prev => [...(prev || []), newBot]);
            setAddForm({ name: '', slug: '', description: '' });
            setAddMode(null);
            onRefresh();
        } catch (err) {
            setAddError(err.message || 'Помилка при створенні');
        } finally {
            setAdding(false);
        }
    };

    const autoSlug = (name) => name.toLowerCase()
        .replace(/[^a-z0-9а-яіїєґ\s-]/gi, '')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/gi, '')
        .slice(0, 60);

    if (loading) {
        return <div className="text-xs text-gray-500 py-2 px-1">Завантаження воронок...</div>;
    }

    return (
        <div className="mt-3 border-t border-gray-800 pt-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Воронки ({bots?.length ?? 0})
                </span>
                <div className="flex items-center gap-2">
                    {addMode ? (
                        <button
                            onClick={() => { setAddMode(null); setAddError(''); }}
                            className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                            Скасувати
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={openAssign}
                                className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                            >
                                + Існуючу
                            </button>
                            <button
                                onClick={() => { setAddMode('create'); setAddError(''); }}
                                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                            >
                                + Нову
                            </button>
                        </>
                    )}
                </div>
            </div>

            {addMode === 'assign' && (
                <div className="mb-3 p-3 bg-purple-900/20 rounded-lg border border-purple-800/50 space-y-2">
                    <div className="text-xs text-purple-300 font-medium">Додати існуючу воронку до проекту</div>
                    {addError && <div className="text-xs text-red-400">{addError}</div>}
                    <select
                        value={assignBotId}
                        onChange={(e) => setAssignBotId(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-purple-500"
                    >
                        <option value="">Оберіть воронку...</option>
                        {allBots.map(b => (
                            <option key={b.id} value={b.id}>
                                {b.name} {b.projectId ? '(в іншому проекті)' : '(без проекту)'}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={handleAssign}
                        disabled={assignLoading || !assignBotId}
                        className="w-full py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded transition-colors"
                    >
                        {assignLoading ? 'Призначення...' : 'Додати до проекту'}
                    </button>
                </div>
            )}

            {addMode === 'create' && (
                <div className="mb-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700 space-y-2">
                    {addError && <div className="text-xs text-red-400">{addError}</div>}
                    <input
                        type="text"
                        value={addForm.name}
                        onChange={(e) => setAddForm(f => ({
                            ...f,
                            name: e.target.value,
                            slug: f.slug || autoSlug(e.target.value),
                        }))}
                        placeholder="Назва воронки"
                        className="w-full px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                    <input
                        type="text"
                        value={addForm.slug}
                        onChange={(e) => setAddForm(f => ({ ...f, slug: e.target.value }))}
                        placeholder="slug (напр. my-funnel)"
                        className="w-full px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white font-mono placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                    <input
                        type="text"
                        value={addForm.description}
                        onChange={(e) => setAddForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="Опис (опціонально)"
                        className="w-full px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                    <button
                        onClick={handleAdd}
                        disabled={adding}
                        className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded transition-colors"
                    >
                        {adding ? 'Створення...' : 'Створити воронку'}
                    </button>
                </div>
            )}

            {/* Funnel chips */}
            <div className="flex flex-wrap gap-1.5">
                {bots?.map(bot => (
                    <FunnelChip
                        key={bot.id}
                        bot={bot}
                        projectId={project.id}
                        onDelete={(botId) => setBots(prev => prev.filter(b => b.id !== botId))}
                        onNavigate={(botId) => navigate(`/funnel/${botId}`)}
                    />
                ))}
                {bots?.length === 0 && !addMode && (
                    <div className="text-xs text-gray-600 py-2">Немає воронок. Додайте першу ↑</div>
                )}
            </div>
        </div>
    );
}

export function Projects() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState({});
    const [botsModalProject, setBotsModalProject] = useState(null);
    const [modal, setModal] = useState({ type: null, projectId: null });
    const [formData, setFormData] = useState({ name: '', slug: '', description: '' });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const loadProjects = () => {
        setLoading(true);
        api.getProjects()
            .then(async (list) => {
                const withStats = await Promise.all(
                    list.map(async (project) => {
                        const [stats, bots] = await Promise.all([
                            api.getProjectStats(project.id).catch(() => ({ totalUsers: 0, activeUsers: 0, errorsLast24h: 0 })),
                            api.getProjectBots(project.id).catch(() => []),
                        ]);
                        return { ...project, stats, bots, botsCount: bots.length };
                    })
                );
                setProjects(withStats);
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => { loadProjects(); }, []);

    const toggleExpanded = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

    const openCreateModal = () => {
        setFormData({ name: '', slug: '', description: '' });
        setError('');
        setModal({ type: 'create', projectId: null });
    };

    const openEditModal = (project) => {
        setFormData({ name: project.name, slug: project.slug, description: project.description || '' });
        setError('');
        setModal({ type: 'edit', projectId: project.id });
    };

    const closeModal = () => {
        setModal({ type: null, projectId: null });
        setFormData({ name: '', slug: '', description: '' });
        setError('');
    };

    const handleSave = async () => {
        if (!formData.name.trim() || (modal.type === 'create' && !formData.slug.trim())) {
            setError("Назва та slug обов'язкові");
            return;
        }
        setSaving(true);
        try {
            if (modal.type === 'create') {
                await api.createProject(formData.name, formData.slug, formData.description);
            } else {
                await api.updateProject(modal.projectId, formData.name, formData.description, true);
            }
            closeModal();
            loadProjects();
        } catch (err) {
            setError(err.message || 'Помилка при збереженні');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (project) => {
        const activeSessions = project.stats?.activeUsers ?? 0;
        const warningLine = activeSessions > 0
            ? `\n\n⚠️ Увага: зараз ${activeSessions} активних користувачів у цьому проєкті!`
            : '';
        if (!confirm(`Видалити проект «${project.name}»? Це деактивує всі воронки в ньому.${warningLine}`)) return;
        try {
            await api.deleteProject(project.id);
            loadProjects();
        } catch (err) {
            alert('Помилка при видаленні: ' + err.message);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-gray-400">Завантаження...</div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-4">
            {/* Page header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-white">Проєкти</h1>
                    <p className="text-sm text-gray-400 mt-1">Огляд по кожному проєкту: воронки, користувачі, активність та помилки.</p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                >
                    + Новий проект
                </button>
            </div>

            {/* Project cards — grid layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {projects.map((project) => {
                    const stats = project.stats || {};
                    const hasErrors = (stats.errorsLast24h ?? 0) > 0;
                    const bots = project.bots || [];

                    return (
                        <div
                            key={project.id}
                            className="bg-gray-900 border border-gray-800 rounded-2xl flex flex-col min-h-[220px] hover:border-gray-700 transition-colors"
                        >
                            {/* Card top — coloured accent bar */}
                            <div className="h-1 rounded-t-2xl bg-gradient-to-r from-blue-600 to-indigo-500" />

                            <div className="flex flex-col flex-1 p-5 gap-3">
                                {/* Title + funnel count */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <h2 className="text-sm font-semibold text-white leading-snug">{project.name}</h2>
                                        <div className="text-[11px] text-gray-500 font-mono mt-0.5">/{project.slug}</div>
                                    </div>
                                    <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-blue-900/30 border border-blue-800/50 text-blue-400">
                                        {bots.length} {bots.length === 1 ? 'воронка' : bots.length < 5 ? 'воронки' : 'воронок'}
                                    </span>
                                </div>

                                {/* Description */}
                                {project.description && (
                                    <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">{project.description}</p>
                                )}

                                {/* Stats */}
                                <div className="grid grid-cols-3 gap-2 mt-auto">
                                    <div className="bg-gray-800/60 rounded-lg px-2 py-1.5 text-center">
                                        <div className="text-base font-bold text-white">{stats.totalUsers ?? 0}</div>
                                        <div className="text-[10px] text-gray-500 mt-0.5">підписники</div>
                                    </div>
                                    <div className="bg-gray-800/60 rounded-lg px-2 py-1.5 text-center">
                                        <div className={`text-base font-bold ${(stats.activeUsers ?? 0) > 0 ? 'text-emerald-400' : 'text-white'}`}>
                                            {stats.activeUsers ?? 0}
                                        </div>
                                        <div className="text-[10px] text-gray-500 mt-0.5">активних 7д</div>
                                    </div>
                                    <div className="bg-gray-800/60 rounded-lg px-2 py-1.5 text-center">
                                        <div className={`text-base font-bold ${hasErrors ? 'text-red-400' : 'text-gray-400'}`}>
                                            {stats.errorsLast24h ?? 0}
                                        </div>
                                        <div className="text-[10px] text-gray-500 mt-0.5">помилок 24г</div>
                                    </div>
                                </div>

                                {/* Funnel chips (first 4) */}
                                {bots.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {bots.slice(0, 4).map(bot => (
                                            <span key={bot.id} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700/60 text-gray-500 truncate max-w-[120px]">
                                                {bot.name}
                                            </span>
                                        ))}
                                        {bots.length > 4 && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700/60 text-gray-600">
                                                +{bots.length - 4}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Action buttons */}
                                <div className="flex gap-1.5 mt-1 border-t border-gray-800 pt-3">
                                    <button
                                        onClick={() => setBotsModalProject(project)}
                                        className="flex-1 px-2 py-1.5 text-xs bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-800/40 rounded-lg transition-colors text-center"
                                    >
                                        📋 Воронки
                                    </button>
                                    <button
                                        onClick={() => openEditModal(project)}
                                        className="flex-1 px-2 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-center"
                                    >
                                        Редагувати
                                    </button>
                                    <button
                                        onClick={() => handleDelete(project)}
                                        className="px-2 py-1.5 text-xs bg-red-900/20 hover:bg-red-900/40 text-red-400 rounded-lg transition-colors"
                                        title="Видалити проект"
                                    >
                                        🗑
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {projects.length === 0 && (
                    <div className="col-span-3 text-gray-500 text-sm py-10 text-center">Немає проєктів. Створіть перший!</div>
                )}
            </div>

            {/* Bots modal — opens when clicking "Воронки" */}
            {botsModalProject && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 py-8 overflow-y-auto">
                    <div className="w-full max-w-2xl bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                            <div>
                                <h2 className="text-base font-semibold text-white">{botsModalProject.name}</h2>
                                <div className="text-xs text-gray-500 font-mono">/{botsModalProject.slug}</div>
                            </div>
                            <button
                                onClick={() => setBotsModalProject(null)}
                                className="text-gray-400 hover:text-white text-xl leading-none"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="p-5">
                            <BotsPanel
                                project={botsModalProject}
                                onRefresh={() => { loadProjects(); setBotsModalProject(null); }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Create / Edit modal */}
            <Modal
                isOpen={modal.type !== null}
                title={modal.type === 'create' ? 'Новий проект' : 'Редагувати проект'}
                onClose={closeModal}
            >
                <div className="space-y-3">
                    {error && <div className="text-sm text-red-400 bg-red-900/20 p-2 rounded">{error}</div>}

                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Назва</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Назва проекту"
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        />
                    </div>

                    {modal.type === 'create' && (
                        <div>
                            <label className="block text-sm text-gray-300 mb-1">Slug</label>
                            <input
                                type="text"
                                value={formData.slug}
                                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                                placeholder="my-project"
                                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm font-mono placeholder-gray-500 focus:outline-none focus:border-blue-500"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Опис</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Опис проекту (опціонально)"
                            rows={3}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                        />
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded transition-colors"
                        >
                            {saving ? 'Збереження...' : 'Зберегти'}
                        </button>
                        <button
                            onClick={closeModal}
                            className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
                        >
                            Скасувати
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
