import React, { memo, useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import clsx from 'clsx';
import { useFunnelStore } from '../../stores/funnelStore.js';
import { api } from '../../api/client.js';

// ─── Node stats cache (in-memory, 5 min TTL) ─────────────────────────────────
const _statsCache = {};
const STATS_TTL_MS = 5 * 60 * 1000;

function getCachedStats(botId, nodeId) {
    const key = `${botId}__${nodeId}`;
    const entry = _statsCache[key];
    if (!entry) return null;
    if (Date.now() - entry.ts > STATS_TTL_MS) { delete _statsCache[key]; return null; }
    return entry.data;
}
function setCachedStats(botId, nodeId, data) {
    _statsCache[`${botId}__${nodeId}`] = { data, ts: Date.now() };
}

function formatTokens(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function useNodeStats(nodeId) {
    const bot = useFunnelStore(s => s.bot);
    const botId = bot?.id;
    const [tokens, setTokens] = useState(() => botId ? getCachedStats(botId, nodeId)?.tokens : null);

    useEffect(() => {
        if (!botId || !nodeId) return;
        const cached = getCachedStats(botId, nodeId);
        if (cached) { setTokens(cached.tokens); return; }

        api.getNodeStats(botId, nodeId, '30d')
            .then(data => {
                if (data?.tokens) {
                    setCachedStats(botId, nodeId, data);
                    setTokens(data.tokens);
                }
            })
            .catch(() => {});
    }, [botId, nodeId]);

    return tokens;
}

// ─── Base node wrapper ─────────────────────────────────────────────────────────
function BaseNode({ id, selected, color, icon, label, description, children, hasInput = true, hasOutput = true }) {
    return (
        <div
            title={description || undefined}
            className={clsx(
                'min-w-[220px] max-w-[320px] rounded-xl border-2 bg-gray-900 shadow-xl transition-all cursor-pointer select-none group',
                selected ? 'border-brand shadow-brand/20' : 'border-gray-700 hover:border-gray-500 hover:shadow-gray-600/20'
            )}
        >
            {/* Header */}
            <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-t-lg', color)}>
                <span className="text-base">{icon}</span>
                <span className="text-sm font-semibold text-white truncate">{label}</span>
            </div>
            {/* Body */}
            {children && (
                <div className="px-3 py-2 text-xs text-gray-400">{children}</div>
            )}
            {/* Handles */}
            {hasInput && (
                <Handle
                    type="target"
                    position={Position.Top}
                    className="!w-3.5 !h-3.5 !bg-gray-600 !border-2 !border-gray-400 hover:!bg-gray-300 hover:!scale-125 transition-transform"
                />
            )}
            {hasOutput && (
                <Handle
                    type="source"
                    position={Position.Bottom}
                    className="!w-3.5 !h-3.5 !bg-brand !border-2 !border-brand-light hover:!bg-white hover:!scale-125 transition-transform"
                />
            )}
        </div>
    );
}

// ─── Start Node ────────────────────────────────────────────────────────────────
export const StartNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-emerald-700" icon="🚀" label={data.label || 'Start'} description={data.description} hasInput={false}>
        {data.trigger && <span className="text-emerald-400">{data.trigger}</span>}
        {data.trigger === 'webhook' && data.bodySchema && (
            <div className="text-emerald-300 text-[10px] mt-0.5">📬 POST webhook</div>
        )}
    </BaseNode>
));

// ─── Message Node ──────────────────────────────────────────────────────────────
export const MessageNode = memo(({ id, selected, data }) => {
    const btnCount = data.buttons?.flat().length || data.keyboard?.length || 0;
    return (
        <BaseNode id={id} selected={selected} color="bg-blue-700" icon="💬" label={data.label || 'Повідомлення'} description={data.description}>
            {data.text && (
                <p className="line-clamp-3 text-gray-300 whitespace-pre-wrap break-words">{data.text}</p>
            )}
            {btnCount > 0 && (
                <div className="mt-1 text-blue-400">⌨️ {btnCount} {btnCount === 1 ? 'кнопка' : 'кнопки'}</div>
            )}
        </BaseNode>
    );
});

