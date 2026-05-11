'use strict';

const logger = require('@platform/logger');

/**
 * Render Mermaid code to a PNG buffer using mermaid.ink public API.
 * Falls back gracefully — if API fails returns null and caller sends text only.
 * @param {string} mermaidCode
 * @returns {Promise<Buffer|null>}
 */
async function renderMermaid(mermaidCode) {
    try {
        return await renderViaApi(mermaidCode);
    } catch (err) {
        logger.warn('Mermaid render failed', { error: err.message });
        return null;
    }
}

async function renderViaApi(mermaidCode) {
    const encoded = Buffer.from(mermaidCode, 'utf8').toString('base64url');
    const url = `https://mermaid.ink/img/${encoded}?type=png`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'FinancePlatformBot/1.0' },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`mermaid.ink returned ${response.status}`);
        }

        const arrayBuf = await response.arrayBuffer();
        return Buffer.from(arrayBuf);
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { renderMermaid };
