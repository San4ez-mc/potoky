import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

export function Bots() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        api.getProjects()
            .then(async (projs) => {
                const withBots = await Promise.all(
                    projs.map(async (p) => ({
                        ...p,
                        bots: await api.getProjectBots(p.id).catch(() => []),
                    }))
                );
                setProjects(withBots);
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center h-full">
            <div className="text-gray-400">Завантаження...</div>
        </div>
    );

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-xl font-semibold text-white">Воронки</h1>
            <p className="text-sm text-gray-400">Основний блок платформи: відкрий воронку і далі керуй сесіями та юзерами.</p>

            {projects.map(project => (
                <div key={project.id}>
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">{project.name}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {project.bots?.map(bot => (
                            <div key={bot.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-600 transition-colors">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-10 h-10 bg-brand/20 rounded-lg flex items-center justify-center text-brand-light font-bold">
                                        {bot.name[0]}
                                    </div>
                                    <div>
                                        <div className="font-medium text-white">{bot.name}</div>
                                        <div className="text-xs text-gray-500 font-mono">/{bot.slug}</div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => navigate(`/funnel/${bot.id}`)}
                                        className="flex-1 py-1.5 bg-brand/20 hover:bg-brand/30 text-brand-light text-sm rounded-lg transition-colors"
                                    >
                                        🗺 Редагувати
                                    </button>
                                    <button
                                        onClick={() => navigate(`/bots/${bot.id}/sessions`)}
                                        className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
                                    >
                                        💬 Сесії
                                    </button>
                                    <button
                                        onClick={() => navigate('/users')}
                                        className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
                                    >
                                        👥 Юзери
                                    </button>
                                </div>
                            </div>
                        ))}
                        {(!project.bots || project.bots.length === 0) && (
                            <div className="text-gray-500 text-sm py-4">Немає ботів</div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
