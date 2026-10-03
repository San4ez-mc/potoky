'use strict';
// Рендер КОРОТКОГО ВЕРТИКАЛЬНОГО ВІДЕО БЕЗ ОБЛИЧЧЯ з готового сценарію (scenes[]).
//   сцена → кадр (AI-ілюстрація fal FLUX у єдиному стилі АБО готовий imageUrl АБО AI-анімація Kling)
//         → рух камери (zoom/pan) → великий напис → склейка → музика (fal stable-audio) → mp4 1080x1920.
// Усе — через ffmpeg (spawn без shell) і fal.ai REST. Жодних npm-залежностей.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const W = 1080;
const H = 1920;
const FPS = 30;
const FONT = process.env.SHORT_VIDEO_FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const MAX_TOTAL_SEC = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, { timeoutMs = 240000 } = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(cmd + ' timeout')); }, timeoutMs);
        p.stderr.on('data', (d) => { err = (err + d.toString()).slice(-4000); });
        p.on('error', (e) => { clearTimeout(timer); reject(e); });
        p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(cmd + ' exit ' + code + ': ' + err.slice(-700))); });
    });
}

async function download(url, dest) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('download ' + r.status + ' ' + url.slice(0, 80));
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return dest;
}

async function falPost(endpoint, key, body, tries = 3) {
    let last = null;
    for (let i = 0; i < tries; i++) {
        try {
            const r = await fetch('https://fal.run/' + endpoint, {
                method: 'POST',
                headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await r.json().catch(() => ({}));
            if (r.ok) return j;
            last = new Error('fal ' + endpoint + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
            if (r.status < 500 && r.status !== 429) break; // 4xx (крім 429) повторювати марно
        } catch (e) { last = e; }
        await sleep(2500 * (i + 1));
    }
    throw last;
}

// ── текст на екрані ─────────────────────────────────────────────────────────
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu; // шрифт без емодзі — прибираємо

function wrapText(text, maxChars) {
    const words = String(text || '').replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
        if (!cur) cur = w;
        else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
        else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
}

function textLayout(text) {
    // підбираємо кегль під довжину: короткий напис — великий, довгий — менший, але читабельний у ленті
    const flat = String(text || '').replace(EMOJI_RE, '').trim();
    let size = 92, maxChars = 13;
    if (flat.length > 22) { size = 80; maxChars = 15; }
    if (flat.length > 48) { size = 68; maxChars = 18; }
    if (flat.length > 90) { size = 58; maxChars = 21; }
    return { lines: wrapText(flat, maxChars), size };
}

// ── рух камери ──────────────────────────────────────────────────────────────
function motionFilter(motion, frames) {
    const d = Math.max(2, frames);
    const base = `scale=${W * 2}:${H * 2}:flags=lanczos`;
    const out = `s=${W}x${H}:fps=${FPS}`;
    switch (motion) {
        case 'zoom_out':
            return `${base},zoompan=z='if(eq(on,0),1.28,max(1.0,zoom-0.0016))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${d}:${out}`;
        case 'pan_left':
            return `${base},zoompan=z=1.22:x='(iw-iw/zoom)*(1-on/${d})':y='ih/2-(ih/zoom/2)':d=${d}:${out}`;
        case 'pan_right':
            return `${base},zoompan=z=1.22:x='(iw-iw/zoom)*on/${d}':y='ih/2-(ih/zoom/2)':d=${d}:${out}`;
        case 'zoom_in':
        default:
            return `${base},zoompan=z='min(zoom+0.0016,1.28)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${d}:${out}`;
    }
}
const MOTIONS = ['zoom_in', 'pan_right', 'zoom_out', 'pan_left'];

function drawTextFilters(dir, i, layout) {
    // кожен рядок — окремий drawtext, вирівняний по центру (багаторядковий drawtext вирівнює рядки по лівому краю блока).
    // Білий напис із чорною обводкою читається на будь-якому фоні; поява за 0.2 с; у «безпечній зоні» стрічки (~60% висоти).
    const n = layout.lines.length;
    const lineH = Math.round(layout.size * 1.22);
    return layout.lines.map((ln, j) => {
        const tf = path.join(dir, `t${i}_${j}.txt`);
        fs.writeFileSync(tf, ln, 'utf8');
        const off = Math.round((j - (n - 1) / 2) * lineH);
        return `drawtext=fontfile=${FONT}:textfile=${tf}:fontsize=${layout.size}:fontcolor=white:borderw=8:bordercolor=black:` +
            `x=(w-text_w)/2:y=h*0.60+(${off})-text_h/2:alpha='if(lt(t,0.1),0,min(1,(t-0.1)/0.25))'`;
    });
}

async function buildSceneClip(scene, i, imgPath, dir, secs) {
    const frames = Math.round(secs * FPS);
    const clipPath = path.join(dir, `clip${i}.mp4`);
    const layout = textLayout(scene.text);
    let vf;
    if (scene._videoPath) {
        // AI-анімація (Kling): беремо перші secs секунд, кропаємо до 9:16
        vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS}`;
    } else {
        // рух за вибором сценариста, інакше чергуємо, щоб сусідні кадри не рухались однаково
        vf = motionFilter(MOTIONS.includes(scene.motion) ? scene.motion : MOTIONS[i % MOTIONS.length], frames);
    }
    if (layout.lines.length) vf += ',' + drawTextFilters(dir, i, layout).join(',');
    vf += ',format=yuv420p';
    const input = scene._videoPath ? ['-i', scene._videoPath] : ['-loop', '1', '-framerate', String(FPS), '-i', imgPath];
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...input, '-vf', vf, '-t', String(secs), '-r', String(FPS),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', '-threads', '2', clipPath]);
    return clipPath;
}

async function generateImage(scene, style, falKey, model, refUrl) {
    const visual = String(scene.visual || '').trim();
    let j;
    if (refUrl) {
        // ТОЙ САМИЙ персонаж і стиль, що в першому кадрі: image-to-image (FLUX Kontext) замість малювання з нуля
        j = await falPost('fal-ai/flux-kontext/dev', falKey, {
            prompt: `Keep the exact same main character (same face, body proportions, clothes, colors) and the exact same art style. Show the character in a new scene: ${visual}. ${style ? 'Style reminder: ' + style : ''}`,
            image_url: refUrl, num_inference_steps: 28, guidance_scale: 2.5, num_images: 1, output_format: 'png',
        });
    } else {
        const body = { prompt: (style ? style + '. ' : '') + visual, image_size: { width: 864, height: 1536 }, num_images: 1, enable_safety_checker: true };
        if (model.includes('schnell')) body.num_inference_steps = 4;
        else { body.num_inference_steps = 28; body.guidance_scale = 3.5; }
        j = await falPost(model, falKey, body);
    }
    const url = j.images && j.images[0] && j.images[0].url;
    if (!url) throw new Error('fal image: no url ' + JSON.stringify(j).slice(0, 200));
    return url;
}

async function generateAiClip(scene, imageUrl, falKey) {
    const j = await falPost('fal-ai/kling-video/v1.6/standard/image-to-video', falKey, {
        prompt: String(scene.motionPrompt || scene.visual || 'subtle cinematic camera motion, gentle animation').slice(0, 400),
        image_url: imageUrl, duration: '5', aspect_ratio: '9:16',
    }, 2);
    const url = j.video && j.video.url;
    if (!url) throw new Error('fal i2v: no url ' + JSON.stringify(j).slice(0, 200));
    return url;
}

async function makeMusic(music, totalSec, falKey, dir) {
    if (!music) return null;
    if (music.url) return download(music.url, path.join(dir, 'music.mp3'));
    if (music.prompt && falKey) {
        const j = await falPost('fal-ai/stable-audio', falKey, { prompt: String(music.prompt).slice(0, 400), seconds_total: Math.min(47, Math.max(10, Math.ceil(totalSec))) }, 2);
        const url = (j.audio_file && j.audio_file.url) || (j.audio && j.audio.url);
        if (!url) throw new Error('fal music: no url ' + JSON.stringify(j).slice(0, 200));
        return download(url, path.join(dir, 'music.wav'));
    }
    return null;
}

/**
 * @param {object} job { scenes[], style, music, falApiKey, imageModel, coverTitle }
 * @param {object} ctx { dir, outFile, onStep(step) }
 * @returns {{ file, thumb, durationSec, cost }}
 */
async function renderVideo(job, ctx) {
    const { dir, outFile, onStep = () => {} } = ctx;
    fs.mkdirSync(dir, { recursive: true });
    const scenes = (Array.isArray(job.scenes) ? job.scenes : []).filter((s) => s && (s.visual || s.imageUrl || s.text)).slice(0, 10);
    if (!scenes.length) throw new Error('NO_SCENES');
    const falKey = job.falApiKey || '';
    const needsFal = scenes.some((s) => !s.imageUrl) || (job.music && job.music.prompt) || scenes.some((s) => s.motion === 'ai');
    if (needsFal && !falKey) throw new Error('NO_FAL_KEY');

    // тривалості: 1.5–6 с на сцену, сумарно ≤ 30 с
    let secs = scenes.map((s) => Math.min(6, Math.max(1.5, Number(s.sec) || 3)));
    const total0 = secs.reduce((a, b) => a + b, 0);
    if (total0 > MAX_TOTAL_SEC) secs = secs.map((s) => (s * MAX_TOTAL_SEC) / total0);
    const totalSec = secs.reduce((a, b) => a + b, 0);

    let cost = 0;
    const model = job.imageModel || 'fal-ai/flux/dev';
    const imgPaths = new Array(scenes.length);
    const imgUrls = new Array(scenes.length);

    onStep('images');
    // Перший кадр малюємо з тексту, решту — від нього (той самий персонаж), по 3 паралельно.
    // Сцена з готовим imageUrl або sameCharacter:false малюється окремо. consistency:'off' вимикає це.
    const useRef = job.consistency !== 'off' && !model.includes('schnell');
    async function makeScene(i, refUrl) {
        const s = scenes[i];
        const ref = s.sameCharacter === false ? null : refUrl;
        const url = s.imageUrl || (await generateImage(s, job.style, falKey, model, ref));
        if (!s.imageUrl) cost += model.includes('schnell') ? 0.003 : 0.025;
        imgUrls[i] = url;
        imgPaths[i] = await download(url, path.join(dir, `img${i}.png`));
    }
    await makeScene(0, null);
    const refUrl = useRef ? imgUrls[0] : null;
    let next = 1;
    async function worker() { while (next < scenes.length) { const i = next++; await makeScene(i, refUrl); } }
    await Promise.all([worker(), worker(), worker()]);

    // AI-анімація обраних сцен (дорого — лише коли явно motion:'ai', не більше 2 на ролик)
    let aiCount = 0;
    for (let i = 0; i < scenes.length; i++) {
        if (scenes[i].motion === 'ai' && aiCount < 2) {
            onStep('animate');
            try {
                const vurl = await generateAiClip(scenes[i], imgUrls[i], falKey);
                scenes[i]._videoPath = await download(vurl, path.join(dir, `ai${i}.mp4`));
                cost += 0.25; aiCount++;
            } catch (e) { console.error('[short-video] ai clip failed, fallback to camera motion:', e.message); }
        }
    }

    onStep('clips');
    const clips = [];
    for (let i = 0; i < scenes.length; i++) clips.push(await buildSceneClip(scenes[i], i, imgPaths[i], dir, secs[i]));

    onStep('music');
    let musicPath = null;
    try { musicPath = await makeMusic(job.music, totalSec, falKey, dir); if (musicPath && job.music && job.music.prompt) cost += 0.05; }
    catch (e) { console.error('[short-video] music failed, going silent:', e.message); }

    onStep('assemble');
    const listFile = path.join(dir, 'list.txt');
    fs.writeFileSync(listFile, clips.map((c) => `file '${c}'`).join('\n'));
    const silent = path.join(dir, 'silent.mp4');
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent]);

    const fadeOut = Math.max(0, totalSec - 1.2);
    if (musicPath) {
        await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', silent, '-i', musicPath,
            '-filter_complex', `[1:a]atrim=0:${totalSec.toFixed(2)},afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.2,volume=0.9[a]`,
            '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', totalSec.toFixed(2), '-movflags', '+faststart', outFile]);
    } else {
        await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', silent, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
            '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outFile]);
    }

    const thumb = outFile.replace(/\.mp4$/, '.jpg');
    try { await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.8', '-i', outFile, '-frames:v', '1', '-q:v', '3', thumb]); } catch (e) { /* прев'ю не критичне */ }

    return { file: outFile, thumb: fs.existsSync(thumb) ? thumb : null, durationSec: Number(totalSec.toFixed(1)), cost: Number(cost.toFixed(3)), music: !!musicPath };
}

module.exports = { renderVideo, wrapText, textLayout };
