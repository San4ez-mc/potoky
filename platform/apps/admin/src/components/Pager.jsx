import React from 'react';

// Компактний пейджер зі сторінками (замість "Далі"/"Назад" за евристикою на довжину сторінки) —
// використовує meta.total/meta.limit, які бекенд і так завжди повертає.
function buildPageWindow(current, totalPages) {
    // сторінки навколо поточної (±2) + перша/остання, з '…' між розривами
    const pages = new Set([0, totalPages - 1, current - 2, current - 1, current, current + 1, current + 2]);
    const sorted = [...pages].filter(p => p >= 0 && p < totalPages).sort((a, b) => a - b);
    const result = [];
    let prev = null;
    for (const p of sorted) {
        if (prev !== null && p - prev > 1) result.push('…');
        result.push(p);
        prev = p;
    }
    return result;
}

export function Pager({ page, meta, loading, onPageChange }) {
    const limit = meta.limit || 50;
    const total = meta.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    if (total === 0) return null;

    const goTo = (p) => {
        if (p < 0 || p >= totalPages || p === page || loading) return;
        onPageChange(p);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <div className="text-xs text-gray-500">
                Сторінка {page + 1} з {totalPages} · показано {Math.min(limit, total - page * limit)} з {total}
            </div>
            <div className="flex items-center gap-1">
                <button
                    onClick={() => goTo(page - 1)}
                    disabled={page === 0 || loading}
                    className="px-3 py-1.5 bg-gray-800 rounded-lg text-gray-300 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-700"
                >
                    ← Назад
                </button>
                {buildPageWindow(page, totalPages).map((p, i) =>
                    p === '…' ? (
                        <span key={`ellipsis-${i}`} className="px-2 text-gray-600 text-sm select-none">…</span>
                    ) : (
                        <button
                            key={p}
                            onClick={() => goTo(p)}
                            disabled={loading}
                            className={`min-w-[32px] px-2 py-1.5 rounded-lg text-sm transition-colors ${
                                p === page ? 'bg-brand/20 text-brand-light font-medium' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                            }`}
                        >
                            {p + 1}
                        </button>
                    )
                )}
                <button
                    onClick={() => goTo(page + 1)}
                    disabled={page >= totalPages - 1 || loading}
                    className="px-3 py-1.5 bg-gray-800 rounded-lg text-gray-300 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-700"
                >
                    Далі →
                </button>
            </div>
        </div>
    );
}
