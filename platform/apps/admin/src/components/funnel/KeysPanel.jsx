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
    'OPENAI_CONNECTOR_ID': {
        hint: 'ID збереженого OpenAI/GPT конектора зі вкладки Конектори',
        url: null,
    },
    'GPT_CONNECTOR_ID': {
        hint: 'ID збереженого OpenAI/GPT конектора зі вкладки Конектори',
        url: null,
    },
    'GEMINI_CONNECTOR_ID': {
        hint: 'ID збереженого Gemini конектора зі вкладки Конектори',
        url: null,
    },
    'FAL_AI_KEY': {
        hint: 'fal.ai Dashboard → API Keys',
        url: 'https://fal.ai/dashboard/keys',
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
    'GPT_API_KEY': {
        hint: 'OpenAI Platform → API Keys',
        url: 'https://platform.openai.com/api-keys',
    },
    'GEMINI_API_KEY': {
        hint: 'Google Gemini API Key',
        url: 'https://cloud.google.com/vertex-ai/docs/generative-ai',
    },
    'FOLLOW_UP_MESSAGE': {
        hint: 'Текст повідомлення-нагадування, якщо користувач не відповів протягом кількох годин',
        url: null,
    },
};

// Smart mapping: key name → suggested connector type + target field
const KEY_TO_CONNECTOR_HINT = {
    'FAL_AI_KEY':          { type: 'fal_ai',       field: 'api_key' },
    'CLAUDE_API_KEY':      { type: 'claude_sonnet', field: 'api_key' },
    'ANTHROPIC_API_KEY':   { type: 'claude_sonnet', field: 'api_key' },
    'OPENAI_API_KEY':      { type: 'openai_gpt4',   field: 'api_key' },
    'GPT_API_KEY':         { type: 'openai_gpt4',   field: 'api_key' },
    'GEMINI_API_KEY':      { type: 'google_gemini', field: 'api_key' },
    'TELEGRAM_BOT_TOKEN':  { type: 'telegram_bot',  field: 'token'   },
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

// ─── Save as Connector Modal ──────────────────────────────────────────────────
function SaveAsConnectorModal({ keyName, keyValue, connectorDefs, onSave, onClose }) {
    const hint = KEY_TO_CONNECTOR_HINT[keyName];

    const initialDef = hint
        ? (connectorDefs.find(d => d.type === hint.type) || connectorDefs[0])
        : connectorDefs[0];

    const [name, setName] = useState(keyName.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()));
    const [type, setType] = useState(initialDef?.type || '');
    const [fieldKey, setFieldKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!type) return;
        const def = connectorDefs.find(d => d.type === type);
        const fields = def?.schema?.fields || [];
        const preferred = hint?.type === type ? fields.find(f => f.key === hint?.field) : null;
        setFieldKey(preferred?.key || fields[0]?.key || '');
    }, [type]);

    const selectedDef = connectorDefs.find(d => d.type === type);
    const fields = selectedDef?.schema?.fields || [];

    const handleTypeChange = (newType) => setType(newType);

    const handleSave = async () => {
        if (!name.trim()) { setError('Введіть назву конектора'); return; }
        if (!type) { setError('Оберіть тип конектора'); return; }
        if (!fieldKey) { setError('Оберіть поле'); return; }
        setSaving(true);
        setError('');
        try {
            await onSave({ name: name.trim(), type, config: { [fieldKey]: keyValue } });
        } catch (e) {
            setError(e.message || 'Помилка збереження');
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col">
                <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                    <div>
                        <h3 className="text-white font-semibold">Зберегти як конектор</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Ключ <code className="text-brand-light">{keyName}</code> стане багаторазовим конектором
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">✕</button>
                </div>

                <div className="p-5 space-y-4">
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Назва конектора</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Мій FAL.ai ключ"
                            autoFocus
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        />
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Тип конектора</label>
                        <select
                            value={type}
                            onChange={e => handleTypeChange(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                        >
                            <option value="">— оберіть тип —</option>
                            {connectorDefs.map(d => (
                                <option key={d.type} value={d.type}>{d.icon} {d.name}</option>
                            ))}
                        </select>
                        {selectedDef?.description && (
                            <p className="text-xs text-gray-500 mt-1">{selectedDef.description}</p>
                        )}
                    </div>

                    {fields.length > 1 && (
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">Записати значення в поле</label>
                            <select
                                value={fieldKey}
                                onChange={e => setFieldKey(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                            >
                                {fields.map(f => (
                                    <option key={f.key} value={f.key}>{f.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {type && fieldKey && (
                        <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2 text-xs text-gray-400 space-y-0.5">
                            <div>📦 Тип: <span className="text-gray-300">{selectedDef?.icon} {selectedDef?.name}</span></div>
                            <div>🔑 Поле: <code className="text-brand-light">{fieldKey}</code> ← значення <code className="text-brand-light">{keyName}</code></div>
                        </div>
                    )}

                    {error && (
                        <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">{error}</div>
                    )}
                </div>

                <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-3 py-2 text-sm text-gray-300 hover:text-white transition-colors"
                    >
                        Скасувати
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !name.trim() || !type || !fieldKey}
                        className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors"
                    >
                        {saving ? 'Збереження…' : '💾 Зберегти конектор'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── KeyRow ───────────────────────────────────────────────────────────────────
function KeyRow({ k, onEdit, onDelete, onReveal, onSaveAsConnector, isRequired = false }) {
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

    const handleSaveAsConnector = async () => {
        let value = k.value;
        if (k.isSecret) {
            value = revealedValue || await onReveal(k.key);
            if (!revealedValue) setRevealedValue(value);
        }
        onSaveAsConnector({ ...k, value });
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
                        onClick={handleSaveAsConnector}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-blue-900/40 text-gray-400 hover:text-blue-300 transition-colors"
                        title="Зберегти як конектор"
                    >
                        💾
                    </button>
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

// ─── KeyForm ──────────────────────────────────────────────────────────────────
function KeyForm({ initial, onSave, onCancel, savedConnectors = [] }) {
    const [form, setForm] = useState(initial || { key: '', value: '', label: '', isSecret: false });
    const [showValue, setShowValue] = useState(false);
    const [pickerConnectorId, setPickerConnectorId] = useState('');
    const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

    const pickedConnector = savedConnectors.find(c => c.id === pickerConnectorId);
    const connectorFields = pickedConnector
        ? [
            { key: '__id', label: '🔑 ID конектора', value: pickedConnector.id },
            ...Object.entries(pickedConnector.config || {})
                .filter(([, v]) => v !== null && v !== undefined && v !== '')
                .map(([k, v]) => ({ key: k, label: k, value: String(v) })),
          ]
        : [];

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
            {savedConnectors.length > 0 && (
                <div className="rounded-lg border border-gray-700 p-2 bg-gray-900/50 space-y-1.5">
                    <label className="text-xs text-gray-500 block">Заповнити з конектора</label>
                    <select
                        value={pickerConnectorId}
                        onChange={e => setPickerConnectorId(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand"
                    >
                        <option value="">— оберіть конектор —</option>
                        {savedConnectors.map(c => (
                            <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                        ))}
                    </select>
                    {connectorFields.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {connectorFields.map(f => (
                                <button
                                    key={f.key}
                                    type="button"
                                    onClick={() => set('value', f.value)}
                                    title={f.key === '__id' ? f.value : 'Натисни, щоб вставити значення поля'}
                                    className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-brand/30 border border-gray-600 hover:border-brand/60 text-gray-300 hover:text-white transition-colors"
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
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

// ─── KeysPanel ────────────────────────────────────────────────────────────────
export function KeysPanel({ embedded = false }) {
    const { bot, keys, upsertKey, deleteKey, revealKey, reloadKeys } = useFunnelStore();
    const [editing, setEditing] = useState(null); // null | {} (new) | existing key
    const [isNew, setIsNew] = useState(false);
    const [allSavedConnectors, setAllSavedConnectors] = useState([]);
    const [connectorDefs, setConnectorDefs] = useState([]);
    const [selectedConnectorId, setSelectedConnectorId] = useState('');
    const [selectedOpenAIConnectorId, setSelectedOpenAIConnectorId] = useState('');
    const [selectedGeminiConnectorId, setSelectedGeminiConnectorId] = useState('');
    const [selectedTelegramConnectorId, setSelectedTelegramConnectorId] = useState('');
    const [telegramBusy, setTelegramBusy] = useState(false);
    const [telegramStatus, setTelegramStatus] = useState(null); // { ok, msg }
    const [loadingConnectors, setLoadingConnectors] = useState(false);
    const [saveAsConnectorKey, setSaveAsConnectorKey] = useState(null); // { key, value, isSecret, label }
    const [saveAsSuccess, setSaveAsSuccess] = useState('');
    const visibleKeys = useMemo(() => keys, [keys]);
    const savedClaudeConnectors = useMemo(
        () => allSavedConnectors.filter((item) => String(item.type || '').startsWith('claude_')),
        [allSavedConnectors]
    );
    const savedOpenAIConnectors = useMemo(
        () => allSavedConnectors.filter((item) => String(item.type || '').startsWith('openai_')),
        [allSavedConnectors]
    );
    const savedGeminiConnectors = useMemo(
        () => allSavedConnectors.filter((item) => item.type === 'google_gemini'),
        [allSavedConnectors]
    );
    const savedTelegramConnectors = useMemo(
        () => allSavedConnectors.filter((item) => item.type === 'telegram_bot'),
        [allSavedConnectors]
    );

    useEffect(() => {
        setLoadingConnectors(true);
        Promise.allSettled([
            api.getSavedConnectors(),
            api.getConnectors(),
        ]).then(([savedRes, defsRes]) => {
            if (savedRes.status === 'fulfilled') {
                const list = savedRes.value;
                setAllSavedConnectors(Array.isArray(list) ? list : (list?.data || []));
            }
            if (defsRes.status === 'fulfilled') {
                const list = defsRes.value;
                setConnectorDefs(Array.isArray(list) ? list : (list?.data || []));
            }
        }).finally(() => setLoadingConnectors(false));
    }, []);

    useEffect(() => {
        const current = keys.find((item) => item.key === 'CLAUDE_CONNECTOR_ID');
        if (current?.value) setSelectedConnectorId(String(current.value));
        const openaiCurrent = keys.find((item) => item.key === 'OPENAI_CONNECTOR_ID' || item.key === 'GPT_CONNECTOR_ID');
        if (openaiCurrent?.value) setSelectedOpenAIConnectorId(String(openaiCurrent.value));
        const geminiCurrent = keys.find((item) => item.key === 'GEMINI_CONNECTOR_ID');
        if (geminiCurrent?.value) setSelectedGeminiConnectorId(String(geminiCurrent.value));
        const tgCurrent = keys.find((item) => item.key === 'TELEGRAM_CONNECTOR_ID');
        if (tgCurrent?.value) setSelectedTelegramConnectorId(String(tgCurrent.value));
    }, [keys]);

    // Get required keys based on enabled channels
    const getRequiredKeys = () => {
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
            // Токен може приходити зі збереженого конектора (TELEGRAM_CONNECTOR_ID) —
            // тоді окремий TELEGRAM_BOT_TOKEN не обов'язковий.
            const hasConnector = keys.some(k => k.key === 'TELEGRAM_CONNECTOR_ID' && k.value);
            if (!hasConnector) required.push('TELEGRAM_BOT_TOKEN');
            required.push('TELEGRAM_BOT_USERNAME');
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

    const handleUseSavedOpenAIConnector = async () => {
        if (!selectedOpenAIConnectorId) return;
        await upsertKey('OPENAI_CONNECTOR_ID', selectedOpenAIConnectorId, 'OpenAI Connector ID', false);
    };

    const handleUseSavedGeminiConnector = async () => {
        if (!selectedGeminiConnectorId) return;
        await upsertKey('GEMINI_CONNECTOR_ID', selectedGeminiConnectorId, 'Gemini Connector ID', false);
    };

    const handleUseSavedTelegramConnector = async () => {
        if (!selectedTelegramConnectorId || telegramBusy) return;
        setTelegramBusy(true);
        setTelegramStatus(null);
        try {
            await upsertKey('TELEGRAM_CONNECTOR_ID', selectedTelegramConnectorId, 'Telegram Connector ID', false);
            const res = await api.refreshTelegramUsername(bot.id);
            await reloadKeys();
            if (res?.ok && res.username) {
                setTelegramStatus({ ok: true, msg: `✅ Бот @${res.username} під'єднано — username заповнено автоматично.` });
            } else {
                setTelegramStatus({ ok: false, msg: res?.reason || 'Не вдалось отримати username бота.' });
            }
        } catch (e) {
            setTelegramStatus({ ok: false, msg: e.message || 'Помилка' });
        } finally {
            setTelegramBusy(false);
        }
    };

    const handleUseManualGPTKey = () => {
        setEditing({ key: 'GPT_API_KEY', value: '', label: 'GPT API Key', isSecret: true });
        setIsNew(true);
    };

    const handleUseManualGeminiKey = () => {
        setEditing({ key: 'GEMINI_API_KEY', value: '', label: 'Gemini API Key', isSecret: true });
        setIsNew(true);
    };

    const handleUseManualClaudeKey = () => {
        setEditing({ key: 'CLAUDE_API_KEY', value: '', label: 'Claude API Key', isSecret: true });
        setIsNew(true);
    };

    // Save key as connector
    const handleSaveAsConnector = (keyObj) => {
        setSaveAsConnectorKey(keyObj);
    };

    const handleConfirmSaveAsConnector = async (connectorData) => {
        await api.createSavedConnector(connectorData);
        // Refresh saved connectors list
        const updated = await api.getSavedConnectors();
        setAllSavedConnectors(Array.isArray(updated) ? updated : (updated?.data || []));
        setSaveAsConnectorKey(null);
        setSaveAsSuccess(`✅ Конектор «${connectorData.name}» збережено!`);
        setTimeout(() => setSaveAsSuccess(''), 3000);
    };

    return (
        <div className={embedded
            ? 'h-full flex flex-col overflow-hidden'
            : 'w-72 shrink-0 bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden'}>
            {!embedded && (
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                    <div>
                        <div className="text-sm font-semibold text-white">Ключі воронки</div>
                        <div className="text-xs text-gray-500">Ключі і конектори для цієї воронки</div>
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

                {saveAsSuccess && (
                    <div className="rounded-lg px-3 py-2 bg-green-900/20 border border-green-800 text-xs text-green-300">
                        {saveAsSuccess}
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

                {savedTelegramConnectors.length > 0 && (
                    <div className="rounded-lg p-3 border bg-cyan-900/10 border-cyan-900/40 space-y-2">
                        <div className="text-xs text-cyan-300 font-medium">Telegram-бот для цієї воронки</div>
                        <div className="text-xs text-gray-400">
                            Обери збережений Telegram-конектор — токен підставиться через <code className="text-cyan-200">TELEGRAM_CONNECTOR_ID</code>, а <code className="text-cyan-200">TELEGRAM_BOT_USERNAME</code> заповниться автоматично.
                        </div>
                        <div className="flex gap-2">
                            <select
                                value={selectedTelegramConnectorId}
                                onChange={(e) => setSelectedTelegramConnectorId(e.target.value)}
                                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-white"
                                disabled={loadingConnectors || telegramBusy || savedTelegramConnectors.length === 0}
                            >
                                <option value="">{loadingConnectors ? 'Завантаження...' : 'Оберіть Telegram-конектор'}</option>
                                {savedTelegramConnectors.map((item) => (
                                    <option key={item.id} value={item.id}>{item.name}</option>
                                ))}
                            </select>
                            <button
                                onClick={handleUseSavedTelegramConnector}
                                disabled={!selectedTelegramConnectorId || telegramBusy}
                                className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50"
                            >
                                {telegramBusy ? '…' : 'Використати'}
                            </button>
                        </div>
                        {telegramStatus && (
                            <div className={`text-[11px] rounded px-2 py-1 border ${telegramStatus.ok ? 'text-green-300 bg-green-900/20 border-green-800' : 'text-red-300 bg-red-900/20 border-red-800'}`}>
                                {telegramStatus.msg}
                            </div>
                        )}
                    </div>
                )}

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
                    <KeyForm initial={editing} onSave={handleSave} onCancel={() => { setEditing(null); setIsNew(false); }} savedConnectors={allSavedConnectors} />
                )}

                {visibleKeys.map(k => (
                    editing?.key === k.key && !isNew ? (
                        <KeyForm key={k.key} initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} savedConnectors={allSavedConnectors} />
                    ) : (
                        <KeyRow
                            key={k.key}
                            k={k}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onReveal={revealKey}
                            onSaveAsConnector={handleSaveAsConnector}
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

            {saveAsConnectorKey && (
                <SaveAsConnectorModal
                    keyName={saveAsConnectorKey.key}
                    keyValue={saveAsConnectorKey.value}
                    connectorDefs={connectorDefs}
                    onSave={handleConfirmSaveAsConnector}
                    onClose={() => setSaveAsConnectorKey(null)}
                />
            )}
        </div>
    );
}
