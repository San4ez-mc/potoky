const BASE = '/api';

async function parseResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return res.json();
    }

    const text = await res.text();
    const message = res.status === 401
        ? 'Сесія завершилась. Увійдіть знову.'
        : `Сервер повернув не-JSON відповідь (${res.status})`;

    throw new Error(text ? `${message}` : message);
}

async function req(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await parseResponse(res);
    if (!data.ok) throw new Error(data.error?.message || 'Request failed');
    return data.data ?? data;
}

async function reqWithMeta(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await parseResponse(res);
    if (!data.ok) throw new Error(data.error?.message || 'Request failed');
    return data;
}

export const api = {
    // Auth
    login: (login, password, rememberMe = false) => req('POST', '/admin/login', { login, password, rememberMe }),
    logout: () => req('POST', '/admin/logout'),

    // Projects
    getProjects: () => req('GET', '/projects'),
    getProjectStats: (id) => req('GET', `/projects/${id}/stats`),
    getProjectBots: (id) => req('GET', `/projects/${id}/bots`),
    createProject: (name, slug, description) => req('POST', '/projects', { name, slug, description }),
    updateProject: (id, name, description, isActive) => req('PUT', `/projects/${id}`, { name, description, isActive }),
    deleteProject: (id) => req('DELETE', `/projects/${id}`),

    // Bots
    getBot: (id) => req('GET', `/bots/${id}`),
    updateBot: (id, name, description, projectId) => req('PATCH', `/bots/${id}`, {
        name, description,
        ...(projectId !== undefined && { projectId }),
    }),
    archiveBot: (id) => req('PATCH', `/bots/${id}`, { isActive: false }),
    unarchiveBot: (id) => req('PATCH', `/bots/${id}`, { isActive: true }),
    getAllBots: () => req('GET', '/projects/bots/all'),
    getBotSessions: (id, page = 0) => req('GET', `/bots/${id}/sessions?page=${page}`),
    createFunnel: (projectId, data) => req('POST', `/projects/${projectId}/bots`, data),
    deleteFunnel: (projectId, botId) => req('DELETE', `/projects/${projectId}/bots/${botId}`),

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
    getNodeStats: (botId, nodeId, period = '30d') => req('GET', `/funnels/${botId}/nodes/${nodeId}/stats?period=${period}`),

    // Connectors (type definitions)
    getConnectors: () => req('GET', '/connectors'),

    // Saved Connectors (instances with real credentials)
    getSavedConnectors: () => req('GET', '/saved-connectors'),
    getSavedConnector: (id) => req('GET', `/saved-connectors/${id}`),
    createSavedConnector: (data) => req('POST', '/saved-connectors', data),
    updateSavedConnector: (id, data) => req('PUT', `/saved-connectors/${id}`, data),
    deleteSavedConnector: (id) => req('DELETE', `/saved-connectors/${id}`),

    // Sessions
    getSession: (id) => req('GET', `/sessions/${id}`),
    getSessionMessages: (id) => req('GET', `/sessions/${id}/messages`),
    getSessionApiCalls: (id) => req('GET', `/sessions/${id}/api-calls`),
    getSessionErrors: (id) => req('GET', `/sessions/${id}/errors`),
    sendSessionMessage: (id, payload) => req('POST', `/sessions/${id}/send`, payload),
    restartSession: (id) => req('POST', `/sessions/${id}/restart`),
    deleteSession: (id) => req('DELETE', `/sessions/${id}`),
    deleteSessionMessage: (sessionId, msgId) => req('DELETE', `/sessions/${sessionId}/messages/${msgId}`),
    deleteSessionsBulk: (ids) => req('POST', '/sessions/bulk-delete', { ids }),
    markSessionTest: (id, isTest) => req('PATCH', `/sessions/${id}/mark-test`, { isTest }),
    getBotSessions: (botId, page = 0, params = {}) => {
        const q = new URLSearchParams({ page, limit: 50, ...params }).toString();
        return reqWithMeta('GET', `/bots/${botId}/sessions${q ? '?' + q : ''}`);
    },

    // Users
    getUsers: (page = 0, search = '', realOnly = true) => {
        const params = new URLSearchParams({ page, realOnly: String(realOnly) });
        if (search) params.set('search', search);
        return req('GET', `/users?${params}`);
    },
    getUser: (id) => req('GET', `/users/${id}`),
    getUserProgress: (id) => req('GET', `/users/${id}/progress`),
    getUserFiles: (id) => req('GET', `/users/${id}/files`),
    getUserSessions: (id) => req('GET', `/users/${id}/sessions`),
    getUserMcpToken: (id) => req('GET', `/users/${id}/mcp-token`),
    regenerateMcpToken: (id) => req('POST', `/users/${id}/mcp-token`),

    // Admin
    getAnalytics: () => req('GET', '/admin/analytics'),
    getUnreadSessionsCount: () => req('GET', '/admin/sessions/unread-count'),
    getAllSessions: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return reqWithMeta('GET', `/admin/sessions${q ? '?' + q : ''}`);
    },
    getErrors: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return req('GET', `/admin/errors${q ? '?' + q : ''}`);
    },
    resolveError: (id) => req('PATCH', `/admin/errors/${id}/resolve`),
    getApiLogs: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return req('GET', `/admin/api-logs${q ? '?' + q : ''}`);
    },
    getLogs: (tab = 'all') => req('GET', `/admin/logs?tab=${tab}`),
    getMcpConfig: () => req('GET', '/admin/mcp-config'),
    runBotRegression: (botId) => req('POST', `/admin/bots/${botId}/run-regression`),
    runWebhookTest: (botId, body) => req('POST', `/admin/bots/${botId}/webhook-test`, body),
    runProjectRegressions: (projectSlug) => req('POST', `/admin/projects/${projectSlug}/run-regressions`),

    // Broadcasts
    getBroadcastEligibleBots: () => req('GET', '/broadcasts/eligible-bots'),
    getBroadcastSubscribers: (botIds) => req('GET', `/broadcasts/subscribers?botIds=${botIds.join(',')}`),
    getBroadcasts: () => req('GET', '/broadcasts'),
    createBroadcast: (data) => req('POST', '/broadcasts', data),
    cancelBroadcast: (id) => req('DELETE', `/broadcasts/${id}`),

    // System Keys (settings-level, not funnel-level)
    getSystemKeys: () => req('GET', '/system-keys'),
    upsertSystemKey: (key, value, label, description, isSecret = true) =>
        req('PUT', `/system-keys/${key}`, { value, label, description, isSecret }),
    revealSystemKey: (key) => req('GET', `/system-keys/${key}/reveal`),

    // Global Keys
    getGlobalKeys: (projectId) => req('GET', `/projects/${projectId}/global-keys`),
    upsertGlobalKey: (projectId, key, label, value, isSecret, description) =>
        req('PUT', `/projects/${projectId}/global-keys/${key}`, { label, value, isSecret, description }),
    deleteGlobalKey: (projectId, key) => req('DELETE', `/projects/${projectId}/global-keys/${key}`),
    revealGlobalKey: (projectId, key) => req('GET', `/projects/${projectId}/global-keys/${key}/reveal`),
};
