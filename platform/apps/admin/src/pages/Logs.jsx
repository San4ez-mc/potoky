import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';

const TABS = [
    { id: 'all', label: 'Всі' },
    { id: 'claude', label: 'Claude' },
    { id: 'telegram', label: 'Telegram' },
    { id: 'sheets', label: 'Google Sheets' },
    { id: 'errors', label: 'Помилки' },
];

export function Logs() {
    const [activeTab, setActiveTab] = useState('all');
    const [logs, setLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredLogs, setFilteredLogs] = useState([]);
    const [expandedId, setExpandedId] = useState(null);

    useEffect(() => {
        const fetchLogs = async () => {
            setIsLoading(true);
            try {
                const res = await api.getLogs(activeTab);
                setLogs(res || []);
            } catch (err) {
                console.error('Failed to fetch logs:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchLogs();
    }, [activeTab]);

    useEffect(() => {
        const filtered = logs.filter(log =>
            !searchQuery ||
            log.message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            log.service?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            log.botId?.toLowerCase().includes(searchQuery.toLowerCase())
        );
        setFilteredLogs(filtered);
    }, [logs, searchQuery]);

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-2">Логи</h1>
                <p className="text-gray-400">API запити, помилки та діагностика</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-gray-700">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === tab.id
                                ? 'text-brand-light border-b-2 border-brand'
                                : 'text-gray-400 hover:text-white'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="mb-6">
                <input
                    type="text"
                    placeholder="Пошук по повідомленню, сервісу або ботом..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand"
                />
            </div>

            {/* Logs List */}
            {isLoading ? (
                <div className="text-center text-gray-400 py-8">Завантаження логів...</div>
            ) : filteredLogs.length === 0 ? (
                <div className="text-center text-gray-400 py-8">Немає логів для показу</div>
            ) : (
                <div className="space-y-2">
                    {filteredLogs.map(log => (
                        <div
                            key={log.id}
                            onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                            className={`bg-gray-800 border border-gray-700 rounded-lg p-4 cursor-pointer transition-colors ${expandedId === log.id ? 'border-brand bg-gray-750' : 'hover:bg-gray-750'
                                }`}
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`px-2 py-1 rounded text-xs font-semibold ${log.level === 'error' ? 'bg-red-900/40 text-red-400' :
                                                log.level === 'warn' ? 'bg-yellow-900/40 text-yellow-400' :
                                                    'bg-blue-900/40 text-blue-400'
                                            }`}>
                                            {log.level?.toUpperCase()}
                                        </span>
                                        <span className="text-xs text-gray-500">{log.service}</span>
                                    </div>
                                    <p className="text-white text-sm truncate">{log.message}</p>
                                    {log.botId && <p className="text-xs text-gray-500 mt-1">Бот: {log.botId}</p>}
                                </div>
                                <div className="text-right shrink-0">
                                    <time className="text-xs text-gray-500 block">{new Date(log.createdAt).toLocaleString('uk-UA')}</time>
                                </div>
                            </div>

                            {/* Expanded details */}
                            {expandedId === log.id && (
                                <div className="mt-4 pt-4 border-t border-gray-700 space-y-3">
                                    {log.request && (
                                        <div>
                                            <div className="text-xs font-semibold text-gray-400 mb-1">Request:</div>
                                            <pre className="bg-gray-900 rounded px-3 py-2 text-xs text-gray-300 overflow-x-auto">
                                                {typeof log.request === 'string' ? log.request : JSON.stringify(log.request, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                    {log.response && (
                                        <div>
                                            <div className="text-xs font-semibold text-gray-400 mb-1">Response:</div>
                                            <pre className="bg-gray-900 rounded px-3 py-2 text-xs text-gray-300 overflow-x-auto">
                                                {typeof log.response === 'string' ? log.response : JSON.stringify(log.response, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                    {log.stack && (
                                        <div>
                                            <div className="text-xs font-semibold text-red-400 mb-1">Stack Trace:</div>
                                            <pre className="bg-gray-900 rounded px-3 py-2 text-xs text-red-300 overflow-x-auto">
                                                {log.stack}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
