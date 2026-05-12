import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';

export function Bots() {
    const [projects, setProjects] = useState([]);
    const [rows, setRows] = useState([]);
    const [projectFilter, setProjectFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [runningBotId, setRunningBotId] = useState(null);
    const [runReports, setRunReports] = useState({});
    const navigate = useNavigate();

    const runRegression = async (botId) => {
        setRunningBotId(botId);
        try {
            const report = await api.runBotRegression(botId);
            setRunReports((prev) => ({
                ...prev,
                [botId]: {
                    ok: true,
                    finalState: report.finalState,
                    historyCount: report.historyCount,
                    source: report.legend?.source || 'fallback',
                    at: new Date().toISOString(),
                },
            }));
        } catch (error) {
            setRunReports((prev) => ({
                ...prev,
                [botId]: {
                    ok: false,
                    error: error.message || 'Regression failed',
                    at: new Date().toISOString(),
                },
            }));
        } finally {
            setRunningBotId(null);
        }
    };

    useEffect(() => {
        api.getProjects()
            .then(async (projs) => {
                const withBots = await Promise.all(
                    projs.map(async (p) => ({
                        ...p,
                        bots: await api.getProjectBots(p.id).catch(() => []),
                    }))
                );
                setProjects(withBots.map(p => ({ id: p.id, name: p.name, slug: p.slug })));

                const allRows = withBots.flatMap((project) =>
                    (project.bots || []).map((bot) => ({
                        ...bot,
                        projectId: project.id,
                        projectName: project.name,
                        projectSlug: project.slug,
                    }))
                );

                setRows(allRows);
            })
            .finally(() => setLoading(false));
    }, []);

    const filteredRows = useMemo(() => {
        if (projectFilter === 'all') return rows;
        return rows.filter(row => row.projectId === projectFilter);
    }, [rows, projectFilter]);

    if (loading) return (
        <div className="flex items-center justify-center h-full">
            <div className="text-gray-400">Завантаження...</div>
        </div>
    );

    return (
        <div className="p-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-white">Воронки</h1>
                    <p className="text-sm text-gray-400">Список усіх воронок з основними показниками.</p>
                </div>
                <div className="w-full md:w-72">
                    <label className="text-xs text-gray-500 block mb-1">Фільтр по проєкту</label>
                    <select
                        value={projectFilter}
                        onChange={(e) => setProjectFilter(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                    >
                        <option value="all">Всі проєкти</option>
                        {projects.map(project => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full min-w-[980px]">
                    <thead>
                        <tr className="border-b border-gray-800 bg-gray-950/70">
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Воронка</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Проєкт</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Юзери</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Сесії</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Активні</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Помилки</th>
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">Оновлено</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRows.map((bot) => (
                            <tr key={bot.id} className="border-b border-gray-800/60 hover:bg-gray-800/35 transition-colors align-top">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-white">{bot.name}</div>
                                    <div className="text-xs text-gray-500 font-mono">/{bot.slug}</div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-300">{bot.projectName}</td>
                                <td className="px-4 py-3 text-sm text-gray-300">{bot.metrics?.usersCount ?? 0}</td>
                                <td className="px-4 py-3 text-sm text-gray-300">{bot.metrics?.totalSessions ?? 0}</td>
                                <td className="px-4 py-3 text-sm text-emerald-400">{bot.metrics?.activeSessions ?? 0}</td>
                                <td className="px-4 py-3 text-sm">
                                    <span className={(bot.metrics?.unresolvedErrors ?? 0) > 0 ? 'text-red-400' : 'text-gray-400'}>
                                        {bot.metrics?.unresolvedErrors ?? 0}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-500">
                                    {bot.metrics?.flowUpdatedAt ? format(new Date(bot.metrics.flowUpdatedAt), 'dd.MM.yyyy HH:mm') : '—'}
                                    {runReports[bot.id] && (
                                        <div className={[
                                            'mt-1 text-[11px]',
                                            runReports[bot.id].ok ? 'text-emerald-400' : 'text-red-400',
                                        ].join(' ')}>
                                            {runReports[bot.id].ok
                                                ? `test ok | state: ${runReports[bot.id].finalState || 'unknown'} | legend: ${runReports[bot.id].source}`
                                                : `test failed: ${runReports[bot.id].error}`}
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => runRegression(bot.id)}
                                            disabled={runningBotId === bot.id}
                                            className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            {runningBotId === bot.id ? 'Тестується...' : 'Тест'}
                                        </button>
                                        <button
                                            onClick={() => navigate(`/funnel/${bot.id}`)}
                                            className="px-3 py-1.5 bg-brand/20 hover:bg-brand/30 text-brand-light text-xs rounded-lg transition-colors"
                                        >
                                            Редагувати
                                        </button>
                                        <button
                                            onClick={() => navigate(`/bots/${bot.id}/sessions`)}
                                            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
                                        >
                                            Сесії
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredRows.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-4 py-12 text-center text-gray-500 text-sm">Немає воронок за обраним фільтром</td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-800">
                    Всього воронок: {filteredRows.length}
                </div>
            </div>
        </div>
    );
}
