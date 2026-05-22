import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { format } from 'date-fns';
import mermaid from 'mermaid';

let mermaidInitialized = false;
function ensureMermaidInitialized() {
    if (mermaidInitialized) return;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'dark' });
    mermaidInitialized = true;
}

const NODE_TYPE_LABELS = {
    message: 'Повідомлення',
    claude: 'Claude AI',
    save_file: 'Збереження файлу',
    load_file: 'Завантаження файлу',
    wait_payment: 'Очікування оплати',
    http_request: 'HTTP запит',
    condition: 'Умова',
    notify_admin: 'Сповіщення адміна',
    start: 'Старт',
    connector: 'Конектор',
};

const NODE_TYPE_ICONS = {
    message: '💬',
    claude: '🤖',
    save_file: '💾',
    load_file: '📂',
    wait_payment: '💳',
    http_request: '🌐',
    condition: '🔀',
    notify_admin: '📣',
    start: '🚀',
    connector: '🔌',
};

// ─── URL parsing helpers ────────────────────────────────────────────────────

function parseMessageContent(content) {
    if (!content) return [{ type: 'text', value: '' }];
    const parts = [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(content)) !== null) {
        if (match.index > lastIndex) parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
        const url = match[1];
        const isSheet = url.includes('docs.google.com/spreadsheets') || url.includes('sheets.google.com');
        const isMd = url.endsWith('.md') || url.includes('/md/') || url.includes('?format=md');
        parts.push({ type: isSheet ? 'sheet' : isMd ? 'md' : 'url', value: url });
        lastIndex = match.index + url.length;
    }
    if (lastIndex < content.length) parts.push({ type: 'text', value: content.slice(lastIndex) });
    return parts.length > 0 ? parts : [{ type: 'text', value: content }];
}

function splitMermaidBlocks(content) {
    if (!content) return [{ type: 'text', value: '' }];
    const parts = [];
    const mermaidRegex = /```mermaid\s*([\s\S]*?)```/gi;
    let lastIndex = 0;
    let match;
    while ((match = mermaidRegex.exec(content)) !== null) {
        if (match.index > lastIndex) parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
        parts.push({ type: 'mermaid', value: (match[1] || '').trim() });
        lastIndex = mermaidRegex.lastIndex;
    }
    if (lastIndex < content.length) parts.push({ type: 'text', value: content.slice(lastIndex) });
    return parts.length > 0 ? parts : [{ type: 'text', value: content }];
}

// ─── Mermaid block ──────────────────────────────────────────────────────────

function MermaidBlock({ code }) {
    const [svg, setSvg] = useState('');
    const [error, setError] = useState('');
    const renderId = useMemo(() => `session-mermaid-${Math.random().toString(36).slice(2)}`, []);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (!code) { setSvg(''); return; }
            try {
                ensureMermaidInitialized();
                const result = await mermaid.render(renderId, code);
                if (!cancelled) { setSvg(result.svg || ''); setError(''); }
            } catch {
                if (!cancelled) { setSvg(''); setError('Не вдалося відрендерити Mermaid-діаграму'); }
            }
        };
        run();
        return () => { cancelled = true; };
    }, [code, renderId]);

    if (error) return (
        <div className="my-2 rounded-lg border border-amber-700/60 bg-amber-900/20 p-3">
            <div className="text-xs text-amber-300 mb-2">{error}</div>
            <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">{code}</pre>
        </div>
    );
    if (!svg) return <div className="my-2 text-xs text-gray-500">Рендер Mermaid...</div>;
    return <div className="my-2 rounded-lg border border-gray-700 bg-gray-900/70 p-3 overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ─── Md modal ──────────────────────────────────────────────────────────────

