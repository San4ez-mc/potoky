import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.js';

const SSO_MESSAGES = {
    denied: 'Цей акаунт не має доступу до системи воронок. Зверніться до адміністратора.',
    state: 'Сесія входу застаріла. Спробуйте ще раз.',
    exchange: 'Не вдалося завершити вхід через SSO. Спробуйте ще раз.',
    error: 'Помилка входу через SSO. Спробуйте ще раз.',
};

export function Login() {
    const [loginVal, setLoginVal] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(true);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showFallback, setShowFallback] = useState(false);
    const { login, isAuthenticated } = useAuthStore();

    const ssoError = new URLSearchParams(window.location.search).get('sso');

    if (isAuthenticated) return <Navigate to="/" replace />;

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(loginVal, password, rememberMe);
        } catch (err) {
            setError(err.message || 'Невірний логін або пароль');
        } finally {
            setLoading(false);
        }
    };

    const bgStyle = {
        background:
            "linear-gradient(rgba(13,17,23,.55), rgba(13,17,23,.85)), url('https://sso.fineko.space/login-bg.png') center/cover fixed, #0b0f1a",
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={bgStyle}>
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl">
                        <span className="text-3xl">🤖</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white">FINEKO — Воронки</h1>
                    <p className="text-gray-300 mt-1">Єдиний вхід у продукти FINEKO</p>
                </div>

                <div className="bg-gray-900/80 backdrop-blur rounded-2xl p-6 border border-white/10 shadow-2xl space-y-4">
                    {ssoError && SSO_MESSAGES[ssoError] && (
                        <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
                            {SSO_MESSAGES[ssoError]}
                        </div>
                    )}

                    {/* Основний вхід — через SSO */}
                    <a
                        href="/api/auth/sso/login"
                        className="w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white rounded-lg py-3 font-medium transition-colors"
                    >
                        🔐 Увійти через SSO
                    </a>

                    {/* Резервний вхід за паролем (на час переходу) */}
                    <button
                        type="button"
                        onClick={() => setShowFallback((v) => !v)}
                        className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    >
                        {showFallback ? 'Сховати' : 'Вхід за паролем (резерв)'}
                    </button>

                    {showFallback && (
                        <form onSubmit={submit} className="space-y-3 pt-1 border-t border-gray-800">
                            <input
                                type="text"
                                value={loginVal}
                                onChange={(e) => setLoginVal(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-brand"
                                placeholder="admin"
                                autoComplete="username"
                            />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-brand"
                                placeholder="••••••••"
                                autoComplete="current-password"
                            />
                            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
                                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="accent-brand" />
                                Запам'ятати мене
                            </label>
                            {error && (
                                <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">{error}</div>
                            )}
                            <button type="submit" disabled={loading} className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg py-2.5 font-medium transition-colors">
                                {loading ? 'Входжу...' : 'Увійти за паролем'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
