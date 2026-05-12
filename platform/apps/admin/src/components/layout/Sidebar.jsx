import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore.js';
import clsx from 'clsx';

const NAV = [
    { to: '/funnels', icon: '🗺', label: 'Воронки' },
    { to: '/projects', icon: '📁', label: 'Проєкти' },
    { to: '/dashboard', icon: '📊', label: 'Дашборд' },
    { to: '/subscribers', icon: '👥', label: 'Підписники' },
    { to: '/logs', icon: '📡', label: 'Логи' },
    { to: '/settings', icon: '⚙️', label: 'Налаштування' },
];

export function Sidebar() {
    const logout = useAuthStore(s => s.logout);
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    return (
        <aside className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
            {/* Logo */}
            <div className="px-4 py-5 border-b border-gray-800">
                <div className="flex items-center gap-2.5">
                    <span className="text-2xl">🤖</span>
                    <div>
                        <div className="text-sm font-semibold text-white">AI Bots</div>
                        <div className="text-xs text-gray-500">Platform</div>
                    </div>
                </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
                {NAV.map(({ to, icon, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        className={({ isActive }) =>
                            clsx(
                                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                                isActive
                                    ? 'bg-brand/20 text-brand-light font-medium'
                                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                            )
                        }
                    >
                        <span>{icon}</span>
                        <span>{label}</span>
                    </NavLink>
                ))}
            </nav>

            {/* Logout */}
            <div className="px-2 py-3 border-t border-gray-800">
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
                >
                    <span>🚪</span>
                    <span>Вийти</span>
                </button>
            </div>
        </aside>
    );
}
