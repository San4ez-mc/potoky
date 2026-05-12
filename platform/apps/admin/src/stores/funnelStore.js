import { create } from 'zustand';
import { api } from '../api/client.js';

export const useFunnelStore = create((set, get) => ({
    // State
    bot: null,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    keys: [],
    connectors: [],
    selectedNode: null,
    isDirty: false,
    isSaving: false,
    isLoading: false,
    error: null,

    // Load funnel
    loadFunnel: async (botId) => {
        set({ isLoading: true, error: null });
        try {
            const [data, connectors] = await Promise.all([
                api.getFunnel(botId),
                api.getConnectors(),
            ]);
            set({
                bot: data.bot,
                nodes: data.flow.nodes || [],
                edges: data.flow.edges || [],
                viewport: data.flow.viewport || { x: 0, y: 0, zoom: 1 },
                keys: data.keys || [],
                connectors,
                isLoading: false,
                isDirty: false,
            });
        } catch (e) {
            set({ error: e.message, isLoading: false });
        }
    },

    // React Flow handlers
    setNodes: (nodes) => set((state) => {
        const nextNodes = typeof nodes === 'function' ? nodes(state.nodes) : nodes;
        const selectedId = state.selectedNode?.id;
        const nextSelected = selectedId ? (nextNodes.find(n => n.id === selectedId) || null) : null;
        return { nodes: nextNodes, selectedNode: nextSelected, isDirty: true };
    }),
    setEdges: (edges) => set({ edges: typeof edges === 'function' ? edges(get().edges) : edges, isDirty: true }),
    setViewport: (viewport) => set({ viewport }),

    // Node selection
    selectNode: (nodeId) => {
        const node = get().nodes.find(n => n.id === nodeId) || null;
        set({ selectedNode: node });
    },
    clearSelection: () => set({ selectedNode: null }),

    // Delete node with all connected edges
    deleteNode: (nodeId) => {
        set((state) => ({
            isDirty: true,
            nodes: state.nodes.filter(n => n.id !== nodeId),
            edges: state.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
            selectedNode: state.selectedNode?.id === nodeId ? null : state.selectedNode,
        }));
    },

    // Update node data (prompts, code, config)
    updateNodeData: (nodeId, patch) => {
        set(state => ({
            isDirty: true,
            selectedNode: state.selectedNode?.id === nodeId
                ? { ...state.selectedNode, data: { ...state.selectedNode.data, ...patch } }
                : state.selectedNode,
            nodes: state.nodes.map(n =>
                n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
            ),
        }));
    },

    // Save
    saveFunnel: async () => {
        const { bot, nodes, edges, viewport } = get();
        if (!bot) return;
        set({ isSaving: true });
        try {
            await api.saveFunnel(bot.id, nodes, edges, viewport);
            set({ isDirty: false, isSaving: false });
        } catch (e) {
            set({ error: e.message, isSaving: false });
        }
    },

    // Export
    exportFunnel: async () => {
        const { bot } = get();
        if (!bot) return;
        const res = await api.exportFunnel(bot.id);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${bot.slug}-funnel.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // Import
    importFunnel: async (jsonText) => {
        const { bot } = get();
        if (!bot) return;
        const parsed = JSON.parse(jsonText);
        await api.importFunnel(bot.id, parsed.flow || parsed);
        await get().loadFunnel(bot.id);
    },

    // Keys
    upsertKey: async (key, value, label, isSecret) => {
        const { bot } = get();
        const result = await api.upsertFunnelKey(bot.id, key, value, label, isSecret);
        set(state => ({
            keys: state.keys.find(k => k.key === key)
                ? state.keys.map(k => k.key === key ? result : k)
                : [...state.keys, result],
        }));
    },
    deleteKey: async (key) => {
        const { bot } = get();
        await api.deleteFunnelKey(bot.id, key);
        set(state => ({ keys: state.keys.filter(k => k.key !== key) }));
    },
    revealKey: async (key) => {
        const { bot } = get();
        const { value } = await api.revealFunnelKey(bot.id, key);
        return value;
    },
}));
