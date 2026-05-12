import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';

function CopyButton({ text }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };
    return (
        <button
            onClick={copy}
            className="ml-2 px-2 py-0.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
        >
            {copied ? '✓ Скопійовано' : 'Копіювати'}
        </button>
    );
}

export function UserDetail() {
    const { id } = useParams();
    const [user, setUser] = useState(null);
    const [progress, setProgress] = useState([]);
    const [files, setFiles] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [mcpUrl, setMcpUrl] = useState(null);
    const [mcpLoading, setMcpLoading] = useState(false);
    const [tab, setTab] = useState('overview');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            api.getUser(id),
            api.getUserProgress(id),
            api.getUserFiles(id),
            api.getUserSessions(id),
            api.getUserMcpToken(id),
        ])
            .then(([u, p, f, s, mcp]) => {
                setUser(u);
                setProgress(p?.data ?? p ?? []);
                setFiles(f?.data ?? f ?? []);
                setSessions(s?.data ?? s ?? []);
                setMcpUrl(mcp?.mcpUrl ?? null);
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, [id]);

    const regenerateToken = useCallback(async () => {
        setMcpLoading(true);
        try {
            const result = await api.regenerateMcpToken(id);
            setMcpUrl(result.mcpUrl);
        } finally {
            setMcpLoading(false);
        }
    }, [id]);

    if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Завантаження...</div>;
    if (!user) return <div className="p-6 text-red-400">Юзера не знайдено</div>;

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || '—';

    const TABS = [
        { key: 'overview', label: 'Огляд' },
        { key: 'progress', label: 'Прогрес' },
        { key: 'files', label: 'Файли' },
        { key: 'sessions', label: 'Сесії' },
    ];

    return (
        <div className="p-6 max-w-4xl mx-auto">
            {/* Back */}
            <Link to="/users" className="text-xs text-gray-500 hover:text-gray-300 mb-4 inline-block">← Всі юзери</Link>

            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-full bg-brand/20 flex items-center justify-center text-brand text-xl font-bold">
                    {(user.firstName?.[0] || user.username?.[0] || '?').toUpperCase()}
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-white">{fullName}</h1>
                    <div className="text-sm text-gray-400">
                        {user.username ? `@${user.username}` : ''} · TG: {String(user.telegramId)}
                    </div>
                </div>
            </div>

            {/* MCP Block — always visible */}
            <div className="bg-gray-900 border border-indigo-800/50 rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-indigo-400 text-sm font-medium">🔗 Claude MCP підключення</span>
                    </div>
                    <button
                        onClick={regenerateToken}
                        disabled={mcpLoading}
                        className="text-xs px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50 transition-colors"
                    >
                        {mcpLoading ? '...' : 'Оновити токен'}
                    </button>
                </div>
                <p className="text-xs text-gray-400 mb-3">
                    Додайте це посилання в Claude.ai → Settings → Integrations → Add MCP server
                </p>
                {mcpUrl ? (
                    <div className="flex items-center gap-2 bg-gray-950 rounded-lg px-3 py-2 font-mono text-xs text-indigo-300 break-all">
                        <span className="flex-1">{mcpUrl}</span>
                        <CopyButton text={mcpUrl} />
                    </div>
                ) : (
                    <div className="text-xs text-gray-500">Не вдалося завантажити токен</div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b border-gray-800">
                {TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`px-4 py-2 text-sm transition-colors ${tab === t.key ? 'text-white border-b-2 border-brand' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Overview tab */}
            {tab === 'overview' && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                    <Row label="ID" value={user.id} mono />
                    <Row label="Telegram ID" value={String(user.telegramId)} mono />
                    <Row label="Ім'я" value={fullName} />
                    <Row label="Username" value={user.username ? `@${user.username}` : '—'} />
                    <Row label="Мова" value={user.languageCode || '—'} />
                    <Row label="Проєкт" value={user.project?.name || user.projectId} />
                    <Row label="Реєстрація" value={format(new Date(user.createdAt), 'dd.MM.yyyy HH:mm')} />
                </div>
            )}

            {/* Progress tab */}
            {tab === 'progress' && (
                <div className="space-y-2">
                    {progress.length === 0 ? (
                        <div className="text-gray-500 text-sm">Немає прогресу</div>
                    ) : (
                        progress.map(p => (
                            <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-center gap-4">
                                <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-400 font-mono">
                                    {p.lessonNumber}
                                </span>
                                <span className="text-sm text-gray-200">{p.bot?.name || p.botId}</span>
                                <span className="ml-auto text-xs text-gray-500">
                                    {p.completedAt ? format(new Date(p.completedAt), 'dd.MM.yyyy') : ''}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Files tab */}
            {tab === 'files' && (
                <div className="space-y-2">
                    {files.length === 0 ? (
                        <div className="text-gray-500 text-sm">Немає файлів</div>
                    ) : (
                        files.map(f => (
                            <div key={f.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-mono text-indigo-400">{f.fileType}</span>
                                    <span className="text-xs text-gray-500">{format(new Date(f.createdAt), 'dd.MM.yyyy HH:mm')}</span>
                                </div>
                                <pre className="text-xs text-gray-300 whitespace-pre-wrap line-clamp-3 font-mono bg-gray-950 rounded p-2 max-h-24 overflow-hidden">
                                    {f.content?.slice(0, 300)}
                                </pre>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Sessions tab */}
            {tab === 'sessions' && (
                <div className="space-y-2">
                    {sessions.length === 0 ? (
                        <div className="text-gray-500 text-sm">Немає сесій</div>
                    ) : (
                        sessions.map(s => (
                            <Link
                                key={s.id}
                                to={`/sessions/${s.id}`}
                                className="block bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 hover:border-gray-600 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <span className={`w-2 h-2 rounded-full ${s.isActive ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                                    <span className="text-sm text-gray-200">{s.bot?.name || s.botId}</span>
                                    <span className="text-xs text-gray-500">{s.state}</span>
                                    <span className="ml-auto text-xs text-gray-500">
                                        {format(new Date(s.startedAt), 'dd.MM.yyyy HH:mm')}
                                    </span>
                                </div>
                            </Link>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

function Row({ label, value, mono }) {
    return (
        <div className="flex items-start gap-4">
            <span className="text-xs text-gray-500 w-28 shrink-0 pt-0.5">{label}</span>
            <span className={`text-sm text-gray-200 ${mono ? 'font-mono' : ''}`}>{value}</span>
        </div>
    );
}
