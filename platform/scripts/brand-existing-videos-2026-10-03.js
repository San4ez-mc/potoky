'use strict';
// Одноразово: нанести логотип (водяний знак + фінальна заставка) на ВЖЕ готові відео проєкту, не перегенеровуючи кадри.
//   node scripts/brand-existing-videos-2026-10-03.js <projectId> [--dry]
// Файли лежать у content2 (public/uploads/media/...); пости беремо через agent-tools, лого — з бібліотеки проєкту
// (media_items із тегом "logo": publicPath береться з get_media). Повторний запуск безпечний: оброблені файли мають маркер .branded.
const fs = require('fs');
const path = require('path');
const { applyBranding, download } = require('../apps/short-video/src/render');

const C2 = 'http://127.0.0.1:3002/api/agent-tools';
const TOKEN = 'fnk_wh_2026_x9mK4pLqR7vNsT1eYcJdBuAw';
const PUBLIC_DIR = '/var/www/content2.fineko.space/public';

async function tool(projectId, action, query) {
    const r = await fetch(C2 + '?action=' + action + '&token=' + TOKEN + '&projectId=' + projectId + (query || ''));
    return r.json();
}

async function main() {
    const projectId = process.argv[2];
    const dry = process.argv.includes('--dry');
    if (!projectId) throw new Error('usage: node brand-existing-videos.js <projectId> [--dry]');
    const media = await tool(projectId, 'list_media', '&limit=100');
    const logo = (media.media || []).find((m) => /logo/i.test(m.fileName));
    if (!logo) throw new Error('логотип не знайдено в бібліотеці (файл із «logo» в назві)');
    const work = '/tmp/brand-existing';
    fs.mkdirSync(work, { recursive: true });
    const logoPath = path.join(work, 'logo_src');
    await download('https://content2.fineko.space' + logo.url, logoPath);

    const list = await tool(projectId, 'list_posts', '&date_from=2020-01-01&date_to=2099-01-01&platform=tiktok');
    let done = 0, skipped = 0;
    for (const p of list.posts || []) {
        const g = await tool(projectId, 'get_post', '&number=' + p.number);
        const rel = g.post && g.post.image_path;
        if (!rel || !/\.mp4$/i.test(rel)) { skipped++; continue; }
        const file = path.join(PUBLIC_DIR, rel);
        if (!fs.existsSync(file)) { console.log('#' + p.number, 'файл не знайдено', rel); skipped++; continue; }
        if (fs.existsSync(file + '.branded')) { skipped++; continue; }
        console.log('#' + p.number, rel, dry ? '(dry)' : '');
        if (dry) continue;
        const dir = path.join(work, 'p' + p.number);
        fs.mkdirSync(dir, { recursive: true });
        const out = path.join(dir, 'out.mp4');
        await applyBranding(file, logoPath, out, dir);
        fs.copyFileSync(file, file + '.orig.bak');   // страховка: оригінал поруч
        fs.copyFileSync(out, file);
        fs.writeFileSync(file + '.branded', new Date().toISOString());
        fs.rmSync(dir, { recursive: true, force: true });
        done++;
    }
    console.log(JSON.stringify({ branded: done, skipped }));
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
