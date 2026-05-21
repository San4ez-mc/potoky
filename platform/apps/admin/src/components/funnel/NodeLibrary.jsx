import React, { useState } from 'react';
import { NODE_PALETTE } from './NodeTypes.jsx';
import clsx from 'clsx';

// ── Group definitions (ordered) ──────────────────────────────────────────────
const GROUP_ORDER = ['Тригери', 'Повідомлення', 'ШІ', 'Логіка', 'Дані', 'Інтеграції', 'Очікування'];
const GROUP_ICONS = {
    'Тригери': '🚀',
    'Повідомлення': '💬',
    'ШІ': '🧠',
    'Логіка': '🔀',
    'Дані': '💾',
    'Інтеграції': '🌐',
    'Очікування': '⏳',
};

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
            title={item.description}
            className={clsx(
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing',
                'bg-gray-900 hover:bg-gray-800 transition-colors',
                item.color
            )}
        >
            <span className="text-base shrink-0">{item.icon}</span>
            <div className="min-w-0">
                <div className="text-sm text-gray-300 truncate">{item.label}</div>
                {item.description && (
                    <div className="text-[10px] text-gray-600 truncate">{item.description}</div>
                )}
            </div>
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
            title={connector.description}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-cyan-900 bg-gray-900 hover:bg-gray-800 transition-colors cursor-grab active:cursor-grabbing"
        >
            <span className="text-base shrink-0">{connector.icon || '🔌'}</span>
            <div className="min-w-0">
                <div className="text-sm text-gray-300 truncate">{connector.name}</div>
                {connector.description && (
                    <div className="text-[10px] text-gray-500 truncate">{connector.description}</div>
                )}
            </div>
        </div>
    );
}

function AccordionGroup({ label, icon, children, defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-gray-800 last:border-b-0">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-900 transition-colors text-left"
            >
                <div className="flex items-center gap-2">
                    <span className="text-sm">{icon}</span>
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
                </div>
                <span className={clsx('text-gray-600 text-xs transition-transform', open ? 'rotate-180' : '')}>▼</span>
            </button>
            {open && (
                <div className="px-3 pb-3 space-y-1.5">
                    {children}
                </div>
            )}
        </div>
    );
}

export function NodeLibrary({ connectors = [], embedded = false }) {
    // Group palette items by group
    const grouped = GROUP_ORDER.map(groupName => ({
        name: groupName,
        icon: GROUP_ICONS[groupName] || '📦',
        items: NODE_PALETTE.filter(item => item.group === groupName),
    })).filter(g => g.items.length > 0);

    // Items without a group (fallback)
    const ungrouped = NODE_PALETTE.filter(item => !item.group || !GROUP_ORDER.includes(item.group));

    return (
        <div className={clsx(
            embedded ? 'h-full flex flex-col overflow-y-auto' : 'w-56 shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col overflow-y-auto'
        )}>
            {/* Node groups */}
            {grouped.map(group => (
                <AccordionGroup key={group.name} label={group.name} icon={group.icon} defaultOpen={group.name !== 'Очікування' && group.name !== 'Інтеграції'}>
                    {group.items.map(item => (
                        <PaletteItem key={item.type} item={item} />
                    ))}
                </AccordionGroup>
            ))}

            {ungrouped.length > 0 && (
                <AccordionGroup label="Інші" icon="📦">
                    {ungrouped.map(item => (
                        <PaletteItem key={item.type} item={item} />
                    ))}
                </AccordionGroup>
            )}

            {/* Connectors section */}
            {connectors.length > 0 && (
                <AccordionGroup label="Конектори" icon="🔌" defaultOpen={true}>
                    {connectors.map(c => (
                        <ConnectorItem key={c.id || c.type} connector={c} />
                    ))}
                </AccordionGroup>
            )}

            {/* Hint */}
            <div className="px-4 py-3 mt-auto border-t border-gray-800">
                <div className="text-[10px] text-gray-600 text-center">
                    Перетягни ноду на полотно<br />
                    З'єднуй ноди — тягни від <span className="text-brand">●</span> (внизу) до <span className="text-gray-400">●</span> (вгорі)
                </div>
            </div>
        </div>
    );
}
