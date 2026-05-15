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

/**
 * Validate a table for errors (REF, NAME, VALUE errors, formula issues, etc)
 * @param {{ spreadsheetId: string }} params
 */
async function validateTable({ spreadsheetId }) {
    return callAppsScript({
        action: 'validate_table',
        spreadsheet_id: spreadsheetId,
    });
}

/**
 * Repair formulas and table structure
 * @param {{ spreadsheetId: string, repairType?: 'formulas' | 'protection' | 'all' }} params
 */
async function repairTable({ spreadsheetId, repairType = 'all' }) {
    return callAppsScript({
        action: 'update_table',
        operation: 'repair_formulas',
        spreadsheet_id: spreadsheetId,
        repair_type: repairType,
    });
}

/**
 * List all tables for a user
 * @param {{ telegramId: string }} params
 */
async function listUserTables({ telegramId }) {
    return callAppsScript({
        action: 'list_tables',
        telegram_id: String(telegramId),
    });
}

/**
 * Validate then repair if needed - returns { valid: boolean, errors: string[], repaired: boolean }
 * @param {{ spreadsheetId: string }} params
 */
async function validateAndRepair({ spreadsheetId }) {
    try {
        // First pass: validate
        const validationResult = await validateTable({ spreadsheetId });
        
        if (validationResult.valid === true) {
            return { valid: true, errors: [], repaired: false };
        }

        // Second pass: repair
        const errors = validationResult.errors || [];
        const repairResult = await repairTable({ spreadsheetId });
        
        // Third pass: re-validate
        const revalidationResult = await validateTable({ spreadsheetId });
        
        return {
            valid: revalidationResult.valid === true,
            errors: revalidationResult.errors || errors,
            repaired: true,
            repairLog: repairResult,
        };
    } catch (err) {
        logger.error('Validate and repair failed', { spreadsheetId, error: err.message });
        throw err;
    }
}

/**
 * Retry wrapper - attempts action with exponential backoff
 * @param {Function} action - async function to retry
 * @param {{ maxAttempts?: number, initialDelayMs?: number }} opts
 */
async function withRetry(action, opts = {}) {
    const maxAttempts = opts.maxAttempts || 3;
    const initialDelayMs = opts.initialDelayMs || 1000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await action();
        } catch (err) {
            if (attempt === maxAttempts) throw err;
            
            const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
            logger.warn(`Retry attempt ${attempt}/${maxAttempts}`, { error: err.message, delayMs });
            
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

module.exports = {
    callAppsScript,
    buildCashflowTable,
    buildPlTable,
    buildBalanceTable,
    buildPaymentCalendar,
    validateTable,
    repairTable,
    listUserTables,
    validateAndRepair,
    withRetry,
};
