'use strict';
// One-off setup script: creates project KIRO + funnel kiro-threads-oauth for the
// Threads OAuth code->token exchange, entirely as nodes (no transport-layer code).
// Run ONCE on the server via: node setup-kiro-threads-oauth.js
// Deletes itself afterwards is NOT done automatically — remove manually after verifying.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { callTool } = require('../apps/mcp/src/tools-flows.js');

const PUBLISH_THREADS_BOT_ID = 'cacaf5fb-6ac4-4c34-9a3f-a5a31bbea55c';
const TELEGRAM_CONNECTOR_ID = 'eb411228-6318-4e15-8ddb-286d3776fe8b'; // "Контент бот"
const ADMIN_TELEGRAM_ID = '345126254'; // Олександр

async function main() {
    const out = {};

    // ── 1. Project ──────────────────────────────────────────────────────────
    const project = await callTool('create_project', {
        name: 'KIRO',
        description: 'Нова аплікація KIRO — окремий Threads-акаунт і сервісні воронки під неї.',
    });
    out.project = project;
    const projectSlug = project.slug;

    // ── 2. Funnel (bot + default flow) ─────────────────────────────────────
    const funnel = await callTool('create_funnel', {
        projectSlug,
        name: 'Threads OAuth — KIRO',
        slug: 'kiro-threads-oauth',
        description: 'Приймає code від Threads OAuth redirect (вставляється вручну в JSON тіла POST-запиту), обмінює на short-lived → long-lived access token, отримує THREADS_USER_ID і записує обидва ключі прямо у воронку publish-threads через /api/mcp-edit.',
        goal: 'Одноразово (і за потреби повторно) провести OAuth-обмін для нового Threads-акаунта аплікації KIRO без ручного curl.',
    });
    out.funnel = funnel;
    const botId = funnel.bot.id;

    // Remove the default "msg_intro" node from buildDefaultFlow — we replace the whole chain.
    await callTool('delete_node', { botId, nodeId: 'msg_intro' });

    // ── 3. Keys ──────────────────────────────────────────────────────────────
    const redirectUri = 'https://flows.fineko.space/webhook/bot/kiro-threads-oauth';
    await callTool('update_funnel_key', { botId, key: 'THREADS_APP_ID', value: '', label: 'Threads App ID (Meta for Developers)' });
    await callTool('update_funnel_key', { botId, key: 'THREADS_APP_SECRET', value: '', label: 'Threads App Secret', isSecret: true });
    await callTool('update_funnel_key', { botId, key: 'THREADS_REDIRECT_URI', value: redirectUri, label: 'Redirect URI (вписати в Meta App)' });
    await callTool('update_funnel_key', { botId, key: 'TELEGRAM_CONNECTOR_ID', value: TELEGRAM_CONNECTOR_ID, label: 'Telegram — Контент бот' });
    await callTool('update_funnel_key', { botId, key: 'ADMIN_TELEGRAM_ID', value: ADMIN_TELEGRAM_ID, label: 'Кому слати результат' });
    // MCP_SECRET flows straight from the server's own env into the DB — never printed anywhere.
    if (process.env.MCP_SECRET) {
        await callTool('update_funnel_key', { botId, key: 'MCP_SECRET', value: process.env.MCP_SECRET, label: 'MCP write-secret (для запису токена в publish-threads)', isSecret: true });
    } else {
        out.mcpSecretWarning = 'process.env.MCP_SECRET was empty — key NOT set, fill manually';
    }

    // ── 4. Nodes ────────────────────────────────────────────────────────────
    const nodes = {};

    nodes.exchangeCode = await callTool('add_node', {
        botId, type: 'httpRequest', position: { x: 0, y: 0 },
        data: {
            label: 'Обмін code → short-lived token',
            url: 'https://graph.threads.net/oauth/access_token',
            method: 'POST',
            bodyFields: {
                client_id: '{{env.THREADS_APP_ID}}',
                client_secret: '{{env.THREADS_APP_SECRET}}',
                grant_type: 'authorization_code',
                redirect_uri: '{{env.THREADS_REDIRECT_URI}}',
                code: '{{context.code}}',
            },
            outputVar: 'shortLived',
        },
    });

    nodes.condShort = await callTool('add_node', {
        botId, type: 'condition', position: { x: 0, y: 0 },
        data: {
            label: 'Чи є short-lived token?',
            conditions: [
                { id: 'ok', label: 'OK', expression: 'context.shortLived && context.shortLived.access_token' },
                { id: 'fail', label: 'Помилка', expression: 'true' },
            ],
        },
    });

    nodes.errShort = await callTool('add_node', {
        botId, type: 'notifyTg', position: { x: 0, y: 0 },
        data: {
            label: 'Помилка: обмін code',
            targetKey: 'ADMIN_TELEGRAM_ID',
            message: '⚠️ Threads OAuth (KIRO): не вдалось обміняти code на short-lived token.\nВідповідь Meta: {{context.shortLived}}',
        },
    });

    nodes.exchangeLong = await callTool('add_node', {
        botId, type: 'httpRequest', position: { x: 0, y: 0 },
        data: {
            label: 'Short-lived → long-lived token',
            url: 'https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret={{env.THREADS_APP_SECRET}}&access_token={{context.shortLived.access_token}}',
            method: 'GET',
            outputVar: 'longLived',
        },
    });

    nodes.condLong = await callTool('add_node', {
        botId, type: 'condition', position: { x: 0, y: 0 },
        data: {
            label: 'Чи є long-lived token?',
            conditions: [
                { id: 'ok', label: 'OK', expression: 'context.longLived && context.longLived.access_token' },
                { id: 'fail', label: 'Помилка', expression: 'true' },
            ],
        },
    });

    nodes.errLong = await callTool('add_node', {
        botId, type: 'notifyTg', position: { x: 0, y: 0 },
        data: {
            label: 'Помилка: обмін на long-lived',
            targetKey: 'ADMIN_TELEGRAM_ID',
            message: '⚠️ Threads OAuth (KIRO): не вдалось обміняти short-lived на long-lived token.\nВідповідь Meta: {{context.longLived}}',
        },
    });

    nodes.getMe = await callTool('add_node', {
        botId, type: 'httpRequest', position: { x: 0, y: 0 },
        data: {
            label: 'Отримати THREADS_USER_ID',
            url: 'https://graph.threads.net/v1.0/me?fields=id,username&access_token={{context.longLived.access_token}}',
            method: 'GET',
            outputVar: 'threadsMe',
        },
    });

    nodes.condMe = await callTool('add_node', {
        botId, type: 'condition', position: { x: 0, y: 0 },
        data: {
            label: 'Чи отримали user id?',
            conditions: [
                { id: 'ok', label: 'OK', expression: 'context.threadsMe && context.threadsMe.id' },
                { id: 'fail', label: 'Помилка', expression: 'true' },
            ],
        },
    });

    nodes.errMe = await callTool('add_node', {
        botId, type: 'notifyTg', position: { x: 0, y: 0 },
        data: {
            label: 'Помилка: /me',
            targetKey: 'ADMIN_TELEGRAM_ID',
            message: '⚠️ Threads OAuth (KIRO): не вдалось отримати THREADS_USER_ID.\nВідповідь Meta: {{context.threadsMe}}',
        },
    });

    nodes.buildPayloads = await callTool('add_node', {
        botId, type: 'js', position: { x: 0, y: 0 },
        data: {
            label: 'Зібрати MCP-edit payload',
            code: [
                "const botId = '" + PUBLISH_THREADS_BOT_ID + "';",
                "const userIdPayload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_funnel_key', arguments: { botId, key: 'THREADS_USER_ID', value: String(context.threadsMe.id), label: 'Threads User ID', isSecret: false } } });",
                "const tokenPayload = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'update_funnel_key', arguments: { botId, key: 'THREADS_ACCESS_TOKEN', value: context.longLived.access_token, label: 'Threads Long-Lived Access Token', isSecret: true } } });",
                "return { mcpUserIdPayload: userIdPayload, mcpTokenPayload: tokenPayload };",
            ].join('\n'),
        },
    });

    nodes.writeUserId = await callTool('add_node', {
        botId, type: 'httpRequest', position: { x: 0, y: 0 },
        data: {
            label: 'Записати THREADS_USER_ID у publish-threads',
            url: 'https://flows.fineko.space/api/mcp-edit',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{env.MCP_SECRET}}' },
            body: '{{context.mcpUserIdPayload}}',
            outputVar: 'mcpWriteUserId',
        },
    });

    nodes.writeToken = await callTool('add_node', {
        botId, type: 'httpRequest', position: { x: 0, y: 0 },
        data: {
            label: 'Записати THREADS_ACCESS_TOKEN у publish-threads',
            url: 'https://flows.fineko.space/api/mcp-edit',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {{env.MCP_SECRET}}' },
            body: '{{context.mcpTokenPayload}}',
            outputVar: 'mcpWriteToken',
        },
    });

    nodes.success = await callTool('add_node', {
        botId, type: 'notifyTg', position: { x: 0, y: 0 },
        data: {
            label: 'Готово',
            targetKey: 'ADMIN_TELEGRAM_ID',
            message: '✅ Threads OAuth (KIRO) завершено.\n\nАкаунт: @{{context.threadsMe.username}} (id {{context.threadsMe.id}})\nТокен дійсний ~60 днів (expires_in: {{context.longLived.expires_in}} сек).\n\nТокен і user id записано у ключі воронки publish-threads.',
        },
    });

    out.nodeIds = Object.fromEntries(Object.entries(nodes).map(([k, v]) => [k, v.added.id]));

    // ── 5. Edges ────────────────────────────────────────────────────────────
    const startNodeId = 'start_1';
    const id = (k) => nodes[k].added.id;

    await callTool('create_edge', { botId, source: startNodeId, target: id('exchangeCode') });
    await callTool('create_edge', { botId, source: id('exchangeCode'), target: id('condShort') });
    // condition edge order matters: index0=ok, index1=fail
    await callTool('create_edge', { botId, source: id('condShort'), target: id('exchangeLong') });
    await callTool('create_edge', { botId, source: id('condShort'), target: id('errShort') });

    await callTool('create_edge', { botId, source: id('exchangeLong'), target: id('condLong') });
    await callTool('create_edge', { botId, source: id('condLong'), target: id('getMe') });
    await callTool('create_edge', { botId, source: id('condLong'), target: id('errLong') });

    await callTool('create_edge', { botId, source: id('getMe'), target: id('condMe') });
    await callTool('create_edge', { botId, source: id('condMe'), target: id('buildPayloads') });
    await callTool('create_edge', { botId, source: id('condMe'), target: id('errMe') });

    await callTool('create_edge', { botId, source: id('buildPayloads'), target: id('writeUserId') });
    await callTool('create_edge', { botId, source: id('writeUserId'), target: id('writeToken') });
    await callTool('create_edge', { botId, source: id('writeToken'), target: id('success') });

    // ── 6. Layout ───────────────────────────────────────────────────────────
    const layout = await callTool('auto_layout', { botId });
    out.layout = layout;

    out.botId = botId;
    out.redirectUri = redirectUri;
    console.log(JSON.stringify(out, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
    console.error('FAILED:', err && err.message, err && err.stack);
    process.exit(1);
});
