import React, { useEffect, useMemo, useState } from 'react';
import { useFunnelStore } from '../../stores/funnelStore.js';
import { api } from '../../api/client.js';

const CHANNELS_KEY = 'FUNNEL_CHANNELS';

const KEY_HINTS = {
    'TELEGRAM_BOT_TOKEN': {
        hint: 'Отримати у @BotFather → /newbot або /token',
        url: 'https://t.me/BotFather',
    },
    'TELEGRAM_BOT_USERNAME': {
        hint: 'Username бота без @, там само у @BotFather',
        url: 'https://t.me/BotFather',
    },
    'CLAUDE_API_KEY': {
        hint: 'Anthropic Console → API Keys',
        url: 'https://console.anthropic.com/account/keys',
    },
    'ANTHROPIC_API_KEY': {
        hint: 'Anthropic Console → API Keys',
        url: 'https://console.anthropic.com/account/keys',
    },
    'CLAUDE_CONNECTOR_ID': {
        hint: 'ID збереженого Claude-конектора зі вкладки Конектори',
        url: null,
    },
    'INSTAGRAM_ACCESS_TOKEN': {
        hint: 'Meta for Developers → Graph API Explorer',
        url: 'https://developers.facebook.com/tools/explorer/',
    },
    'INSTAGRAM_APP_SECRET': {
        hint: 'Meta for Developers → App Dashboard → Basic Settings',
        url: 'https://developers.facebook.com/',
    },
    'INSTAGRAM_VERIFY_TOKEN': {
        hint: 'Довільний рядок, який ви самі вигадаєте для верифікації вебхука',
        url: null,
    },
    'INSTAGRAM_BUSINESS_ID': {
        hint: 'Meta Business Suite → Налаштування → ID бізнес-акаунту',
        url: 'https://business.facebook.com/settings/',
    },
    'INSTAGRAM_USERNAME': {
        hint: 'Username Instagram-акаунту без @',
        url: null,
    },
    'ADMIN_TELEGRAM_ID': {
        hint: 'Ваш Telegram ID — дізнатись через @userinfobot',
        url: 'https://t.me/userinfobot',
    },
    'WAYFORPAY_MERCHANT_ACCOUNT': {
        hint: 'WayForPay особистий кабінет → Мій рахунок',
        url: 'https://admin.wayforpay.com/',
    },
    'WAYFORPAY_MERCHANT_SECRET': {
        hint: 'WayForPay особистий кабінет → Мій рахунок → Секретний ключ',
        url: 'https://admin.wayforpay.com/',
    },
    'OPENAI_API_KEY': {
        hint: 'OpenAI Platform → API Keys',
        url: 'https://platform.openai.com/api-keys',
    },
    'FOLLOW_UP_MESSAGE': {
        hint: 'Текст повідомлення-нагадування, якщо користувач не відповів протягом кількох годин',
        url: null,
    },
};

const CHANNEL_PRESETS = [
    {
        id: 'telegram',
        label: 'Telegram бот',
        keys: [
            { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', isSecret: true },
            { key: 'TELEGRAM_BOT_USERNAME', label: 'Telegram Bot Username', isSecret: false },
        ],
    },
    {
        id: 'instagram',
        label: 'Instagram',
        keys: [
            { key: 'INSTAGRAM_ACCESS_TOKEN', label: 'Instagram Access Token', isSecret: true },
            { key: 'INSTAGRAM_APP_SECRET', label: 'Instagram App Secret', isSecret: true },
            { key: 'INSTAGRAM_VERIFY_TOKEN', label: 'Instagram Verify Token', isSecret: true },
            { key: 'INSTAGRAM_BUSINESS_ID', label: 'Instagram Business ID', isSecret: false },
            { key: 'INSTAGRAM_USERNAME', label: 'Instagram Username (without @)', isSecret: false },
        ],
    },
];

function toKeyMap(keys) {
    return keys.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});
}

function normalizeTelegramUsername(raw) {
    if (!raw) return '';
    return String(raw).trim().replace(/^@/, '');
}

function normalizeInstagramUsername(raw) {
    if (!raw) return '';
    return String(raw).trim().replace(/^@/, '');
}

