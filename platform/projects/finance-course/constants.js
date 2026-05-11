'use strict';

const FILE_TYPES = {
    CASHFLOW_ARTICLES: 'cashflow_articles',
    PL_ARTICLES: 'pl_articles',
    BUSINESS_PROCESS: 'business_process',
    BUSINESS_PROCESS_V2: 'business_process_v2',
    FINANCIAL_MECHANICS: 'financial_mechanics',
    SALARY_PROCESSES: 'salary_processes',
    PAYMENT_PROCESSES: 'payment_processes',
    TEAM_INSTRUCTIONS: 'team_instructions',
    BALANCE_ARTICLES: 'balance_articles',
    BALANCE_PROCESSES: 'balance_processes',
};

const FILE_DISPLAY_NAMES = {
    cashflow_articles: 'Статті Cashflow',
    pl_articles: 'Статті P&L',
    business_process: 'Бізнес-процес компанії',
    business_process_v2: 'Оновлений бізнес-процес',
    financial_mechanics: 'Діагностика фінансової механіки',
    salary_processes: 'Зарплати і виплати',
    payment_processes: 'Регулярні платежі',
    team_instructions: 'Персональні інструкції команді',
    balance_articles: 'Статті балансу',
    balance_processes: 'Баланс у бізнес-процесі',
};

const BLOCK_STATUSES = {
    LOCKED: 'locked',
    AVAILABLE: 'available',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
};

const SESSION_STATES = {
    STARTED: 'started',
    AWAITING_BUSINESS_TYPE: 'awaiting_business_type',
    AWAITING_INCOME_ARTICLES: 'awaiting_income_articles',
    AWAITING_EXPENSE_ARTICLES: 'awaiting_expense_articles',
    AWAITING_CONFIRMATION: 'awaiting_confirmation',
    COMPLETED: 'completed',
};

const BOT_SLUGS = {
    BOT_1_2: 'bot-1-2-business-process',
    BOT_2_1: 'bot-2-1-articles',
    BOT_2_2: 'bot-2-2-cashflow-table',
    BOT_2_3: 'bot-2-3-payment-calendar',
    BOT_3_2: 'bot-3-2-pl-table',
    BOT_3_3: 'bot-3-3-diagnostics',
    BOT_4_1: 'bot-4-1-process-update',
    BOT_4_2: 'bot-4-2-salaries',
    BOT_4_3: 'bot-4-3-payments',
    BOT_4_4: 'bot-4-4-combined-table',
    BOT_4_5: 'bot-4-5-team-instructions',
    BOT_5_1: 'bot-5-1-balance-articles',
    BOT_5_2: 'bot-5-2-balance-table',
    BOT_5_3: 'bot-5-3-balance-process',
};

const DEEP_LINK_MAP = {
    lesson_1_2: BOT_SLUGS.BOT_1_2,
    lesson_2_1: BOT_SLUGS.BOT_2_1,
    lesson_2_2: BOT_SLUGS.BOT_2_2,
    lesson_2_3: BOT_SLUGS.BOT_2_3,
    lesson_3_2: BOT_SLUGS.BOT_3_2,
    lesson_3_3: BOT_SLUGS.BOT_3_3,
    lesson_4_1: BOT_SLUGS.BOT_4_1,
    lesson_4_2: BOT_SLUGS.BOT_4_2,
    lesson_4_3: BOT_SLUGS.BOT_4_3,
    lesson_4_4: BOT_SLUGS.BOT_4_4,
    lesson_4_5: BOT_SLUGS.BOT_4_5,
    lesson_5_1: BOT_SLUGS.BOT_5_1,
    lesson_5_2: BOT_SLUGS.BOT_5_2,
    lesson_5_3: BOT_SLUGS.BOT_5_3,
};

const PROJECT_SLUG = 'finance-course';

module.exports = {
    FILE_TYPES,
    FILE_DISPLAY_NAMES,
    BLOCK_STATUSES,
    SESSION_STATES,
    BOT_SLUGS,
    DEEP_LINK_MAP,
    PROJECT_SLUG,
};
