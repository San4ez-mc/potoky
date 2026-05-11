import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { format } from 'date-fns';

const SVC_COLORS = {
    claude: 'bg-violet-900/40 text-violet-300 border-violet-800',
    telegram: 'bg-blue-900/40 text-blue-300 border-blue-800',
    google_sheets: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
};

export function ApiLogs() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [service, setService] = useState('');
    const [expanded, setExpanded] = useState(null);

    useEffect(() => {
        setLoading(true);
        api.getApiLogs(service ? { service } : {})
            .then(setLogs)
            .catch(() => setLogs([]))
            .finally(() => setLoading(false));
    }, [service]);

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-semibold text-white">API Логи</h1>
                <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
                    {['', 'claude', 'telegram', 'google_sheets'].map(s => (
                        <button
                            key={s}
                            onClick={() => setService(s)}
                            className={`text-sm px-3 py-1.5 rounded-md transition-colors ${service === s ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            {s || 'Всі'}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="text-gray-400">Завантаження...</div>
            ) : (
                <div className="space-y-1.5">
                    {logs.map(log => (
                        <div key={log.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                            <button
                                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors text-left"
                            >
                                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${SVC_COLORS[log.service] || 'bg-gray-800 text-gray-300 border-gray-700'}`}>
                                    {log.service}
                                </span>
                                <span className="text-sm text-white font-mono">{log.method}</span>
                                <span className={`text-xs ml-auto ${log.statusCode < 400 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {log.statusCode}
                                </span>
                                <span className="text-xs text-gray-500">{log.durationMs}ms</span>
                                <span className="text-xs text-gray-600">
                                    {log.createdAt ? format(new Date(log.createdAt), 'dd.MM HH:mm:ss') : ''}
                                </span>
                            </button>
                            {expanded === log.id && (
                                <div className="px-4 pb-3 bg-gray-950 border-t border-gray-800 space-y-2">
                                    {log.requestData && (
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Request</div>
                                            <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded p-2 overflow-x-auto max-h-40">
                                                {JSON.stringify(log.requestData, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                    {log.responseData && (
                                        <div>
                                            <div className="text-xs text-gray-500 mb-1">Response</div>
                                            <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded p-2 overflow-x-auto max-h-40">
                                                {JSON.stringify(log.responseData, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                    {log.error && <div className="text-xs text-red-400">{log.error}</div>}
                                </div>
                            )}
                        </div>
                    ))}
                    {logs.length === 0 && <div className="text-center text-gray-500 py-12">Немає логів</div>}
                </div>
            )}
        </div>
    );
}
