import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const CONNECTOR_TYPES = [
    { value: 'telegram', label: 'Telegram', icon: '🤖', fields: [{ key: 'token', label: 'Bot Token', secret: true, placeholder: '123456:ABC-DEF...' }] },
    { value: 'openai', label: 'OpenAI', icon: '🧠', fields: [{ key: 'api_key', label: 'API Key', secret: true, placeholder: 'sk-...' }] },
    { value: 'anthropic', label: 'Anthropic (Claude)', icon: '🎭', fields: [{ key: 'api_key', label: 'API Key', secret: true, placeholder: 'sk-ant-...' }] },
    { value: 'google', label: 'Google / Sheets', icon: '📊', fields: [{ key: 'service_account_json', label: 'Service Account JSON', secret: true, placeholder: '{"type":"service_account",...}' }, { key: 'spreadsheet_id', label: 'Spreadsheet ID', secret: false, placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms' }] },
    { value: 'custom', label: 'Інший (Custom)', icon: '🔧', fields: [] },
];

const TYPE_ICONS = Object.fromEntries(CONNECTOR_TYPES.map(t => [t.value, t.icon]));
const TYPE_LABELS = Object.fromEntries(CONNECTOR_TYPES.map(t => [t.value, t.label]));

function ConnectorModal({ connector, onClose, onSave }) {
    const isEdit = Boolean(connector?.id);
    const [form, setForm] = useState({
        name: connector?.name || '',
        type: connector?.type || 'telegram',
        description: connector?.description || '',
        config: connector?.config || {},
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const typeInfo = CONNECTOR_TYPES.find(t => t.value === form.type);

    const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));
    const setConfig = (key, value) => setForm(f => ({ ...f, config: { ...f.config, [key]: value } }));

    const handleTypeChange = (newType) => {
        setField('type', newType);
        setForm(f => ({ ...f, type: newType, config: {} }));
    };

    const handleSave = async () => {
        if (!form.name.trim()) { setError('Назва обов\'язкова'); return; }
        setSaving(true);
        setError('');
        try {
            if (isEdit) {
                await api.updateSavedConnector(connector.id, form);
            } else {
                await api.createSavedConnector(form);
            }
            onSave();
        } catch (err) {
            setError(err.message || 'Помилка збереження');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg mx-4 shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                    <h2 className="text-lg font-semibold text-white">
                        {isEdit ? 'Редагувати конектор' : 'Новий конектор'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
                </div>

                <div className="px-6 py-4 space-y-4">
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Назва *</label>
                        <input
                            value={form.name}
                            onChange={e => setField('name', e.target.value)}
                            placeholder="Наприклад: Fineko main bot"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        />
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Тип конектора</label>
                        <select
                            value={form.type}
                            onChange={e => handleTypeChange(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        >
                            {CONNECTOR_TYPES.map(t => (
                                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Опис (необов'язково)</label>
                        <input
                            value={form.description}
                            onChange={e => setField('description', e.target.value)}
                            placeholder="Короткий опис"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        />
                    </div>

                    {typeInfo && typeInfo.fields.length > 0 && (
                        <div className="space-y-3">
                            <div className="text-xs text-gray-400 font-medium uppercase tracking-wider">Облікові дані</div>
                            {typeInfo.fields.map(field => (
                                <div key={field.key}>
                                    <label className="text-xs text-gray-400 block mb-1">{field.label}</label>
                                    {field.key === 'service_account_json' ? (
                                        <textarea
                                            value={form.config[field.key] || ''}
                                            onChange={e => setConfig(field.key, e.target.value)}
                                            placeholder={field.placeholder}
                                            rows={4}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500 resize-y"
                                        />
                                    ) : (
                                        <input
                                            type={field.secret ? 'password' : 'text'}
                                            value={form.config[field.key] || ''}
                                            onChange={e => setConfig(field.key, e.target.value)}
                                            placeholder={field.placeholder}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500"
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {form.type === 'custom' && (
                        <div className="space-y-3">
                            <div className="text-xs text-gray-400 font-medium uppercase tracking-wider">Довільні поля</div>
                            {Object.entries(form.config).map(([k, v]) => (
                                <div key={k} className="flex gap-2 items-center">
                                    <input
                                        value={k}
                                        readOnly
                                        className="w-32 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 font-mono"
                                    />
                                    <input
                                        value={v}
                                        onChange={e => setConfig(k, e.target.value)}
                                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white"
                                    />
                                    <button
                                        onClick={() => {
                                            const cfg = { ...form.config };
                                            delete cfg[k];
                                            setField('config', cfg);
                                        }}
                                        className="text-red-400 hover:text-red-300 px-2 text-sm"
                                    >✕</button>
                                </div>
                            ))}
                            <button
                                onClick={() => {
                                    const key = prompt('Ключ поля:');
                                    if (key) setConfig(key, '');
                                }}
                                className="w-full py-1.5 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-gray-400 text-xs transition-colors"
                            >
                                + Додати поле
                            </button>
                        </div>
                    )}

                    {error && <div className="text-red-400 text-sm">{error}</div>}
                </div>

                <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                        Скасувати
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        {saving ? 'Збереження...' : isEdit ? 'Зберегти' : 'Створити'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function Connectors() {
    const [globalKeys, setGlobalKeys] = useState([]);
    const [savedConnectors, setSavedConnectors] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingKey, setEditingKey] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [modal, setModal] = useState(null); // null | { connector?: object }

    const projectId = localStorage.getItem('projectId');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [keysData, connectorsData] = await Promise.allSettled([
                projectId ? api.getGlobalKeys(projectId) : Promise.resolve([]),
                api.getSavedConnectors(),
            ]);
            setGlobalKeys(keysData.status === 'fulfilled' && Array.isArray(keysData.value) ? keysData.value : []);
            setSavedConnectors(connectorsData.status === 'fulfilled' ? (connectorsData.value?.data || []) : []);
        } catch (err) {
            console.error('Failed to load data:', err);
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
            await loadData();
        } catch (err) {
            console.error('Failed to save key:', err);
        }
    };

    const handleDeleteKey = async (keyName) => {
        if (!projectId) return;
        if (!window.confirm(`Видалити ключ ${keyName}?`)) return;
        try {
            await api.deleteGlobalKey(projectId, keyName);
            await loadData();
        } catch (err) {
            console.error('Failed to delete key:', err);
        }
    };

    const handleDeleteConnector = async (id, name) => {
        if (!window.confirm(`Видалити конектор "${name}"?`)) return;
        try {
            await api.deleteSavedConnector(id);
            await loadData();
        } catch (err) {
            console.error('Failed to delete connector:', err);
        }
    };

    const groupedConnectors = CONNECTOR_TYPES.map(t => ({
        ...t,
        items: savedConnectors.filter(c => c.type === t.value),
    })).filter(g => g.items.length > 0);

    return (
        <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-semibold text-white">Збережені конектори</h1>
                        <p className="text-sm text-gray-400 mt-2">
                            Збережіть ключі один раз — і обирайте їх у будь-якій воронці при додаванні ноди-конектора.
                        </p>
                    </div>
                    <button
                        onClick={() => setModal({ connector: null })}
                        className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        + Новий конектор
                    </button>
                </div>
            </div>

            {/* Saved Connectors */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Конектори</h2>

                {isLoading ? (
                    <div className="text-center text-gray-400">Завантаження...</div>
                ) : savedConnectors.length === 0 ? (
                    <div className="text-center py-10">
                        <div className="text-4xl mb-3">🔌</div>
                        <div className="text-gray-400 text-sm mb-4">Ще немає збережених конекторів</div>
                        <button
                            onClick={() => setModal({ connector: null })}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Створити перший конектор
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {groupedConnectors.map(group => (
                            <div key={group.value}>
                                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <span>{group.icon}</span>
                                    <span>{group.label}</span>
                                    <span className="bg-gray-700 text-gray-400 rounded-full px-2 py-0.5 text-xs">{group.items.length}</span>
                                </div>
                                <div className="space-y-2">
                                    {group.items.map(item => (
                                        <div key={item.id} className="bg-gray-900 rounded-lg p-4 border border-gray-700 flex items-center gap-4">
                                            <div className="text-2xl">{TYPE_ICONS[item.type] || '🔧'}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-white text-sm">{item.name}</div>
                                                {item.description && (
                                                    <div className="text-xs text-gray-400 mt-0.5">{item.description}</div>
                                                )}
                                                <div className="text-xs text-gray-600 mt-1 font-mono">
                                                    {Object.keys(item.config || {}).join(', ') || 'Немає полів'}
                                                </div>
                                            </div>
                                            <div className="flex gap-2 shrink-0">
                                                <button
                                                    onClick={() => setModal({ connector: item })}
                                                    className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded text-xs transition-colors"
                                                >
                                                    Редагувати
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteConnector(item.id, item.name)}
                                                    className="px-3 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs transition-colors"
                                                >
                                                    Видалити
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Global Keys section */}
            {projectId && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                    <h2 className="text-lg font-semibold text-white mb-1">Глобальні ключі проекту</h2>
                    <p className="text-xs text-gray-500 mb-4">Змінні середовища, доступні всім ботам у проекті.</p>

                    {globalKeys.length === 0 ? (
                        <div className="text-center text-gray-400 py-8">Немає налаштованих ключів</div>
                    ) : (
                        <div className="space-y-4">
                            {globalKeys.map(item => (
                                <div key={item.key} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                            <div className="font-mono text-sm text-blue-400">{item.key}</div>
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
                                                            onClick={() => { setEditingKey(null); setEditValue(''); }}
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
            )}

            {modal && (
                <ConnectorModal
                    connector={modal.connector}
                    onClose={() => setModal(null)}
                    onSave={() => { setModal(null); loadData(); }}
                />
            )}
        </div>
    );
}

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
