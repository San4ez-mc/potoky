'use strict';
// Продавець експерта (tpl-expert-seller і всі sell-* клони): до кожного питання про ситуацію людини
// додає 2-3 готові нумеровані варіанти відповіді (люди лінуються писати). Правило 15 у промпті ноди діалогу.
// Ідемпотентно. Запуск з кореня platform/:  PLATFORM_ROOT=$PWD node scripts/patch-seller-options-2026-10-30.js  (DRY_RUN=1 — лише показати)
const path = require('path');
const ROOT = process.env.PLATFORM_ROOT || path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { callTool } = require(path.join(ROOT, 'apps/mcp/src/tools-flows.js'));
const { db } = require('@platform/db');

const DRY = !!process.env.DRY_RUN;
const MARK = '15. Люди лінуються писати.';
const RULE = '15. Люди лінуються писати. До кожного питання про ситуацію людини (процес, труднощі, що пробувала, що важливо) додавай 2-3 готові варіанти відповіді одним рядком: «1) … 2) … 3) …», і наприкінці «або напиши своїми словами». Відповісти можна цифрою. Варіанти бери з блоків вище й того, що людина вже сказала, а не вигадуй абстрактні. Лише коротке питання-так/ні, імʼя чи контакт варіантів не потребують. Ціни, умови й факти про експерта лише з блоків, у варіанти їх не підміняй.';

(async () => {
    const bots = await db.bot.findMany({ where: { OR: [{ slug: 'tpl-expert-seller' }, { slug: { startsWith: 'sell-' } }] }, select: { id: true, slug: true } });
    let changed = 0;
    for (const b of bots) {
        const f = await callTool('get_funnel', { botId: b.id });
        const n = (f.nodes || []).find((x) => x.data && typeof x.data.systemPrompt === 'string' && x.data.systemPrompt.includes('ЯК ВЕДЕШ ДІАЛОГ'));
        if (!n) { console.log('  —', b.slug, ': нода діалогу не знайдена'); continue; }
        const p = n.data.systemPrompt;
        if (p.includes(MARK)) { console.log('  =', b.slug, ': вже оновлено'); continue; }
        const lines = p.split('\n');
        const i = lines.findIndex((l) => l.startsWith('14. Не пропонуй того'));
        if (i < 0) { console.log('  ?', b.slug, ': незвичний промпт (нема пункту 14), пропущено'); continue; }
        lines.splice(i + 1, 0, RULE);
        if (!DRY) await callTool('update_node', { botId: b.id, nodeId: n.id, data: { systemPrompt: lines.join('\n') } });
        console.log('  ✔', b.slug, DRY ? '(dry-run)' : 'оновлено'); changed++;
    }
    console.log('Готово, змін:', changed);
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message); process.exit(1); });
