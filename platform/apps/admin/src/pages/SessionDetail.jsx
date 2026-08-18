import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { markOneSessionRead } from './Sessions.jsx';
import { api } from '../api/client.js';
import { format } from 'date-fns';
import mermaid from 'mermaid';
import { formatJs, looksLikeJs } from '../utils/formatJs.js';

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
    // Медіа-вкладення — одне або «альбом» (кілька фото). Вхідні від клієнта / вихідні sendPhoto.
    const att = metadata?.attachment;
    const atts = (Array.isArray(metadata?.attachments) && metadata.attachments.length)
        ? metadata.attachments
        : (att ? [att] : []);
    const imgs = atts.filter((a) => a?.url && (a.type === 'photo' || a.type === 'image'));
    const vids = atts.filter((a) => a?.url && (a.type === 'video' || a.type === 'animation'));

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
            {imgs.length > 1 && (
                // «Альбом» — компактна сітка (як у Instagram/Telegram). Клік → оригінал.
                <div className="mt-1.5 grid grid-cols-3 gap-1 max-w-[300px]">
                    {imgs.map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="block">
                            <img src={a.url} alt="" loading="lazy"
                                className="w-full aspect-square object-cover rounded border border-gray-700 hover:opacity-90 transition-opacity" />
                        </a>
                    ))}
                </div>
            )}
            {imgs.length === 1 && (
                <a href={imgs[0].url} target="_blank" rel="noopener noreferrer" className="block mt-1.5">
                    <img src={imgs[0].url} alt="" loading="lazy"
                        className="rounded-lg max-w-full max-h-80 object-contain border border-gray-700" />
                </a>
            )}
            {vids.map((a, i) => (
                <video key={i} src={a.url} controls preload="metadata"
                    className="mt-1.5 rounded-lg max-w-full max-h-80 border border-gray-700" />
            ))}
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

// ─── User avatar ────────────────────────────────────────────────────────────

function UserAvatar({ user, photoApiUrl }) {
    const [blobUrl, setBlobUrl] = useState(null);
    const [failed, setFailed] = useState(false);
    const initials = [user?.firstName, user?.lastName].filter(Boolean).map(s => s[0]).join('').toUpperCase()
        || (user?.username ? user.username[0].toUpperCase() : '?');

    useEffect(() => {
        if (!photoApiUrl) return;
        let revoke;
        fetch(photoApiUrl, { credentials: 'include' })
            .then(r => r.ok ? r.blob() : Promise.reject())
            .then(blob => { revoke = URL.createObjectURL(blob); setBlobUrl(revoke); })
            .catch(() => setFailed(true));
        return () => { if (revoke) URL.revokeObjectURL(revoke); };
    }, [photoApiUrl]);

    if (blobUrl) {
        return (
            <img src={blobUrl} alt={initials}
                className="w-8 h-8 rounded-full shrink-0 object-cover border border-gray-600" />
        );
    }
    return (
        <div className="w-8 h-8 rounded-full shrink-0 bg-gradient-to-br from-brand/70 to-brand-light/70 flex items-center justify-center text-[11px] font-semibold text-white border border-brand/30">
            {initials}
        </div>
    );
}

