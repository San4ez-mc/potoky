import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export function Connectors() {
    const [globalKeys, setGlobalKeys] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingKey, setEditingKey] = useState(null);
    const [editValue, setEditValue] = useState('');

    const projectId = localStorage.getItem('projectId');

    useEffect(() => {
        loadGlobalKeys();
    }, []);

    const loadGlobalKeys = async () => {
        if (!projectId) return;
        setIsLoading(true);
        try {
            const data = await api.getGlobalKeys(projectId);
            setGlobalKeys(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load global keys:', err);
            setGlobalKeys([]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRevealKey = async (keyName) => {
        if (!projectId) return;
        try {
            const result = await api.revealGlobalKey(projectId, keyName);
            setEditingKey(keyName);
            setEditValue(result.value || '');
        } catch (err) {
            console.error('Failed to reveal key:', err);
        }
    };

    const handleSaveKey = async () => {
        if (!projectId || !editingKey) return;
        try {
            const key = globalKeys.find(k => k.key === editingKey);
            await api.upsertGlobalKey(
                projectId,
                editingKey,
                key?.label || editingKey,
                editValue,
                key?.isSecret || false,
                key?.description || ''
            );
            setEditingKey(null);
            setEditValue('');
            await loadGlobalKeys();
        } catch (err) {
            console.error('Failed to save key:', err);
        }
    };

    const handleDeleteKey = async (keyName) => {
        if (!projectId) return;
        if (!window.confirm(`Видалити ключ ${keyName}?`)) return;
        try {
            await api.deleteGlobalKey(projectId, keyName);
            await loadGlobalKeys();
        } catch (err) {
            console.error('Failed to delete key:', err);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h1 className="text-xl font-semibold text-white">Збережені конектори</h1>
                <p className="text-sm text-gray-400 mt-2">
                    Впишіть ключі один раз, а далі використовуйте їх у будь-якій воронці через ноди/конектори.
                </p>
            </div>

            {!projectId && (
                <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-4 text-yellow-300 text-sm">
                    Не обрано проект. Відкрийте будь-яку воронку, щоб projectId зберігся у localStorage.
                </div>
            )}

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Глобальні ключі проекту</h2>

                {isLoading ? (
                    <div className="text-center text-gray-400">Завантаження ключів...</div>
                ) : globalKeys.length === 0 ? (
                    <div className="text-center text-gray-400 py-8">Немає налаштованих ключів</div>
                ) : (
                    <div className="space-y-4">
                        {globalKeys.map(item => (
                            <div key={item.key} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="font-mono text-sm text-brand-light">{item.key}</div>
                                        <div className="text-xs text-gray-400 mt-1">{item.label}</div>
                                        {item.description && <div className="text-xs text-gray-500 mt-2">{item.description}</div>}

                                        {editingKey === item.key ? (
                                            <div className="mt-3 space-y-2">
                                                <textarea
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white"
                                                    rows={3}
                                                />
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={handleSaveKey}
                                                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition-colors"
                                                    >
                                                        Зберегти
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setEditingKey(null);
                                                            setEditValue('');
                                                        }}
                                                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs transition-colors"
                                                    >
                                                        Скасувати
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-xs text-gray-600 mt-2 font-mono break-all">
                                                {item.isSecret ? '••••••••' : item.value}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-2 shrink-0">
                                        {editingKey !== item.key && (
                                            <>
                                                {item.isSecret && (
                                                    <button
                                                        onClick={() => handleRevealKey(item.key)}
                                                        className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded text-xs transition-colors"
                                                    >
                                                        Показати
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleRevealKey(item.key)}
                                                    className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded text-xs transition-colors"
                                                >
                                                    Редагувати
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteKey(item.key)}
                                                    className="px-3 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs transition-colors"
                                                >
                                                    Видалити
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