function MdModal({ url, onClose }) {
    const [content, setContent] = useState('Завантаження...');
    useEffect(() => {
        fetch(url).then(r => r.text()).then(setContent).catch(() => setContent('Помилка завантаження'));
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

// ─── Message content renderer ───────────────────────────────────────────────

function MessageContent({ content, metadata }) {
    const [mdUrl, setMdUrl] = useState(null);
    const fileUrl = metadata?.fileUrl || metadata?.url || metadata?.sheetsUrl;
    const fileType = metadata?.fileType;
    const messageParts = splitMermaidBlocks(content);

    const renderTextPart = (text, prefix) => {
        const parts = parseMessageContent(text);
        return parts.map((part, i) => {
            const key = `${prefix}-${i}`;
            if (part.type === 'text') return <span key={key}>{part.value}</span>;
            if (part.type === 'sheet') return (
                <a key={key} href={part.value} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-900/40 text-green-300 rounded border border-green-800 hover:bg-green-900/70 transition-colors text-xs font-mono">
                    📊 Відкрити таблицю ↗
                </a>
            );
            if (part.type === 'md') return (
                <button key={key} onClick={() => setMdUrl(part.value)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-900/40 text-blue-300 rounded border border-blue-800 hover:bg-blue-900/70 transition-colors text-xs font-mono">
                    📄 Переглянути документ
                </button>
            );
            return (
                <a key={key} href={part.value} target="_blank" rel="noopener noreferrer"
                    className="text-brand-light underline underline-offset-2 hover:text-white text-xs break-all">
                    {part.value}
                </a>
            );
        });
    };

    return (
        <div className="whitespace-pre-wrap">
            {metadata?.hasPhoto && (
                <div className="mb-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 bg-purple-900/30 text-purple-300 rounded border border-purple-800 text-xs">
                    <span>📷</span><span>{metadata?.photoName || 'Фото'}</span>
                </div>
            )}
            {messageParts.map((part, i) => {
                if (part.type === 'mermaid') return <MermaidBlock key={`mermaid-${i}`} code={part.value} />;
                return <React.Fragment key={`text-${i}`}>{renderTextPart(part.value, `part-${i}`)}</React.Fragment>;
            })}
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

// ─── Chat bubble ────────────────────────────────────────────────────────────

function ChatBubble({ msg, highlighted, refProp }) {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';
    return (
        <div
            ref={refProp}
            className={`flex ${isUser ? 'justify-end' : 'justify-start'} transition-all duration-300 ${highlighted ? 'scale-[1.01]' : ''}`}
        >
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm transition-colors ${highlighted ? 'ring-1 ring-brand/50' : ''} ${isUser ? 'bg-brand text-white' : isSystem ? 'bg-gray-800/50 text-gray-400 border border-gray-700' : 'bg-gray-800 text-gray-100'}`}>
                {isSystem && <div className="text-xs text-gray-500 mb-1 font-mono">system</div>}
                <MessageContent content={msg.content} metadata={msg.metadata} />
                <div className={`text-[10px] mt-1.5 ${isUser ? 'text-brand-light/70' : 'text-gray-500'}`}>
                    {format(new Date(msg.createdAt), 'HH:mm:ss')}
                </div>
            </div>
        </div>
    );
}

// ─── Flow trace panel (right side) ─────────────────────────────────────────

function FlowTracePanel({ messages, nodeMap, highlightedId, onHover }) {
    return (
        <div className="w-56 shrink-0 border-l border-gray-800 bg-gray-950 flex flex-col">
            <div className="px-3 py-2 border-b border-gray-800">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Слід воронки</div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
                {messages.map((msg) => {
                    const isUser = msg.role === 'user';
                    const nodeId = msg.metadata?.nodeId;
                    const nodeType = msg.metadata?.nodeType;
                    const node = nodeId ? nodeMap[nodeId] : null;
                    const label = node?.data?.label || (nodeType ? NODE_TYPE_LABELS[nodeType] : null) || nodeId || (isUser ? 'Користувач' : '—');
                    const icon = isUser ? '👤' : (nodeType ? NODE_TYPE_ICONS[nodeType] : '❓');
                    const isHighlighted = highlightedId === msg.id;

                    return (
                        <div
                            key={msg.id}
                            onMouseEnter={() => onHover(msg.id)}
                            onMouseLeave={() => onHover(null)}
                            className={`px-3 py-1.5 border-b border-gray-800/50 cursor-default transition-colors ${isHighlighted ? 'bg-brand/10' : 'hover:bg-gray-900'}`}
                        >
                            <div className="flex items-center gap-1.5">
                                <span className="text-sm leading-none">{icon}</span>
                                <span className="text-[11px] text-gray-300 truncate flex-1" title={label}>{label}</span>
                            </div>
                            {nodeId && (
                                <div className="text-[9px] text-gray-600 font-mono truncate mt-0.5 pl-5" title={nodeId}>
                                    {nodeId.slice(0, 20)}{nodeId.length > 20 ? '…' : ''}
                                </div>
                            )}
                            <div className="text-[9px] text-gray-600 pl-5 mt-0.5">
                                {format(new Date(msg.createdAt), 'HH:mm:ss')}
                            </div>
                        </div>
                    );
                })}
                {messages.length === 0 && (
                    <div className="px-3 py-4 text-[11px] text-gray-600 text-center">Немає подій</div>
                )}
            </div>
        </div>
    );
}

// ─── API call item ──────────────────────────────────────────────────────────

function ApiCallItem({ call }) {
    const [open, setOpen] = useState(false);
    const ok = call.statusCode < 400;
    return (
        <div className={`border rounded-lg overflow-hidden ${ok ? 'border-gray-700' : 'border-red-800'}`}>
            <button onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-left transition-colors">
                <span className={`text-xs px-2 py-0.5 rounded font-mono ${ok ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>{call.statusCode}</span>
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
                            <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded p-2 overflow-x-auto">{JSON.stringify(call.requestData, null, 2)}</pre>
                        </div>
                    )}
                    {call.responseData && (
                        <div>
                            <div className="text-xs text-gray-500 mb-1">Response</div>
                            <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">{JSON.stringify(call.responseData, null, 2)}</pre>
                        </div>
                    )}
                    {call.error && <div className="text-xs text-red-400 bg-red-950/30 rounded p-2">{call.error}</div>}
                </div>
            )}
        </div>
    );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function SessionDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const backUrl = searchParams.get('back') || '/sessions';

    const [session, setSession] = useState(null);
    const [messages, setMessages] = useState([]);
    const [apiCalls, setApiCalls] = useState([]);
    const [funnel, setFunnel] = useState(null);
    const [tab, setTab] = useState('chat');
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState('');
    const [photoFile, setPhotoFile] = useState(null);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState('');
    const [highlightedMsgId, setHighlightedMsgId] = useState(null);

    // Refs for scrolling to highlighted message
    const msgRefs = useRef({});

    useEffect(() => {
        Promise.all([
            api.getSession(id),
            api.getSessionMessages(id),
            api.getSessionApiCalls(id),
        ]).then(([s, m, a]) => {
            const sess = s.data || s;
            setSession(sess);
            setMessages(m.data || m);
            setApiCalls(a.data || a);
            // Load funnel after we know the botId
            if (sess?.botId || sess?.bot?.id) {
                api.getFunnel(sess.botId || sess.bot.id)
                    .then(f => setFunnel(f.data || f))
                    .catch(() => {});
            }
        }).finally(() => setLoading(false));
    }, [id]);

    // Build nodeId → node lookup map from funnel
    const nodeMap = useMemo(() => {
        if (!funnel?.nodes) return {};
        return Object.fromEntries((funnel.nodes || []).map(n => [n.id, n]));
    }, [funnel]);

    // Scroll to highlighted message in chat
    useEffect(() => {
        if (!highlightedMsgId) return;
        const ref = msgRefs.current[highlightedMsgId];
        if (ref) ref.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [highlightedMsgId]);

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
        if (!draft.trim() && !photoFile) { setSendError('Введіть повідомлення або додайте фото'); return; }
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
                    <button onClick={() => navigate(backUrl)} className="text-gray-500 hover:text-gray-300 text-sm transition-colors">← Назад</button>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{userName}</span>
                            {session.bot && <span className="text-xs text-gray-500 font-mono">/{session.bot.slug}</span>}
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${session.isActive ? 'text-emerald-400 bg-emerald-900/30 border-emerald-800' : 'text-gray-500 bg-gray-900 border-gray-700'}`}>
                                {session.isActive ? 'активна' : 'завершена'}
                            </span>
                            {session.isTest && (
                                <span className="text-xs px-2 py-0.5 rounded-full border text-violet-400 bg-violet-900/30 border-violet-800">тест</span>
                            )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                            {id.slice(0, 8)}… · стан: <span className="font-mono">{session.state}</span> · {messages.length} повідомлень
                        </div>
                    </div>
                    <div className="flex gap-2 ml-auto">
                        {['chat', 'api', 'context'].map(t => (
                            <button key={t} onClick={() => setTab(t)}
                                className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === t ? 'bg-brand/20 text-brand-light' : 'text-gray-400 hover:text-white'}`}>
                                {t === 'chat' ? `💬 Чат (${messages.length})` : t === 'api' ? `📡 API (${apiCalls.length})` : '⚙️ Context'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content */}
            {tab === 'chat' && (
                <div className="flex flex-1 overflow-hidden">
                    {/* Left: chat messages */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="max-w-2xl mx-auto space-y-3">
                            {messages.map(m => (
                                <ChatBubble
                                    key={m.id}
                                    msg={m}
                                    highlighted={highlightedMsgId === m.id}
                                    refProp={el => { if (el) msgRefs.current[m.id] = el; else delete msgRefs.current[m.id]; }}
                                />
                            ))}
                            {messages.length === 0 && (
                                <div className="text-center text-gray-500 py-8">Немає повідомлень</div>
                            )}
                        </div>
                    </div>

                    {/* Right: flow trace */}
                    <FlowTracePanel
                        messages={messages}
                        nodeMap={nodeMap}
                        highlightedId={highlightedMsgId}
                        onHover={setHighlightedMsgId}
                    />
                </div>
            )}

            {tab === 'api' && (
                <div className="flex-1 overflow-y-auto p-4">
                    <div className="max-w-3xl mx-auto space-y-2">
                        {apiCalls.map(c => <ApiCallItem key={c.id} call={c} />)}
                        {apiCalls.length === 0 && <div className="text-center text-gray-500 py-8">Немає API викликів</div>}
                    </div>
                </div>
            )}

            {tab === 'context' && (
                <div className="flex-1 overflow-y-auto p-4">
                    <div className="max-w-2xl mx-auto">
                        <pre className="text-xs text-gray-300 font-mono bg-gray-900 border border-gray-700 rounded-xl p-4 overflow-x-auto">
                            {JSON.stringify(session.context, null, 2)}
                        </pre>
                    </div>
                </div>
            )}

            {/* Message input (only on chat tab) */}
            {tab === 'chat' && (
                <div className="border-t border-gray-800 bg-gray-900 p-3 shrink-0">
                    <div className="max-w-2xl mx-auto space-y-2">
                        {sendError && (
                            <div className="text-xs text-red-300 bg-red-900/20 border border-red-900/40 rounded px-2 py-1.5">{sendError}</div>
                        )}
                        <div className="flex items-center gap-2">
                            <input type="text" value={draft} onChange={e => setDraft(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendManualMessage()}
                                placeholder="Написати повідомлення..."
                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                            <label className="px-3 py-2 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-800 cursor-pointer">
                                📷 Фото
                                <input type="file" accept="image/*" className="hidden" onChange={e => setPhotoFile(e.target.files?.[0] || null)} />
                            </label>
                            <button onClick={sendManualMessage} disabled={sending}
                                className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white">
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
