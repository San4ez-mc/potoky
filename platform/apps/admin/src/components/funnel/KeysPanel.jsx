import React, { useState } from 'react';
import { useFunnelStore } from '../../stores/funnelStore.js';

function KeyRow({ k, onEdit, onDelete, onReveal }) {
    const [revealed, setRevealed] = useState(false);
    const [revealedValue, setRevealedValue] = useState('');

    const handleReveal = async () => {
        if (revealed) { setRevealed(false); return; }
        const value = await onReveal(k.key);
        setRevealedValue(value);
        setRevealed(true);
    };

    return (
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <code className="text-sm text-brand-light font-mono">{k.key}</code>
                        {k.isSecret && <span className="text-[10px] bg-yellow-900/40 text-yellow-400 border border-yellow-800 rounded px-1.5 py-0.5">SECRET</span>}
                    </div>
                    {k.label && <div className="text-xs text-gray-400 mt-0.5">{k.label}</div>}
                    <div className="text-sm text-gray-300 mt-1 font-mono truncate">
                        {revealed ? revealedValue : (k.isSecret ? '••••••••' : k.value)}
                    </div>
                </div>
                <div className="flex gap-1 shrink-0">
                    {k.isSecret && (
                        <button
                            onClick={handleReveal}
                            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                        >
                            {revealed ? '🙈' : '👁'}
                        </button>
                    )}
                    <button
                        onClick={() => onEdit(k)}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                    >
                        ✏️
                    </button>
                    <button
                        onClick={() => onDelete(k.key)}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-red-900/40 text-gray-400 hover:text-red-300 transition-colors"
                    >
                        🗑
                    </button>
                </div>
            </div>
        </div>
    );
}

function KeyForm({ initial, onSave, onCancel }) {
    const [form, setForm] = useState(initial || { key: '', value: '', label: '', isSecret: false });
    const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

    return (
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700 space-y-2">
            <div>
                <label className="text-xs text-gray-400 block mb-1">Ключ (A-Z, 0-9, _)</label>
                <input
                    value={form.key}
                    onChange={e => set('key', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    placeholder="MY_KEY"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-brand"
                />
            </div>
            <div>
                <label className="text-xs text-gray-400 block mb-1">Значення</label>
                <input
                    type={form.isSecret ? 'password' : 'text'}
                    value={form.value}
                    onChange={e => set('value', e.target.value)}
                    placeholder="value"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-brand"
                />
            </div>
            <div>
                <label className="text-xs text-gray-400 block mb-1">Мітка (опційно)</label>
                <input
                    value={form.label}
                    onChange={e => set('label', e.target.value)}
                    placeholder="Telegram Bot Token"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                    type="checkbox"
                    checked={form.isSecret}
                    onChange={e => set('isSecret', e.target.checked)}
                    className="accent-brand"
                />
                Секретний (буде замасковано)
            </label>
            <div className="flex gap-2 pt-1">
                <button
                    onClick={() => onSave(form)}
                    className="flex-1 bg-brand hover:bg-brand-dark text-white rounded py-1.5 text-sm transition-colors"
                >
                    Зберегти
                </button>
                <button
                    onClick={onCancel}
                    className="px-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded py-1.5 text-sm transition-colors"
                >
                    Скасувати
                </button>
            </div>
        </div>
    );
}

export function KeysPanel() {
    const { keys, upsertKey, deleteKey, revealKey } = useFunnelStore();
    const [editing, setEditing] = useState(null); // null | {} (new) | existing key
    const [isNew, setIsNew] = useState(false);

    const handleSave = async (form) => {
        await upsertKey(form.key, form.value, form.label, form.isSecret);
        setEditing(null);
        setIsNew(false);
    };

    const handleEdit = (k) => { setEditing(k); setIsNew(false); };
    const handleNew = () => { setEditing({ key: '', value: '', label: '', isSecret: false }); setIsNew(true); };
    const handleDelete = async (key) => {
        if (!confirm(`Видалити ключ ${key}?`)) return;
        await deleteKey(key);
    };

    return (
        <div className="w-72 shrink-0 bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <div>
                    <div className="text-sm font-semibold text-white">Ключі воронки</div>
                    <div className="text-xs text-gray-500">Env змінні для цього бота</div>
                </div>
                <button
                    onClick={handleNew}
                    className="text-sm bg-brand/20 hover:bg-brand/30 text-brand-light rounded-lg px-2.5 py-1.5 transition-colors"
                >
                    + Новий
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                {isNew && editing && (
                    <KeyForm initial={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsNew(false); }} />
                )}

                {keys.map(k => (
                    editing?.key === k.key && !isNew ? (
                        <KeyForm key={k.key} initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />
                    ) : (
                        <KeyRow key={k.key} k={k} onEdit={handleEdit} onDelete={handleDelete} onReveal={revealKey} />
                    )
                ))}

                {keys.length === 0 && !isNew && (
                    <div className="text-center text-gray-500 text-sm py-8">
                        Немає ключів.<br />
                        <button onClick={handleNew} className="text-brand-light hover:text-brand mt-2">Додати перший</button>
                    </div>
                )}
            </div>
        </div>
    );
}
