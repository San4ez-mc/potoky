'use strict';

/**
 * Build messages array from DB Message records.
 * Compresses old messages if count > threshold.
 */
function buildMessages(dbMessages, summaryText = null) {
    const MAX_FULL_MESSAGES = 30;

    if (summaryText && dbMessages.length > MAX_FULL_MESSAGES) {
        const recent = dbMessages.slice(-MAX_FULL_MESSAGES);
        return [
            { role: 'user', content: `[Попередній контекст розмови]\n${summaryText}` },
            { role: 'assistant', content: 'Зрозумів, продовжую розмову з урахуванням контексту.' },
            ...recent.map(m => ({ role: m.role, content: m.content })),
        ];
    }

    return dbMessages.map(m => ({ role: m.role, content: m.content }));
}

/**
 * Check if Claude response contains a special action tag.
 */
function extractTag(text, tag) {
    const regex = new RegExp(`\\[${tag}\\]`, 'i');
    if (regex.test(text)) {
        return text.replace(regex, '').trim();
    }
    return null;
}

/**
 * Build standard system prompt prefix with current state context.
 */
function withStateContext(systemPrompt, state, extraContext = '') {
    return [
        systemPrompt,
        `\n\n---\nПоточний стан сесії: ${state}`,
        extraContext ? `\nДодатковий контекст: ${extraContext}` : '',
    ].join('');
}

module.exports = { buildMessages, extractTag, withStateContext };
