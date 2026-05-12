import React, { lazy, Suspense } from 'react';
import { useFunnelStore } from '../../stores/funnelStore.js';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

const EDITORS = {
    claude: ['systemPrompt', 'messagesTemplate'],
    js: ['code'],
    message: [],
    condition: ['condition'],
    connector: [],
    saveFile: [],
    wait: [],
    start: [],
};

function Field({ label, children }) {
    return (
        <div>
            <label className="text-xs text-gray-400 block mb-1">{label}</label>
            {children}
        </div>
    );
}

function TextInput({ value, onChange, placeholder, multiline }) {
    const cls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand";
    if (multiline) return (
        <textarea
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            rows={3}
            className={cls + ' resize-y'}
        />
    );
    return (
        <input
            type="text"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className={cls}
        />
    );
}

function CodeBlock({ value, onChange, language = 'javascript' }) {
    return (
        <div className="h-64 border border-gray-700 rounded-lg overflow-hidden">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-500 text-sm">Завантаження редактора...</div>}>
                <MonacoEditor
                    defaultLanguage={language}
                    value={value || ''}
                    onChange={onChange}
                    theme="vs-dark"
                    options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        fontFamily: 'JetBrains Mono, monospace',
                        scrollBeyondLastLine: false,
                        lineNumbers: 'on',
                        tabSize: 2,
                        automaticLayout: true,
                    }}
                />
            </Suspense>
        </div>
    );
}

function MessageNodeEditor({ data, update }) {
    const addButton = () => update({ keyboard: [...(data.keyboard || []), { text: 'Кнопка', callback: 'action' }] });
    const removeButton = (i) => update({ keyboard: data.keyboard.filter((_, idx) => idx !== i) });
    const updateButton = (i, field, val) => update({
        keyboard: data.keyboard.map((b, idx) => idx === i ? { ...b, [field]: val } : b),
    });

    return (
        <div className="space-y-3">
            <Field label="Текст повідомлення">
                <CodeBlock value={data.text} onChange={v => update({ text: v })} language="markdown" />
            </Field>
            <Field label="Кнопки клавіатури">
                <div className="space-y-2">
                    {(data.keyboard || []).map((btn, i) => (
                        <div key={i} className="flex gap-2">
                            <input
                                value={btn.text}
                                onChange={e => updateButton(i, 'text', e.target.value)}
                                placeholder="Текст"
                                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                            />
                            <input
                                value={btn.callback}
                                onChange={e => updateButton(i, 'callback', e.target.value)}
                                placeholder="callback_data"
                                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-brand"
                            />
                            <button onClick={() => removeButton(i)} className="text-red-400 hover:text-red-300 px-2">✕</button>
                        </div>
                    ))}
                    <button
                        onClick={addButton}
                        className="w-full py-1.5 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-gray-400 text-sm transition-colors"
                    >
                        + Додати кнопку
                    </button>
                </div>
            </Field>
        </div>
    );
}

function ClaudeNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Модель">
                <select
                    value={data.model || 'claude-haiku-4-5'}
                    onChange={e => update({ model: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="claude-haiku-4-5">claude-haiku-4-5</option>
                    <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
                    <option value="claude-opus-4-5">claude-opus-4-5</option>
                </select>
            </Field>
            <Field label="System Prompt">
                <CodeBlock value={data.systemPrompt} onChange={v => update({ systemPrompt: v })} language="markdown" />
            </Field>
            <Field label="Messages Template (JSON)">
                <CodeBlock value={data.messagesTemplate} onChange={v => update({ messagesTemplate: v })} language="json" />
            </Field>
            <Field label="Зберегти відповідь у змінну">
                <TextInput value={data.outputVar} onChange={v => update({ outputVar: v })} placeholder="context.aiResponse" />
            </Field>
        </div>
    );
}

function JsNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <div className="bg-gray-800 rounded-lg px-3 py-2 text-xs text-gray-400 font-mono">
        // Доступні: context, user, session, db, logger<br />
        // Поверніть: return {'{'} ...context {'}'};
            </div>
            <Field label="JavaScript код">
                <CodeBlock value={data.code} onChange={v => update({ code: v })} />
            </Field>
        </div>
    );
}

function ConditionNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Умова (JavaScript)">
                <CodeBlock value={data.condition} onChange={v => update({ condition: v })} />
            </Field>
        </div>
    );
}

function ConnectorNodeEditor({ data, update, connectors }) {
    const connector = connectors.find(c => c.type === data.connectorType);
    return (
        <div className="space-y-3">
            <Field label="Тип конектора">
                <select
                    value={data.connectorType || ''}
                    onChange={e => {
                        const c = connectors.find(x => x.type === e.target.value);
                        update({ connectorType: e.target.value, connectorIcon: c?.icon, label: c?.name });
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="">Оберіть конектор</option>
                    {connectors.map(c => (
                        <option key={c.type} value={c.type}>{c.icon} {c.name}</option>
                    ))}
                </select>
            </Field>
            {connector && (
                <Field label="Конфігурація (JSON)">
                    <CodeBlock
                        value={data.config ? JSON.stringify(data.config, null, 2) : '{}'}
                        onChange={v => {
                            try { update({ config: JSON.parse(v) }); } catch { }
                        }}
                        language="json"
                    />
                </Field>
            )}
        </div>
    );
}

function StartNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Тригер">
                <select
                    value={data.trigger || '/start'}
                    onChange={e => update({ trigger: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="/start">/start команда</option>
                    <option value="deeplink">/start з deep link</option>
                    <option value="message">Будь-яке повідомлення</option>
                    <option value="callback">Callback кнопка</option>
                </select>
            </Field>
            {data.trigger === 'deeplink' && (
                <Field label="Deep link параметр">
                    <TextInput value={data.deeplinkParam} onChange={v => update({ deeplinkParam: v })} placeholder="bot21" />
                </Field>
            )}
        </div>
    );
}

export function NodeEditor() {
    const { selectedNode, updateNodeData, connectors, deleteNode } = useFunnelStore();

    if (!selectedNode) return null;

    const { type, data } = selectedNode;
    const update = (patch) => updateNodeData(selectedNode.id, patch);

    const removeNode = () => {
        if (!selectedNode?.id) return;
        deleteNode(selectedNode.id);
    };

    const renderEditor = () => {
        switch (type) {
            case 'start': return <StartNodeEditor data={data} update={update} />;
            case 'message': return <MessageNodeEditor data={data} update={update} />;
            case 'claude': return <ClaudeNodeEditor data={data} update={update} />;
            case 'js': return <JsNodeEditor data={data} update={update} />;
            case 'condition': return <ConditionNodeEditor data={data} update={update} />;
            case 'connector': return <ConnectorNodeEditor data={data} update={update} connectors={connectors} />;
            default: return <div className="text-gray-500 text-sm">Немає налаштувань для цього вузла</div>;
        }
    };

    return (
        <div className="w-80 shrink-0 bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <div>
                    <div className="text-sm font-semibold text-white capitalize">{type} node</div>
                    <div className="text-xs text-gray-500 font-mono">{selectedNode.id}</div>
                </div>
            </div>

            {/* Label */}
            <div className="px-4 py-3 border-b border-gray-800">
                <label className="text-xs text-gray-400 block mb-1">Назва вузла</label>
                <input
                    value={data.label || ''}
                    onChange={e => update({ label: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                />
            </div>

            {/* Type-specific editor */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
                {renderEditor()}
            </div>

            <div className="px-4 py-3 border-t border-gray-800">
                <button
                    onClick={removeNode}
                    className="w-full py-2 rounded-lg border border-red-900 bg-red-950/30 text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors text-sm"
                >
                    🗑 Видалити ноду
                </button>
                <div className="text-[11px] text-gray-500 mt-2">Також працює клавіша Delete у полотні воронки.</div>
            </div>
        </div>
    );
}
