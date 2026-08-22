import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar, NAV } from './Sidebar.jsx';
import { useAuthStore } from '../../stores/authStore.js';

// Гард прямої навігації: приховати посилання в меню недостатньо — людина може
// ввести URL напряму. pageId сторінки бере з того самого NAV, що й Sidebar.
function pageIdForPath(pathname) {
    const hit = NAV.find((n) => pathname === n.to || pathname.startsWith(n.to + '/'));
    return hit ? hit.pageId : undefined;
}

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
    if (pathname.startsWith('/content')) return { title: 'Content Studio' };
    if (pathname.startsWith('/broadcasts')) return { title: 'Розсилки' };
    if (pathname.startsWith('/connectors')) return { title: 'Конектори' };
    if (pathname.startsWith('/settings')) return { title: 'Налаштування' };
    return { title: 'Платформа' };
}

export function Layout() {
    const location = useLocation();
    const navigate = useNavigate();
    const meta = routeMeta(location.pathname, location.search);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const role = useAuthStore((s) => s.role);
    const allowedPageIds = useAuthStore((s) => s.allowedPageIds);

    useEffect(() => {
        if (role === 'superadmin') return;
        const pageId = pageIdForPath(location.pathname);
        if (pageId && !(allowedPageIds || []).includes(pageId)) navigate('/funnels', { replace: true });
    }, [location.pathname, role, allowedPageIds, navigate]);

    const handleBack = () => {
        if (meta.backTo) {
            navigate(meta.backTo);
            return;
        }
        navigate(-1);
    };

    return (
        <div className="flex h-screen overflow-hidden">
            <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />
            <main className="flex-1 overflow-y-auto bg-gray-950 min-w-0">
                <div className="sticky top-0 z-10 h-12 px-3 bg-gray-950/95 backdrop-blur border-b border-gray-800 flex items-center gap-2">
                    <button
                        onClick={() => setMobileSidebarOpen(true)}
                        className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors text-lg"
                        aria-label="Відкрити меню"
                    >
                        ☰
                    </button>
                    {meta.backTo && (
                        <button
                            onClick={handleBack}
                            className="text-sm px-2.5 py-1 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                        >
                            ← Назад
                        </button>
                    )}
                    <div className="text-sm font-semibold text-white">{meta.title}</div>
                </div>
                <Outlet />
            </main>
        </div>
    );
}
