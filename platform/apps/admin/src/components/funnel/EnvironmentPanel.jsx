import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useFunnelStore } from '../../stores/funnelStore.js';
import { api } from '../../api/client.js';

const CHANNELS_KEY = 'FUNNEL_CHANNELS';
const TG_CONNECTOR_KEY = 'TELEGRAM_CONNECTOR_ID';
const LINK_COUNTS_KEY = 'FUNNEL_LINK_COUNTS';
const LINK_META_KEY = 'FUNNEL_LINK_META';

const CHANNEL_PRESETS = [
    {
        id: 'telegram',
        label: 'Telegram бот',
        keys: [
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
    {
        id: 'webhook',
        label: 'Webhook / API (запит ззовні)',
        keys: [],
    },
];

function toKeyMap(keys) {
    return keys.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});
}

function normalizeUsername(raw) {
    if (!raw) return '';
    return String(raw).trim().replace(/^@/, '');
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

function buildWebhookInfo(bot) {
    const base = window.location.origin.replace(':5173', '').replace(':5174', '');
    const webhookBase = base.includes('localhost') ? 'https://flows.fineko.space' : base;
    return {
        startUrl: `${webhookBase}/webhook/telegram/${bot.id}`,
        httpMethod: 'POST',
        bodyExample: JSON.stringify({ text: 'Привіт', from: { id: 123456789, first_name: 'Юзер' } }, null, 2),
        note: 'Або запуск через POST-запит на цей URL з тілом у форматі Telegram update.',
    };
}

function buildChannelLinks({ channels, keyMap, bot, counts }) {
    if (!bot) return [];

    const links = [];

    if (channels.includes('telegram')) {
        const username = normalizeUsername(keyMap.TELEGRAM_BOT_USERNAME);
        const total = Math.max(1, counts.telegram || 1);
        for (let i = 0; i < total; i += 1) {
            const suffix = i === 0 ? '' : `__l${i + 1}`;
            const payload = `${bot.slug || bot.id}${suffix}`;
            links.push({
                id: `telegram-${i}`,
                channel: 'Telegram',
                channelId: 'telegram',
                index: i,
                defaultTitle: `Telegram #${i + 1}`,
                missing: !username,
                hint: 'Заповніть TELEGRAM_BOT_USERNAME, щоб згенерувати посилання.',
                url: username ? `https://t.me/${username}?start=${encodeURIComponent(payload)}` : '',
            });
        }
    }

    if (channels.includes('instagram')) {
        const username = normalizeUsername(keyMap.INSTAGRAM_USERNAME);
        const total = Math.max(1, counts.instagram || 1);
        for (let i = 0; i < total; i += 1) {
            const ref = `${bot.slug || bot.id}_l${i + 1}`;
            links.push({
                id: `instagram-${i}`,
                channel: 'Instagram',
                channelId: 'instagram',
                index: i,
                defaultTitle: `Instagram #${i + 1}`,
                missing: !username,
                hint: 'Заповніть INSTAGRAM_USERNAME, щоб згенерувати посилання.',
                url: username ? `https://ig.me/m/${username}?ref=${encodeURIComponent(ref)}` : '',
            });
        }
    }

    return links;
}

export function EnvironmentPanel({ embedded = false }) {
    const { bot, keys, upsertKey } = useFunnelStore();
    const [selectedChannels, setSelectedChannels] = useState([]);
    const [isApplyingChannels, setIsApplyingChannels] = useState(false);
    const [linkCounts, setLinkCounts] = useState({ telegram: 1, instagram: 1 });
    const [linkMeta, setLinkMeta] = useState({}); // { 'telegram-0': { name: '', desc: '' }, ... }
    const [editingMeta, setEditingMeta] = useState(null); // linkId being edited
    const [tgConnectors, setTgConnectors] = useState([]);
    const [copiedId, setCopiedId] = useState(null);
    const [savingMeta, setSavingMeta] = useState(false);

    const channelsKey = useMemo(
        () => keys.find(k => k.key === CHANNELS_KEY),
        [keys]
    );
    const selectedConnectorId = useMemo(
        () => keys.find(k => k.key === TG_CONNECTOR_KEY)?.value || '',
        [keys]
    );

    // Load channels
    useEffect(() => {
        setSelectedChannels(parseSelectedChannels(channelsKey?.value));
    }, [channelsKey?.value]);

    // Load link counts from persisted key
    useEffect(() => {
        const countsKey = keys.find(k => k.key === LINK_COUNTS_KEY);
        if (countsKey?.value) {
            try {
                const parsed = JSON.parse(countsKey.value);
                if (parsed && typeof parsed === 'object') {
                    setLinkCounts(prev => ({ ...prev, ...parsed }));
                }
            } catch { /* ignore */ }
        }
    }, [keys]);

    // Load link meta from persisted key
    useEffect(() => {
        const metaKey = keys.find(k => k.key === LINK_META_KEY);
        if (metaKey?.value) {
            try {
                const parsed = JSON.parse(metaKey.value);
                if (parsed && typeof parsed === 'object') setLinkMeta(parsed);
            } catch { /* ignore */ }
        }
    }, [keys]);

    // Load Telegram bot connectors
    useEffect(() => {
        api.getSavedConnectors()
            .then(all => setTgConnectors((all || []).filter(c => c.type === 'telegram_bot')))
            .catch(() => {});
    }, []);

    const keyMap = useMemo(() => toKeyMap(keys), [keys]);
    const generatedLinks = useMemo(
        () => buildChannelLinks({ channels: selectedChannels, keyMap, bot, counts: linkCounts }),
        [selectedChannels, keyMap, bot, linkCounts]
    );

    const handleToggleChannel = async (channelId) => {
        const next = selectedChannels.includes(channelId)
            ? selectedChannels.filter(c => c !== channelId)
            : [...selectedChannels, channelId];

        setSelectedChannels(next);
        setIsApplyingChannels(true);

        try {
            await upsertKey(CHANNELS_KEY, JSON.stringify(next), 'Канали запуску воронки', false);

            const existing = new Set(keys.map(k => k.key));
            const required = CHANNEL_PRESETS
                .filter(preset => next.includes(preset.id))
                .flatMap(preset => preset.keys);

            const missing = required.filter(item => !existing.has(item.key));

            for (const item of missing) {
                await upsertKey(item.key, '', item.label, item.isSecret);
            }
        } finally {
            setIsApplyingChannels(false);
        }
    };

    const addGeneratedLink = async (channelId) => {
        const next = { ...linkCounts, [channelId]: (linkCounts[channelId] || 1) + 1 };
        setLinkCounts(next);
        await upsertKey(LINK_COUNTS_KEY, JSON.stringify(next), 'Кількість посилань на воронку', false);
    };

    const removeLink = async (channelId) => {
        const current = linkCounts[channelId] || 1;
        if (current <= 1) return;
        const next = { ...linkCounts, [channelId]: current - 1 };
        setLinkCounts(next);
        await upsertKey(LINK_COUNTS_KEY, JSON.stringify(next), 'Кількість посилань на воронку', false);
        // Clean up meta for removed link
        const removedId = `${channelId}-${current - 1}`;
        const nextMeta = { ...linkMeta };
        delete nextMeta[removedId];
        setLinkMeta(nextMeta);
        await upsertKey(LINK_META_KEY, JSON.stringify(nextMeta), 'Назви та описи посилань', false);
    };

    const copyToClipboard = async (text, linkId) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(linkId);
            setTimeout(() => setCopiedId(null), 1500);
        } catch {
            // no-op
        }
    };

    const saveLinkMeta = useCallback(async (linkId, name, desc) => {
        const nextMeta = { ...linkMeta, [linkId]: { name, desc } };
        setLinkMeta(nextMeta);
        setEditingMeta(null);
        setSavingMeta(true);
        try {
            await upsertKey(LINK_META_KEY, JSON.stringify(nextMeta), 'Назви та описи посилань', false);
        } finally {
            setSavingMeta(false);
        }
    }, [linkMeta, upsertKey]);

    const handleSelectTgConnector = async (connectorId) => {
        await upsertKey(TG_CONNECTOR_KEY, connectorId, 'Telegram Bot Connector', false);
        if (!connectorId) return;
        const connector = tgConnectors.find(c => c.id === connectorId);
        if (!connector) return;

        let username = connector?.config?.username;

        const token = connector?.config?.token;
        if (!username && token && /^\d+:[A-Za-z0-9_-]{20,}$/.test(String(token).trim())) {
            try {
                const res = await fetch(`https://api.telegram.org/bot${String(token).trim()}/getMe`);
                const data = await res.json();
                if (data.ok && data.result?.username) {
                    username = data.result.username;
                    try {
                        await api.updateSavedConnector(connector.id, {
                            config: { ...connector.config, username },
                        });
                        setTgConnectors(prev => prev.map(c => c.id === connector.id
                            ? { ...c, config: { ...c.config, username } }
                            : c));
                    } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
        }

        if (username) {
            const existing = keys.find(k => k.key === 'TELEGRAM_BOT_USERNAME');
            if (!existing?.value) {
                await upsertKey('TELEGRAM_BOT_USERNAME', username, 'Telegram Bot Username', false);
            }
        }
    };

    const webhookInfo = useMemo(
        () => (bot && selectedChannels.includes('webhook') ? buildWebhookInfo(bot) : null),
        [bot, selectedChannels]
    );

    return (
        <div className={embedded
            ? 'h-full flex flex-col overflow-hidden'
            : 'w-72 shrink-0 bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden'}>
            <div className="px-4 py-3 border-b border-gray-800">
                <div className="text-sm font-semibold text-white">Середовища</div>
                <div className="text-xs text-gray-500">Де працює воронка і які канали увімкнені</div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                <div className="bg-gray-900 rounded-lg p-3 border border-gray-800 space-y-2">
                    <div className="text-sm font-medium text-white">Де працює воронка</div>
                    <div className="text-xs text-gray-400">Оберіть 1+ каналів. Потрібні ключі з'являться автоматично.</div>

                    <div className="space-y-1.5 pt-1">
                        {CHANNEL_PRESETS.map(channel => (
                            <div key={channel.id}>
                                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selectedChannels.includes(channel.id)}
                                        onChange={() => handleToggleChannel(channel.id)}
                                        disabled={isApplyingChannels}
                                        className="accent-brand"
                                    />
                                    <span>{channel.label}</span>
                                </label>
                                {/* Telegram connector picker */}
                                {channel.id === 'telegram' && selectedChannels.includes('telegram') && tgConnectors.length > 0 && (
                                    <div className="ml-5 mt-1.5">
                                        <div className="text-[11px] text-gray-400 mb-1">Telegram Bot конектор:</div>
                                        <select
                                            value={selectedConnectorId}
                                            onChange={e => handleSelectTgConnector(e.target.value)}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand"
                                        >
                                            <option value="">— вибрати конектор —</option>
                                            {tgConnectors.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                        {selectedConnectorId && (
                                            <div className="text-[10px] text-emerald-400 mt-1">✓ Токен береться з конектора</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="text-[11px] text-gray-500">
                        {isApplyingChannels
                            ? 'Оновлюю список ключів...'
                            : 'Ключі не видаляються автоматично після зняття чекбоксу, щоб не втратити дані.'}
                    </div>

                    {selectedChannels.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-800 space-y-2">
                            <div className="text-xs text-gray-300 font-medium">Посилання на цю воронку</div>

                            {generatedLinks.map(item => {
                                const meta = linkMeta[item.id] || {};
                                const isEditing = editingMeta === item.id;

                                return (
                                    <div key={item.id} className="bg-gray-950 border border-gray-800 rounded-lg p-2 space-y-1.5">
                                        {/* Title row */}
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="text-[11px] font-medium text-gray-300">
                                                {meta.name || item.defaultTitle}
                                            </span>
                                            <div className="flex gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingMeta(isEditing ? null : item.id)}
                                                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
                                                    title="Редагувати назву та опис"
                                                >
                                                    ✏
                                                </button>
                                                {item.index > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeLink(item.channelId)}
                                                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-red-900/50 text-gray-500 hover:text-red-400 transition-colors"
                                                        title="Видалити це посилання"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Inline meta editor */}
                                        {isEditing && (
                                            <LinkMetaEditor
                                                linkId={item.id}
                                                initial={meta}
                                                onSave={saveLinkMeta}
                                                onCancel={() => setEditingMeta(null)}
                                                saving={savingMeta}
                                            />
                                        )}

                                        {/* Description */}
                                        {!isEditing && meta.desc && (
                                            <div className="text-[10px] text-gray-500">{meta.desc}</div>
                                        )}

                                        {/* URL */}
                                        {item.missing ? (
                                            <div className="text-[11px] text-yellow-400">{item.hint}</div>
                                        ) : (
                                            <>
                                                <a
                                                    href={item.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block text-[11px] text-brand-light hover:text-white break-all font-mono"
                                                >
                                                    {item.url}
                                                </a>
                                                <button
                                                    type="button"
                                                    onClick={() => copyToClipboard(item.url, item.id)}
                                                    className={`text-[11px] px-2 py-1 rounded transition-colors ${copiedId === item.id ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                                                >
                                                    {copiedId === item.id ? '✓ Скопійовано' : 'Копіювати'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                );
                            })}

                            <div className="flex gap-2">
                                {selectedChannels.includes('telegram') && (
                                    <button
                                        type="button"
                                        onClick={() => addGeneratedLink('telegram')}
                                        className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                                    >
                                        + Лінк Telegram
                                    </button>
                                )}
                                {selectedChannels.includes('instagram') && (
                                    <button
                                        type="button"
                                        onClick={() => addGeneratedLink('instagram')}
                                        className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                                    >
                                        + Лінк Instagram
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Webhook info */}
                    {webhookInfo && (
                        <div className="mt-2 pt-2 border-t border-gray-800 space-y-2">
                            <div className="text-xs text-gray-300 font-medium">Webhook URL</div>
                            <div className="bg-gray-950 border border-gray-800 rounded-lg p-2 space-y-1">
                                <div className="text-[10px] text-gray-500">POST запит на:</div>
                                <div className="text-[11px] text-brand-light break-all font-mono">{webhookInfo.startUrl}</div>
                                <div className="text-[10px] text-gray-500 mt-1">{webhookInfo.note}</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function LinkMetaEditor({ linkId, initial, onSave, onCancel, saving }) {
    const [name, setName] = useState(initial.name || '');
    const [desc, setDesc] = useState(initial.desc || '');

    return (
        <div className="space-y-1.5 pt-1 border-t border-gray-800">
            <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Назва посилання (напр. Реклама в каналі)"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand"
            />
            <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="Опис (необов'язково)"
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand resize-none"
            />
            <div className="flex gap-1.5">
                <button
                    type="button"
                    onClick={() => onSave(linkId, name, desc)}
                    disabled={saving}
                    className="flex-1 text-[11px] py-1 rounded bg-brand hover:bg-brand/90 text-white transition-colors disabled:opacity-50"
                >
                    {saving ? '...' : 'Зберегти'}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
