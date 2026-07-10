import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useFunnelStore } from '../../stores/funnelStore.js';
import { api } from '../../api/client.js';

const CHANNELS_KEY = 'FUNNEL_CHANNELS';
const TG_CONNECTOR_KEY = 'TELEGRAM_CONNECTOR_ID';

const CHANNEL_PRESETS = [
    { id: 'telegram', label: 'Telegram бот', keys: [{ key: 'TELEGRAM_BOT_USERNAME', label: 'Telegram Bot Username', isSecret: false }] },
    {
        id: 'instagram', label: 'Instagram',
        keys: [
            { key: 'INSTAGRAM_ACCESS_TOKEN', label: 'Instagram Access Token', isSecret: true },
            { key: 'INSTAGRAM_APP_SECRET', label: 'Instagram App Secret', isSecret: true },
            { key: 'INSTAGRAM_VERIFY_TOKEN', label: 'Instagram Verify Token', isSecret: true },
            { key: 'INSTAGRAM_BUSINESS_ID', label: 'Instagram Business ID', isSecret: false },
            { key: 'INSTAGRAM_USERNAME', label: 'Instagram Username (without @)', isSecret: false },
        ],
    },
    { id: 'webhook', label: 'Webhook / API (запит ззовні)', keys: [] },
];

// Networks you can label a deep link with (the link itself is always a Telegram
// deep link — the network is just where you'll distribute it, for analytics).
export const NETWORKS = [
    { id: 'threads', label: 'Threads' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'telegram', label: 'Telegram' },
    { id: 'tiktok', label: 'TikTok' },
    { id: 'linkedin', label: 'LinkedIn' },
    { id: 'youtube', label: 'YouTube' },
    { id: 'facebook', label: 'Facebook' },
    { id: 'x', label: 'X (Twitter)' },
    { id: 'other', label: 'Інше' },
];
export const netLabel = (id) => NETWORKS.find(n => n.id === id)?.label || id || 'Інше';

function normalizeUsername(raw) {
    if (!raw) return '';
    return String(raw).trim().replace(/^@/, '');
}

function parseSelectedChannels(rawValue) {
    if (!rawValue) return [];
    try { const parsed = JSON.parse(rawValue); if (Array.isArray(parsed)) return parsed.filter(Boolean); } catch { /* csv */ }
    return String(rawValue).split(',').map(v => v.trim()).filter(Boolean);
}

function buildWebhookInfo(bot) {
    const base = window.location.origin.replace(':5173', '').replace(':5174', '');
    const webhookBase = base.includes('localhost') ? 'https://flows.fineko.space' : base;
    return { startUrl: `${webhookBase}/webhook/telegram/${bot.id}`, note: 'Або запуск через POST-запит на цей URL з тілом у форматі Telegram update.' };
}