// ─── Claude Node ───────────────────────────────────────────────────────────────
export const ClaudeNode = memo(({ id, selected, data }) => {
    const tokens = useNodeStats(id);

    const exitConditionLabel = () => {
        if (!data.exitCondition) return '';
        if (data.exitCondition === 'json_output') return '📋 JSON';
        if (data.exitCondition === 'markdown_output') return '📝 Markdown';
        if (data.exitCondition === 'user_confirms') return '✅ Підтвердження';
        if (data.exitCondition.startsWith('keyword:')) {
            const kw = data.exitCondition.slice('keyword:'.length);
            return `🔑 ${kw}`;
        }
        return '';
    };

    return (
        <BaseNode id={id} selected={selected} color="bg-violet-700" icon="🧠" label={data.label || 'Claude AI'} description={data.description}>
            <div className="mb-1 flex gap-1 flex-wrap">
                {data.mode === 'dialog' ? (
                    <span className="inline-flex items-center rounded bg-violet-900/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">💬 діалог</span>
                ) : (
                    <span className="inline-flex items-center rounded bg-violet-900/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">1×</span>
                )}
                {data.mode === 'dialog' && exitConditionLabel() && (
                    <span className="inline-flex items-center rounded bg-violet-900/50 px-2 py-0.5 text-[10px] text-violet-300">{exitConditionLabel()}</span>
                )}
            </div>
            {data.systemPrompt && (
                <p className="line-clamp-2 text-gray-300">{data.systemPrompt}</p>
            )}
            {data.model && <div className="mt-1 text-violet-400 text-[11px]">{data.model}</div>}
            {tokens && tokens.total > 0 && (
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-violet-300 bg-violet-900/30 rounded px-1.5 py-0.5 w-fit" title={`Вхідні: ${tokens.input.toLocaleString()}, Вихідні: ${tokens.output.toLocaleString()}, Виклики: ${tokens.calls}`}>
                    <span>🪙</span>
                    <span>{formatTokens(tokens.total)} токенів (30д)</span>
                </div>
            )}
        </BaseNode>
    );
});

// ─── JS Node ───────────────────────────────────────────────────────────────────
export const JsNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-yellow-700" icon="⚡" label={data.label || 'JavaScript'} description={data.description}>
        {data.code && (
            <code className="line-clamp-2 font-mono text-yellow-300 text-[11px]">{data.code}</code>
        )}
    </BaseNode>
));

// ─── Condition Node ────────────────────────────────────────────────────────────
const COND_COLORS = ['bg-emerald-500', 'bg-red-500', 'bg-yellow-500', 'bg-blue-500', 'bg-purple-500'];
const COND_BORDER = ['border-emerald-300', 'border-red-300', 'border-yellow-300', 'border-blue-300', 'border-purple-300'];
const COND_TEXT = ['text-emerald-400', 'text-red-400', 'text-yellow-400', 'text-blue-400', 'text-purple-400'];

