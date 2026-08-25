import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useFunnelStore } from '../../stores/funnelStore.js';
import { api } from '../../api/client.js';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));


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
    const editorRef = React.useRef(null);
    const canFormat = language === 'javascript' || language === 'typescript' || language === 'json';
    const doFormat = async () => {
        const ed = editorRef.current;
        if (!ed) return;
        const act = ed.getAction('editor.action.formatDocument');
        if (act) await act.run();
    };
    return (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
            {canFormat && (
                <div className="flex justify-end px-2 py-1 bg-gray-900 border-b border-gray-800">
                    <button type="button" onClick={doFormat}
                        className="text-[11px] text-gray-300 hover:text-white px-2 py-0.5 rounded hover:bg-gray-700 transition-colors"
                        title="Відформатувати код (розбити на рядки з відступами)">✨ Формат</button>
                </div>
            )}
            <div className="h-64">
                <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-500 text-sm">Завантаження редактора...</div>}>
                    <MonacoEditor
                        defaultLanguage={language}
                        value={value || ''}
                        onChange={onChange}
                        onMount={(editor) => { editorRef.current = editor; }}
                        theme="vs-dark"
                        options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            fontFamily: 'JetBrains Mono, monospace',
                            scrollBeyondLastLine: false,
                            lineNumbers: 'on',
                            tabSize: 2,
                            wordWrap: 'on',
                            automaticLayout: true,
                        }}
                    />
                </Suspense>
            </div>
        </div>
    );
}

