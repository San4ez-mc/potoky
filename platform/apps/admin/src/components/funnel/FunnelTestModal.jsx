import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

// Try to build a template JSON from a bodySchema documentation string like:
// {"text": "string — опис", "subText": "string — (опційно)"}
function buildTemplateFromSchema(schema) {
    if (!schema) return '{\n  \n}';
    try {
        const parsed = JSON.parse(schema);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            const template = {};
            for (const [key, val] of Object.entries(parsed)) {
                const v = String(val).toLowerCase();
                if (v.startsWith('number') || v.startsWith('int')) template[key] = 0;
                else if (v.startsWith('bool')) template[key] = false;
                else if (v.startsWith('array') || v.startsWith('[')) template[key] = [];
                else if (v.startsWith('object') || v.startsWith('{')) template[key] = {};
                else template[key] = '';
            }
            return JSON.stringify(template, null, 2);
        }
    } catch {
        // schema might not be valid JSON — show empty object
    }
    return '{\n  \n}';
}

const STEP_TYPE_LABELS = {
    text: '💬 Текст',
    photo: '📷 Фото',
    forward_post: '📤 Пересланий пост',
    ad_reply: '📢 Перехід з реклами',
};

function emptyStep(type = 'text') {
    return { type, text: '', imageUrl: '', sharedPost: { kind: 'post', url: '', caption: '' }, referral: { adTitle: '', adId: '', source: '', type: 'ad' } };
}

