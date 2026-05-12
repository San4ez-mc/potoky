'use strict';

const { db } = require('@platform/db');
const logger = require('@platform/logger');

const CHANNELS_KEY = 'FUNNEL_CHANNELS';

function parseChannels(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
        // fallback to csv
    }
    return String(raw)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

function toKeyMap(keys) {
    return keys.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});
}

function getBaseUrl() {
    return (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://flows.fineko.space').replace(/\/$/, '');
}

async function syncTelegram(botId, keyMap) {
    const token = keyMap.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN missing' };
    }

    const secret = keyMap.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || null;
    const url = `${getBaseUrl()}/webhook/telegram/${botId}`;

    const payload = {
        url,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
    };

    if (secret) payload.secret_token = secret;

    const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const setJson = await setRes.json();

    if (!setRes.ok || !setJson.ok) {
        throw new Error(`Telegram setWebhook failed: ${setJson.description || setRes.status}`);
    }

    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const infoJson = await infoRes.json();

    return {
        ok: true,
        webhookUrl: infoJson?.result?.url || url,
        pendingUpdateCount: infoJson?.result?.pending_update_count ?? null,
        lastErrorMessage: infoJson?.result?.last_error_message || null,
    };
}

async function syncInstagram(botId, keyMap) {
    const appId = keyMap.INSTAGRAM_APP_ID;
    const appSecret = keyMap.INSTAGRAM_APP_SECRET;
    const verifyToken = keyMap.INSTAGRAM_VERIFY_TOKEN;

    if (!appId || !appSecret || !verifyToken) {
        return {
            ok: false,
            skipped: true,
            reason: 'INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET / INSTAGRAM_VERIFY_TOKEN missing',
        };
    }

    const callbackUrl = `${getBaseUrl()}/webhook/instagram/${botId}`;
    const appAccessToken = `${appId}|${appSecret}`;
    const params = new URLSearchParams({
        object: 'instagram',
        callback_url: callbackUrl,
        verify_token: verifyToken,
        fields: 'messages,messaging_postbacks',
        include_values: 'true',
        access_token: appAccessToken,
    });

    const subRes = await fetch(`https://graph.facebook.com/v23.0/${appId}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    const subJson = await subRes.json();
    if (!subRes.ok || subJson.error) {
        throw new Error(`Instagram subscription failed: ${subJson?.error?.message || subRes.status}`);
    }

    return { ok: true, callbackUrl };
}

async function syncChannelsForBot(botId) {
    const [bot, keys] = await Promise.all([
        db.bot.findUnique({ where: { id: botId }, select: { id: true, slug: true } }),
        db.funnelKey.findMany({ where: { botId } }),
    ]);

    if (!bot) {
        return { ok: false, error: 'Bot not found' };
    }

    const keyMap = toKeyMap(keys);
    const channels = parseChannels(keyMap[CHANNELS_KEY]).filter(ch => ch === 'telegram' || ch === 'instagram');

    if (!channels.length) {
        return { ok: true, channels: [], note: 'No active channels selected' };
    }

    const result = { ok: true, channels, telegram: null, instagram: null };

    if (channels.includes('telegram')) {
        try {
            result.telegram = await syncTelegram(botId, keyMap);
        } catch (error) {
            result.ok = false;
            result.telegram = { ok: false, error: error.message };
            logger.error('Telegram channel sync failed', { botId, botSlug: bot.slug, error: error.message });
        }
    }

    if (channels.includes('instagram')) {
        try {
            result.instagram = await syncInstagram(botId, keyMap);
        } catch (error) {
            result.ok = false;
            result.instagram = { ok: false, error: error.message };
            logger.error('Instagram channel sync failed', { botId, botSlug: bot.slug, error: error.message });
        }
    }

    return result;
}

module.exports = { syncChannelsForBot };