// ─── Event row ──────────────────────────────────────────────────────────────
// Небалакучі події Zernio (реакції, прочитано, доставлено, дзвінки, коментарі…)
// показуємо як центрований статус-рядок, а не як бульбашку діалогу.
function EventRow({ msg }) {
    const failed = msg.metadata?.eventType === 'message.failed';
    return (
        <div className="flex justify-center my-1">
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] ${
                failed ? 'bg-red-900/20 border-red-900/50 text-red-300' : 'bg-gray-800/60 border-gray-700/60 text-gray-400'
            }`}>
                <span className="whitespace-pre-wrap break-words max-w-[70vw]">{msg.content}</span>
                <span className="text-gray-600">{format(new Date(msg.createdAt), 'HH:mm')}</span>
            </div>
        </div>
    );
}

// ─── Delivery status ticks (messenger-style) ────────────────────────────────
function StatusTicks({ status }) {
    if (status === 'failed') return <span title="Не доставлено" className="text-red-400">⚠</span>;
    if (status === 'read') return <span title="Прочитано" className="text-sky-300">✓✓</span>;
    if (status === 'delivered') return <span title="Доставлено">✓✓</span>;
    if (status === 'sent') return <span title="Надіслано">✓</span>;
    return null;
}

// ─── Chat bubble ────────────────────────────────────────────────────────────
// Layout: user messages LEFT, bot/admin messages RIGHT (CRM style)

function ChatBubble({ msg, highlighted, refProp, onDelete, onEdit, user, userPhotoApiUrl }) {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';
    const canEdit = !isUser && !isSystem;
    const canDelete = !isUser && !isSystem;
    const hasTgId = Boolean(msg.metadata?.telegramMessageId);
    const isAdminManual = msg.metadata?.source === 'admin_manual';
    const hasDoc = Boolean(msg.metadata?.hasDoc);
    const status = msg.metadata?.status;
    const reactions = Array.isArray(msg.metadata?.reactions) ? msg.metadata.reactions : [];
    const isDeleted = Boolean(msg.metadata?.deleted);

    const [editing, setEditing] = useState(false);
    const [editDraft, setEditDraft] = useState(msg.content);
    const [saving, setSaving] = useState(false);

    const startEdit = () => { setEditDraft(msg.content); setEditing(true); };
    const cancelEdit = () => setEditing(false);
    const saveEdit = async () => {
        if (!editDraft.trim() || editDraft === msg.content) { setEditing(false); return; }
        setSaving(true);
        await onEdit(msg, editDraft.trim());
        setSaving(false);
        setEditing(false);
    };

    return (
        <div
            ref={refProp}
            className={`flex ${isUser ? 'justify-start' : 'justify-end'} group transition-all duration-300 ${highlighted ? 'scale-[1.01]' : ''}`}
        >
            {/* User avatar — left of user messages */}
            {isUser && (
                <div className="self-end mb-1 mr-2 shrink-0">
                    <UserAvatar user={user} photoApiUrl={userPhotoApiUrl} />
                </div>
            )}

            <div className={`relative max-w-[75%] rounded-2xl px-4 py-2.5 text-sm transition-colors ${highlighted ? 'ring-1 ring-brand/50' : ''} ${
                isUser
                    ? 'bg-gray-700 text-gray-100 rounded-tl-sm'
                    : isSystem
                        ? 'bg-gray-800/50 text-gray-400 border border-gray-700'
                        : isAdminManual
                            ? 'bg-emerald-800/70 text-white rounded-tr-sm'
                            : 'bg-brand text-white rounded-tr-sm'
            }`}>
                {isSystem && <div className="text-xs text-gray-500 mb-1 font-mono">system</div>}
                {isAdminManual && <div className="text-[10px] text-emerald-300/80 mb-1">👤 адмін</div>}

                {editing ? (
                    <div className="space-y-1.5">
                        <textarea
                            autoFocus
                            value={editDraft}
                            onChange={e => setEditDraft(e.target.value)}
                            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') cancelEdit(); }}
                            className="w-full bg-black/20 border border-white/20 rounded px-2 py-1 text-sm resize-none outline-none min-h-[60px]"
                            rows={3}
                        />
                        <div className="flex gap-2 justify-end">
                            <button onClick={cancelEdit} className="text-[11px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20">Скасувати</button>
                            <button onClick={saveEdit} disabled={saving} className="text-[11px] px-2 py-0.5 rounded bg-white/30 hover:bg-white/40 disabled:opacity-50">{saving ? '...' : 'Зберегти'}</button>
                        </div>
                    </div>
                ) : (
                    <>
                        {hasDoc && <div className="text-[11px] opacity-70 mb-1">📎 {msg.metadata.docName || 'документ'}</div>}
                        {isDeleted
                            ? <span className="italic opacity-60">🗑 Повідомлення видалено</span>
                            : <MessageContent content={msg.content} metadata={msg.metadata} />}
                        {msg.metadata?.edited && <span className="text-[10px] opacity-50 ml-1">(ред.)</span>}
                    </>
                )}

                <div className={`text-[10px] mt-1.5 flex items-center gap-1 justify-end ${isUser ? 'text-gray-400' : 'text-white/50'}`}>
                    <span>{format(new Date(msg.createdAt), 'HH:mm:ss')}</span>
                    {!isUser && (status ? <StatusTicks status={status} /> : (hasTgId && <span title="Telegram message_id збережено">✓</span>))}
                </div>

                {/* Реакції — маленька плашка на краю бульбашки (як у месенджерах) */}
                {reactions.length > 0 && (
                    <div className={`absolute -bottom-2.5 ${isUser ? 'left-3' : 'right-3'} bg-gray-900 border border-gray-700 rounded-full px-1.5 py-0.5 text-xs leading-none shadow`}>
                        {reactions.join(' ')}
                    </div>
                )}
            </div>

            {/* Edit + Delete buttons — right of bot messages */}
            {(canEdit || canDelete) && !editing && (
                <div className="self-start mt-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-0.5">
                    {canEdit && (
                        <button onClick={startEdit} title="Редагувати"
                            className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-blue-400 hover:bg-blue-900/20 text-xs">✏️</button>
                    )}
                    {canDelete && (
                        <button onClick={() => onDelete(msg)} title={hasTgId ? 'Видалити з Telegram і сесії' : 'Видалити лише з сесії'}
                            className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-red-400 hover:bg-red-900/20 text-xs">🗑</button>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Flow trace panel (right side) ─────────────────────────────────────────

function FlowTracePanel({ messages, nodeMap, highlightedId, onHover, onClose }) {
    return (
        <div className="w-56 max-w-[70vw] shrink-0 border-l border-gray-800 bg-gray-950 flex flex-col absolute md:static right-0 top-0 bottom-0 z-20 md:z-auto shadow-xl md:shadow-none">
            <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Слід воронки</div>
                {onClose && (
                    <button onClick={onClose} title="Сховати панель"
                        className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-gray-800 text-xs">✕</button>
                )}
            </div>
            <div className="flex-1 overflow-y-auto py-1">
                {messages.filter((m) => m.role !== 'event').map((msg) => {
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
                            <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded p-2 whitespace-pre-wrap break-words">{JSON.stringify(call.requestData, null, 2)}</pre>
                        </div>
                    )}
                    {call.responseData && (
                        <div>
                            <div className="text-xs text-gray-500 mb-1">Response</div>
                            <pre className="text-xs text-gray-300 font-mono bg-gray-900 rounded p-2 whitespace-pre-wrap break-words max-h-80 overflow-y-auto">{JSON.stringify(call.responseData, null, 2)}</pre>
                        </div>
                    )}
                    {call.error && <div className="text-xs text-red-400 bg-red-950/30 rounded p-2">{call.error}</div>}
                </div>
            )}
        </div>
    );
}

// ─── Node execution trace (вкладка «Ноди») ───────────────────────────────────
const NODE_ICON = {
    start: '🚀', message: '💬', claude: '🧠', agent: '🤖', js: '⚙️', condition: '🔀',
    connector: '🔌', wait: '⏳', wait_payment: '💳', httpRequest: '🌐', httpEncode: '🔑',
    sendPhoto: '📸', sendDocument: '📎', sendFile: '📎', notifyAdmin: '📣', notifyTg: '📨',
    fbEvent: '📊', saveFile: '💾', loadFile: '📂', readFile: '📄', generateDocument: '📝',
    knowledgeBase: '📚', fetchTelegramProfile: '👤', tag: '🏷️', abtest: '🔬',
};

function prettyVal(raw) {
    if (raw == null) return '';
    if (typeof raw !== 'string') return JSON.stringify(raw, null, 2);
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { /* не JSON */ }
    if (looksLikeJs(raw)) return formatJs(raw);
    return raw;
}

// Значення, згорнуте за замовчуванням якщо довге; іконка ⤢ розгортає повністю.
function CollapsibleValue({ value }) {
    const [open, setOpen] = useState(false);
    const text = prettyVal(value);
    const long = text.length > 160 || text.includes('\n');
    if (!long) return <span className="text-xs text-gray-200 font-mono break-all">{text}</span>;
    return (
        <div className="min-w-0">
            <button onClick={() => setOpen(o => !o)} className="text-[11px] text-brand-light hover:underline mb-1">
                {open ? '▲ згорнути' : '⤢ розгорнути'} ({text.length} симв.)
            </button>
            <pre className={`text-xs text-gray-300 font-mono bg-gray-900 rounded p-2 whitespace-pre-wrap break-words ${open ? '' : 'max-h-16 overflow-hidden'}`}>{text}</pre>
        </div>
    );
}

function KVList({ obj, empty }) {
    const keys = Object.keys(obj || {});
    if (!keys.length) return <div className="text-[11px] text-gray-600 italic">{empty}</div>;
    return (
        <div className="space-y-1.5">
            {keys.map(k => (
                <div key={k} className="grid grid-cols-[minmax(90px,180px)_1fr] gap-2 items-start">
                    <span className="text-[11px] text-gray-500 font-mono break-all pt-0.5">{k}</span>
                    <CollapsibleValue value={obj[k]} />
                </div>
            ))}
        </div>
    );
}

function collectUrls(...objs) {
    const set = new Set();
    const re = /https?:\/\/[^\s"'`)]+/g;
    for (const o of objs) {
        let s = '';
        try { s = typeof o === 'string' ? o : JSON.stringify(o); } catch { s = ''; }
        let m;
        while ((m = re.exec(s || ''))) set.add(m[0].replace(/[,.]+$/, ''));
    }
    return Array.from(set);
}

