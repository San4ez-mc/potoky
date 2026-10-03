'use strict';
// Смоук сервісу short-video: реальний рендер ролика KIRO (кадри fal FLUX + ffmpeg + музика) і розкладка кадрів.
//   node scripts/qa/short-video-smoke.js [--cheap]     (--cheap = flux schnell, без музики)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require('@platform/db');
const { execFileSync } = require('child_process');

const SV = 'http://127.0.0.1:3016';
const cheap = process.argv.includes('--cheap');

const STYLE = 'flat 2D cartoon illustration, thick clean outlines, bold saturated colors with deep purple, electric orange and teal, simple round-headed faceless character with no facial features, vertical cinematic composition, no text, no letters, no logos';
const scenes = [
    { sec: 3, visual: 'the character slumped on a grey sofa in a dull empty living room on a Saturday evening, a clock on the wall showing 7pm, bored mood, muted colors', text: 'Субота. 19:00. Нічого робити.', motion: 'zoom_in' },
    { sec: 3, visual: 'the character scrolling a phone, many silent chat bubbles with question marks floating around, gloomy cold light', text: 'Чати мовчать.', motion: 'pan_right' },
    { sec: 3, visual: 'the phone glows bright orange, colorful event icons burst out of the screen: a board game, a microphone, a football, a bicycle', text: 'А поруч — живі події.', motion: 'zoom_out' },
    { sec: 3, visual: 'the same character laughing around a table with friends faceless silhouettes playing a board game, warm golden lights, cozy cafe', text: 'Мафія. Настолки. Біг.', motion: 'pan_left' },
    { sec: 3, visual: 'the character waving at night Kyiv skyline with glowing city lights and a big glowing map pin, joyful', text: 'KIRO. Події поруч.', motion: 'zoom_in' },
];

async function main() {
    const bot = await db.bot.findFirst({ where: { slug: 'content-video-broll' } });
    const k = await db.funnelKey.findUnique({ where: { botId_key: { botId: bot.id, key: 'FAL_AI_KEY' } }, select: { value: true } });
    if (!k || !k.value) throw new Error('FAL_AI_KEY не знайдено');
    const payload = {
        scenes, style: STYLE, falApiKey: k.value,
        imageModel: cheap ? 'fal-ai/flux/schnell' : 'fal-ai/flux/dev',
        music: cheap ? null : { prompt: 'upbeat playful lo-fi electronic pop, 120 BPM, light, optimistic, catchy, no vocals' },
    };
    const r = await fetch(SV + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const { jobId } = await r.json();
    console.log('job', jobId);
    let st = {};
    for (let i = 0; i < 90; i++) {
        await new Promise((res) => setTimeout(res, 4000));
        st = await (await fetch(SV + '/status/' + jobId)).json();
        process.stdout.write(st.status + ':' + st.step + ' ');
        if (st.status === 'done' || st.status === 'failed') break;
    }
    console.log('\n', JSON.stringify(st));
    if (st.status !== 'done') throw new Error('render failed: ' + st.error);
    const out = '/tmp/short-video-smoke';
    execFileSync('mkdir', ['-p', out]);
    execFileSync('curl', ['-s', '-o', out + '/v.mp4', st.videoUrl]);
    for (const t of [0.5, 3.5, 6.5, 9.5, 12.5]) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', out + '/v.mp4', '-frames:v', '1', '-vf', 'scale=360:-1', out + '/f' + t + '.png']);
    console.log(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,duration', '-of', 'compact', out + '/v.mp4']).toString());
    process.exit(0);
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
