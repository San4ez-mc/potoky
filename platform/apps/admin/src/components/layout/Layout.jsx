import React from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';

function routeMeta(pathname, search) {
    const params = new URLSearchParams(search || '');
    const requestedBack = params.get('back');
    const safeBack = requestedBack && requestedBack.startsWith('/') ? requestedBack : null;

    if (pathname.startsWith('/funnels')) return { title: 'Воронки' };
    if (pathname.startsWith('/projects')) return { title: 'Проєкти' };
    if (pathname.startsWith('/dashboard')) return { title: 'Дашборд' };
    if (pathname.startsWith('/bots/') && pathname.endsWith('/sessions')) return { title: 'Сесії бота', backTo: '/funnels' };
    if (pathname.startsWith('/sessions/')) return { title: 'Деталі сесії', backTo: safeBack || '/sessions' };
    if (pathname.startsWith('/sessions')) return { title: 'Сесії' };
    if (pathname.startsWith('/users/')) return { title: 'Деталі користувача', backTo: '/users' };
    if (pathname.startsWith('/users')) return { title: 'Користувачі' };
    if (pathname.startsWith('/api-logs')) return { title: 'API логи' };
    if (pathname.startsWith('/errors')) return { title: 'Помилки' };
    if (pathname.startsWith('/connectors')) return { title: 'Конектори' };
    if (pathname.startsWith('/settings')) return { title: 'Налаштування' };
    return { title: 'Платформа' };
}

export function Layout() {
    const location = useLocation();
    const navigate = useNavigate();
    const meta = routeMeta(location.pathname, location.search);

    const handleBack = () => {
        if (meta.backTo) {
            navigate(meta.backTo);
            return;
        }
        navigate(-1);
    };

    return (
        <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto bg-gray-950">
                <div className="sticky top-0 z-10 h-12 px-4 bg-gray-950/95 backdrop-blur border-b border-gray-800 flex items-center gap-3">
                    {meta.backTo && (
                        <button
                            onClick={handleBack}
                            className="text-sm px-2.5 py-1 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                        >
                            ← Назад
                        </button>
                    )}
                    <div className="text-sm font-semibold text-white">{meta.title}</div>
                    <div className="flex-1" />
                    <div className="hidden md:flex items-center gap-1">
                        <Link to="/funnels" className="text-xs px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800">Воронки</Link>
                        <Link to="/projects" className="text-xs px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800">Проєкти</Link>
                        <Link to="/sessions" className="text-xs px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800">Сесії</Link>
                        <Link to="/users" className="text-xs px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800">Користувачі</Link>
                        <Link to="/dashboard" className="text-xs px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800">Дашборд</Link>
                    </div>
                </div>
                <Outlet />
            </main>
        </div>
    );
}
