import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import clsx from 'clsx';

// ─── Base node wrapper ─────────────────────────────────────────────────────────
function BaseNode({ id, selected, color, icon, label, children, hasInput = true, hasOutput = true }) {
    return (
        <div
            className={clsx(
                'min-w-[200px] rounded-xl border-2 bg-gray-900 shadow-xl transition-all',
                selected ? 'border-brand shadow-brand/20' : 'border-gray-700 hover:border-gray-500'
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
                    className="!w-3 !h-3 !bg-gray-600 !border-2 !border-gray-400"
                />
            )}
            {hasOutput && (
                <Handle
                    type="source"
                    position={Position.Bottom}
                    className="!w-3 !h-3 !bg-brand !border-2 !border-brand-light"
                />
            )}
        </div>
    );
}

// ─── Start Node ────────────────────────────────────────────────────────────────
export const StartNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-emerald-700" icon="🚀" label="Start" hasInput={false}>
        {data.trigger && <span className="text-emerald-400">{data.trigger}</span>}
    </BaseNode>
));

// ─── Message Node ──────────────────────────────────────────────────────────────
export const MessageNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-blue-700" icon="💬" label={data.label || 'Повідомлення'}>
        {data.text && (
            <p className="line-clamp-2 text-gray-300">{data.text}</p>
        )}
        {data.keyboard?.length > 0 && (
            <div className="mt-1 text-blue-400">⌨️ {data.keyboard.length} кнопок</div>
        )}
    </BaseNode>
));

// ─── Claude Node ───────────────────────────────────────────────────────────────
export const ClaudeNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-violet-700" icon="🧠" label={data.label || 'Claude AI'}>
        {data.systemPrompt && (
            <p className="line-clamp-2 text-gray-300">{data.systemPrompt}</p>
        )}
        {data.model && <div className="mt-1 text-violet-400">{data.model}</div>}
    </BaseNode>
));

// ─── JS Node ───────────────────────────────────────────────────────────────────
export const JsNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-yellow-700" icon="⚡" label={data.label || 'JavaScript'}>
        {data.code && (
            <code className="line-clamp-2 font-mono text-yellow-300 text-[11px]">{data.code}</code>
        )}
    </BaseNode>
));

// ─── Condition Node ────────────────────────────────────────────────────────────
export const ConditionNode = memo(({ id, selected, data }) => (
    <div
        className={clsx(
            'min-w-[180px] rounded-xl border-2 bg-gray-900 shadow-xl transition-all',
            selected ? 'border-brand shadow-brand/20' : 'border-gray-700 hover:border-gray-500'
        )}
    >
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg bg-orange-700">
            <span>🔀</span>
            <span className="text-sm font-semibold text-white">{data.label || 'Умова'}</span>
        </div>
        {data.condition && (
            <div className="px-3 py-2 text-xs text-orange-300 font-mono line-clamp-2">{data.condition}</div>
        )}
        <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-600 !border-2 !border-gray-400" />
        <Handle
            type="source"
            id="true"
            position={Position.Bottom}
            style={{ left: '30%' }}
            className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-300"
        />
        <Handle
            type="source"
            id="false"
            position={Position.Bottom}
            style={{ left: '70%' }}
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-red-300"
        />
        <div className="flex justify-between px-2 pb-1.5 text-[10px]">
            <span className="text-emerald-400">TRUE</span>
            <span className="text-red-400">FALSE</span>
        </div>
    </div>
));

// ─── Connector Node ────────────────────────────────────────────────────────────
export const ConnectorNode = memo(({ id, selected, data }) => (
    <BaseNode
        id={id}
        selected={selected}
        color="bg-cyan-700"
        icon={data.connectorIcon || '🔌'}
        label={data.label || data.connectorType || 'Конектор'}
    >
        {data.config && (
            <div className="text-cyan-400">{JSON.stringify(data.config).slice(0, 60)}…</div>
        )}
    </BaseNode>
));

