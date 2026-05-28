import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.js';

export function FunnelEditModal({ isOpen, bot, onClose, onSave, isSaving }) {
    const [form, setForm] = useState({ name: '', description: '', projectId: '' });
    const [projects, setProjects] = useState([]);
    const [loadingProjects, setLoadingProjects] = useState(false);

    useEffect(() => {
        if (bot) {
            setForm({
                name: bot.name || '',
                description: bot.description || '',
                projectId: bot.projectId || '',
            });
        }
    }, [bot, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        setLoadingProjects(true);
        api.getProjects()
            .then(setProjects)
            .catch(() => setProjects([]))
            .finally(() => setLoadingProjects(false));
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        await onSave(form);
    };

    const projectChanged = form.projectId !== (bot?.projectId || '');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl shadow-black/40">
                <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-white">Інформація про воронку</h2>
                        <div className="text-xs text-gray-500 font-mono mt-0.5">/{bot?.slug}</div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="text-gray-400 hover:text-white disabled:opacity-50"
                    >
                        ✕
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 p-5">
                    <div>
                        <label className="mb-2 block text-sm text-gray-300 font-medium">Назва</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="Назва воронки"
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-500 focus:border-brand focus:outline-none transition-colors"
                            disabled={isSaving}
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm text-gray-300 font-medium">Опис воронки</label>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            placeholder="Опис воронки (необов'язково)"
                            rows={4}
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-500 focus:border-brand focus:outline-none resize-none transition-colors"
                            disabled={isSaving}
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm text-gray-300 font-medium">Проект</label>
                        {loadingProjects ? (
                            <div className="text-xs text-gray-500 py-2">Завантаження проектів...</div>
                        ) : (
                            <select
                                value={form.projectId}
                                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                                disabled={isSaving}
                                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white focus:border-brand focus:outline-none transition-colors"
                            >
                                <option value="">— Без проекту —</option>
                                {projects.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        )}
                        {projectChanged && (
                            <div className="mt-1 text-xs text-yellow-400">
                                ⚠️ Воронку буде переміщено до іншого проекту
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSaving}
                            className="flex-1 px-4 py-2 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
                        >
                            Скасувати
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving || !form.name.trim()}
                            className="flex-1 px-4 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white font-medium transition-colors disabled:opacity-50"
                        >
                            {isSaving ? 'Збереження...' : 'Зберегти'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