export const ConditionNode = memo(({ id, selected, data }) => {
    // Support new multi-condition format: data.conditions = [{id, label, expression}]
    // and legacy single: data.condition = "js expression"
    const conditions = data.conditions?.length
        ? data.conditions
        : data.condition
            ? [{ id: 'true', label: 'TRUE', expression: data.condition }, { id: 'false', label: 'FALSE', expression: '' }]
            : [{ id: 'true', label: 'TRUE' }, { id: 'false', label: 'FALSE' }];

    const count = conditions.length;
    // Evenly spread handles
    const handlePositions = conditions.map((_, i) => `${Math.round(((i + 1) / (count + 1)) * 100)}%`);

    return (
        <div
            className={clsx(
                'min-w-[220px] max-w-[320px] rounded-xl border-2 bg-gray-900 shadow-xl transition-all cursor-pointer',
                selected ? 'border-brand shadow-brand/20' : 'border-gray-700 hover:border-gray-500 hover:shadow-gray-600/20'
            )}
        >
            <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg bg-orange-700">
                <span>🔀</span>
                <span className="text-sm font-semibold text-white truncate">{data.label || 'Умова'}</span>
            </div>
            {/* Show each condition label + expression */}
            <div className="px-3 py-2 space-y-1">
                {conditions.map((cond, i) => (
                    <div key={cond.id || i} className="flex items-start gap-1">
                        <span className={clsx('text-[9px] font-bold mt-0.5 shrink-0', COND_TEXT[i % COND_TEXT.length])}>
                            {i + 1}.
                        </span>
                        <div className="min-w-0">
                            <div className={clsx('text-[10px] font-semibold truncate', COND_TEXT[i % COND_TEXT.length])}>
                                {cond.label || cond.id}
                            </div>
                            {cond.expression && (
                                <div className="text-[9px] text-gray-500 font-mono line-clamp-1 break-all">{cond.expression}</div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-600 !border-2 !border-gray-400" />
            {conditions.map((cond, i) => (
                <Handle
                    key={cond.id || i}
                    type="source"
                    id={cond.id || String(i)}
                    position={Position.Bottom}
                    style={{ left: handlePositions[i] }}
                    className={clsx('!w-3 !h-3 !border-2', COND_COLORS[i % COND_COLORS.length], COND_BORDER[i % COND_BORDER.length])}
                />
            ))}
            {/* Labels below handles */}
            <div className="relative h-5 pb-1.5">
                {conditions.map((cond, i) => (
                    <span
                        key={cond.id || i}
                        className={clsx('absolute text-[9px] font-bold -translate-x-1/2', COND_TEXT[i % COND_TEXT.length])}
                        style={{ left: handlePositions[i] }}
                    >
                        {(cond.label || cond.id || String(i + 1)).substring(0, 8)}
                    </span>
                ))}
            </div>
        </div>
    );
});

// ─── Connector Node ────────────────────────────────────────────────────────────
export const ConnectorNode = memo(({ id, selected, data }) => (
    <BaseNode
        id={id}
        selected={selected}
        color="bg-cyan-700"
        icon={data.connectorType === 'wayforpay' ? '💳' : (data.connectorIcon || '🔌')}
        label={data.label || data.connectorType || 'Конектор'}
        description={data.description}
    >
        {/* Show connector name if available, otherwise type */}
        {data.savedConnectorName
            ? <div className="text-cyan-300 text-[11px] font-medium">📁 {data.savedConnectorName}</div>
            : data.connectorType && <div className="text-cyan-400 text-[11px]">{data.connectorType}</div>
        }
        {data.action && <div className="text-cyan-300 text-[11px]">{data.action}</div>}
        {data.outputVar && <div className="text-cyan-200 text-[11px]">→ {data.outputVar}</div>}
    </BaseNode>
));

// ─── Save File Node ────────────────────────────────────────────────────────────
export const SaveFileNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-pink-700" icon="💾" label={data.label || 'Зберегти файл'} description={data.description}>
        {data.fileType && <div className="text-pink-400">{data.fileType}</div>}
    </BaseNode>
));

// ─── Wait Node ─────────────────────────────────────────────────────────────────
export const WaitNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-gray-600" icon="⏳" label={data.label || 'Очікування'} description={data.description}>
        {(data.duration || data.unit) && <div className="text-gray-300">{data.duration} {data.unit || ''}</div>}
        {data.hint && <p className="text-gray-400 text-[11px]">{data.hint}</p>}
    </BaseNode>
));

export const WaitPaymentNode = memo(({ id, selected, data }) => (
    <div
        className={clsx(
            'min-w-[200px] rounded-xl border-2 bg-gray-900 shadow-xl transition-all',
            selected ? 'border-brand shadow-brand/20' : 'border-gray-700 hover:border-gray-500'
        )}
    >
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg bg-lime-700">
            <span>💳</span>
            <span className="text-sm font-semibold text-white">{data.label || 'Очікування оплати'}</span>
        </div>
        <div className="px-3 py-2 text-xs text-lime-200">Timeout: {data.timeoutHours || 24}h</div>
        <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-600 !border-2 !border-gray-400" />
        <Handle
            type="source"
            id="paid"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-300"
        />
        <Handle
            type="source"
            id="unpaid"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-red-300"
        />
        <div className="flex justify-between px-2 pb-1.5 text-[10px]">
            <span className="text-emerald-400">PAID</span>
            <span className="text-red-400">UNPAID</span>
        </div>
    </div>
));

// ─── Load File Node (Gap #1) ────────────────────────────────────────────────────
export const LoadFileNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-indigo-700" icon="📂" label={data.label || 'Завантажити файл'} description={data.description}>
        {data.fileType && <div className="text-indigo-400">{data.fileType}</div>}
        {data.onMissing && <div className="text-indigo-300 text-[11px]">→ {data.onMissing}</div>}
    </BaseNode>
));

// ─── Tag Node (new) ─────────────────────────────────────────────────────────────
export const TagNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-red-700" icon="🏷️" label={data.label || 'Тег'} description={data.description}>
        {data.tag && <div className="text-red-400">{data.tag}</div>}
        {data.action && <div className="text-red-300 text-[11px]">{data.action}</div>}
    </BaseNode>
));

