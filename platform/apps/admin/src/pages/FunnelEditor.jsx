import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { useFunnelStore } from '../stores/funnelStore.js';
import { FunnelCanvas } from '../components/funnel/FunnelCanvas.jsx';
import { NodeLibrary } from '../components/funnel/NodeLibrary.jsx';
import { NodeEditor } from '../components/funnel/NodeEditor.jsx';
import { KeysPanel } from '../components/funnel/KeysPanel.jsx';
import { EnvironmentPanel } from '../components/funnel/EnvironmentPanel.jsx';
import { FunnelEditModal } from '../components/funnel/FunnelEditModal.jsx';
import { FunnelTestModal } from '../components/funnel/FunnelTestModal.jsx';
import { api } from '../api/client.js';

function PanelToggle({ side, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`fixed top-16 z-30 flex items-center gap-2 rounded-full border border-gray-800 bg-gray-950/95 px-3 py-2 text-xs text-gray-300 shadow-lg shadow-black/40 hover:bg-gray-900 hover:text-white transition-colors ${side === 'left' ? 'left-3' : 'right-3'}`}
            title={side === 'left' ? 'Відкрити ліву панель' : 'Відкрити праву панель'}
        >
            <span className="text-base leading-none">{side === 'left' ? '☰' : '⚙'}</span>
        </button>
    );
}

