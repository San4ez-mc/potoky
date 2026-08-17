import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';

async function fetchTgBotInfo(token) {
    if (!token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token.trim())) return null;
    try {
        const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`);
        const data = await res.json();
        if (data.ok) return data.result;
    } catch { /* ignore */ }
    return null;
}

function ConnectorModal({ connector, connectorDefs, onClose, onSaved }) {
    const isEdit = Boolean(connector?.id);
    const initialType = connector?.type || connectorDefs[0]?.type || '';

    const [form, setForm] = useState({
        name: connector?.name || '',
        type: initialType,
        description: connector?.description || '',
        config: connector?.config || {},
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [visibleSecrets, setVisibleSecrets] = useState({});
    const [tgFetchStatus, setTgFetchStatus] = useState(''); // 'loading' | 'ok' | 'error'
    const tgFetchTimer = useRef(null);

    const def = connectorDefs.find((d) => d.type === form.type);
    const fields = def?.schema?.fields || [];

    const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
    const setConfig = (key, value) => setForm((prev) => ({ ...prev, config: { ...prev.config, [key]: value } }));
    const toggleSecretVisibility = (key) => setVisibleSecrets((prev) => ({ ...prev, [key]: !prev[key] }));

    const handleTgTokenChange = (value) => {
        setConfig('token', value);
        setTgFetchStatus('');
        if (tgFetchTimer.current) clearTimeout(tgFetchTimer.current);
        tgFetchTimer.current = setTimeout(async () => {
            if (!value.trim()) return;
            setTgFetchStatus('loading');
            const info = await fetchTgBotInfo(value);
            if (info) {
                setTgFetchStatus('ok');
                setForm((prev) => ({
                    ...prev,
                    name: prev.name || `@${info.username}`,
                    config: { ...prev.config, token: value, username: info.username },
                }));
            } else {
                setTgFetchStatus('error');
            }
        }, 800);
    };

    const save = async () => {
        if (!form.name.trim()) {
            setError('Назва конектора обовʼязкова');
            return;
        }
        if (!form.type) {
            setError('Оберіть тип конектора');
            return;
        }

        setSaving(true);
        setError('');
        try {
            if (isEdit) {
                await api.updateSavedConnector(connector.id, form);
            } else {
                await api.createSavedConnector(form);
            }
            onSaved();
        } catch (err) {
            setError(err.message || 'Не вдалося зберегти конектор');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
                <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                    <h3 className="text-white font-semibold">{isEdit ? 'Редагувати конектор' : 'Додати конектор'}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">Закрити</button>
                </div>

                <div className="p-5 overflow-y-auto space-y-4">
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Назва</label>
                        <input
                            value={form.name}
                            onChange={(e) => setField('name', e.target.value)}
                            placeholder="Наприклад: Sonnet основний"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                        />
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Тип конектора</label>
                        <select
                            value={form.type}
                            onChange={(e) => setField('type', e.target.value)}
                            disabled={isEdit}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60"
                        >
                            {connectorDefs.map((item) => (
                                <option key={item.type} value={item.type}>{item.icon} {item.name}</option>
                            ))}
                        </select>
                        {def?.description && (
                            <p className="text-xs text-gray-500 mt-1">{def.description}</p>
                        )}
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Опис (необовʼязково)</label>
                        <textarea
                            rows={3}
                            value={form.description}
                            onChange={(e) => setField('description', e.target.value)}
                            placeholder="Коротка нотатка"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                        />
                    </div>

                    <div className="pt-2 border-t border-gray-800">
                        <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">Поля типу</div>
                        {fields.length === 0 ? (
                            <div className="text-sm text-gray-500">Для цього типу не задано полів.</div>
                        ) : (
                            <div className="space-y-3">
                                {fields.map((field) => (
                                    <div key={field.key}>
                                        <label className="text-xs text-gray-400 block mb-1">{field.label}</label>
                                        {field.multiline ? (
                                            <div className="relative">
                                                <textarea
                                                    rows={4}
                                                    value={form.config[field.key] || ''}
                                                    onChange={(e) => setConfig(field.key, e.target.value)}
                                                    placeholder={field.placeholder || ''}
                                                    style={field.secret && !visibleSecrets[field.key] ? { WebkitTextSecurity: 'disc' } : undefined}
                                                    className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white font-mono ${field.secret ? 'pr-10' : ''}`}
                                                />

                                                {field.secret && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSecretVisibility(field.key)}
                                                        className="absolute top-2 right-2 text-gray-400 hover:text-white"
                                                        title={visibleSecrets[field.key] ? 'Сховати значення' : 'Показати значення'}
                                                        aria-label={visibleSecrets[field.key] ? 'Сховати значення' : 'Показати значення'}
                                                    >
                                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                                                            <circle cx="12" cy="12" r="3" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <input
                                                    type={field.secret && !visibleSecrets[field.key] ? 'password' : 'text'}
                                                    value={form.config[field.key] || ''}
                                                    onChange={(e) => {
                                                        if (form.type === 'telegram_bot' && field.key === 'token') {
                                                            handleTgTokenChange(e.target.value);
                                                        } else {
                                                            setConfig(field.key, e.target.value);
                                                        }
                                                    }}
                                                    placeholder={field.placeholder || ''}
                                                    className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono ${field.secret ? 'pr-10' : ''}`}
                                                />
                                                {form.type === 'telegram_bot' && field.key === 'token' && tgFetchStatus && (
                                                    <span className={`absolute left-3 -bottom-5 text-xs ${tgFetchStatus === 'ok' ? 'text-green-400' : tgFetchStatus === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
                                                        {tgFetchStatus === 'loading' && '⏳ Перевірка токена...'}
                                                        {tgFetchStatus === 'ok' && `✅ Бот: @${form.config.username}`}
                                                        {tgFetchStatus === 'error' && '❌ Токен недійсний'}
                                                    </span>
                                                )}
                                                {field.secret && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSecretVisibility(field.key)}
                                                        className="absolute top-1/2 -translate-y-1/2 right-2 text-gray-400 hover:text-white"
                                                        title={visibleSecrets[field.key] ? 'Сховати значення' : 'Показати значення'}
                                                        aria-label={visibleSecrets[field.key] ? 'Сховати значення' : 'Показати значення'}
                                                    >
                                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                                                            <circle cx="12" cy="12" r="3" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded px-3 py-2">{error}</div>}
                </div>

                <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-2 text-sm text-gray-300 hover:text-white">Скасувати</button>
                    <button
                        onClick={save}
                        disabled={saving}
                        className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white"
                    >
                        {saving ? 'Збереження...' : 'Зберегти'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function Connectors() {
    const [activeTab, setActiveTab] = useState('types');
    const [connectorDefs, setConnectorDefs] = useState([]);
    const [savedConnectors, setSavedConnectors] = useState([]);
    const [loading, setLoading] = useState(false);
    const [modalConnector, setModalConnector] = useState(undefined);

    const load = async () => {
        setLoading(true);
        try {
            const [defsRes, savedRes] = await Promise.allSettled([
                api.getConnectors(),
                api.getSavedConnectors(),
            ]);
            setConnectorDefs(defsRes.status === 'fulfilled' ? (Array.isArray(defsRes.value) ? defsRes.value : (defsRes.value?.data || [])) : []);
            setSavedConnectors(savedRes.status === 'fulfilled' ? (Array.isArray(savedRes.value) ? savedRes.value : (savedRes.value?.data || [])) : []);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const byType = useMemo(() => {
        return savedConnectors.reduce((acc, item) => {
            if (!acc[item.type]) acc[item.type] = [];
            acc[item.type].push(item);
            return acc;
        }, {});
    }, [savedConnectors]);

    const deleteOne = async (item) => {
        if (!window.confirm(`Видалити конектор "${item.name}"?`)) return;
        await api.deleteSavedConnector(item.id);
        await load();
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-5">
            <div>
                <h1 className="text-2xl font-bold text-white">Конектори</h1>
                <p className="text-sm text-gray-400 mt-1">
                    Тип конектора — це шаблон інтеграції. Збережений конектор — це ваш екземпляр типу з власними ключами.
                </p>
            </div>

            <div className="flex items-center gap-2 border-b border-gray-800">
                <button
                    onClick={() => setActiveTab('types')}
                    className={`px-4 py-2 text-sm border-b-2 -mb-px ${activeTab === 'types' ? 'border-blue-500 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
                >
                    Типи конекторів
                </button>
                <button
                    onClick={() => setActiveTab('mine')}
                    className={`px-4 py-2 text-sm border-b-2 -mb-px ${activeTab === 'mine' ? 'border-blue-500 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
                >
                    Мої конектори
                </button>
            </div>

            {activeTab === 'types' && (
                <div className="space-y-3">
                    <p className="text-sm text-gray-500">Системні шаблони — описують як підключитися до сервісу.</p>
                    {loading ? (
                        <div className="text-gray-400">Завантаження...</div>
                    ) : connectorDefs.length === 0 ? (
                        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 text-sm text-gray-400">
                            Немає типів конекторів. Запустіть seed: <span className="font-mono">yarn seed:connector-defs</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {connectorDefs.map((def) => (
                                <div key={def.type} className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex flex-col">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl">{def.icon || '🔌'}</span>
                                        <div className="text-white font-semibold">{def.name}</div>
                                    </div>
                                    <div className="text-xs text-gray-500 font-mono mt-1">{def.type}</div>
                                    <div className="text-sm text-gray-400 mt-2">{def.description || 'Без опису'}</div>
                                    <div className="text-xs text-gray-600 mt-2">
                                        Поля: {(def.schema?.fields || []).map((f) => f.label).join(', ') || 'немає'}
                                    </div>
                                    <button
                                        onClick={() => setModalConnector({ type: def.type })}
                                        className="mt-3 px-3 py-1.5 text-xs rounded border border-blue-800 text-blue-300 hover:bg-blue-900/30"
                                    >
                                        + Зберегти
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'mine' && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-500">Екземпляри з заповненими ключами.</p>
                        <button
                            onClick={() => setModalConnector(null)}
                            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            + Додати конектор
                        </button>
                    </div>

                    {loading ? (
                        <div className="text-gray-400">Завантаження...</div>
                    ) : savedConnectors.length === 0 ? (
                        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 text-center text-gray-500">
                            Ще немає збережених конекторів.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {connectorDefs.map((def) => {
                                const items = byType[def.type] || [];
                                if (items.length === 0) return null;
                                return (
                                    <div key={def.type}>
                                        <div className="text-sm text-gray-400 mb-2 flex items-center gap-2">
                                            <span>{def.icon || '🔌'}</span>
                                            <span>{def.name}</span>
                                            <span className="text-xs text-gray-600">({items.length})</span>
                                        </div>
                                        <div className="space-y-2">
                                            {items.map((item) => (
                                                <div key={item.id} className="bg-gray-900 border border-gray-700 rounded-lg p-3 flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="text-white font-medium">{item.name}</div>
                                                        <div className="text-xs text-gray-500 mt-1">Тип: {def.name} · {item.isActive ? 'Активний' : 'Неактивний'}</div>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => setModalConnector(item)}
                                                            className="px-3 py-1 text-xs rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
                                                        >
                                                            Редагувати
                                                        </button>
                                                        <button
                                                            onClick={() => deleteOne(item)}
                                                            className="px-3 py-1 text-xs rounded border border-red-800 text-red-400 hover:bg-red-900/30"
                                                        >
                                                            Видалити
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <MicroservicesBlock />

            {(modalConnector !== undefined) && (
                <ConnectorModal
                    connector={modalConnector}
                    connectorDefs={connectorDefs}
                    onClose={() => setModalConnector(undefined)}
                    onSaved={() => {
                        setModalConnector(undefined);
                        load();
                    }}
                />
            )}
        </div>
    );
}

// ─── Довідник мікросервісів (інформативно) ────────────────────────────────────
const MICROSERVICES = [
    {
        name: 'browser-agent', status: 'деплой у процесі',
        address: 'http://127.0.0.1:8091 (внутрішній)', auth: 'заголовок X-Agent-Secret',
        purpose: 'Веб-автоматизація. ДІЇ: розміщення замовлень у CRM постачальників (browser-use + Playwright, record/replay + ШІ-фолбек, dry-run зі скрін-апрувом). ЧИТАННЯ: парсинг сторінок / соц-метрик (curl-impersonate → markdown, економія токенів).',
        endpoints: [
            { m: 'GET', p: '/health', d: 'пінг + чи зайнятий браузер' },
            { m: 'POST', p: '/replay', d: 'детермінований прогін збереженого сценарію (0 токенів)' },
            { m: 'POST', p: '/agent', d: 'ШІ веде браузер, СТОП перед submit; повертає скрін + чернетку сценарію' },
            { m: 'POST', p: '/read', d: 'читання сторінки → markdown/text/json' },
        ],
        exReq: 'POST /read\nX-Agent-Secret: ***\n{ "url": "https://brewdrop.in.ua/p/123", "mode": "markdown", "render_js": false }',
        exRes: '{ "ok": true, "via": "curl_cffi:200", "mode": "markdown", "content": "# Товар…\\nЦіна: 250 грн…" }',
    },
    {
        name: 'agent-runner', status: 'планується (ТЗ)',
        address: 'http://127.0.0.1:3015 (внутрішній)', auth: 'внутрішній ключ',
        purpose: 'Агентна інфраструктура: виконує багатокрокові agentic-задачі (agentic loop через Anthropic Tool Runner) з реєстром дозволених інструментів (allowlist, закриває SSRF). Async-джоби, роутинг моделей (Haiku — оркестрація, Sonnet/Opus — reasoning). User-facing укр. контент НЕ генерує.',
        endpoints: [
            { m: 'POST', p: '/v1/jobs', d: 'поставити задачу → { job_id, status:"queued" } (миттєво)' },
            { m: 'GET', p: '/v1/jobs/:id', d: 'статус + result + tool_calls_history' },
        ],
        exReq: 'POST /v1/jobs\n{ "task": "…", "tools": ["query_vector"], "model": "claude-haiku-4-5", "maxIterations": 8, "callback_url": "…" }',
        exRes: '{ "job_id": "…", "status": "queued" }  →  GET →  { "status":"done", "iterations_used":3, "result":{…} }',
    },
    {
        name: 'image-processor', status: 'online', address: 'http://127.0.0.1:3001 (pm2)', auth: '—',
        purpose: 'Обробка зображень для контент-воронок: видалення фону (@imgly), композитинг та накладання тексту (sharp + SVG, без Puppeteer).',
        endpoints: [
            { m: 'POST', p: '/remove-bg', d: 'видалити фон → PNG з прозорістю' },
            { m: 'POST', p: '/overlay-text', d: 'накласти заголовок/підпис зі стилем → PNG' },
        ],
        exReq: 'POST /remove-bg\n{ "imageUrl": "https://…jpg", "outputFormat": "png" }',
        exRes: 'Content-Type: image/png (бінарний)  або  { "url": "https://cdn…/result.png" }',
    },
    {
        name: 'slide-builder', status: 'online', address: 'http://127.0.0.1:3002 (pm2)', auth: '—',
        purpose: 'Рендер HTML-шаблонів у PNG через Puppeteer: брендовані пости/stories, панорама для каруселі (з нарізкою), обкладинки.',
        endpoints: [
            { m: 'POST', p: '/render/story', d: 'пост/stories 1080×1350 → PNG' },
            { m: 'POST', p: '/render/panorama', d: 'широке полотно каруселі → PNG' },
            { m: 'POST', p: '/slice', d: 'нарізати панораму на N слайдів' },
            { m: 'POST', p: '/render/cover', d: 'обкладинка (thumbnail + заголовок)' },
        ],
        exReq: 'POST /render/story\n{ "title": "Як зекономити 10 год/тиж", "brandHandle": "@biz", "backgroundImageUrl": "…", "silhouetteImageUrl": "…", "brandColor": "#6C63FF", "template": "default" }',
        exRes: 'Content-Type: image/png — 1080×1350',
    },
    {
        name: 'video-processor', status: 'online', address: 'http://127.0.0.1:3003 (pm2)', auth: '—',
        purpose: 'Відеообробка через FFmpeg: витяг аудіо, розумний монтаж (вирізання пауз/слів-паразитів), запікання субтитрів, thumbnail, адаптація під платформи.',
        endpoints: [
            { m: 'POST', p: '/extract-audio', d: 'аудіодоріжка (mp3/wav) — для Whisper' },
            { m: 'POST', p: '/smart-cut', d: 'вирізати сегменти й склеїти' },
            { m: 'POST', p: '/burn-subtitles', d: 'запекти субтитри у відео' },
            { m: 'POST', p: '/thumbnail', d: 'кадр-обкладинка' },
            { m: 'POST', p: '/adapt-platform', d: 'формати під IG/TikTok/YouTube' },
        ],
        exReq: 'POST /extract-audio\n{ "videoUrl": "https://…mp4", "format": "mp3", "sampleRate": 16000 }',
        exRes: '{ "audioUrl": "https://cdn…/audio.mp3", "durationSec": 142.5 }',
    },
    {
        name: 'remotion-renderer', status: 'online', address: 'http://127.0.0.1:3004 (pm2)', auth: '—',
        purpose: 'Рендер анімованих karaoke-субтитрів (підсвічування слова-по-слову) через Remotion (React + Chrome + FFmpeg). Потребує кілька ядер.',
        endpoints: [
            { m: 'POST', p: '/render', d: 'відео + transcript(words) + style → mp4 (+callbackUrl)' },
        ],
        exReq: 'POST /render\n{ "videoUrl": "…", "transcript": { "words": [{ "word":"Привіт", "start":0.12, "end":0.55 }] }, "style": { "position":"bottom", "wordsPerLine":3 }, "callbackUrl": "…" }',
        exRes: '{ "ok": true, "videoUrl": "https://cdn…/out.mp4" }  (або POST на callbackUrl)',
    },
    {
        name: 'notebooklm-service', status: 'online', address: 'на сервері (pm2, Python)', auth: '—',
        purpose: 'Генерація NotebookLM-контенту (Python-сервіс) для контент-воронок.',
        endpoints: [],
        exReq: '', exRes: '',
    },
];

function MicroservicesBlock() {
    return (
        <div className="mt-10 border-t border-gray-800 pt-6">
            <h2 className="text-lg font-semibold text-white mb-1">🧩 Мікросервіси</h2>
            <p className="text-xs text-gray-500 mb-4">Довідник наших сервісів: адреси, що роблять, приклади запитів. Інформативно.</p>
            <div className="grid gap-3 md:grid-cols-2">
                {MICROSERVICES.map((s) => (
                    <div key={s.name} className="border border-gray-700 rounded-xl p-4 bg-gray-900">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-base">🧩</span>
                            <span className="text-white font-medium">{s.name}</span>
                            {s.status && (
                                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
                                    s.status === 'online' ? 'bg-emerald-900/40 text-emerald-300'
                                    : s.status.includes('процес') ? 'bg-amber-900/40 text-amber-300'
                                    : 'bg-gray-800 text-gray-400'}`}>{s.status}</span>
                            )}
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono mb-1">{s.address}</div>
                        {s.auth && s.auth !== '—' && <div className="text-[11px] text-gray-500 mb-1">🔑 {s.auth}</div>}
                        <div className="text-xs text-gray-300 mb-2">{s.purpose}</div>
                        {s.endpoints.length > 0 && (
                            <div className="space-y-0.5 mb-2">
                                {s.endpoints.map((e) => (
                                    <div key={e.p} className="text-[11px] flex gap-2">
                                        <span className="font-mono text-emerald-400 w-10 shrink-0">{e.m}</span>
                                        <span className="font-mono text-sky-300 w-24 shrink-0">{e.p}</span>
                                        <span className="text-gray-500">{e.d}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {s.exReq && (
                            <details className="mt-1">
                                <summary className="text-[11px] text-brand-light cursor-pointer">приклад запиту/відповіді</summary>
                                <div className="text-[10px] text-gray-500 mt-1">Запит:</div>
                                <pre className="text-[10px] text-gray-300 font-mono bg-gray-950 rounded p-2 overflow-x-auto whitespace-pre-wrap">{s.exReq}</pre>
                                <div className="text-[10px] text-gray-500 mt-1">Відповідь:</div>
                                <pre className="text-[10px] text-gray-300 font-mono bg-gray-950 rounded p-2 overflow-x-auto whitespace-pre-wrap">{s.exRes}</pre>
                            </details>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
