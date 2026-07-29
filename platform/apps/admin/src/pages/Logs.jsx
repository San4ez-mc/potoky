import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client.js';

// Реальні логи = api_calls (Claude/Vertex/RAG тощо). Робочі вкладки лише ті, де є дані.
const TABS = [
    { id: 'all', label: 'Всі' },
    { id: 'ai', label: 'AI (Claude/Vertex)' },
    { id: 'errors', label: 'Помилки' },
];

// api_call → відображення
function mapLog(c) {
    const isErr = !!c.error || (c.statusCode && c.statusCode >= 400);
    return {
        id: c.id,
        level: isErr ? 'error' : 'info',
        service: c.service || '—',
        message: `${c.method || 'call'} · ${c.statusCode ?? '?'}${c.durationMs != null ? ` · ${c.durationMs}ms` : ''}`,
        request: c.requestData,
        response: c.responseData,
        stack: c.error || null,
        createdAt: c.createdAt,
        sessionId: c.sessionId,
    };
}

export function Logs() {
    const [activeTab, setActiveTab] = useState('all');
    const [raw, setRaw] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedId, setExpandedId] = useState(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let alive = true;
        setIsLoading(true);
        api.getLogs(150)
            .then((res) => { if (alive) setRaw((res?.data ?? res ?? []).map(mapLog)); })
            .catch((err) => console.error('Failed to fetch logs:', err))
            .finally(() => { if (alive) setIsLoading(false); });
        return () => { alive = false; };
    }, [tick]);

    const filteredLogs = useMemo(() => {
        let v = raw;
        if (activeTab === 'ai') v = v.filter((l) => /claude|vertex|rag|gemini|openai|gpt/i.test(l.service));
        else if (activeTab === 'errors') v = v.filter((l) => l.level === 'error');
        const q = searchQuery.trim().toLowerCase();
        if (q) v = v.filter((l) => (l.message || '').toLowerCase().includes(q) || (l.service || '').toLowerCase().includes(q));
        return v;
    }, [raw, activeTab, searchQuery]);

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="mb-4 flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-white mb-1">Логи</h1>
                    <p className="text-gray-400 text-sm">Реальні виклики зовнішніх API (Claude, Vertex, RAG) — успіх, тривалість, помилки.</p>
                </div>
                <button onClick={() => setTick((t) => t + 1)} className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 transition-colors">↻ Оновити</button>
            </div>

            <div className="flex gap-2 mb-4 border-b border-gray-700">
                {TABS.map((tab) => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === tab.id ? 'text-brand-light border-b-2 border-brand' : 'text-gray-400 hover:text-white'}`}>
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="mb-4">
                <input type="text" placeholder="Пошук по методу або сервісу…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand" />
            </div>

            {isLoading ? (
                <div className="text-center text-gray-400 py-8">Завантаження логів…</div>
            ) : filteredLogs.length === 0 ? (
                <div className="text-center text-gray-500 py-8 text-sm">Немає логів (ще не було зовнішніх викликів у цій категорії).</div>
            ) : (
                <div className="space-y-1.5">
                    {filteredLogs.map((log) => (
                        <div key={log.id} onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                            className={`bg-gray-800 border rounded-lg px-3 py-2 cursor-pointer transition-colors ${expandedId === log.id ? 'border-brand' : 'border-gray-700 hover:bg-gray-750'}`}>
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${log.level === 'error' ? 'bg-red-900/40 text-red-400' : 'bg-blue-900/40 text-blue-400'}`}>{log.level.toUpperCase()}</span>
                                    <span className="text-xs text-gray-400 shrink-0">{log.service}</span>
                                    <span className="text-sm text-white truncate">{log.message}</span>
                                </div>
                                <time className="text-[11px] text-gray-500 shrink-0">{new Date(log.createdAt).toLocaleString('uk-UA')}</time>
                            </div>
                            {expandedId === log.id && (
                                <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
                                    {log.stack && (
                                        <div><div className="text-xs font-semibold text-red-400 mb-1">Помилка:</div>
                                            <pre className="bg-gray-900 rounded px-3 py-2 text-xs text-red-300 overflow-x-auto whitespace-pre-wrap">{log.stack}</pre></div>
                                    )}
                                    {log.request && (
                                        <div><div className="text-xs font-semibold text-gray-400 mb-1">Request:</div>
                                            <pre className="bg-gray-900 rounded px-3 py-2 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">{typeof log.request === 'string' ? log.request : JSON.stringify(log.request, null, 2)}</pre></div>
                                    )}
                                    {log.response && (
                                        <div><div className="text-xs font-semibold text-gray-400 mb-1">Response:</div>
                                            <pre className="bg-gray-900 rounded px-3 py-2 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">{typeof log.response === 'string' ? log.response : JSON.stringify(log.response, null, 2)}</pre></div>
                                    )}
                                    {log.sessionId && <div className="text-[11px] text-gray-500">Сесія: {log.sessionId}</div>}
                                </div>
                            )}
                        </div>
                    ))}
                    <div className="text-xs text-gray-500 pt-2">Показано: {filteredLogs.length}</div>
                </div>
            )}
        </div>
    );
}