// ─── A/B Test Node (new) ───────────────────────────────────────────────────────
export const ABTestNode = memo(({ id, selected, data }) => (
    <div
        className={clsx(
            'min-w-[200px] rounded-xl border-2 bg-gray-900 shadow-xl transition-all',
            selected ? 'border-brand shadow-brand/20' : 'border-gray-700 hover:border-gray-500'
        )}
    >
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg bg-purple-700">
            <span>🧪</span>
            <span className="text-sm font-semibold text-white">A/B тест</span>
        </div>
        {data.variantA && data.variantB && (
            <div className="px-3 py-2 text-xs text-purple-300">
                <div>A: {data.percentA || 50}%</div>
                <div>B: {data.percentB || 50}%</div>
            </div>
        )}
        <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-600 !border-2 !border-gray-400" />
        <Handle
            type="source"
            id="variantA"
            position={Position.Bottom}
            style={{ left: '25%' }}
            className="!w-3 !h-3 !bg-purple-500 !border-2 !border-purple-300"
        />
        <Handle
            type="source"
            id="variantB"
            position={Position.Bottom}
            style={{ left: '75%' }}
            className="!w-3 !h-3 !bg-purple-500 !border-2 !border-purple-300"
        />
        <div className="flex justify-between px-2 pb-1.5 text-[10px]">
            <span className="text-purple-400">Варіант A</span>
            <span className="text-purple-400">Варіант B</span>
        </div>
    </div>
));

// ─── Generate Document Node ────────────────────────────────────────────────────
export const GenerateDocumentNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-emerald-700" icon="📄" label={data.label || 'Генерувати документ'} description={data.description}>
        {data.template && <div className="text-emerald-400 text-[11px]">Шаблон: {data.template}</div>}
        {data.sourceVar && <div className="text-emerald-300 text-[11px]">Дані: {data.sourceVar}</div>}
        {data.sendToUser && <div className="text-emerald-300 text-[11px]">✉️ Відправити користувачу</div>}
    </BaseNode>
));

// ─── HTTP Encode Node ──────────────────────────────────────────────────────────
export const HttpEncodeNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-cyan-700" icon="🔒" label={data.label || 'Кодування Base64'} description={data.description}>
        {data.sourceVar && <div className="text-cyan-400 text-[11px]">Джерело: {data.sourceVar}</div>}
        {data.outputVar && <div className="text-cyan-300 text-[11px]">→ {data.outputVar}</div>}
    </BaseNode>
));

// ─── Fetch Telegram Profile Node ──────────────────────────────────────────────
export const FetchTelegramProfileNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-sky-700" icon="👤" label={data.label || 'TG профіль'} description={data.description}>
        <div className="text-sky-300 text-[11px]">→ tg_bio, tg_photo_url</div>
    </BaseNode>
));

// ─── HTTP Request Node ─────────────────────────────────────────────────────────
export const HttpRequestNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-teal-700" icon="🌐" label={data.label || 'HTTP запит'} description={data.description}>
        {data.method && <span className="text-[10px] font-bold text-teal-300 bg-teal-900/50 rounded px-1">{data.method}</span>}
        {data.url && <div className="text-teal-400 text-[11px] truncate mt-0.5">{data.url}</div>}
        {data.outputVar && <div className="text-teal-200 text-[11px]">→ {data.outputVar}</div>}
    </BaseNode>
));

// ─── Send Photo Node ────────────────────────────────────────────────────────────
export const SendPhotoNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-pink-700" icon="📸" label={data.label || 'Відправити фото'} description={data.description}>
        {data.photoVar && <div className="text-pink-400 text-[11px]">Фото: {data.photoVar}</div>}
        {data.caption && <div className="text-pink-300 text-[11px] line-clamp-1">{data.caption}</div>}
    </BaseNode>
));

export const SendDocumentNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-fuchsia-700" icon="📎" label={data.label || 'Відправити документ'} description={data.description}>
        {data.fileType && <div className="text-fuchsia-300 text-[11px]">Тип: {data.fileType}</div>}
        {data.fileVar && <div className="text-fuchsia-200 text-[11px]">Змінна: {data.fileVar}</div>}
    </BaseNode>
));

