import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';

const PERIODS = [
    { value: '24h', label: '24 години' },
    { value: '7d', label: '7 днів' },
    { value: '30d', label: '30 днів' },
    { value: 'all', label: 'Увесь час' },
];

const fmt = (d) => (d ? new Date(d).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

function StageBar({ s, max, active, onClick }) {
    const w = max > 0 ? Math.max(2, Math.round((s.sessions / max) * 100)) : 0;
    return (
        <button
            onClick={onClick}
            className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${active ? 'border-emerald-500 bg-gray-900' : 'border-gray-800 bg-gray-900/60 hover:border-gray-600'}`}
        >
            <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm text-white font-medium">
                    <span className="text-gray-500 mr-2">#{s.stageOrder}</span>{s.stageName}
                    {!s.inGraph && <span className="ml-2 text-[10px] text-amber-400">(немає в графі)</span>}
                </div>
                <div className="text-sm tabular-nums text-white">{s.sessions}</div>
            </div>
            <div className="mt-2 h-2 rounded bg-gray-800 overflow-hidden">
                <div className="h-full bg-emerald-600" style={{ width: `${w}%` }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 text-[11px] text-gray-500">
                {!s.side && <span>від попереднього: {s.convFromPrev == null ? '—' : s.convFromPrev + '%'}</span>}
                <span>від першого: {s.convFromFirst == null ? '—' : s.convFromFirst + '%'}</span>
                <span className={s.stopped > 0 ? 'text-amber-400' : ''}>зупинилися тут: {s.stopped}</span>
            </div>
        </button>
    );
}

export function FunnelStages() {
    const { botId } = useParams();
    const [bot, setBot] = useState(null);
    const [period, setPeriod] = useState('30d');
    const [includeTest, setIncludeTest] = useState(false);
    const [stages, setStages] = useState(null);
    const [error, setError] = useState('');
    const [picked, setPicked] = useState(null);
    const [onlyStopped, setOnlyStopped] = useState(false);
    const [people, setPeople] = useState(null);

    useEffect(() => { api.getBot(botId).then(setBot).catch(() => {}); }, [botId]);

    useEffect(() => {
        setStages(null); setError('');
        api.getFunnelStages(botId, period, includeTest)
            .then((r) => setStages(Array.isArray(r) ? r : r?.data || []))
            .catch((e) => setError(e.message || 'Помилка завантаження'));
    }, [botId, period, includeTest]);

    useEffect(() => {
        if (!picked) { setPeople(null); return; }
        setPeople(null);
        api.getStageSessions(botId, picked, period, includeTest, onlyStopped)
            .then((r) => setPeople(Array.isArray(r) ? r : r?.data || []))
            .catch(() => setPeople([]));
    }, [botId, picked, period, includeTest, onlyStopped]);

    const max = stages && stages.length ? Math.max(...stages.map((s) => s.sessions), 1) : 1;

    return (
        <div className="min-h-screen bg-gray-950 text-white">
            <div className="max-w-5xl mx-auto px-4 py-6">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <Link to="/funnels" className="text-xs text-gray-500 hover:text-gray-300">← Воронки</Link>
                        <h1 className="text-xl font-semibold mt-1">🎯 Воронка: {bot?.name || '…'}</h1>
                        <div className="text-xs text-gray-500">Етапи збираються з нод «Етап (Flows)» у графі. Клік по етапу показує людей.</div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Link to={`/funnel/${botId}/analytics`} className="px-3 py-2 bg-gray-800 text-gray-300 text-xs rounded-lg">📊 Аналітика</Link>
                        <Link to={`/funnel/${botId}`} className="px-3 py-2 bg-gray-800 text-gray-300 text-xs rounded-lg">✏️ Редактор</Link>
                        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white">
                            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5 text-xs text-gray-400">
                            <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> з тестовими
                        </label>
                    </div>
                </div>

                {error && <div className="mt-4 text-sm text-red-400">{error}</div>}
                {!stages && !error && <div className="mt-6 text-sm text-gray-500">Завантаження…</div>}

                {stages && stages.length === 0 && (
                    <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900/60 p-5 text-sm text-gray-400">
                        У цій воронці ще немає етапів. Додайте в редакторі ноду <b className="text-emerald-400">🎯 Етап (Flows)</b>
                        (група «Аналітика»), вкажіть назву й порядковий номер та поставте її в потрібне місце графа. Коли хтось дійде до такої ноди, етап з'явиться тут.
                    </div>
                )}

                {stages && stages.length > 0 && (
                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                        <div className="space-y-2">
                            {stages.filter((s) => !s.side).map((s) => (
                                <StageBar key={s.stageName} s={s} max={max} active={picked === s.stageName} onClick={() => setPicked(picked === s.stageName ? null : s.stageName)} />
                            ))}
                            {stages.some((s) => s.side) && <div className="pt-3 text-xs text-gray-500">Інші виходи (поза основним шляхом)</div>}
                            {stages.filter((s) => s.side).map((s) => (
                                <StageBar key={s.stageName} s={s} max={max} active={picked === s.stageName} onClick={() => setPicked(picked === s.stageName ? null : s.stageName)} />
                            ))}
                        </div>
                        <div>
                            {!picked && <div className="text-sm text-gray-500 pt-2">Оберіть етап ліворуч, щоб побачити людей, які його пройшли.</div>}
                            {picked && (
                                <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="text-sm font-medium">{picked}</div>
                                        <label className="flex items-center gap-1.5 text-xs text-gray-400">
                                            <input type="checkbox" checked={onlyStopped} onChange={(e) => setOnlyStopped(e.target.checked)} /> лише ті, хто далі не пішов
                                        </label>
                                    </div>
                                    {!people && <div className="mt-3 text-xs text-gray-500">Завантаження…</div>}
                                    {people && people.length === 0 && <div className="mt-3 text-xs text-gray-500">Нікого.</div>}
                                    {people && people.length > 0 && (
                                        <div className="mt-3 divide-y divide-gray-800 max-h-[70vh] overflow-y-auto">
                                            {people.map((p) => (
                                                <Link key={p.sessionId} to={`/sessions/${p.sessionId}`} className="block py-2 hover:bg-gray-800/50 px-1 rounded">
                                                    <div className="flex items-baseline justify-between gap-2">
                                                        <div className="text-sm text-white">
                                                            {p.name || p.username || p.telegramId || 'без імені'}
                                                            {p.username && p.name && <span className="text-gray-500 text-xs"> @{p.username}</span>}
                                                            {p.isTest && <span className="ml-2 text-[10px] text-amber-400">тест</span>}
                                                        </div>
                                                        <div className="text-[11px] text-gray-500">{fmt(p.firstAt)}</div>
                                                    </div>
                                                    <div className="text-[11px] text-gray-500">
                                                        {p.wentFurther ? <>пішов далі → <span className="text-emerald-400">{p.furthest}</span></> : <span className="text-amber-400">зупинився на цьому етапі</span>}
                                                        {' · '}остання активність {fmt(p.lastActive || p.lastAt)}
                                                    </div>
                                                </Link>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
