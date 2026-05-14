import React, { useMemo, useState, useEffect } from 'react';
import { api } from '../api/client.js';

function KeysSection() {
    const [keys, setKeys] = useState([]);
    const [selectedKey, setSelectedKey] = useState('CLAUDE_API_KEY');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [showValue, setShowValue] = useState(false);
    const [form, setForm] = useState({
        key: 'CLAUDE_API_KEY',
        label: '',
        description: '',
        isSecret: true,
        value: '',
    });

    const applySelectedKey = (keyName, list) => {
        const item = (list || []).find((x) => x.key === keyName) || (list || [])[0] || null;
        if (!item) return;
        setSelectedKey(item.key);
        setShowValue(false);
        setForm({
            key: item.key,
            label: item.label || item.key,
            description: item.description || '',
            isSecret: item.isSecret !== false,
            value: '',
        });
    };

    const loadKeys = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await api.getSystemKeys();
            const list = data || [];
            setKeys(list);
            applySelectedKey(selectedKey, list);
        } catch (err) {
            setError(err.message || 'Не вдалося завантажити системні ключі');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadKeys();
    }, []);

    const reveal = async () => {
        setError('');
        try {
            const res = await api.revealSystemKey(form.key);
            setForm((prev) => ({ ...prev, value: res.value || '' }));
            setShowValue(true);
        } catch (err) {
            setError(err.message || 'Не вдалося показати значення ключа');
        }
    };

    const save = async () => {
        if (!form.value.trim()) {
            setError('Введіть значення ключа');
            return;
        }
        setSaving(true);
        setError('');
        setSaved(false);
        try {
            await api.upsertSystemKey(form.key, form.value.trim(), form.label, form.description, true);
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
            await loadKeys();
            setShowValue(false);
            setForm((prev) => ({ ...prev, value: '' }));
        } catch (err) {
            setError(err.message || 'Не вдалося зберегти ключ');
        } finally {
            setSaving(false);
        }
    };
    const current = keys.find((item) => item.key === form.key);

    return (
        <div className="space-y-6">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-white mb-1">Ключі системних конекторів</h2>
                <p className="text-sm text-gray-400 mb-4">
                    Ці ключі використовуються платформою глобально. Тут налаштовуються Claude API, Telegram ID адміна та ціна курсу.
                </p>

                {loading ? (
                    <div className="text-gray-400">Завантаження...</div>
                ) : (
                    <div className="mb-4 rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-2">
                        {keys.map((item) => (
                            <button
                                key={item.key}
                                onClick={() => applySelectedKey(item.key, keys)}
                                className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${selectedKey === item.key ? 'border-brand bg-gray-800' : 'border-gray-700 hover:border-gray-500 bg-gray-900'}`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <div className="text-sm text-white font-medium">{item.key}</div>
                                        <div className="text-xs text-gray-500">{item.description}</div>
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${item.exists ? 'text-emerald-300 border-emerald-800 bg-emerald-900/30' : 'text-red-300 border-red-800 bg-red-900/30'}`}>
                                        {item.exists ? 'Налаштовано' : 'Не налаштовано'}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                <div className="space-y-3">
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Ключ</label>
                        <input
                            value={form.key}
                            disabled
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400 font-mono"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Назва</label>
                        <input
                            value={form.label}
                            onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Значення</label>
                        <div className="flex gap-2">
                            <input
                                type={form.isSecret && !showValue ? 'password' : 'text'}
                                value={form.value}
                                onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
                                placeholder={form.key === 'CLAUDE_API_KEY' ? 'sk-ant-api03-...' : 'Введіть значення'}
                                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                            />
                            {form.isSecret && (
                                <button
                                    onClick={() => setShowValue((v) => !v)}
                                    className="px-3 py-2 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
                                >
                                    {showValue ? 'Сховати' : 'Показати'}
                                </button>
                            )}
                            <button
                                onClick={reveal}
                                className="px-3 py-2 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
                                title="Підтягнути поточне значення з БД у поле"
                            >
                                Підтягнути з БД
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Опис</label>
                        <input
                            value={form.description}
                            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                        />
                    </div>

                    {current?.updatedAt && (
                        <div className="text-xs text-gray-500">Оновлено: {new Date(current.updatedAt).toLocaleString('uk-UA')}</div>
                    )}

                    {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">{error}</div>}
                    {saved && <div className="text-sm text-emerald-300 bg-emerald-900/20 border border-emerald-900/40 rounded px-3 py-2">Ключ збережено</div>}

                    <div className="flex justify-end">
                        <button
                            onClick={save}
                            disabled={saving}
                            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white"
                        >
                            {saving ? 'Збереження...' : 'Зберегти ключ'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function Settings() {
    const [copied, setCopied] = useState('');
    const [activeSection, setActiveSection] = useState('mcp');
    const [mcpConfig, setMcpConfig] = useState(null);

    useEffect(() => {
        api.getMcpConfig()
            .then((data) => setMcpConfig(data || null))
            .catch(() => setMcpConfig(null));
    }, []);

    const endpoints = useMemo(() => ([
        {
            id: 'flows',
            icon: '🔗',
            name: 'Flows MCP',
            description: 'Читання воронок, нод, конекторів, статистики',
            tools: 6,
            url: mcpConfig?.flowsUrl || 'https://flows.fineko.space/api/mcp',
        },
        {
            id: 'flows-edit',
            icon: '✏️',
            name: 'Flows Edit MCP',
            description: 'Створення і редагування ботів, нод, ключів',
            tools: 10,
            url: mcpConfig?.flowsEditUrl || 'https://flows.fineko.space/api/mcp-edit',
        },
        {
            id: 'debug',
            icon: '🐛',
            name: 'Debug MCP',
            description: 'Сесії, логи помилок, тест-сесії, історія повідомлень',
            tools: 10,
            url: mcpConfig?.debugUrl || 'https://flows.fineko.space/api/mcp-debug',
        },
    ]), [mcpConfig]);

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(text);
        setTimeout(() => setCopied(''), 2000);
    };

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-2">Налаштування</h1>
                <p className="text-gray-400">Конфігурація та інтеграції</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 mb-6 border-b border-gray-700">
                {[
                    { id: 'mcp', label: '🧠 MCP' },
                    { id: 'keys', label: '🔑 Ключі' },
                    { id: 'account', label: '👤 Акаунт', desc: 'Мій профіль' },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveSection(tab.id)}
                        className={`px-4 py-3 text-sm font-medium transition-colors ${activeSection === tab.id
                            ? 'text-brand-light border-b-2 border-brand'
                            : 'text-gray-400 hover:text-white'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* MCP Section */}
            {activeSection === 'mcp' && (
                <div className="space-y-6">
                    <div className="space-y-3">
                        {endpoints.map((endpoint) => (
                            <div key={endpoint.id} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h2 className="text-white font-semibold">{endpoint.icon} {endpoint.name}</h2>
                                        <p className="text-sm text-gray-400 mt-0.5">{endpoint.description}</p>
                                        <div className="text-xs text-gray-500 mt-1">{endpoint.tools} tools</div>
                                        <div className="mt-2 bg-gray-900 border border-gray-700 rounded px-3 py-2">
                                            <code className="text-xs text-blue-300 break-all">{endpoint.url}</code>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => copyToClipboard(endpoint.url)}
                                        className="shrink-0 px-3 py-1.5 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
                                    >
                                        {copied === endpoint.url ? 'Скопійовано' : 'Копіювати'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                        <div className="space-y-4">
                            <h3 className="font-semibold text-white">Інструкція:</h3>
                            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
                                <li>Перейдіть на claude.ai</li>
                                <li>Натисніть на вашу аватарку → Settings → Custom Models</li>
                                <li>Натисніть "Connect a custom model server"</li>
                                <li>Вставте URL вище і натисніть "Connect"</li>
                                <li>Виберіть сервер і почніть використовувати bot-management tools</li>
                            </ol>
                        </div>
                    </div>
                </div>
            )}

            {activeSection === 'keys' && <KeysSection />}

            {/* Account Section */}
            {activeSection === 'account' && (
                <div className="space-y-6">
                    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                        <h2 className="text-lg font-semibold text-white mb-4">👤 Мій профіль</h2>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-gray-400 block mb-2">Пошта</label>
                                <input
                                    type="email"
                                    defaultValue="admin@fineko.space"
                                    disabled
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-400"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-2">Роль</label>
                                <input
                                    type="text"
                                    defaultValue="Super Admin"
                                    disabled
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-400"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-2">API токен</label>
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        defaultValue="••••••••••••••••"
                                        disabled
                                        className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-400"
                                    />
                                    <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors">
                                        Показати
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 pt-6 border-t border-gray-700">
                            <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors mr-2">
                                Змінити пароль
                            </button>
                            <button className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-sm transition-colors">
                                Вийти з усіх сеансів
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
