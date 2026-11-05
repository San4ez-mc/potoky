'use strict';
// Перезапуск рендеру картинок рекламних креативів, що не згенерувались (status failed/pending), для компанії content2.
// На сервері: node scripts/ads/rerender.js <projectId> [slug воронки, за замовчуванням ads-render-image]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { db } = require('@platform/db');

async function main() {
    const projectId = process.argv[2];
    const slug = process.argv[3] || 'ads-render-image';
    if (!projectId) throw new Error('projectId обовʼязковий');
    const src = await db.bot.findFirst({ where: { slug: 'ads-creative-image' } });
    const keyOf = async (k) => ((await db.funnelKey.findUnique({ where: { botId_key: { botId: src.id, key: k } }, select: { value: true } })) || {}).value || '';
    const secret = await keyOf('CONTENT2_WEBHOOK_SECRET');
    const base = (await keyOf('CONTENT2_URL')) || 'https://content2.fineko.space';
    const call = async (params) => {
        const r = await fetch(base + '/api/agent-tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ token: secret, projectId }, params)) });
        return r.json().catch(() => ({}));
    };
    const list = await call({ action: 'list_posts', platform: 'meta_ads' });
    const todo = (list.posts || []).filter((p) => p.funnel_slug === slug && p.generation_status !== 'done');
    console.log('креативів у мережі:', (list.posts || []).length, '| до перерендера:', todo.length);
    for (const p of todo) {
        const r = await call({ action: 'regenerate_image', number: p.number });
        console.log(' #' + p.number, p.post_type, '->', r.ok === false ? 'ПОМИЛКА ' + r.error : 'запущено');
        await new Promise((res) => setTimeout(res, 1500));
    }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
