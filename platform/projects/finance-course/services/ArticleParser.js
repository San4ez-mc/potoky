'use strict';

/**
 * Parse cashflow_articles.md into { businessName, inflows, outflows }
 * Format produced by bot-2-1-articles buildCashflowFile().
 */
function parseCashflowArticles(content) {
    const lines = content.split('\n');
    const businessName = extractFirstMatch(lines, /^\*\*Бізнес:\*\*\s*(.+)$/);

    let inflows = [];
    let outflows = [];
    let section = null;

    for (const line of lines) {
        if (/^##\s*Статті доходів/i.test(line)) { section = 'income'; continue; }
        if (/^##\s*Статті витрат/i.test(line)) { section = 'expenses'; continue; }

        const heading = line.match(/^###\s*(.+)$/);
        if (heading) {
            const name = heading[1].trim();
            if (section === 'income') inflows.push(name);
            else if (section === 'expenses') outflows.push(name);
        }
    }

    return { businessName: businessName || 'Невідомий бізнес', inflows, outflows };
}

/**
 * Parse pl_articles.md into { businessName, inflows, outflows }
 * Format produced by bot-2-1-articles buildPlFile().
 */
function parsePlArticles(content) {
    // Same heading structure
    return parseCashflowArticles(content);
}

/**
 * Parse business_process.md (markdown with JSON inside) into a plain object.
 * The file may contain a JSON block wrapped in ```json or raw JSON.
 */
function parseBusinessProcess(content) {
    if (!content) return null;

    // Try to extract JSON block
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/i);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[1]); } catch { /* fall through */ }
    }

    // Try raw JSON
    const rawJson = content.match(/\{[\s\S]*\}/);
    if (rawJson) {
        try { return JSON.parse(rawJson[0]); } catch { /* fall through */ }
    }

    return null;
}

/**
 * Format an articles object as a readable list for Claude context.
 * @param {{ inflows: string[], outflows: string[] }} articles
 */
function articlesToText(articles) {
    const inc = (articles.inflows || []).map((n, i) => `  ${i + 1}. ${n}`).join('\n');
    const exp = (articles.outflows || []).map((n, i) => `  ${i + 1}. ${n}`).join('\n');
    return `Статті доходів:\n${inc || '  —'}\n\nСтатті витрат:\n${exp || '  —'}`;
}

function extractFirstMatch(lines, regex) {
    for (const line of lines) {
        const m = line.match(regex);
        if (m) return m[1].trim();
    }
    return null;
}

module.exports = {
    parseCashflowArticles,
    parsePlArticles,
    parseBusinessProcess,
    articlesToText,
};