// ─── Knowledge Base Node ──────────────────────────────────────────────────────
export const KnowledgeBaseNode = memo(({ id, selected, data }) => {
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const blockCount = blocks.length;
    return (
        <BaseNode id={id} selected={selected} color="bg-amber-800" icon="📚" label={data.label || 'База знань'} description={data.description}>
            <div className="text-amber-300 text-[11px]">
                {blockCount === 0 ? 'Блоки не додані' : `${blockCount} ${blockCount === 1 ? 'блок' : blockCount < 5 ? 'блоки' : 'блоків'}`}
            </div>
            {blocks.slice(0, 3).map((b, i) => (
                <div key={b.id || i} className="text-amber-200 text-[10px] truncate">· {b.title || 'Без назви'}</div>
            ))}
            {blockCount > 3 && <div className="text-amber-400 text-[10px]">+{blockCount - 3} ще…</div>}
            {data.contextKey && <div className="mt-1 text-amber-100 text-[10px] font-mono">→ context.{data.contextKey}</div>}
        </BaseNode>
    );
});

// ─── Notify Admin Node ─────────────────────────────────────────────────────────
export const NotifyAdminNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-amber-700" icon="📣" label={data.label || 'Сповістити адміна'} description={data.description}>
        {data.targetKey && <div className="text-amber-300 text-[11px]">→ {data.targetKey}</div>}
        {data.notifyUser && <div className="text-amber-200 text-[11px]">+ Повідомити студента</div>}
    </BaseNode>
));

// ─── Node type map (for React Flow) ───────────────────────────────────────────
export const NODE_TYPES = {
    start: StartNode,
    message: MessageNode,
    claude: ClaudeNode,
    js: JsNode,
    condition: ConditionNode,
    connector: ConnectorNode,
    saveFile: SaveFileNode,
    loadFile: LoadFileNode,
    wait: WaitNode,
    wait_payment: WaitPaymentNode,
    httpRequest: HttpRequestNode,
    httpEncode: HttpEncodeNode,
    sendPhoto: SendPhotoNode,
    sendDocument: SendDocumentNode,
    tag: TagNode,
    abtest: ABTestNode,
    generateDocument: GenerateDocumentNode,
    fetchTelegramProfile: FetchTelegramProfileNode,
    notifyAdmin: NotifyAdminNode,
    knowledgeBase: KnowledgeBaseNode,
};

