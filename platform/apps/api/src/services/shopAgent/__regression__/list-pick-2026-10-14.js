'use strict';
/**
 * Окремий тест змін 14.10 (власник, сесія 7cac4f9b ruslan_gnatyak_: «Яка ціна кофти?» → список із двох однакових «Чоловіча
 * вʼязана кофта» → «Ця скільки» / «Сіра» / «З замком» / «Донизу» → бот здався):
 *   1) позиції списку несуть КОРОТКИЙ ОПИС (catalogHintItems.desc) — з нотаток/презентації CRM;
 *   2) аналізатор (справжній ШІ) обирає позицію за ОЗНАКОЮ («з замком донизу» → A0187, блискавка на всю довжину);
 *   3) відповідь свайпом на фото → товар з цього фото (photoReplyMap);
 *   4) номер на фото (image-processor) + список фото з номерами в ході бота.
 * Запуск на сервері:  node apps/api/src/services/shopAgent/__regression__/list-pick-2026-10-14.js
 */
if (!process.env.name) process.env.name = 'list-pick-test';
if (require.main === module && !process.env.NODE_PATH) { process.env.NODE_PATH = '/var/www/flows.fineko.space/platform/node_modules'; require('module').Module._initPaths(); }
const fs = require('fs');
const { loadAssets, loadCatalog, db } = require('../lib');
const { runPolicy } = require('../policy');
const { understand } = require('../understand');
const { computeCatalogHint } = require('../catalogHint');
const MC = require('../../metaChannel');
const { labelPhoto } = require('../../photoLabel');

const BOT = 'fcdee415-bef2-4a74-a650-e6e4b5a12322';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log((ok ? '✅ PASS — ' : '❌ FAIL — ') + name + (detail ? '  (' + String(detail).slice(0, 300) + ')' : '')); };

