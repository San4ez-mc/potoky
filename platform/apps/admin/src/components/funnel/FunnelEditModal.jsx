import React, { useState, useEffect } from 'react';

export function FunnelEditModal({ isOpen, bot, onClose, onSave, isSaving }) {
    const [form, setForm] = useState({ name: '', description: '' });

    useEffect(() => {
        if (bot) {
            setForm({ name: bot.name || '', description: bot.description || '' });
        }
    }, [bot, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        await onSave(form);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl shadow-black/40">
                <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
                    <h2 className="text-base font-semibold text-white">Редагувати воронку</h2>
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
                        <label className="mb-2 block text-sm text-gray-300 font-medium">Назва воронки</label>
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
                        <label className="mb-2 block text-sm text-gray-300 font-medium">Опис</label>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            placeholder="Опис воронки (необов'язково)"
                            rows={4}
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-500 focus:border-brand focus:outline-none resize-none transition-colors"
                            disabled={isSaving}
                        />
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
