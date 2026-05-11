import { create } from 'zustand';
import { api } from '../api/client.js';

export const useAuthStore = create((set) => ({
    isAuthenticated: false,
    isLoading: true,

    checkAuth: async () => {
        try {
            await api.getAnalytics();
            set({ isAuthenticated: true, isLoading: false });
        } catch {
            set({ isAuthenticated: false, isLoading: false });
        }
    },

    login: async (password) => {
        await api.login(password);
        set({ isAuthenticated: true });
    },

    logout: async () => {
        await api.logout();
        set({ isAuthenticated: false });
    },
}));
