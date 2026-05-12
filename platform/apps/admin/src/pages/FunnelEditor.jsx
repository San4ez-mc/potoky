import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { useFunnelStore } from '../stores/funnelStore.js';
import { FunnelCanvas } from '../components/funnel/FunnelCanvas.jsx';
import { NodeLibrary } from '../components/funnel/NodeLibrary.jsx';
import { NodeEditor } from '../components/funnel/NodeEditor.jsx';
import { KeysPanel } from '../components/funnel/KeysPanel.jsx';

function TopBar({ bot, isDirty, isSaving, onSave, onExport, onImport, onBack }) {
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
        <div className="h-12 bg-gray-900 border-b border-gray-800 flex items-center gap-3 px-4 shrink-0">
            <button
                onClick={onBack}
                className="text-sm px-2.5 py-1 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
                ← До воронок
            </button>

            {/* Bot info */}
            <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-brand/20 rounded flex items-center justify-center text-brand-light text-xs font-bold">
                    {bot?.name?.[0] || '?'}
                </div>
                <span className="text-sm font-medium text-white">{bot?.name || '…'}</span>
                <span className="text-xs text-gray-500 font-mono">/{bot?.slug}</span>
            </div>

            {isDirty && (
                <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded-full border border-yellow-800">
                    Незбережено
                </span>
            )}

            <div className="flex-1" />

            {/* Actions */}
            <button
                onClick={() => importRef.current?.click()}
                className="text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
            >
                📥 Імпорт
            </button>
            <input ref={importRef} type="file" accept=".json" onChange={handleImport} className="hidden" />

            <button
                onClick={onExport}
                className="text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
            >
                📤 Експорт
            </button>

            <button
                onClick={onSave}
                disabled={isSaving || !isDirty}
                className="text-sm px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-40 text-white font-medium transition-colors"
            >
                {isSaving ? 'Збереження...' : '💾 Зберегти'}
            </button>
        </div>
    );
}

export function FunnelEditor() {
    const { botId } = useParams();
    const navigate = useNavigate();
    const { bot, connectors, isDirty, isSaving, isLoading, error, selectedNode, loadFunnel, saveFunnel, exportFunnel, importFunnel } = useFunnelStore();

    const [rightPanel, setRightPanel] = useState('keys'); // 'keys' | 'node'

    const handleBack = () => {
        navigate('/funnels');
    };

    useEffect(() => {
        if (botId) loadFunnel(botId);
    }, [botId]);

    // Switch right panel based on selection
    useEffect(() => {
        setRightPanel(selectedNode ? 'node' : 'keys');
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
            <div className="flex flex-col h-screen">
                <TopBar
                    bot={bot}
                    isDirty={isDirty}
                    isSaving={isSaving}
                    onSave={saveFunnel}
                    onExport={exportFunnel}
                    onImport={importFunnel}
                    onBack={handleBack}
                />
                <div className="flex flex-1 overflow-hidden">
                    {/* Left: Node library */}
                    <NodeLibrary connectors={connectors} />

                    {/* Center: Canvas */}
                    <FunnelCanvas />

                    {/* Right: Keys or Node editor */}
                    {rightPanel === 'node' && selectedNode ? <NodeEditor /> : <KeysPanel />}
                </div>
            </div>
        </ReactFlowProvider>
    );
}
