import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client.js';

// ── Status badge ─────────────────────────────────────────────
function StatusBadge({ status }) {
    const map = {
        draft:     'bg-gray-700 text-gray-300',
        scheduled: 'bg-yellow-900/60 text-yellow-300',
        sending:   'bg-blue-900/60 text-blue-300',
        sent:      'bg-green-900/60 text-green-300',
        failed:    'bg-red-900/60 text-red-300',
        cancelled: 'bg-gray-800 text-gray-500',
    };
    const labels = {
        draft: 'Чернетка', scheduled: 'Заплановано', sending: 'Надсилання',
        sent: 'Надіслано', failed: 'Помилка', cancelled: 'Скасовано',
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || map.draft}`}>
            {labels[status] || status}
        </span>
    );
}

// ── Step indicator ───────────────────────────────────────────
function StepIndicator({ current, steps }) {
    return (
        <div className="flex items-center gap-0 mb-8">
            {steps.map((label, i) => {
                const idx = i + 1;
                const done = idx < current;
                const active = idx === current;
                return (
                    <React.Fragment key={idx}>
                        <div className="flex flex-col items-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
                                done    ? 'bg-brand border-brand text-white' :
                                active  ? 'bg-brand/20 border-brand text-brand-light' :
                                          'bg-gray-800 border-gray-700 text-gray-500'
                            }`}>
                                {done ? '✓' : idx}
                            </div>
                            <div className={`mt-1 text-xs whitespace-nowrap ${active ? 'text-white' : done ? 'text-gray-400' : 'text-gray-600'}`}>
                                {label}
                            </div>
                        </div>
                        {i < steps.length - 1 && (
                            <div className={`flex-1 h-0.5 mx-2 mt-[-14px] ${done ? 'bg-brand' : 'bg-gray-800'}`} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

// ── Message preview (Telegram-like) ─────────────────────────
function MessagePreview({ message }) {
    if (!message.text && !message.photoUrl && !message.documentUrl) {
        return (
            <div className="border border-dashed border-gray-700 rounded-lg p-4 text-center text-gray-500 text-sm">
                Повідомлення порожнє
            </div>
        );
    }
    return (
        <div className="bg-gray-800 rounded-lg p-3 max-w-sm border border-gray-700">
            <div className="text-xs text-gray-500 mb-2">Попередній перегляд</div>
            {message.photoUrl && (
                <div className="mb-2 rounded overflow-hidden bg-gray-700 h-32 flex items-center justify-center text-gray-500 text-xs">
                    <span>📷 {message.photoUrl}</span>
                </div>
            )}
            {message.documentUrl && (
                <div className="mb-2 rounded bg-gray-700 px-3 py-2 flex items-center gap-2 text-sm text-gray-300">
                    <span>📎</span>
                    <span>{message.documentName || message.documentUrl}</span>
                </div>
            )}
            {(message.text || message.caption) && (
                <div className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">
                    {message.caption || message.text}
                </div>
            )}
            {!message.caption && !message.text && (message.photoUrl || message.documentUrl) && null}
        </div>
    );
}

// ── Broadcast list item ──────────────────────────────────────
function BroadcastItem({ bc, onCancel }) {
    const stats = bc.stats || {};
    const msg = bc.message || {};
    const preview = msg.text
        ? msg.text.slice(0, 80) + (msg.text.length > 80 ? '…' : '')
        : msg.photoUrl ? '📷 Фото' : msg.documentUrl ? '📎 Документ' : '—';

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={bc.status} />
                        {bc.name && <span className="text-sm font-medium text-white truncate">{bc.name}</span>}
                    </div>
                    <div className="text-xs text-gray-400 truncate">{preview}</div>
                </div>
                <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500">
                        {new Date(bc.createdAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                    {bc.scheduledAt && bc.status === 'scheduled' && (
                        <div className="text-xs text-yellow-400 mt-0.5">
                            {new Date(bc.scheduledAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>Всього: <span className="text-gray-300">{stats.total ?? 0}</span></span>
                    <span>Надіслано: <span className="text-green-400">{stats.sent ?? 0}</span></span>
                    {(stats.failed ?? 0) > 0 && (
                        <span>Помилок: <span className="text-red-400">{stats.failed}</span></span>
                    )}
                </div>
                {bc.status === 'scheduled' && (
                    <button
                        onClick={() => onCancel(bc.id)}
                        className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-400 hover:bg-red-900/60 transition-colors"
                    >
                        Скасувати
                    </button>
                )}
            </div>
        </div>
    );
}

// ── Main page ────────────────────────────────────────────────
export function Broadcasts() {
    const STEPS = ['Воронки', 'Підписники', 'Повідомлення', 'Відправка'];

    const [step, setStep] = useState(1);
    const [bots, setBots] = useState([]);
    const [botsLoading, setBotsLoading] = useState(false);
    const [selectedBotIds, setSelectedBotIds] = useState([]);

    const [subscribers, setSubscribers] = useState([]);
    const [subsLoading, setSubsLoading] = useState(false);
    const [selectedSubIds, setSelectedSubIds] = useState(new Set());
    const [subsSearch, setSubsSearch] = useState('');

    const [message, setMessage] = useState({ text: '', parseMode: 'Markdown', photoUrl: '', documentUrl: '', documentName: '', caption: '' });

    const [broadcastName, setBroadcastName] = useState('');
    const [sendMode, setSendMode] = useState('now'); // 'now' | 'scheduled'
    const [scheduledAt, setScheduledAt] = useState('');
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState('');
    const [sendSuccess, setSendSuccess] = useState(false);

    const [broadcasts, setBroadcasts] = useState([]);
    const [broadcastsLoading, setBroadcastsLoading] = useState(false);

    // Load eligible bots on mount
    useEffect(() => {
        setBotsLoading(true);
        api.getBroadcastEligibleBots()
            .then(data => setBots(data || []))
            .catch(() => {})
            .finally(() => setBotsLoading(false));
        loadBroadcasts();
    }, []);

    function loadBroadcasts() {
        setBroadcastsLoading(true);
        api.getBroadcasts()
            .then(data => setBroadcasts(data || []))
            .catch(() => {})
            .finally(() => setBroadcastsLoading(false));
    }

    // Load subscribers when moving to step 2
    useEffect(() => {
        if (step !== 2 || !selectedBotIds.length) return;
        setSubsLoading(true);
        setSubscribers([]);
        setSelectedSubIds(new Set());
        api.getBroadcastSubscribers(selectedBotIds)
            .then(data => {
                setSubscribers(data || []);
                setSelectedSubIds(new Set((data || []).map(s => s.telegramId)));
            })
            .catch(() => {})
            .finally(() => setSubsLoading(false));
    }, [step, selectedBotIds.join(',')]);

    // Filtered subscribers
    const filteredSubs = useMemo(() => {
        if (!subsSearch.trim()) return subscribers;
        const q = subsSearch.toLowerCase();
        return subscribers.filter(s =>
            (s.firstName || '').toLowerCase().includes(q) ||
            (s.username || '').toLowerCase().includes(q) ||
            (s.telegramId || '').includes(q)
        );
    }, [subscribers, subsSearch]);

    // ── Step navigation guards ────────────────────────────────
    function canNext() {
        if (step === 1) return selectedBotIds.length > 0;
        if (step === 2) return selectedSubIds.size > 0;
        if (step === 3) return !!(message.text || message.photoUrl || message.documentUrl);
        return true;
    }

    function goNext() { if (canNext()) setStep(s => s + 1); }
    function goBack() { setStep(s => s - 1); setSendError(''); setSendSuccess(false); }

    // ── Bot selection ─────────────────────────────────────────
    function toggleBot(id) {
        setSelectedBotIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    }

    // ── Subscriber selection ──────────────────────────────────
    function toggleSub(telegramId) {
        setSelectedSubIds(prev => {
            const next = new Set(prev);
            if (next.has(telegramId)) next.delete(telegramId);
            else next.add(telegramId);
            return next;
        });
    }

    function selectAllSubs() {
        setSelectedSubIds(new Set(filteredSubs.map(s => s.telegramId)));
    }

    function deselectAllSubs() {
        setSelectedSubIds(prev => {
            const next = new Set(prev);
            filteredSubs.forEach(s => next.delete(s.telegramId));
            return next;
        });
    }

    // ── Send broadcast ────────────────────────────────────────
    async function handleSend() {
        setSendError('');
        setSendSuccess(false);
        setSending(true);
        try {
            const selectedSubs = subscribers.filter(s => selectedSubIds.has(s.telegramId));
            const recipients = selectedSubs.map(s => ({
                telegramId: s.telegramId,
                botId: s.botId,
                firstName: s.firstName,
                username: s.username,
            }));

            const msgPayload = {
                text: message.text || undefined,
                parseMode: message.parseMode || 'Markdown',
                photoUrl: message.photoUrl || undefined,
                documentUrl: message.documentUrl || undefined,
                documentName: message.documentName || undefined,
                caption: message.caption || undefined,
            };
            // Remove undefined keys
            Object.keys(msgPayload).forEach(k => msgPayload[k] === undefined && delete msgPayload[k]);

            await api.createBroadcast({
                name: broadcastName || undefined,
                message: msgPayload,
                recipients,
                scheduledAt: sendMode === 'scheduled' && scheduledAt ? scheduledAt : undefined,
            });
            setSendSuccess(true);
            loadBroadcasts();
            // Reset form
            setTimeout(() => {
                setStep(1);
                setSelectedBotIds([]);
                setSubscribers([]);
                setSelectedSubIds(new Set());
                setMessage({ text: '', parseMode: 'Markdown', photoUrl: '', documentUrl: '', documentName: '', caption: '' });
                setBroadcastName('');
                setSendMode('now');
                setScheduledAt('');
                setSendSuccess(false);
            }, 2000);
        } catch (err) {
            setSendError(err.message || 'Помилка відправки');
        } finally {
            setSending(false);
        }
    }

    async function handleCancel(id) {
        if (!window.confirm('Скасувати заплановану розсилку?')) return;
        try {
            await api.cancelBroadcast(id);
            loadBroadcasts();
        } catch (err) {
            alert(err.message || 'Помилка скасування');
        }
    }

    // ── Render steps ──────────────────────────────────────────
    function renderStep1() {
        return (
            <div>
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Оберіть воронки для розсилки</h3>
                {botsLoading ? (
                    <div className="text-gray-500 text-sm">Завантаження...</div>
                ) : bots.length === 0 ? (
                    <div className="text-gray-500 text-sm border border-gray-800 rounded-lg p-6 text-center">
                        Немає активних воронок з реальними підписниками
                    </div>
                ) : (
                    <div className="space-y-2">
                        {bots.map(bot => {
                            const selected = selectedBotIds.includes(bot.id);
                            return (
                                <label
                                    key={bot.id}
                                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                        selected ? 'border-brand/60 bg-brand/10' : 'border-gray-800 hover:border-gray-700 bg-gray-900'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() => toggleBot(bot.id)}
                                        className="accent-brand"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-white">{bot.name}</div>
                                        <div className="text-xs text-gray-500">{bot.slug}</div>
                                    </div>
                                    <div className="text-xs text-gray-400">
                                        {bot._count?.sessions ?? 0} підписників
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    function renderStep2() {
        const allFilteredSelected = filteredSubs.length > 0 && filteredSubs.every(s => selectedSubIds.has(s.telegramId));

        return (
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-300">
                        Підписники
                        {subscribers.length > 0 && (
                            <span className="ml-2 text-gray-500 font-normal">
                                ({selectedSubIds.size} / {subscribers.length} вибрано)
                            </span>
                        )}
                    </h3>
                    <div className="flex gap-2">
                        <button
                            onClick={allFilteredSelected ? deselectAllSubs : selectAllSubs}
                            className="text-xs px-2.5 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                        >
                            {allFilteredSelected ? 'Зняти всіх' : 'Вибрати всіх'}
                        </button>
                    </div>
                </div>

                <div className="mb-3">
                    <input
                        type="text"
                        placeholder="Пошук за іменем, username або ID..."
                        value={subsSearch}
                        onChange={e => setSubsSearch(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
                    />
                </div>

                {subsLoading ? (
                    <div className="text-gray-500 text-sm">Завантаження підписників...</div>
                ) : filteredSubs.length === 0 ? (
                    <div className="text-gray-500 text-sm text-center py-6">
                        {subsSearch ? 'Нічого не знайдено' : 'Немає підписників'}
                    </div>
                ) : (
                    <div className="border border-gray-800 rounded-lg overflow-hidden">
                        <div className="max-h-80 overflow-y-auto">
                            {filteredSubs.map(sub => {
                                const selected = selectedSubIds.has(sub.telegramId);
                                const displayName = sub.firstName || sub.username || sub.telegramId;
                                return (
                                    <label
                                        key={sub.telegramId}
                                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-gray-800 last:border-b-0 transition-colors ${
                                            selected ? 'bg-brand/10' : 'hover:bg-gray-800/50'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected}
                                            onChange={() => toggleSub(sub.telegramId)}
                                            className="accent-brand"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-white truncate">{displayName}</div>
                                            <div className="text-xs text-gray-500">
                                                {sub.username ? `@${sub.username} · ` : ''}{sub.telegramId}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    function renderStep3() {
        return (
            <div className="space-y-4">
                <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Текст повідомлення (Markdown)</label>
                    <textarea
                        value={message.text}
                        onChange={e => setMessage(m => ({ ...m, text: e.target.value }))}
                        rows={6}
                        placeholder="Введіть текст повідомлення..."
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 resize-y font-mono"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-gray-400 mb-1.5">URL фото (необов'язково)</label>
                        <input
                            type="url"
                            value={message.photoUrl}
                            onChange={e => setMessage(m => ({ ...m, photoUrl: e.target.value }))}
                            placeholder="https://..."
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-400 mb-1.5">URL документа (необов'язково)</label>
                        <input
                            type="url"
                            value={message.documentUrl}
                            onChange={e => setMessage(m => ({ ...m, documentUrl: e.target.value }))}
                            placeholder="https://..."
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
                        />
                    </div>
                </div>

                {message.documentUrl && (
                    <div>
                        <label className="block text-xs text-gray-400 mb-1.5">Назва документа</label>
                        <input
                            type="text"
                            value={message.documentName}
                            onChange={e => setMessage(m => ({ ...m, documentName: e.target.value }))}
                            placeholder="document.pdf"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
                        />
                    </div>
                )}

                {(message.photoUrl || message.documentUrl) && (
                    <div>
                        <label className="block text-xs text-gray-400 mb-1.5">Підпис до медіа (caption)</label>
                        <textarea
                            value={message.caption}
                            onChange={e => setMessage(m => ({ ...m, caption: e.target.value }))}
                            rows={3}
                            placeholder="Необов'язковий підпис..."
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 resize-none"
                        />
                    </div>
                )}

                <div>
                    <div className="text-xs text-gray-400 mb-2">Попередній перегляд</div>
                    <MessagePreview message={message} />
                </div>
            </div>
        );
    }

    function renderStep4() {
        const selectedCount = selectedSubIds.size;
        // min datetime-local value: now + 5min
        const minDt = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16);

        return (
            <div className="space-y-5">
                <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Назва розсилки (необов'язково)</label>
                    <input
                        type="text"
                        value={broadcastName}
                        onChange={e => setBroadcastName(e.target.value)}
                        placeholder="Назва для зручності"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
                    />
                </div>

                <div>
                    <div className="text-xs text-gray-400 mb-2">Час відправки</div>
                    <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="sendMode"
                                value="now"
                                checked={sendMode === 'now'}
                                onChange={() => setSendMode('now')}
                                className="accent-brand"
                            />
                            <span className="text-sm text-white">Надіслати зараз</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="sendMode"
                                value="scheduled"
                                checked={sendMode === 'scheduled'}
                                onChange={() => setSendMode('scheduled')}
                                className="accent-brand"
                            />
                            <span className="text-sm text-white">Запланувати</span>
                        </label>
                    </div>
                    {sendMode === 'scheduled' && (
                        <div className="mt-3">
                            <input
                                type="datetime-local"
                                value={scheduledAt}
                                min={minDt}
                                onChange={e => setScheduledAt(e.target.value)}
                                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
                            />
                        </div>
                    )}
                </div>

                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-sm text-gray-300 space-y-1">
                    <div>Отримувачів: <span className="text-white font-medium">{selectedCount}</span></div>
                    <div>Повідомлення: <span className="text-white">{message.photoUrl ? 'Фото' : message.documentUrl ? 'Документ' : 'Текст'}</span></div>
                    {broadcastName && <div>Назва: <span className="text-white">{broadcastName}</span></div>}
                    {sendMode === 'scheduled' && scheduledAt && (
                        <div>Час: <span className="text-yellow-300">{new Date(scheduledAt).toLocaleString('uk-UA')}</span></div>
                    )}
                </div>

                {sendError && (
                    <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
                        {sendError}
                    </div>
                )}

                {sendSuccess && (
                    <div className="bg-green-900/30 border border-green-700/50 rounded-lg px-4 py-3 text-sm text-green-300">
                        Розсилку успішно створено!
                    </div>
                )}

                <button
                    onClick={handleSend}
                    disabled={sending || sendSuccess || (sendMode === 'scheduled' && !scheduledAt)}
                    className="w-full py-3 rounded-lg bg-brand text-white font-semibold text-sm hover:bg-brand/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {sending ? 'Надсилання...' : sendMode === 'scheduled' ? 'Запланувати розсилку' : `Надіслати ${selectedCount} повідомлень`}
                </button>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-3xl mx-auto">
            {/* Stepper form */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
                <h2 className="text-lg font-semibold text-white mb-6">Нова розсилка</h2>
                <StepIndicator current={step} steps={STEPS} />

                <div className="min-h-[200px]">
                    {step === 1 && renderStep1()}
                    {step === 2 && renderStep2()}
                    {step === 3 && renderStep3()}
                    {step === 4 && renderStep4()}
                </div>

                <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-800">
                    <button
                        onClick={goBack}
                        disabled={step === 1}
                        className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        ← Назад
                    </button>
                    {step < 4 && (
                        <button
                            onClick={goNext}
                            disabled={!canNext()}
                            className="px-5 py-2 rounded-lg text-sm bg-brand text-white font-medium hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Далі →
                        </button>
                    )}
                </div>
            </div>

            {/* Broadcasts history */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-semibold text-white">Список розсилок</h2>
                    <button
                        onClick={loadBroadcasts}
                        className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                        Оновити
                    </button>
                </div>

                {broadcastsLoading ? (
                    <div className="text-gray-500 text-sm">Завантаження...</div>
                ) : broadcasts.length === 0 ? (
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">
                        Розсилок ще немає
                    </div>
                ) : (
                    <div className="space-y-3">
                        {broadcasts.map(bc => (
                            <BroadcastItem key={bc.id} bc={bc} onCancel={handleCancel} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
