import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';

function Stat({ label, value }) {
    return (
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
            <div className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</div>
            <div className="text-base font-semibold text-white mt-0.5">{value ?? 0}</div>
        </div>
    );
}

export function Projects() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getProjects()
            .then(async (list) => {
                const withStats = await Promise.all(
                    list.map(async (project) => {
                        const [stats, bots] = await Promise.all([
                            api.getProjectStats(project.id).catch(() => ({ totalUsers: 0, activeUsers: 0, errorsLast24h: 0 })),
                            api.getProjectBots(project.id).catch(() => []),
                        ]);
                        return { ...project, stats, botsCount: bots.length };
                    })
                );
                setProjects(withStats);
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-gray-400">Завантаження...</div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-4">
            <div>
                <h1 className="text-xl font-semibold text-white">Проєкти</h1>
                <p className="text-sm text-gray-400 mt-1">Огляд по кожному проєкту: боти, юзери, активність та помилки.</p>
            </div>

            <div className="space-y-3">
                {projects.map((project) => (
                    <div key={project.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <div className="flex items-center justify-between gap-4 mb-3">
                            <div>
                                <div className="text-base font-semibold text-white">{project.name}</div>
                                <div className="text-xs text-gray-500 font-mono">/{project.slug}</div>
                            </div>
                            <span className="text-xs px-2 py-1 rounded-full border border-gray-700 text-gray-300">
                                Ботів: {project.botsCount}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <Stat label="Юзери" value={project.stats?.totalUsers ?? 0} />
                            <Stat label="Активні" value={project.stats?.activeUsers ?? 0} />
                            <Stat label="Помилки 24г" value={project.stats?.errorsLast24h ?? 0} />
                            <Stat label="ID" value={project.id.slice(0, 8)} />
                        </div>
                    </div>
                ))}

                {projects.length === 0 && (
                    <div className="text-gray-500 text-sm py-10 text-center">Немає проєктів</div>
                )}
            </div>
        </div>
    );
}