// ─── Node palette items (for drag sidebar) ────────────────────────────────────
export const NODE_PALETTE = [
    // ── Тригери ──
    { type: 'start', icon: '🚀', label: 'Start', color: 'border-emerald-700', group: 'Тригери',
        description: 'Стартова нода — починає виконання воронки за тригером (/start, webhook, etc.)',
        defaultData: { label: 'Start', trigger: '/start' } },
    // ── Повідомлення ──
    { type: 'message', icon: '💬', label: 'Повідомлення', color: 'border-blue-700', group: 'Повідомлення',
        description: 'Відправляє текстове повідомлення з опційними кнопками',
        defaultData: { label: 'Повідомлення', text: 'Привіт!', keyboard: [] } },
    { type: 'sendPhoto', icon: '📸', label: 'Відправити фото', color: 'border-pink-700', group: 'Повідомлення',
        description: 'Відправляє зображення з опційним підписом',
        defaultData: { label: 'Відправити фото', photoVar: 'context.photo', caption: '' } },
    { type: 'sendDocument', icon: '📎', label: 'Відправити документ', color: 'border-fuchsia-700', group: 'Повідомлення',
        description: 'Відправляє файл (PDF, Excel, zip тощо). fileKey — ім\'я env-змінної з URL або Telegram file_id',
        defaultData: { label: 'Відправити документ', fileKey: '', fileVar: '', caption: '' } },
    { type: 'notifyAdmin', icon: '📣', label: 'Сповістити адміна', color: 'border-amber-700', group: 'Повідомлення',
        description: 'Відправляє повідомлення адміну в Telegram',
        defaultData: { label: 'Сповістити адміна', targetKey: 'ADMIN_TELEGRAM_ID', message: '💰 Нова оплата!', notifyUser: true, userMessage: '✅ Оплату отримано! Дякую, що обрав курс.' } },
    // ── ШІ ──
    { type: 'claude', icon: '🧠', label: 'Claude AI', color: 'border-violet-700', group: 'ШІ',
        description: 'Виклик Claude AI — одиночний запит або діалог з умовою виходу',
        defaultData: { label: 'Claude AI', systemPrompt: '', model: 'claude-haiku-4-5', temperature: 0.7, maxTokens: 1000, mode: 'single', exitCondition: 'json_output' } },
    { type: 'generateDocument', icon: '📄', label: 'Генерувати документ', color: 'border-emerald-700', group: 'ШІ',
        description: 'Генерує DOCX-документ за шаблоном з даними сесії',
        defaultData: { label: 'Генерувати документ', template: 'student_profile', sourceVar: 'context.onboarding_result', filename: 'document.docx', sendToUser: true } },
    // ── Логіка ──
    { type: 'condition', icon: '🔀', label: 'Умова', color: 'border-orange-700', group: 'Логіка',
        description: 'Розгалуження потоку за JS-виразом або кількома умовами',
        defaultData: { label: 'Умова', condition: 'context.score > 50' } },
    { type: 'abtest', icon: '🧪', label: 'A/B тест', color: 'border-purple-700', group: 'Логіка',
        description: 'Розподіляє користувачів між двома варіантами у заданому відсотку',
        defaultData: { label: 'A/B тест', variantA: 'Варіант А', variantB: 'Варіант Б', percentA: 50, percentB: 50 } },
    { type: 'js', icon: '⚡', label: 'JavaScript', color: 'border-yellow-700', group: 'Логіка',
        description: 'Виконує довільний JavaScript код у контексті сесії',
        defaultData: { label: 'JavaScript', code: '// your code\nreturn context;' } },
    // ── Дані та файли ──
    { type: 'saveFile', icon: '💾', label: 'Зберегти файл', color: 'border-pink-700', group: 'Дані',
        description: 'Зберігає дані сесії як файл (прив\'язаний до користувача)',
        defaultData: { label: 'Зберегти файл', fileType: 'report' } },
    { type: 'loadFile', icon: '📂', label: 'Завантажити файл', color: 'border-indigo-700', group: 'Дані',
        description: 'Завантажує раніше збережений файл у контекст сесії',
        defaultData: { label: 'Завантажити файл', fileType: '', onMissing: 'ask', outputVar: 'context.file' } },
    { type: 'tag', icon: '🏷️', label: 'Тег', color: 'border-red-700', group: 'Дані',
        description: 'Додає або видаляє тег на профілі користувача',
        defaultData: { label: 'Тег', tag: '', action: 'add' } },
    { type: 'fetchTelegramProfile', icon: '👤', label: 'TG профіль', color: 'border-sky-700', group: 'Дані',
        description: 'Отримує bio та фото профілю Telegram — зберігає в context.tg_bio / context.tg_photo_url',
        defaultData: { label: 'TG профіль' } },
    // ── Інтеграції ──
    { type: 'connector', icon: '🔌', label: 'Конектор', color: 'border-cyan-700', group: 'Інтеграції',
        description: 'Виклик зовнішнього сервісу через збережений конектор (WayForPay, HeyGen, Replicate тощо)',
        defaultData: { label: 'Конектор' } },
    { type: 'httpRequest', icon: '🌐', label: 'HTTP запит', color: 'border-teal-700', group: 'Інтеграції',
        description: 'Відправляє HTTP запит до будь-якого API (GET/POST/PUT/DELETE)',
        defaultData: { label: 'HTTP запит', url: '', method: 'POST', outputVar: 'context.response' } },
    { type: 'httpEncode', icon: '🔒', label: 'Кодування Base64', color: 'border-cyan-700', group: 'Інтеграції',
        description: 'Кодує змінну контексту в Base64 (для передачі бінарних даних в API)',
        defaultData: { label: 'Кодування Base64', sourceVar: 'context.data', outputVar: 'context.encoded' } },
    // ── Очікування ──
    { type: 'knowledgeBase', icon: '📚', label: 'База знань', color: 'border-amber-800', group: 'ШІ',
        description: 'Зберігає блоки знань (FAQ, кейси, заперечення тощо). Виконує розумний пошук за запитом і вставляє результат у context для Claude.',
        defaultData: { label: 'База знань', contextKey: 'knowledge_base', blocks: [] } },
    { type: 'wait', icon: '⏳', label: 'Очікування', color: 'border-gray-600', group: 'Очікування',
        description: 'Затримка виконання: через N хвилин/годин або до конкретного часу',
        defaultData: { label: 'Очікування', duration: 5, unit: 'minutes', waitType: 'duration' } },
    { type: 'wait_payment', icon: '💳', label: 'Очікування оплати', color: 'border-lime-700', group: 'Очікування',
        description: 'Чекає підтвердження оплати WayForPay — просувається коли wfp_payment_status = approved',
        defaultData: { label: 'Очікування оплати', timeoutHours: 24 } },
];
