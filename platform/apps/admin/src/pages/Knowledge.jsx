import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';

const STATUS = { draft: 'Чернетка', testing: 'Тест', live: 'Працює', paused: 'Пауза' };

function ExtLink({ href, children }) {
    return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">{children} ↗</a>;
}

function Section({ s, base, cid }) {
    const href = `${base}${s.path}?projectId=${encodeURIComponent(cid)}`;
    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 flex flex-col">
            <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium text-white">{s.icon} {s.title}
                    <span className="ml-2 text-xs text-gray-500 tabular-nums">{s.count}</span>
                </div>
                <ExtLink href={href}>Відкрити в content2</ExtLink>
            </div>
            {s.empty && <div className="mt-3 text-xs text-amber-400">Ще не заповнено. Це можна доповнити в content2.</div>}
            <div className="mt-3 space-y-2.5">
                {s.items.map((it, i) => (
                    <div key={i}>
                        <div className="text-[13px] text-gray-200">
                            {it.title}
                            {it.tag && <span className="ml-2 text-[10px] text-gray-400 border border-gray-700 rounded px-1.5 py-0.5">{it.tag}</span>}
                        </div>
                        {it.text && <div className="text-[12px] text-gray-500 leading-snug">{it.text}</div>}
                    </div>
                ))}
            </div>
            {s.count > s.items.length && <div className="mt-2 text-[11px] text-gray-600">показано {s.items.length} із {s.count}</div>}
        </div>
    );
}

function SellerBox({ v, base, isSuper }) {
    const sl = v.seller;
    if (!sl) return null;
    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium text-white">🤖 ШІ-продавець{sl.sellerName ? ': ' + sl.sellerName : ''}
                    <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full ${sl.status === 'live' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-gray-800 text-gray-300'}`}>{STATUS[sl.status] || sl.status}</span>
                </div>
                <div className="flex gap-3">
                    <ExtLink href={`${base}${sl.path}?projectId=${encodeURIComponent(v.projectId)}`}>Налаштування в content2</ExtLink>
                    {isSuper && <Link to={`/sellers/${v.projectId}`} className="text-xs text-emerald-400 hover:text-emerald-300">Керування у Flows →</Link>}
                </div>
            </div>
            <div className="mt-2 text-xs text-gray-400">
                {sl.ready ? <span className="text-emerald-400">Готовий до запуску: усе потрібне заповнено.</span> : <span className="text-amber-400">Не готовий до запуску.</span>}
            </div>
            {!sl.ready && sl.missing && sl.missing.length > 0 && (
                <ul className="mt-1.5 text-xs text-gray-500 list-disc pl-5 space-y-0.5">{sl.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
            )}
            {sl.warnings && sl.warnings.length > 0 && (
                <ul className="mt-1.5 text-xs text-gray-600 list-disc pl-5 space-y-0.5">{sl.warnings.map((m, i) => <li key={i}>{m}</li>)}</ul>
            )}
        </div>
    );
}

export function Knowledge() {
    const role = useAuthStore((s) => s.role);
    const isSuper = role === 'superadmin';
    const [params, setParams] = useSearchParams();
    const [projects, setProjects] = useState(null);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const projectId = params.get('project') || (projects && projects[0] && projects[0].id) || '';

    useEffect(() => { api.getProjects().then((r) => setProjects(Array.isArray(r) ? r : r?.data || [])).catch((e) => setError(e.message)); }, []);

    useEffect(() => {
        if (!projectId) return;
        setData(null); setError('');
        api.getProjectKnowledge(projectId).then((r) => setData(r?.data ?? r)).catch((e) => setError(e.message || 'Помилка завантаження'));
    }, [projectId]);

    return (
        <div className="p-4 md:p-6 max-w-6xl">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-xl font-semibold text-white">📚 База знань проєкту</h1>
                    <div className="text-xs text-gray-500 mt-1 max-w-2xl">Усе, що система знає про експерта цього проєкту. Дані зберігає content2, тут вони лише показані. Кнопки «Відкрити в content2» ведуть одразу на потрібну сторінку проєкту.</div>
                </div>
                {projects && projects.length > 1 && (
                    <select value={projectId} onChange={(e) => setParams({ project: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                )}
            </div>

            {error && <div className="mt-4 text-sm text-red-400">{error}</div>}
            {projects && projects.length === 0 && <div className="mt-6 text-sm text-gray-500">У вас поки немає доступу до жодного проєкту.</div>}
            {projectId && !data && !error && <div className="mt-6 text-sm text-gray-500">Завантаження…</div>}

            {data && (
                <>
                    <div className="mt-5 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                        <div className="text-sm font-medium text-white">🗺 Воронки проєкту «{data.project.name}»</div>
                        {data.funnels.length === 0 && <div className="mt-2 text-xs text-gray-500">Активних воронок немає.</div>}
                        <div className="mt-3 space-y-2">
                            {data.funnels.map((f) => (
                                <div key={f.id} className="flex items-center justify-between gap-3 flex-wrap text-sm">
                                    <div className="text-gray-200">{f.name}</div>
                                    <div className="flex gap-2 flex-wrap">
                                        <Link to={`/funnel/${f.id}/stages`} className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg">🎯 Воронка</Link>
                                        <Link to={`/bots/${f.id}/sessions`} className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg">💬 Сесії</Link>
                                        <Link to={`/funnel/${f.id}/analytics`} className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg">📊 Аналітика</Link>
                                        <Link to={`/funnel/${f.id}`} className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg">✏️ Редактор</Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {!data.linked && (
                        <div className="mt-5 rounded-xl border border-gray-800 bg-gray-900/60 p-5 text-sm text-gray-400 max-w-2xl">
                            До цього проєкту ще не привʼязано експерта з content2. Привʼязка з'являється сама, коли для проєкту створюють ШІ-продавця. Якщо експерт уже є, адміністратор може вказати його вручну в налаштуваннях проєкту.
                            <div className="mt-3"><ExtLink href={data.content2Url}>Відкрити content2</ExtLink></div>
                        </div>
                    )}

                    {data.items.map((v) => (
                        <div key={v.projectId} className="mt-6">
                            {v.error ? (
                                <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-300">Не вдалося отримати дані з content2: {v.error}</div>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <div className="text-base font-medium text-white">👤 {v.projectName}</div>
                                        <ExtLink href={`${data.content2Url}/user-data?projectId=${encodeURIComponent(v.projectId)}`}>Усе про експерта в content2</ExtLink>
                                    </div>
                                    <div className="mt-3"><SellerBox v={v} base={data.content2Url} isSuper={isSuper} /></div>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                        {v.sections.map((s) => <Section key={s.id} s={s} base={data.content2Url} cid={v.projectId} />)}
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}
