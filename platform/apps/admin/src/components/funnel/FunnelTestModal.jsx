import React from 'react';

export function FunnelTestModal({ isOpen, onClose, isLoading, result, onOpenSession }) {
    if (!isOpen) return null;

    const hasErrors = result?.errors && result.errors.length > 0;
    const hasMissingKeys = result?.missingKeys && result.missingKeys.length > 0;
    const hasMissingSystemKeys = result?.missingSystemKeys && result.missingSystemKeys.length > 0;
    const canOpenSession = !isLoading && Boolean(result?.sessionId);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl shadow-black/40 max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4 shrink-0">
                    <div className="flex items-center gap-3">
                        <h2 className="text-base font-semibold text-white">Результати тесту</h2>
                        {isLoading && (
                            <div className="inline-flex items-center gap-1.5">
                                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                                <span className="text-xs text-yellow-300">Тестування...</span>
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
                    {isLoading && (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                                <div className="w-8 h-8 border-4 border-gray-800 border-t-brand rounded-full animate-spin mx-auto mb-3" />
                                <div className="text-sm text-gray-400">Запуск тесту воронки...</div>
                            </div>
                        </div>
                    )}

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
                                            <div className="font-medium text-emerald-300 mb-2">Тест пройдений успішно!</div>
                                            <div className="space-y-1 text-sm text-emerald-200">
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
                        </>
                    )}
                </div>

                <div className="border-t border-gray-800 px-5 py-3 flex justify-end gap-2 shrink-0">
                    {canOpenSession && (
                        <button
                            onClick={onOpenSession}
                            className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-dark text-white transition-colors"
                        >
                            Переглянути сесію
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
