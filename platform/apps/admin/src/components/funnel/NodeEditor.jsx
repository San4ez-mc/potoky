import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useFunnelStore } from '../../stores/funnelStore.js';
import { api } from '../../api/client.js';

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
    generateDocument: [],
    httpEncode: [],
    httpRequest: [],
    sendPhoto: [],
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
    const mode = data.mode || 'single';
    const exitCondition = data.exitCondition || 'json_output';
    const isKeywordExit = exitCondition.startsWith('keyword:');
    const keywordValue = isKeywordExit ? exitCondition.slice('keyword:'.length).trim() : '';
    const exitConditionType = isKeywordExit ? 'keyword' : exitCondition;

    const handleModeChange = (value) => {
        if (value === 'dialog') {
            update({ mode: value, exitCondition: data.exitCondition || 'json_output' });
            return;
        }
        update({ mode: value });
    };

    const handleExitConditionChange = (value) => {
        if (value === 'keyword') {
            const nextKeyword = keywordValue || 'DONE';
            update({ exitCondition: `keyword:${nextKeyword}` });
            return;
        }
        update({ exitCondition: value });
    };

    const handleKeywordChange = (value) => {
        update({ exitCondition: `keyword:${value}` });
    };

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
            <Field label="Тип запиту до ШІ">
                <select
                    value={mode}
                    onChange={e => handleModeChange(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="single">Одиночний запит</option>
                    <option value="dialog">Діалог</option>
                </select>
                <div className="mt-1 text-[11px] text-gray-500">
                    Одиночний: один виклик і перехід далі. Діалог: бот спілкується поки не виконається умова завершення.
                </div>
            </Field>
            <Field label="System Prompt">
                <CodeBlock value={data.systemPrompt} onChange={v => update({ systemPrompt: v })} language="markdown" />
            </Field>
            <Field label="Messages Template (JSON)">
                <CodeBlock value={data.messagesTemplate} onChange={v => update({ messagesTemplate: v })} language="json" />
            </Field>
            {mode === 'dialog' && (
                <Field label="Умова завершення діалогу">
                    <select
                        value={exitConditionType}
                        onChange={e => handleExitConditionChange(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                    >
                        <option value="json_output">JSON у відповіді</option>
                        <option value="markdown_output">Markdown у відповіді</option>
                        <option value="user_confirms">Підтвердження користувача</option>
                        <option value="keyword">Ключове слово</option>
                    </select>
                    <div className="mt-1 text-[11px] text-gray-500">
                        Коли умова спрацює, бот збереже результат у змінну та перейде до наступної ноди.
                    </div>
                    {exitConditionType === 'keyword' && (
                        <div className="mt-2">
                            <TextInput
                                value={keywordValue}
                                onChange={handleKeywordChange}
                                placeholder="Наприклад: DONE"
                            />
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
                    <Field label="Сума (amount)" hint="Число або змінна: {{context.price}}">
                        <input
                            value={data.amount || ''}
                            onChange={e => update({ amount: e.target.value })}
                            placeholder="{{context.course_price}}"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        />
                    </Field>
                    <Field label="Назва продукту" hint="Відображається покупцю">
                        <input
                            value={data.productName || ''}
                            onChange={e => update({ productName: e.target.value })}
                            placeholder="Курс «Гроші в бізнесі»"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        />
                    </Field>
                    <Field label="Output var" hint="Куди зберегти URL оплати">
                        <input
                            value={data.outputVar || ''}
                            onChange={e => update({ outputVar: e.target.value })}
                            placeholder="context.invoice_url"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        />
                    </Field>
                </>
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

function HttpRequestNodeEditor({ data, update }) {
    return (
        <div className="space-y-3">
            <Field label="Назва ноди">
                <TextInput value={data.label} onChange={v => update({ label: v })} placeholder="HTTP запит" />
            </Field>
            <Field label="URL (з шаблонізацією)">
                <TextInput value={data.url} onChange={v => update({ url: v })} placeholder="https://mermaid.ink/img/[base64_code]" multiline />
            </Field>
            <Field label="HTTP метод">
                <select
                    value={data.method || 'GET'}
                    onChange={e => update({ method: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                </select>
            </Field>
            <Field label="Вивести відповідь в змінну (outputVar)">
                <TextInput value={data.outputVar} onChange={v => update({ outputVar: v })} placeholder="context.pngData" />
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
    return (
        <div className="space-y-3">
            <Field label="URL">
                <TextInput value={data.url} onChange={v => update({ url: v })} placeholder="https://script.google.com/..." />
            </Field>
            <Field label="Метод">
                <select
                    value={data.method || 'POST'}
                    onChange={e => update({ method: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                </select>
            </Field>
            <Field label="Body Template (JSON)">
                <CodeBlock
                    value={data.bodyTemplate ? JSON.stringify(data.bodyTemplate, null, 2) : '{}'}
                    onChange={v => {
                        try { update({ bodyTemplate: JSON.parse(v) }); } catch { }
                    }}
                    language="json"
                />
            </Field>
            <Field label="Зберегти відповідь у">
                <TextInput value={data.outputVar} onChange={v => update({ outputVar: v })} placeholder="context.sheetsUrl" />
            </Field>
            <Field label="Шлях в response (JSON path)">
                <TextInput value={data.responsePath} onChange={v => update({ responsePath: v })} placeholder="spreadsheetUrl" />
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
            case 'js': return <JsNodeEditor data={data} update={update} />;
            case 'condition': return <ConditionNodeEditor data={data} update={update} />;
            case 'connector': return <ConnectorNodeEditor data={data} update={update} connectors={connectors} />;
            case 'saveFile': return <SaveFileNodeEditor data={data} update={update} />;
            case 'wait': return <WaitNodeEditor data={data} update={update} />;
            case 'loadFile': return <LoadFileNodeEditor data={data} update={update} />;
            case 'httpEncode': return <HttpEncodeNodeEditor data={data} update={update} />;
            case 'httpRequest': return <HttpRequestNodeEditor data={data} update={update} />;
            case 'sendPhoto': return <SendPhotoNodeEditor data={data} update={update} />;
            case 'tag': return <TagNodeEditor data={data} update={update} />;
            case 'abtest': return <ABTestNodeEditor data={data} update={update} />;
            case 'generateDocument': return <GenerateDocumentNodeEditor data={data} update={update} />;
            default: return <div className="text-gray-500 text-sm">Немає налаштувань для цього вузла</div>;
        }
    };

    return (
        <div className={embedded
            ? 'h-full flex flex-col overflow-hidden'
            : 'w-80 shrink-0 bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden'}>
            {/* Header */}
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
