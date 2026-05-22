import React, { useEffect, useState } from 'react';

// Try to build a template JSON from a bodySchema documentation string like:
// {"text": "string — опис", "subText": "string — (опційно)"}
function buildTemplateFromSchema(schema) {
    if (!schema) return '{\n  \n}';
    try {
        const parsed = JSON.parse(schema);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            const template = {};
            for (const [key, val] of Object.entries(parsed)) {
                // Extract a sensible default: if value starts with "string" → ""
                // if "number" → 0, etc.
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

export function FunnelTestModal({
    isOpen,
    onClose,
    isLoading,
    result,
    onOpenSession,
    isWebhookMode = false,
    bodySchema = '',
    onRunWebhookTest,
}) {
    const [webhookBody, setWebhookBody] = useState('');
    const [jsonError, setJsonError] = useState('');

    useEffect(() => {
        if (isOpen && isWebhookMode) {
            setWebhookBody(buildTemplateFromSchema(bodySchema));
            setJsonError('');
        }
    }, [isOpen, isWebhookMode, bodySchema]);

    if (!isOpen) return null;

    const hasErrors = result?.errors && result.errors.length > 0;
    const hasMissingKeys = result?.missingKeys && result.missingKeys.length > 0;
    const hasMissingSystemKeys = result?.missingSystemKeys && result.missingSystemKeys.length > 0;
    const canOpenSession = !isLoading && Boolean(result?.sessionId);

    const handleRunWebhook = async () => {
        setJsonError('');
        let parsed;
        try {
            parsed = JSON.parse(webhookBody);
        } catch (e) {
            setJsonError('Невалідний JSON: ' + e.message);
            return;
        }
        if (onRunWebhookTest) await onRunWebhookTest(parsed);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl shadow-black/40 max-h-[85vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4 shrink-0">
                    <div className="flex items-center gap-3">
                        <h2 className="text-base font-semibold text-white">
                            {isWebhookMode ? '🔗 Тест Webhook-воронки' : 'Результати тесту'}
                        </h2>
                        {isLoading && (
                            <div className="inline-flex items-center gap-1.5">
                                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                                <span className="text-xs text-yellow-300">
                                    {isWebhookMode ? 'Запуск...' : 'Тестування...'}
                                </span>
                            </div>
                        )}
                        {!isLoading && result?.ok && (
                            <div className="inline-flex items-center gap-1.5">
                                <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                                <span className="text-xs text-emerald-300">Успішно</span>
                            </div>
                        )}
                        {!isLoading && result && !result.ok && (
                            <div className="inline-flex items-center gap-1.5">
                                <div className="w-2 h-2 bg-red-400 rounded-full" />
                                <span className="text-xs text-red-300">Помилка</span>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
                    >
                        ✕
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                    {/* ── WEBHOOK MODE ── */}
                    {isWebhookMode && !result && (
                        <>
                            <div className="text-xs text-gray-400 leading-relaxed">
                                Ця воронка запускається через{' '}
                                <span className="font-mono text-brand-light">POST /webhook/bot/…</span>.
                                Заповни JSON-тіло запиту і натисни «Запустити» — система створить тестову сесію з цим контекстом.
                            </div>

                            {bodySchema && (
                                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
                                    <div className="text-[11px] font-semibold text-gray-500 mb-1.5">Схема тіла (документація)</div>
                                    <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap break-words">
                                        {bodySchema}
                                    </pre>
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
                                    placeholder='{\n  "key": "value"\n}'
                                />
                                {jsonError && (
                                    <div className="text-xs text-red-400 mt-1">{jsonError}</div>
                                )}
                            </div>
                        </>
                    )}

                    {/* ── WEBHOOK MODE: loading ── */}
                    {isWebhookMode && isLoading && (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                                <div className="w-8 h-8 border-4 border-gray-800 border-t-brand rounded-full animate-spin mx-auto mb-3" />
                                <div className="text-sm text-gray-400">Запуск воронки через webhook...</div>
                            </div>
                        </div>
                    )}

                    {/* ── REGRESSION MODE: loading ── */}
                    {!isWebhookMode && isLoading && (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                                <div className="w-8 h-8 border-4 border-gray-800 border-t-brand rounded-full animate-spin mx-auto mb-3" />
                                <div className="text-sm text-gray-400">Запуск тесту воронки...</div>
                            </div>
                        </div>
                    )}

                    {/* ── RESULTS (both modes) ── */}
                    {!isLoading && result && (
                        <>
                            {hasMissingKeys && (
                                <div className="rounded-lg border border-red-900/40 bg-red-900/10 p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="text-red-400 text-lg leading-none mt-0.5">⚠</div>
                                        <div className="flex-1">
                                            <div className="font-medium text-red-300 mb-1">Бракує обов'язкових ключів</div>
                                            <div className="text-sm text-red-200 space-y-1">
                                                {result.missingKeys.map((key) => (
                                                    <div key={key} className="font-mono text-xs">• {key}</div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {hasMissingSystemKeys && (
                                <div className="rounded-lg border border-amber-900/40 bg-amber-900/10 p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="text-amber-400 text-lg leading-none mt-0.5">⚠</div>
                                        <div className="flex-1">
                                            <div className="font-medium text-amber-300 mb-1">Бракує системних ключів</div>
                                            <div className="text-sm text-amber-200 space-y-1 mb-2">
                                                {result.missingSystemKeys.map((key) => (
                                                    <div key={key} className="font-mono text-xs">• {key}</div>
                                                ))}
                                            </div>
                                            <div className="text-xs text-amber-200/90">Додайте їх у Налаштування → Ключі.</div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {hasErrors && (
                                <div className="rounded-lg border border-red-900/40 bg-red-900/10 p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="text-red-400 text-lg leading-none mt-0.5">✕</div>
                                        <div className="flex-1">
                                            <div className="font-medium text-red-300 mb-2">Помилки під час тесту</div>
                                            <div className="space-y-2">
                                                {result.errors.map((err, i) => (
                                                    <div key={i} className="text-sm text-red-200 bg-gray-900/50 rounded px-3 py-2 border border-red-900/20">
                                                        <div className="font-mono text-xs text-red-300">{err.step || 'Невідомий крок'}</div>
                                                        <div className="text-xs mt-1">{err.message}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {result.ok && (
                                <div className="rounded-lg border border-emerald-900/40 bg-emerald-900/10 p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="text-emerald-400 text-lg leading-none mt-0.5">✓</div>
                                        <div className="flex-1">
                                            <div className="font-medium text-emerald-300 mb-2">
                                                {isWebhookMode ? 'Сесію створено і воронку запущено!' : 'Тест пройдений успішно!'}
                                            </div>
                                            <div className="space-y-1 text-sm text-emerald-200">
                                                {result.sessionId && (
                                                    <div className="font-mono text-xs text-emerald-300/70">session: {result.sessionId}</div>
                                                )}
                                                {result.currentState && (
                                                    <div>Стан: <span className="font-mono">{result.currentState}</span></div>
                                                )}
                                                {result.finalState && (
                                                    <div>Кінцевий стан: <span className="font-mono">{result.finalState}</span></div>
                                                )}
                                                {result.historyCount && (
                                                    <div>Кроків у сесії: <span className="font-mono">{result.historyCount}</span></div>
                                                )}
                                                {result.outputFile && (
                                                    <div>Вихідний файл: <span className="font-mono text-xs">{result.outputFile}</span></div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {result.logs && (
                                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                                    <div className="text-xs font-semibold text-gray-300 mb-2">Логи тесту</div>
                                    <div className="max-h-48 overflow-y-auto">
                                        <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap break-words">
                                            {typeof result.logs === 'string'
                                                ? result.logs
                                                : JSON.stringify(result.logs, null, 2)}
                                        </pre>
                                    </div>
                                </div>
                            )}

                            {/* After webhook test: option to run again */}
                            {isWebhookMode && result.ok && (
                                <div className="text-xs text-gray-500 text-center">
                                    Щоб запустити знову — закрий і відкрий тест ще раз.
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-800 px-5 py-3 flex justify-end gap-2 shrink-0">
                    {/* Webhook mode: "Запустити" button when no result yet */}
                    {isWebhookMode && !result && !isLoading && (
                        <button
                            onClick={handleRunWebhook}
                            className="px-4 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-800 transition-colors font-medium"
                        >
                            ▶ Запустити POST
                        </button>
                    )}

                    {canOpenSession && (
                        <button
                            onClick={onOpenSession}
                            className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white transition-colors"
                        >
                            Переглянути сесію →
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors disabled:opacity-50"
                    >
                        Закрити
                    </button>
                </div>
            </div>
        </div>
    );
}
