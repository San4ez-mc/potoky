import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore.js';
import clsx from 'clsx';

const NAV = [
    { to: '/funnels', icon: '🗺', label: 'Воронки' },
    { to: '/projects', icon: '📁', label: 'Проєкти' },
    { to: '/broadcasts', icon: '📣', label: 'Розсилки' },
    { to: '/dashboard', icon: '📊', label: 'Дашборд' },
    { to: '/connectors', icon: '🔌', label: 'Конектори' },
    { to: '/subscribers', icon: '👥', label: 'Підписники' },
    { to: '/logs', icon: '📡', label: 'Логи' },
    { to: '/settings', icon: '⚙️', label: 'Налаштування' },
];

const STORAGE_KEY = 'sidebarCollapsed';

export function Sidebar() {
    const logout = useAuthStore(s => s.logout);
    const navigate = useNavigate();
    const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
    });

    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
    }, [collapsed]);

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    return (
        <aside className={clsx(
            'shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col transition-all duration-200',
            collapsed ? 'w-14' : 'w-56'
        )}>
            {/* Logo + toggle */}
            <div className="px-2 py-4 border-b border-gray-800 flex items-center justify-between gap-1">
                {!collapsed && (
                    <div className="flex items-center gap-2.5 pl-2 min-w-0">
                        <span className="text-2xl">🤖</span>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">AI Bots</div>
                            <div className="text-xs text-gray-500">Platform</div>
                        </div>
                    </div>
                )}
                <button
                    onClick={() => setCollapsed(c => !c)}
                    title={collapsed ? 'Розгорнути меню' : 'Згорнути меню'}
                    aria-label={collapsed ? 'Розгорнути меню' : 'Згорнути меню'}
                    className={clsx(
                        'h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors',
                        collapsed && 'mx-auto'
                    )}
                >
                    {collapsed ? '»' : '«'}
                </button>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
                {NAV.map(({ to, icon, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        title={collapsed ? label : undefined}
                        className={({ isActive }) =>
                            clsx(
                                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                                collapsed && 'justify-center px-0',
                                isActive
                                    ? 'bg-brand/20 text-brand-light font-medium'
                                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                            )
                        }
                    >
                        <span>{icon}</span>
                        {!collapsed && <span>{label}</span>}
                    </NavLink>
                ))}
            </nav>

            {/* Logout */}
            <div className="px-2 py-3 border-t border-gray-800">
                <button
                    onClick={handleLogout}
                    title={collapsed ? 'Вийти' : undefined}
                    className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors',
                        collapsed && 'justify-center px-0'
                    )}
                >
                    <span>🚪</span>
                    {!collapsed && <span>Вийти</span>}
                </button>
            </div>
        </aside>
    );
}
