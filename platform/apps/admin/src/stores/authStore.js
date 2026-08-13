import { create } from 'zustand';
import { api } from '../api/client.js';

export const useAuthStore = create((set) => ({
    isAuthenticated: false,
    isLoading: true,
    role: 'superadmin',            // superadmin | user
    allowedProjectIds: null,       // null = усі проєкти (суперадмін); масив = дозволені

    checkAuth: async () => {
        try {
            const me = await api.getMe();
            if (me && me.authenticated) {
                set({
                    isAuthenticated: true,
                    isLoading: false,
                    role: me.role || 'superadmin',
                    allowedProjectIds: me.allowedProjectIds ?? null,
                });
            } else {
                set({ isAuthenticated: false, isLoading: false });
            }
        } catch {
            set({ isAuthenticated: false, isLoading: false });
        }
    },

    login: async (loginVal, password, rememberMe = false) => {
        await api.login(loginVal, password, rememberMe);
        try {
            const me = await api.getMe();
            set({ isAuthenticated: true, role: me?.role || 'superadmin', allowedProjectIds: me?.allowedProjectIds ?? null });
        } catch {
            set({ isAuthenticated: true });
        }
    },

    logout: async () => {
        await api.logout();
        set({ isAuthenticated: false, role: 'superadmin', allowedProjectIds: null });
    },
}));
