import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';

// ── ConnectorModal — creates/edits a SavedConnector (instance with real keys) ──

function ConnectorModal({ connector, connectorDefs, onClose, onSave }) {
    const isEdit = Boolean(connector?.id);
    const defaultType = connector?.type || (connectorDefs[0]?.type ?? '');

    const [form, setForm] = useState({
        name: connector?.name || '',
        type: connector?.type || defaultType,
        description: connector?.description || '',
        config: connector?.config || {},
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const def = connectorDefs.find(d => d.type === form.type);
    const fields = def?.schema?.fields || [];

    const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));
    const setConfig = (key, value) => setForm(f => ({ ...f, config: { ...f.config, [key]: value } }));

    const handleTypeChange = (newType) => {
        setForm(f => ({ ...f, type: newType, config: {} }));
    };

    const handleSave = async () => {
        if (!form.name.trim()) { setError("азва обов'язкова"); return; }
        if (!form.type) { setError("Тип конектора обов'язковий"); return; }
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
            setError(err.message || 'омилка збереження');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
                    <h2 className="text-lg font-semibold text-white">
                        {isEdit ? 'едагувати збережений конектор' : 'берегти новий конектор'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">x</button>
                </div>

                <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Тип конектора (шаблон)</label>
                        <select
                            value={form.type}
                            onChange={e => handleTypeChange(e.target.value)}
                            disabled={isEdit}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-60"
                        >
                            {connectorDefs.map(d => (
                                <option key={d.type} value={d.type}>{d.icon} {d.name}</option>
                            ))}
                        </select>
                        {def && def.description && (
                            <p className="text-xs text-gray-500 mt-1">{def.description}</p>
                        )}
                        {def && def.schema && def.schema.docs_url && (
                            <a href={def.schema.docs_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 mt-0.5 block">
                                окументація API
                            </a>
                        )}
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-1">азва *</label>
                        <input
                            value={form.name}
                            onChange={e => setField('name', e.target.value)}
                            placeholder={def ? def.name + " основний" : "азва конектора"}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        />
                        <p className="text-xs text-gray-600 mt-1">е ім'я відображатиметься при виборі у воронці</p>
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-1">отатка (необов'язково)</label>
                        <input
                            value={form.description}
                            onChange={e => setField('description', e.target.value)}
                            placeholder="априклад: для основних ботів, ліміт $50/міс"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        />
                    </div>

                    {fields.length > 0 && (
                        <div className="space-y-3">
                            <div className="text-xs text-gray-400 font-medium uppercase tracking-wider border-t border-gray-800 pt-3">
                                блікові дані / ключі
                            </div>
                            {fields.map(field => (
                                <div key={field.key}>
                                    <label className="text-xs text-gray-400 block mb-1">{field.label}</label>
                                    {field.multiline ? (
                                        <textarea
                                            value={form.config[field.key] || ''}
                                            onChange={e => setConfig(field.key, e.target.value)}
                                            placeholder={field.placeholder || ''}
                                            rows={4}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500 resize-y"
                                        />
                                    ) : (
                                        <input
                                            type={field.secret ? 'password' : 'text'}
                                            value={form.config[field.key] || ''}
                                            onChange={e => setConfig(field.key, e.target.value)}
                                            placeholder={field.placeholder || ''}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500"
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {fields.length === 0 && (
                        <div className="space-y-3">
                            <div className="text-xs text-gray-400 font-medium uppercase tracking-wider border-t border-gray-800 pt-3">
                                овільні поля конфігурації
                            </div>
                            {Object.entries(form.config).map(([k, v]) => (
                                <div key={k} className="flex gap-2 items-center">
                                    <input readOnly value={k} className="w-32 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 font-mono" />
                                    <input value={v} onChange={e => setConfig(k, e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white" />
                                    <button onClick={() => { const c = { ...form.config }; delete c[k]; setField('config', c); }} className="text-red-400 hover:text-red-300 px-2 text-sm">x</button>
                                </div>
                            ))}
                            <button
                                onClick={() => { const key = prompt('азва поля (ключ):'); if (key) setConfig(key, ''); }}
                                className="w-full py-1.5 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-gray-400 text-xs transition-colors"
                            >
                                + одати поле
                            </button>
                        </div>
                    )}

                    {error && <div className="text-red-400 text-sm bg-red-900/20 rounded px-3 py-2">{error}</div>}
                </div>

                <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                        Скасувати
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        {saving ? 'береження...' : isEdit ? 'берегти зміни' : 'берегти конектор'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function Connectors() {
    const [connectorDefs, setConnectorDefs] = useState([]);
    const [savedConnectors, setSavedConnectors] = useState([]);
    const [globalKeys, setGlobalKeys] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingKey, setEditingKey] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [modal, setModal] = useState(null);

    const projectId = localStorage.getItem('projectId');

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [defsRes, savedRes, keysRes] = await Promise.allSettled([
                api.getConnectors(),
                api.getSavedConnectors(),
                projectId ? api.getGlobalKeys(projectId) : Promise.resolve([]),
            ]);
            setConnectorDefs(defsRes.status === 'fulfilled' ? (defsRes.value?.data || []) : []);
            setSavedConnectors(savedRes.status === 'fulfilled' ? (savedRes.value?.data || []) : []);
            setGlobalKeys(keysRes.status === 'fulfilled' && Array.isArray(keysRes.value) ? keysRes.value : []);
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
        } catch (err) { console.error(err); }
    };

    const handleSaveKey = async () => {
        if (!projectId || !editingKey) return;
        try {
            const key = globalKeys.find(k => k.key === editingKey);
            await api.upsertGlobalKey(projectId, editingKey, key?.label || editingKey, editValue, key?.isSecret || false, key?.description || '');
            setEditingKey(null);
            setEditValue('');
            await loadData();
        } catch (err) { console.error(err); }
    };

    const handleDeleteKey = async (keyName) => {
        if (!projectId || !window.confirm('идалити ключ ' + keyName + '?')) return;
        try { await api.deleteGlobalKey(projectId, keyName); await loadData(); } catch (err) { console.error(err); }
    };

    const handleDeleteConnector = async (id, name) => {
        if (!window.confirm('идалити збережений конектор "' + name + '"?')) return;
        try { await api.deleteSavedConnector(id); await loadData(); } catch (err) { console.error(err); }
    };

    const savedByType = savedConnectors.reduce((acc, sc) => {
        if (!acc[sc.type]) acc[sc.type] = [];
        acc[sc.type].push(sc);
        return acc;
    }, {});

    return (
        <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h1 className="text-xl font-semibold text-white">онектори</h1>
                <p className="text-sm text-gray-400 mt-2">
                    <strong className="text-gray-300">Шаблон конектора</strong> — тип інтеграції (наприклад, "Claude Sonnet"), який описує потрібні поля та як відправляти запити.{' '}
                    <strong className="text-gray-300">бережений конектор</strong> — ваш екземпляр із заповненими ключами. априклад, "Sonnet основний" та "Sonnet додатковий" — два збережені конектори одного типу з різними API ключами.
                </p>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-white mb-1">оступні типи конекторів</h2>
                <p className="text-xs text-gray-500 mb-4">Системні шаблони. беріть тип щоб зберегти свій конектор із ключами.</p>

                {isLoading ? (
                    <div className="text-center text-gray-400 py-8">авантаження...</div>
                ) : connectorDefs.length === 0 ? (
                    <div className="text-center text-gray-500 py-8 text-sm">
                        емає шаблонів. апустіть: <code className="font-mono bg-gray-700 px-1 rounded">yarn seed:connector-defs</code>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {connectorDefs.map(def => {
                            const count = savedByType[def.type]?.length || 0;
                            return (
                                <div key={def.type} className="bg-gray-900 rounded-xl border border-gray-700 p-4 flex flex-col gap-2 hover:border-gray-500 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="text-2xl">{def.icon || '?'}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-white text-sm">{def.name}</div>
                                            <div className="text-xs text-gray-500 font-mono">{def.type}</div>
                                        </div>
                                        {count > 0 && (
                                            <span className="text-xs bg-blue-900/40 text-blue-400 border border-blue-800 rounded-full px-2 py-0.5">{count}</span>
                                        )}
                                    </div>
                                    {def.description && (
                                        <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{def.description}</p>
                                    )}
                                    {def.schema && def.schema.fields && def.schema.fields.length > 0 && (
                                        <div className="text-xs text-gray-600">
                                            оля: {def.schema.fields.map(f => f.label).join(', ')}
                                        </div>
                                    )}
                                    <button
                                        onClick={() => setModal({ connector: { type: def.type } })}
                                        className="mt-auto w-full py-1.5 rounded-lg border border-dashed border-gray-600 text-gray-400 hover:text-white hover:border-blue-500 hover:bg-blue-950/30 text-xs transition-colors"
                                    >
                                        + берегти конектор цього типу
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold text-white">бережені конектори</h2>
                        <p className="text-xs text-gray-500 mt-0.5">аші екземпляри з заповненими ключами</p>
                    </div>
                    {connectorDefs.length > 0 && (
                        <button
                            onClick={() => setModal({ connector: null })}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            + овий
                        </button>
                    )}
                </div>

                {isLoading ? (
                    <div className="text-center text-gray-400">авантаження...</div>
                ) : savedConnectors.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="text-3xl mb-3">🔑</div>
                        <div className="text-gray-400 text-sm">Ще немає збережених конекторів</div>
                        <div className="text-gray-600 text-xs mt-1">беріть тип вище і збережіть ваші ключі</div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {connectorDefs.filter(d => savedByType[d.type] && savedByType[d.type].length > 0).map(def => (
                            <div key={def.type}>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-base">{def.icon || '?'}</span>
                                    <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">{def.name}</span>
                                    <span className="bg-gray-700 text-gray-400 rounded-full px-2 py-0.5 text-xs">{savedByType[def.type].length}</span>
                                </div>
                                <div className="space-y-2 pl-1">
                                    {savedByType[def.type].map(item => (
                                        <div key={item.id} className="bg-gray-900 rounded-lg p-3 border border-gray-700 flex items-center gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-white text-sm">{item.name}</div>
                                                {item.description && <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>}
                                                <div className="text-xs text-gray-700 mt-1 font-mono">
                                                    {Object.keys(item.config || {}).map(k => k + ': ...').join(' | ') || 'емає полів'}
                                                </div>
                                            </div>
                                            <div className="flex gap-2 shrink-0">
                                                <button onClick={() => setModal({ connector: item })} className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded text-xs transition-colors">
                                                    едагувати
                                                </button>
                                                <button onClick={() => handleDeleteConnector(item.id, item.name)} className="px-3 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs transition-colors">
                                                    идалити
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

            {projectId && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                    <h2 className="text-lg font-semibold text-white mb-1">лобальні ключі проекту</h2>
                    <p className="text-xs text-gray-500 mb-4">мінні середовища, доступні всім ботам у проекті.</p>
                    {globalKeys.length === 0 ? (
                        <div className="text-center text-gray-500 py-8 text-sm">емає налаштованих ключів</div>
                    ) : (
                        <div className="space-y-3">
                            {globalKeys.map(item => (
                                <div key={item.key} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                            <div className="font-mono text-sm text-blue-400">{item.key}</div>
                                            <div className="text-xs text-gray-400 mt-1">{item.label}</div>
                                            {item.description && <div className="text-xs text-gray-500 mt-1">{item.description}</div>}
                                            {editingKey === item.key ? (
                                                <div className="mt-3 space-y-2">
                                                    <textarea value={editValue} onChange={e => setEditValue(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white" rows={3} />
                                                    <div className="flex gap-2">
                                                        <button onClick={handleSaveKey} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs">берегти</button>
                                                        <button onClick={() => { setEditingKey(null); setEditValue(''); }} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs">Скасувати</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-xs text-gray-600 mt-2 font-mono">{item.isSecret ? '........' : item.value}</div>
                                            )}
                                        </div>
                                        {editingKey !== item.key && (
                                            <div className="flex gap-2 shrink-0">
                                                {item.isSecret && (
                                                    <button onClick={() => handleRevealKey(item.key)} className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded text-xs">оказати</button>
                                                )}
                                                <button onClick={() => handleRevealKey(item.key)} className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded text-xs">едагувати</button>
                                                <button onClick={() => handleDeleteKey(item.key)} className="px-3 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded text-xs">идалити</button>
                                            </div>
                                        )}
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
                    connectorDefs={connectorDefs}
                    onClose={() => setModal(null)}
                    onSave={() => { setModal(null); loadData(); }}
                />
            )}
        </div>
    );
}