(async () => {
    const assets = await loadAssets(BOT, { force: true });
    // Ключ ШІ береться за сесією (resolveFunnelClaudeKey) — потрібна справжня ТЕСТОВА сесія цього бота; стан тесту — лише в памʼяті.
    const ts = await db.session.findFirst({ where: { botId: BOT, isTest: true }, orderBy: { lastActive: 'desc' }, select: { id: true } });
    if (!ts) throw new Error('нема тестової сесії бота для ключа ШІ');
    const cat = await loadCatalog(BOT, assets.keys, { force: true });
    const by = (s) => cat.products.find((p) => String(p.sku).toUpperCase() === s);

    // ── 1. Опис позицій списку з CRM ──
    // Той самий розрахунок, що й наживо (computeCatalogHint); склад списку залежить від активної реклами — тому для решти
    // тесту беремо рівно список з діалогу Руслана: C0043, A0187, D0050.
    const live = await computeCatalogHint({ lastUserMessage: 'Яка ціна кофти?', agent: {} }, assets.keys, 'Яка ціна кофти?').catch((e) => ({ err: e.message }));
    const liveItems = Array.isArray(live.catalogHintItems) ? live.catalogHintItems : [];
    check('1.1 живий список «Яка ціна кофти?» — позиції з номером, фото й описом', liveItems.length > 0 && liveItems.every((x) => x.n && x.sku && x.desc), liveItems.map((x) => x.n + ') ' + x.sku + ': ' + String(x.desc).slice(0, 60)).join(' | ') || JSON.stringify(live).slice(0, 200));
    const SK = ['C0043', 'A0187', 'D0050'];
    const listCtx = { ...live, catalogHintSkus: SK.join(',') };
    listCtx.catalogHintItems = SK.map((sku, i) => {
        const fromLive = liveItems.find((x) => x.sku === sku);
        if (fromLive) return { ...fromLive, n: i + 1 };
        const p = by(sku);
        return { n: i + 1, sku, url: (p.images || [])[0] || '', name: String(p.customerName || p.name).split('\n')[0].replace(/[.,]?\s*артикул.*$/i, '').trim(), price: Number(p.price) || 0, desc: String(p.aiNotes || '').replace(/\s+/g, ' ').slice(0, 320) };
    });
    listCtx.catalogHint = listCtx.catalogHintItems.map((x) => x.n + '. Артикул ' + x.sku + ' — ' + x.name + ' — ' + x.price + ' грн').join('\n');
    const dA = (listCtx.catalogHintItems.find((x) => x.sku === 'A0187') || {}).desc || '';
    const dC = (listCtx.catalogHintItems.find((x) => x.sku === 'C0043') || {}).desc || '';
    check('1.2 опис розрізняє кофти: A0187 — блискавка на всю довжину, C0043 — до грудей', /всю довжину|до самого низу/i.test(dA) && /до грудей|півзамок/i.test(dC), 'A0187: ' + dA.slice(0, 90) + ' | C0043: ' + dC.slice(0, 90));

    const mkA = (turnText, history, extraCtx) => ({
        botId: BOT, session: { id: ts.id, state: 'inbox' },
        ctx: { testMode: true, agent: { lastAsk: 'який із показаних товарів цікавить', hintPhotosFor: SK.join(',') }, ...JSON.parse(JSON.stringify(listCtx)), ...(extraCtx || {}) },
        keys: assets.keys, assets, user: {}, trace: [], out: [], turnText, turnImage: null, history: history || [], botSpokeBefore: true,
    });
    const H = (pairs) => pairs.map(([who, text], i) => ({ who, text, at: new Date(Date.now() - (pairs.length - i) * 20000), sentAt: new Date(Date.now() - (pairs.length - i) * 20000) }));
    const histRuslan = H([['client', 'Яка ціна кофти?'], ['bot', listCtx.catalogHint + '\nЯка сподобалась? Можна відповісти номером'], ['client', 'Сіра'], ['bot', 'Сірий є в кількох моделях зі списку 🙂 Яка саме цікавить?\n1. Кофта Ангора — 1279 грн\n2. Кофта Сейн ангора — 1279 грн'], ['client', 'З замком']]);

    // ── 2. Вибір за ознакою — справжній аналізатор + політика ──
    const scen = [
        { name: '2.1 «Донизу» після «З замком» (як у Руслана) → A0187', text: 'Донизу', hist: histRuslan, want: 'A0187' },
        { name: '2.2 «довга, з замком до кінця» → A0187', text: 'довга, з замком до кінця', hist: H([['client', 'Яка ціна кофти?'], ['bot', listCtx.catalogHint]]), want: 'A0187' },
        { name: '2.3 «та, що з короткою блискавкою біля горла» → C0043', text: 'та, що з короткою блискавкою біля горла', hist: H([['client', 'Яка ціна кофти?'], ['bot', listCtx.catalogHint]]), want: 'C0043' },
        { name: '2.4 «з бавовни, петля» → D0050', text: 'мені ту що з бавовни, петля', hist: H([['client', 'Яка ціна кофти?'], ['bot', listCtx.catalogHint]]), want: 'D0050' },
    ];
    for (const sc of scen) {
        const A = mkA(sc.text, sc.hist);
        let u; try { u = await understand(A); } catch (e) { check(sc.name, false, 'understand: ' + e.message); continue; }
        if (u._error) { check(sc.name, false, 'ШІ недоступний: ' + u._error); continue; }
        await runPolicy(A, u);
        const sku = A.ctx.product && A.ctx.product.sku;
        check(sc.name, String(sku || '').toUpperCase() === sc.want, 'fromList=' + (u.productHint && u.productHint.fromList) + ' → товар ' + (sku || '—') + ' | кроки: ' + A.out.map((o) => o.step).join(','));
    }

    // ── 3. Відповідь свайпом на фото ──
    const ctxMap = { agent: { photoReplyMap: { 'mid-photo-1': 'C0043', 'mid-photo-2': 'A0187', 'mid-photo-3': 'D0050' } } };
    check('3.1 відповідь на фото №2 → A0187 (за id нашого повідомлення-фото)', MC._replyToSkuFor(ctxMap, 'mid-photo-2') === 'A0187' && MC._replyToSkuFor(ctxMap, 'mid-unknown') === null, '');
    {
        const A = mkA('Ця скільки', H([['client', 'Яка ціна кофти?'], ['bot', listCtx.catalogHint]]), { replyToSku: 'A0187' });
        const u = await understand(A);
        await runPolicy(A, u);
        const sku = A.ctx.product && A.ctx.product.sku;
        check('3.2 «Ця скільки» свайпом на фото A0187 → бот показує саме A0187', String(sku || '').toUpperCase() === 'A0187' && A.out.some((o) => /present/.test(String(o.step))), 'товар ' + (sku || '—') + ' | кроки: ' + A.out.map((o) => o.step).join(','));
    }

    // ── 4. Номери на фото ──
    {
        const A = mkA('Яка ціна кофти?', [], { agent: {} });
        A.ctx.agent = {}; // список ще не показували
        const items = listCtx.catalogHintItems;
        const urls = items.map((x) => x.url).filter((u) => /^https?:/.test(u));
        let ok = 0; const dir = '/tmp/list-pick-photos'; fs.mkdirSync(dir, { recursive: true });
        for (let i = 0; i < urls.length; i++) { const b = await labelPhoto(urls[i], String(i + 1)); if (b && b.length > 10000) { ok++; fs.writeFileSync(dir + '/photo_' + (i + 1) + '.png', b); } }
        check('4.1 image-processor малює номер на кожному фото списку', ok === urls.length && ok > 0, ok + ' з ' + urls.length + ' → ' + dir);
    }
    {
        // Хід бота, що показує список: фото з номерами й артикулами (у metadata для відправки окремими повідомленнями).
        const A = mkA('Яка ціна кофти?', [], {});
        A.ctx.agent = {};
        const u = { intent: 'question', questions: ['Яка ціна кофти?'], questionTopics: ['price'], productHint: { category: 'кофта' } };
        await runPolicy(A, u);
        const ph = A.out.find((o) => o.step === 'hint_photos');
        check('4.2 хід зі списком: фото з номерами 1..N і артикулами', !!(ph && Array.isArray(ph.photoLabels) && ph.photoLabels.length === ph.photoUrls.length && ph.photoSkus.length === ph.photoUrls.length), ph ? JSON.stringify({ labels: ph.photoLabels, skus: ph.photoSkus }) : 'кроки: ' + A.out.map((o) => o.step).join(','));
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + results.length + ' перевірок, ' + failed.length + ' провалено.');
    process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('ТЕСТ ВПАВ:', e.stack || e.message); process.exit(1); });
