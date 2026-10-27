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

function Card({ c }) {
    return (
        <Link to={`/sessions/${c.sessionId}`} className="block rounded-lg border border-gray-800 bg-gray-900 hover:border-emerald-600 px-3 py-2 transition-colors">
            <div className="flex items-start justify-between gap-2">
                <div className="text-sm text-white leading-tight break-words min-w-0">
                    {c.name || (c.username ? '@' + c.username : c.telegramId) || 'без імені'}
                </div>
                {c.isTest && <span className="shrink-0 text-[10px] text-amber-400">тест</span>}
            </div>
            {c.name && c.username && <div className="text-[11px] text-gray-500">@{c.username}</div>}
            <div className="mt-1 text-[11px] text-gray-500">на етапі з {fmt(c.since)}</div>
            <div className="text-[11px] text-gray-600">остання активність {fmt(c.lastActive || c.since)}</div>
        </Link>
    );
}

function Column({ col }) {
    const hidden = col.here - col.cards.length;
    return (
        <div className={`w-64 shrink-0 flex flex-col rounded-xl border bg-gray-950 ${col.side ? 'border-gray-800/70' : 'border-gray-800'}`}>
            <div className="px-3 py-3 border-b border-gray-800">
                <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-white leading-tight">
                        <span className="text-gray-500 mr-1.5">#{col.stageOrder}</span>{col.stageName}
                    </div>
                    <div className="shrink-0 min-w-6 h-6 px-1.5 rounded-full bg-emerald-700/40 text-emerald-300 text-xs flex items-center justify-center tabular-nums" title="Зараз на цьому етапі">{col.here}</div>
                </div>
                <div className="mt-1.5 text-[11px] text-gray-500 space-y-0.5">
                    <div>усього пройшли: <span className="text-gray-300 tabular-nums">{col.sessions}</span>{!col.side && col.convFromPrev != null && <span> · {col.convFromPrev}% від попереднього</span>}</div>
                    {!col.inGraph && <div className="text-amber-400">немає в графі</div>}
                </div>
            </div>
            <div className="p-2 space-y-2 overflow-y-auto" style={{ maxHeight: '68vh' }}>
                {col.cards.length === 0 && <div className="text-[11px] text-gray-600 px-1 py-3 text-center">порожньо</div>}
                {col.cards.map((c) => <Card key={c.sessionId} c={c} />)}
                {hidden > 0 && <div className="text-[11px] text-gray-500 text-center py-1">ще {hidden} (показано {col.cards.length})</div>}
            </div>
        </div>
    );
}

export function FunnelStages() {
    const { botId } = useParams();
    const [bot, setBot] = useState(null);
    const [period, setPeriod] = useState('30d');
    const [includeTest, setIncludeTest] = useState(false);
    const [board, setBoard] = useState(null);
    const [error, setError] = useState('');
    const [tick, setTick] = useState(0);

    useEffect(() => { api.getBot(botId).then(setBot).catch(() => {}); }, [botId]);

    useEffect(() => {
        setError('');
        api.getStageBoard(botId, period, includeTest)
            .then((r) => setBoard(Array.isArray(r) ? r : r?.data || []))
            .catch((e) => setError(e.message || 'Помилка завантаження'));
    }, [botId, period, includeTest, tick]);

    const main = board ? board.filter((c) => !c.side) : [];
    const side = board ? board.filter((c) => c.side) : [];
    const total = board ? board.reduce((a, c) => a + c.here, 0) : 0;

    return (
        <div className="min-h-screen bg-gray-950 text-white">
            <div className="px-4 py-6">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <Link to="/funnels" className="text-xs text-gray-500 hover:text-gray-300">← Воронки</Link>
                        <h1 className="text-xl font-semibold mt-1">🎯 Воронка: {bot?.name || '…'}</h1>
                        <div className="text-xs text-gray-500">Кожна людина стоїть у колонці найдальшого етапу, якого досягла. Картки рухаються самі, коли розмова доходить до нової ноди «Етап (Flows)».</div>
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
                        <button onClick={() => setTick((t) => t + 1)} className="px-3 py-2 bg-gray-800 text-gray-300 text-xs rounded-lg" title="Оновити">⟳</button>
                    </div>
                </div>

                {error && <div className="mt-4 text-sm text-red-400">{error}</div>}
                {!board && !error && <div className="mt-6 text-sm text-gray-500">Завантаження…</div>}

                {board && board.length === 0 && (
                    <div className="mt-6 max-w-2xl rounded-xl border border-gray-800 bg-gray-900/60 p-5 text-sm text-gray-400">
                        У цій воронці ще немає етапів. Додайте в редакторі ноду <b className="text-emerald-400">🎯 Етап (Flows)</b>
                        (група «Аналітика»), вкажіть назву й порядковий номер та поставте її в потрібне місце графа. Коли хтось дійде до такої ноди, колонка з'явиться тут.
                    </div>
                )}

                {board && board.length > 0 && (
                    <>
                        <div className="mt-4 text-xs text-gray-500">Людей у воронці за період: <span className="text-gray-300 tabular-nums">{total}</span></div>
                        <div className="mt-3 flex gap-3 overflow-x-auto pb-4 items-start">
                            {main.map((c) => <Column key={c.stageName} col={c} />)}
                            {side.length > 0 && (
                                <div className="shrink-0 self-stretch flex items-center px-1">
                                    <div className="h-full w-px bg-gray-800" />
                                </div>
                            )}
                            {side.map((c) => <Column key={c.stageName} col={c} />)}
                        </div>
                        {side.length > 0 && <div className="text-[11px] text-gray-600">Колонки праворуч від лінії — бічні виходи (поза основним шляхом до запису).</div>}
                    </>
                )}
            </div>
        </div>
    );
}
