import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';

// Detect URLs in text and classify them
function parseMessageContent(content) {
    if (!content) return [{ type: 'text', value: '' }];

    const parts = [];
    // Match URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
        }
        const url = match[1];
        const isSheet = url.includes('docs.google.com/spreadsheets') || url.includes('sheets.google.com');
        const isMd = url.endsWith('.md') || url.includes('/md/') || url.includes('?format=md');
        parts.push({ type: isSheet ? 'sheet' : isMd ? 'md' : 'url', value: url });
        lastIndex = match.index + url.length;
    }

    if (lastIndex < content.length) {
        parts.push({ type: 'text', value: content.slice(lastIndex) });
    }

    return parts.length > 0 ? parts : [{ type: 'text', value: content }];
}

// Modal for markdown preview
function MdModal({ url, onClose }) {
    const [content, setContent] = useState('Завантаження...');
    useEffect(() => {
        fetch(url)
            .then(r => r.text())
            .then(setContent)
            .catch(() => setContent('Помилка завантаження'));
    }, [url]);
    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                    <span className="text-sm text-gray-300 font-mono truncate">{url}</span>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-lg ml-4">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">{content}</pre>
                </div>
            </div>
        </div>
    );
}

function MessageContent({ content, metadata }) {
    const [mdUrl, setMdUrl] = useState(null);

    // Check if metadata has file info
    const fileUrl = metadata?.fileUrl || metadata?.url || metadata?.sheetsUrl;
    const fileType = metadata?.fileType;

    const parts = parseMessageContent(content);

    return (
        <div className="whitespace-pre-wrap">
            {metadata?.hasPhoto && (
                <div className="mb-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 bg-purple-900/30 text-purple-300 rounded border border-purple-800 text-xs">
                    <span>📷</span>
                    <span>{metadata?.photoName || 'Фото'}</span>
                </div>
            )}

            {parts.map((part, i) => {
                if (part.type === 'text') return <span key={i}>{part.value}</span>;

                if (part.type === 'sheet') {
                    return (
                        <a key={i} href={part.value} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-900/40 text-green-300 rounded border border-green-800 hover:bg-green-900/70 transition-colors text-xs font-mono">
                            📊 Відкрити таблицю ↗
                        </a>
                    );
                }

                if (part.type === 'md') {
                    return (
                        <button key={i} onClick={() => setMdUrl(part.value)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-900/40 text-blue-300 rounded border border-blue-800 hover:bg-blue-900/70 transition-colors text-xs font-mono">
                            📄 Переглянути документ
                        </button>
                    );
                }

                return (
                    <a key={i} href={part.value} target="_blank" rel="noopener noreferrer"
                        className="text-brand-light underline underline-offset-2 hover:text-white text-xs break-all">
                        {part.value}
                    </a>
                );
            })}

            {/* Metadata file attachments */}
            {fileUrl && (
                <div className="mt-1.5">
                    {fileUrl.includes('docs.google.com') ? (
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-900/40 text-green-300 rounded-lg border border-green-800 hover:bg-green-900/70 transition-colors text-xs">
                            📊 {fileType || 'Таблиця'} ↗
                        </a>
                    ) : (
                        <button onClick={() => setMdUrl(fileUrl)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-900/40 text-blue-300 rounded-lg border border-blue-800 hover:bg-blue-900/70 transition-colors text-xs">
                            📄 {fileType || 'Документ'}
                        </button>
                    )}
                </div>
            )}

            {mdUrl && <MdModal url={mdUrl} onClose={() => setMdUrl(null)} />}
        </div>
    );
}

function ChatBubble({ msg }) {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';
    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isUser ? 'bg-brand text-white' : isSystem ? 'bg-gray-800/50 text-gray-400 border border-gray-700' : 'bg-gray-800 text-gray-100'}`}>
                {isSystem && <div className="text-xs text-gray-500 mb-1 font-mono">system</div>}
                <MessageContent content={msg.content} metadata={msg.metadata} />
                <div className={`text-[10px] mt-1.5 ${isUser ? 'text-brand-light/70' : 'text-gray-500'}`}>
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
    const [draft, setDraft] = useState('');
    const [photoFile, setPhotoFile] = useState(null);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState('');

    useEffect(() => {
        Promise.all([api.getSession(id), api.getSessionMessages(id), api.getSessionApiCalls(id)])
            .then(([s, m, a]) => { setSession(s.data || s); setMessages(m.data || m); setApiCalls(a.data || a); })
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Завантаження...</div>;
    if (!session) return <div className="p-6 text-red-400">Сесія не знайдена</div>;

    const userName = session.user?.firstName || session.user?.username || `TG:${session.user?.telegramId || '?'}`;

    const fileToBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Не вдалося прочитати файл'));
        reader.readAsDataURL(file);
    });

    const sendManualMessage = async () => {
        if (!draft.trim() && !photoFile) {
            setSendError('Введіть повідомлення або додайте фото');
            return;
        }

        setSending(true);
        setSendError('');
        try {
            const payload = { text: draft.trim() };
            if (photoFile) {
                payload.photoBase64 = await fileToBase64(photoFile);
                payload.photoName = photoFile.name;
                payload.photoMimeType = photoFile.type || 'image/jpeg';
            }
            await api.sendSessionMessage(id, payload);

            const refreshed = await api.getSessionMessages(id);
            setMessages(refreshed.data || refreshed);
            setDraft('');
            setPhotoFile(null);
        } catch (err) {
            setSendError(err.message || 'Не вдалося надіслати повідомлення');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="flex flex-col h-screen">
            {/* Header */}
            <div className="px-6 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
                <div className="flex items-center gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{userName}</span>
                            {session.bot && <span className="text-xs text-gray-500 font-mono">/{session.bot.slug}</span>}
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${session.isActive ? 'text-emerald-400 bg-emerald-900/30 border-emerald-800' : 'text-gray-500 bg-gray-900 border-gray-700'}`}>
                                {session.isActive ? 'активна' : 'завершена'}
                            </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                            {id.slice(0, 8)}… · стан: {session.state} · {messages.length} повідомлень
                        </div>
                    </div>
                    <div className="flex gap-2 ml-auto">
                        {['chat', 'api', 'context'].map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === t ? 'bg-brand/20 text-brand-light' : 'text-gray-400 hover:text-white'}`}
                            >
                                {t === 'chat' ? `💬 Чат (${messages.length})` : t === 'api' ? `📡 API (${apiCalls.length})` : '⚙️ Context'}
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

            {tab === 'chat' && (
                <div className="border-t border-gray-800 bg-gray-900 p-3">
                    <div className="max-w-2xl mx-auto space-y-2">
                        {sendError && (
                            <div className="text-xs text-red-300 bg-red-900/20 border border-red-900/40 rounded px-2 py-1.5">{sendError}</div>
                        )}
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder="Написати повідомлення..."
                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                            />
                            <label className="px-3 py-2 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-800 cursor-pointer">
                                📷 Фото
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                                />
                            </label>
                            <button
                                onClick={sendManualMessage}
                                disabled={sending}
                                className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white"
                            >
                                {sending ? 'Надсилання...' : 'Надіслати'}
                            </button>
                        </div>
                        {photoFile && (
                            <div className="text-xs text-gray-400 flex items-center justify-between">
                                <span>Обрано: {photoFile.name}</span>
                                <button onClick={() => setPhotoFile(null)} className="text-gray-300 hover:text-white">Прибрати</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
