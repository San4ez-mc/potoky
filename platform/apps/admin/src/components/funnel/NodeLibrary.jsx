import React from 'react';
import { NODE_PALETTE } from './NodeTypes.jsx';
import clsx from 'clsx';

function PaletteItem({ item }) {
    const onDragStart = (e) => {
        e.dataTransfer.setData('application/node-type', item.type);
        e.dataTransfer.setData('application/node-data', JSON.stringify(item.defaultData));
        e.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            draggable
            onDragStart={onDragStart}
            className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing',
                'bg-gray-900 hover:bg-gray-800 transition-colors',
                item.color
            )}
        >
            <span>{item.icon}</span>
            <span className="text-sm text-gray-300">{item.label}</span>
        </div>
    );
}

function ConnectorItem({ connector }) {
    const onDragStart = (e) => {
        e.dataTransfer.setData('application/node-type', 'connector');
        e.dataTransfer.setData('application/node-data', JSON.stringify({
            label: connector.name,
            connectorType: connector.type,
            connectorIcon: connector.icon,
            config: {},
        }));
        e.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            draggable
            onDragStart={onDragStart}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cyan-900 bg-gray-900 hover:bg-gray-800 transition-colors cursor-grab active:cursor-grabbing"
            title={connector.description}
        >
            <span>{connector.icon || '🔌'}</span>
            <div>
                <div className="text-sm text-gray-300">{connector.name}</div>
                {connector.description && (
                    <div className="text-[10px] text-gray-500 line-clamp-1">{connector.description}</div>
                )}
            </div>
        </div>
    );
}

export function NodeLibrary({ connectors = [] }) {
    return (
        <div className="w-56 shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col overflow-y-auto">
            {/* Node types */}
            <div className="p-3 border-b border-gray-800">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-2 px-1">Ноди</div>
                <div className="space-y-1.5">
                    {NODE_PALETTE.map(item => (
                        <PaletteItem key={item.type} item={item} />
                    ))}
                </div>
            </div>

            {/* Connectors */}
            {connectors.length > 0 && (
                <div className="p-3">
                    <div className="text-xs text-gray-500 uppercase tracking-wide mb-2 px-1">Конектори</div>
                    <div className="space-y-1.5">
                        {connectors.map(c => (
                            <ConnectorItem key={c.id} connector={c} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
