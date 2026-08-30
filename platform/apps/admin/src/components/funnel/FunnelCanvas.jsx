import React, { useCallback, useRef } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    addEdge,
    useReactFlow,
    applyNodeChanges,
    applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useFunnelStore } from '../../stores/funnelStore.js';
import { NODE_TYPES } from './NodeTypes.jsx';

let nodeCounter = Date.now();
const uid = () => `node_${++nodeCounter}`;

export function FunnelCanvas({ onNodeClick, readOnly = false }) {
    const { nodes, edges, viewport, setNodes, setEdges, setViewport, selectNode } = useFunnelStore();
    const { screenToFlowPosition } = useReactFlow();
    const ref = useRef(null);

    const onConnect = useCallback(
        (params) => { if (!readOnly) setEdges((eds) => addEdge({ ...params, animated: true }, eds)); },
        [setEdges, readOnly]
    );

    const onNodeClickCb = useCallback((_, node) => {
        selectNode(node.id);
        onNodeClick?.(node);
    }, [selectNode, onNodeClick]);

    const onPaneClick = useCallback(() => {
        useFunnelStore.getState().clearSelection();
        onNodeClick?.(null);
    }, [onNodeClick]);

    const onDrop = useCallback((event) => {
        event.preventDefault();
        if (readOnly) return;
        const type = event.dataTransfer.getData('application/node-type');
        const defaultData = JSON.parse(event.dataTransfer.getData('application/node-data') || '{}');
        if (!type) return;

        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const newNode = { id: uid(), type, position, data: { label: type, ...defaultData } };
        setNodes((nds) => [...nds, newNode]);
    }, [setNodes, screenToFlowPosition, readOnly]);

    const onDragOver = (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    };

    return (
        <div ref={ref} className="flex-1 h-full" onDrop={onDrop} onDragOver={onDragOver}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={(changes) => setNodes((nds) => applyNodeChanges(changes, nds))}
                onEdgesChange={(changes) => setEdges((eds) => applyEdgeChanges(changes, eds))}
                onConnect={onConnect}
                onNodeClick={onNodeClickCb}
                onPaneClick={onPaneClick}
                nodeTypes={NODE_TYPES}
                defaultViewport={viewport}
                onMoveEnd={(_, vp) => setViewport(vp)}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                edgesReconnectable={!readOnly}
                deleteKeyCode={readOnly ? null : 'Delete'}
                connectionRadius={40}
                snapToGrid
                snapGrid={[15, 15]}
                defaultEdgeOptions={{ animated: true, type: 'smoothstep', style: { stroke: '#6366f1', strokeWidth: 2 } }}
                className="bg-gray-950"
            >
                <Background color="#1f2937" gap={20} size={1} />
                <Controls />
                <MiniMap
                    nodeColor={(n) => {
                        const colors = {
                            start: '#059669', message: '#1d4ed8', claude: '#7c3aed',
                            js: '#b45309', condition: '#c2410c', connector: '#0e7490',
                            saveFile: '#be185d', loadFile: '#4338ca', wait: '#4b5563',
                            wait_payment: '#65a30d', httpRequest: '#0f766e', tag: '#b91c1c',
                        };
                        return colors[n.type] || '#374151';
                    }}
                    maskColor="#03070D88"
                />
            </ReactFlow>
        </div>
    );
}
