import React, { useMemo, useState } from 'react';

export function Settings() {
    const [copied, setCopied] = useState('');
    const [activeSection, setActiveSection] = useState('mcp');

    const mcpToken = localStorage.getItem('mcpToken') || '<YOUR_MCP_TOKEN>';

    const endpoints = useMemo(() => ([
        {
            id: 'flows',
            icon: '🔗',
            name: 'Flows MCP',
            description: 'Читання воронок, нод, конекторів, статистики',
            tools: 6,
            url: `https://flows.fineko.space/api/mcp?token=${mcpToken}`,
        },
        {
            id: 'flows-edit',
            icon: '✏️',
            name: 'Flows Edit MCP',
            description: 'Створення і редагування ботів, нод, ключів',
            tools: 10,
            url: `https://flows.fineko.space/api/mcp-edit?token=${mcpToken}`,
        },
        {
            id: 'debug',
            icon: '🐛',
            name: 'Debug MCP',
            description: 'Сесії, логи помилок, тест-сесії, історія повідомлень',
            tools: 10,
            url: `https://flows.fineko.space/api/mcp-debug?token=${mcpToken}`,
        },
    ]), [mcpToken]);

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
