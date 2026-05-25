import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore.js';
import { Layout } from './components/layout/Layout.jsx';
import { Login } from './pages/Login.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Bots } from './pages/Bots.jsx';
import { Projects } from './pages/Projects.jsx';
import { FunnelEditor } from './pages/FunnelEditor.jsx';
import { Sessions } from './pages/Sessions.jsx';
import { SessionDetail } from './pages/SessionDetail.jsx';
import { Users } from './pages/Users.jsx';
import { UserDetail } from './pages/UserDetail.jsx';
import { Errors } from './pages/Errors.jsx';
import { ApiLogs } from './pages/ApiLogs.jsx';
import { Logs } from './pages/Logs.jsx';
import { Settings } from './pages/Settings.jsx';
import { Connectors } from './pages/Connectors.jsx';
import { ContentStudio } from './pages/ContentStudio.jsx';

function ProtectedRoute({ children }) {
    const { isAuthenticated, isLoading } = useAuthStore();
    if (isLoading) return <div className="flex items-center justify-center h-screen text-gray-400">Завантаження...</div>;
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return children;
}

export default function App() {
    const checkAuth = useAuthStore(s => s.checkAuth);

    useEffect(() => {
        checkAuth();
    }, []);

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<Login />} />

                {/* Funnel editor — full screen (no sidebar) */}
                <Route
                    path="/funnel/:botId"
                    element={
                        <ProtectedRoute>
                            <FunnelEditor />
                        </ProtectedRoute>
                    }
                />

                {/* Main layout with sidebar */}
                <Route
                    path="/"
                    element={
                        <ProtectedRoute>
                            <Layout />
                        </ProtectedRoute>
                    }
                >
                    <Route index element={<Navigate to="/funnels" replace />} />
                    <Route path="funnels" element={<Bots />} />
                    <Route path="projects" element={<Projects />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="content" element={<ContentStudio />} />
                    <Route path="connectors" element={<Connectors />} />
                    <Route path="bots" element={<Navigate to="/funnels" replace />} />
                    <Route path="bots/:botId/sessions" element={<Sessions />} />
                    <Route path="sessions" element={<Sessions />} />
                    <Route path="sessions/:id" element={<SessionDetail />} />
                    <Route path="users" element={<Users />} />
                    <Route path="subscribers" element={<Users />} />
                    <Route path="users/:id" element={<UserDetail />} />
                    <Route path="subscribers/:id" element={<UserDetail />} />
                    <Route path="api-logs" element={<ApiLogs />} />
                    <Route path="errors" element={<Errors />} />
                    <Route path="logs" element={<Logs />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="mcp" element={<Navigate to="/settings" replace />} />
                </Route>

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