function TabButton({ active, children, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${active
                ? 'bg-brand text-white'
                : 'bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-white border border-gray-800'}`}
        >
            {children}
        </button>
    );
}

function TopBar({
    bot,
    isDirty,
    isSaving,
    onSave,
    onExport,
    onImport,
    onBack,
    onEdit,
    onTest,
    onTidy,
    isTidying,
    isTesting,
    missingKeys,
    missingSystemKeys,
}) {
    const importRef = useRef(null);

    const handleImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => onImport(ev.target.result);
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div className="min-h-12 bg-gray-900 border-b border-gray-800 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 shrink-0">
            <button
                onClick={onBack}
                className="text-sm px-2.5 py-1 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 transition-colors shrink-0"
            >
                ← До воронок
            </button>

            {/* Bot info */}
            <div className="flex items-center gap-2 min-w-0 max-w-full sm:max-w-xs">
                <div className="w-6 h-6 shrink-0 bg-brand/20 rounded flex items-center justify-center text-brand-light text-xs font-bold">
                    {bot?.name?.[0] || '?'}
                </div>
                <span className="text-sm font-medium text-white truncate" title={bot?.name}>{bot?.name || '…'}</span>
                <span className="text-xs text-gray-500 font-mono shrink-0">/{bot?.slug}</span>
            </div>

            {isDirty && (
                <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded-full border border-yellow-800 shrink-0">
                    Незбережено
                </span>
            )}

            {missingKeys && missingKeys.length > 0 && (
                <span className="text-xs text-red-400 bg-red-900/30 px-2 py-0.5 rounded-full border border-red-800 flex items-center gap-1.5 shrink-0">
                    <span>⚠</span>
                    <span>Бракує {missingKeys.length} ключів</span>
                </span>
            )}

            {missingSystemKeys && missingSystemKeys.length > 0 && (
                <span className="text-xs text-amber-300 bg-amber-900/30 px-2 py-0.5 rounded-full border border-amber-800 flex items-center gap-1.5 shrink-0">
                    <span>⚠</span>
                    <span>Системні ключі: {missingSystemKeys.length}</span>
                </span>
            )}

            <div className="flex-1 min-w-[1px]" />

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
                <Link
                    to={`/bots/${bot?.id}/sessions`}
                    title="Сесії цієї воронки"
                    className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors shrink-0"
                >
                    💬 Сесії
                </Link>

                <button
                    onClick={() => importRef.current?.click()}
                    className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors shrink-0"
                >
                    📥 Імпорт
                </button>
                <input ref={importRef} type="file" accept=".json" onChange={handleImport} className="hidden" />

                <button
                    onClick={onExport}
                    className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors shrink-0"
                >
                    📤 Експорт
                </button>

                <button
                    onClick={onEdit}
                    title="Редагувати назву та опис"
                    className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors shrink-0"
                >
                    ✏ Редагувати
                </button>

                <button
                    onClick={onTidy}
                    disabled={isTidying}
                    title="Перерахувати позиції нод по сітці (BFS-рядки + branch-колонки, без перетинів)"
                    className="text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                    {isTidying ? '⟳ Впорядковую...' : '🧹 Впорядкувати'}
                </button>

                <button
                    onClick={onTest}
                    disabled={isTesting}
                    title='Запустити тест воронки'
                    className="text-sm px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                    {isTesting ? '⟳ Тестується...' : '🧪 Тест'}
                </button>

                <button
                    onClick={onSave}
                    disabled={isSaving || !isDirty}
                    className="text-sm px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-40 text-white font-medium transition-colors shrink-0"
                >
                    {isSaving ? 'Збереження...' : '💾 Зберегти'}
                </button>
            </div>
        </div>
    );
}

export function FunnelEditor() {
    const { botId } = useParams();
    const navigate = useNavigate();
    const { bot, connectors, nodes, isDirty, isSaving, isLoading, error, selectedNode, keys, loadFunnel, saveFunnel, exportFunnel, importFunnel } = useFunnelStore();

    const startNode = nodes.find(n => n.id === 'start');
    const isWebhookBot = startNode?.data?.trigger === 'webhook';
    const webhookBodySchema = startNode?.data?.bodySchema || '';

    const [isLeftPanelOpen, setLeftPanelOpen] = useState(true);
    const [isRightPanelOpen, setRightPanelOpen] = useState(true);
    const [activeLeftTab, setActiveLeftTab] = useState('nodes'); // 'nodes' | 'keys' | 'env'
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [testModalOpen, setTestModalOpen] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [missingSystemKeys, setMissingSystemKeys] = useState([]);
    const [isCompactLayout, setIsCompactLayout] = useState(false);
    const [isTidying, setIsTidying] = useState(false);

    const handleTidy = async () => {
        if (!bot?.id || isTidying) return;
        setIsTidying(true);
        try {
            await api.autoLayoutFunnel(bot.id);
            await loadFunnel(bot.id); // тягнемо свіжі позиції з БД (ендпоінт вже зберіг)
        } catch (e) {
            console.error('auto-layout failed', e);
        } finally {
            setIsTidying(false);
        }
    };

    useEffect(() => {
        const media = window.matchMedia('(max-width: 1200px)');
        const apply = () => setIsCompactLayout(media.matches);
        apply();
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', apply);
            return () => media.removeEventListener('change', apply);
        }
        media.addListener(apply);
        return () => media.removeListener(apply);
    }, []);

    const openLeftPanel = () => {
        setLeftPanelOpen(true);
        if (isCompactLayout) setRightPanelOpen(false);
    };

    const openRightPanel = () => {
        setRightPanelOpen(true);
        if (isCompactLayout) setLeftPanelOpen(false);
    };

    const loadSystemKeysStatus = async () => {
        try {
            const systemKeys = await api.getSystemKeys();
            const missing = (systemKeys || []).filter((item) => !item.exists).map((item) => item.key);
            setMissingSystemKeys(missing);
        } catch {
            setMissingSystemKeys(['CLAUDE_API_KEY']);
        }
    };

    const handleBack = () => {
        navigate('/funnels');
    };

    const handleOpenTestSession = () => {
        const sessionId = testResult?.sessionId;
        if (!sessionId) return;
        const backToEditor = encodeURIComponent(`/funnel/${botId}`);
        navigate(`/sessions/${sessionId}?back=${backToEditor}`);
    };

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

        return required.filter(k => !keyMap[k]);
    };

    const missingKeys = getRequiredKeys();

    const handleRunTest = async () => {
        // Webhook bots: open modal in JSON-editor mode without auto-starting
        if (isWebhookBot) {
            setTestModalOpen(true);
            setTestResult(null);
            return;
        }

        const localMissing = getRequiredKeys();
        const allMissing = [...localMissing];
        if (missingSystemKeys.length > 0) {
            allMissing.push(...missingSystemKeys);
        }

        if (allMissing.length > 0) {
            setLeftPanelOpen(true);
            setActiveLeftTab('keys');
            setTestModalOpen(true);
            setTestResult({
                ok: false,
                missingKeys: localMissing,
                missingSystemKeys,
                errors: [{
                    step: 'Валідація ключів',
                    message: missingSystemKeys.length > 0
                        ? 'Перед тестом заповніть ключі воронки та системний Claude API key (Налаштування -> Ключі).'
                        : 'Перед тестом заповніть обов\'язкові ключі воронки.',
                }],
            });
            return;
        }

        setTestModalOpen(true);
        setIsTesting(true);
        setTestResult(null);
        try {
            const result = await api.runBotRegression(botId);
            setTestResult({
                ok: true,
                sessionId: result.sessionId,
                finalState: result.finalState,
                historyCount: result.historyCount,
                outputFile: result.outputFile,
                logs: result.logs,
            });
        } catch (err) {
            setTestResult({
                ok: false,
                error: err.message,
                missingKeys: missingKeys,
                errors: [{ step: 'Тест', message: err.message }],
            });
        } finally {
            setIsTesting(false);
        }
    };

    const handleRunWebhookTest = async (body) => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const result = await api.runWebhookTest(botId, body);
            setTestResult({ ok: true, sessionId: result.sessionId, currentState: result.currentState });
        } catch (err) {
            setTestResult({ ok: false, errors: [{ step: 'Webhook POST', message: err.message }] });
        } finally {
            setIsTesting(false);
        }
    };

    const handleSaveEdit = async (form) => {
        setIsSavingEdit(true);
        try {
            // Pass projectId if it changed (null = remove from project)
            const projectId = form.projectId || null;
            const settings = {
                testMode: !!form.testMode,
                testModeAllowedUsers: String(form.testModeAllowedUsers || '')
                    .split(',').map((s) => s.trim()).filter(Boolean),
            };
            await api.updateBot(botId, form.name, form.description, projectId, settings);
            loadFunnel(botId);
            setEditModalOpen(false);
        } catch (e) {
            console.error('Error saving funnel:', e);
        } finally {
            setIsSavingEdit(false);
        }
    };

    useEffect(() => {
        if (botId) loadFunnel(botId);
    }, [botId]);

    useEffect(() => {
        loadSystemKeysStatus();
    }, []);

    useEffect(() => {
        if (selectedNode) openRightPanel();
    }, [selectedNode?.id]);

    if (isLoading) return (
        <div className="flex items-center justify-center h-full">
            <div className="text-gray-400">Завантаження воронки...</div>
        </div>
    );

    if (error) return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-red-400">{error}</div>
            <button onClick={() => navigate(-1)} className="text-sm text-gray-400 hover:text-white">← Назад</button>
        </div>
    );

    return (
        <ReactFlowProvider>
            <div className="flex flex-col h-[calc(100vh-3rem)]">
                <TopBar
                    bot={bot}
                    isDirty={isDirty}
                    isSaving={isSaving}
                    onSave={saveFunnel}
                    onExport={exportFunnel}
                    onImport={importFunnel}
                    onBack={handleBack}
                    onEdit={() => setEditModalOpen(true)}
                    onTest={handleRunTest}
                    onTidy={handleTidy}
                    isTidying={isTidying}
                    isTesting={isTesting}
                    missingKeys={missingKeys}
                    missingSystemKeys={missingSystemKeys}
                />
                <div className="relative flex flex-1 overflow-hidden">
                    {!isLeftPanelOpen && (
                        <PanelToggle side="left" onClick={openLeftPanel} />
                    )}
                    {!isRightPanelOpen && (
                        <PanelToggle side="right" onClick={openRightPanel} />
                    )}

                    {isLeftPanelOpen && (
                        <div className="absolute inset-y-0 left-0 z-20 w-[320px] max-w-[92vw] bg-gray-950 border-r border-gray-800 flex flex-col overflow-hidden shadow-2xl shadow-black/40 xl:static xl:z-auto xl:w-80 xl:max-w-none xl:shadow-none">
                            <div className="px-4 py-3 border-b border-gray-800 flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold text-white">Панель</div>
                                    <div className="text-xs text-gray-500">Ноди, ключі та середовища</div>
                                </div>
                                <button
                                    onClick={() => setLeftPanelOpen(false)}
                                    className="h-8 w-8 rounded-lg border border-gray-800 bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                                    title="Закрити ліву панель"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="px-4 py-3 border-b border-gray-800 space-y-2">
                                <div className="grid grid-cols-3 gap-2">
                                    <TabButton active={activeLeftTab === 'nodes'} onClick={() => setActiveLeftTab('nodes')}>Ноди і конектори</TabButton>
                                    <TabButton active={activeLeftTab === 'keys'} onClick={() => setActiveLeftTab('keys')}>Ключі</TabButton>
                                    <TabButton active={activeLeftTab === 'env'} onClick={() => setActiveLeftTab('env')}>Середовища</TabButton>
                                </div>
                            </div>

                            <div className="flex-1 min-h-0">
                                {activeLeftTab === 'nodes' && <NodeLibrary connectors={connectors} embedded />}
                                {activeLeftTab === 'keys' && <KeysPanel embedded />}
                                {activeLeftTab === 'env' && <EnvironmentPanel embedded />}
                            </div>
                        </div>
                    )}

                    <FunnelCanvas onNodeClick={openRightPanel} />

                    {isRightPanelOpen && (
                        <div className="absolute inset-y-0 right-0 z-20 w-[320px] max-w-[92vw] bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden shadow-2xl shadow-black/40 xl:static xl:z-auto xl:w-80 xl:max-w-none xl:shadow-none">
                            <div className="px-4 py-3 border-b border-gray-800 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    {selectedNode ? (
                                        <>
                                            <div className="text-sm font-semibold text-white truncate">
                                                {selectedNode.data?.label || selectedNode.type}
                                            </div>
                                            <div className="text-xs text-gray-500 font-mono flex items-center gap-1.5">
                                                <span className="text-gray-600">{selectedNode.type}</span>
                                                <span className="text-gray-700">·</span>
                                                <span className="truncate">{selectedNode.id}</span>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="text-sm font-semibold text-white">Панель ноди</div>
                                            <div className="text-xs text-gray-500">Виберіть ноду на полотні</div>
                                        </>
                                    )}
                                </div>
                                <button
                                    onClick={() => setRightPanelOpen(false)}
                                    className="h-8 w-8 shrink-0 rounded-lg border border-gray-800 bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                                    title="Закрити праву панель"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="flex-1 min-h-0 overflow-y-auto">
                                {selectedNode ? (
                                    <NodeEditor embedded onClose={() => setRightPanelOpen(false)} />
                                ) : (
                                    <div className="h-full flex items-center justify-center px-6 text-center">
                                        <div>
                                            <div className="text-sm text-gray-300">Клікни на ноду, щоб відкрити її налаштування</div>
                                            <div className="text-xs text-gray-500 mt-2">З'єднуй ноди — тягни від нижнього handle до верхнього іншої ноди.</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <FunnelEditModal
                    isOpen={editModalOpen}
                    bot={bot}
                    onClose={() => setEditModalOpen(false)}
                    onSave={handleSaveEdit}
                    isSaving={isSavingEdit}
                />

                <FunnelTestModal
                    isOpen={testModalOpen}
                    onClose={() => { setTestModalOpen(false); setTestResult(null); }}
                    isLoading={isTesting}
                    result={testResult}
                    onOpenSession={handleOpenTestSession}
                    isWebhookMode={isWebhookBot}
                    bodySchema={webhookBodySchema}
                    onRunWebhookTest={handleRunWebhookTest}
                />
            </div>
        </ReactFlowProvider>
    );
}
