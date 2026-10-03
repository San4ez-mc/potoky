'use strict';
// Мікросервіс short-video: приймає сценарій (scenes[]) → рендерить вертикальне відео без обличчя.
// Слухає ТІЛЬКИ 127.0.0.1 (доступ лише з сервера: воронка Flows і content2 на тій самій машині).
//   POST /render        → 202 { jobId }       (асинхронно; по завершенню POST на callbackUrl)
//   GET  /status/:id    → { status, step, videoUrl, error, ... }
//   GET  /files/:name   → mp4 / jpg
//   GET  /health
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { renderVideo } = require('./render');

const PORT = parseInt(process.env.PORT || process.env.SHORT_VIDEO_PORT || '3016', 10);
const DATA_DIR = process.env.SHORT_VIDEO_DIR || path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const PUBLIC_BASE = process.env.SHORT_VIDEO_PUBLIC_BASE || `http://127.0.0.1:${PORT}`;
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(JOBS_DIR, { recursive: true });

const jobs = new Map();
let queue = Promise.resolve(); // по одному рендеру за раз: ffmpeg + 8 ГБ спільного сервера

function saveJob(j) { try { fs.writeFileSync(path.join(JOBS_DIR, j.jobId + '.json'), JSON.stringify(j)); } catch (e) { /* не критично */ } }
function setJob(id, patch) { const j = Object.assign(jobs.get(id) || { jobId: id }, patch, { updatedAt: new Date().toISOString() }); jobs.set(id, j); saveJob(j); return j; }
function loadJob(id) {
    if (jobs.has(id)) return jobs.get(id);
    try { const j = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, id + '.json'), 'utf8')); jobs.set(id, j); return j; } catch (e) { return null; }
}

async function notify(url, body) {
    if (!url) return;
    for (let i = 0; i < 3; i++) {
        try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (r.ok) return; } catch (e) { /* ретрай */ }
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
}

async function runJob(jobId, payload) {
    const dir = path.join(DATA_DIR, 'work', jobId);
    const outFile = path.join(FILES_DIR, jobId + '.mp4');
    setJob(jobId, { status: 'processing', step: 'start' });
    try {
        const res = await renderVideo(payload, { dir, outFile, onStep: (step) => setJob(jobId, { step }) });
        const videoUrl = `${PUBLIC_BASE}/files/${jobId}.mp4`;
        const thumbUrl = res.thumb ? `${PUBLIC_BASE}/files/${jobId}.jpg` : null;
        setJob(jobId, { status: 'done', step: 'done', videoUrl, thumbUrl, durationSec: res.durationSec, cost: res.cost, music: res.music, warnings: res.warnings });
        await notify(payload.callbackUrl, { status: 'success', videoUrl, thumbUrl, durationSec: res.durationSec, postItemId: payload.postItemId, postGroupId: payload.postGroupId });
    } catch (e) {
        console.error('[short-video] job failed', jobId, e.message);
        setJob(jobId, { status: 'failed', error: String(e.message).slice(0, 500) });
        await notify(payload.callbackUrl, { status: 'error', error: String(e.message).slice(0, 500), postItemId: payload.postItemId, postGroupId: payload.postGroupId });
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => { data += c; if (data.length > 2e6) { reject(new Error('body too large')); req.destroy(); } });
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(new Error('bad json')); } });
    });
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://x');
        if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'short-video', queued: [...jobs.values()].filter((j) => j.status === 'processing' || j.status === 'queued').length });
        if (req.method === 'POST' && url.pathname === '/render') {
            const payload = await readBody(req);
            if (!Array.isArray(payload.scenes) || !payload.scenes.length) return send(res, 400, { ok: false, error: 'scenes[] required' });
            // ідемпотентність: повторний запит на ТОЙ САМИЙ пост, поки його рендер у черзі/в роботі, не ставить дубль
            if (payload.postItemId) {
                for (const j of jobs.values()) {
                    if (j.postItemId === payload.postItemId && (j.status === 'queued' || j.status === 'processing')) return send(res, 202, { ok: true, jobId: j.jobId, duplicate: true });
                }
            }
            const jobId = payload.jobId && /^[a-zA-Z0-9_-]{4,64}$/.test(payload.jobId) ? payload.jobId : 'sv_' + crypto.randomBytes(6).toString('hex');
            setJob(jobId, { status: 'queued', step: 'queued', postItemId: payload.postItemId || null, createdAt: new Date().toISOString() });
            queue = queue.then(() => runJob(jobId, payload)).catch(() => {});
            return send(res, 202, { ok: true, jobId });
        }
        const sm = url.pathname.match(/^\/status\/([a-zA-Z0-9_-]+)$/);
        if (req.method === 'GET' && sm) { const j = loadJob(sm[1]); return j ? send(res, 200, { ok: true, ...j }) : send(res, 404, { ok: false, error: 'no such job' }); }
        const fm = url.pathname.match(/^\/files\/([a-zA-Z0-9_-]+\.(mp4|jpg))$/);
        if (req.method === 'GET' && fm) {
            const f = path.join(FILES_DIR, fm[1]);
            if (!fs.existsSync(f)) return send(res, 404, { ok: false, error: 'not found' });
            const stat = fs.statSync(f);
            res.writeHead(200, { 'Content-Type': fm[2] === 'mp4' ? 'video/mp4' : 'image/jpeg', 'Content-Length': stat.size });
            return fs.createReadStream(f).pipe(res);
        }
        send(res, 404, { ok: false, error: 'not found' });
    } catch (e) { send(res, 500, { ok: false, error: e.message }); }
});

// порожній диск — теж проблема: чистимо відео/роботи старші за 14 днів при старті
try {
    const cutoff = Date.now() - 14 * 86400000;
    for (const d of [FILES_DIR, JOBS_DIR]) for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }); }
} catch (e) { /* ignore */ }

server.listen(PORT, '127.0.0.1', () => console.log('[short-video] listening on 127.0.0.1:' + PORT));
