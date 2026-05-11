const BASE = '/api';

async function req(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error?.message || 'Request failed');
    return data.data ?? data;
}

export const api = {
    // Auth
    login: (login, password) => req('POST', '/admin/login', { login, password }),
    logout: () => req('POST', '/admin/logout'),

    // Projects
    getProjects: () => req('GET', '/projects'),
    getProjectStats: (id) => req('GET', `/projects/${id}/stats`),
    getProjectBots: (id) => req('GET', `/projects/${id}/bots`),

    // Bots
    getBot: (id) => req('GET', `/bots/${id}`),
    getBotSessions: (id, page = 0) => req('GET', `/bots/${id}/sessions?page=${page}`),

    // Funnels
    getFunnel: (botId) => req('GET', `/funnels/${botId}`),
    saveFunnel: (botId, nodes, edges, viewport) => req('PUT', `/funnels/${botId}`, { nodes, edges, viewport }),
    exportFunnel: (botId) => fetch(`${BASE}/funnels/${botId}/export`, { credentials: 'include' }),
    importFunnel: (botId, flow) => req('POST', `/funnels/${botId}/import`, { flow }),

    // Funnel Keys
    getFunnelKeys: (botId) => req('GET', `/funnels/${botId}/keys`),
    upsertFunnelKey: (botId, key, value, label, isSecret) =>
        req('PUT', `/funnels/${botId}/keys`, { key, value, label, isSecret }),
    deleteFunnelKey: (botId, key) => req('DELETE', `/funnels/${botId}/keys/${key}`),
    revealFunnelKey: (botId, key) => req('GET', `/funnels/${botId}/keys/${key}/reveal`),

    // Connectors
    getConnectors: () => req('GET', '/connectors'),

    // Sessions
    getSession: (id) => req('GET', `/sessions/${id}`),
    getSessionMessages: (id) => req('GET', `/sessions/${id}/messages`),
    getSessionApiCalls: (id) => req('GET', `/sessions/${id}/api-calls`),
    sendSessionMessage: (id, text) => req('POST', `/sessions/${id}/send`, { text }),

    // Users
    getUsers: (page = 0) => req('GET', `/users?page=${page}`),
    getUser: (id) => req('GET', `/users/${id}`),
    getUserProgress: (id) => req('GET', `/users/${id}/progress`),
    getUserFiles: (id) => req('GET', `/users/${id}/files`),
    getUserSessions: (id) => req('GET', `/users/${id}/sessions`),
    getUserMcpToken: (id) => req('GET', `/users/${id}/mcp-token`),
    regenerateMcpToken: (id) => req('POST', `/users/${id}/mcp-token`),

    // Admin
    getAnalytics: () => req('GET', '/admin/analytics'),
    getErrors: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return req('GET', `/admin/errors${q ? '?' + q : ''}`);
    },
    resolveError: (id) => req('PATCH', `/admin/errors/${id}/resolve`),
    getApiLogs: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return req('GET', `/admin/api-logs${q ? '?' + q : ''}`);
    },
};
