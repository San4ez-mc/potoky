import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

const PERIODS = [
    { value: '24h', label: '24 год' },
    { value: '7d', label: '7 днів' },
    { value: '30d', label: '30 днів' },
    { value: 'all', label: 'Весь час' },
];

// Колонки таблиці: key — поле в даних, label — заголовок, hint — підказка, fmt — форматтер
const COLS = [
    { key: 'subscribers', label: '👥 Підписники', hint: 'Сесій стартувало' },
    { key: 'active', label: '🟢 Активні', hint: 'Сесії активні зараз' },
    { key: 'completed', label: '✅ Завершили', hint: 'Дійшли до кінця воронки', pct: 'conversionRate' },
    { key: 'reachedTarget', label: '💳 Оплата/офер', hint: 'Дійшли до оплати або офера демо', pct: 'reachedRate' },
    { key: 'unsubscribed', label: '👋 Відписались', hint: 'Відписались від воронки' },
    { key: 'clicks', label: '👆 Кліки', hint: 'Переходи з трекованих deep-links' },
];

export function FunnelsCompare() {
    const [period, setPeriod] = useState('30d');
    const [includeTest, setIncludeTest] = useState(false);
    const [projectFilter, setProjectFilter] = useState('');
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState('subscribers');
    const [sortDir, setSortDir] = useState('desc');
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        setLoading(true); setError('');
        api.getFunnelsCompare(period, '', includeTest)
            .then(r => setRows((r?.data ?? r) || []))
            .catch(e => setError(e.message || 'Помилка завантаження'))
            .finally(() => setLoading(false));
    }, [period, includeTest]);

    const projects = useMemo(() => Array.from(new Set(rows.map(r => r.project))).sort(), [rows]);

    const view = useMemo(() => {
        let v = rows;
        if (projectFilter) v = v.filter(r => r.project === projectFilter);
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            v = v.filter(r => (r.name || '').toLowerCase().includes(q) || (r.slug || '').toLowerCase().includes(q));
        }
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...v].sort((a, b) => {
            const av = a[sortKey], bv = b[sortKey];
            if (typeof av === 'string') return String(av).localeCompare(String(bv)) * dir;
            return ((av ?? 0) - (bv ?? 0)) * dir;
        });
    }, [rows, projectFilter, search, sortKey, sortDir]);

    const totals = useMemo(() => {
        const t = { subscribers: 0, active: 0, completed: 0, reachedTarget: 0, unsubscribed: 0, clicks: 0 };
        for (const r of view) for (const k of Object.keys(t)) t[k] += r[k] || 0;
        return t;
    }, [view]);

    function toggleSort(key) {
        if (sortKey === key) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
        else { setSortKey(key); setSortDir('desc'); }
    }
    const arrow = (key) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

    return (
        <div className="p-6 space-y-5">
            <div className="flex items-center gap-3 flex-wrap">
                <div>
                    <h1 className="text-lg font-semibold text-white">Аналітика воронок</h1>
                    <div className="text-xs text-gray-500">Ефективність усіх воронок в одній таблиці — сортуй по будь-якій колонці</div>
                </div>
                <div className="ml-auto flex gap-1 items-center flex-wrap">
                    {PERIODS.map(o => (
                        <button key={o.value} onClick={() => setPeriod(o.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === o.value ? 'bg-brand text-white' : 'bg-gray-900 border border-gray-700 text-gray-400 hover:bg-gray-800'}`}>
                            {o.label}
                        </button>
                    ))}
                    <label className="flex items-center gap-1.5 text-xs text-gray-400 ml-2 cursor-pointer">
                        <input type="checkbox" checked={includeTest} onChange={e => setIncludeTest(e.target.checked)} /> з тестами
                    </label>
                </div>
            </div>

            {/* Фільтри */}
            <div className="flex items-center gap-2 flex-wrap">
                <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
                    className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand">
                    <option value="">Усі проєкти</option>
                    {projects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук воронки…"
                    className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand flex-1 min-w-[180px]" />
                <span className="text-xs text-gray-500">{view.length} воронок</span>
            </div>

            {error && <div className="rounded-lg bg-red-900/20 border border-red-800/40 px-4 py-3 text-sm text-red-300">{error}</div>}

            {loading ? (
                <div className="text-gray-400 text-sm">Завантаження…</div>
            ) : (
                <div className="overflow-x-auto border border-gray-800 rounded-xl">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-900 text-gray-400 text-xs">
                                <th className="text-left font-medium px-3 py-2.5 sticky left-0 bg-gray-900">Воронка</th>
                                {COLS.map(c => (
                                    <th key={c.key} title={c.hint} onClick={() => toggleSort(c.key)}
                                        className="text-right font-medium px-3 py-2.5 cursor-pointer hover:text-white whitespace-nowrap select-none">
                                        {c.label}{arrow(c.key)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {view.map(r => (
                                <tr key={r.botId} className="border-t border-gray-800 hover:bg-gray-900/50">
                                    <td className="px-3 py-2.5 sticky left-0 bg-gray-950">
                                        <Link to={`/funnel/${r.botId}/analytics`} className="text-gray-100 hover:text-brand-light font-medium">{r.name}</Link>
                                        <div className="text-[10px] text-gray-600">{r.project} · /{r.slug}{!r.isActive && ' · вимкнена'}</div>
                                    </td>
                                    {COLS.map(c => (
                                        <td key={c.key} className="px-3 py-2.5 text-right font-mono text-gray-200 whitespace-nowrap">
                                            {r[c.key] ?? 0}
                                            {c.pct && <span className="text-[10px] text-gray-500 ml-1">{r[c.pct]}%</span>}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            {view.length === 0 && (
                                <tr><td colSpan={COLS.length + 1} className="px-3 py-6 text-center text-gray-600 text-xs">Немає воронок за фільтром</td></tr>
                            )}
                        </tbody>
                        {view.length > 0 && (
                            <tfoot>
                                <tr className="border-t-2 border-gray-700 bg-gray-900 font-semibold text-white">
                                    <td className="px-3 py-2.5 sticky left-0 bg-gray-900">Разом ({view.length})</td>
                                    {COLS.map(c => (
                                        <td key={c.key} className="px-3 py-2.5 text-right font-mono whitespace-nowrap">{totals[c.key]}</td>
                                    ))}
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            )}
        </div>
    );
}