function StepEditorRow({ step, index, total, onChange, onRemove, onMove }) {
    const set = (patch) => onChange(index, { ...step, ...patch });
    const setShared = (patch) => onChange(index, { ...step, sharedPost: { ...(step.sharedPost || {}), ...patch } });
    const setReferral = (patch) => onChange(index, { ...step, referral: { ...(step.referral || {}), ...patch } });

    return (
        <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/40 space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 font-mono w-5">#{index + 1}</span>
                <select
                    value={step.type}
                    onChange={e => set({ type: e.target.value })}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                >
                    {Object.entries(STEP_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <div className="ml-auto flex items-center gap-1">
                    <button type="button" disabled={index === 0} onClick={() => onMove(index, -1)} className="text-gray-500 hover:text-white disabled:opacity-30 text-xs px-1">▲</button>
                    <button type="button" disabled={index === total - 1} onClick={() => onMove(index, 1)} className="text-gray-500 hover:text-white disabled:opacity-30 text-xs px-1">▼</button>
                    <button type="button" onClick={() => onRemove(index)} className="text-red-500/70 hover:text-red-400 text-xs px-1">🗑</button>
                </div>
            </div>

            {(step.type === 'text' || step.type === 'photo' || step.type === 'ad_reply') && (
                <textarea
                    value={step.text || ''}
                    onChange={e => set({ text: e.target.value })}
                    placeholder="Текст повідомлення клієнта..."
                    rows={2}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600 resize-none"
                />
            )}

            {step.type === 'photo' && (
                <input
                    value={step.imageUrl || ''}
                    onChange={e => set({ imageUrl: e.target.value })}
                    placeholder="URL фото (напр. посилання на квитанцію/товар)"
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600"
                />
            )}

            {step.type === 'forward_post' && (
                <div className="grid grid-cols-2 gap-1.5">
                    <select
                        value={step.sharedPost?.kind || 'post'}
                        onChange={e => setShared({ kind: e.target.value })}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white col-span-2"
                    >
                        <option value="post">пост</option>
                        <option value="reel">reel</option>
                    </select>
                    <input
                        value={step.sharedPost?.url || ''}
                        onChange={e => setShared({ url: e.target.value })}
                        placeholder="URL картинки поста"
                        className="col-span-2 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600"
                    />
                    <input
                        value={step.sharedPost?.caption || ''}
                        onChange={e => setShared({ caption: e.target.value })}
                        placeholder="Підпис поста (опційно)"
                        className="col-span-2 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600"
                    />
                </div>
            )}

            {step.type === 'ad_reply' && (
                <div className="grid grid-cols-2 gap-1.5">
                    <input
                        value={step.referral?.adTitle || ''}
                        onChange={e => setReferral({ adTitle: e.target.value })}
                        placeholder="Назва реклами"
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600"
                    />
                    <input
                        value={step.referral?.adId || ''}
                        onChange={e => setReferral({ adId: e.target.value })}
                        placeholder="ad_id"
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600"
                    />
                </div>
            )}
        </div>
    );
}

function TestForm({ botId, initial, savedConnectors, onSave, onCancel, saving }) {
    const [name, setName] = useState(initial?.name || '');
    const [description, setDescription] = useState(initial?.description || '');
    const [expectedOutcome, setExpectedOutcome] = useState(initial?.expectedOutcome || '');
    const [connectorId, setConnectorId] = useState(initial?.connectorId || '');
    const [steps, setSteps] = useState(initial?.steps?.length ? initial.steps : [emptyStep()]);
    const [error, setError] = useState('');

    const updateStep = (i, next) => setSteps(prev => prev.map((s, idx) => idx === i ? next : s));
    const removeStep = (i) => setSteps(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
    const moveStep = (i, dir) => setSteps(prev => {
        const next = [...prev];
        const j = i + dir;
        if (j < 0 || j >= next.length) return prev;
        [next[i], next[j]] = [next[j], next[i]];
        return next;
    });

    const handleSave = () => {
        if (!name.trim()) { setError('Вкажіть назву тесту'); return; }
        if (!expectedOutcome.trim()) { setError('Опишіть очікуваний результат — саме по ньому визначається пройдений тест чи ні'); return; }
        setError('');
        onSave({ name: name.trim(), description, expectedOutcome: expectedOutcome.trim(), connectorId: connectorId || null, steps });
    };

    return (
        <div className="space-y-4">
            <div>
                <label className="text-xs text-gray-400 block mb-1">Назва тесту</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="напр. Клієнт пише з посилання на рекламу"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600" />
            </div>
            <div>
                <label className="text-xs text-gray-400 block mb-1">Опис <span className="text-gray-600">(нотатка для людей, необовʼязково)</span></label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Що і навіщо тут перевіряється..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600" />
            </div>
            <div>
                <label className="text-xs text-gray-400 block mb-1">
                    ✅ Очікуваний результат <span className="text-gray-600">(САМЕ по цьому визначається пройдений тест чи ні)</span>
                </label>
                <textarea value={expectedOutcome} onChange={e => setExpectedOutcome(e.target.value)}
                    placeholder="напр. Бот має правильно назвати ціну і наявність розмірів з каталогу, не вигадувати дані, і не питати те, що клієнт уже написав."
                    rows={3}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 resize-y" />
            </div>
            <div>
                <label className="text-xs text-gray-400 block mb-1">Конектор-суддя <span className="text-gray-600">(AI, що вирішує passed/failed — рекомендовано Sonnet/Opus)</span></label>
                <select value={connectorId} onChange={e => setConnectorId(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">— системний Claude ключ (за замовчуванням) —</option>
                    {savedConnectors.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                </select>
            </div>

            <div>
                <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-gray-400">
                        Кроки клієнта <span className="text-gray-600">(відтворюються через той самий движок, що й живий користувач)</span>
                    </label>
                </div>
                <div className="space-y-2">
                    {steps.map((s, i) => (
                        <StepEditorRow key={i} step={s} index={i} total={steps.length}
                            onChange={updateStep} onRemove={removeStep} onMove={moveStep} />
                    ))}
                </div>
                <div className="flex gap-1.5 mt-2">
                    {Object.entries(STEP_TYPE_LABELS).map(([v, l]) => (
                        <button key={v} type="button" onClick={() => setSteps(prev => [...prev, emptyStep(v)])}
                            className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">+ {l}</button>
                    ))}
                </div>
            </div>

            {error && <div className="text-xs text-red-400">{error}</div>}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
                <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">Скасувати</button>
                <button onClick={handleSave} disabled={saving}
                    className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-sm disabled:opacity-50">
                    {saving ? 'Збереження...' : 'Зберегти тест'}
                </button>
            </div>
        </div>
    );
}

function TestRow({ test, onRun, onEdit, onDuplicate, onDelete, running, disabled }) {
    const status = test.lastRunStatus;
    const badge = status === 'passed' ? { cls: 'bg-emerald-900/40 text-emerald-300', label: '✓ пройдено' }
        : status === 'failed' ? { cls: 'bg-red-900/40 text-red-300', label: '✕ провалено' }
        : status === 'error' ? { cls: 'bg-amber-900/40 text-amber-300', label: '⚠ помилка' }
        : { cls: 'bg-gray-800 text-gray-500', label: 'не запускався' };

    return (
        <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/40 flex items-start gap-3">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white font-medium">{test.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                </div>
                {test.description && <div className="text-xs text-gray-500 mt-0.5">{test.description}</div>}
                <div className="text-xs text-gray-400 mt-1 line-clamp-2">✅ {test.expectedOutcome}</div>
                <div className="text-[10px] text-gray-600 mt-1">{Array.isArray(test.steps) ? test.steps.length : 0} крок(и){test.lastRunAt ? ` · останній прогін ${new Date(test.lastRunAt).toLocaleString('uk-UA')}` : ''}</div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => onRun(test)} disabled={running || disabled}
                    className="text-[11px] px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-800 disabled:opacity-50">
                    {running ? '...' : '▶ Запустити'}
                </button>
                <button onClick={() => onEdit(test)} className="text-[11px] px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">✎ Редагувати</button>
                <button onClick={() => onDuplicate(test)} className="text-[11px] px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">⧉ Копіювати</button>
                <button onClick={() => onDelete(test)} className="text-[11px] px-2.5 py-1 rounded bg-red-950/30 hover:bg-red-900/30 text-red-400">🗑 Видалити</button>
            </div>
        </div>
    );
}

function RunResultView({ result, onOpenSession, onBack }) {
    if (!result) return null;
    const passed = result.status === 'passed';
    const isError = result.status === 'error';
    return (
        <div className="space-y-3">
            <div className={`rounded-lg border p-4 ${passed ? 'border-emerald-900/40 bg-emerald-900/10' : isError ? 'border-amber-900/40 bg-amber-900/10' : 'border-red-900/40 bg-red-900/10'}`}>
                <div className={`font-medium mb-1 ${passed ? 'text-emerald-300' : isError ? 'text-amber-300' : 'text-red-300'}`}>
                    {passed ? '✓ Тест пройдено' : isError ? '⚠ Помилка виконання тесту' : '✕ Тест провалено'}
                </div>
                <div className="text-sm text-gray-200">{result.verdict?.reasoning}</div>
                {Array.isArray(result.verdict?.nodeVerdicts) && result.verdict.nodeVerdicts.some(v => v.passed === false) && (
                    <div className="mt-2 space-y-1">
                        {result.verdict.nodeVerdicts.filter(v => v.passed === false).map((v, i) => (
                            <div key={i} className="text-xs text-red-300 bg-gray-900/50 rounded px-2 py-1.5 border border-red-900/20">
                                <span className="font-mono">{v.nodeId}</span>: {v.reasoning}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {Array.isArray(result.transcript) && result.transcript.length > 0 && (
                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
                    <div className="text-xs font-semibold text-gray-300 mb-2">Транскрипція діалогу</div>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {result.transcript.map((m, i) => (
                            <div key={i} className={`text-xs rounded px-2 py-1.5 ${m.role === 'user' ? 'bg-gray-800 text-gray-200' : 'bg-brand/10 text-brand-light'}`}>
                                <span className="text-[10px] opacity-60">{m.role === 'user' ? 'клієнт' : 'бот'}:</span> {m.content}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex justify-end gap-2">
                {result.sessionId && (
                    <button onClick={() => onOpenSession(result.sessionId)} className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white text-sm">
                        Переглянути сесію →
                    </button>
                )}
                <button onClick={onBack} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">← До списку тестів</button>
            </div>
        </div>
    );
}

function RunAllResultView({ result, onBack }) {
    if (!result) return null;
    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 text-sm text-gray-200">
                Усього: {result.total} · <span className="text-emerald-400">пройдено {result.passed}</span> · <span className="text-red-400">провалено {result.failed}</span>{result.errored ? <> · <span className="text-amber-400">помилки {result.errored}</span></> : null}
            </div>
            <div className="space-y-1.5">
                {result.results.map((r) => (
                    <div key={r.testId} className={`text-xs rounded px-3 py-2 border ${r.status === 'passed' ? 'border-emerald-900/40 bg-emerald-900/10 text-emerald-300' : r.status === 'error' ? 'border-amber-900/40 bg-amber-900/10 text-amber-300' : 'border-red-900/40 bg-red-900/10 text-red-300'}`}>
                        <div className="font-medium">{r.status === 'passed' ? '✓' : r.status === 'error' ? '⚠' : '✕'} {r.testId}</div>
                        {r.verdict?.reasoning && <div className="opacity-80 mt-0.5">{r.verdict.reasoning}</div>}
                    </div>
                ))}
            </div>
            <div className="flex justify-end">
                <button onClick={onBack} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">← До списку тестів</button>
            </div>
        </div>
    );
}

export function FunnelTestModal({
    isOpen,
    onClose,
    botId,
    onOpenSession,
    isWebhookMode = false,
    bodySchema = '',
    onRunWebhookTest,
    initialTestId = null,
    missingKeys = [],
    missingSystemKeys = [],
}) {
    const blockedByKeys = missingKeys.length > 0 || missingSystemKeys.length > 0;
    const [webhookBody, setWebhookBody] = useState('');
    const [jsonError, setJsonError] = useState('');
    const [webhookResult, setWebhookResult] = useState(null);
    const [webhookLoading, setWebhookLoading] = useState(false);

    const [view, setView] = useState('list'); // 'list' | 'form' | 'result' | 'run-all-result'
    const [tests, setTests] = useState([]);
    const [testsLoading, setTestsLoading] = useState(false);
    const [savedConnectors, setSavedConnectors] = useState([]);
    const [editingTest, setEditingTest] = useState(null); // test being edited, or null = new
    const [saving, setSaving] = useState(false);
    const [runningId, setRunningId] = useState(null); // testId or 'ALL'
    const [runResult, setRunResult] = useState(null);
    const [runAllResult, setRunAllResult] = useState(null);
    const [loadError, setLoadError] = useState('');

    const loadTests = async () => {
        if (!botId) return;
        setTestsLoading(true);
        try {
            const data = await api.listFunnelTests(botId);
            setTests(data || []);
        } catch (e) {
            setLoadError(e.message);
        } finally {
            setTestsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen && isWebhookMode) {
            setWebhookBody(buildTemplateFromSchema(bodySchema));
            setJsonError('');
            setWebhookResult(null);
        }
    }, [isOpen, isWebhookMode, bodySchema]);

    useEffect(() => {
        if (!isOpen || isWebhookMode) return;
        setView('list');
        setRunResult(null);
        setRunAllResult(null);
        setLoadError('');
        loadTests();
        api.getSavedConnectors()
            .then(res => setSavedConnectors((res || []).filter(s => s.type?.startsWith('claude'))))
            .catch(() => setSavedConnectors([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, isWebhookMode, botId]);

    // Deep-link from SessionDetail's "Створити тест з цієї сесії" — open the new test straight in edit view.
    useEffect(() => {
        if (!isOpen || isWebhookMode || !initialTestId || testsLoading) return;
        const t = tests.find(x => x.id === initialTestId);
        if (t) { setEditingTest(t); setView('form'); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, isWebhookMode, initialTestId, tests, testsLoading]);

    if (!isOpen) return null;

    const handleRunWebhook = async () => {
        setJsonError('');
        let parsed;
        try {
            parsed = JSON.parse(webhookBody);
        } catch (e) {
            setJsonError('Невалідний JSON: ' + e.message);
            return;
        }
        setWebhookLoading(true);
        try {
            const result = await onRunWebhookTest(parsed);
            setWebhookResult(result || { ok: true });
        } catch (e) {
            setWebhookResult({ ok: false, errors: [{ step: 'Webhook POST', message: e.message }] });
        } finally {
            setWebhookLoading(false);
        }
    };

    const handleSaveTest = async (data) => {
        setSaving(true);
        try {
            if (editingTest?.id) {
                await api.updateFunnelTest(editingTest.id, data);
            } else {
                await api.createFunnelTest(botId, data);
            }
            await loadTests();
            setView('list');
            setEditingTest(null);
        } catch (e) {
            setLoadError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleRunOne = async (test) => {
        setRunningId(test.id);
        try {
            const result = await api.runFunnelTest(test.id);
            setRunResult(result);
            setView('result');
            await loadTests();
        } catch (e) {
            setRunResult({ status: 'error', verdict: { reasoning: e.message }, transcript: [] });
            setView('result');
        } finally {
            setRunningId(null);
        }
    };

    const handleRunAll = async () => {
        setRunningId('ALL');
        try {
            const result = await api.runAllFunnelTests(botId);
            setRunAllResult(result);
            setView('run-all-result');
            await loadTests();
        } catch (e) {
            setLoadError(e.message);
        } finally {
            setRunningId(null);
        }
    };

    const handleDelete = async (test) => {
        if (!window.confirm(`Видалити тест «${test.name}»?`)) return;
        try {
            await api.deleteFunnelTest(test.id);
            await loadTests();
        } catch (e) {
            setLoadError(e.message);
        }
    };

    const handleDuplicate = async (test) => {
        try {
            await api.duplicateFunnelTest(test.id);
            await loadTests();
        } catch (e) {
            setLoadError(e.message);
        }
    };

    const title = isWebhookMode ? '🔗 Тест Webhook-воронки'
        : view === 'form' ? (editingTest ? '✎ Редагувати тест' : '+ Новий тест')
        : view === 'result' ? 'Результат тесту'
        : view === 'run-all-result' ? 'Результати всіх тестів'
        : '🧪 Тести воронки';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl shadow-black/40 max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4 shrink-0">
                    <h2 className="text-base font-semibold text-white">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                    {isWebhookMode ? (
                        <>
                            {!webhookResult && !webhookLoading && (
                                <>
                                    <div className="text-xs text-gray-400 leading-relaxed">
                                        Ця воронка запускається через{' '}
                                        <span className="font-mono text-brand-light">POST /webhook/bot/…</span>.
                                        Заповни JSON-тіло запиту і натисни «Запустити» — система створить тестову сесію з цим контекстом.
                                    </div>
                                    {bodySchema && (
                                        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
                                            <div className="text-[11px] font-semibold text-gray-500 mb-1.5">Схема тіла (документація)</div>
                                            <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap break-words">{bodySchema}</pre>
                                        </div>
                                    )}
                                    <div>
                                        <label className="text-xs text-gray-400 block mb-1.5">JSON-тіло запиту</label>
                                        <textarea
                                            value={webhookBody}
                                            onChange={e => { setWebhookBody(e.target.value); setJsonError(''); }}
                                            rows={10}
                                            spellCheck={false}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-brand resize-none"
                                        />
                                        {jsonError && <div className="text-xs text-red-400 mt-1">{jsonError}</div>}
                                    </div>
                                </>
                            )}
                            {webhookLoading && (
                                <div className="flex items-center justify-center py-12">
                                    <div className="text-center">
                                        <div className="w-8 h-8 border-4 border-gray-800 border-t-brand rounded-full animate-spin mx-auto mb-3" />
                                        <div className="text-sm text-gray-400">Запуск воронки через webhook...</div>
                                    </div>
                                </div>
                            )}
                            {webhookResult && !webhookLoading && (
                                <div className={`rounded-lg border p-4 ${webhookResult.ok ? 'border-emerald-900/40 bg-emerald-900/10' : 'border-red-900/40 bg-red-900/10'}`}>
                                    <div className={`font-medium mb-2 ${webhookResult.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                                        {webhookResult.ok ? 'Сесію створено і воронку запущено!' : 'Помилка'}
                                    </div>
                                    {webhookResult.sessionId && <div className="font-mono text-xs text-gray-400">session: {webhookResult.sessionId}</div>}
                                    {webhookResult.errors?.map((e, i) => <div key={i} className="text-xs text-red-300">{e.message}</div>)}
                                </div>
                            )}
                        </>
                    ) : view === 'form' ? (
                        <TestForm
                            botId={botId}
                            initial={editingTest}
                            savedConnectors={savedConnectors}
                            saving={saving}
                            onSave={handleSaveTest}
                            onCancel={() => { setView('list'); setEditingTest(null); }}
                        />
                    ) : view === 'result' ? (
                        <RunResultView result={runResult} onOpenSession={onOpenSession} onBack={() => { setView('list'); setRunResult(null); }} />
                    ) : view === 'run-all-result' ? (
                        <RunAllResultView result={runAllResult} onBack={() => { setView('list'); setRunAllResult(null); }} />
                    ) : (
                        <>
                            {loadError && <div className="text-xs text-red-400">{loadError}</div>}
                            {blockedByKeys && (
                                <div className="rounded-lg border border-red-900/40 bg-red-900/10 p-3 text-xs text-red-200">
                                    Перед запуском тестів заповніть {missingSystemKeys.length > 0 ? 'системний Claude API key (Налаштування → Ключі) та ' : ''}обов'язкові ключі воронки.
                                    {missingKeys.length > 0 && <div className="font-mono mt-1">{missingKeys.join(', ')}</div>}
                                </div>
                            )}
                            <div className="flex items-center justify-between">
                                <button onClick={() => { setEditingTest(null); setView('form'); }}
                                    className="px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-xs font-medium">
                                    + Новий тест
                                </button>
                                <button onClick={handleRunAll} disabled={!tests.length || Boolean(runningId) || blockedByKeys}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-800 text-xs font-medium disabled:opacity-50">
                                    {runningId === 'ALL' ? 'Запуск усіх...' : '▶▶ Запустити всі тести'}
                                </button>
                            </div>

                            {testsLoading && <div className="text-sm text-gray-500 text-center py-6">Завантаження тестів...</div>}
                            {!testsLoading && tests.length === 0 && (
                                <div className="text-sm text-gray-500 text-center py-6">
                                    Тестів ще немає. Створіть перший — або позначте помилкове повідомлення в сесії й натисніть «Створити тест з цієї сесії».
                                </div>
                            )}
                            <div className="space-y-2">
                                {tests.map(t => (
                                    <TestRow key={t.id} test={t} running={runningId === t.id} disabled={blockedByKeys}
                                        onRun={handleRunOne}
                                        onEdit={(test) => { setEditingTest(test); setView('form'); }}
                                        onDuplicate={handleDuplicate}
                                        onDelete={handleDelete}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <div className="border-t border-gray-800 px-5 py-3 flex justify-end gap-2 shrink-0">
                    {isWebhookMode && !webhookResult && !webhookLoading && (
                        <button onClick={handleRunWebhook}
                            className="px-4 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-800 transition-colors font-medium">
                            ▶ Запустити POST
                        </button>
                    )}
                    <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors">
                        Закрити
                    </button>
                </div>
            </div>
        </div>
    );
}