export function EnvironmentPanel({ embedded = false }) {
    const { bot, keys, upsertKey } = useFunnelStore();
    const [selectedChannels, setSelectedChannels] = useState([]);
    const [isApplyingChannels, setIsApplyingChannels] = useState(false);
    const [tgConnectors, setTgConnectors] = useState([]);
    const [copiedId, setCopiedId] = useState(null);

    // DB-backed channel links
    const [channelLinks, setChannelLinks] = useState([]);
    const [loadingLinks, setLoadingLinks] = useState(false);
    const [creating, setCreating] = useState(false);

    const channelsKey = useMemo(() => keys.find(k => k.key === CHANNELS_KEY), [keys]);
    const selectedConnectorId = useMemo(() => keys.find(k => k.key === TG_CONNECTOR_KEY)?.value || '', [keys]);
    const botUsername = useMemo(() => normalizeUsername(keys.find(k => k.key === 'TELEGRAM_BOT_USERNAME')?.value), [keys]);

    useEffect(() => { setSelectedChannels(parseSelectedChannels(channelsKey?.value)); }, [channelsKey?.value]);
    useEffect(() => {
        api.getSavedConnectors().then(all => setTgConnectors((all || []).filter(c => c.type === 'telegram_bot'))).catch(() => {});
    }, []);

    const loadLinks = useCallback(() => {
        if (!bot?.id) return;
        setLoadingLinks(true);
        api.getChannelLinks(bot.id)
            .then(r => setChannelLinks(r?.channels || []))
            .catch(() => setChannelLinks([]))
            .finally(() => setLoadingLinks(false));
    }, [bot?.id]);
    useEffect(() => { loadLinks(); }, [loadLinks]);

    const keyMap = useMemo(() => keys.reduce((a, k) => { a[k.key] = k.value; return a; }, {}), [keys]);

    const handleToggleChannel = async (channelId) => {
        const next = selectedChannels.includes(channelId) ? selectedChannels.filter(c => c !== channelId) : [...selectedChannels, channelId];
        setSelectedChannels(next);
        setIsApplyingChannels(true);
        try {
            await upsertKey(CHANNELS_KEY, JSON.stringify(next), 'Канали запуску воронки', false);
            const existing = new Set(keys.map(k => k.key));
            const required = CHANNEL_PRESETS.filter(p => next.includes(p.id)).flatMap(p => p.keys);
            for (const item of required.filter(i => !existing.has(i.key))) await upsertKey(item.key, '', item.label, item.isSecret);
        } finally { setIsApplyingChannels(false); }
    };

    const createLink = async ({ platform, name, description }) => {
        if (!bot) return;
        setCreating(false);
        await api.createChannelLink({
            botId: bot.id, funnelSlug: bot.slug || bot.id, botUsername,
            projectId: bot.projectId || null, platform, name, description,
        });
        loadLinks();
    };

    const deleteLink = async (id) => {
        if (!window.confirm('Видалити це посилання? Пости, створені під ним, лишаться робочими.')) return;
        await api.deleteChannelLink(id);
        loadLinks();
    };

    const copyToClipboard = async (text, id) => {
        try { await navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); } catch { /* no-op */ }
    };

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
                    try { await api.updateSavedConnector(connector.id, { config: { ...connector.config, username } });
                        setTgConnectors(prev => prev.map(c => c.id === connector.id ? { ...c, config: { ...c.config, username } } : c)); } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
        }
        if (username && !keys.find(k => k.key === 'TELEGRAM_BOT_USERNAME')?.value) {
            await upsertKey('TELEGRAM_BOT_USERNAME', username, 'Telegram Bot Username', false);
        }
    };

    const webhookInfo = useMemo(() => (bot && selectedChannels.includes('webhook') ? buildWebhookInfo(bot) : null), [bot, selectedChannels]);

    return (
        <div className={embedded ? 'h-full flex flex-col overflow-hidden' : 'w-72 shrink-0 bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden'}>
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
                                    <input type="checkbox" checked={selectedChannels.includes(channel.id)} onChange={() => handleToggleChannel(channel.id)} disabled={isApplyingChannels} className="accent-brand" />
                                    <span>{channel.label}</span>
                                </label>
                                {channel.id === 'telegram' && selectedChannels.includes('telegram') && tgConnectors.length > 0 && (
                                    <div className="ml-5 mt-1.5">
                                        <div className="text-[11px] text-gray-400 mb-1">Telegram Bot конектор:</div>
                                        <select value={selectedConnectorId} onChange={e => handleSelectTgConnector(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand">
                                            <option value="">— вибрати конектор —</option>
                                            {tgConnectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                        {selectedConnectorId && <div className="text-[10px] text-emerald-400 mt-1">✓ Токен береться з конектора</div>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Persistent deep links (DB-backed) */}
                    <div className="mt-2 pt-2 border-t border-gray-800 space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="text-xs text-gray-300 font-medium">Посилання на цю воронку</div>
                            {loadingLinks && <span className="text-[10px] text-gray-600">завантаження…</span>}
                        </div>
                        <div className="text-[10px] text-gray-500">Deep-links зберігаються в базі й не зникають. «Мережа» — це де ти поширюєш посилання (для аналітики). Пости під цим лінком отримують код <span className="font-mono">…_номерпоста</span>.</div>

                        {!botUsername && (
                            <div className="text-[11px] text-yellow-400">Заповни TELEGRAM_BOT_USERNAME (обери Telegram-конектор вище), щоб створювати посилання.</div>
                        )}

                        {botUsername && bot?.slug && (
                            <div className="bg-gray-950 border border-gray-800 rounded-lg p-2 space-y-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 shrink-0">Основне</span>
                                    <span className="text-[11px] font-medium text-gray-300">Основне посилання воронки</span>
                                </div>
                                <a href={`https://t.me/${botUsername}?start=${bot.slug}`} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-brand-light hover:text-white break-all font-mono">{`https://t.me/${botUsername}?start=${bot.slug}`}</a>
                                <button type="button" onClick={() => copyToClipboard(`https://t.me/${botUsername}?start=${bot.slug}`, 'base')} className={`text-[11px] px-2 py-1 rounded transition-colors ${copiedId === 'base' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}>
                                    {copiedId === 'base' ? '✓ Скопійовано' : 'Копіювати'}
                                </button>
                            </div>
                        )}

                        {channelLinks.map(link => (
                            <ChannelLinkCard key={link.id} link={link} copiedId={copiedId} onCopy={copyToClipboard} onDelete={deleteLink} />
                        ))}

                        {creating ? (
                            <NewLinkForm onCreate={createLink} onCancel={() => setCreating(false)} />
                        ) : botUsername ? (
                            <button type="button" onClick={() => setCreating(true)} className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors">
                                + Нове посилання
                            </button>
                        ) : null}
                    </div>

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

function ChannelLinkCard({ link, copiedId, onCopy, onDelete }) {
    return (
        <div className="bg-gray-950 border border-gray-800 rounded-lg p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/20 text-brand-light shrink-0">{netLabel(link.platform)}</span>
                    <span className="text-[11px] font-medium text-gray-300 truncate">{link.name || 'Без назви'}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-gray-500" title="всього переходів (канал + пости)">👆 {link.totalClicks}</span>
                    <button type="button" onClick={() => onDelete(link.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-red-900/50 text-gray-500 hover:text-red-400 transition-colors" title="Видалити">✕</button>
                </div>
            </div>
            {link.description && <div className="text-[10px] text-gray-500">{link.description}</div>}
            <div className="text-[10px] text-gray-600">прямих: {link.directClicks} · з постів: {link.postClicks} ({link.postLinks} лінків)</div>
            {link.url && (
                <>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-brand-light hover:text-white break-all font-mono">{link.url}</a>
                    <button type="button" onClick={() => onCopy(link.url, link.id)} className={`text-[11px] px-2 py-1 rounded transition-colors ${copiedId === link.id ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}>
                        {copiedId === link.id ? '✓ Скопійовано' : 'Копіювати'}
                    </button>
                </>
            )}
        </div>
    );
}

function NewLinkForm({ onCreate, onCancel }) {
    const [platform, setPlatform] = useState('threads');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        setSaving(true);
        try { await onCreate({ platform, name: name.trim(), description: description.trim() }); }
        finally { setSaving(false); }
    };

    return (
        <div className="bg-gray-950 border border-gray-800 rounded-lg p-2 space-y-1.5">
            <select value={platform} onChange={e => setPlatform(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand">
                {NETWORKS.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Назва (напр. Threads — біо)" className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand" />
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Опис (необов'язково)" rows={2} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand resize-none" />
            <div className="flex gap-1.5">
                <button type="button" onClick={submit} disabled={saving} className="flex-1 text-[11px] py-1 rounded bg-brand hover:bg-brand/90 text-white transition-colors disabled:opacity-50">{saving ? '...' : 'Створити'}</button>
                <button type="button" onClick={onCancel} className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors">✕</button>
            </div>
        </div>
    );
}
