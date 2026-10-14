'use strict';
/**
 * Номер на фото товару (2026-10-14, власник: «на фото додавати номер, щоб людина могла відповісти „хочу кофту 1 чи 3“»).
 * Малює мікросервіс image-processor (pm2 image-processor, 127.0.0.1:3011, /compose — sharp): фото вписується в 1080×1350 (4:5,
 * формат Instagram), у лівому верхньому куті — кружечок із номером. Байти повертаються одразу на завантаження в Meta
 * (message_attachments), публічне посилання не потрібне. Сервіс недоступний — повертаємо null, фото йде без номера.
 */
const logger = require('@platform/logger');

const IMG_PROCESSOR = process.env.IMAGE_PROCESSOR_URL || 'http://127.0.0.1:3011';
const W = 1080, H = 1350, R = 78, M = 46;

function badgeSvg(label) {
    const s = String(label).slice(0, 3);
    const fs = s.length > 1 ? 80 : 100;
    return `<svg width="${2 * R + 8}" height="${2 * R + 8}" xmlns="http://www.w3.org/2000/svg">`
        + `<circle cx="${R + 4}" cy="${R + 4}" r="${R}" fill="#FFFFFF" stroke="#111111" stroke-width="6"/>`
        + `<text x="${R + 4}" y="${R + 4}" text-anchor="middle" dominant-baseline="central" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${fs}" fill="#111111">${s.replace(/[<>&]/g, '')}</text></svg>`;
}

/** Байти фото з номером (PNG) або null. */
async function labelPhoto(imageUrl, label, { timeoutMs = 15000 } = {}) {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const r = await fetch(IMG_PROCESSOR + '/compose', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
            body: JSON.stringify({ width: W, height: H, layers: [
                { type: 'color', color: '#FFFFFF' },
                { type: 'image', url: String(imageUrl), width: W, height: H, fit: 'cover', position: { x: 0, y: 0 } },
                { type: 'image', imageBase64: 'data:image/svg+xml;base64,' + Buffer.from(badgeSvg(label)).toString('base64'), position: { x: M, y: M } },
            ] }),
        });
        const j = await r.json().catch(() => ({}));
        const b64 = j && j.result && j.result.imageBase64;
        if (!r.ok || !b64) { logger.warn('[photoLabel] image-processor: ' + ((j && j.error && j.error.message) || r.status)); return null; }
        return Buffer.from(b64, 'base64');
    } catch (e) { logger.warn('[photoLabel] ' + e.message); return null; }
    finally { clearTimeout(to); }
}

module.exports = { labelPhoto, badgeSvg };
