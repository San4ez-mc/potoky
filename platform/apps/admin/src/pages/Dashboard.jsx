import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';

function StatCard({ label, value, icon, sub }) {
    return (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
                <span className="text-gray-400 text-sm">{label}</span>
                <span className="text-2xl">{icon}</span>
            </div>
            <div className="text-3xl font-bold text-white">{value ?? '—'}</div>
            {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
        </div>
    );
}

export function Dashboard() {
    const [analytics, setAnalytics] = useState(null);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([api.getAnalytics(), api.getProjects()])
            .then(([a, p]) => { setAnalytics(a); setProjects(p); })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center h-full">
            <div className="text-gray-400">Завантаження...</div>
        </div>
    );

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-xl font-semibold text-white">Дашборд</h1>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Всього сесій" value={analytics?.totalSessions} icon="💬" />
                <StatCard label="Активних сесій" value={analytics?.activeSessions} icon="🟢" />
                <StatCard label="Користувачів" value={analytics?.totalUsers} icon="👥" />
                <StatCard label="API викликів сьогодні" value={analytics?.apiCallsToday} icon="📡" />
            </div>

            {/* Projects */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-semibold text-white">Проєкти</h2>
                    <Link to="/funnels" className="text-sm text-brand-light hover:text-brand">Всі воронки →</Link>
                </div>
                <div className="space-y-3">
                    {projects.map(project => (
                        <div key={project.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-brand/20 rounded-lg flex items-center justify-center">
                                    <span className="text-brand-light font-bold text-lg">{project.name[0]}</span>
                                </div>
                                <div className="flex-1">
                                    <div className="font-medium text-white">{project.name}</div>
                                    <div className="text-xs text-gray-500">{project.slug}</div>
                                </div>
                                <Link
                                    to="/funnels"
                                    className="text-sm text-brand-light hover:text-brand px-3 py-1.5 rounded-lg border border-brand/30 hover:border-brand/60 transition-colors"
                                >
                                    Воронки
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Recent errors */}
            {analytics?.recentErrors?.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-base font-semibold text-white">Останні помилки</h2>
                        <Link to="/errors" className="text-sm text-red-400 hover:text-red-300">Всі →</Link>
                    </div>
                    <div className="space-y-2">
                        {analytics.recentErrors.map(err => (
                            <div key={err.id} className="bg-red-950/30 border border-red-800/30 rounded-lg px-4 py-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <span className="text-red-400 text-sm font-medium">{err.errorType}</span>
                                        <p className="text-gray-300 text-sm mt-0.5 line-clamp-1">{err.message}</p>
                                    </div>
                                    <span className="text-xs text-gray-500 shrink-0">
                                        {format(new Date(err.createdAt), 'dd.MM HH:mm')}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
