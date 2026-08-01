'use strict';

const logger = require('@platform/logger');

// Витяг тексту з документа (PDF / DOCX / TXT|MD|CSV). Використовується нодою `readFile`.
// Обрізка до бюджету, щоб не роздути токени Claude-ноди (урок §15.7).
const DEFAULT_MAX_CHARS = 12000;

async function extractDocumentText(fileUrl, mimeType, fileName, maxChars = DEFAULT_MAX_CHARS) {
    try {
        const mt = String(mimeType || '').toLowerCase();
        const name = String(fileName || '').toLowerCase();
        const res = await fetch(fileUrl);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        let text = '';
        if (mt.includes('pdf') || name.endsWith('.pdf')) {
            const pdfParse = require('pdf-parse');
            text = (await pdfParse(buf))?.text || '';
        } else if (mt.includes('wordprocessingml') || name.endsWith('.docx')) {
            const mammoth = require('mammoth');
            text = (await mammoth.extractRawText({ buffer: buf }))?.value || '';
        } else if (mt.startsWith('text/') || /\.(txt|md|csv)$/.test(name)) {
            text = buf.toString('utf-8');
        } else {
            return null; // непідтримуваний тип
        }
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        if (!text) return null;
        const cap = Number(maxChars) > 0 ? Number(maxChars) : DEFAULT_MAX_CHARS;
        return text.length > cap ? text.slice(0, cap) + '\n…[обрізано]' : text;
    } catch (err) {
        logger.warn('[docExtract] extractDocumentText failed', { error: err.message });
        return null;
    }
}

module.exports = { extractDocumentText };
