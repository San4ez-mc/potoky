'use strict';

const logger = require('@platform/logger');

const DEFAULT_TIMEOUT_MS = Number(process.env.APPS_SCRIPT_TIMEOUT_MS || 120000);

function getUrl() {
    const url = process.env.APPS_SCRIPT_URL;
    if (!url) throw new Error('Missing APPS_SCRIPT_URL in environment');
    return url;
}

/**
 * Send a request to Google Apps Script.
 * @param {object} payload - must include `action` field
 * @param {{ timeoutMs?: number }} [opts]
 */
async function callAppsScript(payload, opts = {}) {
    const url = getUrl();
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    const driveParentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    const body = driveParentFolderId
        ? { ...payload, drive_parent_folder_id: driveParentFolderId }
        : { ...payload };

    logger.info('AppsScript request', { action: payload.action, report_type: payload.report_type });

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = null; }

        if (!response.ok) throw new Error(`Apps Script HTTP ${response.status}: ${text}`);
        if (!data || typeof data !== 'object') throw new Error('Apps Script returned non-JSON');
        if (data.status === 'error') {
            throw new Error(data.message || 'Apps Script status=error');
        }

        logger.info('AppsScript success', {
            action: payload.action,
            durationMs: Date.now() - startedAt,
        });

        return data;
    } catch (err) {
        if (err.name === 'AbortError') throw new Error(`Apps Script timeout after ${timeoutMs}ms`);
        logger.error('AppsScript failed', { action: payload.action, error: err.message });
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Build a new Cashflow table in Google Sheets.
 * @param {{ businessName: string, telegramId: string, articles: { inflows: string[], outflows: string[] } }} params
 */
async function buildCashflowTable({ businessName, telegramId, articles }) {
    return callAppsScript({
        action: 'build_table',
        report_type: 'cashflow',
        business_name: businessName,
        telegram_id: String(telegramId),
        articles,
    });
}

/**
 * Build a P&L table in Google Sheets (or add a P&L sheet to existing spreadsheet).
 * @param {{ businessName: string, telegramId: string, articles: { inflows: string[], outflows: string[] }, spreadsheetId?: string, byProject?: boolean, projects?: string[] }} params
 */
async function buildPlTable({ businessName, telegramId, articles, spreadsheetId, byProject, projects }) {
    return callAppsScript({
        action: spreadsheetId ? 'update_table' : 'build_table',
        report_type: 'pl',
        business_name: businessName,
        telegram_id: String(telegramId),
        articles,
        ...(spreadsheetId ? { spreadsheet_id: spreadsheetId } : {}),
        ...(byProject ? { by_project: true, projects } : {}),
    });
}

/**
 * Build a Balance sheet (adds 'Баланс' to existing spreadsheet, or creates new).
 */
async function buildBalanceTable({ businessName, telegramId, articles, spreadsheetId }) {
    return callAppsScript({
        action: spreadsheetId ? 'update_table' : 'build_table',
        report_type: 'balance',
        business_name: businessName,
        telegram_id: String(telegramId),
        articles,
        ...(spreadsheetId ? { spreadsheet_id: spreadsheetId } : {}),
    });
}

/**
 * Build a Payment Calendar sheet in Google Sheets.
 * @param {{ businessName: string, telegramId: string, articles: { inflows: string[], outflows: string[] }, spreadsheetId?: string, horizonMonths: number }} params
 */
async function buildPaymentCalendar({ businessName, telegramId, articles, spreadsheetId, horizonMonths }) {
    return callAppsScript({
        action: spreadsheetId ? 'update_table' : 'build_table',
        report_type: 'cashflow',
        payment_calendar: true,
        horizon_months: horizonMonths || 1,
        business_name: businessName,
        telegram_id: String(telegramId),
        articles,
        ...(spreadsheetId ? { spreadsheet_id: spreadsheetId } : {}),
    });
}

module.exports = {
    callAppsScript,
    buildCashflowTable,
    buildPlTable,
    buildBalanceTable,
    buildPaymentCalendar,
};
