import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';

function ChatBubble({ msg }) {
    const isUser = msg.role === 'user';
    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${isUser ? 'bg-brand text-white' : 'bg-gray-800 text-gray-100'}`}>
                {msg.role === 'system' && <div className="text-xs text-gray-400 mb-1">system</div>}
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <div className={`text-[10px] mt-1 ${isUser ? 'text-brand-light/70' : 'text-gray-500'}`}>
                    {format(new Date(msg.createdAt), 'HH:mm')}
                </div>
            </div>
        </div>
    );
}

function ApiCallItem({ call }) {
    const [open, setOpen] = useState(false);
    const ok = call.statusCode < 400;
    return (
        <div className={`border rounded-lg overflow-hidden ${ok ? 'border-gray-700' : 'border-red-800'}`}>
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-left transition-colors"
            >
                <span className={`text-xs px-2 py-0.5 rounded font-mono ${ok ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
                    {call.statusCode}
                </span>
                <span className="text-xs text-gray-400">{call.service}</span>
                <span className="text-sm text-gray-200 font-mono">{call.method}</span>
                <span className="ml-auto text-xs text-gray-500">{call.durationMs}ms</span>
                <span className="text-gray-600">{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div className="px-4 pb-3 bg-gray-950 space-y-2">
                    {call.requestData && (
                        <div>
                            <div className="text-xs text-gray-500 mb-1">Request</div>
                            <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded p-2 overflow-x-auto">
                                {JSON.stringify(call.requestData, null, 2)}
                            </pre>
                        </div>
                    )}
                    {call.responseData && (
                        <div>
                            <div className="text-xs text-gray-500 mb-1">Response</div>
                            <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                                {JSON.stringify(call.responseData, null, 2)}
                            </pre>
                        </div>
                    )}
                    {call.error && (
                        <div className="text-xs text-red-400 bg-red-950/30 rounded p-2">{call.error}</div>
                    )}
                </div>
            )}
        </div>
    );
}

export function SessionDetail() {
    const { id } = useParams();
    const [session, setSession] = useState(null);
    const [messages, setMessages] = useState([]);
    const [apiCalls, setApiCalls] = useState([]);
    const [tab, setTab] = useState('chat');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([api.getSession(id), api.getSessionMessages(id), api.getSessionApiCalls(id)])
            .then(([s, m, a]) => { setSession(s); setMessages(m); setApiCalls(a); })
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Завантаження...</div>;
    if (!session) return <div className="p-6 text-red-400">Сесія не знайдена</div>;

    return (
        <div className="flex flex-col h-screen">
            {/* Header */}
            <div className="px-6 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
                <div className="flex items-center gap-4">
                    <div>
                        <div className="text-sm font-semibold text-white font-mono">{id.slice(0, 8)}…</div>
                        <div className="text-xs text-gray-400">Стан: {session.state} · {session.isActive ? '🟢 активна' : '⚫ завершена'}</div>
                    </div>
                    <div className="flex gap-2 ml-auto">
                        {['chat', 'api', 'context'].map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === t ? 'bg-brand/20 text-brand-light' : 'text-gray-400 hover:text-white'}`}
                            >
                                {t === 'chat' ? '💬 Чат' : t === 'api' ? '📡 API виклики' : '⚙️ Context'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                {tab === 'chat' && (
                    <div className="max-w-2xl mx-auto space-y-3">
                        {messages.map(m => <ChatBubble key={m.id} msg={m} />)}
                        {messages.length === 0 && <div className="text-center text-gray-500 py-8">Немає повідомлень</div>}
                    </div>
                )}
                {tab === 'api' && (
                    <div className="max-w-3xl mx-auto space-y-2">
                        {apiCalls.map(c => <ApiCallItem key={c.id} call={c} />)}
                        {apiCalls.length === 0 && <div className="text-center text-gray-500 py-8">Немає API викликів</div>}
                    </div>
                )}
                {tab === 'context' && (
                    <div className="max-w-2xl mx-auto">
                        <pre className="text-xs text-gray-300 font-mono bg-gray-900 border border-gray-700 rounded-xl p-4 overflow-x-auto">
                            {JSON.stringify(session.context, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}
