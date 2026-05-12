import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';

function Stat({ label, value }) {
    return (
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
            <div className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</div>
            <div className="text-base font-semibold text-white mt-0.5">{value ?? 0}</div>
        </div>
    );
}

function Modal({ isOpen, title, children, onClose }) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full mx-4">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                </div>
                {children}
            </div>
        </div>
    );
}

export function Projects() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState({ type: null, projectId: null });
    const [formData, setFormData] = useState({ name: '', slug: '', description: '' });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const loadProjects = () => {
        api.getProjects()
            .then(async (list) => {
                const withStats = await Promise.all(
                    list.map(async (project) => {
                        const [stats, bots] = await Promise.all([
                            api.getProjectStats(project.id).catch(() => ({ totalUsers: 0, activeUsers: 0, errorsLast24h: 0 })),
                            api.getProjectBots(project.id).catch(() => []),
                        ]);
                        return { ...project, stats, botsCount: bots.length };
                    })
                );
                setProjects(withStats);
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadProjects();
    }, []);

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
        if (!formData.name.trim() || !formData.slug.trim()) {
            setError('Назва та slug обов\'язкові');
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
            setLoading(true);
            loadProjects();
        } catch (err) {
            setError(err.message || 'Помилка при збереженні');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (projectId) => {
        if (!confirm('Видалити проект?')) return;
        try {
            await api.deleteProject(projectId);
            setLoading(true);
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
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-white">Проєкти</h1>
                    <p className="text-sm text-gray-400 mt-1">Огляд по кожному проєкту: боти, юзери, активність та помилки.</p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                >
                    + Новий проект
                </button>
            </div>

            <div className="space-y-3">
                {projects.map((project) => (
                    <div key={project.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <div className="flex items-center justify-between gap-4 mb-3">
                            <div className="flex-1">
                                <div className="text-base font-semibold text-white">{project.name}</div>
                                <div className="text-xs text-gray-500 font-mono">/{project.slug}</div>
                                {project.description && <div className="text-xs text-gray-400 mt-1">{project.description}</div>}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs px-2 py-1 rounded-full border border-gray-700 text-gray-300 shrink-0">
                                    Ботів: {project.botsCount}
                                </span>
                                <button
                                    onClick={() => openEditModal(project)}
                                    className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                                >
                                    Редагувати
                                </button>
                                <button
                                    onClick={() => handleDelete(project.id)}
                                    className="px-3 py-1 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded transition-colors"
                                >
                                    Видалити
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <Stat label="Юзери" value={project.stats?.totalUsers ?? 0} />
                            <Stat label="Активні" value={project.stats?.activeUsers ?? 0} />
                            <Stat label="Помилки 24г" value={project.stats?.errorsLast24h ?? 0} />
                            <Stat label="ID" value={project.id.slice(0, 8)} />
                        </div>
                    </div>
                ))}

                {projects.length === 0 && (
                    <div className="text-gray-500 text-sm py-10 text-center">Немає проєктів</div>
                )}
            </div>

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
                                placeholder="Slug (для URL)"
                                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
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
