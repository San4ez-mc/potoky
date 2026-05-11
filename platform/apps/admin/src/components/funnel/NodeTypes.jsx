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
        {data.hint && <p className="text-gray-300">{data.hint}</p>}
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
    wait: WaitNode,
};

// ─── Node palette items (for drag sidebar) ────────────────────────────────────
export const NODE_PALETTE = [
    { type: 'start', icon: '🚀', label: 'Start', color: 'border-emerald-700', defaultData: { trigger: '/start' } },
    { type: 'message', icon: '💬', label: 'Повідомлення', color: 'border-blue-700', defaultData: { text: 'Привіт!' } },
    { type: 'claude', icon: '🧠', label: 'Claude AI', color: 'border-violet-700', defaultData: { systemPrompt: '', model: 'claude-haiku-4-5' } },
    { type: 'js', icon: '⚡', label: 'JavaScript', color: 'border-yellow-700', defaultData: { code: '// your code\nreturn context;' } },
    { type: 'condition', icon: '🔀', label: 'Умова', color: 'border-orange-700', defaultData: { condition: 'context.score > 50' } },
    { type: 'connector', icon: '🔌', label: 'Конектор', color: 'border-cyan-700', defaultData: {} },
    { type: 'saveFile', icon: '💾', label: 'Зберегти файл', color: 'border-pink-700', defaultData: { fileType: 'report' } },
    { type: 'wait', icon: '⏳', label: 'Очікування', color: 'border-gray-600', defaultData: { hint: 'Введіть відповідь' } },
];
