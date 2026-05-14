import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

function ConnectorModal({ connector, connectorDefs, onClose, onSaved }) {
    const isEdit = Boolean(connector?.id);
    const initialType = connector?.type || connectorDefs[0]?.type || '';

    const [form, setForm] = useState({
        name: connector?.name || '',
        type: initialType,
        description: connector?.description || '',
        config: connector?.config || {},
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [visibleSecrets, setVisibleSecrets] = useState({});

    const def = connectorDefs.find((d) => d.type === form.type);
    const fields = def?.schema?.fields || [];

    const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
    const setConfig = (key, value) => setForm((prev) => ({ ...prev, config: { ...prev.config, [key]: value } }));
    const toggleSecretVisibility = (key) => setVisibleSecrets((prev) => ({ ...prev, [key]: !prev[key] }));

    const save = async () => {
        if (!form.name.trim()) {
            setError('Назва конектора обовʼязкова');
            return;
        }
        if (!form.type) {
            setError('Оберіть тип конектора');
            return;
        }

        setSaving(true);
        setError('');
        try {
            if (isEdit) {
                await api.updateSavedConnector(connector.id, form);
            } else {
                await api.createSavedConnector(form);
            }
            onSaved();
        } catch (err) {
            setError(err.message || 'Не вдалося зберегти конектор');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
                <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                    <h3 className="text-white font-semibold">{isEdit ? 'Редагувати конектор' : 'Додати конектор'}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">Закрити</button>
                </div>

                <div className="p-5 overflow-y-auto space-y-4">
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Назва</label>
                        <input
                            value={form.name}
                            onChange={(e) => setField('name', e.target.value)}
                            placeholder="Наприклад: Sonnet основний"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                        />
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Тип конектора</label>
                        <select
                            value={form.type}
                            onChange={(e) => setField('type', e.target.value)}
                            disabled={isEdit}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60"
                        >
                            {connectorDefs.map((item) => (
                                <option key={item.type} value={item.type}>{item.icon} {item.name}</option>
                            ))}
                        </select>
                        {def?.description && (
                            <p className="text-xs text-gray-500 mt-1">{def.description}</p>
                        )}
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Опис (необовʼязково)</label>
                        <textarea
                            rows={3}
                            value={form.description}
                            onChange={(e) => setField('description', e.target.value)}
                            placeholder="Коротка нотатка"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                        />
                    </div>

                    <div className="pt-2 border-t border-gray-800">
                        <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">Поля типу</div>
                        {fields.length === 0 ? (
                            <div className="text-sm text-gray-500">Для цього типу не задано полів.</div>
                        ) : (
                            <div className="space-y-3">
                                {fields.map((field) => (
                                    <div key={field.key}>
                                        <label className="text-xs text-gray-400 block mb-1">{field.label}</label>
                                        {field.multiline ? (
                                            <div className="relative">
                                                <textarea
                                                    rows={4}
                                                    value={form.config[field.key] || ''}
                                                    onChange={(e) => setConfig(field.key, e.target.value)}
                                                    placeholder={field.placeholder || ''}
                                                    style={field.secret && !visibleSecrets[field.key] ? { WebkitTextSecurity: 'disc' } : undefined}
                                                    className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white font-mono ${field.secret ? 'pr-10' : ''}`}
                                                />
                                                {field.secret && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSecretVisibility(field.key)}
                                                        className="absolute top-2 right-2 text-gray-400 hover:text-white"
                                                        title={visibleSecrets[field.key] ? 'Сховати значення' : 'Показати значення'}
                                                        aria-label={visibleSecrets[field.key] ? 'Сховати значення' : 'Показати значення'}
                                                    >
                                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                                                            <circle cx="12" cy="12" r="3" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <input
                                                    type={field.secret && !visibleSecrets[field.key] ? 'password' : 'text'}
                                                    value={form.config[field.key] || ''}
                                                    onChange={(e) => setConfig(field.key, e.target.value)}
                                                    placeholder={field.placeholder || ''}
                                                    className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono ${field.secret ? 'pr-10' : ''}`}
                                                />
                                                {field.secret && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSecretVisibility(field.key)}
                                                        className="absolute top-1/2 -translate-y-1/2 right-2 text-gray-400 hover:text-white"
                                                        title={visibleSecrets[field.key] ? 'Сховати значення' : 'Показати значення'}
                                                        aria-label={visibleSecrets[field.key] ? 'Сховати значення' : 'Показати значення'}
                                                    >
                                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                                                            <circle cx="12" cy="12" r="3" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">{error}</div>}
                </div>

                <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-2 text-sm text-gray-300 hover:text-white">Скасувати</button>
                    <button
                        onClick={save}
                        disabled={saving}
                        className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white"
                    >
                        {saving ? 'Збереження...' : 'Зберегти'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function Connectors() {
    const [activeTab, setActiveTab] = useState('types');
    const [connectorDefs, setConnectorDefs] = useState([]);
    const [savedConnectors, setSavedConnectors] = useState([]);
    const [loading, setLoading] = useState(false);
    const [modalConnector, setModalConnector] = useState(undefined);

    const load = async () => {
        setLoading(true);
        try {
            const [defsRes, savedRes] = await Promise.allSettled([
                api.getConnectors(),
                api.getSavedConnectors(),
            ]);
            setConnectorDefs(defsRes.status === 'fulfilled' ? (Array.isArray(defsRes.value) ? defsRes.value : (defsRes.value?.data || [])) : []);
            setSavedConnectors(savedRes.status === 'fulfilled' ? (Array.isArray(savedRes.value) ? savedRes.value : (savedRes.value?.data || [])) : []);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const byType = useMemo(() => {
        return savedConnectors.reduce((acc, item) => {
            if (!acc[item.type]) acc[item.type] = [];
            acc[item.type].push(item);
            return acc;
        }, {});
    }, [savedConnectors]);

    const deleteOne = async (item) => {
        if (!window.confirm(`Видалити конектор "${item.name}"?`)) return;
        await api.deleteSavedConnector(item.id);
        await load();
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-5">
            <div>
                <h1 className="text-2xl font-bold text-white">Конектори</h1>
                <p className="text-sm text-gray-400 mt-1">
                    Тип конектора — це шаблон інтеграції. Збережений конектор — це ваш екземпляр типу з власними ключами.
                </p>
            </div>

            <div className="flex items-center gap-2 border-b border-gray-800">
                <button
                    onClick={() => setActiveTab('types')}
                    className={`px-4 py-2 text-sm border-b-2 -mb-px ${activeTab === 'types' ? 'border-blue-500 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
                >
                    Типи конекторів
                </button>
                <button
                    onClick={() => setActiveTab('mine')}
                    className={`px-4 py-2 text-sm border-b-2 -mb-px ${activeTab === 'mine' ? 'border-blue-500 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
                >
                    Мої конектори
                </button>
            </div>

            {activeTab === 'types' && (
                <div className="space-y-3">
                    <p className="text-sm text-gray-500">Системні шаблони — описують як підключитися до сервісу.</p>
                    {loading ? (
                        <div className="text-gray-400">Завантаження...</div>
                    ) : connectorDefs.length === 0 ? (
                        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 text-sm text-gray-400">
                            Немає типів конекторів. Запустіть seed: <span className="font-mono">yarn seed:connector-defs</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {connectorDefs.map((def) => (
                                <div key={def.type} className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex flex-col">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl">{def.icon || '🔌'}</span>
                                        <div className="text-white font-semibold">{def.name}</div>
                                    </div>
                                    <div className="text-xs text-gray-500 font-mono mt-1">{def.type}</div>
                                    <div className="text-sm text-gray-400 mt-2">{def.description || 'Без опису'}</div>
                                    <div className="text-xs text-gray-600 mt-2">
                                        Поля: {(def.schema?.fields || []).map((f) => f.label).join(', ') || 'немає'}
                                    </div>
                                    <button
                                        onClick={() => setModalConnector({ type: def.type })}
                                        className="mt-3 px-3 py-1.5 text-xs rounded border border-blue-800 text-blue-300 hover:bg-blue-900/30"
                                    >
                                        + Зберегти
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'mine' && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-500">Екземпляри з заповненими ключами.</p>
                        <button
                            onClick={() => setModalConnector(null)}
                            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            + Додати конектор
                        </button>
                    </div>

                    {loading ? (
                        <div className="text-gray-400">Завантаження...</div>
                    ) : savedConnectors.length === 0 ? (
                        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 text-center text-gray-500">
                            Ще немає збережених конекторів.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {connectorDefs.map((def) => {
                                const items = byType[def.type] || [];
                                if (items.length === 0) return null;
                                return (
                                    <div key={def.type}>
                                        <div className="text-sm text-gray-400 mb-2 flex items-center gap-2">
                                            <span>{def.icon || '🔌'}</span>
                                            <span>{def.name}</span>
                                            <span className="text-xs text-gray-600">({items.length})</span>
                                        </div>
                                        <div className="space-y-2">
                                            {items.map((item) => (
                                                <div key={item.id} className="bg-gray-900 border border-gray-700 rounded-lg p-3 flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="text-white font-medium">{item.name}</div>
                                                        <div className="text-xs text-gray-500 mt-1">Тип: {def.name} · {item.isActive ? 'Активний' : 'Неактивний'}</div>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => setModalConnector(item)}
                                                            className="px-3 py-1 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
                                                        >
                                                            Редагувати
                                                        </button>
                                                        <button
                                                            onClick={() => deleteOne(item)}
                                                            className="px-3 py-1 text-xs rounded border border-red-800 text-red-400 hover:bg-red-900/30"
                                                        >
                                                            Видалити
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {(modalConnector !== undefined) && (
                <ConnectorModal
                    connector={modalConnector}
                    connectorDefs={connectorDefs}
                    onClose={() => setModalConnector(undefined)}
                    onSaved={() => {
                        setModalConnector(undefined);
                        load();
                    }}
                />
            )}
        </div>
    );
}
