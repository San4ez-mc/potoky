import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';

const MCP_URL = process.env.REACT_APP_MCP_URL || 'https://flows.fineko.space/mcp';

export function Settings() {
    const [copied, setCopied] = useState(false);
    const [activeSection, setActiveSection] = useState('mcp');
    const [globalKeys, setGlobalKeys] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingKey, setEditingKey] = useState(null);
    const [editValue, setEditValue] = useState('');

    const projectId = localStorage.getItem('projectId') || 'default-project-id';

    useEffect(() => {
        if (activeSection === 'keys') {
            loadGlobalKeys();
        }
    }, [activeSection]);

    const loadGlobalKeys = async () => {
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
        try {
            const result = await api.revealGlobalKey(projectId, keyName);
            setEditingKey(keyName);
            setEditValue(result.value);
        } catch (err) {
            console.error('Failed to reveal key:', err);
        }
    };

    const handleSaveKey = async () => {
        if (!editingKey || !editValue) return;
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
        if (!window.confirm(`Видалити ключ ${keyName}?`)) return;
        try {
            await api.deleteGlobalKey(projectId, keyName);
            await loadGlobalKeys();
        } catch (err) {
            console.error('Failed to delete key:', err);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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
                    { id: 'mcp', label: '🧠 MCP', desc: 'Claude підключення' },
                    { id: 'keys', label: '🔑 Ключі', desc: 'Глобальні ключі' },
                    { id: 'webhook', label: '🌐 Webhook', desc: 'Адреса вебхука' },
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
                    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                        <h2 className="text-lg font-semibold text-white mb-4">🧠 Підключення Claude via MCP</h2>
                        <p className="text-gray-400 mb-4">Використовуйте цю URL для підключення Claude до платформи:</p>

                        <div className="bg-gray-900 rounded-lg p-4 mb-4 border border-gray-700">
                            <code className="text-sm text-brand-light font-mono break-all">{MCP_URL}</code>
                        </div>

                        <button
                            onClick={() => copyToClipboard(MCP_URL)}
                            className="mb-6 px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-sm transition-colors"
                        >
                            {copied ? '✓ Скопійовано!' : '📋 Копіювати URL'}
                        </button>

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

            {/* Keys Section */}
            {activeSection === 'keys' && (
                <div className="space-y-6">
                    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                        <h2 className="text-lg font-semibold text-white mb-4">🔑 Глобальні ключи проекту</h2>
                        <p className="text-gray-400 mb-6">Ці ключи доступні всім ботам проекту</p>

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
                                                                onClick={() => setEditingKey(null)}
                                                                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs transition-colors"
                                                            >
                                                                Відмінити
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
            )}

            {/* Webhook Section */}
            {activeSection === 'webhook' && (
                <div className="space-y-6">
                    <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                        <h2 className="text-lg font-semibold text-white mb-4">🌐 Webhook URL</h2>
                        <p className="text-gray-400 mb-4">Адреса вебхука для отримання повідомлень від Telegram/Instagram</p>

                        <div className="bg-gray-900 rounded-lg p-4 mb-4 border border-gray-700">
                            <code className="text-sm text-brand-light font-mono break-all">https://flows.fineko.space/webhook</code>
                        </div>

                        <button
                            onClick={() => copyToClipboard('https://flows.fineko.space/webhook')}
                            className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-sm transition-colors"
                        >
                            📋 Копіювати адресу
                        </button>

                        <div className="mt-6 bg-blue-900/20 border border-blue-800 rounded-lg p-4">
                            <p className="text-sm text-blue-300">
                                ℹ️ Ця адреса автоматично використовується для кожного бота окремо через маршрути:
                                <code className="block mt-2 font-mono text-xs">/webhook/telegram/{"{"}<strong>botSlug</strong>{"}"}</code>
                                <code className="block font-mono text-xs">/webhook/instagram/{"{"}<strong>botSlug</strong>{"}"}</code>
                            </p>
                        </div>
                    </div>
                </div>
            )}

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
