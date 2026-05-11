import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.js';

export function Login() {
    const [loginVal, setLoginVal] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login, isAuthenticated } = useAuthStore();

    if (isAuthenticated) return <Navigate to="/" replace />;

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(loginVal, password);
        } catch (err) {
            setError(err.message || 'Невірний логін або пароль');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <span className="text-3xl">🤖</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white">AI Bots Platform</h1>
                    <p className="text-gray-400 mt-1">Введіть дані для входу</p>
                </div>

                <form onSubmit={submit} className="bg-gray-900 rounded-2xl p-6 border border-gray-800 space-y-4">
                    <div>
                        <label className="text-sm text-gray-400 block mb-1.5">Логін</label>
                        <input
                            type="text"
                            value={loginVal}
                            onChange={e => setLoginVal(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                            placeholder="admin"
                            required
                            autoFocus
                            autoComplete="username"
                        />
                    </div>
                    <div>
                        <label className="text-sm text-gray-400 block mb-1.5">Пароль</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                            placeholder="••••••••"
                            required
                            autoComplete="current-password"
                        />
                    </div>

                    {error && (
                        <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-brand hover:bg-brand-dark disabled:opacity-50 text-white rounded-lg py-2.5 font-medium transition-colors"
                    >
                        {loading ? 'Входжу...' : 'Увійти'}
                    </button>
                </form>
            </div>
        </div>
    );
}