// ─── Save File Node ────────────────────────────────────────────────────────────
export const SaveFileNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-pink-700" icon="💾" label={data.label || 'Зберегти файл'}>
        {data.fileType && <div className="text-pink-400">{data.fileType}</div>}
    </BaseNode>
));

// ─── Wait Node ─────────────────────────────────────────────────────────────────
export const WaitNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-gray-600" icon="⏳" label={data.label || 'Очікування'}>
        {data.duration && <div className="text-gray-300">{data.duration}</div>}
        {data.hint && <p className="text-gray-400 text-[11px]">{data.hint}</p>}
    </BaseNode>
));

// ─── Load File Node (Gap #1) ────────────────────────────────────────────────────
export const LoadFileNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-indigo-700" icon="📂" label={data.label || 'Завантажити файл'}>
        {data.fileType && <div className="text-indigo-400">{data.fileType}</div>}
        {data.onMissing && <div className="text-indigo-300 text-[11px]">→ {data.onMissing}</div>}
    </BaseNode>
));

// ─── HTTP Request Node (Gap #3) ─────────────────────────────────────────────────
export const HttpRequestNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-teal-700" icon="🌐" label={data.label || 'HTTP запит'}>
        {data.url && <div className="text-teal-400 text-[11px] truncate">{data.url}</div>}
        {data.method && <div className="text-teal-300 text-[11px]">{data.method}</div>}
    </BaseNode>
));

// ─── Tag Node (new) ─────────────────────────────────────────────────────────────
export const TagNode = memo(({ id, selected, data }) => (
    <BaseNode id={id} selected={selected} color="bg-red-700" icon="🏷️" label={data.label || 'Тег'}>
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
    httpRequest: HttpRequestNode,
    tag: TagNode,
    abtest: ABTestNode,
};

// ─── Node palette items (for drag sidebar) ────────────────────────────────────
export const NODE_PALETTE = [
    { type: 'start', icon: '🚀', label: 'Start', color: 'border-emerald-700', defaultData: { trigger: '/start' } },
    { type: 'message', icon: '💬', label: 'Повідомлення', color: 'border-blue-700', defaultData: { text: 'Привіт!', keyboard: [] } },
    { type: 'claude', icon: '🧠', label: 'Claude AI', color: 'border-violet-700', defaultData: { systemPrompt: '', model: 'claude-haiku-4-5', temperature: 0.7, maxTokens: 1000 } },
    { type: 'js', icon: '⚡', label: 'JavaScript', color: 'border-yellow-700', defaultData: { code: '// your code\nreturn context;' } },
    { type: 'condition', icon: '🔀', label: 'Умова', color: 'border-orange-700', defaultData: { condition: 'context.score > 50' } },
    { type: 'connector', icon: '🔌', label: 'Конектор', color: 'border-cyan-700', defaultData: {} },
    { type: 'saveFile', icon: '💾', label: 'Зберегти файл', color: 'border-pink-700', defaultData: { fileType: 'report' } },
    { type: 'loadFile', icon: '📂', label: 'Завантажити файл', color: 'border-indigo-700', defaultData: { fileType: '', onMissing: 'ask', outputVar: 'context.file' } },
    { type: 'wait', icon: '⏳', label: 'Очікування', color: 'border-gray-600', defaultData: { duration: '5m', hint: '' } },
    { type: 'httpRequest', icon: '🌐', label: 'HTTP запит', color: 'border-teal-700', defaultData: { url: '', method: 'POST', bodyTemplate: {} } },
    { type: 'tag', icon: '🏷️', label: 'Тег', color: 'border-red-700', defaultData: { tag: '', action: 'add' } },
    { type: 'abtest', icon: '🧪', label: 'A/B тест', color: 'border-purple-700', defaultData: { variantA: '', variantB: '', percentA: 50, percentB: 50 } },
];