function buildChannelLinks({ channels, keyMap, bot, counts }) {
    if (!bot) return [];

    const links = [];

    if (channels.includes('telegram')) {
        const username = normalizeTelegramUsername(keyMap.TELEGRAM_BOT_USERNAME);
        const total = Math.max(1, counts.telegram || 1);
        for (let i = 0; i < total; i += 1) {
            const suffix = i === 0 ? '' : `__l${i + 1}`;
            const payload = `${bot.slug || bot.id}${suffix}`;
            links.push({
                id: `telegram-${i}`,
                channel: 'Telegram',
                title: `Telegram #${i + 1}`,
                missing: !username,
                hint: 'Заповніть TELEGRAM_BOT_USERNAME, щоб згенерувати посилання.',
                url: username ? `https://t.me/${username}?start=${encodeURIComponent(payload)}` : '',
            });
        }
    }

    if (channels.includes('instagram')) {
        const username = normalizeInstagramUsername(keyMap.INSTAGRAM_USERNAME);
        const total = Math.max(1, counts.instagram || 1);
        for (let i = 0; i < total; i += 1) {
            const ref = `${bot.slug || bot.id}_l${i + 1}`;
            links.push({
                id: `instagram-${i}`,
                channel: 'Instagram',
                title: `Instagram #${i + 1}`,
                missing: !username,
                hint: 'Заповніть INSTAGRAM_USERNAME, щоб згенерувати посилання.',
                url: username ? `https://ig.me/m/${username}?ref=${encodeURIComponent(ref)}` : '',
            });
        }
    }

    return links;
}

function parseSelectedChannels(rawValue) {
    if (!rawValue) return [];
    try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
        // fall through to CSV mode
    }
    return String(rawValue)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

