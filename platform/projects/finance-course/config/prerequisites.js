'use strict';

const { FileStorage } = require('@platform/storage');
const { FILE_DISPLAY_NAMES } = require('../constants');

const BOT_REQUIREMENTS = {
    'bot-1-1-onboarding': { files: [] },
    'bot-1-2-business-process': { files: [] },
    'bot-2-1-articles': { files: [] },
    'bot-2-2-cashflow-table': { files: ['cashflow_articles'] },
    'bot-2-3-payment-calendar': { files: ['cashflow_articles'] },
    'bot-3-2-pl-table': { files: ['pl_articles'] },
    'bot-3-3-diagnostics': { files: ['cashflow_articles', 'pl_articles', 'business_process'] },
    'bot-4-1-process-update': { files: ['business_process', 'cashflow_articles', 'pl_articles'] },
    'bot-4-2-salaries': { files: ['cashflow_articles'] },
    'bot-4-3-payments': { files: ['cashflow_articles'] },
    'bot-4-4-combined-table': { files: ['cashflow_articles', 'pl_articles'] },
    'bot-4-5-team-instructions': { files: ['business_process_v2', 'salary_processes', 'payment_processes'] },
    'bot-5-1-balance-articles': { files: ['cashflow_articles', 'pl_articles'] },
    'bot-5-2-balance-table': { files: ['balance_articles'] },
    'bot-5-3-balance-process': { files: ['balance_articles', 'business_process_v2'] },
};

/**
 * Check if a user has all required files for a bot.
 * @returns {{ ok: boolean, missing: string[], missingNames: string[] }}
 */
async function checkPrerequisites(userId, botSlug) {
    const requirements = BOT_REQUIREMENTS[botSlug] || { files: [] };
    const missing = [];

    for (const fileType of requirements.files) {
        const file = await FileStorage.getLatest(userId, fileType);
        if (!file) missing.push(fileType);
    }

    const missingNames = missing.map(ft => FILE_DISPLAY_NAMES[ft] || ft);
    return { ok: missing.length === 0, missing, missingNames };
}

module.exports = { checkPrerequisites, BOT_REQUIREMENTS };