function MessageNodeEditor({ data, update }) {
    // Canonical format: buttons = [[{text, url}], ...] (each inner array = one row)
    // Migrate from legacy `keyboard` format on first open
    const getButtons = () => {
        if (data.buttons) return data.buttons;
        if (data.keyboard) {
            // Convert legacy [{text, callback}] → [[{text, url:''}]]
            return data.keyboard.map(b => [{ text: b.text, url: b.url || b.callback || '' }]);
        }
        return [];
    };
    const buttons = getButtons();

    const addRow = () => update({ buttons: [...buttons, [{ text: 'Кнопка', url: '' }]] });
    const addBtnToRow = (rowIdx) => {
        const next = buttons.map((row, i) => i === rowIdx ? [...row, { text: 'Кнопка', url: '' }] : row);
        update({ buttons: next });
    };
    const removeRow = (rowIdx) => update({ buttons: buttons.filter((_, i) => i !== rowIdx) });
    const removeBtn = (rowIdx, btnIdx) => {
        const next = buttons.map((row, i) => i === rowIdx ? row.filter((_, j) => j !== btnIdx) : row)
            .filter(row => row.length > 0);
        update({ buttons: next });
    };
    const updateBtn = (rowIdx, btnIdx, field, val) => {
        const next = buttons.map((row, i) => i === rowIdx
            ? row.map((b, j) => j === btnIdx ? { ...b, [field]: val } : b)
            : row);
        update({ buttons: next });
    };

    const inputCls = "bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand";

    return (
        <div className="space-y-3">
            <Field label="Текст повідомлення">
                <CodeBlock value={data.text} onChange={v => update({ text: v })} language="markdown" />
            </Field>
            <Field label="Кнопки (inline keyboard)">
                <div className="space-y-2">
                    {buttons.map((row, rowIdx) => (
                        <div key={rowIdx} className="border border-gray-700 rounded-lg p-2 space-y-1 bg-gray-850">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-gray-500">Рядок {rowIdx + 1}</span>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => addBtnToRow(rowIdx)}
                                        className="text-[10px] text-blue-400 hover:text-blue-300 px-1"
                                        title="Додати кнопку в рядок"
                                    >+ кнопка</button>
                                    <button onClick={() => removeRow(rowIdx)} className="text-red-400 hover:text-red-300 text-[10px] px-1">✕ рядок</button>
                                </div>
                            </div>
                            {row.map((btn, btnIdx) => (
                                <div key={btnIdx} className="flex gap-1 items-center">
                                    <input
                                        value={btn.text || ''}
                                        onChange={e => updateBtn(rowIdx, btnIdx, 'text', e.target.value)}
                                        placeholder="Текст кнопки"
                                        className={inputCls + ' flex-1'}
                                    />
                                    <input
                                        value={btn.url || ''}
                                        onChange={e => updateBtn(rowIdx, btnIdx, 'url', e.target.value)}
                                        placeholder="URL або {{context.var}}"
                                        className={inputCls + ' flex-[2] font-mono text-xs'}
                                    />
                                    {row.length > 1 && (
                                        <button onClick={() => removeBtn(rowIdx, btnIdx)} className="text-red-400 hover:text-red-300 text-xs px-1">✕</button>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                    <button
                        onClick={addRow}
                        className="w-full py-1.5 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-gray-400 text-sm transition-colors"
                    >
                        + Додати рядок кнопок
                    </button>
                    <div className="text-[10px] text-gray-600">Кожен рядок — окремий рядок кнопок. В одному рядку може бути кілька кнопок.</div>
                </div>
            </Field>
            <Field label="Вкладення (PDF / файл)">
                <div className="space-y-2">
                    {data.attachmentUrl ? (
                        <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-green-400">
                            <span className="truncate flex-1" title={data.attachmentUrl}>📎 {data.attachmentUrl}</span>
                            <button
                                onClick={() => update({ attachmentUrl: '', attachmentFileName: '' })}
                                className="text-red-400 hover:text-red-300 ml-1 shrink-0"
                                title="Видалити вкладення"
                            >✕</button>
                        </div>
                    ) : (
                        <div className="text-[11px] text-gray-500 italic">Вкладення не встановлено</div>
                    )}
                    <input
                        value={data.attachmentUrl || ''}
                        onChange={e => update({ attachmentUrl: e.target.value })}
                        placeholder="URL файлу або {{env.PDF_URL}}"
                        className={inputCls + ' w-full font-mono text-xs'}
                    />
                    <input
                        value={data.attachmentFileName || ''}
                        onChange={e => update({ attachmentFileName: e.target.value })}
                        placeholder="Назва файлу (напр. presentation.pdf)"
                        className={inputCls + ' w-full'}
                    />
                    <div className="text-[10px] text-gray-600">URL підтримує змінні: <code className="text-gray-400">{'{{env.VAR}}'}</code> або <code className="text-gray-400">{'{{context.var}}'}</code>. Назва файлу — як він відображатиметься у Telegram.</div>
                </div>
            </Field>
            <Field label="Формат тексту (parse_mode)">
                <select
                    value={data.parseMode || ''}
                    onChange={e => update({ parseMode: e.target.value || undefined })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="">Без розмітки (звичайний текст)</option>
                    <option value="HTML">HTML</option>
                    <option value="Markdown">Markdown</option>
                    <option value="MarkdownV2">MarkdownV2</option>
                </select>
            </Field>
        </div>
    );
}

function ClaudeNodeEditor({ data, update }) {
    const [savedConnectors, setSavedConnectors] = useState([]);
    useEffect(() => {
        api.getSavedConnectors()
            .then(res => setSavedConnectors((res?.data || []).filter(s => s.type?.startsWith('claude'))))
            .catch(() => setSavedConnectors([]));
    }, []);

    const mode = data.mode || 'single';
    const exitCondition = data.exitCondition || 'json_output';
    const isKeywordExit = exitCondition.startsWith('keyword:');
    const keywordValue = isKeywordExit ? exitCondition.slice('keyword:'.length).trim() : '';
    const exitConditionType = isKeywordExit ? 'keyword' : exitCondition;

    const handleModeChange = (value) => {
        update({ mode: value, ...(value === 'dialog' ? { exitCondition: data.exitCondition || 'json_output' } : {}) });
    };
    const handleExitConditionChange = (value) => {
        update({ exitCondition: value === 'keyword' ? `keyword:${keywordValue || 'DONE'}` : value });
    };

    const selectCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand";

    return (
        <div className="space-y-3">
            <Field label="Конектор (Claude instance)">
                <select
                    value={data.connectorId || ''}
                    onChange={e => update({ connectorId: e.target.value })}
                    className={selectCls}
                >
                    <option value="">{'— Виберіть збережений Claude-конектор —'}</option>
                    {savedConnectors.map(sc => (
                        <option key={sc.id} value={sc.id}>{sc.name}</option>
                    ))}
                </select>
                {!data.connectorId && (
                    <div className="mt-1 text-[11px] text-gray-500">Рекомендовано зберегти Claude-конектор в ключах воронки як CLAUDE_CONNECTOR_ID для коректної роботи.</div>
                )}
            </Field>
            <Field label="Модель">
                <select
                    value={data.model || 'claude-haiku-4-5'}
                    onChange={e => update({ model: e.target.value })}
                    className={selectCls}
                >
                    <option value="claude-haiku-4-5">claude-haiku-4-5 (швидка)</option>
                    <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514 (основна)</option>
                    <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
                    <option value="claude-opus-4-5">claude-opus-4-5 (потужна)</option>
                </select>
            </Field>
            <Field label="Тип запиту до ШІ">
                <select value={mode} onChange={e => handleModeChange(e.target.value)} className={selectCls}>
                    <option value="single">Одиночний запит</option>
                    <option value="dialog">Діалог</option>
                </select>
                <div className="mt-1 text-[11px] text-gray-500">
                    Одиночний: один виклик і перехід далі. Діалог: бот спілкується поки не виконається умова завершення.
                </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Max tokens">
                    <input
                        type="number" min="256" step="256"
                        value={data.maxTokens ?? ''}
                        onChange={e => update({ maxTokens: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
                        placeholder="1000"
                        className={selectCls}
                    />
                </Field>
                <Field label="Temperature">
                    <input
                        type="number" min="0" max="1" step="0.1"
                        value={data.temperature ?? ''}
                        onChange={e => update({ temperature: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="0.7"
                        className={selectCls}
                    />
                </Field>
            </div>
            <div className="-mt-1 text-[10px] text-gray-500">Для довгих відповідей (контент-плани) став maxTokens 8000-16000.</div>
            <Field label="System Prompt">
                <CodeBlock value={data.systemPrompt} onChange={v => update({ systemPrompt: v })} language="markdown" />
            </Field>
            <Field label="Messages Template">
                <TextInput value={data.messagesTemplate} onChange={v => update({ messagesTemplate: v })} placeholder="{{conversationHistory}}" />
                <div className="mt-1 text-[11px] text-gray-500">Зазвичай: <code className="text-gray-400">{'{{conversationHistory}}'}</code></div>
            </Field>
            {mode === 'dialog' && (
                <Field label="Умова завершення діалогу">
                    <select value={exitConditionType} onChange={e => handleExitConditionChange(e.target.value)} className={selectCls}>
                        <option value="json_output">JSON у відповіді</option>
                        <option value="first_response">Перша відповідь (single)</option>
                        <option value="markdown_output">Markdown у відповіді</option>
                        <option value="user_confirms">Підтвердження користувача</option>
                        <option value="keyword">Ключове слово</option>
                    </select>
                    <div className="mt-1 text-[11px] text-gray-500">
                        Коли умова спрацює, бот збереже результат у змінну та перейде до наступної ноди.
                    </div>
                    {exitConditionType === 'keyword' && (
                        <div className="mt-2">
                            <TextInput value={keywordValue} onChange={v => update({ exitCondition: `keyword:${v}` })} placeholder="DONE" />
                        </div>
                    )}
                </Field>
            )}
            <Field label="Зберегти відповідь у змінну">
                <TextInput value={data.outputVar} onChange={v => update({ outputVar: v })} placeholder="context.aiResponse" />
            </Field>
        </div>
    );
}

// ── Agent Node ──────────────────────────────────────────────────────────────
// Досі agent-нода не мала свого редактора: у неї правився лише системний промпт,
// а інструменти й MCP-каталоги можна було змінити тільки скриптом. Тут вони
// редагуються поштучно — кожен інструмент окремою карткою.
function AgentToolCard({ tool, onChange, onRemove }) {
    const [open, setOpen] = useState(false);
    const set = (patch) => onChange({ ...tool, ...patch });

    let schemaText = '';
    try { schemaText = JSON.stringify(tool.inputSchema ?? {}, null, 2); } catch { schemaText = '{}'; }

    return (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-2">
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOpen(!open)} className="text-slate-400 hover:text-slate-200 text-xs w-4">
                    {open ? '▾' : '▸'}
                </button>
                <span className="font-mono text-[12px] text-slate-200">{tool.name || 'без назви'}</span>
                <span className="flex-1 truncate text-[11px] text-slate-500">{tool.description}</span>
                <button type="button" onClick={onRemove} className="text-[11px] text-red-400 hover:text-red-300">видалити</button>
            </div>

            {open && (
                <div className="mt-2 space-y-2 border-t border-slate-700 pt-2">
                    <Field label="Назва (її бачить модель)">
                        <TextInput value={tool.name} onChange={(v) => set({ name: v })} placeholder="drive_search" />
                    </Field>
                    <Field label="Опис — головне, за чим модель вирішує, коли викликати">
                        <TextInput value={tool.description} onChange={(v) => set({ description: v })} />
                    </Field>
                    <Field label="URL (рендериться шаблоном, доступні {{env.*}})">
                        <TextInput value={tool.url} onChange={(v) => set({ url: v })} placeholder="{{env.ORG_API_URL}}/drive/search" />
                    </Field>
                    <Field label="Схема аргументів (JSON Schema)">
                        <CodeBlock
                            value={schemaText}
                            onChange={(v) => {
                                try { set({ inputSchema: JSON.parse(v) }); } catch { /* лишаємо як є, поки JSON неповний */ }
                            }}
                            language="json"
                        />
                    </Field>
                </div>
            )}
        </div>
    );
}

function AgentNodeEditor({ data, update }) {
    const tools = Array.isArray(data.tools) ? data.tools : [];
    const servers = Array.isArray(data.mcpServers) ? data.mcpServers : [];

    const setTool = (i, next) => update({ tools: tools.map((t, k) => (k === i ? next : t)) });
    const setServer = (i, next) => update({ mcpServers: servers.map((x, k) => (k === i ? next : x)) });

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
                <Field label="Модель">
                    <TextInput value={data.model} onChange={(v) => update({ model: v })} placeholder="claude-sonnet-4-6" />
                </Field>
                <Field label="maxTokens">
                    <input type="number" value={data.maxTokens ?? ''} onChange={(e) => update({ maxTokens: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
                        className={selectCls} placeholder="4096" />
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <Field label="Кроків за один хід">
                    <input type="number" value={data.maxIterations ?? ''} onChange={(e) => update({ maxIterations: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
                        className={selectCls} placeholder="12" />
                </Field>
                <Field label="Режим">
                    <label className="flex items-center gap-2 text-[12px] text-gray-300 pt-2">
                        <input type="checkbox" checked={Boolean(data.dialogMode)} onChange={(e) => update({ dialogMode: e.target.checked })} />
                        діалоговий — лишається на ноді й чекає наступного повідомлення
                    </label>
                </Field>
            </div>

            <Field label="System Prompt">
                <CodeBlock value={data.systemPrompt} onChange={(v) => update({ systemPrompt: v })} language="markdown" />
            </Field>

            <div className="rounded-lg border border-slate-700 p-2">
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-slate-200">Власні інструменти ({tools.length})</span>
                    <button type="button"
                        onClick={() => update({ tools: [...tools, { name: '', description: '', url: '', method: 'POST', inputSchema: { type: 'object', properties: {} } }] })}
                        className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-600">+ інструмент</button>
                </div>
                <div className="space-y-2">
                    {tools.map((t, i) => (
                        <AgentToolCard key={i} tool={t}
                            onChange={(next) => setTool(i, next)}
                            onRemove={() => update({ tools: tools.filter((_, k) => k !== i) })} />
                    ))}
                    {!tools.length && <div className="text-[11px] text-gray-500">Немає. Інструменти можуть приходити з каталогу нижче.</div>}
                </div>
            </div>

            <div className="rounded-lg border border-emerald-700/50 p-2">
                <div className="mb-1 flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-emerald-200">Каталоги MCP ({servers.length})</span>
                    <button type="button"
                        onClick={() => update({ mcpServers: [...servers, { name: '', url: '', headers: {} }] })}
                        className="rounded bg-emerald-800 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-700">+ каталог</button>
                </div>
                <div className="mb-2 text-[10.5px] text-emerald-300/70">
                    Список інструментів приходить із самого сервісу під час запуску. Кешується, а при
                    недоступності береться остання робоча версія — бот не падає через перезапуск сусіда.
                </div>
                <div className="space-y-2">
                    {servers.map((srv, i) => (
                        <div key={i} className="rounded border border-emerald-800/60 bg-emerald-950/30 p-2 space-y-2">
                            <div className="flex items-center gap-2">
                                <TextInput value={srv.name} onChange={(v) => setServer(i, { ...srv, name: v })} placeholder="org-drive" />
                                <button type="button" onClick={() => update({ mcpServers: servers.filter((_, k) => k !== i) })}
                                    className="text-[11px] text-red-400 hover:text-red-300">видалити</button>
                            </div>
                            <TextInput value={srv.url} onChange={(v) => setServer(i, { ...srv, url: v })} placeholder="{{env.MCP_BASE_URL}}/drive" />
                            <Field label="Заголовки (JSON) — сюди йдуть секрет і companyId">
                                <CodeBlock
                                    value={(() => { try { return JSON.stringify(srv.headers ?? {}, null, 2); } catch { return '{}'; } })()}
                                    onChange={(v) => { try { setServer(i, { ...srv, headers: JSON.parse(v) }); } catch { /* неповний JSON */ } }}
                                    language="json"
                                />
                            </Field>
                        </div>
                    ))}
                    {!servers.length && <div className="text-[11px] text-gray-500">Каталогів немає — агент користується лише власними інструментами.</div>}
                </div>
            </div>
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
    // Support new multi-condition format and legacy single-condition
    const isMulti = Array.isArray(data.conditions) && data.conditions.length > 0;
    const conditions = isMulti ? data.conditions : [];

    const addCondition = () => update({
        conditions: [...conditions, { id: `cond_${Date.now()}`, label: 'Умова', expression: '' }],
    });
    const removeCondition = (i) => update({ conditions: conditions.filter((_, idx) => idx !== i) });
    const updateCondition = (i, field, val) => update({
        conditions: conditions.map((c, idx) => idx === i ? { ...c, [field]: val } : c),
    });

    const inputCls = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand font-mono";

    return (
        <div className="space-y-3">
            {!isMulti && (
                <div className="bg-orange-950/30 border border-orange-800 rounded-lg px-3 py-2 text-xs text-orange-300">
                    Цей вузол використовує legacy формат. Натисни «Перейти на умови» щоб конвертувати.
                </div>
            )}
            {!isMulti && (
                <>
                    <Field label="Умова (JavaScript, legacy)">
                        <CodeBlock value={data.condition} onChange={v => update({ condition: v })} />
                    </Field>
                    <button
                        onClick={() => update({ conditions: [{ id: 'cond_true', label: 'TRUE', expression: data.condition || '' }, { id: 'cond_false', label: 'FALSE', expression: '' }], condition: undefined })}
                        className="w-full py-1.5 border border-dashed border-orange-700 rounded-lg text-orange-400 hover:text-orange-200 text-sm transition-colors"
                    >
                        🔀 Перейти на multi-condition формат
                    </button>
                </>
            )}
            {isMulti && (
                <>
                    <div className="text-[11px] text-gray-500 bg-gray-800 rounded px-3 py-2 border border-gray-700">
                        Умови перевіряються <strong className="text-gray-300">по порядку</strong>. Перша що спрацювала — обирає гілку. Ребра від ноди призначаються в тому самому порядку.
                    </div>
                    <div className="space-y-3">
                        {conditions.map((cond, i) => (
                            <div key={i} className="border border-gray-700 rounded-lg p-3 space-y-2 bg-gray-850">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-gray-300">#{i + 1}</span>
                                    <button onClick={() => removeCondition(i)} className="text-red-400 hover:text-red-300 text-xs">✕ видалити</button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] text-gray-400 block mb-1">ID (slug)</label>
                                        <input value={cond.id} onChange={e => updateCondition(i, 'id', e.target.value)} className={inputCls} placeholder="cond_ready" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-gray-400 block mb-1">Назва</label>
                                        <input value={cond.label} onChange={e => updateCondition(i, 'label', e.target.value)} className={inputCls} placeholder="Готовий" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] text-gray-400 block mb-1">JavaScript вираз</label>
                                    <input value={cond.expression} onChange={e => updateCondition(i, 'expression', e.target.value)} className={inputCls} placeholder="context.result.ready_to_buy === true" />
                                </div>
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={addCondition}
                        className="w-full py-1.5 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-gray-400 text-sm transition-colors"
                    >
                        + Додати умову
                    </button>
                </>
            )}
        </div>
    );
}

function NotifyAdminNodeEditor({ data, update }) {
    const targetValue = data.targetKey || data.telegramId || 'ADMIN_TELEGRAM_ID';
    return (
        <div className="space-y-3">
            <Field label="Ключ Telegram ID адміна (env var name)">
                <TextInput
                    value={targetValue}
                    onChange={v => update({ targetKey: v, telegramId: undefined })}
                    placeholder="ADMIN_TELEGRAM_ID"
                />
                <div className="mt-1 text-[11px] text-gray-500">
                    Ім'я env-змінної (без <code>{'{{env.}}'}</code>), яка містить Telegram ID адміна.
                </div>
            </Field>
            <Field label="Повідомлення адміну">
                <CodeBlock
                    value={data.message || ''}
                    onChange={v => update({ message: v })}
                    language="markdown"
                />
            </Field>
            <Field label="Також повідомити студента?">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={!!data.notifyUser}
                        onChange={e => update({ notifyUser: e.target.checked })}
                        className="accent-brand"
                    />
                    <span className="text-sm text-gray-300">Відправити студенту повідомлення</span>
                </label>
            </Field>
            {data.notifyUser && (
                <Field label="Повідомлення студенту">
                    <TextInput
                        value={data.userMessage || ''}
                        onChange={v => update({ userMessage: v })}
                        placeholder="✅ Оплату отримано! Дякую, що обрав курс."
                        multiline
                    />
                </Field>
            )}
        </div>
    );
}

function ConnectorNodeEditor({ data, update, connectors }) {
    const [savedConnectors, setSavedConnectors] = useState([]);
    const [useMode, setUseMode] = useState(data.savedConnectorId ? 'saved' : 'manual');

    useEffect(() => {
        api.getSavedConnectors()
            .then(res => setSavedConnectors(res?.data || []))
            .catch(() => setSavedConnectors([]));
    }, []);

    const connector = connectors.find(c => c.type === data.connectorType);
    const filteredSaved = data.connectorType
        ? savedConnectors.filter(s => s.type === data.connectorType)
        : savedConnectors;

    const handleSelectSaved = (id) => {
        const sc = savedConnectors.find(s => s.id === id);
        if (sc) {
            update({
                savedConnectorId: sc.id,
                savedConnectorName: sc.name,
                connectorType: sc.type,
                config: sc.config,
                label: sc.name,
            });
        } else {
            update({ savedConnectorId: null, savedConnectorName: null });
        }
    };

    const handleModeSwitch = (mode) => {
        setUseMode(mode);
        if (mode === 'manual') {
            update({ savedConnectorId: null, savedConnectorName: null });
        }
    };

    return (
        <div className="space-y-3">
            <Field label="Тип конектора">
                <select
                    value={data.connectorType || ''}
                    onChange={e => {
                        const c = connectors.find(x => x.type === e.target.value);
                        update({ connectorType: e.target.value, connectorIcon: c?.icon, label: c?.name, savedConnectorId: null, savedConnectorName: null });
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="">Оберіть конектор</option>
                    {connectors.map(c => (
                        <option key={c.type} value={c.type}>{c.icon} {c.name}</option>
                    ))}
                </select>
            </Field>

            {/* Mode toggle */}
            <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                <button
                    onClick={() => handleModeSwitch('saved')}
                    className={`flex-1 py-2 transition-colors ${useMode === 'saved' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                >
                    📁 Збережений конектор
                </button>
                <button
                    onClick={() => handleModeSwitch('manual')}
                    className={`flex-1 py-2 transition-colors ${useMode === 'manual' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                >
                    ✏️ Ввести вручну
                </button>
            </div>

            {useMode === 'saved' && (
                <Field label="Оберіть збережений конектор">
                    {filteredSaved.length === 0 ? (
                        <div className="text-xs text-gray-500 bg-gray-800 rounded-lg px-3 py-3 border border-gray-700">
                            {data.connectorType
                                ? `Немає збережених конекторів типу "${data.connectorType}". Спершу створіть їх на сторінці Конектори.`
                                : 'Спочатку оберіть тип конектора.'}
                        </div>
                    ) : (
                        <select
                            value={data.savedConnectorId || ''}
                            onChange={e => handleSelectSaved(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        >
                            <option value="">— Оберіть конектор —</option>
                            {filteredSaved.map(sc => (
                                <option key={sc.id} value={sc.id}>{sc.name}</option>
                            ))}
                        </select>
                    )}
                    {data.savedConnectorId && (
                        <div className="text-xs text-green-400 mt-1">✓ Конектор: {data.savedConnectorName}</div>
                    )}
                </Field>
            )}

            {(useMode === 'manual' || (useMode === 'saved' && !data.savedConnectorId)) && connector && (
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

            {useMode === 'saved' && data.savedConnectorId && (
                <div className="text-xs text-gray-500 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
                    Конфігурація підтягується автоматично зі збереженого конектора
                </div>
            )}

            {/* WayForPay-specific action fields */}
            {data.connectorType === 'wayforpay' && (
                <>
                    <Field label="Дія">
                        <select
                            value={data.action || 'create_invoice'}
                            onChange={e => update({ action: e.target.value })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        >
                            <option value="create_invoice">create_invoice — Створити інвойс</option>
                        </select>
                    </Field>
                    <Field label="Сума (amount)">
                        <input
                            value={data.amount || ''}
                            onChange={e => update({ amount: e.target.value })}
                            placeholder="{{env.COURSE_PRICE_INT}}"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                        />
                    </Field>
                    <Field label="Валюта (currency)">
                        <select
                            value={data.currency || 'UAH'}
                            onChange={e => update({ currency: e.target.value })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        >
                            <option value="UAH">UAH — Гривня</option>
                            <option value="USD">USD — Долар</option>
                            <option value="EUR">EUR — Євро</option>
                        </select>
                    </Field>
                    <Field label="Опис продукту (description)">
                        <input
                            value={data.description || ''}
                            onChange={e => update({ description: e.target.value })}
                            placeholder="Курс «Фінансова система бізнесу»"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        />
                    </Field>
                    <Field label="Order Reference (унікальний ID замовлення)">
                        <input
                            value={data.orderReference || ''}
                            onChange={e => update({ orderReference: e.target.value })}
                            placeholder="course_{{context.spin_result.name}}_{{timestamp}}"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                        />
                    </Field>
                    <Field label="Output var (куди зберегти URL оплати)">
                        <input
                            value={data.outputVar || ''}
                            onChange={e => update({ outputVar: e.target.value })}
                            placeholder="context.payment_url"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                        />
                    </Field>
                </>
            )}

            {/* IbanOplata-specific action fields */}
            {data.connectorType === 'ibanoplata' && (
                <>
                    <Field label="Дія">
                        <select
                            value={data.action || 'create_invoice'}
                            onChange={e => update({ action: e.target.value })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        >
                            <option value="create_invoice">create_invoice — Створити посилання</option>
                            <option value="delete_invoice">delete_invoice — Видалити посилання</option>
                        </select>
                    </Field>
                    {data.action !== 'delete_invoice' && (
                        <>
                            <Field label="Сума (amount)">
                                <input
                                    value={data.amount || ''}
                                    onChange={e => update({ amount: e.target.value })}
                                    placeholder="{{context.payAmount}}"
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                                />
                            </Field>
                            <Field label="Призначення платежу (paymentPurpose)">
                                <input
                                    value={data.paymentPurpose || ''}
                                    onChange={e => update({ paymentPurpose: e.target.value })}
                                    placeholder="Оплата за товар {{context.orderRef}}"
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                                />
                            </Field>
                            <Field label="Output var (куди зберегти URL оплати)">
                                <input
                                    value={data.outputVar || ''}
                                    onChange={e => update({ outputVar: e.target.value })}
                                    placeholder="context.ibanPayUrl"
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                                />
                            </Field>
                        </>
                    )}
                    {data.action === 'delete_invoice' && (
                        <Field label="Invoice UID (що видалити)">
                            <input
                                value={data.invoiceUid || ''}
                                onChange={e => update({ invoiceUid: e.target.value })}
                                placeholder="{{context.ibanInvoiceUid}}"
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                            />
                        </Field>
                    )}
                </>
            )}

            {/* Monobank-specific action fields */}
            {data.connectorType === 'monobank' && (
                <>
                    <Field label="Дія">
                        <select
                            value={data.action || 'get_statement'}
                            onChange={e => update({ action: e.target.value })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        >
                            <option value="get_statement">get_statement — Виписка (кредити)</option>
                            <option value="mark_consumed">mark_consumed — Позначити транзакцію (антидубль)</option>
                        </select>
                    </Field>
                    <Field label="Вікно, годин (windowHours)">
                        <input
                            value={data.windowHours || ''}
                            onChange={e => update({ windowHours: e.target.value })}
                            placeholder="48"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                        />
                    </Field>
                    <Field label="Output var (куди зберегти виписку)">
                        <input
                            value={data.outputVar || ''}
                            onChange={e => update({ outputVar: e.target.value })}
                            placeholder="context.monoStatement"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand"
                        />
                    </Field>
                </>
            )}

            {/* Browser Agent (веб-автоматизація) */}
            {data.connectorType === 'browser_agent' && (
                <>
                    <Field label="Дія">
                        <select
                            value={data.action || 'replay'}
                            onChange={e => update({ action: e.target.value })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        >
                            <option value="replay">replay — Прогнати збережений сценарій</option>
                            <option value="agent">agent — ШІ веде браузер (dry-run)</option>
                            <option value="read">read — Прочитати сторінку (парсинг)</option>
                        </select>
                    </Field>
                    {data.action === 'agent' && (
                        <>
                            <Field label="Задача агенту (task)">
                                <textarea
                                    value={data.task || ''}
                                    onChange={e => update({ task: e.target.value })}
                                    rows={3}
                                    placeholder="Увійди на сайт, додай товари у кошик, заповни доставку. НЕ підтверджуй замовлення."
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand resize-none"
                                />
                            </Field>
                            <Field label="Стартовий URL (startUrl)">
                                <input value={data.startUrl || ''} onChange={e => update({ startUrl: e.target.value })} placeholder="{{env.BREWDROP_URL}}"
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand" />
                            </Field>
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input type="checkbox" checked={data.dryRun !== false} onChange={e => update({ dryRun: e.target.checked })} />
                                dry-run (не тиснути фінальний submit)
                            </label>
                        </>
                    )}
                    {data.action === 'replay' && (
                        <>
                            <Field label="Ключ сценарію (scenarioKey) або scenarioVar">
                                <input value={data.scenarioKey || ''} onChange={e => update({ scenarioKey: e.target.value })} placeholder="BREWDROP_SCENARIO"
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand" />
                            </Field>
                        </>
                    )}
                    {data.action === 'read' && (
                        <>
                            <Field label="URL">
                                <input value={data.url || ''} onChange={e => update({ url: e.target.value })} placeholder="https://..."
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand" />
                            </Field>
                            <Field label="Режим (mode)">
                                <select value={data.mode || 'markdown'} onChange={e => update({ mode: e.target.value })}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand">
                                    <option value="markdown">markdown</option>
                                    <option value="text">text</option>
                                    <option value="json">json</option>
                                    <option value="html">html</option>
                                </select>
                            </Field>
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input type="checkbox" checked={data.renderJs === true} onChange={e => update({ renderJs: e.target.checked })} />
                                render_js (через браузер, для JS-сайтів)
                            </label>
                        </>
                    )}
                    <Field label="Data var (обʼєкт із контексту: креди+товари+доставка)">
                        <input value={data.dataVar || ''} onChange={e => update({ dataVar: e.target.value })} placeholder="context.supplierOrder"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand" />
                    </Field>
                    <Field label="Output var (результат)">
                        <input value={data.outputVar || ''} onChange={e => update({ outputVar: e.target.value })} placeholder="context.browserResult"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand" />
                    </Field>
                </>
            )}
        </div>
    );
}

function FetchTelegramProfileNodeEditor() {
    return (
        <div className="space-y-2">
            <div className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-3 border border-gray-700">
                <div className="font-medium text-sky-400 mb-1">👤 Отримання профілю Telegram</div>
                <div>Тихо завантажує дані профілю користувача:</div>
                <ul className="mt-1 space-y-0.5 text-gray-500">
                    <li>• <code className="text-sky-300">context.tg_bio</code> — опис профілю</li>
                    <li>• <code className="text-sky-300">context.tg_photo_url</code> — URL фото профілю</li>
                </ul>
                <div className="mt-2 text-gray-500">Потребує ключ <code>TELEGRAM_BOT_TOKEN</code> у налаштуваннях бота.</div>
            </div>
        </div>
    );
}

function StartNodeEditor({ data, update }) {
    const bot = useFunnelStore(s => s.bot);
    const webhookUrl = bot?.slug
        ? `https://flows.fineko.space/webhook/bot/${bot.slug}`
        : 'https://flows.fineko.space/webhook/bot/{slug}';

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
                    <option value="webhook">Webhook (POST запит)</option>
                </select>
            </Field>
            {data.trigger === 'deeplink' && (
                <Field label="Deep link параметр">
                    <TextInput value={data.deeplinkParam} onChange={v => update({ deeplinkParam: v })} placeholder="bot21" />
                </Field>
            )}
            {data.trigger === 'webhook' && (
                <>
                    <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 px-3 py-2 space-y-1.5">
                        <div className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide">Endpoint для запуску воронки</div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-emerald-300 bg-emerald-900/50 rounded px-1.5 py-0.5">POST</span>
                            <code className="text-[11px] text-emerald-200 font-mono break-all">{webhookUrl}</code>
                            <button
                                onClick={() => navigator.clipboard?.writeText(webhookUrl)}
                                className="text-gray-400 hover:text-white text-xs shrink-0"
                                title="Скопіювати URL"
                            >📋</button>
                        </div>
                    </div>
                    <Field label="Схема тіла запиту (Body Schema)">
                        <CodeBlock
                            value={data.bodySchema || '{\n  "param1": "string",\n  "callbackUrl": "string"\n}'}
                            onChange={v => update({ bodySchema: v })}
                            language="json"
                        />
                        <div className="mt-1 text-[10px] text-gray-500">Опис параметрів POST-запиту (для документації). callbackUrl — URL куди відправити результат.</div>
                    </Field>
                    <Field label="Webhook Note (інструкція)">
                        <TextInput
                            value={data.webhookNote || ''}
                            onChange={v => update({ webhookNote: v })}
                            placeholder="Коментар про те як запустити цю воронку..."
                        />
                    </Field>
                </>
            )}
        </div>
    );
}

// ── NEW NODE EDITORS (Gap fillers + UI improvements) ────────────────────────────

function WaitNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Тип затримки">
                <select
                    value={data.waitType || 'duration'}
                    onChange={e => update({ waitType: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="duration">Тривалість (хв/год/дні)</option>
                    <option value="specificTime">До конкретного часу</option>
                    <option value="specificDate">До конкретної дати</option>
                </select>
            </Field>
            {data.waitType === 'duration' && (
                <div className="flex gap-2">
                    <input type="number" min="1" value={data.duration || 5} onChange={e => update({ duration: parseInt(e.target.value) })} className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
                    <select value={data.unit || 'minutes'} onChange={e => update({ unit: e.target.value })} className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white">
                        <option value="minutes">хвилини</option>
                        <option value="hours">години</option>
                        <option value="days">дні</option>
                        <option value="weeks">тижні</option>
                    </select>
                </div>
            )}
            <Field label="Дні тижня (для розправи)">
                <div className="grid grid-cols-7 gap-1">
                    {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'].map((day, i) => (
                        <label key={i} className="flex items-center gap-1">
                            <input type="checkbox" checked={data.daysOfWeek?.includes(i) || false} onChange={e => {
                                const days = data.daysOfWeek || [];
                                update({ daysOfWeek: e.target.checked ? [...days, i] : days.filter(d => d !== i) });
                            }} className="accent-brand" />
                            <span className="text-xs text-gray-400">{day}</span>
                        </label>
                    ))}
                </div>
            </Field>
            <Field label="Тихі години (від 22:00 до 9:00)?">
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={data.quietHours || false} onChange={e => update({ quietHours: e.target.checked })} className="accent-brand" />
                    <span className="text-sm text-gray-300">Не надсилати у ночі</span>
                </label>
            </Field>
        </div>
    );
}

function WaitPaymentNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Таймаут оплати (години)">
                <input
                    type="number"
                    min="1"
                    value={data.timeoutHours || 24}
                    onChange={e => update({ timeoutHours: Math.max(1, Number(e.target.value || 24)) })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
                />
            </Field>
            <div className="text-xs text-gray-500 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
                Вихід <span className="text-emerald-400">PAID</span> спрацьовує, коли
                <code className="mx-1 text-emerald-300">context.wfp_payment_status === 'approved'</code>.
                Інакше після таймауту піде у <span className="text-red-400">UNPAID</span>.
            </div>
        </div>
    );
}

function HttpEncodeNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Назва ноди">
                <TextInput value={data.label} onChange={v => update({ label: v })} placeholder="Кодування Base64" />
            </Field>
            <Field label="Джерело даних (sourceVar)">
                <TextInput value={data.sourceVar} onChange={v => update({ sourceVar: v })} placeholder="context.mermaidCode" />
            </Field>
            <Field label="Вивести в змінну (outputVar)">
                <TextInput value={data.outputVar} onChange={v => update({ outputVar: v })} placeholder="context.encodedCode" />
            </Field>
        </div>
    );
}

function SendPhotoNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Назва ноди">
                <TextInput value={data.label} onChange={v => update({ label: v })} placeholder="Відправити фото" />
            </Field>
            <Field label="Змінна з фото (photoVar)">
                <TextInput value={data.photoVar} onChange={v => update({ photoVar: v })} placeholder="context.pngData" />
            </Field>
            <Field label="Підпис до фото (caption)">
                <TextInput value={data.caption} onChange={v => update({ caption: v })} placeholder="Ось ваша схема бізнес-процесу" multiline />
            </Field>
        </div>
    );
}

function SendDocumentNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Назва ноди">
                <TextInput value={data.label} onChange={v => update({ label: v })} placeholder="Відправити документ" />
            </Field>
            <Field label="fileKey — ключ env-змінної з URL файлу">
                <TextInput value={data.fileKey} onChange={v => update({ fileKey: v })} placeholder="PRESENTATION_PDF_URL" />
                <div className="mt-1 text-[11px] text-gray-500">
                    Ім'я env-змінної (без <code>{'{{env.}}'}</code>), яка містить URL або file_id файлу. Використовується якщо URL захардкоджено в env.
                </div>
            </Field>
            <Field label="fileVar — контекстна змінна з URL/file_id (динамічно)">
                <TextInput value={data.fileVar} onChange={v => update({ fileVar: v })} placeholder="context.presentation_url" />
            </Field>
            <Field label="Підпис (caption)">
                <TextInput value={data.caption} onChange={v => update({ caption: v })} placeholder="Ось презентація курсу" multiline />
            </Field>
        </div>
    );
}

function SaveFileNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Назва ноди">
                <TextInput value={data.label} onChange={v => update({ label: v })} placeholder="Зберегти файл" />
            </Field>
            <Field label="Тип файлу (fileType)">
                <TextInput value={data.fileType} onChange={v => update({ fileType: v })} placeholder="cashflow_articles" />
            </Field>
            <Field label="Змінна для контенту (contentVar)">
                <TextInput value={data.contentVar} onChange={v => update({ contentVar: v })} placeholder="context.articles_result" />
            </Field>
        </div>
    );
}

function LoadFileNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Тип файлу (fileType)">
                <select
                    value={data.fileType || ''}
                    onChange={e => update({ fileType: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="">Оберіть тип</option>
                    <option value="cashflow_articles">cashflow_articles → context.cashflowArticles</option>
                    <option value="pl_articles">pl_articles → context.plArticles</option>
                    <option value="business_process">business_process → context.businessProcess</option>
                    <option value="business_process_v2">business_process_v2 → context.businessProcessV2</option>
                    <option value="cashflow_table_url">cashflow_table_url → context.sheetsUrl</option>
                    <option value="combined_table_url">combined_table_url → context.combinedUrl</option>
                    <option value="financial_mechanics">financial_mechanics → context.financialMechanics</option>
                    <option value="salary_processes">salary_processes → context.salaryProcesses</option>
                    <option value="payment_processes">payment_processes → context.paymentProcesses</option>
                    <option value="balance_articles">balance_articles → context.balanceArticles</option>
                    <option value="balance_table_url">balance_table_url → context.balanceUrl</option>
                    <option value="payment_calendar_url">payment_calendar_url → context.calendarUrl</option>
                    <option value="team_instructions">team_instructions → context.teamInstructions</option>
                    <option value="user_onboarding_data">user_onboarding_data → context.onboarding_result</option>
                </select>
            </Field>
            <Field label="Що робити якщо файлу немає?">
                <select
                    value={data.onMissing || 'ask'}
                    onChange={e => update({ onMissing: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="ask">Запитати користувача</option>
                    <option value="skip">Пропустити</option>
                    <option value="block">Заблокувати (показати повідомлення)</option>
                </select>
            </Field>
            <Field label="Зберегти у змінну (авто-маппінг за типом)">
                <TextInput value={data.outputVar} onChange={v => update({ outputVar: v })} placeholder="auto-mapped from fileType" disabled />
            </Field>
        </div>
    );
}

function HttpRequestNodeEditor({ data, update }) {
    const selectCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand";
    return (
        <div className="space-y-3">
            <Field label="URL">
                <TextInput value={data.url} onChange={v => update({ url: v })} placeholder="https://... або {{env.SERVICE_URL}}/path" />
            </Field>
            <Field label="Метод">
                <select
                    value={data.method || 'POST'}
                    onChange={e => update({ method: e.target.value })}
                    className={selectCls}
                >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                </select>
            </Field>
            <Field label="Заголовки (headers, JSON)">
                <CodeBlock
                    value={data.headers ? JSON.stringify(data.headers, null, 2) : '{\n  "Content-Type": "application/json"\n}'}
                    onChange={v => { try { update({ headers: JSON.parse(v) }); } catch { } }}
                    language="json"
                />
                <div className="mt-1 text-[10px] text-gray-500">Значення підтримують <code className="text-gray-400">{'{{env.KEY}}'}</code> та <code className="text-gray-400">{'{{context.x}}'}</code>.</div>
            </Field>
            <Field label="Тіло запиту (body — рядок/JSON з шаблонами)">
                <CodeBlock
                    value={typeof data.body === 'string' ? data.body : (data.body ? JSON.stringify(data.body, null, 2) : '')}
                    onChange={v => update({ body: v })}
                    language="json"
                />
                <div className="mt-1 text-[10px] text-gray-500">Рядок з підстановкою <code className="text-gray-400">{'{{context.x}}'}</code>/<code className="text-gray-400">{'{{env.KEY}}'}</code>. Для POST/PUT/PATCH.</div>
            </Field>
            <Field label="Зберегти відповідь у (outputVar)">
                <TextInput value={data.outputVar} onChange={v => update({ outputVar: v })} placeholder="context.response" />
            </Field>
            <Field label="Поле з відповіді (responseField, JSON path)">
                <TextInput value={data.responseField} onChange={v => update({ responseField: v })} placeholder="answer  або  data.url" />
                <div className="mt-1 text-[10px] text-gray-500">Якщо задано — збережеться лише це поле з JSON-відповіді. Порожнє — вся відповідь.</div>
            </Field>
            <Field label="Тип відповіді (responseType)">
                <select value={data.responseType || 'json'} onChange={e => update({ responseType: e.target.value })} className={selectCls}>
                    <option value="json">JSON</option>
                    <option value="text">Текст</option>
                </select>
            </Field>
            <Field label="Ігнорувати помилки?">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!data.ignoreErrors} onChange={e => update({ ignoreErrors: e.target.checked })} className="accent-brand" />
                    <span className="text-sm text-gray-300">Продовжити воронку навіть якщо запит впав</span>
                </label>
            </Field>
        </div>
    );
}

function TagNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Дія">
                <select
                    value={data.action || 'add'}
                    onChange={e => update({ action: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="add">Додати тег</option>
                    <option value="remove">Видалити тег</option>
                </select>
            </Field>
            <Field label="Тег">
                <TextInput value={data.tag} onChange={v => update({ tag: v })} placeholder="block_2_done" />
            </Field>
        </div>
    );
}

function ABTestNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Варіант A (%)">
                <div className="flex gap-2">
                    <input type="number" min="0" max="100" value={data.percentA || 50} onChange={e => {
                        const pA = parseInt(e.target.value);
                        update({ percentA: pA, percentB: 100 - pA });
                    }} className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
                    <span className="text-gray-400 px-2 py-1.5">%</span>
                </div>
            </Field>
            <Field label="Назва варіанта A">
                <TextInput value={data.variantA} onChange={v => update({ variantA: v })} placeholder="Версія А" />
            </Field>
            <div className="text-xs text-gray-500 text-right">Варіант B: {100 - (data.percentA || 50)}%</div>
            <Field label="Назва варіанта B">
                <TextInput value={data.variantB} onChange={v => update({ variantB: v })} placeholder="Версія Б" />
            </Field>
        </div>
    );
}

function GenerateDocumentNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Назва ноди">
                <TextInput value={data.label} onChange={v => update({ label: v })} placeholder="Генерувати документ" />
            </Field>
            <Field label="Шаблон документу">
                <select
                    value={data.template || 'student_profile'}
                    onChange={e => update({ template: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="student_profile">Профіль студента (student_profile)</option>
                    <option value="business_process">Бізнес-процес (business_process)</option>
                    <option value="cashflow_table">Таблиця Cashflow (cashflow_table)</option>
                    <option value="pl_table">P&L звіт (pl_table)</option>
                    <option value="balance_table">Баланс (balance_table)</option>
                </select>
            </Field>
            <Field label="Джерело даних (context змінна)">
                <TextInput value={data.sourceVar} onChange={v => update({ sourceVar: v })} placeholder="context.onboarding_result" />
            </Field>
            <Field label="Назва файлу">
                <TextInput value={data.filename} onChange={v => update({ filename: v })} placeholder="document.docx" />
            </Field>
            <Field label="Відправити користувачу?">
                <div className="flex gap-2">
                    <button
                        onClick={() => update({ sendToUser: true })}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${data.sendToUser ? 'bg-blue-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white'
                            }`}
                    >
                        Так ✓
                    </button>
                    <button
                        onClick={() => update({ sendToUser: false })}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${!data.sendToUser ? 'bg-blue-600 text-white' : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white'
                            }`}
                    >
                        Ні ✕
                    </button>
                </div>
            </Field>
        </div>
    );
}

function KnowledgeBaseNodeEditor({ data, update }) {
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];

    const addBlock = () => {
        const id = `block_${Date.now()}`;
        update({ blocks: [...blocks, { id, title: 'Новий блок', content: '' }] });
    };

    const updateBlock = (idx, field, val) => {
        const next = blocks.map((b, i) => i === idx ? { ...b, [field]: val } : b);
        update({ blocks: next });
    };

    const removeBlock = (idx) => {
        update({ blocks: blocks.filter((_, i) => i !== idx) });
    };

    const inputCls = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand";

    return (
        <div className="space-y-4">
            <Field label="Контекстна змінна (contextKey)">
                <TextInput
                    value={data.contextKey || 'knowledge_base'}
                    onChange={v => update({ contextKey: v })}
                    placeholder="knowledge_base"
                />
                <div className="mt-1 text-[10px] text-gray-500">
                    Результат пошуку зберігається в <code className="text-gray-400">{'{{context.knowledge_base}}'}</code> — вставляй в systemPrompt Claude.
                </div>
            </Field>

            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-gray-400">Блоки знань</label>
                    <button
                        onClick={addBlock}
                        className="text-xs text-amber-400 hover:text-amber-300 border border-amber-800 hover:border-amber-600 rounded px-2 py-0.5 transition-colors"
                    >
                        + Додати блок
                    </button>
                </div>

                {blocks.length === 0 && (
                    <div className="text-center py-6 border border-dashed border-gray-700 rounded-lg text-gray-500 text-sm">
                        Блоків ще немає.<br />
                        <span className="text-xs">Натисни «+ Додати блок» щоб почати.</span>
                    </div>
                )}

                <div className="space-y-3">
                    {blocks.map((block, idx) => (
                        <div key={block.id || idx} className="border border-gray-700 rounded-lg overflow-hidden bg-gray-850">
                            {/* Block header */}
                            <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-800 border-b border-gray-700">
                                <span className="text-amber-400 text-xs shrink-0">📁</span>
                                <input
                                    value={block.title || ''}
                                    onChange={e => updateBlock(idx, 'title', e.target.value)}
                                    placeholder="Назва блоку (напр. «Кейси клієнтів»)"
                                    className="flex-1 bg-transparent border-0 text-sm font-medium text-white placeholder-gray-500 focus:outline-none"
                                />
                                <button
                                    onClick={() => removeBlock(idx)}
                                    className="text-red-500 hover:text-red-400 text-xs px-1 shrink-0"
                                    title="Видалити блок"
                                >
                                    ✕
                                </button>
                            </div>
                            {/* Block content */}
                            <textarea
                                value={block.content || ''}
                                onChange={e => updateBlock(idx, 'content', e.target.value)}
                                placeholder="Вміст блоку: FAQ, кейси, заперечення, умови тощо…"
                                rows={5}
                                className={inputCls + ' rounded-none border-0 resize-y text-xs font-mono'}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-[11px] text-gray-400 space-y-1">
                <div className="text-gray-300 font-medium mb-1">💡 Як це працює</div>
                <div>• Нода виконується <strong>до</strong> Claude-ноди в тому ж потоці</div>
                <div>• Пошук по останньому повідомленню клієнта — знаходить 1-3 найрелевантніших блоки</div>
                <div>• Вставляй в systemPrompt Claude: <code className="text-amber-300">{'{{context.knowledge_base}}'}</code></div>
                <div>• Приклад блоків: «Часті питання», «Кейси», «Заперечення», «Ціни», «Гарантії»</div>
            </div>
        </div>
    );
}

// Fallback-редактор для типів без власного редактора — редагування data як сирий JSON.
// Гарантує, що БУДЬ-ЯКУ ноду можна налаштувати через інтерфейс (нічого суто-кодового).
function GenericJsonNodeEditor({ type, data, update }) {
    const { label, description, ...rest } = data || {};
    const [text, setText] = useState(() => JSON.stringify(rest, null, 2));
    const [err, setErr] = useState('');

    const apply = (v) => {
        setText(v);
        try {
            const parsed = JSON.parse(v || '{}');
            setErr('');
            update({ ...parsed });
        } catch (e) {
            setErr('Некоректний JSON');
        }
    };

    return (
        <div className="space-y-3">
            <div className="bg-amber-950/30 border border-amber-800 rounded-lg px-3 py-2 text-[11px] text-amber-300">
                Тип «{type}» не має спеціального редактора. Нижче — усі поля ноди як JSON. Редагуй прямо тут.
            </div>
            <Field label="Дані ноди (JSON)">
                <CodeBlock value={text} onChange={apply} language="json" />
            </Field>
            {err && <div className="text-xs text-red-400">{err}</div>}
        </div>
    );
}

// ── Наступний крок — редагування вихідних ребер прямо з панелі ноди ──────────
// Раніше єдиний спосіб змінити "куди веде нода" — тягати стрілку руками на
// полотні. Для condition-нод (мінімум 2 гілки) і особливо для multi-condition
// (N гілок за порядком conditions[]) це незручно й легко забути гілку.
function NextStepEditor({ nodeId, type, data }) {
    const { nodes, edges, setEdges } = useFunnelStore();
    const candidates = nodes.filter((n) => n.id !== nodeId);
    const isMulti = type === 'condition' && Array.isArray(data.conditions) && data.conditions.length > 0;
    const isLegacyCond = type === 'condition' && !isMulti;
    const outEdges = edges.filter((e) => e.source === nodeId);
    const selectCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand";
    const label = (n) => (n && (n.data?.label || n.id)) || '';

    const setSingleTarget = (targetId) => {
        setEdges((prev) => {
            const filtered = prev.filter((e) => e.source !== nodeId);
            if (!targetId) return filtered;
            return [...filtered, { id: `edge_${nodeId}_${Date.now()}`, source: nodeId, target: targetId }];
        });
    };
    const setHandleTarget = (handle, targetId) => {
        setEdges((prev) => {
            const filtered = prev.filter((e) => !(e.source === nodeId && (e.sourceHandle || 'true') === handle));
            if (!targetId) return filtered;
            return [...filtered, { id: `edge_${nodeId}_${handle}_${Date.now()}`, source: nodeId, target: targetId, sourceHandle: handle }];
        });
    };
    // multi-condition: N-та позиція conditions[] = N-те вихідне ребро ЗА ПОРЯДКОМ
    // (двигун не дивиться на handle тут, лише на позицію серед ребер цієї ноди).
    const setOrderedTarget = (index, targetId) => {
        setEdges((prev) => {
            const others = prev.filter((e) => e.source !== nodeId);
            const current = prev.filter((e) => e.source === nodeId);
            const next = [...current];
            while (next.length <= index) next.push(null);
            next[index] = targetId ? { id: current[index]?.id || `edge_${nodeId}_${index}_${Date.now()}`, source: nodeId, target: targetId } : null;
            return [...others, ...next.filter(Boolean)];
        });
    };

    if (isMulti) {
        return (
            <div className="px-4 py-3 border-t border-gray-800 space-y-2">
                <div className="text-xs text-gray-400 mb-1">Наступний крок (за умовами, у порядку зверху вниз)</div>
                {data.conditions.map((c, i) => (
                    <div key={c.id || i}>
                        <label className="text-[11px] text-gray-500 block mb-0.5">{c.label || `Умова ${i + 1}`}</label>
                        <select className={selectCls} value={outEdges[i]?.target || ''} onChange={(e) => setOrderedTarget(i, e.target.value)}>
                            <option value="">— не задано —</option>
                            {candidates.map((n) => <option key={n.id} value={n.id}>{label(n)}</option>)}
                        </select>
                    </div>
                ))}
            </div>
        );
    }
    if (isLegacyCond) {
        const trueEdge = outEdges.find((e) => (e.sourceHandle || 'true') === 'true');
        const falseEdge = outEdges.find((e) => e.sourceHandle === 'false');
        return (
            <div className="px-4 py-3 border-t border-gray-800 space-y-2">
                <div className="text-xs text-gray-400 mb-1">Наступний крок</div>
                <div>
                    <label className="text-[11px] text-gray-500 block mb-0.5">Якщо TRUE</label>
                    <select className={selectCls} value={trueEdge?.target || ''} onChange={(e) => setHandleTarget('true', e.target.value)}>
                        <option value="">— не задано —</option>
                        {candidates.map((n) => <option key={n.id} value={n.id}>{label(n)}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-[11px] text-gray-500 block mb-0.5">Якщо FALSE</label>
                    <select className={selectCls} value={falseEdge?.target || ''} onChange={(e) => setHandleTarget('false', e.target.value)}>
                        <option value="">— не задано —</option>
                        {candidates.map((n) => <option key={n.id} value={n.id}>{label(n)}</option>)}
                    </select>
                </div>
            </div>
        );
    }
    return (
        <div className="px-4 py-3 border-t border-gray-800">
            <div className="text-xs text-gray-400 mb-1">Наступний крок</div>
            <select className={selectCls} value={outEdges[0]?.target || ''} onChange={(e) => setSingleTarget(e.target.value)}>
                <option value="">— не задано —</option>
                {candidates.map((n) => <option key={n.id} value={n.id}>{label(n)}</option>)}
            </select>
        </div>
    );
}

export function NodeEditor({ embedded = false, onClose }) {
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
            case 'agent': return <AgentNodeEditor data={data} update={update} />;
            case 'js': return <JsNodeEditor data={data} update={update} />;
            case 'condition': return <ConditionNodeEditor data={data} update={update} />;
            case 'connector': return <ConnectorNodeEditor data={data} update={update} connectors={connectors} />;
            case 'saveFile': return <SaveFileNodeEditor data={data} update={update} />;
            case 'wait': return <WaitNodeEditor data={data} update={update} />;
            case 'wait_payment': return <WaitPaymentNodeEditor data={data} update={update} />;
            case 'loadFile': return <LoadFileNodeEditor data={data} update={update} />;
            case 'httpEncode': return <HttpEncodeNodeEditor data={data} update={update} />;
            case 'httpRequest': return <HttpRequestNodeEditor data={data} update={update} />;
            case 'sendPhoto': return <SendPhotoNodeEditor data={data} update={update} />;
            case 'sendDocument': return <SendDocumentNodeEditor data={data} update={update} />;
            case 'notifyAdmin': return <NotifyAdminNodeEditor data={data} update={update} />;
            case 'tag': return <TagNodeEditor data={data} update={update} />;
            case 'abtest': return <ABTestNodeEditor data={data} update={update} />;
            case 'generateDocument': return <GenerateDocumentNodeEditor data={data} update={update} />;
            case 'fetchTelegramProfile': return <FetchTelegramProfileNodeEditor />;
            case 'knowledgeBase': return <KnowledgeBaseNodeEditor data={data} update={update} />;
            default: return <GenericJsonNodeEditor type={type} data={data} update={update} />;
        }
    };

    return (
        <div className={embedded
            ? 'h-full flex flex-col overflow-hidden'
            : 'w-80 shrink-0 bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden'}>
            {/* Header — only shown when not embedded (embedded panels have their own header in FunnelEditor) */}
            {!embedded && (
                <div className="px-4 py-3 border-b border-gray-800 flex items-start justify-between gap-3">
                    <div>
                        <div className="text-sm font-semibold text-white capitalize">{type} node</div>
                        <div className="text-xs text-gray-500 font-mono">{selectedNode.id}</div>
                    </div>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="h-8 w-8 rounded-lg border border-gray-800 bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                            title="Закрити панель"
                        >
                            ✕
                        </button>
                    )}
                </div>
            )}

            {/* Label + Description */}
            <div className="px-4 py-3 border-b border-gray-800 space-y-3">
                <div>
                    <label className="text-xs text-gray-400 block mb-1">Назва вузла</label>
                    <input
                        value={data.label || ''}
                        onChange={e => update({ label: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                    />
                </div>
                <div>
                    <label className="text-xs text-gray-400 block mb-1">Опис ноди <span className="text-gray-600">(підказка при наведенні)</span></label>
                    <textarea
                        value={data.description || ''}
                        onChange={e => update({ description: e.target.value })}
                        placeholder="Що робить ця нода в даній воронці..."
                        rows={2}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand resize-none"
                    />
                </div>
            </div>

            {/* Type-specific editor */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
                {renderEditor()}
            </div>

            {/* Наступний крок — окремо від типового редактора, завжди внизу */}
            <NextStepEditor nodeId={selectedNode.id} type={type} data={data} />

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