function NodeTraceCard({ trace, apiCalls, errors, defaultOpen }) {
    const [open, setOpen] = useState(!!defaultOpen);
    const icon = NODE_ICON[trace.nodeType] || '📦';
    const hasErr = errors.length > 0;
    const links = collectUrls(trace.input, trace.output, apiCalls.map(c => [c.requestData, c.responseData]));
    return (
        <div className={`border rounded-lg overflow-hidden ${hasErr ? 'border-red-800' : 'border-gray-700'}`}>
            <button onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-left transition-colors">
                <span className="text-[11px] text-gray-600 font-mono w-6 shrink-0">#{trace.seq}</span>
                <span className="text-base shrink-0">{icon}</span>
                <span className="text-sm text-gray-200 truncate">{trace.label || trace.nodeId}</span>
                <span className="text-[10px] text-gray-500 font-mono hidden sm:inline">{trace.nodeType}</span>
                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    {apiCalls.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300">📡 {apiCalls.length}</span>}
                    {hasErr && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300">✖ {errors.length}</span>}
                    {typeof trace.tookMs === 'number' && <span className="text-[10px] text-gray-600">{trace.tookMs}ms</span>}
                    <span className="text-gray-600">{open ? '▲' : '▼'}</span>
                </span>
            </button>
            {open && (
                <div className="px-3 pb-3 bg-gray-950 space-y-3 pt-2">
                    {trace.branch != null && (
                        <div className="text-[11px]">
                            <span className="text-gray-500">Гілка: </span>
                            <span className={`font-mono px-1.5 py-0.5 rounded ${trace.branch === 'true' ? 'bg-emerald-900/40 text-emerald-300' : trace.branch === 'false' ? 'bg-red-900/40 text-red-300' : 'bg-sky-900/40 text-sky-300'}`}>{String(trace.branch)}</span>
                            {trace.branchTarget && <span className="text-gray-500"> → <span className="text-gray-300 font-mono">{trace.branchTarget}</span></span>}
                        </div>
                    )}
                    {trace.userInput && (
                        <div>
                            <div className="text-[11px] text-gray-500 mb-1 font-semibold">👤 Повідомлення користувача (вхід)</div>
                            <div className="text-xs text-gray-200 bg-gray-900 rounded p-2 whitespace-pre-wrap break-words">{trace.userInput}</div>
                        </div>
                    )}
                    <div>
                        <div className="text-[11px] text-gray-500 mb-1 font-semibold">⬇ Вхідні (конфіг ноди)</div>
                        <KVList obj={trace.input} empty="без параметрів" />
                    </div>
                    <div>
                        <div className="text-[11px] text-gray-500 mb-1 font-semibold">⬆ Вихідні (зміни контексту)</div>
                        <KVList obj={trace.output} empty="контекст не змінювався" />
                    </div>
                    {hasErr && (
                        <div>
                            <div className="text-[11px] text-red-400 mb-1 font-semibold">✖ Помилки</div>
                            {errors.map((e, i) => (
                                <div key={i} className="text-xs text-red-300 bg-red-950/30 rounded p-2 mb-1">
                                    <div>{e.message}</div>
                                    {e.stack && <CollapsibleValue value={e.stack} />}
                                </div>
                            ))}
                        </div>
                    )}
                    {apiCalls.length > 0 && (
                        <div>
                            <div className="text-[11px] text-gray-500 mb-1 font-semibold">📡 API-запити ({apiCalls.length}) — повний запит і відповідь</div>
                            <div className="space-y-1.5">{apiCalls.map(c => <ApiCallItem key={c.id} call={c} />)}</div>
                        </div>
                    )}
                    {links.length > 0 && (() => {
                        const isImg = (u) => /\.(jpe?g|png|webp|gif|bmp|avif)(\?|$)/i.test(u) || /image|thumbnail|file-storage|cdninstagram|fbcdn|lookaside/i.test(u);
                        const imgLinks = links.filter(isImg);
                        const other = links.filter((u) => !isImg(u));
                        return (
                            <div>
                                <div className="text-[11px] text-gray-500 mb-1 font-semibold">🔗 Посилання ({links.length})</div>
                                {imgLinks.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                                        {imgLinks.map((u, i) => (
                                            <a key={i} href={u} target="_blank" rel="noreferrer" title={u} className="block">
                                                <img src={u} alt="" loading="lazy"
                                                    className="w-20 h-20 object-cover rounded border border-gray-700 hover:opacity-90 transition-opacity bg-gray-900" />
                                            </a>
                                        ))}
                                    </div>
                                )}
                                <div className="space-y-0.5">
                                    {other.map((u, i) => (
                                        <a key={i} href={u} target="_blank" rel="noreferrer" className="block text-[11px] text-sky-400 hover:underline font-mono break-all">{u}</a>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}

// Панель «Змінні»: як кожна змінна змінюється, проходячи через ноди.
function VariablesPanel({ traces, rawContext }) {
    const [rawOpen, setRawOpen] = useState(false);
    const timeline = useMemo(() => {
        const vars = {};
        for (const t of traces) {
            for (const k of Object.keys(t.output || {})) {
                if (!vars[k]) vars[k] = [];
                vars[k].push({ seq: t.seq, label: t.label || t.nodeType, value: t.output[k] });
            }
        }
        return vars;
    }, [traces]);
    const names = Object.keys(timeline).sort();
    return (
        <div className="w-80 shrink-0 border-l border-gray-800 overflow-y-auto p-3 bg-gray-900/40">
            <div className="text-xs font-semibold text-gray-300 mb-2">📊 Змінні ({names.length})</div>
            {names.length === 0 && <div className="text-[11px] text-gray-600 italic">Змінні ще не зʼявлялись</div>}
            <div className="space-y-2">
                {names.map(name => <VarTimeline key={name} name={name} steps={timeline[name]} />)}
            </div>
            <div className="mt-4 pt-3 border-t border-gray-800">
                <button onClick={() => setRawOpen(o => !o)} className="text-[11px] text-gray-500 hover:text-gray-300">
                    {rawOpen ? '▲' : '▼'} сирий контекст (фінальний)
                </button>
                {rawOpen && (
                    <pre className="mt-2 text-[10px] text-gray-400 font-mono bg-gray-950 rounded p-2 overflow-x-auto max-h-96 overflow-y-auto">{JSON.stringify(rawContext, null, 2)}</pre>
                )}
            </div>
        </div>
    );
}

function VarTimeline({ name, steps }) {
    const [open, setOpen] = useState(false);
    const last = steps[steps.length - 1];
    return (
        <div className="border border-gray-800 rounded">
            <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-800 text-left">
                <span className="text-[11px] text-gray-300 font-mono truncate flex-1">{name}</span>
                <span className="text-[10px] text-gray-600">{steps.length}×</span>
                <span className="text-gray-600 text-[10px]">{open ? '▲' : '▼'}</span>
            </button>
            {!open && <div className="px-2 pb-1.5 text-[10px] text-gray-500 font-mono truncate">= {String(last.value).slice(0, 60)}</div>}
            {open && (
                <div className="px-2 pb-2 space-y-1">
                    {steps.map((s, i) => (
                        <div key={i} className="text-[10px]">
                            <span className="text-gray-600">#{s.seq} {s.label}:</span>
                            <div className="text-gray-300 font-mono break-all pl-2">{String(s.value).slice(0, 200)}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function AllApiCallsSection({ apiCalls }) {
    const [open, setOpen] = useState(false);
    const sorted = useMemo(() => [...(apiCalls || [])].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)), [apiCalls]);
    if (!sorted.length) return null;
    return (
        <div className="mt-4 pt-3 border-t border-gray-800">
            <button onClick={() => setOpen(o => !o)} className="text-xs text-gray-400 hover:text-white">
                {open ? '▲' : '▼'} 📡 Усі API-запити сесії ({sorted.length}) — повний список з даними
            </button>
            {open && <div className="space-y-1.5 mt-2">{sorted.map(c => <ApiCallItem key={c.id} call={c} />)}</div>}
        </div>
    );
}

// Лог доставки (Telegram-алерти, Zernio, IG-фото) — щоб бачити «чому не прийшло».
function DeliveryLogSection({ log }) {
    const [open, setOpen] = useState(false);
    const rows = Array.isArray(log) ? log : [];
    if (!rows.length) return null;
    const failed = rows.filter(r => !r.ok).length;
    const CH = { telegram_alert: '✈️ Telegram', zernio: '💬 Zernio', ig_photo: '🖼 IG фото', ig_photo_album: '🖼 IG альбом' };
    return (
        <div className="border border-gray-700 rounded-lg overflow-hidden mt-3">
            <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-left transition-colors">
                <span className="text-sm text-gray-200">📮 Доставка повідомлень ({rows.length})</span>
                {failed > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300">✖ {failed}</span>}
                <span className="ml-auto text-gray-600">{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div className="px-3 py-2 bg-gray-950 space-y-1">
                    {rows.slice().reverse().map((r, i) => (
                        <div key={i} className="text-[11px] flex flex-wrap items-baseline gap-x-2 border-b border-gray-800/60 pb-1">
                            <span className={r.ok ? 'text-emerald-400' : 'text-red-400'}>{r.ok ? '✓' : '✖'}</span>
                            <span className="text-gray-300">{CH[r.channel] || r.channel}</span>
                            {r.nodeId && <span className="text-gray-600 font-mono">{r.nodeId}</span>}
                            {r.ts && <span className="text-gray-600">{String(r.ts).slice(11, 19)}</span>}
                            {r.count != null && <span className="text-gray-500">×{r.count}</span>}
                            {r.error && <span className="text-red-300 break-all">{r.error}</span>}
                            {r.text && <span className="text-gray-500 break-all">«{String(r.text).slice(0, 70)}»</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function NodeTraceTab({ traces, apiCalls, errors, rawContext }) {
    const [page, setPage] = useState(0);
    const PAGE = 10;
    // Хронологічний порядок трейсів
    const ordered = useMemo(() => [...(traces || [])], [traces]);
    // Межі часу кожного трейсу — для рознесення API/помилок по нодах
    const bucketed = useMemo(() => {
        const arr = ordered.map((t, i) => ({
            trace: t,
            start: Date.parse(t.tsIso) || 0,
            end: (ordered[i + 1] && Date.parse(ordered[i + 1].tsIso)) || Number.MAX_SAFE_INTEGER,
        }));
        const inWin = (createdAt, b) => { const ts = Date.parse(createdAt) || 0; return ts >= b.start - 50 && ts < b.end; };
        return arr.map(b => ({
            trace: b.trace,
            apiCalls: (apiCalls || []).filter(c => inWin(c.createdAt, b)),
            errors: (errors || []).filter(e => (e.context?.nodeId === b.trace.nodeId) && inWin(e.createdAt, b)),
        }));
    }, [ordered, apiCalls, errors]);

    const pages = Math.max(1, Math.ceil(bucketed.length / PAGE));
    const slice = bucketed.slice(page * PAGE, page * PAGE + PAGE);

    if (!ordered.length) {
        return <div className="flex-1 flex items-center justify-center text-gray-500">Немає трейсу нод (сесія ще не проходила через воронку після оновлення).</div>;
    }
    return (
        <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
                <div className="max-w-3xl mx-auto space-y-2">
                    {slice.map(b => (
                        <NodeTraceCard key={b.trace.seq} trace={b.trace} apiCalls={b.apiCalls} errors={b.errors} defaultOpen={slice.length <= 3} />
                    ))}
                    {pages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-3">
                            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 disabled:opacity-40">← назад</button>
                            <span className="text-xs text-gray-500">{page + 1} / {pages}</span>
                            <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 disabled:opacity-40">далі →</button>
                        </div>
                    )}
                    <AllApiCallsSection apiCalls={apiCalls} />
                    <DeliveryLogSection log={rawContext?.flowRuntime?.deliveryLog} />
                </div>
            </div>
            <VariablesPanel traces={ordered} rawContext={rawContext} />
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
    const [sessErrors, setSessErrors] = useState([]);
    const [funnel, setFunnel] = useState(null);
    const [tab, setTab] = useState('chat');
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState('');
    const [photoFile, setPhotoFile] = useState(null);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState('');
    const [restarting, setRestarting] = useState(false);
    const [highlightedMsgId, setHighlightedMsgId] = useState(null);
    const [deletingMsgId, setDeletingMsgId] = useState(null);
    const [docFile, setDocFile] = useState(null);
    const [adminEngaged, setAdminEngaged] = useState(false);
    const [funnelPaused, setFunnelPaused] = useState(false);
    // Права панель «слід воронки»: на мобільному ховаємо за замовчуванням (займала пів екрана).
    const [showTrace, setShowTrace] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768);

    // Refs for scrolling to highlighted message
    const msgRefs = useRef({});

    useEffect(() => {
        markOneSessionRead(id);
        Promise.all([
            api.getSession(id),
            api.getSessionMessages(id),
            api.getSessionApiCalls(id),
            api.getSessionErrors(id).catch(() => ({ data: {} })),
        ]).then(([s, m, a, e]) => {
            const sess = s.data || s;
            setSession(sess);
            setMessages(m.data || m);
            setApiCalls(a.data || a);
            const eb = e.data || e || {};
            setSessErrors(Array.isArray(eb.appErrors) ? eb.appErrors : []);
            // Для сесій без чату з людиною (напр. cron/webhook-воронки) — одразу вкладка «Ноди»
            const _msgs = m.data || m;
            if (Array.isArray(_msgs) && _msgs.length === 0) { setTab('trace'); }
            // Load funnel after we know the botId
            if (sess?.botId || sess?.bot?.id) {
                api.getFunnel(sess.botId || sess.bot.id)
                    .then(f => setFunnel(f.data || f))
                    .catch(() => {});
            }
        }).then(([s]) => {
            const sess = s.data || s;
            setAdminEngaged(Boolean(sess?.context?.adminEngaged));
            setFunnelPaused(Boolean(sess?.context?.funnelPaused));
        }).finally(() => setLoading(false));
    }, [id]);

    const toggleFlag = async (flag, value) => {
        if (flag === 'adminEngaged') setAdminEngaged(value);
        else if (flag === 'funnelPaused') setFunnelPaused(value);
        try {
            const res = await api.updateSessionFlags(id, { [flag]: value });
            const ctx = res?.context ?? res?.data?.context;
            if (ctx) {
                setAdminEngaged(Boolean(ctx.adminEngaged));
                setFunnelPaused(Boolean(ctx.funnelPaused));
            }
        } catch (err) {
            // revert on error
            if (flag === 'adminEngaged') setAdminEngaged(!value);
            else if (flag === 'funnelPaused') setFunnelPaused(!value);
        }
    };

    // Auto-poll for new messages when session is active
    useEffect(() => {
        if (!session?.isActive || tab !== 'chat') return;
        const interval = setInterval(async () => {
            try {
                const refreshed = await api.getSessionMessages(id);
                setMessages(refreshed.data || refreshed);
            } catch {}
        }, 4000);
        return () => clearInterval(interval);
    }, [id, session?.isActive, tab]);

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

    const restartChat = async () => {
        if (!window.confirm('Перезапустити чат? Вся історія буде очищена і бот запуститься з початку.')) return;
        setRestarting(true);
        setSendError('');
        try {
            await api.restartSession(id);
            const [s, m, a] = await Promise.all([
                api.getSession(id),
                api.getSessionMessages(id),
                api.getSessionApiCalls(id),
            ]);
            setSession(s.data || s);
            setMessages(m.data || m);
            setApiCalls(a.data || a);
        } catch (err) {
            setSendError(err.message || 'Не вдалося перезапустити чат');
        } finally {
            setRestarting(false);
        }
    };

    const handleEditMessage = async (msg, newContent) => {
        try {
            const updated = await api.editSessionMessage(id, msg.id, newContent);
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: newContent, metadata: { ...(m.metadata || {}), edited: true } } : m));
        } catch (err) {
            setSendError(err.message || 'Не вдалося відредагувати повідомлення');
        }
    };

    const handleDeleteMessage = async (msg) => {
        const hasTg = Boolean(msg.metadata?.telegramMessageId);
        const confirmText = hasTg
            ? 'Видалити повідомлення з Telegram і сесії?'
            : 'Telegram message_id не збережено — видалити лише з сесії (з чату не зникне)?';
        if (!window.confirm(confirmText)) return;
        setDeletingMsgId(msg.id);
        try {
            await api.deleteSessionMessage(id, msg.id);
            setMessages(prev => prev.filter(m => m.id !== msg.id));
        } catch (err) {
            setSendError(err.message || 'Не вдалося видалити');
        } finally {
            setDeletingMsgId(null);
        }
    };

    const sendManualMessage = async () => {
        if (!draft.trim() && !photoFile && !docFile) { setSendError('Введіть повідомлення, додайте фото або документ'); return; }
        setSending(true);
        setSendError('');
        try {
            const payload = { text: draft.trim() };
            if (photoFile) {
                payload.photoBase64 = await fileToBase64(photoFile);
                payload.photoName = photoFile.name;
                payload.photoMimeType = photoFile.type || 'image/jpeg';
            }
            if (docFile) {
                payload.docBase64 = await fileToBase64(docFile);
                payload.docName = docFile.name;
                payload.docMimeType = docFile.type || 'application/octet-stream';
            }
            await api.sendSessionMessage(id, payload);
            const refreshed = await api.getSessionMessages(id);
            setMessages(refreshed.data || refreshed);
            setDraft('');
            setPhotoFile(null);
            setDocFile(null);
        } catch (err) {
            setSendError(err.message || 'Не вдалося надіслати повідомлення');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-3rem)]">
            {/* Compact header — single row */}
            <div className="px-3 py-1.5 border-b border-gray-800 bg-gray-900 shrink-0 flex items-center gap-2 min-h-0">
                {/* User info */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {session.user?.id ? (
                        <Link to={`/users/${session.user.id}?back=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                            className="text-sm font-semibold text-white hover:text-brand-light transition-colors truncate max-w-[140px]">
                            {userName}
                        </Link>
                    ) : (
                        <span className="text-sm font-semibold text-white truncate max-w-[140px]">{userName}</span>
                    )}
                    {session.bot && <span className="text-[11px] text-gray-500 font-mono hidden sm:inline truncate max-w-[120px]">/{session.bot.slug}</span>}
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${session.isActive ? 'bg-emerald-400' : 'bg-gray-600'}`} title={session.isActive ? 'активна' : 'завершена'} />
                    {session.isTest && <span className="text-[10px] px-1.5 py-0.5 rounded border text-violet-400 border-violet-800 bg-violet-900/20 shrink-0">тест</span>}
                    <span className="text-[11px] text-gray-600 hidden lg:inline shrink-0">{id.slice(0, 8)}… · {messages.length} повідомлень</span>
                </div>

                {/* Action toggles — icon only */}
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={() => toggleFlag('funnelPaused', !funnelPaused)}
                        title={funnelPaused ? 'Пауза активна — натисни щоб відновити воронку' : 'Призупинити воронку'}
                        className={`w-7 h-7 flex items-center justify-center rounded text-base transition-colors ${funnelPaused ? 'bg-orange-900/40 text-orange-300' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
                    >{funnelPaused ? '⏸' : '▶'}</button>
                    <button
                        onClick={() => toggleFlag('adminEngaged', !adminEngaged)}
                        title={adminEngaged ? 'Сповіщення увімкнені — натисни щоб вимкнути' : 'Увімкнути сповіщення'}
                        className={`w-7 h-7 flex items-center justify-center rounded text-base transition-colors ${adminEngaged ? 'bg-brand/20 text-brand-light' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
                    >{adminEngaged ? '🔔' : '🔕'}</button>
                    <button
                        onClick={restartChat}
                        disabled={restarting}
                        title="Перезапустити воронку з початку"
                        className="w-7 h-7 flex items-center justify-center rounded text-base text-gray-500 hover:text-amber-400 hover:bg-gray-800 disabled:opacity-40 transition-colors"
                    >{restarting ? '⏳' : '🔄'}</button>

                    {tab === 'chat' && (
                        <button
                            onClick={() => setShowTrace(v => !v)}
                            title={showTrace ? 'Сховати слід воронки' : 'Показати слід воронки'}
                            className={`w-7 h-7 flex items-center justify-center rounded text-base transition-colors ${showTrace ? 'bg-brand/20 text-brand-light' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
                        >🧭</button>
                    )}

                    <div className="w-px h-4 bg-gray-700 mx-1" />

                    {/* Tabs */}
                    {[
                        { key: 'chat',  label: `💬 ${messages.length}`, title: 'Чат — повідомлення сесії' },
                        { key: 'trace', label: `🔍 ${(session?.context?.flowRuntime?.nodeTraces || []).length}`, title: 'Ноди — детальний трейс виконання воронки' },
                    ].map(t => (
                        <button key={t.key} onClick={() => setTab(t.key)} title={t.title}
                            className={`text-xs px-2.5 py-1 rounded transition-colors ${tab === t.key ? 'bg-brand/20 text-brand-light' : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            {tab === 'chat' && (
                <div className="flex flex-1 overflow-hidden relative">
                    {/* Left: chat messages */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="max-w-2xl mx-auto space-y-3">
                            {messages.map(m => (
                                m.role === 'event' ? (
                                    <EventRow key={m.id} msg={m} />
                                ) : (
                                    <ChatBubble
                                        key={m.id}
                                        msg={m}
                                        highlighted={highlightedMsgId === m.id}
                                        refProp={el => { if (el) msgRefs.current[m.id] = el; else delete msgRefs.current[m.id]; }}
                                        onDelete={handleDeleteMessage}
                                        onEdit={handleEditMessage}
                                        user={session.user}
                                        userPhotoApiUrl={`/api/sessions/${session.id}/user-photo`}
                                    />
                                )
                            ))}
                            {messages.length === 0 && (
                                <div className="text-center text-gray-500 py-8">Немає повідомлень</div>
                            )}
                        </div>
                    </div>

                    {/* Right: flow trace (сховувана, оверлей на мобільному) */}
                    {showTrace && (
                        <FlowTracePanel
                            messages={messages}
                            nodeMap={nodeMap}
                            highlightedId={highlightedMsgId}
                            onHover={setHighlightedMsgId}
                            onClose={() => setShowTrace(false)}
                        />
                    )}
                </div>
            )}

            {tab === 'trace' && (
                <NodeTraceTab
                    traces={session?.context?.flowRuntime?.nodeTraces || []}
                    apiCalls={apiCalls}
                    errors={sessErrors}
                    rawContext={session.context}
                />
            )}

            {/* Message input (only on chat tab) */}
            {tab === 'chat' && (
                <div className="border-t border-gray-800 bg-gray-900 p-3 shrink-0">
                    <div className="max-w-2xl mx-auto space-y-2">
                        {sendError && (
                            <div className="text-xs text-red-300 bg-red-900/20 border border-red-900/40 rounded px-2 py-1.5">{sendError}</div>
                        )}
                        <div className="flex gap-2">
                            <textarea value={draft} onChange={e => setDraft(e.target.value)}
                                onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendManualMessage(); } }}
                                placeholder="Написати повідомлення... (Ctrl+Enter щоб надіслати)"
                                rows={3}
                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none" />
                            <div className="flex flex-col gap-1.5">
                                <label title="Прикріпити фото" className="w-9 h-9 flex items-center justify-center rounded border border-gray-600 text-gray-300 hover:bg-gray-800 cursor-pointer text-base">
                                    📷
                                    <input type="file" accept="image/*" className="hidden" onChange={e => { setPhotoFile(e.target.files?.[0] || null); setDocFile(null); }} />
                                </label>
                                <label title="Прикріпити документ (PDF, Word, тощо)" className="w-9 h-9 flex items-center justify-center rounded border border-gray-600 text-gray-300 hover:bg-gray-800 cursor-pointer text-base">
                                    📎
                                    <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.rar,application/*,text/plain" className="hidden" onChange={e => { setDocFile(e.target.files?.[0] || null); setPhotoFile(null); }} />
                                </label>
                                <button onClick={sendManualMessage} disabled={sending} title="Надіслати повідомлення (Ctrl+Enter)"
                                    className="flex-1 px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white">
                                    {sending ? '⏳' : '↑'}
                                </button>
                            </div>
                        </div>
                        {(photoFile || docFile) && (
                            <div className="text-xs text-gray-400 flex items-center justify-between bg-gray-800/60 rounded px-2 py-1">
                                <span>{photoFile ? `📷 ${photoFile.name}` : `📎 ${docFile.name}`}</span>
                                <button onClick={() => { setPhotoFile(null); setDocFile(null); }} className="text-gray-400 hover:text-white ml-2">✕</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