function KeyRow({ k, onEdit, onDelete, onReveal, isRequired = false }) {
    const [revealed, setRevealed] = useState(false);
    const [revealedValue, setRevealedValue] = useState('');
    const [isRevealing, setIsRevealing] = useState(false);

    const handleReveal = async () => {
        if (revealed) { setRevealed(false); return; }
        setIsRevealing(true);
        const value = await onReveal(k.key);
        setRevealedValue(value);
        setRevealed(true);
        setIsRevealing(false);
    };

    const handleEdit = async () => {
        if (k.isSecret) {
            // Reveal real value before opening edit form
            const realValue = revealedValue || await onReveal(k.key);
            if (!revealedValue) setRevealedValue(realValue);
            onEdit({ ...k, value: realValue });
        } else {
            onEdit(k);
        }
    };

    const isMissing = isRequired && !k.value;

    return (
        <div className={`rounded-lg p-3 border ${isMissing ? 'bg-red-900/10 border-red-900/40' : 'bg-gray-900 border-gray-800'}`}>
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <code className={`text-sm font-mono ${isMissing ? 'text-red-400' : 'text-brand-light'}`}>{k.key}</code>
                        {k.isSecret && <span className="text-[10px] bg-yellow-900/40 text-yellow-400 border border-yellow-800 rounded px-1.5 py-0.5">SECRET</span>}
                        {isMissing && <span className="text-[10px] bg-red-900/40 text-red-400 border border-red-800 rounded px-1.5 py-0.5">⚠ БРАКУЄ</span>}
                    </div>
                    {k.label && <div className="text-xs text-gray-400 mt-0.5">{k.label}</div>}
                    {KEY_HINTS[k.key] && (
                        <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                            <span>💡 {KEY_HINTS[k.key].hint}</span>
                            {KEY_HINTS[k.key].url && (
                                <a
                                    href={KEY_HINTS[k.key].url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-brand-light hover:text-brand underline"
                                    onClick={e => e.stopPropagation()}
                                >
                                    →
                                </a>
                            )}
                        </div>
                    )}
                    <div className={`text-sm mt-1 font-mono break-all ${isMissing ? 'text-red-300' : 'text-gray-300'}`}>
                        {revealed ? revealedValue : (k.isSecret ? '••••••••' : k.value)}
                    </div>
                </div>
                <div className="flex gap-1 shrink-0">
                    {k.isSecret && (
                        <button
                            onClick={handleReveal}
                            disabled={isRevealing}
                            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                            title={revealed ? 'Сховати значення' : 'Показати значення'}
                        >
                            {isRevealing ? '…' : revealed ? 'Сховати' : 'Показати'}
                        </button>
                    )}
                    <button
                        onClick={handleEdit}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                    >
                        ✏️
                    </button>
                    <button
                        onClick={() => onDelete(k.key)}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-red-900/40 text-gray-400 hover:text-red-300 transition-colors"
                    >
                        🗑
                    </button>
                </div>
            </div>
        </div>
    );
}

function KeyForm({ initial, onSave, onCancel }) {
    const [form, setForm] = useState(initial || { key: '', value: '', label: '', isSecret: false });
    const [showValue, setShowValue] = useState(false);
    const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

    return (
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700 space-y-2">
            <div>
                <label className="text-xs text-gray-400 block mb-1">Ключ (A-Z, 0-9, _)</label>
                <input
                    value={form.key}
                    onChange={e => set('key', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    placeholder="MY_KEY"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-brand"
                />
            </div>
            <div>
                <label className="text-xs text-gray-400 block mb-1">Значення</label>
                <div className="flex gap-2">
                    <input
                        type={form.isSecret && !showValue ? 'password' : 'text'}
                        value={form.value}
                        onChange={e => set('value', e.target.value)}
                        placeholder="value"
                        className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-brand"
                    />
                    <button
                        type="button"
                        onClick={() => setShowValue(v => !v)}
                        className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs transition-colors"
                        title={showValue ? 'Сховати значення' : 'Показати значення'}
                    >
                        {showValue ? 'Сховати' : 'Показати'}
                    </button>
                </div>
            </div>
            <div>
                <label className="text-xs text-gray-400 block mb-1">Мітка (опційно)</label>
                <input
                    value={form.label}
                    onChange={e => set('label', e.target.value)}
                    placeholder="Telegram Bot Token"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                    type="checkbox"
                    checked={form.isSecret}
                    onChange={e => set('isSecret', e.target.checked)}
                    className="accent-brand"
                />
                Секретний (буде замасковано)
            </label>
            <div className="flex gap-2 pt-1">
                <button
                    onClick={() => onSave(form)}
                    className="flex-1 bg-brand hover:bg-brand-dark text-white rounded py-1.5 text-sm transition-colors"
                >
                    Зберегти
                </button>
                <button
                    onClick={onCancel}
                    className="px-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded py-1.5 text-sm transition-colors"
                >
                    Скасувати
                </button>
            </div>
        </div>
    );
}

export function KeysPanel({ embedded = false }) {
    const { bot, keys, upsertKey, deleteKey, revealKey } = useFunnelStore();
    const [editing, setEditing] = useState(null); // null | {} (new) | existing key
    const [isNew, setIsNew] = useState(false);
    const [savedClaudeConnectors, setSavedClaudeConnectors] = useState([]);
    const [selectedConnectorId, setSelectedConnectorId] = useState('');
    const [loadingConnectors, setLoadingConnectors] = useState(false);
    const visibleKeys = useMemo(() => keys, [keys]);

    useEffect(() => {
        setLoadingConnectors(true);
        api.getSavedConnectors()
            .then((list) => {
                const normalized = Array.isArray(list) ? list : (list?.data || []);
                const claudeItems = normalized.filter((item) => String(item.type || '').startsWith('claude_'));
                setSavedClaudeConnectors(claudeItems);
            })
            .catch(() => setSavedClaudeConnectors([]))
            .finally(() => setLoadingConnectors(false));
    }, []);

    useEffect(() => {
        const current = keys.find((item) => item.key === 'CLAUDE_CONNECTOR_ID');
        if (current?.value) setSelectedConnectorId(String(current.value));
    }, [keys]);

    // Get required keys based on enabled channels
    const getRequiredKeys = () => {
        const keyMap = {};
        keys.forEach(k => { keyMap[k.key] = k.value; });

        const channelsKey = keys.find(k => k.key === 'FUNNEL_CHANNELS');
        let channels = [];
        if (channelsKey?.value) {
            try {
                channels = JSON.parse(channelsKey.value);
            } catch {
                channels = channelsKey.value.split(',').map(v => v.trim());
            }
        }

        const required = [];
        if (channels.includes('telegram')) {
            required.push('TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME');
        }
        if (channels.includes('instagram')) {
            required.push('INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN', 'INSTAGRAM_BUSINESS_ID', 'INSTAGRAM_USERNAME');
        }

        return required;
    };

    const requiredKeys = getRequiredKeys();
    const existingKeyNames = new Set(visibleKeys.map((k) => k.key));
    const missingRequiredKeys = requiredKeys.filter((key) => !existingKeyNames.has(key));

    const handleSave = async (form) => {
        await upsertKey(form.key, form.value, form.label, form.isSecret);
        setEditing(null);
        setIsNew(false);
    };

    const handleEdit = (k) => { setEditing(k); setIsNew(false); };
    const handleNew = () => { setEditing({ key: '', value: '', label: '', isSecret: false }); setIsNew(true); };
    const handleDelete = async (key) => {
        if (!confirm(`Видалити ключ ${key}?`)) return;
        await deleteKey(key);
    };

    const handleUseSavedClaudeConnector = async () => {
        if (!selectedConnectorId) return;
        await upsertKey('CLAUDE_CONNECTOR_ID', selectedConnectorId, 'Claude Connector ID', false);
    };

    const handleUseManualClaudeKey = () => {
        setEditing({ key: 'CLAUDE_API_KEY', value: '', label: 'Claude API Key', isSecret: true });
        setIsNew(true);
    };

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // no-op
        }
    };

    return (
        <div className={embedded
            ? 'h-full flex flex-col overflow-hidden'
            : 'w-72 shrink-0 bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden'}>
            {!embedded && (
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                    <div>
                        <div className="text-sm font-semibold text-white">Ключі воронки</div>
                        <div className="text-xs text-gray-500">Env змінні для цього бота</div>
                    </div>
                    <button
                        onClick={handleNew}
                        className="text-sm bg-brand/20 hover:bg-brand/30 text-brand-light rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                        + Новий
                    </button>
                </div>
            )}

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                {embedded && (
                    <div className="flex justify-end">
                        <button
                            onClick={handleNew}
                            className="text-xs bg-brand/20 hover:bg-brand/30 text-brand-light rounded-lg px-2.5 py-1.5 transition-colors"
                        >
                            + Новий ключ
                        </button>
                    </div>
                )}
                <div className="rounded-lg p-3 border bg-blue-900/10 border-blue-900/40 space-y-2">
                    <div className="text-xs text-blue-300 font-medium">Claude для цієї воронки</div>
                    <div className="text-xs text-gray-400">
                        Можна або зберегти ключ напряму в CLAUDE_API_KEY, або вибрати існуючий Claude-конектор.
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={handleUseManualClaudeKey}
                            className="text-xs px-2 py-1 rounded bg-blue-900/30 hover:bg-blue-900/50 text-blue-200 border border-blue-800"
                        >
                            Ввести CLAUDE_API_KEY
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <select
                            value={selectedConnectorId}
                            onChange={(e) => setSelectedConnectorId(e.target.value)}
                            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-white"
                            disabled={loadingConnectors || savedClaudeConnectors.length === 0}
                        >
                            <option value="">{loadingConnectors ? 'Завантаження...' : 'Оберіть Claude-конектор'}</option>
                            {savedClaudeConnectors.map((item) => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={handleUseSavedClaudeConnector}
                            disabled={!selectedConnectorId}
                            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50"
                        >
                            Використати
                        </button>
                    </div>
                </div>

                {missingRequiredKeys.length > 0 && (
                    <div className="rounded-lg p-3 border bg-red-900/10 border-red-900/40">
                        <div className="text-xs text-red-300 mb-2">Бракує обов'язкових ключів для каналів:</div>
                        <div className="space-y-2">
                            {missingRequiredKeys.map((key) => (
                                <div key={key} className="space-y-0.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <code className="text-xs text-red-200 font-mono">{key}</code>
                                        <button
                                            onClick={() => {
                                                setEditing({ key, value: '', label: key, isSecret: key.includes('TOKEN') || key.includes('SECRET') });
                                                setIsNew(true);
                                            }}
                                            className="text-xs px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-800"
                                        >
                                            Додати
                                        </button>
                                    </div>
                                    {KEY_HINTS[key] && (
                                        <div className="text-[11px] text-gray-500 flex items-center gap-1">
                                            <span>💡 {KEY_HINTS[key].hint}</span>
                                            {KEY_HINTS[key].url && (
                                                <a href={KEY_HINTS[key].url} target="_blank" rel="noopener noreferrer" className="text-brand-light hover:text-brand underline">→</a>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {isNew && editing && (
                    <KeyForm initial={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsNew(false); }} />
                )}

                {visibleKeys.map(k => (
                    editing?.key === k.key && !isNew ? (
                        <KeyForm key={k.key} initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />
                    ) : (
                        <KeyRow
                            key={k.key}
                            k={k}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onReveal={revealKey}
                            isRequired={requiredKeys.includes(k.key)}
                        />
                    )
                ))}

                {visibleKeys.length === 0 && !isNew && (
                    <div className="text-center text-gray-500 text-sm py-8">
                        Немає ключів.<br />
                        <button onClick={handleNew} className="text-brand-light hover:text-brand mt-2">Додати перший</button>
                    </div>
                )}
            </div>
        </div>
    );
}
