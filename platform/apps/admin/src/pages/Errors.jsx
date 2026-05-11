import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { format } from 'date-fns';

export function Errors() {
    const [errors, setErrors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('unresolved');

    useEffect(() => {
        setLoading(true);
        api.getErrors({ resolved: filter === 'resolved' })
            .then(setErrors)
            .catch(() => setErrors([]))
            .finally(() => setLoading(false));
    }, [filter]);

    const resolve = async (id) => {
        await api.resolveError(id);
        setErrors(e => e.filter(x => x.id !== id));
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-semibold text-white">Помилки</h1>
                <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
                    {['unresolved', 'resolved'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`text-sm px-3 py-1.5 rounded-md transition-colors ${filter === f ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            {f === 'unresolved' ? '🔴 Нові' : '✅ Вирішені'}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="text-gray-400">Завантаження...</div>
            ) : (
                <div className="space-y-2">
                    {errors.map(err => (
                        <div key={err.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs bg-red-900/40 text-red-400 border border-red-800 rounded px-2 py-0.5 font-mono">
                                            {err.errorType}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            {format(new Date(err.createdAt), 'dd.MM.yyyy HH:mm:ss')}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-200">{err.message}</p>
                                    {err.stack && (
                                        <pre className="text-xs text-gray-500 font-mono mt-2 line-clamp-3 overflow-hidden">
                                            {err.stack}
                                        </pre>
                                    )}
                                </div>
                                {!err.resolved && (
                                    <button
                                        onClick={() => resolve(err.id)}
                                        className="shrink-0 text-xs px-3 py-1.5 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-800 rounded-lg transition-colors"
                                    >
                                        Вирішити
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {errors.length === 0 && (
                        <div className="text-center text-gray-500 py-12">
                            {filter === 'unresolved' ? '🎉 Немає нових помилок' : 'Немає вирішених помилок'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
